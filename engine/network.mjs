/**
 * African coverage registry and the tariff data-quality gate.
 *
 * The desk covers 26 countries across COMESA, the EAC and SADC. Coverage is not the same thing as
 * having the numbers. For exactly one country, Kenya, the desk holds a tariff dataset it can point
 * at: the EAC CET 2022 working subset and the KEBS PVoC schedule, both already transcribed in
 * engine/tariff.mjs. Every other country on the list is registered as a draft: we know the revenue
 * authority, the declaration platform by name, the currency and the bloc memberships, and we know
 * nothing we are willing to put in a quote. No duty rate, VAT rate or levy appears for a draft
 * country anywhere in this file — a blank is honest, a plausible-looking number is not.
 *
 * Two consequences follow, and both are deliberate:
 *
 *  - defineDataset() refuses to record a dataset with no cited source, or one dated in the future.
 *    A dataset is a claim about a dated gazette, so it has to carry a source and a date that has
 *    already happened.
 *  - quoteGate() returns ok:false with a reason a human can act on unless the country is in the
 *    registry, its status is verified, a dataset exists for it, and that dataset still hashes to
 *    the fingerprint recorded when it was verified. A tampered rate is not a rate.
 *
 * Nothing here fetches anything, and nothing touches the filesystem: pure functions, safe in the
 * browser bundle and in Node.
 */

/** Every revenue system in this registry is manual. Nothing here claims an API. */
export const INTEGRATION_LEVEL = "manual";

const BLOC_ORDER = ["EAC", "COMESA", "SADC"];

const normalise = (value) => String(value ?? "").trim().toUpperCase();

