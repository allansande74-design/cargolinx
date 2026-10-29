import test from "node:test";
import assert from "node:assert/strict";
import { buildDossier, dossierStatus, setDocStatus, needsPhytosanitary } from "../engine/docs.mjs";
import { expressReadiness, integrationState, country, COUNTRY_EXTRAS } from "../engine/countries.mjs";

const base = { hs: "1006.30", originCountry: "CN", destinationCountry: "KE" };

test("an import file carries the documents a clearance actually needs", () => {
  const docs = buildDossier(base, { pvocRequired: true });
  const codes = docs.map((d) => d.code);
  for (const c of ["commercial_invoice", "packing_list", "transport_document", "insurance_certificate", "certificate_of_origin", "pvoc_certificate", "import_entry", "duty_payment"]) {
    assert.ok(codes.includes(c), `missing ${c}`);
  }
});

test("EAC origin swaps the certificate of origin for the EAC one", () => {
  const docs = buildDossier({ ...base, originCountry: "UG" }, { eacOrigin: true });
  const codes = docs.map((d) => d.code);
  assert.ok(codes.includes("eac_certificate_of_origin"));
  assert.ok(!codes.includes("certificate_of_origin"));
});

test("plant and plant-product codes require a phytosanitary certificate", () => {
  assert.equal(needsPhytosanitary("1006.30"), true);
  assert.equal(needsPhytosanitary("8471.30"), false);
  const docs = buildDossier({ ...base, hs: "0808.10" }, {});
  assert.ok(docs.some((d) => d.code === "phytosanitary" && d.mandatory));
  assert.match(docs.find((d) => d.code === "phytosanitary").issuer, /KEPHIS/);
});

test("transit goods need a bond", () => {
  const docs = buildDossier({ ...base, isTransit: true }, {});
  assert.ok(docs.some((d) => d.code === "transit_bond" && d.mandatory));
});

test("a fresh file is not ready to lodge and names the next action", () => {
  const docs = buildDossier(base, { pvocRequired: true });
  const status = dossierStatus(docs);
  assert.equal(status.readyToLodge, false);
  assert.ok(status.missingCount >= 6);
  assert.match(status.nextAction, /^Obtain /);
});

test("verifying a document that was never attached is refused", () => {
  const docs = buildDossier(base, {});
  assert.throws(() => setDocStatus(docs, "commercial_invoice", "verified"), /attach the document before verifying/);
});

test("once every mandatory document is verified the file is ready", () => {
  let docs = buildDossier(base, { pvocRequired: true });
  for (const d of docs.filter((x) => x.mandatory)) {
    docs = setDocStatus(docs, d.code, "attached");
    docs = setDocStatus(docs, d.code, "verified");
  }
  const status = dossierStatus(docs);
  assert.equal(status.readyToLodge, true);
  assert.equal(status.missingCount, 0);
});

test("the country registry states what it cannot do", () => {
  const ke = country("KE");
  assert.equal(ke.customs, "KRA iCMS");
  const state = integrationState("KE");
  assert.equal(state.canFile, false);
  assert.equal(state.canPreValidate, true);
  assert.match(state.statement, /licensed agent/);
});

test("an unknown country is refused instead of defaulted", () => {
  assert.throws(() => country("ZZ"), /unknown country/);
});

test("express readiness is red while documents are missing", () => {
  const docs = buildDossier(base, { pvocRequired: true });
  const r = expressReadiness({ dossier: docs, dutyTreatment: { resolved: true }, pvoc: { required: true, certificateAttached: false } });
  assert.equal(r.lane, "red");
  assert.ok(r.reasons.some((x) => /PVoC/.test(x)));
});

test("a fully verified file on a trusted-trader account reaches green", () => {
  let docs = buildDossier(base, { pvocRequired: true });
  for (const d of docs.filter((x) => x.mandatory)) {
    docs = setDocStatus(docs, d.code, "attached");
    docs = setDocStatus(docs, d.code, "verified");
  }
  const r = expressReadiness({
    dossier: docs,
    dutyTreatment: { resolved: true, preferential: null },
    pvoc: { required: true, certificateAttached: true },
    traderProfile: { aeo: true },
  });
  assert.equal(r.lane, "green");
  assert.match(r.meaning, /document checks only/);
});

test("country extras exist for every country in the registry", () => {
  for (const code of ["KE", "UG", "TZ", "RW", "BI", "SS", "CD"]) {
    assert.ok(Array.isArray(COUNTRY_EXTRAS[code]), `no extras for ${code}`);
  }
});
