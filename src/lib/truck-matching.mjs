/**
 * Truck-to-cargo matching: onboarding to booking, delivery and transport payment.
 *
 * One thread, governed at every step by the engines that already own the truth:
 *  - a truck is onboarded through the partner register — born `pending`, its papers are claims
 *    until a named checker verifies each one against a reference, and the owner is approved by a
 *    named checker against a reference document;
 *  - matching asks the register, vehicle by vehicle, whether that plate may serve that lane at
 *    that weight on that date — missing, expired and stale papers are named separately;
 *  - booking is dispatch: the smallest eligible vehicle is booked for a window before the order
 *    moves, so two loads cannot take the same truck;
 *  - delivery closes only on a named proof of delivery;
 *  - the transport invoice is raised on the delivered file and settled through the invoicing
 *    engine — part-payment stays a balance, overpayment is refused;
 *  - a broker fee above 5% of total trip cost is refused in either direction.
 *
 * Pure functions, no UI, no database. Refusals are data wherever an operator needs the reason.
 */
import { registerPartner, verifyDocument, approvePartner, eligibility, documentsForCorridor } from "../../engine/partners.mjs";
import { dispatchOrder } from "../../engine/dispatch.mjs";
import { deliver } from "../../engine/orders.mjs";
import { buildInvoice, recordPayment, nextInvoiceNumber } from "../../engine/invoicing.mjs";
import { brokerFee, brokerFeeWithinCap, BROKER_RULES } from "./onboarding.mjs";

const round = (n) => Math.round(n * 100) / 100;

/** Step 1a — register one truck. The record starts pending: an owner cannot be born trusted. */
export function registerTruck({ ownerName, country = "KE", contact, plate, classCode, capacityKg, corridors, at } = {}) {
  return registerPartner({
    ownerName,
    country,
    contact,
    fleet: [{ plate, classCode, capacityKg, corridors }],
    ...(at ? { at } : {}),
  });
}

/** Step 1b — verify each paper against its reference, naming who checked it. */
export function verifyTruckPapers(partner, { plate, documents = [], verifiedBy, at } = {}) {
  let next = partner;
  for (const doc of documents) {
    next = verifyDocument(next, { plate, ...doc, verifiedBy, ...(at ? { at } : {}) });
  }
  return next;
}

/** Step 1c — approve the owner against a reference document, naming the checker. */
export function approveTruck(partner, { by, reference, at } = {}) {
  return approvePartner(partner, { by, reference, ...(at ? { at } : {}) });
}

/** What this lane demands of this plate: documents required, verified, and still missing. */
export function truckReadiness(partner, { plate, corridor, at = new Date(), weightKg = null } = {}) {
  const vehicle = (partner.fleet ?? []).find((v) => v.plate === String(plate ?? "").trim().toUpperCase());
  const required = documentsForCorridor(corridor);
  const documents = required.map((type) => {
    const record = vehicle?.documents?.[type];
    return { type, status: record?.status ?? "missing", reference: record?.reference ?? null, expiresAt: record?.expiresAt ?? null };
  });
  const verdict = eligibility(partner, { plate, at, corridor, weightKg });
  return {
    owner: partner.ownerName,
    plate: vehicle?.plate ?? null,
    partnerStatus: partner.status,
    documents,
    missing: documents.filter((d) => d.status !== "verified").map((d) => d.type),
    eligible: verdict.eligible,
    blockers: verdict.blockers,
  };
}

/** Step 2 — every truck that may legally take this load on this lane today, smallest first. */
export function availableTrucks(partners = [], { corridor, weightKg, at = new Date() } = {}) {
  const rows = [];
  for (const partner of partners) {
    for (const vehicle of partner.fleet ?? []) {
      const verdict = eligibility(partner, { plate: vehicle.plate, at, corridor, weightKg });
      rows.push({
        owner: partner.ownerName,
        partnerId: partner.id,
        plate: vehicle.plate,
        classCode: vehicle.classCode,
        capacityKg: vehicle.capacityKg,
        eligible: verdict.eligible,
        blockers: verdict.blockers,
      });
    }
  }
  return rows
    .filter((r) => r.eligible)
    .sort((a, b) => a.capacityKg - b.capacityKg);
}

