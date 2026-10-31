// Render the demo quotation to HTML using the product's own document builder.
import { writeFileSync } from "node:fs";
import { landedCost, quote } from "../engine/landed.mjs";
import { quoteHtml } from "../src/lib/quote-doc.mjs";

const shipment = {
  ref: "CLX-261031-714",
  cargo: "20 ft container — electrical cable, fitted with connectors",
  origin: "Mombasa",
  destination: "Kampala",
  qty: 20,
  weightKg: 12000,
  dutyRate: 0.25,
  value: { goods: 1_200_000, freight: 250_000 },
  services: { clearing: 48_000, transport: 55_000, lastMile: 14_000 },
};
const lc = landedCost({
  goods: 1_200_000,
  freight: 250_000,
  dutyRate: 0.25,
  clearing: 48_000,
  transport: 55_000,
  lastMile: 14_000,
  quantity: 20,
  other: 34_404.95,
});
const q = quote(lc, { marginPct: 0.3 });
const html = quoteHtml({ shipment, lc, q, today: new Date() });
writeFileSync(new URL("../../out/demo/quote.html", import.meta.url), html);
console.log(
  JSON.stringify({
    landedExVat: lc.totals.netCostExVat,
    landedInclVat: lc.totals.netCostInclVat,
    priceExVat: q.price,
    priceInclVat: q.priceIncVat,
    bytes: html.length,
  })
);
