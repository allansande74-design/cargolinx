import test from "node:test";
import assert from "node:assert/strict";
import {
  addSupplier,
  verifySupplier,
  scoreSupplier,
  buildPurchaseOrder,
  compareSuppliers,
  clampScore,
  PAYMENT_TERMS,
  SCORE_RANGE,
} from "../engine/suppliers.mjs";
import { purchaseOrderHtml } from "../src/lib/supplier-docs.mjs";

const base = {
  name: "Kunpeng Solar Manufacturing",
  country: "cn",
  contact: { email: "sales@kunpeng.example", phone: "+86 755 000 0000", person: "L. Wei" },
  products: ["Solar panels 450W", "Mounting rails"],
  certifications: ["ISO 9001:2015", "CE", "RoHS"],
  leadTimeDays: 28,
  paymentTerms: "net30",
};

const verified = verifySupplier(addSupplier(base), { by: "Sande Allan", reference: "ISO 9001 cert 2026-114" });

const order = { id: "ord_1", accountId: "acc_1", currency: "KES", destination: "Nairobi, Kenya", incoterm: "DAP" };
const lines = [
  { description: "Solar panels 450W", qty: 200, unitPrice: 12000 },
  { description: "Mounting rails", qty: 100, unitPrice: 1500 },
];

test("a supplier cannot be registered without a name, a two-letter country and known terms", () => {
  assert.throws(() => addSupplier({ ...base, name: "  " }), /supplier name required/);
  assert.throws(() => addSupplier({ ...base, country: "China" }), /two-letter code/);
  assert.throws(() => addSupplier({ ...base, country: "" }), /two-letter code/);
  assert.throws(() => addSupplier({ ...base, paymentTerms: "net90" }), /unknown payment terms/);
  assert.deepEqual(PAYMENT_TERMS, ["prepayment", "net15", "net30", "lc"]);
});

test("a new supplier is unverified, and a country code is stored upper case", () => {
  const s = addSupplier(base);
  assert.equal(s.status, "unverified");
  assert.equal(s.verifiedAt, null);
  assert.equal(s.country, "CN");
  assert.deepEqual(s.products, ["Solar panels 450W", "Mounting rails"]);
  assert.equal(s.contact.email, "sales@kunpeng.example");
});

test("a supplier registered with a claimed verification date is still unverified", () => {
  const s = addSupplier({ ...base, verifiedAt: "2026-01-05T00:00:00Z" });
  assert.equal(s.status, "unverified");
  assert.equal(s.verifiedAt, null);
  assert.equal(s.claimedVerifiedAt, "2026-01-05T00:00:00Z");
});

test("verification without a reference is refused", () => {
  const s = addSupplier(base);
  assert.throws(() => verifySupplier(s, { by: "Sande Allan" }), /reference/);
  assert.throws(() => verifySupplier(s, { by: "Sande Allan", reference: "   " }), /reference/);
  assert.equal(s.status, "unverified");
});

test("verification records who checked the supplier and against what", () => {
  const s = verifySupplier(addSupplier(base), { by: "Sande Allan", reference: "PVoC CoC KE-2026-88", at: new Date("2026-10-01T09:00:00Z") });
  assert.equal(s.status, "verified");
  assert.equal(s.verification.by, "Sande Allan");
  assert.equal(s.verification.reference, "PVoC CoC KE-2026-88");
  assert.equal(s.verifiedAt, "2026-10-01T09:00:00.000Z");
  assert.equal(s.history.at(-1).event, "verified");
});

test("an unverified supplier cannot receive a purchase order", () => {
  const s = addSupplier(base);
  assert.throws(() => buildPurchaseOrder({ order, supplier: s, lines, number: "PO-0001" }), /not verified/);
});

test("a purchase order line without a unit price is refused", () => {
  const missing = [{ ...lines[0] }, { description: "Mounting rails", qty: 100 }];
  assert.throws(() => buildPurchaseOrder({ order, supplier: verified, lines: missing, number: "PO-0001" }), /no unit price/);
  assert.throws(
    () => buildPurchaseOrder({ order, supplier: verified, lines: [{ description: "Rails", qty: 10, unitPrice: null }], number: "PO-0001" }),
    /no unit price/,
  );
});

