/**
 * Warehouse counting, write-off and adjustment.
 *
 * A stock figure is a claim until someone counts it. This module records the count against what
 * the lot says it holds, moves the lot by the difference, and demands a reason for every unit that
 * leaves without a customer. It never deletes a unit quietly: a short count is a write-off, an over
 * count is an adjustment, and both carry who did it and when.
 *
 * Every function is pure — the lot handed in is not modified, the returned lot is a new object.
 */

const round = (n) => Math.round(n * 100) / 100;

/** The only reasons a unit may leave stock without a sale. Anything else is unexplained loss. */
export const WRITE_OFF_REASONS = ["damaged", "expired", "lost", "sample", "theft"];

const label = (lot) => lot?.lot ?? lot?.id ?? "unknown lot";
const atIso = (at) => new Date(at ?? Date.now()).toISOString();

/** A blank figure is missing, not zero — Number(null) and Number("") would otherwise pass as 0. */
const numeric = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/**
 * Record a physical count of a bin.
 *
 * The variance is the whole point: zero is a match, positive means more on the shelf than the
 * system believed, negative means stock the system cannot account for. countedBy travels with the
 * count because a count nobody signed for is a rumour.
 */
export function startCount({ sku, bin, lot = null, expectedQty, countedQty, countedBy = null, at = new Date() }) {
  if (!sku) throw new Error("a count must name the sku it is counting");
  if (!bin) throw new Error("a count must name the bin it was taken in");
  if (!Number.isFinite(numeric(expectedQty))) throw new Error("expectedQty must be a number — a count without an expected figure proves nothing");
  if (!Number.isFinite(numeric(countedQty))) throw new Error("countedQty must be a number — an uncounted bin is not a count");

  const expected = round(numeric(expectedQty));
  const counted = round(numeric(countedQty));
  const variance = round(counted - expected);

  return {
    id: `cnt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sku,
    bin,
    lot,
    expectedQty: expected,
    countedQty: counted,
    variance,
    status: variance === 0 ? "match" : variance > 0 ? "over" : "short",
    countedBy,
    at: atIso(at),
  };
}

/**
 * Apply a count to its lot.
 *
 * A short count removes the missing units as a "count short" write-off; an over count adds them as
 * an adjustment. A count may only be applied once — the lot keeps the ids it has already taken, so
 * replaying the same count does not move stock twice. A short that would take the lot below zero is
 * refused rather than clamped: the count is wrong somewhere, and the lot says so.
 */
export function applyCount(lot, count) {
  if (!lot) throw new Error("a count must be applied to a lot");
  if (!count?.id) throw new Error("a count must carry an id — an anonymous count cannot be proven applied once");
  if (count.appliedAt) throw new Error(`count ${count.id} was already applied at ${count.appliedAt}`);
  const applied = lot.appliedCounts ?? [];
  if (applied.includes(count.id)) throw new Error(`count ${count.id} has already been applied to lot ${label(lot)}`);
  if (count.sku && lot.sku && count.sku !== lot.sku) {
    throw new Error(`count ${count.id} is for ${count.sku}, not lot ${label(lot)} (${lot.sku})`);
  }

  const variance = Number.isFinite(Number(count.variance))
    ? round(Number(count.variance))
    : round(Number(count.countedQty) - Number(count.expectedQty));
  if (!Number.isFinite(variance)) throw new Error(`count ${count.id} has neither a variance nor quantities to derive one`);

  const at = atIso(count.at);
  const by = count.countedBy ?? null;
  const remaining = round(Number(lot.remaining ?? 0));
  const marked = { ...count, appliedAt: atIso(new Date()) };

  if (variance === 0) {
    return { lot: { ...lot, appliedCounts: [...applied, count.id] }, count: marked, entry: null, variance };
  }

  if (variance > 0) {
    const entry = { qty: variance, reason: "count over", at, by, countId: count.id };
    return {
      lot: {
        ...lot,
        remaining: round(remaining + variance),
        appliedCounts: [...applied, count.id],
        adjustments: [...(lot.adjustments ?? []), entry],
      },
      count: marked,
      entry,
      variance,
    };
  }

  const short = round(-variance);
  if (round(remaining - short) < 0) {
    throw new Error(`count ${count.id} would push lot ${label(lot)} below zero: remaining ${remaining}, short ${short}`);
  }

  const entry = { qty: short, reason: "count short", at, by, countId: count.id };
  return {
    lot: {
      ...lot,
      remaining: round(remaining - short),
      appliedCounts: [...applied, count.id],
      writeOffs: [...(lot.writeOffs ?? []), entry],
    },
    count: marked,
    entry,
    variance,
  };
}

/**
 * Remove damaged, expired, lost, sampled or stolen stock.
 *
 * A unit may leave for one of five reasons and no others; "adjustment" is not a reason. Writing off
 * more than the lot holds is refused, not capped, because that is a count problem disguised as a
 * write-off.
 */
export function writeOff(lot, { qty, reason, by = null, at = new Date() } = {}) {
  if (!lot) throw new Error("a write-off needs the lot it comes out of");
  const amt = round(Number(qty));
  if (!(amt > 0)) throw new Error("write-off quantity must be positive");
  if (!reason) throw new Error(`a write-off must state a reason — one of ${WRITE_OFF_REASONS.join(", ")}`);
  if (!WRITE_OFF_REASONS.includes(reason)) {
    throw new Error(`write-off reason "${reason}" is not allowed — use one of ${WRITE_OFF_REASONS.join(", ")}`);
  }
  const remaining = round(Number(lot.remaining ?? 0));
  if (amt > remaining) throw new Error(`cannot write off ${amt} from lot ${label(lot)} — only ${remaining} remaining`);

  const entry = { qty: amt, reason, at: atIso(at), by };
  return {
    lot: { ...lot, remaining: round(remaining - amt), writeOffs: [...(lot.writeOffs ?? []), entry] },
    entry,
  };
}

/**
 * What shrinkage cost, by reason, over a period.
 *
 * Value is cost value, not selling price: the loss is what the stock was bought for. The largest
 * single loss is named with its lot because that is the entry someone has to explain.
 * The period is inclusive of both ends; either end may be omitted.
 */
export function shrinkageReport(lots, { from = null, to = null } = {}) {
  const lo = from ? new Date(from).getTime() : -Infinity;
  const hi = to ? new Date(to).getTime() : Infinity;

  const byReason = {};
  for (const reason of [...WRITE_OFF_REASONS, "count short"]) byReason[reason] = { qty: 0, value: 0 };

  let totalQty = 0;
  let valueLost = 0;
  let entries = 0;
  let largest = null;

  for (const lot of Array.isArray(lots) ? lots : []) {
    const unitCost = Number(lot.unitCost ?? 0);
    for (const w of lot.writeOffs ?? []) {
      const t = new Date(w.at).getTime();
      if (!(t >= lo && t <= hi)) continue;
      const qty = round(Number(w.qty));
      const value = round(qty * unitCost);

      byReason[w.reason] ??= { qty: 0, value: 0 };
      byReason[w.reason].qty = round(byReason[w.reason].qty + qty);
      byReason[w.reason].value = round(byReason[w.reason].value + value);

      totalQty = round(totalQty + qty);
      valueLost = round(valueLost + value);
      entries += 1;

      if (!largest || value > largest.value || (value === largest.value && qty > largest.qty)) {
        largest = {
          lot: lot.lot ?? null,
          lotId: lot.id ?? null,
          sku: lot.sku ?? null,
          bin: lot.bin ?? null,
          reason: w.reason,
          qty,
          unitCost,
          value,
          at: w.at,
        };
      }
    }
  }

  return {
    from: from ? atIso(from) : null,
    to: to ? atIso(to) : null,
    byReason,
    totalQty,
    valueLost,
    entries,
    largest,
  };
}

/**
 * Move a lot's remaining stock to another bin.
 *
 * The bin on the lot changes and the movement is written into the lot's history — from, to, how
 * much, who, when. A transfer to the bin the lot already sits in is refused: it is not a movement,
 * and recording it would make the history lie about how often the goods were handled.
 */
export function binTransfer(lot, { toBin, by = null, at = new Date() } = {}) {
  if (!lot) throw new Error("a transfer needs the lot it moves");
  if (!toBin) throw new Error("a transfer must name the bin it moves to");
  if (String(toBin) === String(lot.bin)) {
    throw new Error(`lot ${label(lot)} is already in bin ${lot.bin} — a transfer to the same bin is not a movement`);
  }

  const qty = round(Number(lot.remaining ?? 0));
  const movement = { type: "bin transfer", from: lot.bin, to: toBin, qty, at: atIso(at), by };
  return {
    lot: { ...lot, bin: toBin, movements: [...(lot.movements ?? []), movement] },
    movement,
  };
}
