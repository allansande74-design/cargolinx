/**
 * Dispatch: one thread from a finished order to a moving vehicle.
 *
 * The platform had five honest pieces — order lifecycle, corridor planning, vehicle matching, partner
 * eligibility, tracking — and an operator still had to carry the facts between them by hand. This
 * module is that hand-off, written as one pure function so the refusal is as inspectable as the
 * success.
 *
 * Rules it enforces:
 *  - a stage cannot be skipped: an order that has not been packed cannot be dispatched;
 *  - a partner is only offered if it is verified, its documents are valid on the dispatch date, its
 *    vehicle fits the load and it is registered for that lane;
 *  - the smallest vehicle that fits is chosen, not the first one found;
 *  - the vehicle is booked before it is dispatched, so two orders cannot take the same truck;
 *  - the track is opened from the same legs the booking was made against, so the promise and the
 *    monitoring cannot drift apart.
 *
 * Every refusal is data (`{ ok: false, refusals: [...] }`), never an exception: an operator needs the
 * reasons, and a retrying client needs something it can log.
 */

import { dispatch as markDispatched } from "./orders.mjs";
import { matchVehicle, costEstimate, VEHICLE_CLASSES } from "./fleet.mjs";
import { CORRIDORS, eligibility, bookWindow, roadClass } from "./partners.mjs";
import { openTrack } from "./tracking.mjs";

const HOUR = 3600 * 1000;

/**
 * The partner register and the fleet matcher each name the middle of the range differently
 * ("rigid truck" vs "medium truck"). Bridge them here rather than letting a registered 12 t truck
 * quietly become ineligible for a 9 t load.
 */
const PARTNER_TO_FLEET = { rigid_truck: "medium_truck", drone: "drone_last100" };
const fleetCode = (code) => PARTNER_TO_FLEET[code] ?? code;

function toIso(value, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${field} is an invalid date`);
    return value.toISOString();
  }
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} required`);
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new Error(`${field} is not a date: "${text}"`);
  return new Date(ms).toISOString();
}

/** Stages from which a last-mile dispatch is legitimate. */
export function readyFrom(orderType) {
  return orderType === "dropship" ? ["arrived", "in_transit"] : ["picked", "packed"];
}

function classRank(code) {
  const i = VEHICLE_CLASSES.findIndex((v) => v.code === code);
  return i < 0 ? -1 : i;
}

/**
 * Dispatch one order.
 *
 * @param {object} order       the order record (stage, type, accountId, destination)
 * @param {object} options
 * @param {object[]} options.partners   partner records from the registry
 * @param {number} options.weightKg     all-up weight of the consignment
 * @param {number|null} options.volumeM3  optional volume
 * @param {string} options.lane         corridor key from the partner registry
 * @param {string} options.driverName   the human who will drive
 * @param {string|null} options.driverPhone
 * @param {number|null} options.distanceKm  used only for the planning cost estimate
 * @param {number} options.windowHours  how long the vehicle is reserved
 * @param {string|Date} options.at      dispatch time
 * @param {string|null} options.trackingRef  internal reference; generated when absent
 */
