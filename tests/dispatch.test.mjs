import test from "node:test";
import assert from "node:assert/strict";

import { dispatchOrder, dispatchSummary, dispatchReadiness, readyFrom } from "../engine/dispatch.mjs";
import { registerPartner, verifyDocument, approvePartner } from "../engine/partners.mjs";

const DOCS = [
  ["insurance", "INS-2026-8841"],
  ["inspection", "NTSA-INS-4471"],
  ["vehicle_licence", "NTSA-VL-99120"],
  ["driver_licence", "DL-KE-773451"],
  ["operating_permit", "NTSA-OP-33210"],
];

function partner({ plate = "KDA 123A", classCode = "heavy_truck", capacityKg = 28000, corridors = ["northern"], approved = true, expiry = "2027-06-30", name = "Otieno Haulage" } = {}) {
  let p = registerPartner({
    ownerName: name,
    country: "KE",
    contact: "+254700111222",
    fleet: [{ plate, classCode, capacityKg, corridors }],
  });
  for (const [type, reference] of DOCS) {
    p = verifyDocument(p, { plate, type, reference, expiresAt: expiry, verifiedBy: "Amanda" });
  }
  if (approved) p = approvePartner(p, { by: "Allan", reference: "KRA PIN P052531547Z" });
  return p;
}

function order(over = {}) {
  return {
    id: "ord_disp01",
    accountId: "acc_seed01",
    type: "import",
    stage: "packed",
    lines: [{ description: "SP450 solar floodlight", qty: 20, unitPriceKes: 4500 }],
    destination: { city: "Nairobi", address: "Industrial Area, Nairobi" },
    promisedAt: "2026-11-06T09:00:00.000Z",
    pickedQty: 20,
    packedQty: 20,
    ...over,
  };
}

const AT = "2026-11-02T08:00:00.000Z";

test("an order that has not been packed cannot be dispatched", () => {
  const res = dispatchOrder(order({ stage: "in_transit" }), {
    partners: [partner()],
    weightKg: 12000,
    lane: "northern",
    driverName: "Peter Mwangi",
    at: AT,
  });
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "order_not_ready");
  assert.match(res.refusals[0].message, /in_transit/);
});

test("a dropship file dispatches on arrival, not from the warehouse", () => {
  assert.deepEqual(readyFrom("dropship"), ["arrived", "in_transit"]);
  assert.deepEqual(readyFrom("import"), ["picked", "packed"]);
  const res = dispatchOrder(order({ type: "dropship", stage: "arrived" }), {
    partners: [partner({ plate: "KDL 500V", classCode: "light_truck", capacityKg: 3000, corridors: ["nairobi_last_mile"] })],
    weightKg: 500,
    lane: "nairobi_last_mile",
    driverName: "Peter Mwangi",
    at: AT,
  });
  assert.equal(res.ok, true, JSON.stringify(res.refusals ?? []));
});

test("an unknown lane is refused by name", () => {
  const res = dispatchOrder(order(), { partners: [partner()], weightKg: 1000, lane: "mars", driverName: "Peter", at: AT });
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "unknown_lane");
  assert.match(res.refusals[0].message, /northern/);
});

test("a load heavier than every class is refused before a partner is considered", () => {
  const res = dispatchOrder(order(), { partners: [partner()], weightKg: 60000, lane: "northern", driverName: "Peter", at: AT });
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "vehicle_too_small");
});

test("a dispatch without a named driver is refused", () => {
  const res = dispatchOrder(order(), { partners: [partner()], weightKg: 12000, lane: "northern", driverName: "  ", at: AT });
  assert.equal(res.ok, false);
  assert.ok(res.refusals.some((r) => r.code === "no_driver"));
});

test("the happy path books the vehicle, marks the order dispatched and opens the track", () => {
  const p = partner();
  const res = dispatchOrder(order(), {
    partners: [p],
    weightKg: 12000,
    lane: "northern",
    driverName: "Peter Mwangi",
    distanceKm: 480,
    at: AT,
  });
  assert.equal(res.ok, true, JSON.stringify(res.refusals ?? []));
  assert.equal(res.order.stage, "dispatched");
  assert.equal(res.order.vehicleId, "KDA 123A");
  assert.equal(res.order.driverName, "Peter Mwangi");
  assert.ok(res.order.trackingRef.startsWith("CLX-"));
  assert.equal(res.job.status, "dispatched");
  assert.equal(res.booking.orderId, "ord_disp01");
  assert.equal(res.booking.plate, "KDA 123A");
  assert.equal(res.track.shipmentId, res.order.trackingRef);
  assert.equal(res.track.legs.length, 1);
  assert.equal(res.estimate.vehicleCode, "medium_truck");
  assert.equal(res.estimate.freightKes, 91200);
  assert.match(res.estimateNote, /Planning estimate/);
  assert.match(dispatchSummary(res), /ord_disp01 dispatched on KDA 123A/);
});

test("the smallest vehicle that fits is chosen, not the first on file", () => {
  const big = partner({ plate: "KDB 900X", classCode: "trailer", capacityKg: 34000, name: "Big Rig Ltd" });
  const small = partner({ plate: "KDC 300Y", classCode: "medium_truck", capacityKg: 14000, name: "Medium Movers" });
  const res = dispatchOrder(order(), {
    partners: [big, small],
    weightKg: 9000,
    lane: "northern",
    driverName: "Peter Mwangi",
    at: AT,
  });
  assert.equal(res.ok, true, JSON.stringify(res.refusals ?? []));
  assert.equal(res.vehicle.plate, "KDC 300Y");
});

test("an unverified partner is offered with its reasons instead of being used", () => {
  const pending = partner({ approved: false });
  const res = dispatchOrder(order(), { partners: [pending], weightKg: 12000, lane: "northern", driverName: "Peter", at: AT });
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "no_eligible_partner");
  assert.match(res.refusals[0].candidates.join(" "), /pending/);
});

test("papers that lapsed after approval still block the dispatch", () => {
  const lapsed = partner({ expiry: "2027-01-31" });
  const res = dispatchOrder(order(), { partners: [lapsed], weightKg: 12000, lane: "northern", driverName: "Peter", at: "2027-07-05T08:00:00.000Z" });
  assert.equal(res.ok, false);
  assert.equal(res.refusals[0].code, "no_eligible_partner");
  assert.match(res.refusals[0].candidates.join(" "), /expired/);
});

test("two orders cannot take the same truck in the same window", () => {
  const p = partner();
  const first = dispatchOrder(order(), { partners: [p], weightKg: 12000, lane: "northern", driverName: "Peter", at: AT });
  assert.equal(first.ok, true);
  const second = dispatchOrder(order({ id: "ord_disp02" }), {
    partners: [first.partner],
    weightKg: 12000,
    lane: "northern",
    driverName: "Peter",
    at: AT,
  });
  assert.equal(second.ok, false);
  assert.equal(second.refusals[0].code, "booking_refused");
  assert.match(second.refusals[0].message, /ord_disp01/);
});

test("readiness reports the stage without attempting a dispatch", () => {
  assert.equal(dispatchReadiness(order()).ready, true);
  const notReady = dispatchReadiness(order({ stage: "confirmed" }));
  assert.equal(notReady.ready, false);
  assert.match(notReady.reason, /confirmed/);
});
