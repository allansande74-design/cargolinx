/**
 * Local model bridge for Altovex CargoLinx.
 *
 * Why this exists: the browser must never hold a provider key, and the static
 * demo has no server of its own. This bridge runs on the operator's machine,
 * speaks the same OpenAI-shaped API the app already calls, and holds the key
 * server-side.
 *
 * Routing is explicit, never silent. A requested model is mapped through ROUTES
 * and the response records which upstream actually served it. If a model cannot
 * be served, the bridge returns 503 with a reason - it never substitutes a
 * different model without saying so in `served_by`.
 *
 * Run:  node server/proxy.mjs [--port 8787]
 */
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PDFVENV_PY = "/home/amanda/.venvs/pdfvenv/bin/python";
const DOC_TEXT = resolve(HERE, "doc_text.py");

function envFrom(file) {
  const out = {};
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch { return out; }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const ENV = { ...envFrom(resolve(ROOT, ".env")), ...process.env };

const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "").split("=")[1] || process.env.BRIDGE_PORT || 8787);
const OPENROUTER_KEY = ENV.OPENROUTER_API_KEY || "";
const META_KEY = ENV.META_MODEL_API_KEY || "";
const MTIME_LOG = resolve(ROOT, "..", "swarm", "hackathon", "evidence", "bridge_usage.jsonl");

/* Requested app model -> upstream routes, in preference order.
 * `why` is recorded with every call so the evidence file explains itself. */
const ROUTES = {
  "muse-spark-1.3": [
    { via: "openrouter", id: "meta/muse-spark-1.3", why: "Meta Muse text/reasoning, served by OpenRouter" },
  ],
  "muse-wonder-1.0": [
    { via: "openrouter", id: "meta/muse-wonder", why: "Meta Muse Wonder, served by OpenRouter" },
  ],
  "sam-3.1": [
    { via: "meta", id: "sam-3.1", why: "Meta SAM 3.1 segmentation, direct line via /v1/responses" },
    { via: "openrouter", id: "google/gemini-3.1-flash-lite", why: "vision fallback if Meta direct fails" },
  ],
  "muse-image-1.0": [
    { via: "meta", id: "muse-image-1.0", why: "Meta Muse Image generation, direct line via /v1/responses" },
    { via: "openrouter", id: "google/gemini-3.1-flash-image", why: "image fallback if Meta direct fails" },
  ],
  "muse-voice-transcribe-1.0": [
    { via: "meta", id: "muse-voice-transcribe-1.0", why: "Meta voice transcriber, direct line via /v1/asr/transcribe" },
    { via: "openrouter", id: "google/gemini-3.1-flash-lite", why: "audio fallback if Meta direct fails" },
  ],
};

function logUsage(rec) {
  try { appendFileSync(MTIME_LOG, JSON.stringify(rec) + "\n"); } catch { /* logging must never break a call */ }
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((ok, bad) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) { bad(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", bad);
  });
}