/* ---------------------------------------------------------------------------------------------
 * Fingerprints
 *
 * A dataset has to be identifiable. FNV-1a over a canonical rendering of the numeric content is
 * enough for that: it is deterministic, dependency-free, and stable across Node and the browser.
 * ------------------------------------------------------------------------------------------- */

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input) {
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Canonical rendering: keys sorted, arrays in order, numbers in their shortest exact form. */
function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("dataset content contains a non-finite number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  throw new Error(`dataset content contains an unsupported ${typeof value}`);
}

function containsNumber(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.some(containsNumber);
  if (value && typeof value === "object") return Object.values(value).some(containsNumber);
  return false;
}

/**
 * The fingerprint of a dataset: a hash of the country, the effective date and the numeric content
 * (duties, VAT, levies). Source text is deliberately excluded — re-citing the same rates does not
 * change what the numbers are, but changing a rate does.
 */
export function datasetFingerprint({ country, effectiveFrom, duties = null, vat = null, levies = null } = {}) {
  const body = [
    "clx-dataset-v1",
    normalise(country),
    String(effectiveFrom ?? ""),
    canonical(duties),
    canonical(vat),
    canonical(levies),
  ].join("|");
  return fnv1a64(body);
}

/* ---------------------------------------------------------------------------------------------
 * Dates
 * ------------------------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value, field) {
  const raw = String(value ?? "").trim();
  if (!ISO_DATE.test(raw)) throw new Error(`${field} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(value ?? null)}`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${field} is not a real calendar date: ${raw}`);
  }
  return raw;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/* ---------------------------------------------------------------------------------------------
 * The registry
 * ------------------------------------------------------------------------------------------- */

/**
 * Draft citation. It names the authority, the platform and the thing that must be confirmed — and
 * it records no rate at all.
 */
function draftCitation(code, authority, system, whatToConfirm) {
  return `${code}: ${whatToConfirm} — confirm against a dated ${authority} notice (${system}) before any figure is quoted; no duty, VAT or levy rate is recorded for ${code}.`;
}

/**
 * 26 countries: the 7 EAC members, the COMESA membership, and the SADC economies on the corridor
 * map. This is a working coverage set, not the full roll of each bloc; countries outside it are
 * refused by the gate rather than quoted from memory.
 *
 * customsSystem is a platform name only. Every entry sits at integration level 'manual': the desk
 * prepares and pre-validates a file, a licensed agent lodges it.
 */
export const AFRICA_26 = [
  {
    code: "KE",
    name: "Kenya",
    bloc: ["EAC", "COMESA"],
    currency: "KES",
    customsSystem: "KRA iCMS",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "verified",
    citations: [
      "EAC Common External Tariff (CET) 2022 (EAC Secretariat) — Kenya duty bands for corridor HS codes, transcribed in engine/tariff.mjs HS_TABLE; verified 2026-10-29",
      "KEBS PVoC Manual v12 (2023) §5.5 — Kenya conformity (PVoC) fee schedule, transcribed in engine/tariff.mjs PVOC_FEES; verified 2026-10-29",
      "KRA iCMS — Kenya customs declaration platform, confirmed 2026-10-29 (engine/countries.mjs); lodging is by a licensed clearing agent, no filing API is claimed",
    ],
  },
  {
    code: "UG",
    name: "Uganda",
    bloc: ["EAC", "COMESA"],
    currency: "UGX",
    customsSystem: "URA customs (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("UG", "URA", "ASYCUDA World", "URA tariff, VAT and excise schedule not yet transcribed")],
  },
  {
    code: "TZ",
    name: "Tanzania",
    bloc: ["EAC", "SADC"],
    currency: "TZS",
    customsSystem: "TRA TANCIS",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("TZ", "TRA", "TANCIS", "TRA tariff line, VAT rate and any national levy not yet transcribed, and EAC CET versus national treatment unresolved")],
  },
  {
    code: "RW",
    name: "Rwanda",
    bloc: ["EAC", "COMESA"],
    currency: "RWF",
    customsSystem: "RRA customs (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("RW", "RRA", "ASYCUDA World", "RRA tariff and VAT schedule not yet transcribed")],
  },
  {
    code: "BI",
    name: "Burundi",
    bloc: ["EAC", "COMESA"],
    currency: "BIF",
    customsSystem: "OBR customs (SYDONIA)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("BI", "OBR", "SYDONIA", "OBR tariff and VAT schedule not yet transcribed")],
  },
  {
    code: "SS",
    name: "South Sudan",
    bloc: ["EAC"],
    currency: "SSP",
    customsSystem: "NRA customs",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("SS", "NRA", "NRA customs", "NRA tariff and VAT treatment not yet transcribed; clearance is paper-heavy, so expect manual keying and no electronic status feed")],
  },
  {
    code: "CD",
    name: "DR Congo",
    bloc: ["EAC", "COMESA", "SADC"],
    currency: "CDF",
    customsSystem: "DGDA (SYDONIA)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("CD", "DGDA", "SYDONIA", "DGDA tariff and VAT treatment not yet transcribed; EAC CET application varies by entry point, so it must be confirmed per corridor")],
  },
  {
    code: "DJ",
    name: "Djibouti",
    bloc: ["COMESA"],
    currency: "DJF",
    customsSystem: "Djibouti Customs (SYDONIA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("DJ", "Djibouti Customs", "SYDONIA World", "Djibouti tariff line and VAT rate not yet transcribed, including whether the COMESA CET is applied at the port")],
  },
  {
    code: "EG",
    name: "Egypt",
    bloc: ["COMESA"],
    currency: "EGP",
    customsSystem: "Egyptian Customs (Nafeza)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("EG", "Egyptian Customs Authority", "Nafeza", "Egyptian tariff line, VAT rate and any schedule of fees not yet transcribed")],
  },
  {
    code: "ER",
    name: "Eritrea",
    bloc: ["COMESA"],
    currency: "ERN",
    customsSystem: "Eritrea Customs (manual)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("ER", "Eritrea Customs", "manual lodgement", "Eritrea tariff and sales tax treatment not yet transcribed; no public electronic declaration platform is confirmed, so treat every figure as manual")],
  },
  {
    code: "ET",
    name: "Ethiopia",
    bloc: ["COMESA"],
    currency: "ETB",
    customsSystem: "ERCA customs",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("ET", "ERCA", "ERCA customs", "ERCA tariff and VAT schedule not yet transcribed")],
  },
  {
    code: "KM",
    name: "Comoros",
    bloc: ["COMESA", "SADC"],
    currency: "KMF",
    customsSystem: "Comoros Customs (SYDONIA)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("KM", "Comoros Customs", "SYDONIA", "Comoros tariff and VAT rate not yet transcribed, and COMESA versus SADC treatment unresolved")],
  },
  {
    code: "LY",
    name: "Libya",
    bloc: ["COMESA"],
    currency: "LYD",
    customsSystem: "Libyan Customs",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("LY", "Libyan Customs Authority", "Libyan Customs", "Libyan tariff and VAT treatment not yet transcribed; confirm which tariff schedule is currently applied")],
  },
  {
    code: "MG",
    name: "Madagascar",
    bloc: ["COMESA", "SADC"],
    currency: "MGA",
    customsSystem: "Madagascar Customs (SYDONIA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("MG", "Madagascar Customs", "SYDONIA World", "Madagascar tariff and VAT rate not yet transcribed")],
  },
  {
    code: "MW",
    name: "Malawi",
    bloc: ["COMESA", "SADC"],
    currency: "MWK",
    customsSystem: "MRA customs (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("MW", "MRA", "ASYCUDA World", "MRA tariff and VAT schedule not yet transcribed")],
  },
  {
    code: "MU",
    name: "Mauritius",
    bloc: ["COMESA", "SADC"],
    currency: "MUR",
    customsSystem: "MRA Customs (CMS)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("MU", "MRA", "CMS", "MRA tariff line and VAT rate not yet transcribed")],
  },
  {
    code: "SC",
    name: "Seychelles",
    bloc: ["COMESA", "SADC"],
    currency: "SCR",
    customsSystem: "Seychelles Revenue Commission customs",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("SC", "Seychelles Revenue Commission", "SRC customs", "Seychelles tariff and VAT treatment not yet transcribed")],
  },
  {
    code: "SO",
    name: "Somalia",
    bloc: ["COMESA"],
    currency: "SOS",
    customsSystem: "Somali Customs",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("SO", "Somali Customs", "Somali Customs", "Somali tariff and VAT treatment not yet transcribed; confirm which authority administers the specific entry point")],
  },
  {
    code: "SD",
    name: "Sudan",
    bloc: ["COMESA"],
    currency: "SDG",
    customsSystem: "Sudan Customs",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("SD", "Sudan Customs", "Sudan Customs", "Sudanese tariff and VAT schedule not yet transcribed; the schedule in force has changed repeatedly, so the dated notice matters more than the number")],
  },
  {
    code: "TN",
    name: "Tunisia",
    bloc: ["COMESA"],
    currency: "TND",
    customsSystem: "Tunisian Customs (SINDA)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("TN", "Tunisian Customs", "SINDA", "Tunisian tariff line and VAT rate not yet transcribed")],
  },
  {
    code: "ZM",
    name: "Zambia",
    bloc: ["COMESA", "SADC"],
    currency: "ZMW",
    customsSystem: "ZRA customs (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("ZM", "ZRA", "ASYCUDA World", "ZRA tariff and VAT schedule not yet transcribed")],
  },
  {
    code: "ZW",
    name: "Zimbabwe",
    bloc: ["COMESA", "SADC"],
    currency: "ZWG",
    customsSystem: "ZIMRA (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("ZW", "ZIMRA", "ASYCUDA World", "ZIMRA tariff and VAT schedule not yet transcribed, and the currency of the duty schedule (ZWG) confirmed")],
  },
  {
    code: "SZ",
    name: "Eswatini",
    bloc: ["COMESA", "SADC"],
    currency: "SZL",
    customsSystem: "SRA customs (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("SZ", "SRA", "ASYCUDA World", "SRA tariff and VAT rate not yet transcribed, confirming which SACU common external tariff line is applied")],
  },
  {
    code: "ZA",
    name: "South Africa",
    bloc: ["SADC"],
    currency: "ZAR",
    customsSystem: "SARS customs (CDP)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("ZA", "SARS", "Customs Declaration Processing", "SARS tariff line, VAT rate and any ITAC permit requirement not yet transcribed")],
  },
  {
    code: "MZ",
    name: "Mozambique",
    bloc: ["SADC"],
    currency: "MZN",
    customsSystem: "AT (Janela Única Electrónica)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("MZ", "Autoridade Tributária", "Janela Única Electrónica", "Mozambican tariff and VAT rate not yet transcribed")],
  },
  {
    code: "NA",
    name: "Namibia",
    bloc: ["SADC"],
    currency: "NAD",
    customsSystem: "NamRA (ASYCUDA World)",
    integration: INTEGRATION_LEVEL,
    datasetStatus: "draft",
    citations: [draftCitation("NA", "NamRA", "ASYCUDA World", "NamRA tariff and VAT rate not yet transcribed, confirming which SACU common external tariff line is applied")],
  },
];

