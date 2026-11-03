// The quote is issued on CIF. These tests keep the scope list complete and keep the importer's costs out
// of our stack - the two ways a CIF quote is usually got wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CIF_SCOPE, TRADE_TERM, buyerObligations, isImporterCost } from "../engine/incoterms.mjs";

test("the house term is CIF against a named Chinese port", () => {
  assert.equal(TRADE_TERM, "CIF");
  assert.equal(CIF_SCOPE.term, "CIF");
  assert.match(CIF_SCOPE.named, /Chinese port/);
});

test("the seller side carries carriage and insurance, and no duty of any kind", () => {
  const seller = CIF_SCOPE.seller.join(" ").toLowerCase();
  assert.match(seller, /ocean freight/);
  assert.match(seller, /insurance/);
  assert.match(seller, /export/);
  assert.doesNotMatch(seller, /duty/);
  assert.doesNotMatch(seller, /vat/);
  assert.doesNotMatch(seller, /inland processing/);
});

test("the importer takes clearance, duty, inland, processing and the last mile", () => {
  const buyer = buyerObligations().join(" ").toLowerCase();
  for (const word of ["import clearance", "duty", "inland", "processing", "last-mile"]) {
    assert.ok(buyer.includes(word), `the importer's list should name ${word}`);
  }
});

test("risk passes on board, not at the destination quay", () => {
  assert.match(CIF_SCOPE.riskPasses, /on board at Mombasa/);
  assert.doesNotMatch(CIF_SCOPE.riskPasses, /quay, and/);
});

test("the insurance minimum is named, with the higher cover priced rather than assumed", () => {
  assert.match(CIF_SCOPE.insurance, /Clauses \(C\)/);
  assert.match(CIF_SCOPE.insurance, /110%/);
  assert.match(CIF_SCOPE.insurance, /\(A\) priced on request/);
});

test("a cost line is recognised as the importer's when it belongs to them", () => {
  assert.equal(isImporterCost("Chinese import duty"), true);
  assert.equal(isImporterCost("Inland haulage and processing in China"), true);
  assert.equal(isImporterCost("Ocean freight to Shanghai"), false);
});
