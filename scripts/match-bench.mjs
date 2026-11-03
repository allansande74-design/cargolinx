/**
 * Benchmark: the cargo-to-vehicle matcher, end to end.
 *
 * Measures what a dispatcher feels — how fast a load is placed, whether the placement is valid,
 * whether the same load always gets the same answer — and then asks the harder question: how far
 * from the best possible placement is a greedy one-vehicle-at-a-time choice? For that, small
 * instances are solved exactly (every permutation) and the greedy result is compared to the optimum.
 *
 * Run: node scripts/match-bench.mjs
 */
import { dispatch, chooseVehicle, tierFor, VEHICLE_TIERS } from "../src/lib/matchmaking.mjs";

const rnd = (() => { let s = 42; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
const pick = (a) => a[Math.floor(rnd() * a.length)];

const TIERS = ["motorbike", "tuk_tuk", "pickup", "van", "truck"];
const CAP = { motorbike: 60, tuk_tuk: 500, pickup: 1200, van: 3000, truck: 28000 };

function fleet(n) {
  return Array.from({ length: n }, (_, i) => {
    const tier = pick(TIERS);
    return { id: `veh-${i}`, plate: `KD${String.fromCharCode(65 + (i % 26))} ${100 + i}${String.fromCharCode(65 + (i % 26))}`, tier, capacityKg: CAP[tier] };
  });
}

function loads(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `LD-${1000 + i}`, weightKg: Math.round(1 + rnd() * 26000) }));
}

function pct(arr, p) { return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; }

function run(nLoads, nFleet) {
  const f = fleet(nFleet);
  const ls = loads(nLoads);
  const times = [];
  let ok = 0, refused = 0, invalid = 0, heavierThanTruck = 0;
  for (const l of ls) {
    const t0 = process.hrtime.bigint();
    const r = dispatch(l, f);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (r.ok) {
      ok++;
      const v = f.find((x) => (x.id ?? x.plate) === r.assignment.vehicleId);
      if (!v || Number(v.capacityKg) < l.weightKg) invalid++;
    } else {
      refused++;
      if (r.refusals.some((x) => x.code === "overweight")) heavierThanTruck++;
    }
  }
  times.sort((a, b) => a - b);
  return { loads: nLoads, fleet: nFleet, placed: ok, refused, invalidPlacements: invalid, overCapacityRefusals: heavierThanTruck,
           p50ms: +pct(times, 0.5).toFixed(4), p95ms: +pct(times, 0.95).toFixed(4), p99ms: +pct(times, 0.99).toFixed(4),
           perSecond: Math.round(nLoads / (times.reduce((a, b) => a + b, 0) / 1000)) };
}

/** Cost of a placement: capacity left empty, in kg — what a dispatcher wastes by over-sizing. */
function waste(load, vehicle) { return Math.max(0, Number(vehicle.capacityKg) - Number(load.weightKg)); }

function greedyTotal(loadsList, fleetList) {
  const used = new Set();
  let total = 0, placed = 0;
  for (const l of loadsList) {
    const free = fleetList.filter((v) => !used.has(v.id));
    const v = chooseVehicle(l.weightKg, free);
    if (!v) continue;
    used.add(v.id);
    total += waste(l, v);
    placed++;
  }
  return { total, placed };
}

function* permutations(arr, k, prefix = [], used = new Set()) {
  if (prefix.length === k) { yield prefix; return; }
  for (const x of arr) { if (used.has(x)) continue; used.add(x); yield* permutations(arr, k, [...prefix, x], used); used.delete(x); }
}

function optimalTotal(loadsList, fleetList) {
  let best = Infinity;
  for (const order of permutations(loadsList, Math.min(loadsList.length, fleetList.length))) {
    let total = 0, ok = true;
    order.forEach((l, i) => {
      const v = fleetList[i];
      if (Number(v.capacityKg) < Number(l.weightKg)) ok = false;
      total += waste(l, v);
    });
    if (ok && total < best) best = total;
  }
  return best === Infinity ? null : best;
}

const results = [];
console.log("throughput and validity");
for (const [n, f] of [[1000, 20], [10000, 200], [50000, 500]]) {
  const r = run(n, f);
  results.push(r);
  console.log(`  ${String(r.loads).padStart(6)} loads / ${String(r.fleet).padStart(3)} vehicles: placed ${r.placed}, refused ${r.refused}` +
    `, invalid ${r.invalidPlacements}, p50 ${r.p50ms}ms, p95 ${r.p95ms}ms, ${r.perSecond}/s`);
}

// Determinism: the same load and the same fleet must give the same answer, every time.
const dFleet = fleet(10);
const dLoad = { id: "LD-DET", weightKg: 4321 };
const answers = new Set(Array.from({ length: 200 }, () => JSON.stringify(dispatch(dLoad, dFleet))));
console.log(`determinism: ${answers.size} distinct answer(s) over 200 identical calls`);

// Refusals must be data, not throws.
const refusals = [
  dispatch({ id: "x", weightKg: 0 }, dFleet),
  dispatch({ id: "y", weightKg: 100 }, []),
  dispatch({ id: "z", weightKg: 12000 }, [{ id: "v1", plate: "KDX 1A", tier: "truck", capacityKg: 8000 }]),
  dispatch({ id: "c", weightKg: 500, credit: { approved: false, reason: "over credit limit", shortfallKes: 41000 } }, dFleet),
].map((r) => r.ok ? "PLACED" : r.refusals[0].code);
console.log("refusals:", refusals.join(", "));

// How far from the best possible placement is a greedy one?
console.log("quality against an exact solution (small instances)");
const quality = [];
for (const size of [5, 6]) {
  let greedyWins = 0, equal = 0, worse = 0, gapSum = 0, trials = 0;
  for (let t = 0; t < 40; t++) {
    const ls = Array.from({ length: size }, (_, i) => ({ id: `S-${i}`, weightKg: Math.round(200 + rnd() * 4500) }));
    const fs = Array.from({ length: size }, (_, i) => {
      const tier = pick(["pickup", "van", "truck"]);
      return { id: `sv-${i}`, plate: `KDS ${i}A`, tier, capacityKg: CAP[tier] };
    });
    const g = greedyTotal(ls, fs);
    const o = optimalTotal(ls, fs);
    if (o == null) continue;
    trials++;
    if (g.placed < size) { worse++; gapSum += 100; continue; }
    if (g.total === o) equal++;
    else { worse++; gapSum += ((g.total - o) / o) * 100; }
  }
  quality.push({ size, trials, equal, worse, meanGapPct: +(gapSum / Math.max(1, trials)).toFixed(1) });
  console.log(`  ${size} loads: exact-optimal on ${equal}/${trials} instances, mean gap ${(gapSum / Math.max(1, trials)).toFixed(1)}%`);
}

console.log("tier boundaries");
for (const w of [0, 1, 60, 61, 300, 301, 1000, 1001, 2500, 2501, 8000, 8001, 28000, 50000]) {
  console.log(`  ${String(w).padStart(6)}kg -> ${tierFor(w)}`);
}

const out = { ranAt: new Date().toISOString(), throughput: results, determinism: answers.size, quality, tiers: VEHICLE_TIERS.map((t) => `${t.tier}@${t.floorKg}`) };
console.log("\nJSON:", JSON.stringify(out));