const BY_CODE = new Map(AFRICA_26.map((record) => [record.code, record]));

/** One record, or null. Never a fabricated one. */
export function countryByCode(code) {
  return BY_CODE.get(normalise(code)) ?? null;
}

/** Bloc member lists, derived from the registry — never maintained by hand. */
export const BLOCS = Object.freeze(
  Object.fromEntries(BLOC_ORDER.map((bloc) => [bloc, Object.freeze(AFRICA_26.filter((r) => r.bloc.includes(bloc)).map((r) => r.code))])),
);

/** Blocs a country belongs to, in EAC/COMESA/SADC order. Unknown codes return an empty list. */
export function membershipOf(code) {
  const record = BY_CODE.get(normalise(code));
  if (!record) return [];
  return BLOC_ORDER.filter((bloc) => record.bloc.includes(bloc));
}

/* ---------------------------------------------------------------------------------------------
 * Datasets
 * ------------------------------------------------------------------------------------------- */

/**
 * Record a tariff dataset against a country.
 *
 * Refuses, loudly, when:
 *  - the country is not in the registry (there is nothing to record a dataset against);
 *  - sources is empty or holds a blank entry (an uncited dataset is a claim, not a source);
 *  - verifiedOn is in the future relative to `today` (nobody has verified tomorrow's gazette);
 *  - no numeric content is supplied (there is no rate to fingerprint).
 *
 * Returns a frozen dataset carrying `fingerprint` and a `verification` block. The verification
 * block is the record quoteGate() checks the live numbers against.
 */
