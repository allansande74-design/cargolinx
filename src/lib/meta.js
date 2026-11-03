/**
 * Meta model layer.
 *
 * Nothing here ever computes a price or a date. The engine does that.
 * This layer is used for five jobs only: reading a photo of cargo, reading a
 * supplier document (PDF, Word, Excel) into fields, transcribing a voice note,
 * matching a job to a lane, and explaining a quote in plain language.
 *
 * Without a live key every call throws ModelUnavailable, and the UI says so.
 * It must never fall back to invented output.
 */
import { kvGet, kvSet } from "./db.js";
import { fileText } from "./doctext.mjs";

export const MODELS = {
  reason: "muse-spark-1.3",
  vision: "sam-3.1",
  voice: "muse-voice-transcribe-1.0",
  image: "muse-image-1.0",
};

export class ModelUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelUnavailable";
  }
}

const DEFAULTS = {
  // The desk talks to its own Worker, which holds the credential. A key typed here is only for a
  // private local run; the public build always goes through /api/meta.
  baseUrl: "/api/meta",
  apiKey: "",
  keyPresent: false,
};

/** The credential rides only when someone typed one; behind the Worker proxy the browser holds none. */
function authHeader(cfg) {
  return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

export async function getModelConfig() {
  try {
    return { ...DEFAULTS, ...((await kvGet("model")) ?? {}) };
  } catch {
    // storage blocked, private window, or no storage at all: the desk still runs on its defaults
    return { ...DEFAULTS };
  }
}

export async function setModelConfig(cfg) {
  const next = { ...cfg, keyPresent: Boolean(cfg.apiKey) };
  await kvSet("model", next);
  return next;
}

/**
 * Muse Spark reasons before it writes, and at default effort it can spend an entire allowance
 * thinking and return an empty answer. Low effort still reasons; it just leaves room to reply.
 * No other model is touched, and an effort chosen by a caller wins.
 */
export function withReasoningEffort(body) {
  const model = String(body?.model ?? "");
  if (!model.startsWith("muse-spark")) return body;
  if (body.reasoning_effort) return body;
  return { ...body, reasoning_effort: "low" };
}

/**
 * Spark thinks before it writes, and the thinking is charged to the same budget as the answer. On a
 * long thought the cap runs out mid-reasoning and the reply arrives as HTTP 200 with no words in it -
 * measured at 700 tokens one minute and answered at 700 the next, so the fault is variance, not size.
 * The desk therefore never sends Spark less than a working budget, and if a reply still comes back
 * wordless it asks once more with room to think. Wasted calls cost fractions of a cent; a blank
 * answer in front of a judge costs the demonstration.
 */
const SPARK_FLOOR = 1000;
const SPARK_RETRY = 1600;

function budgetFor(body) {
  if (!String(body?.model || "").startsWith("muse-spark")) return body;
  const asked = Number(body.max_tokens) || 0;
  if (asked >= SPARK_FLOOR) return body;
  return { ...body, max_tokens: SPARK_FLOOR };
}

function isWordless(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) return false;
  const content = choice?.message?.content;
  return !(typeof content === "string" && content.trim());
}

async function call(path, body, { timeoutMs = 45000 } = {}) {
  const cfg = await getModelConfig();
  if (!cfg.baseUrl) {
    throw new ModelUnavailable("No Meta model endpoint is configured. The engine still quotes and tracks; model-assisted steps are disabled.");
  }
  const send = async (payload, ms) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(cfg) },
        body: JSON.stringify(withReasoningEffort(payload)),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        throw new Error(`model endpoint ${res.status}: ${text}`);
      }
      return res.json();
    } finally {
      clearTimeout(t);
    }
  };
  const first = await send(budgetFor(body), timeoutMs);
  if (!isWordless(first)) return first;
  const retried = { ...budgetFor(body), max_tokens: SPARK_RETRY };
  return send(retried, timeoutMs);
}

