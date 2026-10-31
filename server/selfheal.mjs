/**
 * selfheal.mjs — standalone bridge health probing + restart-hint reporter.
 * No imports from proxy.mjs; no secrets. Uses global fetch (node ≥ 18).
 */

/** Default probe list: /health plus 3 bridge routes. */
export const DEFAULT_ROUTES = [
  { route: "/health", method: "GET" },
  { route: "/v1/models", method: "GET" },
  { route: "/v1/chat/completions", method: "POST" },
  { route: "/v1/documents/extract", method: "POST" },
];

async function probeOne(base, { route, method = "GET", timeoutMs = 5000 }) {
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // POST routes are probed with an empty JSON body: a live bridge answers
    // 400/503 (handler reached), a dead one refuses/timeouts.
    const res = await fetch(base + route, {
      method,
      signal: ctrl.signal,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? "{}" : undefined,
    });
    const ms = Date.now() - started;
    return { route, ok: res.status < 500, ms, status: res.status };
  } catch (err) {
    return { route, ok: false, ms: Date.now() - started, error: err?.name || "fetch-failed" };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe each route, concurrently. Never throws: unreachable routes come back
 * as {route, ok: false, ms}.
 * @param {string} base e.g. "http://localhost:8787"
 * @param {Array<{route: string, method?: string}>} routes
 */
export async function probeRoutes(base, routes = DEFAULT_ROUTES) {
  const clean = String(base || "").replace(/\/$/, "");
  return Promise.all(routes.map((r) => probeOne(clean, r)));
}

/**
 * Restart-hint reporter: summarises probe results into an actionable verdict.
 * @param {Array<{route: string, ok: boolean, ms: number}>} results
 * @returns {{ healthy: boolean, down: string[], hint: string }}
 */
export function report(results = []) {
  const down = results.filter((r) => !r.ok).map((r) => r.route);
  if (down.length === 0) {
    return { healthy: true, down, hint: "all routes responding; no restart needed" };
  }
  const allDown = down.length === results.length && results.length > 0;
  return {
    healthy: false,
    down,
    hint: allDown
      ? "bridge unreachable on all routes — restart: node server/proxy.mjs (check port 8787 free, keys in .env)"
      : `partial outage on ${down.join(", ")} — check upstream keys/routes before restarting`,
  };
}
