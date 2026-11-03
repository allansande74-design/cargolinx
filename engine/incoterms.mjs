/**
 * The Incoterm the desk quotes on, written down once so the page and the tests read the same list.
 *
 * The house term for an export to China is CIF, named Chinese port: Altovex carries the goods to that port
 * and insures them on the way, and the importer takes over from the quay. Two things operators get wrong,
 * and both are stated here rather than left to memory:
 *
 *   1. Risk does not travel to the destination port. Under CIF risk passes when the goods are on board at
 *      Mombasa, even though the seller is still paying the freight. A buyer who thinks risk moves at the
 *      destination quay is uninsured for the sea passage and does not know it.
 *   2. CIF's minimum cover is Institute Cargo Clauses (C), which excludes a good deal. We quote (C) because
 *      that is what the term requires, and price (A) when a buyer wants it in writing.
 *
 * What is deliberately absent is a Chinese duty, VAT or port charge on our side of the line: those are the
 * importer's, and no Chinese tariff is held.
 */

export const TRADE_TERM = "CIF";

export const CIF_SCOPE = Object.freeze({
  term: TRADE_TERM,
  named: "named Chinese port",
  seller: Object.freeze([
    "Collection and inland haulage to Mombasa",
    "Export declaration, licence and phytosanitary papers",
    "Ocean freight to the named Chinese port",
    "Marine insurance, Institute Cargo Clauses (C), 110% of invoice value",
  ]),
  buyer: Object.freeze([
    "Import clearance in China and any Chinese duty or VAT",
    "Destination port charges and terminal handling",
    "Inland haulage and inland processing in China",
    "Last-mile delivery, unloading and final inspection",
  ]),
  riskPasses: "on board at Mombasa, not at the Chinese quay",
  insurance: "Institute Cargo Clauses (C) at 110% of invoice value; (A) priced on request",
});

/** Everything the importer takes on, flattened for a page or a test to read. */
export function buyerObligations(scope = CIF_SCOPE) {
  return [...scope.buyer];
}

/** True when a cost line is the importer's under this term - used to keep duty out of our stack. */
export function isImporterCost(line, scope = CIF_SCOPE) {
  const text = String(line || "").toLowerCase();
  return scope.buyer.some((item) => {
    const words = item.toLowerCase().match(/[a-z]{5,}/g) || [];
    return words.some((w) => text.includes(w));
  });
}