test("a purchase order totals the lines and carries no tax line", () => {
  const po = buildPurchaseOrder({ order, supplier: verified, lines, number: "PO-2026-0001", at: new Date("2026-10-02T08:00:00Z") });
  assert.equal(po.number, "PO-2026-0001");
  assert.equal(po.status, "issued");
  assert.equal(po.supplierId, verified.id);
  assert.equal(po.orderId, "ord_1");
  assert.equal(po.issuedAt, "2026-10-02T08:00:00.000Z");
  assert.equal(po.subtotal, 200 * 12000 + 100 * 1500);
  assert.equal(po.total, po.subtotal);
  assert.deepEqual(Object.keys(po).sort(), ["issuedAt", "lines", "number", "orderId", "status", "subtotal", "supplierId", "total"]);
  assert.equal(po.lines[0].amount, 2_400_000);
  assert.equal(po.vat, undefined);
});

test("scoring arithmetic is stated and adds up", () => {
  // 60 base + 10 verified + 15 for three recognised certificates + 5 for net30 terms
  const best = scoreSupplier(verified);
  assert.equal(best.score, 90);
  assert.ok(best.reasons.some((r) => /verified against a reference/.test(r)));
  assert.ok(best.reasons.some((r) => /3 recognised certifications \(\+15\)/.test(r)));
  assert.ok(best.reasons.some((r) => /net30 terms/.test(r)));

  // certificates are capped at +15 even when more schemes are held
  const many = scoreSupplier({ ...verified, certifications: ["ISO 9001", "ISO 14001", "ISO 45001", "CE", "RoHS", "HACCP"] });
  assert.equal(many.score, 90);

  // two certificates earn 10, and prepayment earns no bonus
  const mid = scoreSupplier({ ...verified, certifications: ["CE", "RoHS"], paymentTerms: "prepayment" });
  assert.equal(mid.score, 80);

  // unverified, no certificates, slow, unreachable, paying first: 60 - 10 - 10
  const worst = scoreSupplier({ ...addSupplier(base), certifications: [], leadTimeDays: 60, contact: null, paymentTerms: "prepayment" });
  assert.equal(worst.score, 40);
  assert.ok(worst.reasons.some((r) => /lead time 60 days is over 45/.test(r)));
  assert.ok(worst.reasons.some((r) => /no contact email/.test(r)));
  assert.ok(worst.reasons.some((r) => /not verified/.test(r)));
});

test("a certificate the register does not know is named, not counted", () => {
  const s = scoreSupplier({ ...verified, certifications: ["ISO 9001", "ISO 9999 wizardry"] });
  assert.equal(s.score, 80); // 60 + 10 verified + 5 one valid certificate + 5 net30
  assert.ok(s.reasons.some((r) => /not recognised: ISO 9999 wizardry/.test(r)));
});

test("the score is clamped to the 0-100 band", () => {
  assert.equal(clampScore(-20), SCORE_RANGE.min);
  assert.equal(clampScore(0), 0);
  assert.equal(clampScore(74.4), 74);
  assert.equal(clampScore(140), SCORE_RANGE.max);
  assert.equal(clampScore("junk"), 0);
  // and no reachable register combination escapes the band
  const extremes = [
    scoreSupplier(verified),
    scoreSupplier({ status: "unverified", certifications: [], leadTimeDays: 400, contact: {}, paymentTerms: "prepayment" }),
    scoreSupplier({ status: "verified", certifications: Object.keys({ iso9001: 1 }), leadTimeDays: 1, contact: { email: "a@b.co" }, paymentTerms: "lc" }),
  ];
  for (const s of extremes) {
    assert.ok(s.score >= 0 && s.score <= 100, `score ${s.score} outside 0-100`);
  }
});

