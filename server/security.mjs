/**
 * security.mjs — standalone hardening helpers for the cargolinx-v2 bridge.
 * No imports from proxy.mjs; no secrets. Wire into any node:http handler.
 */

export const DEFAULT_JSON_LIMIT = 2 * 1024 * 1024; // 2 MiB

const HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

/** Set hardening headers on a node:http ServerResponse. Returns res. */
export function securityHeaders(res) {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  return res;
}

/**
 * Read + JSON-parse a request body with a byte cap.
 * Resolves to the parsed value; rejects Error("body too large") past the cap
 * or Error("bad json") on invalid JSON. Destroys the socket on overflow.
 */
export function readJsonBody(req, maxBytes = DEFAULT_JSON_LIMIT) {
  return new Promise((ok, bad) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        bad(new Error("body too large"));
        try { req.destroy(); } catch { /* already closing */ }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        bad(new Error("bad json"));
      }
    });
    req.on("error", bad);
  });
}

/**
 * In-memory sliding-window per-IP limiter. Standalone: no timers besides
 * lazy expiry on check.
 * @param {{windowMs?: number, max?: number}} opts
 * @returns {(ip: string, now?: number) => { ok: boolean, retryAfterMs: number }}
 */
export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map(); // ip -> number[] timestamps
  return function check(ip, now = Date.now()) {
    const key = ip || "unknown";
    const cutoff = now - windowMs;
    const prev = (hits.get(key) || []).filter((t) => t > cutoff);
    if (prev.length >= max) {
      hits.set(key, prev);
      return { ok: false, retryAfterMs: prev[0] + windowMs - now };
    }
    prev.push(now);
    hits.set(key, prev);
    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (v.length === 0 || v[v.length - 1] <= cutoff) hits.delete(k);
        if (hits.size <= 10_000) break;
      }
    }
    return { ok: true, retryAfterMs: 0 };
  };
}

/** Node-http helper: 429 the response when the limiter refuses. Returns true if allowed. */
export function enforceRateLimit(req, res, check) {
  const ip = req.socket?.remoteAddress || req.headers["x-forwarded-for"] || "unknown";
  const { ok, retryAfterMs } = check(String(ip));
  if (ok) return true;
  securityHeaders(res);
  res.writeHead(429, {
    "content-type": "application/json",
    "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  });
  res.end(JSON.stringify({ error: "rate limited", retry_after_ms: retryAfterMs }));
  return false;
}
