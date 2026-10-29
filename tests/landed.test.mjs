import test from "node:test";
import assert from "node:assert/strict";
import { cif, landedCost, quote, floorPrice } from "../engine/landed.mjs";

const consignment = { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 20 };

test("CIF adds goods, freight and the insurance premium", () => {
  const b = cif({ goods: 1_200_000, freight: 250_000 });
  assert.equal(b.insurance, 7250);
  assert.equal(b.cif, 1_457_250);
});

test("statutory lines are computed on the right bases and sum to the total", () => {
  const lc = landedCost(consignment);
  const line = (code) => lc.lines.find((l) => l.code === code).amount;
  assert.equal(line("DUTY"), 364_312.5);
  assert.equal(line("IDF"), 36_431.25);
  assert.equal(line("RDL"), 29_145);
  assert.equal(line("VAT"), 301_942.2);
  assert.equal(lc.totals.statutory, 731_830.95);
  assert.equal(lc.totals.total, 2_189_080.95);
  assert.equal(lc.totals.netCostExVat, 1_887_138.75);
  assert.equal(lc.totals.perUnit, 109_454.05);
});

test("every line carries a base and a rate it can be defended with", () => {
  const lc = landedCost(consignment);
  for (const code of ["DUTY", "IDF", "RDL", "VAT"]) {
    const l = lc.lines.find((x) => x.code === code);
    assert.ok(l.base > 0, `${code} needs a base`);
    assert.ok(l.rate > 0, `${code} needs a rate`);
  }
});

test("a duty rate outside the EAC CET bands is refused", () => {
  assert.throws(() => landedCost({ ...consignment, dutyRate: 0.18 }), /not an EAC CET band/);
});

test("quote refuses anything under the 15 per cent floor", () => {
  const lc = landedCost(consignment);
  assert.throws(() => quote(lc, { marginPct: 0.1 }), /below the 15% floor/);
});

test("quote at 20 per cent prices off cost excluding recoverable VAT", () => {
  const lc = landedCost(consignment);
  const q = quote(lc, { marginPct: 0.2 });
  assert.equal(q.costExVat, 1_887_138.75);
  assert.equal(q.price, 2_358_923.44);
  assert.equal(q.grossProfit, 471_784.69);
  assert.equal(q.withinPolicyBand, false);
});

test("floor price is the cheapest defensible counter-offer", () => {
  const lc = landedCost(consignment);
  const f = floorPrice(lc);
  assert.equal(f.floorPrice, 2_220_163.24);
  const q = quote(lc, { marginPct: 0.15 });
  assert.equal(q.price, f.floorPrice);
});
