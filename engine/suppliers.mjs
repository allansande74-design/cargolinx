/**
 * Supplier register and purchasing.
 *
 * The register is the gate on our money. A supplier we have not verified cannot receive a purchase
 * order, no matter how good the price looks — verification is an event with a named checker and a
 * reference document, not a flag someone sets by feel.
 *
 * Scores are stated arithmetic so a trader can argue with them. A purchase order carries no tax:
 * it is our commitment to buy at an agreed price, and the tax lines belong on the supplier's invoice,
 * not on our order.
 *
 * Pure functions only: no filesystem, no network, no clock beyond what the caller passes.
 */

export const PAYMENT_TERMS = ["prepayment", "net15", "net30", "lc"];

/** The schemes the register recognises. An unknown certificate is not counted, and is said so. */
export const CERTIFICATION_SCHEMES = {
  iso9001: "ISO 9001 quality management",
  iso14001: "ISO 14001 environmental management",
  iso45001: "ISO 45001 occupational health and safety",
  iso22000: "ISO 22000 food safety management",
  haccp: "HACCP food safety",
  ce: "CE marking",
  rohs: "RoHS restricted substances",
  reach: "REACH chemical compliance",
  fcc: "FCC equipment authorisation",
  fda: "FDA registration",
  pvoc: "PVoC certificate of conformity",
  gots: "GOTS organic textile",
  oekotex: "OEKO-TEX Standard 100",
};

export const SCORE_RANGE = { min: 0, max: 100 };

const round = (n) => Math.round(n * 100) / 100;

function iso(at) {
  if (at === undefined || at === null) return new Date().toISOString();
  return (at instanceof Date ? at : new Date(at)).toISOString();
}

/** Kept as its own function so the bound can be tested directly, not inferred. */
export function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return SCORE_RANGE.min;
  return Math.max(SCORE_RANGE.min, Math.min(SCORE_RANGE.max, Math.round(v)));
}

function productList(products) {
  const raw = Array.isArray(products) ? products : products === null || products === undefined ? [] : [products];
  return [...new Set(raw.map((p) => String(p).trim()).filter(Boolean))];
}

function normaliseContact(contact) {
  if (!contact) return { email: null, phone: null, person: null };
  if (typeof contact === "string") return { email: contact.trim() || null, phone: null, person: null };
  return {
    email: contact.email ? String(contact.email).trim() : null,
    phone: contact.phone ?? null,
    person: contact.person ?? contact.name ?? null,
  };
}

/** "ISO 9001:2015" and "iso-9001" are the same scheme; "ISO 9999" is not a scheme we know. */
function classifCertifications(certifications = []) {
  const keys = Object.keys(CERTIFICATION_SCHEMES);
  const valid = [];
  const unrecognised = [];
  for (const raw of Array.isArray(certifications) ? certifications : [certifications]) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    const norm = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = keys.find((k) => norm === k || norm.startsWith(k));
    if (hit) {
      if (!valid.includes(hit)) valid.push(hit);
    } else {
      unrecognised.push(text);
    }
  }
  return { valid, unrecognised };
}

/**
 * Register a supplier. It always starts unverified: a record cannot be born already trusted.
 * A `verifiedAt` handed in with the registration is kept as a claim only, so the audit trail shows
 * it was never checked here.
 */
