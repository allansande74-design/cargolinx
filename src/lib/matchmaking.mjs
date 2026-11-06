/**
 * Matchmaking — cargo ↔ vehicle dispatch seam for CargoLinx.
 *
 * Pure module, no UI, no database. One call dispatches:
 *   dispatch(order, fleet) → { ok: true, assignment } | { ok: false, refusals: [...] }
 * Refusals are data (code + sentence), never thrown, so a retrying client
 * has something to log and an operator has the reason.
 *
 * Vehicle tiers are floors: a vehicle of a tier carries any load at or above
 * its floor up to its registered capacity. chooseVehicle picks the smallest
 * tier at or above the load weight.
 */

import { advanceQuote, ADVANCE_RULES } from "./advance.mjs";

export const VEHICLE_TIERS = Object.freeze([
  Object.freeze({ tier: "motorbike", floorKg: 0 }),
  Object.freeze({ tier: "tuk_tuk", floorKg: 300 }),
  Object.freeze({ tier: "pickup", floorKg: 1000 }),
  Object.freeze({ tier: "van", floorKg: 2500 }),
  Object.freeze({ tier: "truck", floorKg: 8000 }),
]);

const TIER_RANK = Object.fromEntries(VEHICLE_TIERS.map((t, i) => [t.tier, i]));

/** Smallest tier whose floor is at or below the load (i.e. can carry it by class). */
export function tierFor(weightKg) {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w < 0) throw new Error("weightKg must be a non-negative number");
  let pick = VEHICLE_TIERS[0];
  for (const t of VEHICLE_TIERS) {
    if (w >= t.floorKg) pick = t;
  }
  return pick.tier;
}

/**
 * chooseVehicle(weightKg, fleet) — smallest registered vehicle that fits.
 * fleet: [{ id, plate, tier, capacityKg }]. A vehicle fits when its tier rank
 * is at or above the required tier AND its capacityKg covers the load.
 * @returns {object|null} the vehicle, or null when nothing fits.
 */
export function chooseVehicle(weightKg, fleet = []) {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w < 0) throw new Error("weightKg must be a non-negative number");
  if (!Array.isArray(fleet) || fleet.length === 0) return null;
  const need = TIER_RANK[tierFor(w)];
  const fits = fleet.filter(
    (v) => TIER_RANK[v.tier] >= need && Number(v.capacityKg) >= w
  );
  if (fits.length === 0) return null;
  fits.sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || Number(a.capacityKg) - Number(b.capacityKg)
  );
  return fits[0];
}

/**
 * ORDER_STAGES — the order lifecycle as data. Each stage names what it
 * requires (evidence keys on the order) and what it produces. Dropship
 * orders skip the warehouse stages via `skipFor`.
 */
export const ORDER_STAGES = Object.freeze([
  Object.freeze({ stage: "draft", requires: [], produces: ["id"] }),
  Object.freeze({ stage: "confirmed", requires: [], produces: ["confirmedAt"] }),
  Object.freeze({ stage: "sourcing", requires: ["supplier"], produces: [] }),
  Object.freeze({ stage: "purchased", requires: ["supplier", "poRef", "purchaseValue"], produces: ["poRef"] }),
  Object.freeze({ stage: "freight_booked", requires: ["carrier", "transportRef"], produces: ["transportRef"] }),
  Object.freeze({ stage: "in_transit", requires: ["transportRef"], produces: [] }),
  Object.freeze({ stage: "arrived", requires: [], produces: ["arrivedAt"] }),
  Object.freeze({ stage: "received", requires: ["grnRef", "receivedQty"], produces: ["grnRef"], skipFor: ["dropship"] }),
  Object.freeze({ stage: "picked", requires: ["pickedQty"], produces: [], skipFor: ["dropship"] }),
  Object.freeze({ stage: "packed", requires: ["packedQty"], produces: [], skipFor: ["dropship"] }),
  Object.freeze({ stage: "dispatched", requires: ["vehicleId", "driverName", "trackingRef"], produces: ["trackingRef"] }),
  Object.freeze({ stage: "delivered", requires: ["signedBy"], produces: ["pod"] }),
]);

