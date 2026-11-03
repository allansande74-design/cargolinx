/**
 * Benchmark: planning a day's loads, measured against the best plan that exists.
 *
 * Small instances are solved exactly — every assignment of distinct vehicles to loads that breaks no
 * rule — and the planner's cost is compared to that optimum. Then the same rules at scale, for
 * speed.
 *
 * Run: node scripts/plan-bench.mjs
 */
import { planDispatch, placementCost, fits } from "../src/lib/match-dispatch.mjs";

const rnd = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
const pick = (a) => a[Math.floor(rnd() * a.length)];
const CAP = { motorbike: 60, tuk_tuk: 500, pickup: 1200, van: 3000, truck: 28000 };
const LANES = ["nairobi_last_mile", "nairobi_kampala", "mombasa_nairobi", "nairobi_kisumu"];

function makeFleet(n) {
  return Array.from({ length: n }, (_, i) => {
    const tier = pick(["pickup", "van", "truck"]);
    return {
      id: `veh-${i}`, plate: `KD${String.fromCharCode(65 + (i % 26))} ${100 + i}A`, tier, capacityKg: CAP[tier],
      corridors: [pick(LANES), pick(LANES)], costPerKm: 40 + Math.round(rnd() * 300), refrigerated: rnd() > 0.8,
    };
  });
}

function makeLoads(n, fleet) {
  return Array.from({ length: n }, (_, i) => ({
    id: `LD-${1000 + i}`,
    weightKg: Math.round(50 + rnd() * 24000),
    corridor: pick(fleet.flatMap((v) => v.corridors ?? [])),
    dueAt: new Date(Date.now() + Math.round(rnd() * 72) * 3600_000).toISOString(),
    needsRefrigeration: rnd() > 0.9,
  }));
}

function* perms(arr, k, prefix = [], used = new Set()) {
  if (prefix.length === k) { yield prefix; return; }
  for (const x of arr) { if (used.has(x)) continue; used.add(x); yield* perms(arr, k, [...prefix, x], used); used.delete(x); }
}

/** Cheapest total cost over all one-load-per-vehicle assignments that break no rule. */
function exactPlan(loads, fleet) {
  let best = Infinity;
  for (const veh of perms(fleet, loads.length)) {
    let total = 0, ok = true;
    for (let i = 0; i < loads.length; i++) {
      if (!fits(veh[i], loads[i])) { ok = false; break; }
      total += placementCost(veh[i], loads[i]);
    }
    if (ok && total < best) best = total;
  }
  return best === Infinity ? null : best;
}

const strip = (plan) => ({ ...plan, assignments: plan.assignments.map(({ plannedAt, ...rest }) => rest) });
const planCost = (plan, loads, fleet) => plan.assignments.reduce((a, x) => {
  const l = loads.find((y) => y.id === x.loadId);
  const v = fleet.find((f) => f.id === x.vehicleId);
  return a + placementCost(v, l);
}, 0);

/** An instance that certainly admits a plan: every load gets a vehicle that fits, plus distractors. */
function feasibleInstance(size, distractors = 2) {
  const loads = [], fleet = [];
  for (let i = 0; i < size; i++) {
    const corridor = LANES[i % LANES.length];
    const needsCold = i % 4 === 0;
    const kg = Math.round(100 + rnd() * 8000);
    loads.push({ id: `F-${i}`, weightKg: kg, corridor, needsRefrigeration: needsCold });
    const tier = kg <= 1200 ? "pickup" : kg <= 3000 ? "van" : "truck";
    fleet.push({ id: `f-${i}`, plate: `KDF ${i}A`, tier, capacityKg: Math.max(CAP[tier], kg + 100), corridors: [corridor], costPerKm: 60 + Math.round(rnd() * 240), refrigerated: needsCold });
  }
  for (let d = 0; d < distractors; d++) {
    fleet.push({ id: `d-${d}`, plate: `KDD ${d}A`, tier: "van", capacityKg: 3000, corridors: [pick(LANES)], costPerKm: 50, refrigerated: false });
  }
  return { loads, fleet };
}

console.log("cost against the exact optimum (small instances, all constraints on)");
const quality = [];
for (const size of [4, 5]) {
  let trials = 0, optimal = 0, gapSum = 0, unplaced = 0;
  for (let t = 0; t < 30; t++) {
    const { loads, fleet } = feasibleInstance(size, size > 4 ? 1 : 2);
    const best = exactPlan(loads, fleet);
    const plan = planDispatch(loads, fleet);
    if (best == null) continue;           // no feasible plan exists: nothing to compare against
    trials++;
    unplaced += plan.unassigned.length;
    if (plan.assignments.length < size) { gapSum += 100; continue; }   // left a load on the floor
    const got = planCost(plan, loads, fleet);
    if (Math.abs(got - best) < 1e-9) optimal++;
    else gapSum += ((got - best) / best) * 100;
  }
  quality.push({ size, trials, optimal, unplacedLoads: unplaced, meanGapPct: +(gapSum / trials).toFixed(1) });
  console.log(`  ${size} loads: exact optimum matched on ${optimal}/${trials}, mean cost gap ${(gapSum / trials).toFixed(1)}%, loads left unplaced ${unplaced}`);
}

console.log("scale");
const fleet = makeFleet(450);
const loads = makeLoads(400, fleet);
const t0 = process.hrtime.bigint();
const plan = planDispatch(loads, fleet);
const msTotal = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`  400 loads / 450 vehicles: ${msTotal.toFixed(1)}ms total, ${Math.round(400 / (msTotal / 1000)).toLocaleString()}/s,` +
  ` placed ${plan.summary.placed}, fill ${plan.summary.fillRatePct}%, utilisation ${plan.summary.utilisationPct}%`);
const bigFleet = makeFleet(5200);
const big = makeLoads(5000, bigFleet);
const t1 = process.hrtime.bigint();
const bigPlan = planDispatch(big, bigFleet);
const msBig = Number(process.hrtime.bigint() - t1) / 1e6;
console.log(`  5000 loads / 5200 vehicles: ${msBig.toFixed(0)}ms total, ${Math.round(5000 / (msBig / 1000)).toLocaleString()}/s, fill ${bigPlan.summary.fillRatePct}%`);

const twice = planDispatch([...loads].reverse(), fleet);
console.log(`  determinism: ${JSON.stringify(strip(twice).assignments) === JSON.stringify(strip(plan).assignments) ? "identical plan from reversed input" : "PLAN CHANGED"}`);

const doubleBooked = new Set(plan.assignments.map((a) => a.vehicleId)).size !== plan.assignments.length;
console.log(`  double bookings: ${doubleBooked ? "FOUND" : "none"}`);

console.log("\nJSON:", JSON.stringify({ ranAt: new Date().toISOString(), quality, scale: { loads: 5000, fleet: 400, ms: +msTotal.toFixed(1), ...plan.summary, doubleBooked } }));
