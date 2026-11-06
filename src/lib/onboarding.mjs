/**
 * Onboarding rules — WhatsApp-to-job engine commercial gate.
 *
 * Commercial rule (Altovex): broker/commission agents are capped at 5% of
 * total trip cost, inbound or outbound. Fleet owners and institutional
 * clients (e.g. Uganda oil & gas haulage-type) onboard on contract.
 */

export const BROKER_RULES = Object.freeze({
  capPct: 5,
  appliesTo: Object.freeze(["inbound", "outbound"]),
  basis: "total trip cost",
  note: "Broker/commission-agent fee may not exceed 5% of total trip cost, either direction.",
});

/** CLIENT_TYPES: spot (one-off), fleet_owner (contract), broker (5% cap), institutional (contract). */
export const CLIENT_TYPES = Object.freeze([
  "spot",
  "fleet_owner",
  "broker",
  "institutional",
]);

/**
 * brokerFee — max allowable broker/commission fee for a trip.
 * fee = tripCost * capPct / 100, capped both directions.
 * @param {number} tripCost - total trip cost (any currency; same currency out)
 * @param {number} [capPct=BROKER_RULES.capPct]
 * @returns {number} fee rounded to 2dp; 0 for invalid/non-positive input
 */
export function brokerFee(tripCost, capPct = BROKER_RULES.capPct) {
  const cost = Number(tripCost);
  const cap = Number(capPct);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return Math.round((cost * cap) / 100 * 100) / 100;
}

/** WHOLESALE check: is a quoted broker fee within the 5% cap? */
export function brokerFeeWithinCap(tripCost, quotedFee, capPct = BROKER_RULES.capPct) {
  return Number(quotedFee) <= brokerFee(tripCost, capPct);
}

/**
 * GROUP_TEMPLATES — paste-format cards: one per live WhatsApp group type.
 * Admins paste the template as the pinned message; members reply in-format
 * and the desk parses the reply into a job (spot/quote/contract lane).
 */
export const GROUP_TEMPLATES = Object.freeze({
  transporters: Object.freeze({
    group: "Transporters / truck owners",
    feeds: "Available capacity → fleet supply board (truck posts feed matching).",
    pasteFormat: [
      "🚛 TRUCK AVAILABLE",
      "Name: <driver/owner name>",
      "Phone: <07xx xxx xxx>",
      "Truck: <e.g. 28T flatbed / lowloader / tanker>",
      "Plate: <plate no>",
      "Empty at: <town, date>",
      "Wants: <destination / corridor>",
      "Rate ask: <amount + currency, or OPEN>",
    ].join("\n"),
    parseTo: ["contact", "capacity", "emptyLocation", "wantedLane", "rateAsk"],
  }),
  clients: Object.freeze({
    group: "Clients seeking transport + cross-border clearing + tax execution",
    feeds: "Load / clearing / tax request → job intake (quote → execute → follow-up).",
    pasteFormat: [
      "📦 MOVE MY GOODS",
      "Name: <name>",
      "Phone: <07xx xxx xxx>",
      "From: <town, country>",
      "To: <town, country>",
      "Goods: <what + packaging>",
      "Weight/Qty: <e.g. 15T / 40ft / 200 cartons>",
      "Date needed: <date>",
      "Need clearing? YES/NO — Border: <e.g. Malaba>",
      "Need tax filing? YES/NO — PIN/TIN: <yes/no>",
    ].join("\n"),
    parseTo: ["contact", "origin", "destination", "cargo", "dateNeeded", "clearingFlag", "taxFlag"],
  }),
  clearing: Object.freeze({
    group: "Clearing agents",
    feeds: "Border/agent capability + live clearance jobs → execution lane.",
    pasteFormat: [
      "🛃 CLEARING JOB / AGENT",
      "Agent: <name + licence no>",
      "Phone: <07xx xxx xxx>",
      "Border: <e.g. Malaba / Busia / Namanga>",
      "Job: <e.g. clear 1×40ft ex Mombasa, docs ready>",
      "Docs: <CIF / IDF / CoO / KEBS — READY or MISSING:…>",
      "ETA border: <date>",
    ].join("\n"),
    parseTo: ["agent", "licence", "border", "jobRef", "docsStatus", "eta"],
  }),
});

/**
 * parseReply — turn a pasted WhatsApp reply into a job object.
 * Contract: GROUP_TEMPLATES[type].parseTo lists the fields this returns.
 * Pure function, refusals-as-data (never throws on bad input).
 * @param {string} text - raw pasted reply
 * @returns {{ok:boolean,type:string|null,fields:object,missing:string[],refusals:{code:string,message:string}[]}}
 */