export function addSupplier({
  name,
  country,
  contact = null,
  products = [],
  certifications = [],
  leadTimeDays = null,
  paymentTerms = "prepayment",
  verifiedAt = null,
} = {}) {
  const cleanName = String(name ?? "").trim();
  if (cleanName.length < 2) throw new Error("supplier name required — the register cannot carry an unnamed supplier");

  const cc = String(country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error(`country must be a two-letter code, got "${country ?? ""}"`);

  if (!PAYMENT_TERMS.includes(paymentTerms)) {
    throw new Error(`unknown payment terms "${paymentTerms}" — expected one of ${PAYMENT_TERMS.join(", ")}`);
  }

  let lead = null;
  if (leadTimeDays !== null && leadTimeDays !== undefined && leadTimeDays !== "") {
    lead = Number(leadTimeDays);
    if (!Number.isFinite(lead) || lead < 0) throw new Error(`lead time must be a number of days, got "${leadTimeDays}"`);
  }

  const certs = (Array.isArray(certifications) ? certifications : [certifications]).map((c) => String(c).trim()).filter(Boolean);

  return {
    id: `sup_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    country: cc,
    contact: normaliseContact(contact),
    products: productList(products),
    certifications: certs,
    leadTimeDays: lead,
    paymentTerms,
    status: "unverified",
    verifiedAt: null,
    claimedVerifiedAt: verifiedAt ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify a supplier against a document. No reference, no verification — that is the whole point of
 * the field, and the reason the audit can be reconstructed later.
 */
export function verifySupplier(supplier, { by = null, reference = null, at = new Date() } = {}) {
  if (!supplier || typeof supplier !== "object") throw new Error("a supplier record is required");
  if (!reference || !String(reference).trim()) {
    throw new Error("verification requires a reference — a claim without a document is not verification");
  }
  if (!by || !String(by).trim()) throw new Error("verification must name who checked the supplier");

  const stamp = iso(at);
  const verification = { by: String(by).trim(), reference: String(reference).trim(), at: stamp };
  return {
    ...supplier,
    status: "verified",
    verifiedAt: stamp,
    verification,
    history: [...(supplier.history ?? []), { event: "verified", ...verification }],
  };
}

/**
 * Score a supplier out of 100. Starts at 60 because an unrated supplier is not a bad supplier —
 * they are an unknown one. Every movement is explained.
 */
export function scoreSupplier(supplier = {}) {
  const reasons = [];
  let score = 60;

  if (supplier.status === "verified") {
    score += 10;
    reasons.push("verified against a reference document");
  } else {
    reasons.push("not verified");
  }

  const { valid, unrecognised } = classifCertifications(supplier.certifications ?? []);
  if (valid.length) {
    const bonus = Math.min(15, valid.length * 5);
    score += bonus;
    reasons.push(`${valid.length} recognised certification${valid.length === 1 ? "" : "s"} (+${bonus})`);
  } else {
    reasons.push("no recognised certification on file");
  }
  if (unrecognised.length) reasons.push(`not counted, scheme not recognised: ${unrecognised.join(", ")}`);

  const lead = Number(supplier.leadTimeDays);
  if (Number.isFinite(lead) && lead > 45) {
    score -= 10;
    reasons.push(`lead time ${lead} days is over 45`);
  }

  if (!supplier.contact?.email) {
    score -= 10;
    reasons.push("no contact email on file");
  }

  if (["net15", "net30", "lc"].includes(supplier.paymentTerms)) {
    score += 5;
    reasons.push(`${supplier.paymentTerms} terms — we are not paying before shipment`);
  } else {
    reasons.push("prepayment terms");
  }

  return { score: clampScore(score), reasons };
}

/**
 * Issue a purchase order. Only against a verified supplier, and only with a price on every line:
 * an order without a unit price is an estimate wearing a number.
 *
 * There is no tax line on a purchase order, so none is computed.
 */
export function buildPurchaseOrder({ order, supplier, lines = [], number = null, at = new Date() } = {}) {
  if (!supplier) throw new Error("a purchase order needs a supplier");
  if (supplier.status !== "verified") {
    throw new Error(`supplier ${supplier.name ?? supplier.id ?? "(unnamed)"} is not verified — a purchase order cannot be issued against an unverified supplier`);
  }
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("a purchase order needs at least one line");

  const built = lines.map((l, i) => {
    const description = String(l.description ?? "").trim();
    if (!description) throw new Error(`line ${i + 1}: description required`);

    const qty = Number(l.qty);
    if (!(qty > 0)) throw new Error(`line ${i + 1}: quantity must be positive`);

    if (l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === "") {
      throw new Error(`line "${description}" has no unit price — a purchase order is a commitment and cannot be issued on an estimate`);
    }
    const unit = Number(l.unitPrice);
    if (!Number.isFinite(unit) || unit < 0) throw new Error(`line "${description}" has no unit price`);

    return {
      description,
      qty,
      unitPrice: round(unit),
      amount: round(qty * unit),
      ...(l.hs ? { hs: l.hs } : {}),
    };
  });

  const subtotal = round(built.reduce((a, l) => a + l.amount, 0));

  return {
    number: number ?? null,
    supplierId: supplier.id ?? null,
    orderId: order?.id ?? null,
    lines: built,
    subtotal,
    total: subtotal,
    issuedAt: iso(at),
    status: "issued",
  };
}

/**
 * Which of the register's suppliers can actually supply this product, best first.
 *
 * Price is not on the register — it arrives per quotation — so the ranking is supplier quality
 * (verification, certifications, terms, reachability) and lead time, which is what a buyer
 * shortlists on before any quote comes back.
 */
export function compareSuppliers(suppliers = [], { product, qty = null } = {}) {
  if (!product || !String(product).trim()) throw new Error("a product is required to compare suppliers");
  const needle = String(product).trim().toLowerCase();
  const pattern = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

  const matches = suppliers.filter((s) =>
    productList(s.products).some((p) => {
      const hay = p.toLowerCase();
      return hay === needle || pattern.test(hay);
    }),
  );

  return matches
    .map((s) => {
      const { score, reasons } = scoreSupplier(s);
      return {
        id: s.id ?? null,
        name: s.name ?? null,
        country: s.country ?? null,
        status: s.status ?? "unverified",
        paymentTerms: s.paymentTerms ?? null,
        leadTimeDays: s.leadTimeDays ?? null,
        score,
        reasons,
        qty,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.leadTimeDays ?? Number.POSITIVE_INFINITY) - (b.leadTimeDays ?? Number.POSITIVE_INFINITY) ||
        String(a.name).localeCompare(String(b.name)),
    );
}