/**
 * Step 3 — book the load onto the smallest eligible truck. Broker commission is capped at 5% of
 * total trip cost in either direction; a fee above the cap refuses the booking before dispatch.
 */
export function bookCargo({ order, partners, weightKg, lane, driverName, driverPhone = null, distanceKm = null, brokerFeeKes = null, tripCostKes = null, at = new Date(), windowHours = 48 } = {}) {
  if (brokerFeeKes !== null && brokerFeeKes !== undefined) {
    const trip = Number(tripCostKes);
    if (!Number.isFinite(trip) || trip <= 0) {
      return { ok: false, refusals: [{ code: "broker_basis_missing", message: "a broker fee was quoted without the total trip cost it is a percentage of" }] };
    }
    if (!brokerFeeWithinCap(trip, brokerFeeKes)) {
      return {
        ok: false,
        refusals: [{
          code: "broker_fee_over_cap",
          message: `broker fee KES ${round(Number(brokerFeeKes))} exceeds the ${BROKER_RULES.capPct}% cap on a trip cost of KES ${round(trip)} (maximum KES ${brokerFee(trip)})`,
        }],
      };
    }
  }
  return dispatchOrder(order, { partners, weightKg, lane, driverName, driverPhone, distanceKm, at, windowHours });
}

/** Step 4 — delivery closes the file on a named proof of delivery, never on a status alone. */
export function completeDelivery({ order, signedBy, signatureRef = null, photoRef = null, at } = {}) {
  if (!order || order.stage !== "dispatched") {
    return { ok: false, refusals: [{ code: "not_dispatched", message: `order ${order?.id ?? "(none)"} is at "${order?.stage ?? "unknown"}" — only a dispatched load can be delivered` }] };
  }
  if (!signedBy || !String(signedBy).trim()) {
    return { ok: false, refusals: [{ code: "pod_missing", message: "proof of delivery must name who signed for the goods" }] };
  }
  return { ok: true, order: deliver(order, { signedBy, signatureRef, photoRef, ...(at ? { at } : {}) }) };
}

/**
 * Step 5a — the transport invoice: the freight for this trip, raised on the order once it is
 * dispatched or delivered. Goods value is the shipper's invoice, not the carrier's — the
 * carrier's document carries the transport charge.
 */
