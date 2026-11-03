/**
 * Planning a day's loads onto a fleet — the part a dispatcher actually does.
 *
 * The single-load matcher (`chooseVehicle` in matchmaking.mjs) answers "what can carry this?".
 * This module answers the harder question: given many loads and one fleet, what is the best plan
 * that breaks no rule — lane, time window, equipment, capacity — and without booking a vehicle twice.
 *
 * Rules are data, not promises:
 *   vehicle: { id, plate, tier, capacityKg, corridors?: string[], availableFrom?, availableTo?,
 *              refrigerated?: boolean, costPerKm?: number }
 *   load:    { id, weightKg, corridor?, readyAt?, dueAt?, needsRefrigeration?, valueKes? }
 *
 * Every refusal carries a code and a sentence, because a dispatcher needs to know why a load sat
 * on the floor. Nothing is thrown for a business reason.
 *
 * Deterministic by construction: loads are planned in a fixed order (due date, then id) and ties on
 * cost are broken by vehicle id, so the same inputs always produce the same plan.
 */

export const TIER_RANK = { motorbike: 0, tuk_tuk: 1, pickup: 2, van: 3, truck: 4 };

/** Capacity a vehicle of each tier is assumed to have when the fleet record omits it. */
export const TIER_CAPACITY_KG = { motorbike: 60, tuk_tuk: 500, pickup: 1200, van: 3000, truck: 28000 };

const ms = (v) => (v == null ? null : new Date(v).getTime());

function windowOk(vehicle, load) {
  const ready = ms(load.readyAt);
  const due = ms(load.dueAt);
  const from = ms(vehicle.availableFrom);
  const to = ms(vehicle.availableTo);
  if (ready != null && to != null && to < ready) return "vehicle is off the road before the load is ready";
  if (due != null && from != null && from > due) return "vehicle is not free until after the load is due";
  return null;
}

/** Every reason this vehicle cannot take this load, in the order a dispatcher would check them. */
export function blockers(vehicle, load) {
  const out = [];
  const w = Number(load.weightKg);
  if (!Number.isFinite(w) || w <= 0) return ["load has no usable weight"];

  const cap = Number(vehicle.capacityKg ?? TIER_CAPACITY_KG[vehicle.tier] ?? 0);
  const needRank = TIER_RANK[vehicle.tier] ?? -1;
  if (needRank < 0) out.push(`unknown vehicle tier "${vehicle.tier}"`);
  if (cap < w) out.push(`capacity ${cap}kg is below the load's ${w}kg`);

  if (Array.isArray(vehicle.corridors) && vehicle.corridors.length > 0 && load.corridor && !vehicle.corridors.includes(load.corridor)) {
    out.push(`not cleared for the ${load.corridor} lane`);
  }
  if (load.needsRefrigeration && !vehicle.refrigerated) out.push("load needs refrigeration; vehicle is not refrigerated");

  const tw = windowOk(vehicle, load);
  if (tw) out.push(tw);
  return out;
}

export const fits = (vehicle, load) => blockers(vehicle, load).length === 0;

/** Cost of putting this load on this vehicle; capacity left empty is charged at the same rate. */
export function placementCost(vehicle, load) {
  const rate = Number(vehicle.costPerKm ?? 0);
  const cap = Number(vehicle.capacityKg ?? TIER_CAPACITY_KG[vehicle.tier] ?? 0);
  const perKg = Number(load.weightKg) > 0 ? rate * (cap / Math.max(1, Number(load.weightKg))) : rate;
  return Number.isFinite(perKg) ? perKg : 0;
}

/** Rank the fleet for one load: feasible first, then cheapest, then smallest, then id. */
export function rankVehicles(load, fleet = []) {
  const scored = fleet.map((v) => ({ vehicle: v, reasons: blockers(v, load) }))
    .filter((x) => x.reasons.length === 0)
    .map((x) => ({
      ...x,
      cost: placementCost(x.vehicle, load),
      cap: Number(x.vehicle.capacityKg ?? TIER_CAPACITY_KG[x.vehicle.tier] ?? 0),
    }));
  scored.sort((a, b) => a.cost - b.cost || a.cap - b.cap || String(a.vehicle.id).localeCompare(String(b.vehicle.id)));
  return scored;
}

/** The order loads are planned in: most urgent first, then largest, then id. */
export function planOrder(loads = []) {
  return [...loads].sort((a, b) => {
    const ad = ms(a.dueAt) ?? Number.MAX_SAFE_INTEGER;
    const bd = ms(b.dueAt) ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    const aw = Number(a.weightKg) || 0;
    const bw = Number(b.weightKg) || 0;
    if (aw !== bw) return bw - aw;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Index the fleet so a plan does not rescan every vehicle for every load.
 *
 * Vehicles cleared for a lane are indexed by that lane; vehicles with no lane restriction are held
 * as wildcards that can serve anything. Each list is sorted by capacity, so "who can lift this much"
 * is a binary search rather than a scan.
 */
export function buildIndex(fleet = []) {
  const byLane = new Map();
  const wildcard = [];
  for (const v of fleet) {
    const cap = Number(v.capacityKg ?? TIER_CAPACITY_KG[v.tier] ?? 0);
    const row = { ...v, capacityKg: cap };
    const lanes = Array.isArray(v.corridors) && v.corridors.length > 0 ? v.corridors : null;
    if (!lanes) { wildcard.push(row); continue; }
    for (const lane of lanes) {
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(row);
    }
  }
  const byCap = (a, b) => a.capacityKg - b.capacityKg;
  wildcard.sort(byCap);
  for (const list of byLane.values()) list.sort(byCap);
  return { byLane, wildcard };
}

const firstAtLeast = (list, kg) => {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].capacityKg < kg) lo = mid + 1; else hi = mid; }
  return lo;
};

