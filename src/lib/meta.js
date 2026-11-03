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
  return { ...DEFAULTS, ...((await kvGet("model")) ?? {}) };
}

export async function setModelConfig(cfg) {
  const next = { ...cfg, keyPresent: Boolean(cfg.apiKey) };
  await kvSet("model", next);
  return next;
}

async function call(path, body, { timeoutMs = 45000 } = {}) {
  const cfg = await getModelConfig();
  if (!cfg.baseUrl) {
    throw new ModelUnavailable("No Meta model endpoint is configured. The engine still quotes and tracks; model-assisted steps are disabled.");
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(cfg) },
      body: JSON.stringify(body),
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
}

/** Is the model layer usable right now? Called on boot; never throws. */
export async function probe() {
  const cfg = await getModelConfig();
  if (!cfg.baseUrl) {
    return { live: false, reason: "no endpoint configured", models: MODELS };
  }
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/models`, { headers: authHeader(cfg) });
    if (!res.ok) return { live: false, reason: 'HTTP ' + res.status, models: MODELS };
    // A router-style bridge returns a list filtered to our app models; a raw
    // Meta endpoint returns the account's full model list. Either is live.
    const body = await res.json().catch(() => ({}));
    const ids = Array.isArray(body && body.data) ? body.data.map((m) => m.id) : [];
    const bridged = ids.length > 0 && ids.indexOf('muse-spark-1.3') < 0;
    return { live: true, reason: bridged ? 'reachable using local bridge' : 'reachable', models: MODELS, viaBridge: bridged };
  } catch (err) {
    return { live: false, reason: err.message, models: MODELS };
  }
}

/** Count and classify cargo from an intake photograph. Returns counts, never a price. */
export async function readCargoPhoto(dataUrl, hint = "") {
  const cfg = await getModelConfig();
  const concept = String(hint || "").trim().split(/\s+/).slice(0, 3).join(" ") || "carton";
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
            { type: "input_image", image_url: dataUrl },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);

  // SAM 3.1 answers in the text lane with special tokens: one box and one mask per match, so the
  // count is the number of boxes it actually found — not a sentence from a language model.
  const text = await readEventText(res);
  const boxes = [...text.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);/g)].map((m) => ({
    x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]),
  }));
  return {
    items: boxes.length ? [{ label: concept, count: boxes.length, confidence: null }] : [],
    totalCount: boxes.length ? boxes.length : null,
    boxes,
    notes: boxes.length ? "" : `nothing matching "${concept}" was found in this photograph`,
    model: MODELS.vision,
    concept,
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
  const out = await call("/chat/completions", {
    model: MODELS.reason,
    messages: [
      {
        role: "system",
        content:
          "You explain a freight quote to a client in at most 90 words, in plain English. Use ONLY the figures given. Do not round, add or infer any figure. Mention the two largest cost lines and the margin. If a figure is missing, say it is missing. Never print a field name or JSON key: name each line the way a trader would — 'landed cost before VAT', 'customs value (CIF)', 'import duty', 'VAT', 'margin' — and write money as KES 2,038,543.70, never as a bare number.",
      },
      { role: "user", content: `Quote figures (JSON):\n${JSON.stringify(quote)}\n\nContext: ${context || "none"}` },
    ],
    temperature: 0.2,
  });
  return { text: out?.choices?.[0]?.message?.content ?? "", model: MODELS.reason };
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
const DOC_TYPES = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt", ".html", ".htm"];

export function isReadableDocument(name) {
  const lower = String(name || "").toLowerCase();
  return DOC_TYPES.some((t) => lower.endsWith(t));
}

function fileToB64(file) {
  return new Promise((ok, bad) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1]);
    fr.onerror = bad;
    fr.readAsDataURL(file);
  });
}

export async function readDocument(file) {
  const cfg = await getModelConfig();
  if (!cfg.baseUrl || !cfg.apiKey) throw new ModelUnavailable("No model endpoint is configured. Set it in Settings first.");
  const out = await call("/v1/documents/extract", {
    name: file.name,
    mime: file.type || "application/octet-stream",
    data_b64: await fileToB64(file),
  }, { timeoutMs: 120000 });
  return { fields: out.fields ?? {}, servedBy: out?.bridge?.served_by ?? "meta:direct" };
}
