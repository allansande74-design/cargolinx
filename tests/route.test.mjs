import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMatrix, distanceKm, exactRoute, improveRoute, nearestNeighbourRoute, orOpt, planVehicleDay, routeLength,
  savingsRoute, sequenceRoute, twoOpt,
} from "../engine/route.mjs";

const DEPOT = { lat: -1.3152, lng: 36.8506 };

function city(n, seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, (_, i) => {
    const angle = rand() * Math.PI * 2;
    const radius = 0.02 + rand() * 0.16;
    return {
      id: `S${i + 1}`,
      lat: DEPOT.lat + Math.sin(angle) * radius,
      lng: DEPOT.lng + Math.cos(angle) * radius,
      weightKg: 100,
    };
  });
}

function factorialOrders(nodes) {
  if (nodes.length <= 1) return [nodes];
  return nodes.flatMap((node, i) =>
    factorialOrders([...nodes.slice(0, i), ...nodes.slice(i + 1)]).map((tail) => [node, ...tail]));
}

test("distance is measured on the earth, not on a flat sheet", () => {
  assert.equal(distanceKm(DEPOT, DEPOT), 0);
  const nairobiToMombasa = distanceKm({ lat: -1.2921, lng: 36.8219 }, { lat: -4.0435, lng: 39.6682 });
  assert.ok(nairobiToMombasa > 430 && nairobiToMombasa < 460, `expected ~441 km, got ${nairobiToMombasa}`);
});

test("a loop is scored with the return leg", () => {
  const pts = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0, lng: 0.02 }];
  const m = buildMatrix(pts);
  const out = routeLength([1, 2], m);
  assert.ok(Math.abs(out - (m[0][1] + m[1][2] + m[2][0])) < 1e-9);
});

test("2-opt never makes a route longer", () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const stops = city(9, seed);
    const m = buildMatrix([DEPOT, ...stops]);
    const start = nearestNeighbourRoute(stops, m);
    const after = twoOpt(start, m);
    assert.ok(routeLength(after, m) <= routeLength(start, m) + 1e-9);
    assert.deepEqual([...after].sort((x, y) => x - y), startsOf(9));
  }
});

function startsOf(n) {
  return Array.from({ length: n }, (_, i) => i + 1);
}

test("the same day always plans the same way", () => {
  const stops = city(12, 42);
  const m = buildMatrix([DEPOT, ...stops]);
  const a = twoOpt(savingsRoute(stops, m), m);
  const b = twoOpt(savingsRoute(stops, m), m);
  assert.deepEqual(a, b);
});

test("savings beats the unaided order across a spread of instances", () => {
  let nnTotal = 0;
  let oursTotal = 0;
  for (let seed = 1; seed <= 25; seed += 1) {
    const stops = city(14, seed);
    const m = buildMatrix([DEPOT, ...stops]);
    nnTotal += routeLength(nearestNeighbourRoute(stops, m), m);
    oursTotal += routeLength(sequenceRoute(stops, m), m);
  }
  assert.ok(oursTotal < nnTotal * 0.95, `expected at least 5% shorter, got ${(100 * (1 - oursTotal / nnTotal)).toFixed(1)}%`);
});

test("on an instance small enough to know, the answer is within one percent of perfect", () => {
  for (let seed = 1; seed <= 5; seed += 1) {
    const stops = city(6, seed);
    const m = buildMatrix([DEPOT, ...stops]);
    const ours = routeLength(sequenceRoute(stops, m), m);
    const best = Math.min(...factorialOrders(startsOf(6)).map((order) => routeLength(order, m)));
    const gap = (ours - best) / best;
    assert.ok(gap < 0.01, `seed ${seed}: ${(gap * 100).toFixed(2)}% above optimal`);
  }
});

test("a day that cannot all fit says what it left behind and why", () => {
  const stops = [
    { id: "A", lat: -1.30, lng: 36.82, weightKg: 900 },
    { id: "B", lat: -1.31, lng: 36.83, weightKg: 900 },
    { id: "C", lat: -1.32, lng: 36.84, weightKg: 900 },
  ];
  const day = planVehicleDay(DEPOT, stops, { capacityKg: 2000 });
  assert.equal(day.stops.length, 2);
  assert.equal(day.loadKg, 1800);
  assert.equal(day.unplanned.length, 1);
  assert.match(day.unplanned[0].reason, /capacity 2000kg cannot take a further 900kg/);
  assert.ok(day.distanceKm > 0);
});

test("an empty day is a zero, not an error", () => {
  const day = planVehicleDay(DEPOT, [], { capacityKg: 3000 });
  assert.deepEqual(day, { stops: [], distanceKm: 0, loadKg: 0, unplanned: [] });
});

test("one stop is a there-and-back with a real distance", () => {
  const day = planVehicleDay(DEPOT, [{ id: "A", lat: -1.35, lng: 36.90, weightKg: 50 }], {});
  assert.equal(day.stops.length, 1);
  assert.ok(day.distanceKm > 1);
});

test("under nine stops the answer is the best one that exists", () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const stops = city(6, seed);
    const m = buildMatrix([DEPOT, ...stops]);
    const ours = routeLength(sequenceRoute(stops, m), m);
    const best = Math.min(...factorialOrders(startsOf(6)).map((order) => routeLength(order, m)));
    assert.ok(Math.abs(ours - best) < 1e-9, `seed ${seed}: ${ours.toFixed(2)} against ${best.toFixed(2)}`);
  }
  const eight = city(8, 99);
  const m8 = buildMatrix([DEPOT, ...eight]);
  assert.equal(sequenceRoute(eight, m8).length, 8);
  assert.equal(exactRoute(eight, m8).length, 8);
});

test("or-opt only ever shortens, and keeps every stop exactly once", () => {
  for (let seed = 1; seed <= 15; seed += 1) {
    const stops = city(11, seed);
    const m = buildMatrix([DEPOT, ...stops]);
    const before = twoOpt(savingsRoute(stops, m), m);
    const after = orOpt(before, m);
    assert.ok(routeLength(after, m) <= routeLength(before, m) + 1e-9);
    assert.deepEqual([...after].sort((a, b) => a - b), startsOf(11));
  }
});

test("the heuristic path is used beyond the exact limit and still beats the unaided order", () => {
  const stops = city(16, 5);
  const m = buildMatrix([DEPOT, ...stops]);
  const ours = routeLength(sequenceRoute(stops, m), m);
  const nn = routeLength(nearestNeighbourRoute(stops, m), m);
  assert.ok(ours < nn);
  assert.equal(sequenceRoute(stops, m).length, 16);
});
