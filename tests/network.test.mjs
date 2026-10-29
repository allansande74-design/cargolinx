import test from "node:test";
import assert from "node:assert/strict";
import {
  AFRICA_26,
  BLOCS,
  coverage,
  defineDataset,
  datasetFingerprint,
  membershipOf,
  quoteGate,
  transitBlocs,
} from "../engine/network.mjs";

const TODAY = "2026-10-29";

/** A dataset shape a caller would plausibly supply for Kenya, with cited sources. */
function kenyaDataset(overrides = {}) {
  return defineDataset({
    country: "KE",
    effectiveFrom: "2026-01-01",
    verifiedOn: "2026-10-29",
    sources: ["EAC Common External Tariff 2022 (EAC Secretariat), Kenya schedule"],
    duties: [{ hs: "1006.30", rate: 0.35 }],
    vat: 0.16,
    levies: [],
    today: TODAY,
    ...overrides,
  });
}

test("the registry holds exactly 26 countries with unique codes", () => {
  assert.equal(AFRICA_26.length, 26);
  const codes = AFRICA_26.map((r) => r.code);
  assert.equal(new Set(codes).size, 26);
  for (const code of codes) assert.match(code, /^[A-Z]{2}$/);
});

test("every record carries the fields a quote needs, with a bloc from the three covered blocs", () => {
  for (const record of AFRICA_26) {
    assert.equal(typeof record.code, "string");
    assert.equal(typeof record.name, "string");
    assert.ok(record.name.length > 0);
    assert.ok(Array.isArray(record.bloc) && record.bloc.length > 0, `${record.code} has no bloc`);
    for (const bloc of record.bloc) assert.ok(["EAC", "COMESA", "SADC"].includes(bloc), `${record.code}: bad bloc ${bloc}`);
    assert.equal(new Set(record.bloc).size, record.bloc.length, `${record.code}: duplicate bloc`);
    assert.match(record.currency, /^[A-Z]{3}$/);
    assert.equal(typeof record.customsSystem, "string");
    assert.ok(record.customsSystem.length > 0);
    assert.equal(record.integration, "manual");
    assert.ok(["verified", "draft"].includes(record.datasetStatus));
    assert.ok(Array.isArray(record.citations) && record.citations.length > 0, `${record.code} has no citation`);
  }
});

test("Kenya is the only verified country and the other 25 are draft", () => {
  const verified = AFRICA_26.filter((r) => r.datasetStatus === "verified");
  const draft = AFRICA_26.filter((r) => r.datasetStatus === "draft");
  assert.deepEqual(verified.map((r) => r.code), ["KE"]);
  assert.equal(verified.length, 1);
  assert.equal(draft.length, 25);
  assert.equal(verified.length + draft.length, 26);

  const kenya = AFRICA_26.find((r) => r.code === "KE");
  assert.match(kenya.citations[0], /CET\)? 2022/);
  assert.ok(kenya.citations.length >= 1);
});

test("every record cites something, and no draft citation smuggles in a rate", () => {
  for (const record of AFRICA_26) {
    const citations = record.citations;
    assert.ok(citations.length >= 1, `${record.code} has no citation`);
    for (const citation of citations) {
      assert.equal(typeof citation, "string");
      assert.ok(citation.trim().length > 20, `${record.code}: citation too thin — ${citation}`);
    }
    if (record.datasetStatus === "draft") {
      for (const citation of citations) {
        // A draft explains what must be confirmed; it must not carry a duty, VAT or levy figure.
        assert.doesNotMatch(citation, /\d+(\.\d+)?\s*%/, `${record.code} citation states a rate: ${citation}`);
        assert.doesNotMatch(citation, /\b(?:usd|kes|ksh|eur)\b\s*[\d,]/i, `${record.code} citation states an amount: ${citation}`);
        assert.match(citation, /confirm/i, `${record.code} citation must say what to confirm`);
      }
    }
  }
});

test("bloc membership is derived from the registry, not kept by hand", () => {
  assert.deepEqual(Object.keys(BLOCS), ["EAC", "COMESA", "SADC"]);
  for (const [bloc, members] of Object.entries(BLOCS)) {
    const expected = AFRICA_26.filter((r) => r.bloc.includes(bloc)).map((r) => r.code);
    assert.deepEqual(members, expected);
    for (const code of members) {
      const record = AFRICA_26.find((r) => r.code === code);
      assert.ok(record.bloc.includes(bloc));
    }
  }
  assert.equal(BLOCS.EAC.length, 7);
  assert.deepEqual(BLOCS.EAC, ["KE", "UG", "TZ", "RW", "BI", "SS", "CD"]);
  assert.ok(BLOCS.COMESA.includes("KE") && BLOCS.COMESA.includes("ZM"));
  assert.ok(BLOCS.SADC.includes("ZA") && BLOCS.SADC.includes("TZ"));
  // every registry country appears in at least one bloc list
  for (const record of AFRICA_26) {
    const inSomeBloc = Object.values(BLOCS).some((members) => members.includes(record.code));
    assert.ok(inSomeBloc, `${record.code} is in no bloc list`);
  }
});

