/**
 * The planner: lanes, windows, equipment, one load per vehicle, and the reasons a load stays behind.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { planDispatch, blockers, fits, rankVehicles, planOrder, splitSuggestion, placementCost } from "../src/lib/match-dispatch.mjs";

const FLEET = [
  { id: "v-van", plate: "KDA 001A", tier: "van", capacityKg: 3000, corridors: ["nairobi_last_mile"], costPerKm: 90 },
  { id: "v-truck", plate: "KDB 002B", tier: "truck", capacityKg: 28000, corridors: ["nairobi_kampala"], costPerKm: 260 },
  { id: "v-pickup", plate: "KDC 003C", tier: "pickup", capacityKg: 1200, corridors: ["nairobi_last_mile", "nairobi_kampala"], costPerKm: 60 },
];

test("a load takes the cheapest vehicle that is actually allowed to carry it", () => {
  const load = { id: "L1", weightKg: 900, corridor: "nairobi_last_mile" };
  const ranked = rankVehicles(load, FLEET);
  assert.equal(ranked[0].vehicle.id, "v-pickup", "the pickup is cheapest and clears the lane");
  assert.ok(ranked.every((r) => r.vehicle.id !== "v-truck"), "the truck is not cleared for last mile");
});

test("lane clearance is enforced, with the reason named", () => {
  const load = { id: "L2", weightKg: 500, corridor: "mombasa_nairobi" };
  const plan = planDispatch([load], FLEET);
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.unassigned[0].code, "no_feasible_vehicle");
  assert.match(plan.unassigned[0].message, /not cleared for the mombasa_nairobi lane/);
});

test("a time window the vehicle cannot meet refuses the load", () => {
  const late = [{ ...FLEET[0], availableFrom: "2026-11-05T00:00:00Z" }];
  const load = { id: "L3", weightKg: 400, corridor: "nairobi_last_mile", dueAt: "2026-11-04T09:00:00Z" };
  const plan = planDispatch([load], late);
  assert.equal(plan.assignments.length, 0);
  assert.match(plan.unassigned[0].message, /not free until after the load is due/);
});

test("refrigeration is a hard requirement, not a preference", () => {
  const load = { id: "L4", weightKg: 300, corridor: "nairobi_last_mile", needsRefrigeration: true };
  assert.equal(planDispatch([load], FLEET).assignments.length, 0);
  const chilled = [{ ...FLEET[0], refrigerated: true }];
  assert.equal(planDispatch([load], chilled).assignments.length, 1);
});

test("one vehicle is never booked twice in the same plan", () => {
  const loads = [
    { id: "L5a", weightKg: 800, corridor: "nairobi_last_mile" },
    { id: "L5b", weightKg: 700, corridor: "nairobi_last_mile" },
  ];
  const plan = planDispatch(loads, FLEET);
  const used = plan.assignments.map((a) => a.vehicleId);
  assert.equal(new Set(used).size, used.length, "a vehicle appears twice in the plan");
  assert.equal(plan.assignments.length, 2);
});

test("planning is deterministic under shuffled input", () => {
  const loads = [
    { id: "L6a", weightKg: 2000, corridor: "nairobi_last_mile", dueAt: "2026-11-04T08:00:00Z" },
    { id: "L6b", weightKg: 900, corridor: "nairobi_last_mile", dueAt: "2026-11-04T12:00:00Z" },
    { id: "L6c", weightKg: 15000, corridor: "nairobi_kampala", dueAt: "2026-11-04T10:00:00Z" },
  ];
  const a = JSON.stringify(planDispatch(loads, FLEET).assignments);
  const b = JSON.stringify(planDispatch([...loads].reverse(), FLEET).assignments);
  assert.equal(a, b);
});

test("the urgent load is planned first", () => {
  const loads = [
    { id: "later", weightKg: 500, corridor: "nairobi_last_mile", dueAt: "2026-11-06T09:00:00Z" },
    { id: "sooner", weightKg: 500, corridor: "nairobi_last_mile", dueAt: "2026-11-04T09:00:00Z" },
  ];
  assert.equal(planOrder(loads)[0].id, "sooner");
});

test("an overweight load gets a split recommendation, not a shrug", () => {
  const s = splitSuggestion({ weightKg: 60000 }, FLEET);
  assert.equal(s.parts, 3);
  assert.equal(s.weightsKg.reduce((a, b) => a + b, 0), 60000);
  assert.equal(splitSuggestion({ weightKg: 20000 }, FLEET), null);
});

test("blockers name every reason, in the order a dispatcher checks", () => {
  const load = { id: "L7", weightKg: 40000, corridor: "mombasa_nairobi", needsRefrigeration: true };
  const b = blockers(FLEET[2], load);
  assert.ok(b.some((x) => x.includes("capacity")));
  assert.ok(b.some((x) => x.includes("not cleared")));
  assert.ok(b.some((x) => x.includes("refrigeration")));
  assert.equal(fits(FLEET[2], load), false);
});

test("the summary reports fill and utilisation honestly", () => {
  const plan = planDispatch([
    { id: "L8a", weightKg: 1000, corridor: "nairobi_last_mile" },
    { id: "L8b", weightKg: 50000, corridor: "nairobi_kampala" },
  ], FLEET);
  assert.equal(plan.summary.loads, 2);
  assert.equal(plan.summary.placed, 1);
  assert.equal(plan.summary.unplaced, 1);
  assert.equal(plan.summary.fillRatePct, 50);
  assert.ok(plan.summary.utilisationPct > 0 && plan.summary.utilisationPct <= 100);
});

test("an empty fleet is a stated refusal, not a crash", () => {
  const plan = planDispatch([{ id: "L9", weightKg: 100 }], []);
  assert.equal(plan.assignments.length, 0);
  assert.match(plan.unassigned[0].message, /no vehicles registered/);
});

test("cost index penalises an oversized vehicle for a small load", () => {
  const small = { id: "A", weightKg: 200, corridor: "nairobi_last_mile" };
  const pickup = placementCost(FLEET[2], small);
  const van = placementCost(FLEET[0], small);
  assert.ok(pickup < van, "a 1.2t pickup should be cheaper than a 3t van for a 200kg load");
});