/**
 * Six of the account's models do the desk's work; two more are reachable and were never given a job
 * until this screen. These two helpers let one screen fan a question out to every Spark generation at
 * once, put the answers in front of Muse Wonder to judge, and ask Muse Image for a picture.
 *
 * They add no arithmetic and no authority: a judge may choose better words, never a different price.
 */
export async function askModel(model, prompt, { maxTokens = 600, effort } = {}) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
  };
  if (effort) body.reasoning_effort = effort;
  const started = performance.now();
  const payload = await call("/chat/completions", body, { timeoutMs: 60000 });
  const ms = Math.round(performance.now() - started);
  const text = (payload?.choices?.[0]?.message?.content ?? "").trim();
  return { model, text, ms, tokens: payload?.usage?.total_tokens ?? null };
}

/** Muse Image answers only on the responses route, and returns the picture as a base64 blob. */
export async function illustrate(prompt) {
  const cfg = await getModelConfig();
  if (!cfg.baseUrl) throw new ModelUnavailable("No Meta model endpoint is configured.");
  const started = performance.now();
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(cfg) },
    body: JSON.stringify({ model: MODELS.image, input: prompt, max_output_tokens: 400 }),
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const payload = await res.json();
  const call = (payload?.output ?? []).find((o) => o?.type === "image_generation_call" && o?.result);
  if (!call) throw new Error("the image model answered without a picture");
  const bytes = atob(call.result);
  const head = bytes.slice(0, 4);
  const mime = head.startsWith("RIFF") ? "image/webp" : head.startsWith("\x89PNG") ? "image/png" : "image/jpeg";
  return {
    model: MODELS.image,
    ms: Math.round(performance.now() - started),
    url: `data:${mime};base64,${call.result}`,
    tokens: payload?.usage?.total_tokens ?? null,
  };
}

