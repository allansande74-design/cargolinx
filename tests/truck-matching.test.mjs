import test from "node:test";
import assert from "node:assert/strict";

import {
  registerTruck, verifyTruckPapers, approveTruck, truckReadiness,
  availableTrucks, bookCargo, completeDelivery, transportInvoice,
  payTransport, runTruckJourney,
} from "../src/lib/truck-matching.mjs";

const AT = "2026-11-02T08:00:00.000Z";
const PAPERS = [
  { type: "insurance", reference: "INS-2026-8841", expiresAt: "2027-06-30" },
  { type: "inspection", reference: "NTSA-INS-4471", expiresAt: "2027-06-30" },
  { type: "vehicle_licence", reference: "NTSA-VL-99120", expiresAt: "2027-06-30" },
  { type: "driver_licence", reference: "DL-KE-773451", expiresAt: "2027-06-30" },
  { type: "operating_permit", reference: "NTSA-OP-33210", expiresAt: "2027-06-30" },
];

function onboarded() {
  let p = registerTruck({
    ownerName: "Otieno Haulage", country: "KE", contact: "+254700000222",
    plate: "KDA 123A", classCode: "heavy_truck", capacityKg: 28000, corridors: ["northern"], at: AT,
  });
  p = verifyTruckPapers(p, { plate: "KDA 123A", documents: PAPERS, verifiedBy: "Amanda", at: AT });
  p = approveTruck(p, { by: "Allan", reference: "KRA PIN P052531547Z", at: AT });
  return p;
}

function cargoOrder(over = {}) {
  return {
    id: "ord_truck01", accountId: "acc_seed01", type: "import", stage: "packed",
    lines: [{ description: "Solar lantern carton", qty: 20, unitValue: 5000 }],
    destination: { city: "Nairobi", address: "Industrial Area, Nairobi" },
    pickedQty: 20, packedQty: 20, ...over,
  };
}

test("a truck is born pending and one missing paper keeps it off the lane", () => {
  const pending = registerTruck({
    ownerName: "Otieno Haulage", country: "KE", contact: "+254700000222",
    plate: "KDA 123A", classCode: "heavy_truck", capacityKg: 28000, corridors: ["northern"], at: AT,
  });
  assert.equal(pending.status, "pending");
  const ready = truckReadiness(pending, { plate: "KDA 123A", corridor: "northern", at: AT, weightKg: 12000 });
  assert.equal(ready.eligible, false);
  assert.ok(ready.missing.includes("insurance"));
  const verified = onboarded();
  const now = truckReadiness(verified, { plate: "KDA 123A", corridor: "northern", at: AT, weightKg: 12000 });
  assert.equal(now.eligible, true);
  assert.deepEqual(now.missing, []);
});

test("available trucks are eligible only, smallest first; an overweight load matches nothing", () => {
  const big = onboarded();
  let small = registerTruck({
    ownerName: "Medium Movers", country: "KE", contact: "+254700000333",
    plate: "KDC 300Y", classCode: "medium_truck", capacityKg: 14000, corridors: ["northern"], at: AT,
  });
  small = verifyTruckPapers(small, { plate: "KDC 300Y", documents: PAPERS, verifiedBy: "Amanda", at: AT });
  small = approveTruck(small, { by: "Allan", reference: "KRA PIN P052531547Z", at: AT });
  const found = availableTrucks([big, small], { corridor: "northern", weightKg: 9000, at: AT });
  assert.deepEqual(found.map((f) => f.plate), ["KDC 300Y", "KDA 123A"]);
  assert.equal(availableTrucks([big, small], { corridor: "northern", weightKg: 40000, at: AT }).length, 0);
});

