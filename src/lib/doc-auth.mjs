/**
 * Universal document-authentication envelope. Pure functions, no network.
 * Every ecosystem document carries a timestamp + QR payload for
 * end-to-end authentication (anti-fake cross-border docs).
 * Key figures are restated, never recomputed.
 */

const VERSION = 1;

export const SUPPORTED_TYPES = Object.freeze([
  "quote",
  "delivery-note",
  "invoice",
  "receipt",
  "packing-list",
  "customs-declaration",
  "certificate",
]);

function fail(error) {
  return { ok: false, data: null, error };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkFigures(figures) {
  if (!isPlainObject(figures)) return false;
  for (const k of Object.keys(figures)) {
    if (typeof k !== "string" || k.trim() === "") return false;
    const v = figures[k];
    if (v === null) continue;
    const t = typeof v;
    if (t === "string" || t === "boolean") continue;
    if (t === "number" && Number.isFinite(v)) continue;
    return false;
  }
  return true;
}

// Fixed key order + sorted fig keys keeps output deterministic and short.
function canonicalFig(figures) {
  const keys = Object.keys(figures).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(figures[k])}`);
  return `{${parts.join(",")}}`;
}

function buildDocQr({ docType, docRef, issuedAt, figures }) {
  return `{"v":${VERSION},"type":${JSON.stringify(docType)},"ref":${JSON.stringify(docRef)},"at":${JSON.stringify(issuedAt)},"fig":${canonicalFig(figures)}}`;
}

/**
 * Stamp a document with timestamp + canonical QR payload.
 * Same input (minus time) always yields the same qr string.
 */
export function stampDocument({ docType, docRef, issuer, figures }) {
  if (typeof docType !== "string" || !SUPPORTED_TYPES.includes(docType)) {
    throw new TypeError(`docType must be one of: ${SUPPORTED_TYPES.join(", ")}`);
  }
  if (typeof docRef !== "string" || docRef.trim() === "") {
    throw new TypeError("docRef must be a non-empty string");
  }
  if (typeof issuer !== "string" || issuer.trim() === "") {
    throw new TypeError("issuer must be a non-empty string");
  }
  if (!checkFigures(figures)) {
    throw new TypeError("figures must be a plain object of string/number/boolean/null values");
  }
  const type = docType;
  const ref = docRef.trim();
  const iss = issuer.trim();
  const at = new Date().toISOString();
  const fig = { ...figures };
  const qr = buildDocQr({ docType: type, docRef: ref, issuedAt: at, figures: fig });
  return { docType: type, docRef: ref, issuer: iss, issuedAt: at, figures: fig, qr };
}

/**
 * Verify a stamped document envelope. Never throws; returns {ok, data, error}.
 */
export function verifyStampedDocument(obj) {
  if (!isPlainObject(obj)) return fail("envelope must be an object");
  const { docType, docRef, issuer, issuedAt, figures, qr } = obj;
  if (typeof docType !== "string" || !SUPPORTED_TYPES.includes(docType)) {
    return fail("bad docType");
  }
  if (typeof docRef !== "string" || docRef.trim() === "") return fail("bad docRef");
  if (typeof issuer !== "string" || issuer.trim() === "") return fail("bad issuer");
  if (typeof issuedAt !== "string" || Number.isNaN(Date.parse(issuedAt))) {
    return fail("bad issuedAt");
  }
  if (!checkFigures(figures)) return fail("bad figures");
  if (typeof qr !== "string" || qr.trim() === "") return fail("empty qr");
  let parsed;
  try {
    parsed = JSON.parse(qr);
  } catch {
    return fail("invalid qr JSON");
  }
  if (!isPlainObject(parsed)) return fail("qr must be an object");
  const keys = Object.keys(parsed);
  if (keys.length !== 5 || !keys.includes("v") || !keys.includes("type") || !keys.includes("ref") || !keys.includes("at") || !keys.includes("fig")) {
    return fail("bad qr shape");
  }
  if (parsed.v !== VERSION) return fail("unsupported version");
  if (parsed.type !== docType || parsed.ref !== docRef || parsed.at !== issuedAt) {
    return fail("qr does not match envelope");
  }
  if (!checkFigures(parsed.fig)) return fail("bad qr figures");
  // Round-trip through the builder: rejects extra keys and non-canonical input.
  let canonical;
  try {
    canonical = buildDocQr({ docType, docRef, issuedAt, figures });
  } catch {
    return fail("bad envelope");
  }
  if (canonical !== qr) return fail("qr not canonical");
  const figKeys = Object.keys(figures).sort();
  const qrFigKeys = Object.keys(parsed.fig).sort();
  if (figKeys.length !== qrFigKeys.length || figKeys.some((k, i) => k !== qrFigKeys[i] || !Object.is(figures[k], parsed.fig[k]))) {
    return fail("qr figures do not match envelope");
  }
  return {
    ok: true,
    data: { docType, docRef, issuer, issuedAt, figures: { ...figures } },
    error: null,
  };
}