export function transportInvoice({ order, freightKes, lane = null, series = [], at = new Date() } = {}) {
  const freight = Number(freightKes);
  if (!Number.isFinite(freight) || freight <= 0) {
    return { ok: false, reason: `freightKes must be a positive amount, got "${freightKes ?? ""}"` };
  }
  try {
    const invoice = buildInvoice({
      order: {
        id: order.id,
        accountId: order.accountId,
        stage: order.stage,
        lines: [{ description: `Transport${lane ? ` — ${lane}` : ""} (${order.id})`, qty: 1, unitValue: freight }],
      },
      kind: "tax",
      number: nextInvoiceNumber({ series, at: new Date(at) }),
      at: new Date(at),
    });
    return { ok: true, invoice };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Step 5b — settle the transport invoice. Part-payment stays a balance; overpayment is refused. */
export function payTransport(invoice, { amount, method = "mpesa", reference = null, at } = {}) {
  try {
    const next = recordPayment(invoice, { amount, method, reference, ...(at ? { at: new Date(at) } : {}) });
    return { ok: true, invoice: next, balance: next.balance, status: next.status };
  } catch (err) {
    return { ok: false, invoice, balance: invoice?.balance ?? null, reason: err.message };
  }
}

/**
 * The whole journey in one call: onboard → verify → approve → match → book → deliver → invoice
 * → pay. Every step leaves its evidence in the trail; the first refusal stops the journey and
 * says why. Nothing here contacts a customer or a driver — messages stay a separate, approved act.
 */
export function runTruckJourney({
  truck,
  papers = [],
  approval,
  order,
  lane,
  weightKg,
  driverName,
  distanceKm = null,
  brokerFeeKes = null,
  tripCostKes = null,
  freightKes = null,
  signedBy,
  payment = null,
  series = [],
  at = "2026-11-02T08:00:00.000Z",
} = {}) {
  const steps = [];
  const step = (name, ok, evidence) => steps.push({ step: name, ok, evidence });

  let partner;
  try {
    partner = registerTruck({ ...truck, at });
    step("onboard_truck", true, { partnerId: partner.id, status: partner.status, plate: partner.fleet[0]?.plate });
  } catch (err) {
    step("onboard_truck", false, { reason: err.message });
    return { ok: false, status: "onboarding_failed", steps, blockers: [err.message] };
  }

  const plate = partner.fleet[0].plate;
  try {
    partner = verifyTruckPapers(partner, { plate, documents: papers, verifiedBy: approval?.by, at });
    partner = approveTruck(partner, { ...approval, at });
    step("verify_and_approve", partner.status === "verified", { status: partner.status, papersVerified: papers.length });
  } catch (err) {
    step("verify_and_approve", false, { reason: err.message });
    return { ok: false, status: "verification_failed", steps, blockers: [err.message], partner };
  }

  const ready = truckReadiness(partner, { plate, corridor: lane, at, weightKg });
  step("readiness", ready.eligible, ready);
  if (!ready.eligible) return { ok: false, status: "truck_not_ready", steps, blockers: ready.blockers, partner };

  const matches = availableTrucks([partner], { corridor: lane, weightKg, at });
  step("match", matches.length > 0, { matched: matches.map((m) => m.plate) });

  const booking = bookCargo({ order, partners: [partner], weightKg, lane, driverName, distanceKm, brokerFeeKes, tripCostKes, at });
  step("book_and_dispatch", booking.ok, booking.ok
    ? { plate: booking.vehicle.plate, trackingRef: booking.job.trackingRef, estimate: booking.estimate }
    : { refusals: booking.refusals });
  if (!booking.ok) return { ok: false, status: "booking_refused", steps, blockers: booking.refusals.map((r) => r.message), partner };

  const delivery = completeDelivery({ order: booking.order, signedBy, at });
  step("deliver", delivery.ok, delivery.ok ? { pod: delivery.order.pod } : { refusals: delivery.refusals });
  if (!delivery.ok) return { ok: false, status: "delivery_refused", steps, blockers: delivery.refusals.map((r) => r.message), partner, booking };

  const invoiced = transportInvoice({ order: delivery.order, freightKes: freightKes ?? booking.estimate?.freightKes, lane, series, at });
  step("transport_invoice", invoiced.ok, invoiced.ok ? { number: invoiced.invoice.number, total: invoiced.invoice.total } : { reason: invoiced.reason });
  if (!invoiced.ok) return { ok: false, status: "invoice_failed", steps, blockers: [invoiced.reason], partner, booking, order: delivery.order };

  const paid = payment ? payTransport(invoiced.invoice, { ...payment, at }) : { ok: false, invoice: invoiced.invoice, balance: invoiced.invoice.balance, reason: "payment_not_supplied" };
  step("pay_transport", paid.ok && paid.balance === 0, { balance: paid.balance, reason: paid.reason ?? null });

  if (!payment) {
    return { ok: false, status: "payment_pending", steps, blockers: ["payment_incomplete"], partner, booking, order: delivery.order, invoice: invoiced.invoice };
  }
  if (!paid.ok || paid.balance > 0) {
    return { ok: false, status: "payment_pending", steps, blockers: [paid.reason ?? "payment_incomplete"], partner, booking, order: delivery.order, invoice: paid.invoice, paymentResult: paid };
  }

  return {
    ok: true,
    status: "delivered_and_paid",
    steps,
    blockers: [],
    partner: booking.partner,
    booking,
    order: delivery.order,
    invoice: paid.invoice,
    paymentResult: paid,
  };
}