test("booking refuses a broker fee above the 5% cap and accepts one within it", () => {
  const over = bookCargo({
    order: cargoOrder(), partners: [onboarded()], weightKg: 12000, lane: "northern",
    driverName: "Peter Mwangi", brokerFeeKes: 6000, tripCostKes: 100000, at: AT,
  });
  assert.equal(over.ok, false);
  assert.equal(over.refusals[0].code, "broker_fee_over_cap");
  const within = bookCargo({
    order: cargoOrder(), partners: [onboarded()], weightKg: 12000, lane: "northern",
    driverName: "Peter Mwangi", brokerFeeKes: 5000, tripCostKes: 100000, at: AT,
  });
  assert.equal(within.ok, true, JSON.stringify(within.refusals ?? []));
});

test("delivery needs a dispatched order and a named signature; the transport invoice settles in parts", () => {
  const booked = bookCargo({
    order: cargoOrder(), partners: [onboarded()], weightKg: 12000, lane: "northern",
    driverName: "Peter Mwangi", distanceKm: 480, at: AT,
  });
  assert.equal(booked.ok, true);
  const noPod = completeDelivery({ order: booked.order, signedBy: "  ", at: AT });
  assert.equal(noPod.ok, false);
  assert.equal(noPod.refusals[0].code, "pod_missing");
  const delivered = completeDelivery({ order: booked.order, signedBy: "J. Mwangi", at: AT });
  assert.equal(delivered.ok, true);
  assert.equal(delivered.order.stage, "delivered");

  const raised = transportInvoice({ order: delivered.order, freightKes: booked.estimate.freightKes, lane: "northern", at: AT });
  assert.equal(raised.ok, true);
  const part = payTransport(raised.invoice, { amount: 50000, at: AT });
  assert.equal(part.ok, true);
  assert.ok(part.balance > 0);
  const over = payTransport(part.invoice, { amount: part.balance + 5000, at: AT });
  assert.equal(over.ok, false);
  const settled = payTransport(part.invoice, { amount: part.balance, at: AT });
  assert.equal(settled.ok, true);
  assert.equal(settled.balance, 0);
  assert.equal(settled.invoice.status, "paid");
});

test("the full journey runs onboard to paid, and stops honestly when payment is not supplied", () => {
  const done = runTruckJourney({
    truck: {
      ownerName: "Otieno Haulage", country: "KE", contact: "+254700000222",
      plate: "KDA 123A", classCode: "heavy_truck", capacityKg: 28000, corridors: ["northern"],
    },
    papers: PAPERS,
    approval: { by: "Allan", reference: "KRA PIN P052531547Z" },
    order: cargoOrder({ id: "ord_journey1" }),
    lane: "northern", weightKg: 9000, driverName: "Peter Mwangi", distanceKm: 480,
    freightKes: 91200, signedBy: "J. Mwangi",
    payment: { amount: 105792, method: "mpesa", reference: "QK7TEST001" },
    at: AT,
  });
  assert.equal(done.ok, true, JSON.stringify(done.blockers));
  assert.equal(done.status, "delivered_and_paid");
  assert.equal(done.order.stage, "delivered");
  assert.equal(done.invoice.status, "paid");
  assert.equal(done.steps.length, 8);
  assert.ok(done.steps.every((s) => s.ok));

  const unpaid = runTruckJourney({
    truck: {
      ownerName: "Otieno Haulage", country: "KE", contact: "+254700000222",
      plate: "KDB 900X", classCode: "heavy_truck", capacityKg: 28000, corridors: ["northern"],
    },
    papers: PAPERS,
    approval: { by: "Allan", reference: "KRA PIN P052531547Z" },
    order: cargoOrder({ id: "ord_journey2" }),
    lane: "northern", weightKg: 9000, driverName: "Peter Mwangi", distanceKm: 480,
    freightKes: 91200, signedBy: "J. Mwangi",
    at: AT,
  });
  assert.equal(unpaid.ok, false);
  assert.equal(unpaid.status, "payment_pending");
  assert.deepEqual(unpaid.blockers, ["payment_incomplete"]);
});
