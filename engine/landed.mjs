/**
 * Landed-cost engine — deterministic, no model involved.
 * Every figure is produced as an itemised line with its base and its rate,
 * so a quote can be defended line by line at a KRA counter.
 */
import { KE_2026 } from "./rates/ke-2026.mjs";

export const KE_RATES = KE_2026;


const round = (n, dp = 2) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;

/**
 * CIF = cost of goods + international freight + insurance.
 * Insurance falls back to a rate on (goods + freight) when no premium is quoted.
 */
export function cif({ goods, freight, insurance, insuranceRate = 0.005 }) {
  if (!(goods >= 0)) throw new Error("goods value required");
  if (!(freight >= 0)) throw new Error("freight value required");
  const premium = insurance ?? round((goods + freight) * insuranceRate);
  return { goods, freight, insurance: round(premium), cif: round(goods + freight + premium) };
}

/**
 * Full landed cost for one consignment.
 * All money in one currency unit (default KES); fx converts foreign-supplier costs first.
 */
export function landedCost(input, rates = KE_RATES) {
  const {
    goods,
    freight,
    insurance,
    insuranceRate,
    dutyRate,
    exciseRate = 0,
    vatRate = rates.vat.standard,
    portCharges = 0,
    clearing = 0,
    transport = 0,
    lastMile = 0,
    other = 0,
    quantity = 1,
  } = input;

  if (typeof dutyRate !== "number") throw new Error("dutyRate required (use an EAC CET band)");
  if (!rates.dutyBands.some((b) => Math.abs(b - dutyRate) < 1e-9)) {
    throw new Error(`dutyRate ${dutyRate} is not an EAC CET band (${rates.dutyBands.join(", ")})`);
  }

  const base = cif({ goods, freight, insurance, insuranceRate });
  const duty = round(base.cif * dutyRate);
  const excise = round((base.cif + duty) * exciseRate);
  const idf = round(base.cif * rates.levies.idf);
  const rdl = round(base.cif * rates.levies.rdl);
  const vatBase = round(base.cif + duty + excise + idf + rdl);
  const vat = round(vatBase * vatRate);

  const statutory = round(duty + excise + idf + rdl + vat);
  const services = round(portCharges + clearing + transport + lastMile + other);
  const total = round(base.cif + statutory + services);

  return {
    quantity,
    currency: rates.currency,
    lines: [
      { code: "GOODS", label: "Goods (customs value)", base: null, rate: null, amount: base.goods },
      { code: "FREIGHT", label: "International freight", base: null, rate: null, amount: base.freight },
      { code: "INSURANCE", label: "Marine insurance", base: null, rate: null, amount: base.insurance },
      { code: "CIF", label: "CIF / customs value", base: null, rate: null, amount: base.cif },
      { code: "DUTY", label: `Import duty (EAC CET ${(dutyRate * 100).toFixed(0)}%)`, base: base.cif, rate: dutyRate, amount: duty },
      { code: "EXCISE", label: `Excise (${(exciseRate * 100).toFixed(1)}%)`, base: round(base.cif + duty), rate: exciseRate, amount: excise },
      { code: "IDF", label: "Import declaration fee (2.5%)", base: base.cif, rate: rates.levies.idf, amount: idf },
      { code: "RDL", label: "Railway development levy (2%)", base: base.cif, rate: rates.levies.rdl, amount: rdl },
      { code: "VAT", label: `VAT (${(vatRate * 100).toFixed(0)}%)`, base: vatBase, rate: vatRate, amount: vat },
      { code: "PORT", label: "Port and terminal charges", base: null, rate: null, amount: round(portCharges) },
      { code: "CLEARING", label: "Clearing and documentation", base: null, rate: null, amount: round(clearing) },
      { code: "TRANSPORT", label: "Inland transport", base: null, rate: null, amount: round(transport) },
      { code: "LASTMILE", label: "Last mile", base: null, rate: null, amount: round(lastMile) },
      { code: "OTHER", label: "Other charges", base: null, rate: null, amount: round(other) },
    ],
    totals: {
      cif: base.cif,
      statutory,
      services,
      total,
      perUnit: round(total / quantity),
      recoverableVat: vat,
      netCostExVat: round(total - vat),
    },
    rates,
  };
}

/**
 * Quote from a landed cost.
 * Floor is a refusal, not a warning: below the floor the engine refuses to issue.
 */
export function quote(lc, { marginPct, minMarginPct = 0.15, targetMinPct = 0.3, targetMaxPct = 0.4 } = {}) {
  if (typeof marginPct !== "number") throw new Error("marginPct required");
  if (marginPct < minMarginPct) {
    throw new Error(`margin ${(marginPct * 100).toFixed(1)}% is below the ${(minMarginPct * 100).toFixed(0)}% floor — escalate, do not issue`);
  }
  const cost = lc.totals.netCostExVat;
  const price = round(cost / (1 - marginPct));
  return {
    currency: lc.currency,
    costExVat: cost,
    price,
    vatOnSale: round(price * lc.rates.vat.standard),
    priceIncVat: round(price + price * lc.rates.vat.standard),
    grossProfit: round(price - cost),
    marginPct,
    withinPolicyBand: marginPct >= targetMinPct && marginPct <= targetMaxPct,
    lines: lc.lines,
    totals: lc.totals,
  };
}

/** Cheapest defensible counter-offer: what price still clears the floor. */
export function floorPrice(lc, minMarginPct = 0.15) {
  const cost = lc.totals.netCostExVat;
  return { currency: lc.currency, costExVat: cost, floorPrice: round(cost / (1 - minMarginPct)), marginPct: minMarginPct };
}

export { round };
