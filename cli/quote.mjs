#!/usr/bin/env node
/**
 * Quote a consignment from the deterministic engine and print the itemised card.
 * Usage: node cli/quote.mjs --goods 1200000 --freight 250000 --duty 0.25 --margin 0.2 --qty 20
 */
import { landedCost, quote, floorPrice } from "../engine/landed.mjs";
import { POLICY } from "../engine/pricing-policy.mjs";
import { resolveHS, pvocApplicable, pvocFee, FX } from "../engine/tariff.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const num = (name, dflt) => Number(arg(name, dflt));

const input = {
  goods: num("goods", 1_200_000),
  freight: num("freight", 250_000),
  insurance: args.includes("--insurance") ? num("insurance", 0) : undefined,
  dutyRate: num("duty", 0.25),
  exciseRate: num("excise", 0),
  portCharges: num("port", 0),
  clearing: num("clearing", 0),
  transport: num("transport", 0),
  lastMile: num("lastmile", 0),
  other: num("other", 0),
  quantity: num("qty", 1),
};

// A regulated code carries a conformity fee; the desk adds it, so the CLI must too,
// or the two paths quote different totals for the same shipment.
const hs = arg("hs", null);
let pvocNote = "";
if (hs) {
  const item = resolveHS(hs);
  const origin = String(arg("origin", "CN")).toUpperCase();
  const verdict = pvocApplicable({ item, originCountry: origin });
  if (verdict.required) {
    const fee = pvocFee({ fobUsd: input.goods / FX.USD_KES, route: arg("pvoc-route", "A") });
    input.other += fee.kes;
    pvocNote = `PVoC route ${fee.route} on FOB USD ${fee.fobUsd.toFixed(2)}: USD ${fee.usd.toFixed(2)} = KES ${fee.kes.toLocaleString("en-KE", { minimumFractionDigits: 2 })}${fee.capped ? ` (${fee.capped} of the schedule)` : ""}`;
  } else {
    pvocNote = `PVoC not charged: ${verdict.reason}`;
  }
}

const lc = landedCost(input);
const margin = num("margin", 0.2);
const q = quote(lc, { marginPct: margin });
const f = floorPrice(lc, POLICY.minMargin);

const money = (n) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nCARGOLINX LANDED COST  —  ${lc.currency}  —  ${input.quantity} unit(s)`);
console.log("-".repeat(72));
for (const l of lc.lines) {
  if (l.amount === 0 && !["CIF"].includes(l.code)) continue;
  const basis = l.base ? `on ${money(l.base)}` : "";
  console.log(`${pad(l.label, 44)}${pad(basis, 20)}${money(l.amount).padStart(14)}`);
}
console.log("-".repeat(72));
console.log(`${pad("Statutory total", 64)}${money(lc.totals.statutory).padStart(14)}`);
console.log(`${pad("Landed cost incl. VAT", 64)}${money(lc.totals.total).padStart(14)}`);
console.log(`${pad("Landed cost excl. recoverable VAT", 64)}${money(lc.totals.netCostExVat).padStart(14)}`);
console.log(`${pad("Cost per unit excl. VAT", 64)}${money(lc.totals.perUnit).padStart(14)}`);
// The desk's pricing policy (target, floor, concession) is internal. It prints only when the
// operator asks for it with --show-policy; the default output a developer or a screen-share
// shows carries the price, not the policy.
const showPolicy = process.argv.includes("--show-policy");
const policyLine = showPolicy
  ? `   (target ${(POLICY.targetMargin * 100).toFixed(0)}%, floor ${(POLICY.minMargin * 100).toFixed(0)}%, concession ${(POLICY.negotiationRoom * 100).toFixed(0)}%)`
  : "";
console.log(`\nQUOTE at ${(q.marginPct * 100).toFixed(1)}% margin${policyLine}`);
console.log(`${pad("Selling price excl. VAT", 64)}${money(q.price).padStart(14)}`);
console.log(`${pad("VAT on sale", 64)}${money(q.vatOnSale).padStart(14)}`);
console.log(`${pad("Selling price incl. VAT", 64)}${money(q.priceIncVat).padStart(14)}`);
console.log(`${pad("Gross profit", 64)}${money(q.grossProfit).padStart(14)}`);
console.log(`${pad(showPolicy ? `Cheapest defensible price (${(POLICY.minMargin * 100).toFixed(0)}% floor)` : "Cheapest defensible price", 64)}${money(f.floorPrice).padStart(14)}`);
console.log(`${pad(showPolicy ? `Price after ${(POLICY.negotiationRoom * 100).toFixed(0)}% concession` : "Price after the desk's concession", 64)}${money(q.price * (1 - POLICY.negotiationRoom)).padStart(14)}`);
if (pvocNote) console.log(pvocNote);
console.log("");