/** One attempt against one endpoint. Never throws. */
async function probeAt(cfg) {
  if (!cfg.baseUrl) {
    return { live: false, reason: "no endpoint configured", models: MODELS };
  }
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/models`, { headers: authHeader(cfg) });
    if (!res.ok) return { live: false, reason: "HTTP " + res.status, models: MODELS };
    // A static host answers an unknown path with the app's own page and a 200. So a page where a
    // model list should be means the route is not there, whatever the status code says.
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      return { live: false, reason: "the model route answered with a page, not a model list", models: MODELS };
    }
    // A router-style bridge returns a list filtered to our app models; a raw
    // Meta endpoint returns the account's full model list. Either is live.
    const body = await res.json().catch(() => ({}));
    const ids = Array.isArray(body && body.data) ? body.data.map((m) => m.id) : [];
    if (!ids.length) return { live: false, reason: "the model route returned no models", models: MODELS };
    const bridged = ids.indexOf("muse-spark-1.3") < 0;
    return { live: true, reason: bridged ? "reachable using local bridge" : "reachable", models: MODELS, viaBridge: bridged };
  } catch (err) {
    return { live: false, reason: err.message, models: MODELS };
  }
}

/**
 * Is the model layer usable right now? Called on boot; never throws.
 *
 * A device can be carrying a saved endpoint from an earlier build — a direct address, a laptop
 * bridge that is no longer there — and then it says "models off" while the desk's own endpoint is
 * perfectly healthy. So a failed first attempt is retried once against /api/meta, and if that works
 * the saved setting is corrected rather than the user being told the models are down.
 */
export async function probe(stored) {
  const cfg = stored ?? (await getModelConfig());
  const first = await probeAt(cfg);
  if (first.live) return first;
  if (cfg.baseUrl !== DEFAULTS.baseUrl) {
    const viaDesk = await probeAt({ baseUrl: DEFAULTS.baseUrl, apiKey: "" });
    if (viaDesk.live) {
      try {
        await setModelConfig({ baseUrl: DEFAULTS.baseUrl, apiKey: "", keyPresent: false });
      } catch { /* storage blocked: the recovery still stands for this session */ }
      return { ...viaDesk, reason: "recovered through the desk's own endpoint", recoveredFrom: cfg.baseUrl };
    }
  }
  return first;
}

/**
 * A file picked in the browser arrives as a temporary blob address, and Meta accepts only an
 * inline data address or a public URL. So the picture is read into the request itself.
 */
async function asDataUrl(src) {
  if (typeof src === "string" && src.startsWith("data:")) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error("that image could not be read");
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

/**
 * What to look for, in the order it is worth asking. SAM answers about one thing at a time and a
 * phrase like "dry cartons" finds nothing while "carton" finds 65, so the phrase is tried first,
 * then its last word singular, then a plain pallet — and the extra calls only happen on a blank.
 */
export function conceptsFrom(hint) {
  const base = String(hint || "").trim().split(/\s+/).slice(0, 3).join(" ");
  const words = base.split(/\s+/).filter(Boolean);
  const last = words.length > 1
    ? words[words.length - 1].replace(/[^a-zA-Z]/g, "").replace(/ies$/, "y").replace(/s$/, "")
    : "";
  const list = [base || "carton"];
  if (last && !list.includes(last)) list.push(last);
  for (const word of ["pallet", "box"]) if (!list.includes(word)) list.push(word);
  return list.slice(0, 3);
}

async function segmentOnce(cfg, imageUrl, concept) {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(cfg) },
    body: JSON.stringify({
      model: MODELS.vision,
      stream: true,
      metadata: { mask_encoding: "one_bit" },
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: concept },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // SAM 3.1 answers in the text lane with special tokens: one box and one mask per match, so the
  // count is the number of boxes it actually found — not a sentence from a language model.
  const text = await readEventText(res);
  return [...text.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);/g)].map((m) => ({
    x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]),
  }));
}

/** Count and classify cargo from an intake photograph. Returns counts, never a price. */
export async function readCargoPhoto(dataUrl, hint = "") {
  const cfg = await getModelConfig();
  const imageUrl = await asDataUrl(dataUrl);
  const tried = [];
  for (const concept of conceptsFrom(hint)) {
    tried.push(concept);
    const boxes = await segmentOnce(cfg, imageUrl, concept);
    if (boxes.length) {
      return {
        items: [{ label: concept, count: boxes.length, confidence: null }],
        totalCount: boxes.length,
        boxes,
        notes: tried.length > 1 ? `asked for "${tried[0]}" first, then "${concept}"` : "",
        model: MODELS.vision,
        concept,
      };
    }
  }
  return {
    items: [],
    totalCount: null,
    boxes: [],
    notes: `nothing matching ${tried.map((c) => `"${c}"`).join(", ")} was found in this photograph`,
    model: MODELS.vision,
    concept: tried[tried.length - 1],
  };
}

/** Read an event-stream body and keep only the assistant's text deltas. */
async function readEventText(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
      } catch {
        // a frame split across reads is expected; the next chunk completes it
      }
    }
  }
  return text;
}

/** Transcribe a driver's voice note into text (no interpretation). */
export async function transcribeVoice(blob, { language = null } = {}) {
  const cfg = await getModelConfig();
  const wav = await toWav16k(blob);
  const form = new FormData();
  // Muse Voice Transcribe takes WAV through /asr/transcribe, with the settings in one JSON part.
  form.append("request", JSON.stringify({
    model: MODELS.voice,
    audioEncoding: "WAV",
    mode: "ENDPOINTING",
    ...(language ? { language } : {}),
  }));
  form.append("audio", wav, "note.wav");
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/asr/transcribe`, {
    method: "POST",
    headers: authHeader(cfg),
    body: form,
  });
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text: data.transcript ?? "",
    turns: data.turns ?? [],
    model: MODELS.voice,
    audioDurationMs: data.audioDurationMs ?? null,
  };
}