export function defineDataset({ country, effectiveFrom, verifiedOn, sources, duties = null, vat = null, levies = null, today } = {}) {
  const code = normalise(country);
  const record = BY_CODE.get(code);
  if (!record) {
    throw new Error(`defineDataset: ${code || "(no country)"} is not in the 26-country African registry — a dataset cannot be recorded against a country the desk does not cover`);
  }

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`defineDataset: ${code} has no sources — a dataset without a cited gazette or notice is an unverified claim, not a dataset`);
  }
  const cleanSources = sources.map((s) => String(s ?? "").trim());
  if (cleanSources.some((s) => s.length === 0)) {
    throw new Error(`defineDataset: ${code} has a blank source entry — every source must name the document it cites`);
  }

  const effective = isoDate(effectiveFrom, "effectiveFrom");
  const verified = isoDate(verifiedOn, "verifiedOn");
  const asOf = isoDate(today ?? todayIso(), "today");

  if (verified > asOf) {
    throw new Error(`defineDataset: ${code} claims verification on ${verified}, which is after today (${asOf}) — a future verification cannot be recorded`);
  }

  if (![duties, vat, levies].some(containsNumber)) {
    throw new Error(`defineDataset: ${code} carries no numeric content in duties, vat or levies — there is no rate to fingerprint, so nothing can be verified`);
  }

  const fingerprint = datasetFingerprint({ country: code, effectiveFrom: effective, duties, vat, levies });

  return Object.freeze({
    country: code,
    name: record.name,
    effectiveFrom: effective,
    verifiedOn: verified,
    sources: Object.freeze(cleanSources),
    duties,
    vat,
    levies,
    fingerprint,
    verification: Object.freeze({
      country: code,
      effectiveFrom: effective,
      verifiedOn: verified,
      sources: Object.freeze([...cleanSources]),
      fingerprint,
      method: "fnv1a64 over canonical country|effectiveFrom|duties|vat|levies",
    }),
    note: "Verified data still needs an HS classification per line — the gate clears the data, not the classification.",
  });
}

