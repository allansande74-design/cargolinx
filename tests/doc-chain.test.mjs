import test from "node:test";
import assert from "node:assert/strict";
import { buildQuotePayload, verifyQuotePayload } from "../src/lib/quote-qr.mjs";
import { stampDocument, verifyStampedDocument } from "../src/lib/doc-auth.mjs";
import { sealPage, verifyPageSeal, erpHook } from "../src/lib/doc-seal.mjs";

// Full chain: quote payload -> customs-declaration envelope -> page seals 1-2.
const qr = buildQuotePayload({
  quoteRef: "CLX-261031-001",
  total: 2306080.95,
  currency: "kes",
  issuedAt: "2026-10-31T00:00:00.000Z",
});

test("quote payload verifies ok:true", () => {
  const r = verifyQuotePayload(qr);
  assert.equal(r.ok, true);
  assert.equal(r.data.quoteRef, "CLX-261031-001");
  assert.equal(r.data.currency, "KES");
});

const env = stampDocument({
  docType: "customs-declaration",
  docRef: "CLX-261031-001",
  issuer: "ALTOVEX GLOBAL LOGISTICS",
  figures: { total: 2306080.95, currency: "KES", qr },
});

test("customs-declaration envelope verifies ok:true", () => {
  const r = verifyStampedDocument(env);
  assert.equal(r.ok, true);
  assert.equal(r.data.docType, "customs-declaration");
  assert.equal(r.data.docRef, "CLX-261031-001");
});

test("page seals 1-2 verify ok:true", () => {
  for (const pageNo of [1, 2]) {
    const { sealA, sealB } = sealPage({ docRef: env.docRef, pageNo, issuedAt: env.issuedAt });
    const r = verifyPageSeal({ docRef: env.docRef, pageNo, issuedAt: env.issuedAt, sealA, sealB });
    assert.equal(r.ok, true, `page ${pageNo} seal failed`);
  }
});

test("tampered seal verifies ok:false", () => {
  const { sealA, sealB } = sealPage({ docRef: env.docRef, pageNo: 1, issuedAt: env.issuedAt });
  const last = sealA.slice(-1);
  const flipped = last === "0" ? "1" : "0"; // guarantee actually different
  const r = verifyPageSeal({ docRef: env.docRef, pageNo: 1, issuedAt: env.issuedAt, sealA: sealA.slice(0, -1) + flipped, sealB });
  assert.equal(r.ok, false);
  assert.equal(r.error, "seal mismatch");
});

test("junk envelope verifies ok:false", () => {
  const r = verifyStampedDocument({ garbage: true });
  assert.equal(r.ok, false);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
});

test("erpHook payload has event/docRef/at/source shape", () => {
  const h = erpHook({ event: "doc.sealed", docRef: env.docRef });
  assert.equal(h.event, "doc.sealed");
  assert.equal(h.docRef, "CLX-261031-001");
  assert.ok(!Number.isNaN(Date.parse(h.at)), "at must be parseable date");
  assert.equal(h.source, "cargolinx");
});
