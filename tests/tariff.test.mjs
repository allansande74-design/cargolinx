import test from "node:test";
import assert from "node:assert/strict";
import { resolveHS, dutyTreatment, pvocFee, pvocApplicable, waiverAdjustment, FX } from "../engine/tariff.mjs";

test("a known HS code resolves to an EAC band with its source stated", () => {
  const r = resolveHS("1006.30");
  assert.equal(r.band, 0.35);
  assert.equal(r.pvoc, true);
  assert.match(r.source, /CET 2022/);
});

test("an unknown HS code is left unresolved rather than guessed", () => {
  const r = resolveHS("9999.99");
  assert.equal(r.band, null);
  assert.match(r.source, /classify/);
});

test("a malformed code is refused", () => {
  assert.equal(resolveHS("rice"), null);
  assert.equal(resolveHS(""), null);
});

test("non-EAC origin pays the CET band", () => {
  const t = dutyTreatment({ hs: "1006.30", originCountry: "CN" });
  assert.equal(t.dutyRate, 0.35);
  assert.equal(t.preferential, null);
});

test("EAC origin with a certificate pays nothing", () => {
  const t = dutyTreatment({ hs: "1006.30", originCountry: "UG", hasEacCertificateOfOrigin: true });
  assert.equal(t.dutyRate, 0);
  assert.match(t.preferential, /EAC customs union/);
  assert.ok(t.documentsRequired.includes("EAC Certificate of Origin"));
});

test("EAC origin without the certificate pays the full band", () => {
  const t = dutyTreatment({ hs: "1006.30", originCountry: "UG", hasEacCertificateOfOrigin: false });
  assert.equal(t.dutyRate, 0.35);
  assert.match(t.documentsRequired[0], /not yet attached/);
});

test("PVoC fee is a percentage of FOB, floored and capped in dollars", () => {
  const small = pvocFee({ fobUsd: 10_000 });
  assert.equal(small.usd, 265); // 0.6% = 60, so the floor applies
  assert.equal(small.capped, "minimum");

  const big = pvocFee({ fobUsd: 900_000 });
  assert.equal(big.usd, 2700); // 0.6% = 5400, so the cap applies
  assert.equal(big.capped, "maximum");

  const mid = pvocFee({ fobUsd: 100_000 });
  assert.equal(mid.usd, 600);
  assert.equal(mid.capped, null);
  assert.ok(mid.kes > 77_000 && mid.kes < 78_500);
});

test("route C is cheaper than route A on the same FOB", () => {
  const a = pvocFee({ fobUsd: 100_000, route: "A" });
  const c = pvocFee({ fobUsd: 100_000, route: "C" });
  assert.ok(c.usd < a.usd);
});

test("the FX rate used is stated with the fee", () => {
  const f = pvocFee({ fobUsd: 100_000 });
  assert.equal(f.fx, FX.USD_KES);
  assert.match(FX.source, /er-api/);
});

test("a waiver without a reference cannot be applied", () => {
  const w = waiverAdjustment({ type: "diplomatic" });
  assert.equal(w.valid, false);
  assert.equal(w.requires.length, 2);
});

test("a waiver with a reference is applied but still flagged for verification", () => {
  const w = waiverAdjustment({ type: "epz", reference: "EPZ/2026/441" });
  assert.equal(w.dutyRate, 0);
  assert.equal(w.valid, true);
  assert.match(w.note, /verify/);
});

test("PVoC does not apply to EAC-origin goods held under a certificate of origin", () => {
  const item = resolveHS("1006.30");
  const eac = pvocApplicable({ item, originCountry: "UG", hasEacCertificateOfOrigin: true });
  assert.equal(eac.required, false);
  assert.match(eac.reason, /certificate of origin governs/);
  const imported = pvocApplicable({ item, originCountry: "CN" });
  assert.equal(imported.required, true);
});

test("an unregulated category needs no conformity certificate", () => {
  const item = { pvoc: false };
  assert.equal(pvocApplicable({ item, originCountry: "CN" }).required, false);
});
