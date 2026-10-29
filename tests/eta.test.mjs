import test from "node:test";
import assert from "node:assert/strict";
import { planEta, applyEvent } from "../engine/eta.mjs";

const nairobiKampala = [
  { name: "Nairobi - Eldoret", km: 320, speedKph: 55, source: "Altovex October runs" },
  { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
  { name: "Malaba - Kampala", km: 250, speedKph: 45 },
];

const plan = planEta({ segments: nairobiKampala, departAt: "2026-10-29T05:00:00Z", customsHours: 6 });

test("ETA is after departure and carries its full basis", () => {
  assert.ok(new Date(plan.eta) > new Date(plan.departAt));
  assert.equal(plan.basis.legs.length, 3);
  assert.equal(plan.basis.customsHours, 6);
  assert.ok(plan.basis.bufferPct > 0);
  assert.equal(plan.basis.legs[0].source, "Altovex October runs");
  assert.ok(plan.etaHours > 13);
});

test("a corridor with a border crossing is less confident than a clean one", () => {
  const clean = planEta({ segments: [{ name: "Nairobi - Nakuru", km: 160, speedKph: 55, source: "Altovex October runs" }], departAt: "2026-10-29T05:00:00Z" });
  assert.ok(plan.confidence < clean.confidence);
  assert.ok(plan.confidence >= 0.35);
});

test("a delay moves the ETA and keeps the previous one with its cause", () => {
  const delayed = applyEvent(plan, { type: "delay", delayHours: 9, note: "loading bay queue" });
  const delta = (new Date(delayed.eta) - new Date(plan.eta)) / 3600000;
  assert.equal(delta, 9);
  assert.equal(delayed.changes.length, 1);
  assert.equal(delayed.changes[0].previousEta, plan.eta);
  assert.equal(delayed.changes[0].note, "loading bay queue");
  assert.ok(delayed.confidence < plan.confidence);
});

test("a border queue costs more confidence than a plain delay", () => {
  const q = applyEvent(plan, { type: "border-queue", delayHours: 9, note: "Malaba backlog" });
  const d = applyEvent(plan, { type: "delay", delayHours: 9, note: "loading" });
  assert.ok(q.confidence < d.confidence);
});

test("delivery closes the shipment with certainty and history intact", () => {
  const done = applyEvent(plan, { type: "delivered", at: "2026-10-31T14:30:00Z", note: "POD signed by consignee" });
  assert.equal(done.status, "delivered");
  assert.equal(done.confidence, 1);
  assert.equal(done.changes.at(-1).note, "POD signed by consignee");
});

test("an unknown event type is refused rather than silently ignored", () => {
  assert.throws(() => applyEvent(plan, { type: "teleport" }), /unknown event type/);
});

test("a segment without a speed is refused", () => {
  assert.throws(() => planEta({ segments: [{ name: "x", km: 10 }], departAt: "2026-10-29T05:00:00Z" }), /speedKph required/);
});
