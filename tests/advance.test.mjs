import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ADVANCE_RULES, advanceQuote, advanceEligible, recordAdvance, recoverAdvance } from "../src/lib/advance.mjs";

const job = (over = {}) => ({
  id: "JOB1", stage: "dispatched", vehicleId: "V1", driverName: "Otis",
  trackingRef: "CLX-JOB1", tripAmountKes: 100000,
  carrier: { id: "C1", verified: true }, ...over,
});

describe("carrier advance", () => {
  it("quotes 30% cap", () => {
    assert.equal(advanceQuote(100000), 30000);
    assert.equal(ADVANCE_RULES.maxPct, 30);
  });
  it("approves a verified dispatch", () => {
    const r = advanceEligible(job(), { verified: true });
    assert.equal(r.eligible, true);
    assert.equal(r.amountKes, 30000);
  });
  it("refuses unverified carrier as data", () => {
    const r = advanceEligible(job(), { verified: false });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.some(b => b.code === "unverified_carrier"));
  });
  it("refuses before dispatch", () => {
    const r = advanceEligible(job({ stage: "confirmed", vehicleId: "", trackingRef: "" }), { verified: true });
    assert.ok(r.blockers.some(b => b.code === "wrong_stage"));
  });
  it("refuses a second advance", () => {
    const r = advanceEligible(job({ advance: { status: "advanced", amountKes: 20000 } }), { verified: true });
    assert.ok(r.blockers.some(b => b.code === "already_advanced"));
  });
  it("refuses over-cap ask", () => {
    const r = advanceEligible(job(), { verified: true }, 90000);
    assert.ok(r.blockers.some(b => b.code === "over_cap"));
  });
  it("records and recovers on POD", () => {
    const rec = recordAdvance({ ...job(), carrier: { verified: true } });
    assert.equal(rec.ok, true);
    const adv = rec.advance;
    const noPod = recoverAdvance(job({ stage: "in_transit" }), adv);
    assert.equal(noPod.ok, false);
    const done = recoverAdvance(job({ stage: "delivered", signedBy: "Achieng" }), adv);
    assert.equal(done.ok, true);
    assert.equal(done.recovery.payoutKes, 70000);
  });
});
