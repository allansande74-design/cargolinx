/**
 * Tariff and conformity layer.
 *
 * Three jobs:
 *  1. turn an HS code into an EAC CET duty band, with the source of that band stated;
 *  2. apply EAC preferential treatment for goods of East African origin, which is 0% duty
 *     only when the certificate of origin and the rules-of-origin declaration exist;
 *  3. price pre-export verification of conformity (PVoC) without pretending it is optional
 *     for regulated goods.
 *
 * The HS table below is a working subset for corridor trade, not the tariff book. Anything not
 * in it comes back unresolved on purpose: an unresolved code must be classified, not guessed.
 */

export const EAC_MEMBERS = {
  KE: "Kenya",
  UG: "Uganda",
  TZ: "Tanzania",
  RW: "Rwanda",
  BI: "Burundi",
  SS: "South Sudan",
  CD: "DR Congo",
};

/** Indicative CET bands for common corridor goods. band must be one of 0, 0.10, 0.25, 0.35. */
export const HS_TABLE = [
  { hs: "1006.30", label: "Rice, milled", band: 0.35, pvoc: true },
  { hs: "1701.99", label: "Cane or beet sugar", band: 0.35, pvoc: true },
  { hs: "0402.21", label: "Milk powder", band: 0.35, pvoc: true },
  { hs: "1905.90", label: "Bakery products", band: 0.35, pvoc: true },
  { hs: "0808.10", label: "Apples, fresh", band: 0.25, pvoc: true, phytosanitary: true },
  { hs: "0703.10", label: "Onions, fresh", band: 0.25, pvoc: true, phytosanitary: true },
  { hs: "0602.90", label: "Live plants, cuttings", band: 0.1, pvoc: true, phytosanitary: true },
  { hs: "1005.90", label: "Maize, other", band: 0.25, pvoc: true, phytosanitary: true },
  { hs: "3105.10", label: "Mineral fertiliser", band: 0, pvoc: true },
  { hs: "3004.90", label: "Medicaments, retail", band: 0, pvoc: true },
  { hs: "8471.30", label: "Portable computers", band: 0, pvoc: true },
  { hs: "8517.13", label: "Smartphones", band: 0, pvoc: true },
  { hs: "8504.40", label: "Static converters", band: 0.1, pvoc: true },
  { hs: "8544.42", label: "Electric cable, fitted", band: 0.25, pvoc: true },
  { hs: "2523.29", label: "Portland cement", band: 0.25, pvoc: true },
  { hs: "7210.49", label: "Flat-rolled steel, coated", band: 0.25, pvoc: true },
  { hs: "3917.23", label: "Plastic pipes, rigid", band: 0.25, pvoc: true },
  { hs: "4011.10", label: "Tyres, cars", band: 0.25, pvoc: true },
  { hs: "8704.21", label: "Trucks, GVW 5-20 t", band: 0.25, pvoc: true },
  { hs: "9403.60", label: "Wooden furniture", band: 0.35, pvoc: true },
  { hs: "6403.99", label: "Footwear, leather", band: 0.35, pvoc: true },
  { hs: "6109.10", label: "T-shirts, cotton", band: 0.35, pvoc: true },
  { hs: "3304.99", label: "Cosmetics", band: 0.35, pvoc: true },
  { hs: "2202.10", label: "Sweetened waters", band: 0.35, pvoc: true },
  { hs: "4418.71", label: "Builders' woodwork", band: 0.25, pvoc: true },
  { hs: "7326.90", label: "Articles of iron or steel", band: 0.25, pvoc: true },
];

/** KEBS PVoC fee schedule, Manual v12 (2023): percentage of FOB, with a floor and a cap in USD. */
export const PVOC_FEES = {
  source: "KEBS PVoC Manual v12 (2023), section 5.5",
  verifiedOn: "2026-10-29",
  routes: {
    A: { pct: 0.006, minUsd: 265, maxUsd: 2700, note: "unregistered products, consignment inspection" },
    B: { pct: 0.0055, minUsd: 265, maxUsd: 2700, note: "registered products, intermittent testing" },
    C: { pct: 0.0035, minUsd: 265, maxUsd: 2700, note: "licensed manufacturers with audited QMS" },
  },
};

export const FX = { USD_KES: 129.83, asOf: "2026-10-29", source: "open.er-api.com daily reference rate" };

/** Look up an HS code. Returns null when the code is not in the working table. */
export function resolveHS(hs) {
  const clean = String(hs ?? "").trim();
  if (!/^\d{4}(\.\d{2})?(\d{2})?$/.test(clean)) return null;
  const four = clean.slice(0, 4);
  const exact = HS_TABLE.find((r) => r.hs === clean) ?? HS_TABLE.find((r) => r.hs.startsWith(four + "."));
  if (!exact) return { hs: clean, label: "unresolved", band: null, pvoc: null, source: "not in the working table — classify against the CET 2022 schedule" };
  return { ...exact, source: "EAC CET 2022 working subset — confirm the exact subheading before declaration" };
}

