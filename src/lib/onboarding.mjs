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
