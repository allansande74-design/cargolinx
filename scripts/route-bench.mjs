/**
 * How good is the sequencing, really?
 *
 * Three answers, in increasing honesty:
 *   1. against the order a driver would take unaided (nearest neighbour),
 *   2. against the best order that exists, brute-forced, on instances small enough to know,
 *   3. the time it takes, because a planner that is right in ten seconds is worse than one that is
 *      close in one millisecond when a dispatcher is standing at the counter.
 *
 * Deterministic: the same seed produces the same instance, so the numbers in the README can be
 * reproduced by anyone who runs this file.
 */

import { buildMatrix, nearestNeighbourRoute, savingsRoute, improveRoute, sequenceRoute, routeLength } from "../engine/route.mjs";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A depot near Nairobi's Industrial Area, and stops scattered across the city at realistic sprawl.
const DEPOT = { lat: -1.3152, lng: 36.8506 };

function instance(n, seed) {
  const rand = mulberry32(seed);
  const stops = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 0.02 + rand() * 0.16; // roughly 2–20 km from the depot
    stops.push({
      id: `S${i + 1}`,
      lat: DEPOT.lat + Math.sin(angle) * radius,
      lng: DEPOT.lng + Math.cos(angle) * radius,
      weightKg: 100 + Math.round(rand() * 900),
    });
  }
  return stops;
}

function permutations(nodes) {
  if (nodes.length <= 1) return [nodes];
  const out = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const rest = [...nodes.slice(0, i), ...nodes.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([nodes[i], ...tail]);
  }
  return out;
}

function optimal(stops, matrix) {
  const nodes = stops.map((_, i) => i + 1);
  let best = Infinity;
  for (const order of permutations(nodes)) best = Math.min(best, routeLength(order, matrix));
  return best;
}

const sizes = [6, 8, 12, 18, 26, 40];
const rows = [];

for (const n of sizes) {
  let nnSum = 0;
  let svSum = 0;
  let optSum = 0;
  let nnWin = 0;
  let exact = 0;
  const runs = n <= 8 ? 12 : 40;

  for (let r = 0; r < runs; r += 1) {
    const stops = instance(n, 1000 + n * 100 + r);
    const points = [DEPOT, ...stops];
    const matrix = buildMatrix(points);
    const nn = routeLength(nearestNeighbourRoute(stops, matrix), matrix);
    const sv = sequenceRoute(stops, matrix);
    const svLen = routeLength(sv, matrix);
    nnSum += nn;
    svSum += svLen;
    if (svLen < nn) nnWin += 1;
    if (n <= 8) {
      const best = optimal(stops, matrix);
      optSum += best;
      if (Math.abs(svLen - best) < 1e-6) exact += 1;
    }
  }

  rows.push({
    stops: n,
    runs,
    vsNearestPct: Number((((nnSum - svSum) / nnSum) * 100).toFixed(1)),
    beatNearest: `${nnWin}/${runs}`,
    vsOptimalPct: n <= 8 ? Number((((svSum - optSum) / optSum) * 100).toFixed(2)) : null,
    optimalHits: n <= 8 ? `${exact}/${runs}` : null,
  });
}

// Timing at the size a real day reaches.
const timing = [];
for (const n of [20, 40, 80]) {
  const stops = instance(n, 77000 + n);
  const matrix = buildMatrix([DEPOT, ...stops]);
  const t0 = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i += 1) improveRoute(savingsRoute(stops, matrix), matrix);
  const ms = (performance.now() - t0) / runs;
  timing.push({ stops: n, msPerPlan: Number(ms.toFixed(2)) });
}

console.log("Sequencing quality, Nairobi-shaped instances, deterministic seeds");
console.log("(exact under nine stops, Clarke-Wright savings + 2-opt + or-opt above that)");
console.table(rows);
console.table(timing);