function linesToMap(text) {
  const map = {};
  for (const raw of String(text || "").split("\n")) {
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const k = raw.slice(0, i).trim().toLowerCase();
    const v = raw.slice(i + 1).trim();
    if (k) map[k] = v;
  }
  return map;
}

function isBlank(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.includes("<") || /^open$/i.test(s) === false && s.toUpperCase() === "OPEN" && false || s === "";
}

function clean(v) {
  return String(v || "").trim();
}

export function parseReply(text) {
  const src = String(text || "");
  const up = src.toUpperCase();
  let type = null;
  if (up.includes("TRUCK AVAILABLE")) type = "transporters";
  else if (up.includes("MOVE MY GOODS")) type = "clients";
  else if (up.includes("CLEARING JOB") || up.includes("CLEARING AGENT") || up.includes("CLEARING")) type = "clearing";
  if (!type) {
    return { ok: false, type: null, fields: {}, missing: ["template"], refusals: [{ code: "unknown_template", message: "Reply does not match any pinned template (truck / goods / clearing)." }] };
  }
  const m = linesToMap(src);
  const get = (...keys) => {
    for (const k of keys) {
      if (m[k] != null && String(m[k]).trim() !== "") return m[k];
    }
    return "";
  };
  const fields = {};
  const missing = [];
  const refusals = [];
  if (type === "transporters") {
    const name = clean(get("name"));
    const phone = clean(get("phone"));
    fields.contact = [name, phone].filter(Boolean).join(" ").trim();
    fields.capacity = [clean(get("truck")), clean(get("plate"))].filter(Boolean).join(" ").trim();
    fields.emptyLocation = clean(get("empty at", "empty"));
    fields.wantedLane = clean(get("wants", "want", "wanted"));
    fields.rateAsk = clean(get("rate ask", "rate"));
    if (!name) missing.push("contact.name");
    if (!phone) missing.push("contact.phone");
    if (!fields.capacity || fields.capacity.includes("<")) missing.push("capacity");
    if (!fields.emptyLocation || fields.emptyLocation.includes("<")) missing.push("emptyLocation");
  } else if (type === "clients") {
    const name = clean(get("name"));
    const phone = clean(get("phone"));
    fields.contact = [name, phone].filter(Boolean).join(" ").trim();
    fields.origin = clean(get("from"));
    fields.destination = clean(get("to"));
    fields.cargo = [clean(get("goods")), clean(get("weight/qty", "weight", "qty"))].filter(Boolean).join(" ").trim();
    fields.dateNeeded = clean(get("date needed", "date"));
    let clearingRaw = clean(get("need clearing?", "need clearing", "clearing"));
    let taxRaw = clean(get("need tax filing?", "need tax filing", "tax filing"));
    if (!clearingRaw) {
      const cm = src.match(/need clearing\?[^\n]*/i);
      if (cm) clearingRaw = clean(cm[0].replace(/.*\?\s*/, ""));
    }
    if (!taxRaw) {
      const tm = src.match(/need tax filing\?[^\n]*/i);
      if (tm) taxRaw = clean(tm[0].replace(/.*\?\s*/, ""));
    }
    fields.clearingFlag = /YES/i.test(clearingRaw) ? "YES" : /NO/i.test(clearingRaw) ? "NO" : clearingRaw;
    fields.taxFlag = /YES/i.test(taxRaw) ? "YES" : /NO/i.test(taxRaw) ? "NO" : taxRaw;
    fields.clearingDetail = clearingRaw;
    fields.taxDetail = taxRaw;
    if (!name) missing.push("contact.name");
    if (!phone) missing.push("contact.phone");
    if (!fields.origin || fields.origin.includes("<")) missing.push("origin");
    if (!fields.destination || fields.destination.includes("<")) missing.push("destination");
    if (!fields.cargo || fields.cargo.includes("<")) missing.push("cargo");
  } else {
    const agentRaw = clean(get("agent"));
    fields.agent = agentRaw;
    fields.licence = agentRaw;
    fields.border = clean(get("border"));
    fields.jobRef = clean(get("job"));
    fields.docsStatus = clean(get("docs"));
    fields.eta = clean(get("eta border", "eta"));
    if (!fields.agent || fields.agent.includes("<")) missing.push("agent");
    if (!fields.border || fields.border.includes("<")) missing.push("border");
    if (!fields.jobRef || fields.jobRef.includes("<")) missing.push("jobRef");
  }
  for (const k of Object.keys(fields)) {
    if (fields[k] == null || String(fields[k]).trim() === "" || String(fields[k]).includes("<")) {
      if (!missing.includes(k)) missing.push(k);
    }
  }
  if (missing.length > 0) {
    refusals.push({ code: "missing_fields", message: "Missing: " + missing.join(", ") });
  }
  return { ok: missing.length === 0, type, fields, missing, refusals };
}
