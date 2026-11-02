/**
 * Pricing policy — SOP-PRICING-001 in code.
 *
 * Two numbers govern every quote: 30% optimum margin, 10% absolute floor.
 * Two tests govern every client price: at least 5% below the market wholesale price,
 * and still above the floor after a further 5% concession.
 * Buying prices are solved backwards from the client price, never accepted as offered.
 */
import { KE_RATES } from "./landed.mjs";

export const POLICY = {
  targetMargin: 0.30,
  minMargin: 0.10,
  negotiationRoom: 0.05,   // room we deliberately leave for the client to push
  marketHeadroom: 0.05,    // how far under market wholesale we must sit
  maxQuoteValidityDays: 30,
  fxMaxAgeHours: 24,
};

const round = (n, dp = 2) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

/** Price that yields `margin` on a cost, ex-VAT. Margin on selling price. */
export function priceFromCost(costExVat, margin) {
  if (!(costExVat >= 0)) throw new Error("cost required");
  assertMargin(margin);
  return round(costExVat / (1 - margin));
}

/** Realised margin on a price. */
export function marginAt(costExVat, price) {
  if (!(price > 0)) throw new Error("price required");
  return round((price - costExVat) / price, 4);
}

export function assertMargin(margin) {
  if (typeof margin !== "number" || Number.isNaN(margin)) throw new Error("margin required");
  if (margin < POLICY.minMargin) {
    throw new Error(
      `margin ${(margin * 100).toFixed(1)}% is below the ${(POLICY.minMargin * 100).toFixed(0)}% floor — refuse and escalate`,
    );
  }
}

/** The ladder the desk shows a client or an approver. */
export function quoteLadder(costExVat) {
  return [0.10, 0.20, 0.30, 0.35, 0.40].map((m) => ({
    marginPct: m,
    price: priceFromCost(costExVat, m),
    role: m === POLICY.targetMargin ? "target" : m === POLICY.minMargin ? "floor" : "reference",
    withinPolicy: m >= POLICY.targetMargin,
  }));
}

/** Is our price far enough under the market wholesale price? */
export function marketTest(price, marketWholesale) {
  if (!(price > 0)) throw new Error("price required");
  if (!(marketWholesale > 0)) throw new Error("market wholesale benchmark required");
  const underPct = round((marketWholesale - price) / marketWholesale, 4);
  return {
    marketWholesale,
    price,
    underPct,
    passes: underPct >= POLICY.marketHeadroom,
    note: underPct >= POLICY.marketHeadroom
      ? `${(underPct * 100).toFixed(1)}% below market wholesale`
      : `only ${(underPct * 100).toFixed(1)}% below market wholesale — needs ${(POLICY.marketHeadroom * 100).toFixed(0)}%`,
  };
}

/**
 * Full policy check on a proposed quote.
 * @param {object} p
 * @param {number} p.costExVat      landed cost, VAT excluded
 * @param {number} p.price          proposed client price, VAT excluded
 * @param {number} [p.marketWholesale] benchmark for the same spec delivered in Kenya
 * @param {boolean} [p.marketVerified] false when the benchmark is a placeholder
 */
export function assessQuote({ costExVat, price, marketWholesale, marketVerified = true }) {
  const margin = marginAt(costExVat, price);
  const afterConcession = round(price * (1 - POLICY.negotiationRoom));
  const marginAfterConcession = marginAt(costExVat, afterConcession);
  const mt = marketWholesale ? marketTest(price, marketWholesale) : null;
  const failures = [];
  if (margin < POLICY.minMargin) failures.push("below the 10% floor");
  if (marginAfterConcession < POLICY.minMargin) {
    failures.push("the 5% negotiation room breaks the floor");
  }
  if (mt && !mt.passes) failures.push("not 5% below market wholesale");
  if (mt && !marketVerified) failures.push("market benchmark unverified");
  if (margin < POLICY.targetMargin && margin >= POLICY.minMargin) {
    failures.push("below the 30% optimum — needs a stated reason");
  }
  return {
    price,
    costExVat,
    margin,
    marginPct: round(margin * 100, 2),
    concessionPrice: afterConcession,
    marginAfterConcession,
    marginAfterConcessionPct: round(marginAfterConcession * 100, 2),
    grossProfit: round(price - costExVat),
    market: mt,
    passesFloor: margin >= POLICY.minMargin && marginAfterConcession >= POLICY.minMargin,
    atOptimum: margin >= POLICY.targetMargin,
    failures,
    verdict: failures.length === 0 ? "issued" : "refused or escalated",
  };
}

/**
 * Solve the FOB buying price that still yields `price` at `margin`, after services.
 * Analytic inverse of landedCost(): costExVat = CIF*(1 + duty + idf + rdl) + services,
 * CIF = (goods + freight) * (1 + insuranceRate).
 */
export function solveBuyPrice({
  price,
  margin = POLICY.targetMargin,
  freight = 0,
  services = 0,
  dutyRate = 0,
  insuranceRate = 0.005,
  quantity = 1,
  rates = KE_RATES,
} = {}) {
  assertMargin(margin);
  if (!(price > 0)) throw new Error("price required");
  const idf = rates.levies.idf;
  const rdl = rates.levies.rdl;
  const allowedCost = price * (1 - margin);
  const cifAllowed = (allowedCost - services) / (1 + dutyRate + idf + rdl);
  if (!(cifAllowed > 0)) {
    throw new Error("no buying price fits: services and statutory charges exceed the allowed cost");
  }
  const goodsUsd = cifAllowed / (1 + insuranceRate) - freight;
  if (!(goodsUsd > 0)) {
    throw new Error("no buying price fits: freight alone exceeds the allowed CIF");
  }
  return {
    price,
    margin,
    allowedCost: round(allowedCost),
    cifAllowed: round(cifAllowed),
    goodsTotalUsd: round(goodsUsd),
    goodsPerUnitUsd: round(goodsUsd / quantity),
    fobPerUnitUsd: round(goodsUsd / quantity),
    dutyRate,
    servicesUsd: round(services),
    freightUsd: round(freight),
    note: "all figures in the quote currency (USD); freight and services must be given in that currency",
  };
}

/** Quote validity check: a supplier quote must outlive ours. */
export function validityCheck({ supplierValidUntil, quoteValidDays = POLICY.maxQuoteValidityDays, today = new Date() }) {
  const t = new Date(today).getTime();
  const sup = new Date(supplierValidUntil).getTime();
  const needed = t + quoteValidDays * 86400000;
  return {
    quoteValidDays,
    supplierValidUntil,
    supplierCoversQuote: sup >= needed,
    supplierDaysLeft: Math.floor((sup - t) / 86400000),
    note: sup >= needed
      ? "supplier quote covers our validity"
      : "supplier quote expires inside our validity — re-quote before issuing",
  };
}

/** FX stamps: never quote on a rate older than 24 hours. */
export function fxStamp({ usdKes, source, asOf, now = new Date() }) {
  const ageH = (new Date(now).getTime() - new Date(asOf).getTime()) / 3600000;
  return {
    usdKes, source, asOf,
    ageHours: round(ageH, 1),
    fresh: ageH <= POLICY.fxMaxAgeHours,
    note: ageH <= POLICY.fxMaxAgeHours ? "rate current" : "rate older than 24h — re-run before issue",
  };
}
