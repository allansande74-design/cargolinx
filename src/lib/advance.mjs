/**
 * Carrier advance — M-Pesa fuel advance against an accepted job, recovered on POD.
 * Pure module, no UI, no database. Refusals are data, never thrown for business rules.
 *
 * Flow: dispatch booked (vehicleId + driverName + trackingRef) -> advance (max 30% of
 * agreed trip amount, one active advance per order, verified carrier only) -> recovery
 * on delivered (signedBy + pod) against the trip payout.
 */

export const ADVANCE_RULES = Object.freeze({
  maxPct: 30,
  channel: "M-PESA",
  advanceAfterStage: "dispatched",
  recoverAtStage: "delivered",
  basis: "agreed trip amount",
  note: "Fuel advance may not exceed 30% of the agreed trip amount, to a verified carrier only, recovered in full on POD.",
});

export function advanceQuote(tripAmountKes, pct = ADVANCE_RULES.maxPct) {
  const amt = Number(tripAmountKes);
  const p = Number(pct);
  if (!Number.isFinite(amt) || amt <= 0) return 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const capped = Math.min(p, ADVANCE_RULES.maxPct);
  return Math.round((amt * capped) / 100 * 100) / 100;
}

export function advanceEligible(order = {}, carrier = {}, askKes = null) {
  const blockers = [];
  const stage = String(order.stage || "");
  if (stage !== "dispatched" && stage !== "in_transit" && stage !== "arrived") {
    blockers.push({ code: "wrong_stage", message: `advance opens at ${ADVANCE_RULES.advanceAfterStage}; order is at ${stage || "unknown"}.` });
  }
  if (!order.vehicleId || !order.trackingRef) {
    blockers.push({ code: "no_dispatch", message: "no booked vehicle/tracking ref; book dispatch before any advance." });
  }
  if (!carrier || carrier.verified !== true) {
    blockers.push({ code: "unverified_carrier", message: "carrier is not verified; verify documents before money leaves." });
  }
  if (order.advance && order.advance.status === "advanced") {
    blockers.push({ code: "already_advanced", message: `order already has an active advance of KES ${order.advance.amountKes}; settle it on POD first.` });
  }
  const trip = Number(order.tripAmountKes);
  if (!Number.isFinite(trip) || trip <= 0) {
    blockers.push({ code: "no_trip_amount", message: "order has no agreed trip amount; agree the rate before advancing." });
  }
  const max = advanceQuote(trip);
  const ask = askKes == null ? max : Number(askKes);
  if (Number.isFinite(ask) && ask > max) {
    blockers.push({ code: "over_cap", message: `ask KES ${ask} exceeds ${ADVANCE_RULES.maxPct}% cap of KES ${max} on trip KES ${trip}.` });
  }
  if (Number.isFinite(ask) && ask <= 0) {
    blockers.push({ code: "bad_amount", message: "advance amount must be above zero." });
  }
  const amount = blockers.length === 0 ? (askKes == null ? max : ask) : 0;
  return { eligible: blockers.length === 0, blockers, amountKes: amount, maxKes: max, channel: ADVANCE_RULES.channel };
}

export function recordAdvance(order = {}, amountKes) {
  const check = advanceEligible(order, order.carrier || { verified: true }, amountKes);
  if (!check.eligible) return { ok: false, refusals: check.blockers };
  const rec = {
    orderId: order.id ?? null,
    amountKes: check.amountKes,
    channel: ADVANCE_RULES.channel,
    status: "advanced",
    at: new Date().toISOString(),
    carrierId: (order.carrier && (order.carrier.id || order.carrier.plate)) || order.vehicleId || null,
  };
  return { ok: true, advance: rec };
}

export function recoverAdvance(order = {}, advance = null) {
  if (!advance || advance.status !== "advanced") {
    return { ok: false, refusals: [{ code: "no_advance", message: "no active advance to recover on this order." }] };
  }
  if (String(order.stage) !== ADVANCE_RULES.recoverAtStage) {
    return { ok: false, refusals: [{ code: "no_pod", message: `recovery opens at ${ADVANCE_RULES.recoverAtStage} with signatory; order is at ${order.stage || "unknown"}.` }] };
  }
  if (!order.signedBy) {
    return { ok: false, refusals: [{ code: "no_signatory", message: "POD needs a named signatory before the advance is recovered." }] };
  }
  const trip = Number(order.tripAmountKes) || 0;
  const payoutKes = Math.round((trip - Number(advance.amountKes)) * 100) / 100;
  return {
    ok: true,
    recovery: {
      orderId: order.id ?? null,
      recoveredKes: Number(advance.amountKes),
      payoutKes,
      channel: ADVANCE_RULES.channel,
      at: new Date().toISOString(),
    },
  };
}
