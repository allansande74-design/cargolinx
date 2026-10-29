/**
 * Sourcing and dropship economics.
 *
 * Models the two marketplaces honestly: a supplier offer is a price ladder with a minimum order
 * quantity, a lead time, a freight estimate and a certificate position. Dropshipping is the same
 * arithmetic with one parcel instead of a pallet, and a different risk: you cannot inspect it.
 *
 * Nothing here fetches anything. It reasons over offers an operator supplies or a plugin returns.
 */

const CURRENCY_HINTS = { "kes": "KES", "ksh": "KES", "usd": "USD", "$": "USD", "eur": "EUR", "cny": "CNY", "rmb": "CNY" };

const UNIT_ALIASES = {
  pcs: "piece", pc: "piece", pieces: "piece", piece: "piece",
  units: "unit", unit: "unit", sets: "set", set: "set",
  cartons: "carton", carton: "carton", boxes: "box", box: "box",
  pairs: "pair", pair: "pair", rolls: "roll", roll: "roll",
};
function normaliseUnit(raw) {
  const k = String(raw ?? "").toLowerCase();
  return UNIT_ALIASES[k] ?? k.replace(/s$/, "");
}

/** Turn a plain-language request into a brief. Deterministic, so it works with no key and no network. */
export function parseSpec(text) {
  const s = String(text ?? "");
  const qtyMatch = s.match(/(\d[\d,]*)\s*(pcs|pieces|units?|cartons?|sets?|pairs?|rolls?|boxes?)/i);
  const moneyMatch = s.match(/(?:under|below|budget|max(?:imum)?)\s*(?:of\s*)?(?:usd|kes|ksh|\$)?\s*([\d,]+(?:\.\d+)?)/i);
  const destMatch = s.match(/\b(?:to|into|for)\s+(kenya|uganda|tanzania|rwanda|burundi|south sudan|drc|congo)\b/i);
  const countryCode = { kenya: "KE", uganda: "UG", tanzania: "TZ", rwanda: "RW", burundi: "BI", "south sudan": "SS", drc: "CD", congo: "CD" };
  const hsMatch = s.match(/\b(\d{4}\.\d{2})\b/);
  const currency = Object.entries(CURRENCY_HINTS).find(([k]) => new RegExp(`\\b${k}\\b`, "i").test(s))?.[1] ?? "USD";

  const product = s
    .replace(/(\d[\d,]*)\s*(pcs|pieces|units?|cartons?|sets?|pairs?|rolls?|boxes?)/gi, " ")
    .replace(/(?:under|below|budget|max(?:imum)?)\s*(?:of\s*)?(?:usd|kes|ksh|\$)?\s*[\d,]+(?:\.\d+)?/gi, " ")
    .replace(/\b(?:to|into|for)\s+(kenya|uganda|tanzania|rwanda|burundi|south sudan|drc|congo)\b/gi, " ")
    .replace(/\bHS\s*\d{4}\.?\d{0,2}\b/gi, " ")
    .replace(/\b(?:usd|kes|ksh|eur|cny|rmb)\b/gi, " ")
    .replace(/^(?:i\s+need|i\s+want|we\s+need|we\s+want|please|could\s+you|can\s+you|find|source|looking\s+for|quote\s+me)\b[:,]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;.\-\s]+|[,;.\-\s]+$/g, "")
    .replace(/^of\s+/i, "")
    .replace(/\s+([,;.])/g, "$1");

  return {
    product: product || null,
    qty: qtyMatch ? Number(qtyMatch[1].replace(/,/g, "")) : null,
    qtyUnit: qtyMatch ? normaliseUnit(qtyMatch[2]) : null,
    budget: moneyMatch ? Number(moneyMatch[1].replace(/,/g, "")) : null,
    currency,
    destination: destMatch ? countryCode[destMatch[1].toLowerCase()] : null,
    hsHint: hsMatch ? hsMatch[1] : null,
    original: s,
    complete: Boolean(product && qtyMatch),
  };
}

/** Pick the price tier a quantity falls into, and say plainly when it is below the minimum. */
export function selectTier(tiers = [], qty) {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new Error("no price tiers on this offer");
  if (!(qty > 0)) throw new Error("quantity required");
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const eligible = sorted.filter((t) => qty >= t.minQty);
  if (eligible.length === 0) {
    const lowest = sorted[0];
    return { tier: null, unitPrice: lowest.unitPrice, atMoqPrice: true, belowMoq: true, moq: lowest.minQty, shortfall: lowest.minQty - qty };
  }
  const tier = eligible[eligible.length - 1];
  return { tier, unitPrice: tier.unitPrice, belowMoq: false, moq: sorted[0].minQty };
}

/**
 * Landed cost per unit for a dropship parcel or a bulk consignment.
 * Freight is charged per shipment; clearing and last mile are added once.
 */