async function metaDirect(body) {
  // Direct call to the Meta Model API. Throws only on network failure; HTTP
  // errors come back as {status, json} so the caller can fall back honestly.
  const res = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${META_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
  return { status: res.status, json };
}

async function metaRespond(body) {
  // Direct call to the Meta Model API on /v1/responses (image, SAM).
  // Same contract as metaDirect: {status, json}, throws only on network.
  const res = await fetch("https://api.meta.ai/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${META_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
  return { status: res.status, json };
}

async function upstream(path, body) {
  const res = await fetch("https://openrouter.ai/api/v1" + path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENROUTER_KEY}`,
      "content-type": "application/json",
      "http-referer": "https://altovex.example/cargolinx",
      "x-title": "Altovex CargoLinx local bridge",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
  return { status: res.status, json };
}

/* Substitute line: Google AI Studio's OpenAI-compatible endpoint, wired from the
 * META_API_BASE / META_API_PATH / META_API_KEY variables so the owner can point the
 * desk at a working upstream without touching code. Tried only after the Meta direct
 * line refuses, and every response says which line actually served it. */
const GEMINI_BASE = String(ENV.META_API_BASE || "").replace(/\/+$/, "");
const GEMINI_PATH = ENV.META_API_PATH || "/chat/completions";
const GEMINI_LANE = ENV.META_MODEL_LANE || "gemini-3.1-flash-lite";
const GEMINI_REASONING = ENV.META_MODEL_REASONING || GEMINI_LANE;

async function geminiChat(body) {
  // Same contract as metaDirect: {status, json}; throws only on network failure.
  const res = await fetch(GEMINI_BASE + GEMINI_PATH, {
    method: "POST",
    headers: { authorization: `Bearer ${META_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
  return { status: res.status, json };
}

function geminiModelFor(wanted) {
  return /wonder|reason/i.test(String(wanted)) ? GEMINI_REASONING : GEMINI_LANE;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      key_present: Boolean(OPENROUTER_KEY),
      meta_direct: Boolean(META_KEY),
      routes: Object.fromEntries(Object.entries(ROUTES).map(([k, v]) => [k, v.map((r) => `${r.via}:${r.id}`)])),
    });
  }

  if (url.pathname === "/v1/models") {
    if (!OPENROUTER_KEY) return send(res, 503, { error: "no OPENROUTER_API_KEY on this host" });
    const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { authorization: `Bearer ${OPENROUTER_KEY}` } });
    const j = await r.json();
    const data = (j.data || []).filter((m) => m.id.startsWith("meta/muse") || m.id.startsWith("google/gemini"));
    return send(res, 200, {
      object: "list",
      data: data.map((m) => ({ id: m.id, owned_by: m.id.split("/")[0], context_length: m.context_length, pricing: m.pricing })),
      app_models: Object.keys(ROUTES),
      note: "app_models are the names the desk calls; each is mapped in /health",
    });
  }

  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "bad json" }); }

    const wanted = body.model || "muse-spark-1.3";
    const route = ROUTES[wanted];
    if (!route) {
      return send(res, 400, {
        error: `no route for model "${wanted}"`,
        routable: Object.keys(ROUTES),
      });
    }
    if (route.length > 1) {
      return send(res, 400, { error: `model "${wanted}" has several upstreams; pick one explicitly`, options: route });
    }
    const target = route[0];
    const started = Date.now();
    const forwarded = { ...body, model: target.id };
    if (target.id.startsWith("meta/muse-") && !forwarded.reasoning) {
      // Muse models are reasoning models: without this they spend the whole
      // output budget thinking and return null content.
      forwarded.reasoning = { effort: "low" };
      if (!forwarded.max_tokens || forwarded.max_tokens < 3000) forwarded.max_tokens = 3000;
    }
    const directOk = META_KEY && (target.via === "meta" || target.id.startsWith("meta/muse-"));
    let r = null;
    let scheme = null;
    if (directOk) {
      // Direct line first: the app model name IS the Meta id for text models.
      const directBody = { ...forwarded, model: wanted };
      try {
        const dr = await metaDirect(directBody);
        if (dr.status === 402 || (dr.status === 400 && JSON.stringify(dr.json).includes("reasoning"))) {
          // 402 = billing gate back on; 400 mentioning reasoning = shape
          // mismatch -> plain retry without our injected reasoning.
          const plain = await metaDirect({ ...forwarded, model: wanted, reasoning: undefined });
          r = plain.status < 400 ? plain : dr;
        } else {
          r = dr;
        }
        if (r.status < 400) scheme = "meta:direct";
      } catch (e) {
        r = { status: 599, json: { error: `meta direct unreachable: ${e.message}` } };
      }
    }
    if (!scheme && GEMINI_BASE && META_KEY) {
      // Meta's line is refused (billing): ask the substitute line before the aggregator.
      const gModel = geminiModelFor(wanted);
      try {
        const gr = await geminiChat({ ...forwarded, model: gModel, reasoning: undefined });
        r = gr;
        if (gr.status < 400) scheme = `gemini:${gModel}`;
      } catch (e) {
        r = { status: 599, json: { error: `substitute line unreachable: ${e.message}` } };
      }
    }
    const rec = {
      ts: new Date().toISOString(),
      requested_model: wanted,
      served_by: scheme || `${target.via}:${target.id}`,
      why: scheme === "meta:direct"
        ? "Meta Model API, direct line"
        : (scheme ? `substitute line ${scheme}, standing in while Meta billing is blocked` : `${target.why} (direct line failed or unavailable)`),
      status: r ? r.status : null,
      ms: Date.now() - started,
      usage: (r && r.json.usage) || null,
      error: r && r.status >= 400 ? (r.json.error || r.json) : null,
    };
    if (!scheme) {
      // Honest fallback: OpenRouter stand-in, labelled as such.
      if (!OPENROUTER_KEY) {
        logUsage(rec);
        return send(res, 503, { error: "direct line failed and no OPENROUTER_API_KEY on this host", bridge: { requested_model: wanted, attempted: "meta:direct" } });
      }
      let fr;
      try {
        fr = await upstream("/chat/completions", forwarded);
      } catch (e) {
        rec.status = 599;
        rec.error = `aggregator unreachable: ${e.message}`;
        logUsage(rec);
        return send(res, 503, { error: rec.error, bridge: { requested_model: wanted, attempted: rec.served_by } });
      }
      rec.served_by = `${target.via}:${target.id}`;
      rec.status = fr.status;
      rec.ms = Date.now() - started;
      rec.usage = fr.json.usage || null;
      rec.error = fr.status >= 400 ? (fr.json.error || fr.json) : null;
      r = fr;
    }
    logUsage(rec);
    if (r.status >= 400) {
      return send(res, r.status, { error: r.json.error || r.json, bridge: { requested_model: wanted, attempted: rec.served_by } });
    }
    // Tell the caller the truth about who answered.
    r.json.bridge = { requested_model: wanted, served_by: rec.served_by, why: rec.why };
    return send(res, 200, r.json);
  }

  if (url.pathname === "/v1/documents/extract" && req.method === "POST") {
    // Supplier quotations arrive as PDF, Word, Excel or PowerPoint. The desk
    // sends {name, data_b64, mime}; the bridge converts to text server-side
    // (markitdown, pymupdf fallback — no network), then asks the reasoning
    // route to structure the same shipment fields as structureJob. Fields only:
    // prices from the page are reported verbatim as evidence, never adopted
    // into the desk's own costing.
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "send JSON: {name, data_b64}" }); }
    if (!body.data_b64 || !body.name) return send(res, 400, { error: "name and data_b64 required" });
    const started = Date.now();
    const safe = basename(String(body.name)).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "document";
    const dir = mkdtempSync(join(tmpdir(), "clx-doc-"));
    const path = join(dir, safe);
    let text = "";
    try {
      writeFileSync(path, Buffer.from(body.data_b64, "base64"));
      text = await new Promise((ok, bad) => {
        execFile(PDFVENV_PY, [DOC_TEXT, path, "12000"], { timeout: 45000 }, (err, stdout, stderr) =>
          err ? bad(new Error(`conversion failed: ${(stderr || err.message).slice(0, 220)}`)) : ok(stdout));
      });
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      return send(res, 422, { error: e.message, bridge: { requested_model: "muse-spark-1.3", attempted: "openrouter:meta/muse-spark-1.3" } });
    }
    rmSync(dir, { recursive: true, force: true });
    const docMessages = [
      {
        role: "system",
        content: "Extract shipment fields from a supplier quotation or delivery document. Return JSON only: {origin, destination, cargo, quantity, weightKg, hs, value, currency, comments}. Use null where the document does not say. Quote the supplier's figures verbatim into value/comments — never adjust them, never convert currency, never invent a price or a date.",
      },
      { role: "user", content: `File: ${body.name}\n\nDocument text:\n${text}` },
    ];
    // Direct line first, OpenRouter stand-in as honest fallback.
    let r = null;
    let docServed = null;
    if (META_KEY) {
      try {
        const dr = await metaDirect({ model: "muse-spark-1.3", reasoning: { effort: "low" }, max_tokens: 3000, response_format: { type: "json_object" }, temperature: 0, messages: docMessages });
        if (dr.status < 400) { r = dr; docServed = "meta:direct"; }
        else if (dr.status === 400 && JSON.stringify(dr.json).includes("reasoning")) {
          // Direct line rejects the reasoning hint on some shapes — plain retry.
          const plain = await metaDirect({ model: "muse-spark-1.3", max_tokens: 3000, response_format: { type: "json_object" }, temperature: 0, messages: docMessages });
          r = plain; if (plain.status < 400) docServed = "meta:direct";
        }
        else r = dr;
      } catch (e) {
        r = { status: 599, json: { error: `meta direct unreachable: ${e.message}` } };
      }
    }
    const model = "meta/muse-spark-1.3";
    if (!docServed) {
      if (!OPENROUTER_KEY) {
        logUsage({ ts: new Date().toISOString(), requested_model: "muse-spark-1.3", served_by: "meta:direct", why: "document intake; supplier figures reported verbatim", status: r.status, ms: Date.now() - started, usage: r.json.usage || null });
        return send(res, r.status >= 400 ? r.status : 503, { error: r.json.error || r.json || "direct line failed and no OPENROUTER_API_KEY on this host" });
      }
      r = await upstream("/chat/completions", {
        model,
        reasoning: { effort: "low" },
        max_tokens: 3000,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: docMessages,
      });
      docServed = `openrouter:${model}`;
    }
    logUsage({ ts: new Date().toISOString(), requested_model: "muse-spark-1.3", served_by: docServed, why: "document intake; supplier figures reported verbatim", status: r.status, ms: Date.now() - started, usage: r.json.usage || null });
    if (r.status >= 400) return send(res, r.status, { error: r.json.error || r.json });
    let fields = {};
    try { fields = JSON.parse(r.json.choices?.[0]?.message?.content ?? "{}"); } catch { fields = { comments: r.json.choices?.[0]?.message?.content ?? "", unparsed: true }; }
    return send(res, 200, {
      fields,
      bridge: { requested_model: "muse-spark-1.3", served_by: docServed },
    });
  }

  if (url.pathname === "/v1/asr/transcribe" && req.method === "POST") {
    // Voice notes: the Meta transcriber takes multipart (request + audio).
    // The desk posts {audio_b64, mime}; the bridge rebuilds multipart here.
    // Direct line first, OpenRouter stand-in as honest fallback.
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "send JSON: {audio_b64, mime}" }); }
    if (!body.audio_b64) return send(res, 400, { error: "audio_b64 required" });
    const started = Date.now();
    let text = null;
    let asrServed = null;
    if (META_KEY) {
      try {
        // Meta transcriber requires mono s16le @16/24kHz: normalise client audio first (ffmpeg).
        const FFMPEG = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg";
        let wav = Buffer.from(body.audio_b64, "base64");
        try {
          wav = execFileSync(FFMPEG, ["-v", "error", "-i", "pipe:0", "-ar", "16000", "-ac", "1",
            "-sample_fmt", "s16", "-f", "wav", "pipe:1"], { input: wav, maxBuffer: 256 * 1024 * 1024 });
        } catch { /* fall through with the original bytes */ }
        const bnd = "----clx" + Date.now().toString(36);
        const head = Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })}\r\n--${bnd}\r\nContent-Disposition: form-data; name="audio"; filename="note.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
        const tail = Buffer.from(`\r\n--${bnd}--\r\n`);
        const mres = await fetch("https://api.meta.ai/v1/asr/transcribe", {
          method: "POST",
          headers: { authorization: `Bearer ${META_KEY}`, "content-type": `multipart/form-data; boundary=${bnd}` },
          body: Buffer.concat([head, wav, tail]),
        });
        const mtxt = await mres.text();
        let mj = null;
        try { mj = JSON.parse(mtxt); } catch { mj = { raw: mtxt.slice(0, 300) }; }
        if (mres.status < 400) {
          text = mj.transcript ?? (Array.isArray(mj.turns) ? mj.turns.map((t) => t.text).join(" ") : "") ?? "";
          asrServed = "meta:direct";
          logUsage({ ts: new Date().toISOString(), requested_model: "muse-voice-transcribe-1.0", served_by: "meta:direct", why: "voice note, direct transcriber", status: mres.status, ms: Date.now() - started, usage: null });
        } else {
          logUsage({ ts: new Date().toISOString(), requested_model: "muse-voice-transcribe-1.0", served_by: "meta:direct", why: "voice note, direct transcriber", status: mres.status, ms: Date.now() - started, usage: null, error: mj.error || mj });
        }
      } catch (e) {
        logUsage({ ts: new Date().toISOString(), requested_model: "muse-voice-transcribe-1.0", served_by: "meta:direct", why: "voice note, direct transcriber", status: 599, ms: Date.now() - started, usage: null, error: `meta direct unreachable: ${e.message}` });
      }
    }
    if (text === null) {
      if (!OPENROUTER_KEY) return send(res, 503, { error: "direct transcription failed and no OPENROUTER_API_KEY on this host" });
      const model = "google/gemini-3.1-flash-lite";
      const r = await upstream("/chat/completions", {
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Transcribe this voice note exactly. Return JSON: {\"text\": \"...\"}. Do not summarise, do not correct the speaker." },
            { type: "input_audio", input_audio: { data: body.audio_b64, format: (body.mime || "audio/mpeg").split("/")[1] } },
          ],
        }],
      });
      logUsage({ ts: new Date().toISOString(), requested_model: "muse-voice-transcribe-1.0", served_by: `openrouter:${model}`, why: "audio fallback, Meta transcriber unreachable", status: r.status, usage: r.json.usage || null });
      if (r.status >= 400) return send(res, r.status, { error: r.json.error || r.json });
      text = r.json.choices?.[0]?.message?.content ?? "";
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.text === "string") text = parsed.text;
      } catch { /* plain text is fine */ }
      asrServed = `openrouter:${model}`;
    }
    return send(res, 200, {
      text,
      bridge: { requested_model: "muse-voice-transcribe-1.0", served_by: asrServed },
    });
  }

  return send(res, 404, { error: "unknown path", paths: ["/health", "/v1/models", "/v1/chat/completions", "/v1/documents/extract", "/v1/asr/transcribe"] });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`bridge listening on http://127.0.0.1:${PORT}  key=${OPENROUTER_KEY ? "present" : "MISSING"} meta=${META_KEY ? "direct" : "off"}`);
});
