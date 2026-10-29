/**
 * Document dossier.
 *
 * A corridor shipment is cleared by documents, not by a price. This module decides what the
 * consignment needs, who issues it, and whether the file is actually ready to lodge.
 * Nothing here is optional by assertion: each document is mandatory for a stated reason.
 */

export const DOC_CATALOG = {
  commercial_invoice: { label: "Commercial invoice", issuer: "Exporter" },
  packing_list: { label: "Packing list", issuer: "Exporter" },
  transport_document: { label: "Bill of lading / road waybill / CMR", issuer: "Carrier" },
  insurance_certificate: { label: "Marine or goods-in-transit insurance", issuer: "Insurer" },
  certificate_of_origin: { label: "Certificate of origin", issuer: "Chamber of Commerce (non-EAC) or Revenue Authority (EAC)" },
  eac_certificate_of_origin: { label: "EAC certificate of origin", issuer: "Revenue Authority / authorised Chamber" },
  pvoc_certificate: { label: "Certificate of conformity (PVoC)", issuer: "KEBS-appointed agent — SGS, Intertek, Bureau Veritas, Cotecna or equivalent" },
  phytosanitary: { label: "Phytosanitary certificate", issuer: "KEPHIS" },
  standards_permit: { label: "Standards import permit / mark of quality", issuer: "KEBS" },
  transit_bond: { label: "Transit bond / T1 declaration", issuer: "Bond provider / customs" },
  import_entry: { label: "Import declaration (entry)", issuer: "Licensed clearing agent on the national customs system" },
  duty_payment: { label: "Duty and levy payment receipt", issuer: "Revenue authority" },
  weighbridge: { label: "Weighbridge / axle-load ticket", issuer: "Weighbridge operator" },
  pod: { label: "Proof of delivery", issuer: "Consignee, captured on device" },
  export_permit: { label: "Destination import permit or licence", issuer: "Destination authority" },
};

const AGRI_CHAPTERS = new Set(["06", "07", "08", "09", "10", "12", "44", "52"]);

export function needsPhytosanitary(hs) {
  const chapter = String(hs ?? "").slice(0, 2);
  return AGRI_CHAPTERS.has(chapter);
}

/**
 * Build the dossier for one consignment.
 * @param {object} p shipment facts: hs, originCountry, destinationCountry, isTransit, includesAgri
 * @param {object} opts { pvocRequired, eacOrigin, waiverType }
 */
export function buildDossier(p, opts = {}) {
  const { hs, originCountry = "", destinationCountry = "KE", isTransit = false, includesAgri = false } = p;
  const eacOrigin = Boolean(opts.eacOrigin);
  const docs = [];
  const add = (code, mandatory, reason) => docs.push({ code, ...DOC_CATALOG[code], mandatory, reason, status: "missing" });

  if (!DOC_CATALOG.commercial_invoice) throw new Error("catalogue incomplete");
  add("commercial_invoice", true, "value basis for duty and VAT");
  add("packing_list", true, "identifies the goods actually shipped");
  add("transport_document", true, "contract of carriage and release document");
  add("insurance_certificate", true, "required cover for the consignment; also the insurance line in the cost");

  if (eacOrigin) {
    add("eac_certificate_of_origin", true, "0% EAC preferential rate is claimed by this document, not by assertion");
  } else {
    add("certificate_of_origin", true, "non-preferential origin; issued by the Chamber of Commerce");
  }

  if (opts.pvocRequired) add("pvoc_certificate", true, "regulated goods cannot enter Kenya without a certificate of conformity");
  if (needsPhytosanitary(hs) || includesAgri) add("phytosanitary", true, "plant health certificate required by KEPHIS for plant and plant-product consignments");
  if (opts.standardsPermitRequired) add("standards_permit", true, "standards permit or mark of quality required for this category");

  if (isTransit) add("transit_bond", true, "transit goods must be bonded until they leave the country");
  add("import_entry", true, `lodged on ${destinationCountry === "KE" ? "KRA iCMS" : "the destination customs system"} by a licensed agent`);
  add("duty_payment", true, "proof that duties and levies were settled");
  if (opts.exportPermitRequired) add("export_permit", false, "destination-specific permit; confirm with the consignee");
  add("pod", false, "closes the file and releases the balance");

  return docs;
}

/** Where the file stands: what is missing, what blocks lodging, what is merely pending. */
export function dossierStatus(docs) {
  const missing = docs.filter((d) => d.mandatory && d.status === "missing");
  const attached = docs.filter((d) => d.status === "attached");
  const verified = docs.filter((d) => d.status === "verified");
  return {
    total: docs.length,
    verified: verified.length,
    attached: attached.length,
    missingCount: missing.length,
    readyToLodge: missing.length === 0,
    blockers: missing.map((d) => `${d.label} — ${d.reason}`),
    nextAction: missing[0] ? `Obtain ${missing[0].label} from ${missing[0].issuer}` : "File the entry",
  };
}

/** Mark a document as attached or verified, refusing to verify something not attached. */
export function setDocStatus(docs, code, status) {
  if (!["missing", "attached", "verified"].includes(status)) throw new Error(`unknown status ${status}`);
  const target = docs.find((d) => d.code === code);
  if (!target) throw new Error(`no document ${code} in this dossier`);
  if (status === "verified" && target.status === "missing") throw new Error("attach the document before verifying it");
  return docs.map((d) => (d.code === code ? { ...d, status, updatedAt: new Date().toISOString() } : d));
}