/**
 * Duty rate for a consignment.
 * originCountry inside the EAC with a valid certificate of origin gets 0% under the customs union;
 * without the certificate the CET band applies, because the preference is claimed by document.
 */
export function dutyTreatment({ hs, originCountry, hasEacCertificateOfOrigin = false }) {
  const item = resolveHS(hs);
  if (!item || item.band === null) {
    return { resolved: false, band: null, dutyRate: null, reason: "HS code not resolved — classification required before a figure is issued", item };
  }
  const inEac = Boolean(EAC_MEMBERS[String(originCountry ?? "").toUpperCase()]);
  if (inEac && hasEacCertificateOfOrigin) {
    return {
      resolved: true,
      band: item.band,
      dutyRate: 0,
      preferential: "EAC customs union — 0% on presentation of a valid EAC certificate of origin",
      documentsRequired: ["EAC Certificate of Origin", "Rules of origin declaration / supplier affidavit"],
      reason: "goods of East African origin, preference claimed by document",
      item,
    };
  }
  if (inEac) {
    return {
      resolved: true,
      band: item.band,
      dutyRate: item.band,
      preferential: null,
      documentsRequired: ["EAC Certificate of Origin — not yet attached, so the CET rate is applied"],
      reason: "EAC origin claimed but not evidenced; full CET rate applied until the certificate exists",
      item,
    };
  }
  return {
    resolved: true,
    band: item.band,
    dutyRate: item.band,
    preferential: null,
    documentsRequired: [],
    reason: `non-EAC origin — CET band ${(item.band * 100).toFixed(0)}%`,
    item,
  };
}

/** PVoC fee for a consignment, in USD and KES, with the route and the cap applied. */
export function pvocFee({ fobUsd, route = "A", fx = FX.USD_KES }) {
  const r = PVOC_FEES.routes[route];
  if (!r) throw new Error(`unknown PVoC route ${route}`);
  if (!(fobUsd >= 0)) throw new Error("fobUsd required");
  const raw = fobUsd * r.pct;
  const usd = Math.min(Math.max(raw, r.minUsd), r.maxUsd);
  return {
    route,
    pct: r.pct,
    fobUsd,
    usd: Math.round(usd * 100) / 100,
    kes: Math.round(usd * fx * 100) / 100,
    capped: raw < r.minUsd ? "minimum" : raw > r.maxUsd ? "maximum" : null,
    fx,
    source: PVOC_FEES.source,
  };
}

/** Waivers and exemptions, which are always evidence-based and time-limited. */
export const WAIVER_TYPES = {
  none: { label: "No waiver", requires: [] },
  diplomatic: { label: "Diplomatic exemption", requires: ["Ministry of Foreign Affairs note verbale", "KRA exemption authority"] },
  project: { label: "Approved project exemption", requires: ["Treasury approval letter", "Project registration"] },
  epz: { label: "EPZ / SEZ exemption", requires: ["EPZ licence", "EPZ Authority endorsement"] },
  raw_material: { label: "Raw material / manufacturer remission", requires: ["Manufacturer registration", "KRA remission approval"] },
};

export function waiverAdjustment({ type = "none", reference = null }) {
  const w = WAIVER_TYPES[type];
  if (!w) throw new Error(`unknown waiver ${type}`);
  if (type === "none") return { type, dutyRate: null, reference: null, requires: [], valid: false, note: "no waiver claimed" };
  return {
    type,
    dutyRate: 0,
    reference,
    requires: w.requires,
    valid: Boolean(reference),
    note: reference ? "waiver claimed with a reference — verify the letter before filing" : "waiver claimed without a reference — cannot be applied",
  };
}

/**
 * Is PVoC actually required? It verifies goods entering Kenya from outside the Community, so a
 * consignment of EAC origin moving under the customs union is controlled by its certificate of
 * origin, not by a conformity certificate. Charging the fee anyway would pad the quote.
 */
export function pvocApplicable({ item, originCountry, hasEacCertificateOfOrigin = false }) {
  if (!item?.pvoc) return { required: false, reason: "not a regulated category in the working table" };
  const inEac = Boolean(EAC_MEMBERS[String(originCountry ?? "").toUpperCase()]);
  if (inEac && hasEacCertificateOfOrigin) {
    return { required: false, reason: "EAC origin under the customs union — the certificate of origin governs; no PVoC fee belongs in the quote" };
  }
  return { required: true, reason: "regulated category entering Kenya from outside the EAC" };
}
