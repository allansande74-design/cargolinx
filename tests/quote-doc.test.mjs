import test from "node:test";
import assert from "node:assert/strict";
import { landedCost, quote } from "../engine/landed.mjs";
import { quoteHtml } from "../src/lib/quote-doc.mjs";

const shipment = {
  ref: "CLX-261029-891",
  cargo: "20ft container, solar panels",
  origin: "Nairobi",
  destination: "Kampala",
  qty: 20,
  weightKg: 18500,
  dutyRate: 0.25,
  value: { goods: 1_200_000, freight: 250_000 },
  services: { clearing: 45_000, transport: 60_000, lastMile: 12_000 },
};
const lc = landedCost({ ...shipment.value, dutyRate: 0.25, clearing: 45_000, transport: 60_000, lastMile: 12_000, quantity: 20 });
const q = quote(lc, { marginPct: 0.3 });
const html = quoteHtml({ shipment, lc, q, today: new Date("2026-10-29T09:00:00Z") });

test("the document restates the engine total, not a new one", () => {
  assert.ok(html.includes("2,306,080.95"), "landed total missing");
  assert.ok(html.includes(q.priceIncVat.toLocaleString("en-KE", { minimumFractionDigits: 2 })), "price incl VAT missing");
});

test("every statutory line appears with its rate", () => {
  for (const needle of ["Import duty (EAC CET 25%)", "Import declaration fee (2.5%)", "Railway development levy (2%)", "VAT (16%)", "25.00%", "2.50%", "16.00%"]) {
    assert.ok(html.includes(needle), `missing ${needle}`);
  }
});

test("the document carries the company block and the signatory", () => {
  assert.ok(html.includes("ALTOVEX GLOBAL LOGISTICS"));
  assert.ok(html.includes("altovexgl@gmail.com"));
  assert.ok(html.includes("Sande Allan"));
  assert.ok(html.includes("CLX-261029-891"));
});

test("it states the basis and the caveat rather than implying certainty", () => {
  assert.ok(html.includes("PwC Kenya tax summaries"));
  assert.ok(html.includes("subject to KRA assessment"));
});

test("a quote under the floor can never reach a document", () => {
  assert.throws(() => quote(lc, { marginPct: 0.12 }), /below the 15% floor/);
});