export function dispatchOrder(
  order,
  {
    partners = [],
    weightKg,
    volumeM3 = null,
    lane,
    driverName = null,
    driverPhone = null,
    distanceKm = null,
    windowHours = 48,
    at = new Date(),
    trackingRef = null,
    origin = null,
    destination = null,
    bookedBy = "Amanda",
  } = {},
) {
  const refusals = [];
  const refuse = (code, message) => refusals.push({ code, message });

  if (!order || typeof order !== "object" || !order.id) {
    return { ok: false, refusals: [{ code: "no_order", message: "an order record is required — a dispatch belongs to an order" }] };
  }

  let when;
  try {
    when = toIso(at, "at");
  } catch (err) {
    return { ok: false, refusals: [{ code: "bad_time", message: err.message }] };
  }

  const allowed = readyFrom(order.type);
  if (!allowed.includes(order.stage)) {
    refuse(
      "order_not_ready",
      `order ${order.id} is at "${order.stage}" — a last-mile dispatch can only leave from ${allowed.map((s) => `"${s}"`).join(" or ")}. ` +
        (order.type === "dropship"
          ? "A dropship file dispatches on arrival, not through the warehouse."
          : "Pack the goods and record the packed quantity first."),
    );
  }

  const laneKey = String(lane ?? "").trim().toLowerCase();
  if (!CORRIDORS[laneKey]) {
    refuse("unknown_lane", `unknown lane "${lane ?? ""}" — expected one of ${Object.keys(CORRIDORS).join(", ")}`);
  }

  const weight = Number(weightKg);
  if (!Number.isFinite(weight) || weight <= 0) {
    refuse("bad_weight", `weightKg must be a positive number, got "${weightKg ?? ""}" — a vehicle cannot be matched to an unknown load`);
  }

  if (!driverName || !String(driverName).trim()) {
    refuse("no_driver", "driverName required — the person who drives is part of the record, not an afterthought");
  }

  if (refusals.length > 0) return { ok: false, refusals, order };

  // --- match a vehicle class to the load ---------------------------------
  let match;
  let roadclass;
  try {
    roadclass = roadClass(laneKey);
    match = matchVehicle({ weightKg: weight, volumeM3: volumeM3 === null || volumeM3 === "" ? null : Number(volumeM3), corridor: roadclass });
  } catch (err) {
    return { ok: false, refusals: [{ code: "vehicle_too_small", message: err.message }], order };
  }

  // The matched class is the floor, not a whitelist: any registered vehicle at or above it may take
  // the load, and the partner's own corridor registration plus its papers decide the rest.
  const minRank = classRank(match.vehicle.code);

  // --- choose the smallest eligible partner vehicle ----------------------
  const candidates = [];
  for (const partner of partners ?? []) {
    for (const vehicle of partner.fleet ?? []) {
      const code = fleetCode(vehicle.classCode);
      if (classRank(code) < minRank) continue;
      let verdict;
      try {
        verdict = eligibility(partner, { plate: vehicle.plate, at: when, corridor: laneKey, weightKg: weight });
      } catch (err) {
        candidates.push({ partner, vehicle, eligible: false, blockers: [err.message] });
        continue;
      }
      candidates.push({ partner, vehicle, eligible: verdict.eligible, blockers: verdict.blockers ?? [] });
    }
  }

  const eligible = candidates
    .filter((c) => c.eligible)
    .sort((a, b) => (a.vehicle.capacityKg ?? a.vehicle.payloadKg ?? 0) - (b.vehicle.capacityKg ?? b.vehicle.payloadKg ?? 0));

  if (eligible.length === 0) {
    const reasons = candidates.length === 0
      ? [`no partner has a vehicle in class ${match.vehicle.code} or larger on file`]
      : candidates.map((c) => `${c.partner.ownerName ?? c.partner.id} · ${c.vehicle.plate}: ${c.blockers.join("; ") || "not eligible"}`);
    return {
      ok: false,
      order,
      refusals: [
        {
          code: "no_eligible_partner",
          message: `no partner vehicle can take ${weight} kg on the ${laneKey} lane at ${when}`,
          candidates: reasons,
        },
      ],
      match,
    };
  }

  const chosen = eligible[0];

  // --- book before dispatching ------------------------------------------
  let bookedPartner;
  try {
    bookedPartner = bookWindow(chosen.partner, {
      plate: chosen.vehicle.plate,
      from: when,
      to: new Date(Date.parse(when) + windowHours * HOUR).toISOString(),
      orderId: order.id,
      now: when,
      by: bookedBy,
    });
  } catch (err) {
    return { ok: false, order, match, refusals: [{ code: "booking_refused", message: err.message }] };
  }

  const booking = (bookedPartner.bookings ?? []).find((b) => b.orderId === order.id && b.plate === chosen.vehicle.plate);

  // --- cost, only when a distance was supplied --------------------------
  let estimate = null;
  let estimateNote = "No distance supplied, so no freight estimate is attached to this dispatch.";
  if (distanceKm !== null && distanceKm !== undefined && distanceKm !== "") {
    try {
      estimate = costEstimate(match.vehicle.code, { distanceKm: Number(distanceKm) });
      estimateNote = "Planning estimate from the published rate card, not a carrier quote.";
    } catch (err) {
      estimateNote = `Costing refused: ${err.message}`;
    }
  }

  const ref = String(trackingRef ?? "").trim() || `CLX-${String(order.id).replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase()}`;
  const from = String(origin ?? order.destination?.city ?? order.destination?.port ?? "Origin");
  const to = String(destination ?? order.destination?.address ?? order.destination?.city ?? "Destination");

  const { order: dispatched, job } = markDispatched(order, {
    vehicleId: chosen.vehicle.plate,
    driverName: String(driverName).trim(),
    driverPhone: driverPhone ?? chosen.partner.contact ?? null,
    trackingRef: ref,
    plannedRoute: { lane: laneKey, roadClass: roadclass, distanceKm: distanceKm === null ? null : Number(distanceKm), estimate },
    at: when,
  });

  const track = openTrack({
    shipmentId: ref,
    legs: [
      {
        name: `${from} → ${to}`,
        mode: "road",
        from,
        to,
        departAt: when,
        arriveAt: new Date(Date.parse(when) + windowHours * HOUR).toISOString(),
      },
    ],
    at: when,
  });

  return {
    ok: true,
    order: dispatched,
    job,
    partner: bookedPartner,
    vehicle: chosen.vehicle,
    booking,
    track,
    match,
    estimate,
    estimateNote,
    refusedAlternatives: candidates.filter((c) => !c.eligible).map((c) => ({
      owner: c.partner.ownerName ?? c.partner.id,
      plate: c.vehicle.plate,
      blockers: c.blockers,
    })),
  };
}

/** A one-line, human-readable account of a dispatch result. */
export function dispatchSummary(result) {
  if (!result?.ok) {
    const first = result?.refusals?.[0];
    return first ? `Refused (${first.code}): ${first.message}` : "Refused: no reason recorded";
  }
  const { order, vehicle, partner, job, estimate, estimateNote } = result;
  const cost = estimate ? ` · planning estimate KES ${Number(estimate.freightKes ?? estimate.totalKes ?? 0).toLocaleString("en-KE")}` : ` · ${estimateNote}`;
  return `${order.id} dispatched on ${vehicle.plate} (${partner.ownerName}) · job ${job.id} · ref ${job.trackingRef}${cost}`;
}

/** What still blocks this order from being dispatched, without attempting one. */
export function dispatchReadiness(order) {
  if (!order) return { ready: false, reason: "no order supplied" };
  const allowed = readyFrom(order.type);
  if (!allowed.includes(order.stage)) {
    return { ready: false, reason: `order is at "${order.stage}"; dispatch leaves from ${allowed.join(" or ")}` };
  }
  if (!order.lines?.length) return { ready: false, reason: "order has no lines — nothing to put on a vehicle" };
  if (!order.destination) return { ready: false, reason: "order has no destination — a dispatch needs somewhere to go" };
  return { ready: true, reason: "ready" };
}
