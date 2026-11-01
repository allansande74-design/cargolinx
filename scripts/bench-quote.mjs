#!/usr/bin/env node
/**
 * Measure the deterministic quote path: landed cost plus a 30% quote, end to end.
 * Prints the distribution so the README can cite a measured figure instead of a claim.
 * Usage: node scripts/bench-quote.mjs [runs]
 */
import { landedCost, quote } from "../engine/landed.mjs";

const runs = Number(process.argv[2] || 2000);
const input = { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 1 };

for (let i = 0; i < 500; i++) quote(landedCost(input), { marginPct: 0.3 });

const t = [];
for (let i = 0; i < runs; i++) {
  const t0 = process.hrtime.bigint();
  quote(landedCost(input), { marginPct: 0.3 });
  t.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
t.sort((a, b) => a - b);
const q = (p) => Number(t[Math.floor(t.length * p)].toFixed(3));
const q1 = quote(landedCost(input), { marginPct: 0.3 });
console.log(JSON.stringify({
  runs,
  median_ms: q(0.5), p95_ms: q(0.95), p99_ms: q(0.99),
  min_ms: Number(t[0].toFixed(3)), max_ms: Number(t[t.length - 1].toFixed(3)),
  landed_before_vat_kes: q1.costExVat,
  price_incl_vat_kes: q1.priceIncVat,
  margin_pct: q1.marginPct * 100,
  within_policy_band: q1.withinPolicyBand,
}, null, 2));
