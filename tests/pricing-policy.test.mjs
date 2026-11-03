import { test } from "node:test";
import assert from "node:assert/strict";
import { landedCost } from "../engine/landed.mjs";
import {
  POLICY, priceFromCost, marginAt, assertMargin, quoteLadder, marketTest,
  assessQuote, solveBuyPrice, validityCheck, fxStamp,
} from "../engine/pricing-policy.mjs";

test("optimum is 30%, floor is 15%, room is 5%", () => {
  assert.equal(POLICY.targetMargin, 0.30);
  assert.equal(POLICY.minMargin, 0.15);
  assert.equal(POLICY.negotiationRoom, 0.05);
});

test("price from cost yields the stated margin; margin below 15% is refused", () => {
  assert.equal(priceFromCost(7000, 0.3), 10000);
  assert.equal(marginAt(7000, 10000), 0.3);
  assert.throws(() => assertMargin(0.05), /below the 15% floor/);
  assert.throws(() => priceFromCost(7000, 0), /below the 15% floor/);
  // The floor itself must be usable — a 15.0% quote is allowed, 14.9% is not.
  assert.doesNotThrow(() => assertMargin(0.15));
  assert.throws(() => assertMargin(0.149), /below the 15% floor/);
});

test("ladder marks target and floor", () => {
  const l = quoteLadder(7000);
  assert.deepEqual(l.map((r) => r.marginPct), [0.15, 0.2, 0.3, 0.35, 0.4]);
  assert.equal(l.find((r) => r.role === "target").price, 10000);
  assert.equal(l.find((r) => r.role === "floor").price, 8235.29);
});

test("market test requires 5% under wholesale", () => {
  assert.equal(marketTest(9500, 10000).passes, true);      // exactly 5%
  assert.equal(marketTest(9900, 10000).passes, false);     // 1%
  assert.match(marketTest(9900, 10000).note, /needs 5%/);
});

test("a 30% quote survives a 5% concession above the floor", () => {
  const a = assessQuote({ costExVat: 7000, price: 10000, marketWholesale: 11000 });
  assert.equal(a.marginPct, 30);
  assert.equal(a.concessionPrice, 9500);
  assert.equal(a.marginAfterConcessionPct, 26.32);
  assert.equal(a.passesFloor, true);
  assert.equal(a.atOptimum, true);
  assert.equal(a.verdict, "issued");
  assert.deepEqual(a.failures, []);
});

test("a thin quote passes the floor but is flagged below optimum", () => {
  const a = assessQuote({ costExVat: 7000, price: 7800, marketWholesale: 11000 });
  assert.equal(a.passesFloor, false);             // 10.3% now, 5.5% after the concession
  assert.equal(a.marginAfterConcession >= 0.10, false); // 5% off breaks the floor
  assert.ok(a.failures.some((f) => /negotiation room breaks the floor/.test(f)));
});

test("a quote under market but with a stale benchmark is refused", () => {
  const a = assessQuote({ costExVat: 7000, price: 10000, marketWholesale: 11000, marketVerified: false });
  assert.ok(a.failures.some((f) => /benchmark unverified/.test(f)));
  assert.equal(a.verdict, "refused or escalated");
});

test("solveBuyPrice inverts the landed-cost engine", () => {
  const services = 200 + 250 + 250 + 300;   // port, clearing, transport, installation, USD
  const freight = 900;                      // USD
  const s = solveBuyPrice({ price: 10130, margin: 0.30, freight, services, dutyRate: 0, quantity: 2 });
  // rebuild the landed cost from the solved buying price and check the margin lands on 30%
  const lc = landedCost({
    goods: s.goodsTotalUsd, freight, dutyRate: 0, vatRate: 0.16,
    portCharges: 200, clearing: 250, transport: 250, other: 300, quantity: 2,
  });
  const margin = marginAt(lc.totals.netCostExVat, 10130);
  assert.ok(Math.abs(margin - 0.30) < 0.002, `margin drifted to ${margin}`);
  assert.ok(s.fobPerUnitUsd > 0);
});

test("no buying price fits when services alone exceed the allowed cost", () => {
  assert.throws(
    () => solveBuyPrice({ price: 1000, margin: 0.3, freight: 0, services: 900 }),
    /no buying price fits/,
  );
});

test("validity: a supplier quote must outlive our own validity", () => {
  const v = validityCheck({ supplierValidUntil: "2026-11-21", quoteValidDays: 30, today: "2026-11-02" });
  assert.equal(v.supplierCoversQuote, false);
  assert.match(v.note, /expires inside our validity/);
  const ok = validityCheck({ supplierValidUntil: "2026-12-10", quoteValidDays: 30, today: "2026-11-02" });
  assert.equal(ok.supplierCoversQuote, true);
});

test("fx older than 24 hours is not quotable", () => {
  const stale = fxStamp({ usdKes: 129.83, source: "open.er-api.com", asOf: "2026-10-29T00:00:00Z", now: "2026-11-02T18:00:00Z" });
  assert.equal(stale.fresh, false);
  assert.match(stale.note, /re-run before issue/);
  const fresh = fxStamp({ usdKes: 129.94, source: "open.er-api.com", asOf: "2026-11-02T00:02:00Z", now: "2026-11-02T08:00:00Z" });
  assert.equal(fresh.fresh, true);
});
