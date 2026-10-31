/**
 * QR-verified quote payload. Pure functions, no network.
 * The payload restates the engine's figures; it never recomputes them.
 */

const VERSION = 1;

function fail(error) {
  return { ok: false, data: null, error };
}

/**
 * Build a short deterministic JSON payload for the printed quote QR.
 * Same input always yields the same string (fixed key order, no spacing).
 */
export function buildQuotePayload({ quoteRef, total, currency, issuedAt }) {
  if (typeof quoteRef !== "string" || quoteRef.trim() === "") {
    throw new TypeError("quoteRef must be a non-empty string");
  }
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    throw new TypeError("total must be a finite number >= 0");
  }
  if (typeof currency !== "string" || currency.trim() === "") {
    throw new TypeError("currency must be a non-empty string");
  }
  if (typeof issuedAt !== "string" || issuedAt.trim() === "") {
    throw new TypeError("issuedAt must be a non-empty string");
  }
  const ref = quoteRef.trim();
  const cur = currency.trim().toUpperCase();
  const at = issuedAt.trim();
  if (Number.isNaN(Date.parse(at))) {
    throw new TypeError("issuedAt must be a parseable date string");
  }
  // Fixed key order + no whitespace keeps output deterministic and short.
  return `{"v":${VERSION},"ref":${JSON.stringify(ref)},"total":${total},"cur":${JSON.stringify(cur)},"at":${JSON.stringify(at)}}`;
}

/**
 * Verify a QR payload string. Never throws; returns {ok, data, error}.
 */
export function verifyQuotePayload(str) {
  if (typeof str !== "string" || str.trim() === "") {
    return fail("empty payload");
  }
  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch {
    return fail("invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("payload must be an object");
  }
  const { v, ref, total, cur, at } = parsed;
  if (v !== VERSION) return fail("unsupported version");
  if (typeof ref !== "string" || ref.trim() === "") return fail("bad ref");
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return fail("bad total");
  }
  if (typeof cur !== "string" || cur.trim() === "") return fail("bad currency");
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return fail("bad issuedAt");
  const data = { quoteRef: ref, total, currency: cur.toUpperCase(), issuedAt: at };
  // Round-trip through the builder: rejects extra keys and non-canonical input.
  let canonical;
  try {
    canonical = buildQuotePayload(data);
  } catch {
    return fail("bad payload");
  }
  if (canonical !== str) return fail("payload not canonical");
  return { ok: true, data, error: null };
}