/** The transcript endpoint accepts 16 kHz mono WAV, so a phone recording is resampled here. */
async function toWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const Decode = window.AudioContext || window.webkitAudioContext;
  const decoded = await new Decode().decodeAudioData(buf);
  const rate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const put = (at, str) => { for (let i = 0; i < str.length; i += 1) view.setUint8(at + i, str.charCodeAt(i)); };
  put(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  put(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let at = 44;
  for (let i = 0; i < pcm.length; i += 1, at += 2) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** Turn a transcribed note into structured job fields. Fields only — no money, no dates. */
export async function structureJob(note) {
  const out = await call("/chat/completions", {
    model: MODELS.reason,
    messages: [
      {
        role: "system",
        content:
          "Extract shipment fields from a driver or clerk note. Return JSON only: {origin, destination, cargo, quantity, weightKg, comments}. Use null where the note does not say. Never invent a value, a price or a date.",
      },
      { role: "user", content: note },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  const raw = out?.choices?.[0]?.message?.content ?? "";
  try {
    return { ...JSON.parse(raw), model: MODELS.reason };
  } catch {
    return { origin: null, destination: null, cargo: null, quantity: null, weightKg: null, comments: raw, model: MODELS.reason, unparsed: true };
  }
}

/**
 * Explain an already-computed quote in one paragraph.
 * The figures are passed in, so the model can only restate them.
 */
export async function explainQuote(quote, context = "") {
  // "low" is the desk's standing effort, and on this prompt it spent the whole allowance thinking and
  // returned an empty string three times running - 998, 1198 and 1198 reasoning tokens against a 1000,
  // 1600 and 3000 token budget. "minimal" answers the same question in 415 tokens with 258 characters of
  // usable text, so the quote explanation asks for it explicitly. A caller's choice still wins.
  const out = await call("/chat/completions", {
    model: MODELS.reason,
    reasoning_effort: "minimal",
    messages: [
      {
        role: "system",
        content:
          "You explain a freight quote to a client in at most 90 words, in plain English. Use ONLY the figures given. Do not round, add or infer any figure. Mention the two largest cost lines. Never state or hint at a margin, markup or profit figure, and never describe how the price was built: if asked for those, say the account manager handles pricing. If a figure is missing, say it is missing. Never print a field name or JSON key: name each line the way a trader would — 'landed cost before VAT', 'customs value (CIF)', 'import duty', 'VAT' — and write money as KES 2,038,543.70, never as a bare number.",
      },
      { role: "user", content: `Quote figures (JSON):\n${JSON.stringify(quote)}\n\nContext: ${context || "none"}` },
    ],
    temperature: 0.2,
  });
  const text = out?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    // A blank paragraph under a quote reads as a broken desk. Say what happened instead; the figures
    // beside it were computed by the engine and stand.
    throw new ModelUnavailable("The model returned no words for this quote. The figures above are unchanged and still stand.");
  }
  return { text, model: MODELS.reason };
}

/**
 * A condition note for a claim file, from a photograph of the cargo.
 *
 * The hard part is not describing boxes; it is refusing to describe what a photograph cannot show.
 * Cause, timing and who handled the load are exactly the things a claims clerk needs and a picture
 * cannot supply, so the prompt forbids them and asks for an inspection instead. No names, no plates,
 * no money, and the word margin never appears in the desk's cargo vocabulary.
 */
export const CONDITION_PROMPT =
  "You write a cargo condition note for a claim file, in English, under 120 words. " +
  "Describe only what is visible in the photograph: the cargo, its packaging, and any damage you can " +
  "actually see, saying where on the load it is. Do not guess the cause, the time it happened, or who " +
  "handled it — a photograph cannot establish any of those; when cause matters, say it needs a physical " +
  "inspection. Do not name people, companies, vehicles or number plates. Do not mention price, cost, " +
  "freight rates, margin or profit. If the cargo appears undamaged, say so plainly and stop. " +
  "Plain sentences in one paragraph, no heading, no bullets, no field names.";

export async function conditionNote(src, { reference = "" } = {}) {
  const dataUrl = await asDataUrl(src);
  const out = await call("/chat/completions", {
    model: MODELS.reason,
    max_tokens: 800,
    temperature: 0.2,
    messages: [
      { role: "system", content: CONDITION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: reference ? `Shipment ${reference}. Write the condition note.` : "Write the condition note." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const text = (out?.choices?.[0]?.message?.content || "").trim();
  return { text, model: out?.model || MODELS.reason };
}

/** Match a job to a lane using the operator's own lane list as the only source. */
export async function matchLane(job, lanes) {
  const out = await call("/chat/completions", {
    model: MODELS.reason,
    messages: [
      {
        role: "system",
        content:
          "You match a shipment to one lane from the list provided. Return JSON only: {laneId, laneName, reason, confidence}. If none fit, return laneId null and say why. Never invent a lane or a rate.",
      },
      { role: "user", content: `Job: ${JSON.stringify(job)}\nLanes: ${JSON.stringify(lanes)}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  const raw = out?.choices?.[0]?.message?.content ?? "";
  try {
    return { ...JSON.parse(raw), model: MODELS.reason };
  } catch {
    return { laneId: null, laneName: null, reason: raw, confidence: 0, model: MODELS.reason, unparsed: true };
  }
}

/**
 * Read a supplier quotation or delivery document into shipment fields.
 * The file goes to the bridge as base64; the bridge converts it to text
 * locally and returns structured fields. Supplier figures come back verbatim
 * as evidence; the desk's own costing is untouched.
 * Returns {fields, servedBy}.
 */
const DOC_TYPES = [".pdf", ".txt", ".csv", ".tsv", ".md", ".json", ".html", ".htm"];

export function isReadableDocument(name) {
  const lower = String(name || "").toLowerCase();
  return DOC_TYPES.some((t) => lower.endsWith(t));
}

/** The sheet asks for a compact object and nothing else; a rate card is not a paragraph of prose. */
export const DOC_PROMPT =
  "Read the document text and return one JSON object, no prose and no code fences, with these keys: " +
  "cargo, quantity, weightKg, origin, destination, hs, value, currency, comments. " +
  "Use exactly what the document states; use null for anything it does not state. Never estimate a " +
  "weight, a value or an HS code that is not written down. quantity and weightKg are numbers when the " +
  "document gives a number. comments carries the document's own wording about validity, surcharges or " +
  "conditions, copied, not summarised. If the same figure appears several times, use the one the " +
  "document calls the total.";

function jsonFrom(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last <= first) throw new Error("the model did not return a readable field set");
  return JSON.parse(cleaned.slice(first, last + 1));
}

/**
 * A document the operator already has - a rate card, a quotation, a packing list.
 *
 * The text is lifted in the browser (see doctext.mjs) and only the text is sent, so the supplier's file
 * is never uploaded. The model is told to copy what is written and to leave a field null rather than
 * estimate: a guessed weight becomes a wrong freight charge that nobody can trace back to a document.
 */
export async function readDocument(file) {
  const { text, empty, pages } = await fileText(file);
  if (empty) {
    throw new Error(
      `${file.name} has no text layer - it is a scan, and this build reads words, not pictures of words. ` +
        "Photograph it instead, or send the original PDF.",
    );
  }
  // Measured on the deployed build: at this prompt length Spark spends the whole allowance reasoning
  // and returns finish_reason "length" with no words (800 and 1,200 tokens alike), which surfaced to
  // the operator as "the model did not return a readable field set". Asked to reason lightly it
  // answers. The retry at a raised ceiling is in call() and keeps the same instruction.
  const out = await call("/chat/completions", {
    model: MODELS.reason,
    max_tokens: 1000,
    temperature: 0,
    reasoning_effort: "minimal",
    messages: [
      { role: "system", content: DOC_PROMPT },
      { role: "user", content: `Document: ${file.name}\n\n${text.slice(0, 12000)}` },
    ],
  });
  const content = out?.choices?.[0]?.message?.content || "";
  const fields = jsonFrom(content);
  return { fields, pages, servedBy: out?.model || MODELS.reason };
}
