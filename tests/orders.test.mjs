import test from "node:test";
import assert from "node:assert/strict";
import { createOrder, advance, nextStage, blockersFor, receiveGoods, dispatch, deliver, slaState, ORDER_TYPES, orderValueKes } from "../engine/orders.mjs";

const lines = [
  { description: "Solar panels 450W", hs: "8541.43", qty: 200, unitValue: 12000 },
  { description: "Mounting rails", hs: "7326.90", qty: 100, unitValue: 1500 },
];
const order = createOrder({ accountId: "acc_1", type: "import", lines, promisedAt: "2026-11-10T12:00:00Z" });

test("an order needs an account and lines", () => {
  assert.throws(() => createOrder({ lines }), /accountId required/);
  assert.throws(() => createOrder({ accountId: "acc_1", lines: [] }), /at least one order line/);
  assert.throws(() => createOrder({ accountId: "acc_1", lines: [{ description: "x", qty: 0 }] }), /quantity must be positive/);
});

test("order value is computed from the lines", () => {
  assert.equal(orderValueKes(lines), 200 * 12000 + 100 * 1500);
  assert.equal(order.valueKes, 2_550_000);
});

test("the first step is confirmation, and it happens without extras", () => {
  assert.equal(nextStage(order), "confirmed");
  const confirmed = advance(order, {});
  assert.equal(confirmed.stage, "confirmed");
});

test("you cannot buy without a supplier, a PO and a value", () => {
  let o = advance(order, {});
  o = advance(o, {});
  const missing = blockersFor(o, "purchased");
  assert.deepEqual(missing.missing.sort(), ["poRef", "purchaseValue", "supplier"]);
  assert.throws(() => advance(o, { supplier: "Kunpeng" }), /missing poRef, purchaseValue/);
});

test("a stage cannot be skipped by operations", () => {
  let o = advance(order, {});
  assert.throws(() => advance(o, { stage: "freight_booked", carrier: "X", transportRef: "Y" }), /only an administrator/);
  const jumped = advance(o, { stage: "freight_booked", carrier: "X", transportRef: "Y" }, { role: "admin" });
  assert.equal(jumped.stage, "freight_booked");
});

test("an import order passes through the warehouse, a dropship order does not", () => {
  let o = { ...order, stage: "arrived" };
  assert.equal(nextStage(o), "received");
  const drop = { ...createOrder({ accountId: "acc_1", type: "dropship", lines }), stage: "arrived" };
  assert.equal(nextStage(drop), "dispatched");
  // and the warehouse guard does not block the dropship
  assert.deepEqual(blockersFor(drop, "received"), { skip: true, missing: [] });
});

test("goods received states over, short and damaged rather than smoothing them", () => {
  const o = { ...order, stage: "arrived" };
  const clean = receiveGoods(o, { grnRef: "GRN-77", receipts: lines.map((l) => ({ description: l.description, qty: l.qty })) });
  assert.equal(clean.receiptStatus, "clean");
  assert.equal(clean.receivedQty, 300);

  const short = receiveGoods(o, { grnRef: "GRN-78", receipts: [{ description: lines[0].description, qty: 190, damaged: 4 }, { description: lines[1].description, qty: 100 }] });
  assert.equal(short.receiptStatus, "variance");
  assert.equal(short.receipts[0].variance, -6);
  assert.equal(short.receiptVariance, -6);
});

test("dispatch requires a vehicle, a driver and a tracking reference", () => {
  assert.throws(() => dispatch(order, { driverName: "Otieno", trackingRef: "T1" }), /vehicleId required/);
  assert.throws(() => dispatch(order, { vehicleId: "KDG 123A", trackingRef: "T1" }), /driverName required/);
  const { order: dispatched, job } = dispatch(order, { vehicleId: "KDG 123A", driverName: "Otieno", trackingRef: "T1" });
  assert.equal(dispatched.stage, "dispatched");
  assert.equal(job.status, "dispatched");
  assert.equal(job.orderId, order.id);
});

test("delivery without a named signature is refused", () => {
  assert.throws(() => deliver(order, {}), /must name who signed/);
  const done = deliver(order, { signedBy: "J. Mwangi", signatureRef: "sig_9" });
  assert.equal(done.stage, "delivered");
  assert.equal(done.pod.signedBy, "J. Mwangi");
});

test("a delivered order cannot be advanced again", () => {
  const done = deliver(order, { signedBy: "J. Mwangi" });
  assert.throws(() => advance(done, {}), /already delivered/);
});

test("SLA states are honest about lateness", () => {
  const late = slaState(order, new Date("2026-11-12T12:00:00Z"));
  assert.equal(late.status, "late");
  assert.equal(late.lateByHours, 48);
  const risk = slaState(order, new Date("2026-11-09T18:00:00Z"));
  assert.equal(risk.status, "at risk");
  const done = slaState({ ...order, stage: "delivered" }, new Date("2026-11-12T12:00:00Z"));
  assert.equal(done.status, "delivered late");
});

test("every order type declares whether it uses the warehouse", () => {
  assert.equal(ORDER_TYPES.import.usesWarehouse, true);
  assert.equal(ORDER_TYPES.dropship.usesWarehouse, false);
  assert.equal(ORDER_TYPES.domestic.usesWarehouse, true);
});