/** Fingerprint recorded for a dataset, whether it was built here or handed to us. */
function recordedFingerprint(dataset) {
  return dataset?.verification?.fingerprint ?? dataset?.fingerprint ?? null;
}

function selectDataset(datasets, code) {
  const candidates = (Array.isArray(datasets) ? datasets : []).filter((d) => d && normalise(d.country) === code);
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => String(b.effectiveFrom ?? "").localeCompare(String(a.effectiveFrom ?? "")))[0];
}

/* ---------------------------------------------------------------------------------------------
 * Coverage
 * ------------------------------------------------------------------------------------------- */

/** How much of the registry is actually quotable. */
export function coverage() {
  const total = AFRICA_26.length;
  const verified = AFRICA_26.filter((r) => r.datasetStatus === "verified").length;
  const byBloc = Object.fromEntries(BLOC_ORDER.map((bloc) => [bloc, AFRICA_26.filter((r) => r.bloc.includes(bloc)).length]));
  return { total, verified, draft: total - verified, byBloc };
}

/* ---------------------------------------------------------------------------------------------
 * The gate
 * ------------------------------------------------------------------------------------------- */

const NOT_A_ZERO_RATE = "this is not a zero rate";

/**
 * May duty be computed for this country from this dataset?
 *
 * Returns { ok:false, reason } unless every check passes, and { ok:true, dataset } when they do.
 * Each refusal names the country, says what is missing, and says what a human has to do next.
 */