test("membershipOf reads the record's blocs and is empty for an unknown code", () => {
  assert.deepEqual(membershipOf("KE"), ["EAC", "COMESA"]);
  assert.deepEqual(membershipOf("ke"), ["EAC", "COMESA"]);
  assert.deepEqual(membershipOf("CD"), ["EAC", "COMESA", "SADC"]);
  assert.deepEqual(membershipOf("ZA"), ["SADC"]);
  assert.deepEqual(membershipOf("SS"), ["EAC"]);
  assert.deepEqual(membershipOf("GH"), []);
  assert.deepEqual(membershipOf(null), []);
});

test("coverage counts what is quotable rather than what is listed", () => {
  const c = coverage();
  assert.equal(c.total, 26);
  assert.equal(c.verified, 1);
  assert.equal(c.draft, 25);
  assert.equal(c.byBloc.EAC, BLOCS.EAC.length);
  assert.equal(c.byBloc.COMESA, BLOCS.COMESA.length);
  assert.equal(c.byBloc.SADC, BLOCS.SADC.length);
});

test("a dataset without sources is refused", () => {
  assert.throws(() => kenyaDataset({ sources: [] }), /no sources/);
  assert.throws(() => kenyaDataset({ sources: undefined }), /no sources/);
  assert.throws(() => kenyaDataset({ sources: ["  "] }), /blank source/);
});

test("a dataset verified in the future is refused", () => {
  assert.throws(() => kenyaDataset({ verifiedOn: "2027-01-01" }), /future|cannot be recorded/);
  // and the same date is fine once today has caught up with it
  assert.doesNotThrow(() => kenyaDataset({ verifiedOn: "2027-01-01", today: "2027-01-02" }));
  assert.throws(() => kenyaDataset({ verifiedOn: "29/10/2026" }), /ISO date/);
});

test("a dataset for a country outside the registry is refused", () => {
  assert.throws(() => kenyaDataset({ country: "GH" }), /not in the 26-country/);
  assert.throws(() => kenyaDataset({ country: "" }), /not in the 26-country/);
});

test("a dataset with no numbers at all is refused", () => {
  assert.throws(() => kenyaDataset({ duties: [], vat: null, levies: [] }), /no numeric content/);
});

test("the fingerprint is deterministic, changes with the numbers, and identifies the dataset", () => {
  const a = kenyaDataset();
  const b = kenyaDataset();
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(a.fingerprint, a.verification.fingerprint);

  const dearer = kenyaDataset({ duties: [{ hs: "1006.30", rate: 0.25 }] });
  assert.notEqual(dearer.fingerprint, a.fingerprint);

  const otherYear = kenyaDataset({ effectiveFrom: "2025-01-01" });
  assert.notEqual(otherYear.fingerprint, a.fingerprint);

  // same numbers, re-cited source: the rates are what the fingerprint identifies
  const recitle = kenyaDataset({ sources: ["EAC CET 2022, Kenya schedule (re-verified)"] });
  assert.equal(recitle.fingerprint, a.fingerprint);
});

test("the gate refuses a draft country and says why", () => {
  const g = quoteGate("UG", { datasets: [], today: TODAY });
  assert.equal(g.ok, false);
  assert.match(g.reason, /^UG:/);
  assert.match(g.reason, /draft/i);
  assert.match(g.reason, /no verified tariff dataset on file/);
  assert.match(g.reason, /duty cannot be computed/);
  assert.match(g.reason, /not a zero rate/);
  assert.match(g.reason, /URA/); // names the authority a human has to chase
});

test("the gate refuses a verified country with no dataset on file", () => {
  const g = quoteGate("KE", { datasets: [], today: TODAY });
  assert.equal(g.ok, false);
  assert.match(g.reason, /^KE:/);
  assert.match(g.reason, /no verified tariff dataset on file/);
  assert.match(g.reason, /not a zero rate/);
  assert.equal(g.dataset, undefined);
});

test("the gate refuses a dataset whose numbers no longer match the recorded verification", () => {
  const good = kenyaDataset();
  const tampered = { ...good, duties: [{ hs: "1006.30", rate: 0 }] };
  const g = quoteGate("KE", { datasets: [tampered], today: TODAY });
  assert.equal(g.ok, false);
  assert.match(g.reason, /does not match its recorded verification/);
  assert.match(g.reason, /fingerprint/);
  assert.match(g.reason, /not a zero rate/);
  assert.notEqual(g.fingerprint, good.fingerprint);
});

