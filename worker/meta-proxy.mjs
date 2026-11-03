// Meta model proxy for the public desk.
//
// The browser must never hold a Meta key: a key shipped to a phone is a key published. So the desk
// calls this Worker, and the Worker adds the credential from its secret store and forwards upstream.
//
// What this costs us if abused: every call spends Meta credit. The guards are deliberately blunt —
// a model allowlist, a token cap, and a per-address rate limit — because a demo desk does not need
// anything else, and a wide-open proxy would be a bill with no ceiling.

const UPSTREAM = "https://api.meta.ai/v1";

/** Models the desk may use. Contributor models are excluded by policy, not by accident. */
const ALLOWED = new Set([
  "muse-spark-1.3",
  "muse-wonder-1.0",
  "sam-3.1",
  "muse-voice-transcribe-1.0",
  "muse-image-1.0",
]);

/** Routes the desk may reach, by upstream path. */
const ROUTES = [/^\/chat\/completions$/, /^\/responses$/, /^\/models$/, /^\/asr\/transcribe$/];

const MAX_TOKENS = 1200;
const LIMIT = { windowMs: 10 * 60 * 1000, max: 40 };

/** Per-isolate counter: cheap, honest, and documented as per-instance rather than global. */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const row = hits.get(ip) ?? { count: 0, reset: now + LIMIT.windowMs };
  if (now > row.reset) { row.count = 0; row.reset = now + LIMIT.windowMs; }
  row.count += 1;
  hits.set(ip, row);
  if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  return { limited: row.count > LIMIT.max, remaining: Math.max(0, LIMIT.max - row.count), reset: row.reset };
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

/** Trim a chat/responses body to the parts we allow, and cap the spend per call. */
function guardJson(text) {
  let body;
  try { body = JSON.parse(text); } catch { return { error: "body is not JSON" }; }
  const model = body.model;
  if (!model || !ALLOWED.has(model)) return { error: `model "${model ?? ""}" is not allowed on this desk` };
  if (typeof body.max_tokens === "number" && body.max_tokens > MAX_TOKENS) body.max_tokens = MAX_TOKENS;
  if (typeof body.max_output_tokens === "number" && body.max_output_tokens > MAX_TOKENS) body.max_output_tokens = MAX_TOKENS;
  return { body };
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/meta/, "") || "/";
  const forwarded = path + (url.search || "");

  if (!env.META_API_KEY) {
    return json({ error: "the desk has no model credential configured" }, 503);
  }
  if (!ROUTES.some((r) => r.test(path))) {
    return json({ error: `unknown model route ${path}` }, 404);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rl = rateLimited(ip);
  if (rl.limited) {
    return json({ error: "too many model calls from this address; try again shortly" }, 429,
      { "retry-after": String(Math.ceil((rl.reset - Date.now()) / 1000)) });
  }

  const headers = { authorization: `Bearer ${env.META_API_KEY}` };
  let body;

  if (request.method === "GET") {
    if (path !== "/models") return json({ error: "method not allowed" }, 405);
  } else if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const text = await request.text();
      const guarded = guardJson(text);
      if (guarded.error) return json({ error: guarded.error }, 400);
      body = JSON.stringify(guarded.body);
      headers["content-type"] = "application/json";
    } else if (type.includes("multipart/form-data")) {
      // Audio goes through untouched apart from the model name, which is checked inside the form.
      const form = await request.formData();
      const settings = form.get("request");
      if (settings) {
        try {
          const parsed = JSON.parse(settings);
          if (!ALLOWED.has(parsed.model)) return json({ error: `model "${parsed.model}" is not allowed on this desk` }, 400);
        } catch { return json({ error: "the request part is not JSON" }, 400); }
      }
      const out = new FormData();
      for (const [k, v] of form.entries()) out.append(k, v);
      body = out;
    } else {
      return json({ error: "unsupported content type" }, 415);
    }
  } else {
    return json({ error: "method not allowed" }, 405);
  }

  const upstream = await fetch(UPSTREAM + forwarded, { method: request.method, headers, body });
  const passHeaders = new Headers();
  for (const h of ["content-type", "content-length", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) passHeaders.set(h, v);
  }
  passHeaders.set("x-desk-rate-remaining", String(rl.remaining));
  return new Response(upstream.body, { status: upstream.status, headers: passHeaders });
}

export const __testing = { ALLOWED, MAX_TOKENS, LIMIT, rateLimited, guardJson, hits };
