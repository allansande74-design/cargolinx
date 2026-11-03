/**
 * Reading a client's words into a draft order.
 *
 * The model is asked for strict JSON. Whatever comes back is passed through a schema here before
 * anything else sees it: a field the schema does not recognise is dropped, a value it cannot justify
 * is rejected, and a price is refused outright — the model is allowed to read the message, never to
 * set money. If the model is unavailable, slow, or returns something that will not validate, the
 * deterministic parser takes over and says so, so the desk always answers.
 *
 * The caller is injected: the same code reads the message through Meta's Muse, through a model on
 * our own box, or through a test double.
 */

export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

/** Fields a reading may produce. Anything else is dropped, and prices are refused by design. */
export const INTAKE_FIELDS = {
  product: { type: "string", max: 160, required: true },
  qty: { type: "number", min: 1, max: 1_000_000, required: true },
  unit: { type: "string", max: 24, required: false },
  destinationCity: { type: "string", max: 80, required: false },
  country: { type: "string", max: 2, required: false },
  incoterm: { type: "enum", values: INCOTERMS, required: false },
  neededBy: { type: "date", required: false },
  notes: { type: "string", max: 400, required: false },
};

export const FORBIDDEN_FIELDS = ["price", "unitPrice", "amount", "total", "quote", "margin", "cost", "landedCost", "currency"];

export function buildPrompt(text) {
  return [
    "You read a client's message for a Nairobi freight forwarder and return a draft order.",
    "Reply with one JSON object and nothing else. No prose, no code fences.",
    "Keys, all optional except product and qty:",
    '  "product": what they want, as they named it',
    '  "qty": how many, a number',
    '  "unit": pieces, cartons, kg, litres',
    '  "destinationCity": the city it goes to',
    '  "country": two-letter code if stated',
    '  "incoterm": one of ' + INCOTERMS.join(", "),
    '  "neededBy": date as YYYY-MM-DD if stated',
    '  "notes": anything else that matters, under 400 characters',
    "Never include a price, an amount, a cost or a currency: pricing is not your job.",
    "",
    "Message:",
    text.trim(),
  ].join("\n");
}

function coerceDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : s;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Validate a reading. Returns the draft plus the reasons anything was refused, so the desk can show
 * a judge exactly what the schema threw away.
 */
export function validateIntake(raw) {
  const errors = [];
  const dropped = [];
  const draft = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, draft: null, errors: ["reading is not an object"], dropped };
  }
  for (const [key, value] of Object.entries(raw)) {
    if (FORBIDDEN_FIELDS.includes(key)) { dropped.push(`${key} (money is not the model's to set)`); continue; }
    const spec = INTAKE_FIELDS[key];
    if (!spec) { dropped.push(`${key} (unknown field)`); continue; }
    if (value == null || value === "") continue;
    if (spec.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) { errors.push(`${key} is not a number`); continue; }
      if (spec.min != null && n < spec.min) { errors.push(`${key} below ${spec.min}`); continue; }
      if (spec.max != null && n > spec.max) { errors.push(`${key} above ${spec.max}`); continue; }
      draft[key] = n;
    } else if (spec.type === "enum") {
      const v = String(value).trim().toUpperCase();
      if (!spec.values.includes(v)) { errors.push(`${key} not one of ${spec.values.join(", ")}`); continue; }
      draft[key] = v;
    } else if (spec.type === "date") {
      const d = coerceDate(value);
      if (!d) { errors.push(`${key} is not a date`); continue; }
      draft[key] = d;
    } else {
      const v = String(value).trim().slice(0, spec.max);
      if (v) draft[key] = v;
    }
  }
  for (const [key, spec] of Object.entries(INTAKE_FIELDS)) {
    if (spec.required && draft[key] == null) errors.push(`${key} is required and was not found`);
  }
  return { ok: errors.length === 0, draft: errors.length === 0 ? draft : null, partial: draft, errors, dropped };
}

/** Pull the object out of whatever the model wrapped it in. */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/** Deterministic reading: quantity, destination, incoterm and a date, from the sentence itself. */
export function deterministicRead(text) {
  const t = String(text || "");
  const qty = /(\d[\d,]*)\s*(?:x\s*)?(?:pieces?|pcs?|units?|cartons?|bags?|litres?|liters?|kg|kgs|tonnes?|sets?)?/i.exec(t);
  const n = qty ? Number(qty[1].replace(/,/g, "")) : null;
  const incoterm = INCOTERMS.find((i) => new RegExp(`\\b${i}\\b`, "i").test(t)) || null;
  const city = /(?:to|deliver(?:ed)? to|in)\s+([A-Z][a-zA-Z]+)/.exec(t);
  const date = /(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i.exec(t);
  let neededBy = null;
  if (date) {
    const cast = coerceDate(`${date[2]} ${date[1]}, 2027`);
    neededBy = cast;
  }
  return { qty: n && n > 0 ? n : null, destinationCity: city ? city[1] : null, incoterm, neededBy, product: null };
}

/**
 * Read the message.
 *
 * call: async ({prompt, text, model}) => string   — the model, injected.
 * Returns { draft, source, model, ms, errors, dropped }. source is "model", "deterministic" or "merged".
 */
export async function readIntake(text, { call = null, model = "unknown", timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  let modelDraft = null;
  let errors = [];
  let dropped = [];
  let source = "deterministic";

  if (call) {
    try {
      const raw = await Promise.race([
        call({ prompt: buildPrompt(text), text, model }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("model timeout")), timeoutMs)),
      ]);
      const parsed = extractJson(raw);
      if (parsed) {
        const v = validateIntake(parsed);
        modelDraft = v.ok ? v.draft : v.partial;
        errors = v.errors;
        dropped = v.dropped;
        source = v.ok ? "model" : "merged";
      } else {
        errors = ["model returned no parseable JSON"];
        source = "merged";
      }
    } catch (e) {
      errors = [String(e.message || e)];
      source = "merged";
    }
  }

  const base = deterministicRead(text);
  const draft = { ...base, ...(modelDraft || {}) };
  // A reading is usable only if the two fields a quote needs are present.
  const usable = Boolean(draft.product || draft.destinationCity) && Number(draft.qty) > 0;
  return {
    draft,
    usable,
    source,
    model,
    ms: Date.now() - started,
    errors,
    dropped,
  };
}
