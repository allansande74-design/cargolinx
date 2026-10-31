import test from "node:test";
import assert from "node:assert/strict";

import {
  VEHICLE_TIERS, tierFor, chooseVehicle, ORDER_STAGES,
  nextStage, canAdvance, dispatch,
} from "../src/lib/matchmaking.mjs";
import { ROLES, ENTITIES, can, documentHeader, creditDecision } from "../src/lib/roles.mjs";

const fleet = [
  { id: "v1", plate: "KDJ 111A", tier: "motorbike", capacityKg: 150 },
  { id: "v2", plate: "KDJ 222B", tier: "tuk_tuk", capacityKg: 600 },
  { id: "v3", plate: "KDJ 333C", tier: "pickup", capacityKg: 1500 },
  { id: "v4", plate: "KDJ 444D", tier: "van", capacityKg: 4000 },
  { id: "v5", plate: "KDJ 555E", tier: "truck", capacityKg: 28000 },
];

test("vehicle tiers are the five specified floors in order", () => {
  assert.deepEqual(VEHICLE_TIERS.map((t) => [t.tier, t.floorKg]), [
    ["motorbike", 0], ["tuk_tuk", 300], ["pickup", 1000], ["van", 2500], ["truck", 8000],
  ]);
});

test("tierFor resolves boundary weights to the right tier", () => {
  assert.equal(tierFor(0), "motorbike");
  assert.equal(tierFor(299), "motorbike");
  assert.equal(tierFor(300), "tuk_tuk");
  assert.equal(tierFor(1000), "pickup");
  assert.equal(tierFor(2500), "van");
  assert.equal(tierFor(8000), "truck");
  assert.equal(tierFor(27000), "truck");
});

test("chooseVehicle picks the smallest vehicle at or above the load", () => {
  assert.equal(chooseVehicle(100, fleet).plate, "KDJ 111A");
  assert.equal(chooseVehicle(200, fleet).plate, "KDJ 222B"); // 200kg is motorbike tier but exceeds its 150kg capacity
  assert.equal(chooseVehicle(500, fleet).plate, "KDJ 222B");
  assert.equal(chooseVehicle(1200, fleet).plate, "KDJ 333C");
  assert.equal(chooseVehicle(3000, fleet).plate, "KDJ 444D");
  assert.equal(chooseVehicle(12000, fleet).plate, "KDJ 555E");
  assert.equal(chooseVehicle(100, []), null);
  assert.equal(chooseVehicle(60000, fleet), null);
});

test("dispatch happy path returns the assignment with a tracking ref", () => {
  const res = dispatch({ id: "ord_m1", weightKg: 1200 }, fleet);
  assert.equal(res.ok, true);
  assert.equal(res.assignment.plate, "KDJ 333C");
  assert.equal(res.assignment.tier, "pickup");
  assert.match(res.assignment.trackingRef, /^CLX-/);
});

test("dispatch refuses an overweight load with the overweight code", () => {
  const res = dispatch({ id: "ord_m2", weightKg: 60000 }, fleet);
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "overweight");
  assert.match(res.refusals[0].message, /60000/);
});

test("dispatch refuses an empty fleet board with the no_vehicle code", () => {
  const res = dispatch({ id: "ord_m3", weightKg: 500 }, []);
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "no_vehicle");
});

test("dispatch refuses an order held over credit with shortfall stated", () => {
  const res = dispatch(
    { id: "ord_m4", weightKg: 500, credit: { approved: false, reason: "over limit", shortfallKes: 1400000 } },
    fleet,
  );
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "over_credit");
  assert.match(res.refusals[0].message, /1400000/);
});

test("stage table runs draft to delivered and dropship skips the warehouse", () => {
  assert.equal(ORDER_STAGES[0].stage, "draft");
  assert.equal(ORDER_STAGES[ORDER_STAGES.length - 1].stage, "delivered");
  assert.equal(nextStage({ stage: "arrived", type: "dropship" }), "dispatched");
  assert.equal(nextStage({ stage: "arrived", type: "import" }), "received");
});

test("canAdvance names the missing evidence fields", () => {
  const blocked = canAdvance({ stage: "sourcing", type: "import" }, "purchased");
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing.sort(), ["poRef", "purchaseValue", "supplier"]);
  const open = canAdvance(
    { stage: "sourcing", type: "import", supplier: "Kunpeng", poRef: "PO-1", purchaseValue: 5000 },
    "purchased",
  );
  assert.equal(open.ok, true);
  assert.equal(canAdvance({ stage: "confirmed", type: "import", signedBy: "J. Mwangi" }, "delivered").ok, true);
});

test("roles gate dispatch to ops/admin and document map splits the letterheads", () => {
  assert.ok(can("operations", "dispatch.create"));
  assert.ok(can("admin", "dispatch.create"));
  assert.equal(can("driver", "dispatch.create"), false);
  assert.equal(can("client_user", "order.advance"), false);
  assert.equal(documentHeader("invoice").name, ENTITIES.seller.name);
  assert.equal(documentHeader("purchase_order").name, ENTITIES.seller.name);
  assert.equal(documentHeader("tracking").name, ENTITIES.platform.name);
  assert.equal(documentHeader("pod").name, ENTITIES.platform.name);
  assert.ok(ROLES.client_admin && ROLES.driver);
});

test("credit gate holds with the shortfall and approves within headroom", () => {
  const held = creditDecision({ status: "active", terms: "net30", creditLimitKes: 1000000 }, 2400000, 0);
  assert.equal(held.approved, false);
  assert.equal(held.shortfallKes, 1400000);
  assert.match(held.reason, /1,?400,?000/);
  const ok = creditDecision({ status: "active", terms: "net30", creditLimitKes: 3000000 }, 2400000, 0);
  assert.equal(ok.approved, true);
  assert.equal(ok.shortfallKes, 0);
  assert.equal(ok.headroomKes, 600000);
  const pre = creditDecision({ status: "active", terms: "prepayment" }, 50000);
  assert.equal(pre.approved, false);
  assert.equal(pre.requiresFunding, true);
});