test("the gate refuses a dataset that was never verified at all", () => {
  const unrecorded = {
    country: "KE",
    effectiveFrom: "2026-01-01",
    verifiedOn: "2026-10-29",
    sources: ["someone's spreadsheet"],
    duties: [{ hs: "1006.30", rate: 0.35 }],
    vat: 0.16,
    levies: [],
  };
  const g = quoteGate("KE", { datasets: [unrecorded], today: TODAY });
  assert.equal(g.ok, false);
  assert.match(g.reason, /no recorded verification fingerprint/);
});

test("the gate refuses a dataset belonging to another country", () => {
  const ugandan = kenyaDataset({ country: "UG" }); // definition is fine; use is not
  const g = quoteGate("KE", { datasets: [ugandan], today: TODAY });
  assert.equal(g.ok, false);
  assert.match(g.reason, /no verified tariff dataset on file/);
});

test("the gate refuses a code outside the registry instead of guessing", () => {
  const g = quoteGate("GH", { datasets: [], today: TODAY });
  assert.equal(g.ok, false);
  assert.match(g.reason, /^GH:/);
  assert.match(g.reason, /not in the 26-country/);
  assert.match(g.reason, /duty cannot be computed/);
  assert.match(g.reason, /not a zero rate/);

  assert.equal(quoteGate("XX").ok, false);
  assert.equal(quoteGate(undefined).ok, false);
});

test("the gate passes Kenya with a properly defined dataset", () => {
  const dataset = kenyaDataset();
  const g = quoteGate("KE", { datasets: [dataset], today: TODAY });
  assert.equal(g.ok, true);
  assert.equal(g.reason, undefined);
  assert.equal(g.dataset.country, "KE");
  assert.equal(g.dataset.vat, 0.16);
  assert.equal(g.fingerprint, dataset.fingerprint);
  assert.equal(g.verifiedOn, "2026-10-29");
  assert.equal(g.effectiveFrom, "2026-01-01");
  assert.equal(g.ageDays, 0);
  assert.match(g.statement, /HS classification/);
});

test("the gate picks the latest effective dataset when several are on file", () => {
  const older = kenyaDataset({ effectiveFrom: "2025-01-01", duties: [{ hs: "1006.30", rate: 0.25 }] });
  const newer = kenyaDataset({ effectiveFrom: "2026-01-01" });
  const g = quoteGate("KE", { datasets: [older, newer], today: TODAY });
  assert.equal(g.ok, true);
  assert.equal(g.dataset.effectiveFrom, "2026-01-01");
  assert.equal(g.fingerprint, newer.fingerprint);
});

test("KE to UG shares the EAC, and the preference is claimed by certificate, not assumed", () => {
  const t = transitBlocs("KE", "UG");
  assert.deepEqual(t.shared, ["EAC", "COMESA"]);
  assert.equal(t.preferentialPlausible, true);
  assert.equal(t.primaryBloc, "EAC");
  assert.ok(t.requires.includes("EAC Certificate of Origin"));
  assert.match(t.statement, /certificate of origin/i);
  assert.match(t.statement, /No 0% is assumed/);
  assert.doesNotMatch(t.statement, /0\.00%|zero-rated|duty is 0/);
});

test("KE to ZA shares no bloc, so no preference is plausible", () => {
  const t = transitBlocs("KE", "ZA");
  assert.deepEqual(t.shared, []);
  assert.equal(t.preferentialPlausible, false);
  assert.equal(t.primaryBloc, null);
  assert.deepEqual(t.requires, []);
  assert.match(t.statement, /no preferential rate is plausible/i);
  assert.match(t.statement, /no rate is stated/);
});

test("a three-bloc country reports all three shared blocs", () => {
  const t = transitBlocs("CD", "KE");
  assert.deepEqual(t.shared, ["EAC", "COMESA"]);
  const all = transitBlocs("CD", "ZM");
  assert.deepEqual(all.shared, ["COMESA", "SADC"]);
  assert.equal(all.primaryBloc, "COMESA");
});

test("transitBlocs refuses to invent membership for an unknown country", () => {
  const t = transitBlocs("KE", "GH");
  assert.deepEqual(t.shared, []);
  assert.equal(t.preferentialPlausible, false);
  assert.match(t.statement, /not in the 26-country registry/);
  assert.match(t.statement, /no rate is stated/);
});

test("datasetFingerprint is stable for hand-built content, so a checker can verify a stored dataset", () => {
  const a = kenyaDataset();
  const recomputed = datasetFingerprint({
    country: "KE",
    effectiveFrom: "2026-01-01",
    duties: [{ hs: "1006.30", rate: 0.35 }],
    vat: 0.16,
    levies: [],
  });
  assert.equal(recomputed, a.fingerprint);
  // key order is not part of the identity
  const reordered = datasetFingerprint({ country: "ke", effectiveFrom: "2026-01-01", levies: [], vat: 0.16, duties: [{ rate: 0.35, hs: "1006.30" }] });
  assert.equal(reordered, a.fingerprint);
});
