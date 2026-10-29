/**
 * Country systems and the express corridor.
 *
 * The honest position: none of these revenue systems offers a public filing API to a third party
 * without an agent licence and a bilateral arrangement. What the desk can do today is prepare the
 * file, pre-validate it, and hand it over in the exact shape the agent will key in. Every entry
 * therefore states its integration level as it really is.
 */

export const COUNTRIES = {
  KE: {
    name: "Kenya",
    customs: "KRA iCMS",
    tax: "KRA iTax",
    singleWindow: "KenTrade TradeNet",
    level: "manual",
    confidence: "verified",
    notes: "iCMS consolidates customs declarations. Filing is through a licensed clearing agent.",
  },
  UG: {
    name: "Uganda",
    customs: "URA customs (ASYCUDA World)",
    tax: "URA eServices / eFRIS",
    singleWindow: "Uganda Electronic Single Window",
    level: "manual",
    confidence: "to confirm",
    notes: "Confirm current declaration platform with URA before any integration claim.",
  },
  TZ: {
    name: "Tanzania",
    customs: "TRA TANCIS",
    tax: "TRA online filing",
    singleWindow: "Tanzania customs portal",
    level: "manual",
    confidence: "to confirm",
    notes: "TANCIS is the declared platform; confirm access route for agents.",
  },
  RW: {
    name: "Rwanda",
    customs: "RRA customs (ASYCUDA World)",
    tax: "RRA e-Tax",
    singleWindow: "Rwanda trade portal",
    level: "manual",
    confidence: "to confirm",
    notes: "Confirm platform and agent access.",
  },
  BI: {
    name: "Burundi",
    customs: "OBR customs (SYDONIA)",
    tax: "OBR e-declaration",
    singleWindow: "OBR portal",
    level: "manual",
    confidence: "to confirm",
    notes: "Confirm platform.",
  },
  SS: {
    name: "South Sudan",
    customs: "NRA customs",
    tax: "NRA",
    singleWindow: "—",
    level: "manual",
    confidence: "to confirm",
    notes: "Paper-heavy; confirm current system.",
  },
  CD: {
    name: "DR Congo",
    customs: "DGDA (SYDONIA)",
    tax: "DGI",
    singleWindow: "DGDA portal",
    level: "manual",
    confidence: "to confirm",
    notes: "EAC member since 2022; CET application varies by entry point — verify per corridor.",
  },
};

export function country(code) {
  const c = COUNTRIES[String(code ?? "").toUpperCase()];
  if (!c) throw new Error(`unknown country ${code}`);
  return { code: String(code).toUpperCase(), ...c };
}

/** What we can actually do with a country's systems today. No aspirational claims. */
export function integrationState(code) {
  const c = country(code);
  return {
    country: c.code,
    customs: c.customs,
    singleWindow: c.singleWindow,
    level: c.level,
    canFile: false,
    canQueryStatus: false,
    canUploadDocuments: false,
    canPreValidate: true,
    statement: `The desk prepares and pre-validates the file for ${c.customs}; lodging is done by a licensed agent. No direct filing API is claimed.`,
  };
}

/** Documents a country's clearance normally demands beyond the shared dossier. */
export const COUNTRY_EXTRAS = {
  KE: ["standards_permit"],
  UG: [],
  TZ: ["standards_permit"],
  RW: [],
  BI: [],
  SS: [],
  CD: [],
};

/**
 * Express corridor readiness.
 * Green only when the dossier is complete and verified, the duty treatment is evidenced, and the
 * consignment is not in a sensitive category. Anything else falls to yellow or red with reasons.
 */
export function expressReadiness({ dossier, dutyTreatment, pvoc, traderProfile = {} }) {
  const reasons = [];
  let score = 100;

  const mandatory = (dossier ?? []).filter((d) => d.mandatory);
  const unverified = mandatory.filter((d) => d.status !== "verified");
  if (unverified.length) {
    score -= Math.min(60, unverified.length * 12);
    reasons.push(`${unverified.length} mandatory document(s) not verified: ${unverified.map((d) => d.label).join(", ")}`);
  }

  if (dutyTreatment && !dutyTreatment.resolved) {
    score -= 40;
    reasons.push("duty treatment unresolved — no HS classification yet");
  }
  if (dutyTreatment?.preferential) {
    reasons.push("preferential rate claimed — the certificate of origin must be verified, not merely attached");
  }
  if (pvoc?.required && !pvoc.certificateAttached) {
    score -= 25;
    reasons.push("PVoC certificate outstanding for regulated goods");
  }
  if (traderProfile.aeo || traderProfile.trustedTrader) {
    score += 5;
    reasons.push("trusted trader status on file");
  } else {
    reasons.push("no authorised economic operator status on file — expect physical inspection");
  }
  if (traderProfile.firstShipmentOnLane) {
    score -= 10;
    reasons.push("first shipment on this lane — allow for inspection");
  }

  const bounded = Math.max(0, Math.min(100, score));
  const lane = bounded >= 85 ? "green" : bounded >= 60 ? "yellow" : "red";
  return {
    score: bounded,
    lane,
    meaning:
      lane === "green"
        ? "File as presented; expect document checks only"
        : lane === "yellow"
        ? "File with gaps declared; expect inspection and a query"
        : "Do not promise a delivery date; the file cannot clear as it stands",
    reasons,
  };
}