export function quoteGate(code, { datasets = [], today } = {}) {
  const key = normalise(code);
  const asOf = isoDate(today ?? todayIso(), "today");

  const record = BY_CODE.get(key);
  if (!record) {
    return {
      ok: false,
      code: key || null,
      reason: `${key || "(no code)"}: not in the 26-country African coverage registry — the desk holds no tariff data and no bloc membership for it, so duty cannot be computed, ${NOT_A_ZERO_RATE}. Add the country to the registry with a cited dataset before quoting it.`,
    };
  }

  if (record.datasetStatus !== "verified") {
    return {
      ok: false,
      code: key,
      reason: `${key}: no verified tariff dataset on file for ${record.name} (registry status: draft) — duty cannot be computed, ${NOT_A_ZERO_RATE}. Confirm the tariff, VAT and levy schedule against a dated ${record.customsSystem} notice, then record it with defineDataset().`,
    };
  }

  const dataset = selectDataset(datasets, key);
  if (!dataset) {
    return {
      ok: false,
      code: key,
      reason: `${key}: no verified tariff dataset on file for ${record.name} — duty cannot be computed, ${NOT_A_ZERO_RATE}. The country is verified for coverage but no dataset was supplied to this quote; record one with defineDataset().`,
    };
  }

  const recorded = recordedFingerprint(dataset);
  if (!recorded) {
    return {
      ok: false,
      code: key,
      reason: `${key}: the supplied dataset for ${record.name} carries no recorded verification fingerprint — it was never verified, so duty cannot be computed, ${NOT_A_ZERO_RATE}. Re-verify it against its source with defineDataset().`,
    };
  }

  let recomputed;
  try {
    recomputed = datasetFingerprint({
      country: dataset.country,
      effectiveFrom: dataset.effectiveFrom,
      duties: dataset.duties ?? null,
      vat: dataset.vat ?? null,
      levies: dataset.levies ?? null,
    });
  } catch (error) {
    return {
      ok: false,
      code: key,
      reason: `${key}: the supplied dataset for ${record.name} cannot be fingerprinted (${error.message}) — duty cannot be computed, ${NOT_A_ZERO_RATE}.`,
    };
  }

  if (recomputed !== recorded) {
    return {
      ok: false,
      code: key,
      reason: `${key}: the dataset on file for ${record.name} does not match its recorded verification (fingerprint ${recomputed} versus recorded ${recorded}) — the figures were altered after verification, so duty cannot be computed, ${NOT_A_ZERO_RATE}. Re-verify the dataset against its cited source.`,
    };
  }

  if (dataset.verifiedOn && isoDate(dataset.verifiedOn, "verifiedOn") > asOf) {
    return {
      ok: false,
      code: key,
      reason: `${key}: the dataset for ${record.name} is recorded as verified on ${dataset.verifiedOn}, which is after today (${asOf}) — a future verification cannot be relied on, so duty cannot be computed, ${NOT_A_ZERO_RATE}.`,
    };
  }

  return {
    ok: true,
    dataset,
    code: key,
    name: record.name,
    fingerprint: recomputed,
    verifiedOn: dataset.verifiedOn ?? null,
    effectiveFrom: dataset.effectiveFrom ?? null,
    ageDays: dataset.verifiedOn ? daysBetween(dataset.verifiedOn, asOf) : null,
    statement: `${key}: dataset ${recomputed} verified ${dataset.verifiedOn ?? "(date not stated)"} and in force from ${dataset.effectiveFrom ?? "(not stated)"}. Duty still depends on the HS classification of each line — the gate clears the data, not the classification.`,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Transit
 * ------------------------------------------------------------------------------------------- */

const BLOC_PREFERENCE = {
  EAC: "EAC customs union",
  COMESA: "COMESA free trade area",
  SADC: "SADC free trade area",
};

/**
 * What preferential treatment is plausible on a lane.
 *
 * Plausible is the operative word: a preferential rate is claimed by document. The desk does not
 * quote 0% because two countries share a bloc — it quotes the applied rate and flags that a
 * certificate of origin would reduce it.
 */
export function transitBlocs(from, to) {
  const a = normalise(from);
  const b = normalise(to);
  const ra = BY_CODE.get(a);
  const rb = BY_CODE.get(b);
  const shared = ra && rb ? membershipOf(a).filter((bloc) => membershipOf(b).includes(bloc)) : [];

  if (!ra || !rb) {
    const missing = [!ra ? a || "(no code)" : null, !rb ? b || "(no code)" : null].filter(Boolean);
    return {
      from: a || null,
      to: b || null,
      fromName: ra?.name ?? null,
      toName: rb?.name ?? null,
      shared: [],
      preferentialPlausible: false,
      primaryBloc: null,
      requires: [],
      statement: `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not in the 26-country registry — bloc membership cannot be established, so no preferential treatment can be claimed on this lane and no rate is stated.`,
      note: "No rate is assumed. Confirm the importing country's applied tariff before quoting.",
    };
  }

  if (shared.length === 0) {
    return {
      from: a,
      to: b,
      fromName: ra.name,
      toName: rb.name,
      shared: [],
      preferentialPlausible: false,
      primaryBloc: null,
      requires: [],
      statement: `${a} and ${b} share no bloc in this registry (${membershipOf(a).join(", ") || "none"} versus ${membershipOf(b).join(", ") || "none"}) — no preferential rate is plausible, so the importing country's applied tariff applies in full and no rate is stated here.`,
      note: "No rate is assumed. Confirm the applied tariff and any bilateral arrangement separately.",
    };
  }

  const primaryBloc = shared[0];
  return {
    from: a,
    to: b,
    fromName: ra.name,
    toName: rb.name,
    shared,
    preferentialPlausible: true,
    primaryBloc,
    requires: [
      `${primaryBloc} Certificate of Origin`,
      "Rules of origin declaration / supplier affidavit",
    ],
    statement: `${a} → ${b}: both sit in the same blocs (${shared.map((bloc) => BLOC_PREFERENCE[bloc]).join(", ")}). A preferential rate under the ${BLOC_PREFERENCE[primaryBloc]} requires a valid ${primaryBloc} certificate of origin and the rules-of-origin declaration; without them the importing country's applied tariff applies. No 0% is assumed here.`,
    note: "No rate is assumed. The preference is claimed by document, so quote the applied rate until the certificate is sighted and verified.",
  };
}
