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
  baseUrl: "",
  apiKey: "",
  keyPresent: false,
};

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
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new ModelUnavailable("No Meta model key is configured. The engine still quotes and tracks; model-assisted steps are disabled.");
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
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
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { live: false, reason: "no key configured", models: MODELS };
  }
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
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
  const out = await call("/chat/completions", {
    model: MODELS.vision,
    messages: [
      {
        role: "system",
        content:
          "You read cargo photographs for a freight desk. Return JSON only, with keys: items (array of {label, count, confidence}), totalCount, notes. Count what is visible; if the image is unclear, say so in notes and lower confidence. Never estimate value, weight or price.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Count the cargo in this photograph. Context from the desk: ${hint || "none"}.` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  const raw = out?.choices?.[0]?.message?.content ?? "";
  try {
    return { ...JSON.parse(raw), model: MODELS.vision, raw };
  } catch {
    return { items: [], totalCount: null, notes: raw, model: MODELS.vision, unparsed: true };
  }
}

/** Transcribe a driver's voice note into text (no interpretation). */
export async function transcribeVoice(blob, { language = null } = {}) {
  const cfg = await getModelConfig();
  if (!cfg.baseUrl || !cfg.apiKey) throw new ModelUnavailable("No Meta model key is configured.");
  const form = new FormData();
  form.append("file", blob, "note.webm");
  form.append("model", MODELS.voice);
  // Muse Voice Transcribe: 25 evaluated languages + code-switching, single
  // model. Hint the expected language (ISO code: en, sw, fr, rw, lg, am, ny,
  // zu, ln); omit to auto-detect. Same endpoint for every country.
  if (language) form.append("language", language);
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { text: data.text ?? "", model: MODELS.voice };
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