/**
 * How many of the smallest fitting vehicles are compared for a load. Cost rises with capacity, so
 * the cheapest vehicle that fits is almost always among the smallest that fit: the window keeps a
 * plan over thousands of vehicles linear, and the benchmark measures what the window gives up.
 */
export const SEARCH_WINDOW = 64;

/**
 * Candidate vehicles for one load, from the index: the smallest that fit and are still free, up to a
 * bounded number. Vehicles already committed to another load are skipped rather than counted, so a
 * busy lane keeps offering the next free vehicle instead of insisting on the ones already gone.
 */
export function candidates(index, load, window = SEARCH_WINDOW, taken = null) {
  const kg = Number(load.weightKg) || 0;
  const lane = load.corridor ? (index.byLane.get(load.corridor) ?? []) : [];
  const out = [];
  for (const list of [lane, index.wildcard]) {
    let found = 0;
    for (let i = firstAtLeast(list, kg); i < list.length && found < window; i++) {
      const key = list[i].id ?? list[i].plate;
      if (taken && taken.has(key)) continue;
      out.push(list[i]);
      found++;
    }
  }
  return out;
}

/**
 * Plan every load once. A vehicle carries at most one load in this planning horizon — the honest
 * simplification for a day plan that does not yet model drop sequences.
 */
export function planDispatch(loads = [], fleet = [], { at = new Date() } = {}) {
  const index = buildIndex(fleet);
  const maxCap = fleet.reduce((a, v) => Math.max(a, Number(v.capacityKg ?? TIER_CAPACITY_KG[v.tier] ?? 0)), 0);
  const taken = new Set();
  const assignments = [];
  const unassigned = [];

  for (const load of planOrder(loads)) {
    const pool = candidates(index, load, SEARCH_WINDOW, taken);
    let best = null;
    for (const v of pool) {
      const key = v.id ?? v.plate;
      if (taken.has(key)) continue;
      if (blockers(v, load).length > 0) continue;
      const cost = placementCost(v, load);
      if (best === null || cost < best.cost || (cost === best.cost && (v.capacityKg - best.vehicle.capacityKg) < 0) ||
          (cost === best.cost && v.capacityKg === best.vehicle.capacityKg && String(key) < String(best.vehicle.id ?? best.vehicle.plate))) {
        best = { vehicle: v, cost };
      }
    }
    if (!best) {
      const w = Number(load.weightKg) || 0;
      // Detail is sampled, never a full sweep: a refusal must be explainable, not exhaustive.
      const sample = fleet.slice(0, 20).map((v) => ({ id: v.id ?? v.plate, reasons: blockers(v, load) }))
        .filter((e) => e.reasons.length);
      unassigned.push({
        loadId: load.id ?? null,
        weightKg: w || null,
        code: fleet.length === 0 ? "no_vehicle" : w <= maxCap ? "no_feasible_vehicle" : "no_capacity",
        message: fleet.length === 0 ? "no vehicles registered on the fleet board"
          : sample.map((e) => `${e.id}: ${e.reasons.join("; ")}`).join(" | ") || `nothing in the first ${Math.min(20, fleet.length)} vehicles clears this load`,
      });
      continue;
    }
    taken.add(best.vehicle.id ?? best.vehicle.plate);
    assignments.push({
      loadId: load.id ?? null,
      vehicleId: best.vehicle.id ?? best.vehicle.plate,
      plate: best.vehicle.plate ?? null,
      tier: best.vehicle.tier ?? null,
      weightKg: Number(load.weightKg),
      capacityKg: best.vehicle.capacityKg,
      utilisation: Math.round((Number(load.weightKg) / Math.max(1, best.vehicle.capacityKg)) * 1000) / 10,
      costIndex: Math.round(best.cost * 1000) / 1000,
      plannedAt: new Date(at).toISOString(),
    });
  }
  const placedKg = assignments.reduce((a, x) => a + x.weightKg, 0);
  const capacityKg = assignments.reduce((a, x) => a + x.capacityKg, 0);
  return {
    assignments,
    unassigned,
    summary: {
      loads: loads.length,
      placed: assignments.length,
      unplaced: unassigned.length,
      fillRatePct: loads.length ? Math.round((assignments.length / loads.length) * 1000) / 10 : 0,
      placedKg,
      carriedCapacityKg: capacityKg,
      utilisationPct: capacityKg ? Math.round((placedKg / capacityKg) * 1000) / 10 : 0,
    },
  };
}

/** What to tell a client whose load is heavier than anything on the board. */
export function splitSuggestion(load, fleet = []) {
  const w = Number(load?.weightKg) || 0;
  const biggest = fleet.reduce((a, v) => Math.max(a, Number(v.capacityKg ?? TIER_CAPACITY_KG[v.tier] ?? 0)), 0);
  if (!w || !biggest || w <= biggest) return null;
  const parts = Math.ceil(w / biggest);
  const base = Math.floor(w / parts);
  const remainder = w - base * (parts - 1);
  return { parts, weightsKg: [...Array(parts - 1).fill(base), remainder], biggestVehicleKg: biggest };
}
