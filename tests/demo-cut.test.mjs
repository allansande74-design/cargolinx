import test from "node:test";
import assert from "node:assert/strict";
import { landedCost, quote, floorPrice } from "../engine/landed.mjs";
import { resolveHS, pvocApplicable, pvocFee, FX } from "../engine/tariff.mjs";

/**
 * The figures spoken in the 165-second demo and printed in docs/DEMO.md.
 * If the engine, the tariff table or the PVoC schedule move, the film stops
 * matching the build; this test fails first, before a judge notices.
 */
const DEMO = {
  goods: 1_200_000,
  freight: 250_000,
  dutyRate: 0.25,
  clearing: 48_000,
  transport: 55_000,
  lastMile: 14_000,
  quantity: 20,
};

const item = resolveHS("8544.42");
const verdict = pvocApplicable({ item, originCountry: "CN" });
const fee = pvocFee({ fobUsd: DEMO.goods / FX.USD_KES, route: "A" });
const lc = landedCost({ ...DEMO, other: verdict.required ? fee.kes : 0 });
const q = quote(lc, { marginPct: 0.3 });
const f = floorPrice(lc);

const round2 = (n) => Math.round(n * 100) / 100;

test("the demo shipment is a regulated code, so a conformity fee applies", () => {
  assert.equal(verdict.required, true);
  assert.equal(fee.capped, "minimum", "the schedule minimum should bind at this value");
  assert.equal(round2(fee.kes), 34_404.95);
});

test("the landed cost spoken in the film is the engine's landed cost", () => {
  assert.equal(round2(lc.totals.cif), 1_457_250.0);
  assert.equal(round2(lc.totals.netCostExVat), 2_038_543.7);
  assert.equal(round2(lc.totals.total), 2_340_485.9);
});

test("the quote and the floor in the film are the engine's", () => {
  assert.equal(round2(q.price), 2_912_205.29);
  assert.equal(round2(q.priceIncVat), 3_378_158.14);
  assert.equal(round2(f.floorPrice), 2_398_286.71);
});

test("the margin held is inside the policy band and above the floor", () => {
  assert.equal(q.marginPct, 0.3);
  assert.ok(q.price > f.floorPrice, "the quote must sit above the 15% floor");
});
