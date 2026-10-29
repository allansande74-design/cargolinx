import test from "node:test";
import assert from "node:assert/strict";
import { KE_DATASET, DATASETS, gate, coverageWithDatasets } from "../engine/datasets.mjs";
import { quoteGate, defineDataset } from "../engine/network.mjs";

const TODAY = "2026-10-29";

test("Kenya is quotable because a verified dataset is on file", () => {
  const v = gate("KE", { today: TODAY });
  assert.equal(v.ok, true);
  assert.equal(v.dataset.country, "KE");
  assert.match(v.fingerprint, /^[0-9a-f]{16}$/);
  assert.match(v.statement, /verified/);
});

test("the Kenya dataset is the one built from the rate file, not a copy", () => {
  assert.equal(KE_DATASET.verifiedOn, "2026-10-28");
  assert.equal(KE_DATASET.effectiveFrom, "2026-07-01");
  assert.equal(KE_DATASET.levies.idf, 0.025);
  assert.equal(KE_DATASET.vat.standard, 0.16);
  assert.deepEqual([...KE_DATASET.duties.bands], [0, 0.1, 0.25, 0.35]);
});

test("every covered country other than Kenya refuses a duty calculation", () => {
  for (const code of ["UG", "TZ", "RW", "ZA", "NG"]) {
    const v = gate(code, { today: TODAY });
    assert.equal(v.ok, false, `${code} must not quote`);
    assert.match(v.reason, /not a zero rate/);
  }
});

test("a dataset altered after verification is refused, not quoted", () => {
  const tampered = { ...KE_DATASET, vat: { standard: 0.08, fuel: 0.08 } };
  const v = quoteGate("KE", { datasets: [tampered], today: TODAY });
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not match its recorded verification/);
});

test("a dataset must cite something", () => {
  assert.throws(
    () => defineDataset({ country: "KE", effectiveFrom: "2026-07-01", verifiedOn: "2026-10-28", sources: [], vat: { standard: 0.16 } }),
    /no sources/,
  );
});

test("coverage counts quotable countries separately from covered ones", () => {
  const c = coverageWithDatasets();
  assert.equal(c.total, 26);
  assert.deepEqual(c.quotable, ["KE"]);
  assert.equal(c.draftCount, 25);
  assert.match(c.statement, /1 of 26/);
});

test("the exported dataset list is exactly what the gate uses", () => {
  assert.equal(DATASETS.length, 1);
  assert.equal(gate("KE", { today: TODAY }).fingerprint, quoteGate("KE", { datasets: DATASETS, today: TODAY }).fingerprint);
});