export function landedPerUnit({ qty, unitPrice, freight = 0, insuranceRate = 0.005, dutyRate = 0, vatRate = 0.16, fx = 129.83, clearing = 0, lastMile = 0, currency = "USD" }) {
  if (!(qty > 0)) throw new Error("quantity required");
  if (!(unitPrice >= 0)) throw new Error("unit price required");
  const goods = qty * unitPrice;
  const insurance = (goods + freight) * insuranceRate;
  const cif = goods + freight + insurance;
  const duty = cif * dutyRate;
  const vat = (cif + duty) * vatRate;
  const total = cif + duty + vat + clearing + lastMile;
  return {
    currency,
    qty,
    goods: round(goods),
    freight: round(freight),
    insurance: round(insurance),
    cif: round(cif),
    duty: round(duty),
    vat: round(vat),
    clearing: round(clearing),
    lastMile: round(lastMile),
    total: round(total),
    perUnit: round(total / qty),
    perUnitKes: round((total / qty) * fx),
    fx,
  };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * Score an offer for a specific requirement.
 * Weights are stated so a trader can argue with them, and every deduction carries a reason.
 */
export function scoreOffer(offer, ctx = {}) {
  const { qty = offer.moq ?? 1, budget = null, destination = "KE" } = ctx;
  const reasons = [];
  let score = 100;
  const tier = offer.tiers ? selectTier(offer.tiers, qty) : { unitPrice: offer.unitPrice, belowMoq: false, moq: offer.moq };

  if (tier.belowMoq) {
    score -= 35;
    reasons.push(`below MOQ: ${qty} of ${tier.moq} required`);
  }
  if (budget && tier.unitPrice && tier.unitPrice > budget) {
    const over = ((tier.unitPrice - budget) / budget) * 100;
    score -= Math.min(30, Math.round(over));
    reasons.push(`unit price ${over.toFixed(0)}% over budget`);
  }
  if (offer.leadTimeDays > 30) {
    score -= Math.min(20, offer.leadTimeDays - 30);
    reasons.push(`lead time ${offer.leadTimeDays} days`);
  }
  if (!offer.certifications?.length) {
    score -= 10;
    reasons.push("no conformity or test certificate declared");
  }
  if (offer.rating) {
    const bonus = Math.round((offer.rating - 4) * 5);
    if (bonus > 0) {
      score += Math.min(10, bonus);
      reasons.push(`supplier rating ${offer.rating}`);
    }
  }
  if (offer.shipsTo && !offer.shipsTo.includes(destination)) {
    score -= 40;
    reasons.push(`does not ship to ${destination}`);
  }
  const bounded = Math.max(0, Math.min(100, score));
  return {
    supplier: offer.supplier,
    unitPrice: tier.unitPrice,
    belowMoq: tier.belowMoq,
    leadTimeDays: offer.leadTimeDays ?? null,
    score: bounded,
    verdict: bounded >= 75 ? "shortlist" : bounded >= 50 ? "consider" : "reject",
    reasons,
  };
}

export function compareOffers(offers = [], ctx = {}) {
  if (!offers.length) return [];
  return offers.map((o) => scoreOffer(o, ctx)).sort((a, b) => b.score - a.score);
}

/**
 * Dropship or hold stock?
 * The answer is arithmetic: compare the per-unit landed cost of buying the MOQ now against the
 * per-unit cost of dropshipping the same demand, and state the cash that is tied up either way.
 */
export function dropshipDecision({ demandPerMonth, moq, unitPriceBulk, unitPriceDropship, freightBulk = 0, freightDropship = 0, dutyRate = 0.25, fx = 129.83 }) {
  if (!(demandPerMonth > 0)) throw new Error("monthly demand required");
  const dropship = landedPerUnit({ qty: demandPerMonth, unitPrice: unitPriceDropship, freight: freightDropship * demandPerMonth, dutyRate, fx });
  const bulkTier = selectTier([{ minQty: moq, unitPrice: unitPriceBulk }], moq);
  const bulk = landedPerUnit({ qty: moq, unitPrice: unitPriceBulk, freight: freightBulk, dutyRate, fx });
  const monthsOfCover = moq / demandPerMonth;
  const cashTied = bulk.total;
  const savingPerUnit = dropship.perUnit - bulk.perUnit;
  return {
    recommendation: savingPerUnit > 0 && monthsOfCover <= 6 ? "hold stock" : "dropship",
    bulkPerUnit: bulk.perUnit,
    dropshipPerUnit: dropship.perUnit,
    savingPerUnit: round(savingPerUnit),
    monthsOfCover: round(monthsOfCover),
    cashTiedKes: round(cashTied * fx),
    why:
      savingPerUnit <= 0
        ? "the bulk price does not beat the dropship price once freight and duty are in"
        : monthsOfCover > 6
        ? `the MOQ would take ${round(monthsOfCover)} months of demand to clear`
        : `bulk is cheaper per unit and the MOQ clears in ${round(monthsOfCover)} months`,
    moqCheck: bulkTier.belowMoq,
  };
}

/** A request for quotation that a supplier can answer without a phone call. */
export function rfqDraft(spec, { buyer = "Altovex Global Logistics Co. Ltd", destination = "Nairobi, Kenya" } = {}) {
  if (!spec?.product) throw new Error("a product description is required before an RFQ can be drafted");
  const qty = spec.qty ? `${spec.qty} ${spec.qtyUnit ?? "units"}` : "quantity to be confirmed";
  return [
    `Subject: Request for quotation — ${spec.product}`,
    "",
    `Dear supplier,`,
    "",
    `${buyer} is sourcing ${spec.product} for delivery to ${destination}. Please quote for ${qty}.`,
    "",
    "We need, in your reply:",
    "1. Unit price at our quantity, and your price ladder with minimum order quantities.",
    "2. Production or handling lead time, and the earliest shipment date.",
    "3. Packing dimensions and gross weight per carton, so freight can be quoted accurately.",
    "4. Certifications you hold for this product (conformity, test reports, material declarations).",
    "5. Whether you can ship direct to our consignee on a dropship basis, and your per-parcel rate.",
    spec.hsHint ? `6. Confirmation that the goods fall under HS ${spec.hsHint} and any export licence required.` : "6. Any export licence or permit the goods require.",
    "",
    "Payment is against documents; inspection may be arranged before shipment for first orders.",
    "",
    "Regards,",
    buyer,
  ].join("\n");
}
