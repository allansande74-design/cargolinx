/**
 * Verified tariff datasets on file.
 *
 * The registry (`engine/network.mjs`) says which countries the desk covers and whether a dataset
 * exists. This module is the other half: the datasets themselves, each one built through
 * `defineDataset` so it carries its sources, its effective date, and a fingerprint of its numbers.
 *
 * Today there is exactly one: Kenya, transcribed from `engine/rates/ke-2026.mjs`, which cites PwC
 * Worldwide Tax Summaries (reviewed 17 July 2026) for IDF 2.5% and RDL 2%, and the EAC CET 2022 for
 * the 0/10/25/35 bands. Every other country in the 26 is deliberately absent — a gate that refuses
 * is worth more than a table that guesses.
 */

import { KE_2026 } from "./rates/ke-2026.mjs";
import { defineDataset, quoteGate, AFRICA_26, coverage } from "./network.mjs";

/** Kenya, as a fingerprintable dataset. Rebuilt from the rate file so there is one source of truth. */
export const KE_DATASET = defineDataset({
  country: "KE",
  effectiveFrom: KE_2026.effectiveFrom,
  verifiedOn: KE_2026.verifiedOn,
  sources: KE_2026.sources,
  duties: { bands: KE_2026.dutyBands, basis: "CIF", cet: "EAC CET 2022" },
  vat: KE_2026.vat,
  levies: KE_2026.levies,
  today: KE_2026.verifiedOn,
});

/** Datasets the desk may quote from. Append with defineDataset; never hand-write an entry. */
export const DATASETS = [KE_DATASET];

/**
 * May this country be quoted today?
 * Returns the gate's own verdict — `{ ok:true, dataset, statement }` or `{ ok:false, reason }`.
 */
export function gate(countryCode, { datasets = DATASETS, today } = {}) {
  return quoteGate(countryCode, { datasets, today });
}

/** Coverage with the datasets folded in, so a screen can show "covered" and "quotable" separately. */
export function coverageWithDatasets({ datasets = DATASETS } = {}) {
  const base = coverage();
  const quotable = AFRICA_26.filter((c) => gate(c.code, { datasets }).ok).map((c) => c.code);
  return {
    ...base,
    quotable,
    quotableCount: quotable.length,
    draftCount: base.total - quotable.length,
    statement:
      quotable.length === 0
        ? "No country is quotable: no verified dataset is on file."
        : `${quotable.length} of ${base.total} countries quotable (${quotable.join(", ")}); the rest are covered for corridors and partners but refuse a duty calculation.`,
  };
}
