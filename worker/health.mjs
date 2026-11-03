// Health and error intake for the desk.
//
// Two things a production system has to do that a demo can skip: say whether it is alive, and
// record what broke when nobody was watching. Both live here so the Worker entry stays legible.
//
// Rules: the health answer never reveals a credential or a version string, and the error intake
// stores a short message and where it happened — never a page address with a query string, never
// a name, never a phone number. Logs land in the Worker's own log stream, which the owner reads.

const STARTED = Date.now();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const MAX_BODY = 4_096;

const seen = new Map();

function overLimit(key) {
  const now = Date.now();
  const entry = seen.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    seen.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function caller(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/** Alive, and honest about whether the model key is present — never what it is. */
export function health(env) {
  const key = typeof env?.META_API_KEY === "string" ? env.META_API_KEY.trim() : "";
  const body = {
    status: "ok",
    models: key.length > 20 ? "configured" : "missing",
    routes: { meta: "/api/meta", errors: "/api/errors" },
    uptimeSeconds: Math.round((Date.now() - STARTED) / 1000),
    time: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

/** Take one short report from a desk that failed, log it, and say nothing back. */
export async function report(request, env) {
  if (overLimit(caller(request))) {
    return new Response(null, { status: 429, headers: { "cache-control": "no-store" } });
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return new Response(null, { status: 413 });
  if (!env || typeof env !== "object") return new Response(null, { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const entry = {
    message: String(body?.message ?? "").slice(0, 300),
    where: String(body?.where ?? "").slice(0, 120),
    path: String(body?.path ?? "").split("?")[0].slice(0, 120),
    at: new Date().toISOString(),
  };
  console.error("desk-error", JSON.stringify(entry));
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