test("compareSuppliers keeps only suppliers of the product, ranked by score with lead times stated", () => {
  const cheap = verified; // 90
  const slow = verifySupplier(
    addSupplier({ ...base, name: "Nairobi Trading", country: "ke", leadTimeDays: 70, paymentTerms: "net15", certifications: ["CE"] }),
    { by: "Sande Allan", reference: "CR12-2026-44" },
  );
  const unverifiedFast = addSupplier({ ...base, name: "Shenzhen Fastparts", country: "CN", leadTimeDays: 12, paymentTerms: "prepayment", certifications: [] });
  const unrelated = addSupplier({ ...base, name: "Textile Mill", products: ["Cotton fabric"], certifications: ["GOTS"] });

  const ranked = compareSuppliers([slow, unverifiedFast, cheap, unrelated], { product: "solar PANELS 450w", qty: 200 });

  assert.equal(ranked.length, 3, "the textile mill does not supply solar panels");
  assert.deepEqual(ranked.map((r) => r.name), ["Kunpeng Solar Manufacturing", "Nairobi Trading", "Shenzhen Fastparts"]);
  assert.ok(ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score);
  assert.equal(ranked[0].leadTimeDays, 28);
  assert.equal(ranked[1].leadTimeDays, 70);
  assert.equal(ranked[2].leadTimeDays, 12);
  assert.ok(!ranked.some((r) => r.name === "Textile Mill"));
});

test("compareSuppliers refuses to guess which product it is ranking for", () => {
  assert.throws(() => compareSuppliers([verified], {}), /product is required/);
  assert.deepEqual(compareSuppliers([], { product: "solar panels" }), []);
});

test("the printed purchase order states the supplier, the number, the lines and the signatory", () => {
  const po = buildPurchaseOrder({ order, supplier: verified, lines, number: "PO-2026-0001" });
  const html = purchaseOrderHtml({ po, supplier: verified, order, today: new Date("2026-10-02T08:00:00Z") });

  assert.match(html, /Kunpeng Solar Manufacturing/);
  assert.match(html, /PO-2026-0001/);
  assert.match(html, /Solar panels 450W/);
  assert.match(html, /Mounting rails/);
  assert.match(html, /2,400,000\.00/); // 200 × 12,000
  assert.match(html, /2,550,000\.00/); // subtotal and total both printed
  assert.match(html, /Authorised signatory: Sande Allan/);
  assert.match(html, /02 October 2026/);
  assert.match(html, /^<!doctype html>/);
});

test("a purchase order carries no tax line", () => {
  const po = buildPurchaseOrder({ order, supplier: verified, lines, number: "PO-2026-0001" });
  const html = purchaseOrderHtml({ po, supplier: verified, order });
  assert.doesNotMatch(html, /VAT/i);
  assert.doesNotMatch(html, /\b16%|\b8%/);
});

test("the heading document takes the seller letterhead, not the platform one", () => {
  const po = buildPurchaseOrder({ order, supplier: verified, lines, number: "PO-9" });
  const html = purchaseOrderHtml({ po, supplier: verified, order });
  assert.match(html, /ALTOVEX GLOBAL LOGISTICS CO\. LTD/);
  assert.doesNotMatch(html, /ALTOVEX CARGOLINX/);
});

test("values are escaped and nothing leaks as undefined", () => {
  const supplier = verifySupplier(addSupplier({ ...base, name: "A & B <Trading> Co" }), { by: "Sande Allan", reference: "REF-1" });
  const po = buildPurchaseOrder({ order, supplier, lines: [{ description: "Bracket <10mm> & bolts", qty: 5, unitPrice: 99.5 }], number: "PO-10" });
  const html = purchaseOrderHtml({ po, supplier, order });
  assert.match(html, /A &amp; B &lt;Trading&gt; Co/);
  assert.match(html, /Bracket &lt;10mm&gt; &amp; bolts/);
  assert.doesNotMatch(html, /undefined/);
  assert.doesNotMatch(html, /NaN/);
});