function stageDef(stage) {
  return ORDER_STAGES.find((s) => s.stage === stage) ?? null;
}

function usesStage(orderType, def) {
  return !(def.skipFor ?? []).includes(orderType);
}

/** Next stage for an order, honouring the dropship warehouse skip. */
export function nextStage(order) {
  const idx = ORDER_STAGES.findIndex((s) => s.stage === order.stage);
  if (idx === -1) throw new Error(`unknown stage ${order.stage}`);
  for (let i = idx + 1; i < ORDER_STAGES.length; i += 1) {
    if (usesStage(order.type ?? "import", ORDER_STAGES[i])) return ORDER_STAGES[i].stage;
  }
  return null;
}

/**
 * canAdvance(order, stage) — blockers for a transition, derived from the table.
 * @returns {{ ok: boolean, missing: string[], skip?: boolean }}
 */
export function canAdvance(order, stage) {
  const def = stageDef(stage);
  if (!def) return { ok: false, missing: [`unknown stage ${stage}`] };
  if (!usesStage(order.type ?? "import", def)) return { ok: true, missing: [], skip: true };
  const missing = def.requires.filter((key) => {
    const v = order[key];
    return v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v));
  });
  return { ok: missing.length === 0, missing };
}

/**
 * dispatch(order, fleet) — the seam. Resolves the load weight to a vehicle
 * floor, picks the smallest registered vehicle at or above it, and returns
 * the assignment. Every refusal is data.
 *
 * order: { id, weightKg, stage?, credit?: { approved, shortfallKes?, reason? } }
 * fleet: [{ id, plate, tier, capacityKg }] (vehicleId/driverName/trackingRef
 *         may be attached by the caller to pre-book a specific vehicle)
 *
 * @returns {{ ok: true, assignment } | { ok: false, refusals }}
 */
export function dispatch(order, fleet = []) {
  const refusals = [];
  const w = Number(order?.weightKg);
  if (!order || !Number.isFinite(w) || w <= 0) {
    return { ok: false, refusals: [{ code: "no_weight", message: "order has no usable weightKg; cannot size a vehicle." }] };
  }
  if (order.credit && order.credit.approved === false) {
    refusals.push({
      code: "over_credit",
      message: `order held: ${order.credit.reason ?? "over credit limit"}${
        Number.isFinite(Number(order.credit.shortfallKes)) ? ` — shortfall KES ${Number(order.credit.shortfallKes).toFixed(2)}` : ""
      }`,
    });
    return { ok: false, refusals };
  }
  if (!Array.isArray(fleet) || fleet.length === 0) {
    return { ok: false, refusals: [{ code: "no_vehicle", message: "no vehicles registered on the fleet board." }] };
  }
  const vehicle = chooseVehicle(w, fleet);
  if (!vehicle) {
    const biggest = Math.max(...fleet.map((v) => Number(v.capacityKg) || 0));
    refusals.push({
      code: "overweight",
      message: `load of ${w}kg exceeds the biggest registered vehicle (${biggest}kg); split the load or register larger capacity.`,
    });
    return { ok: false, refusals };
  }
  return {
    ok: true,
    assignment: {
      orderId: order.id ?? null,
      vehicleId: vehicle.id ?? vehicle.plate,
      plate: vehicle.plate,
      tier: vehicle.tier,
      weightKg: w,
      trackingRef: `CLX-${String(order.id ?? "JOB").slice(0, 8).toUpperCase()}`,
      advanceOffer: Number(order.tripAmountKes) > 0
        ? { maxKes: advanceQuote(order.tripAmountKes), channel: ADVANCE_RULES.channel, pct: ADVANCE_RULES.maxPct }
        : null,
    },
  };
}
