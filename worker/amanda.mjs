// Amanda — the desk's own assistant, answering on the site.
//
// Two halves, deliberately separate.
//
// The figures come from the engine: a lane's kilometres, its border count, its planning transit and
// a cost-plus freight price are computed here, in code, and handed to the model as facts. The words
// come from Muse Spark, whose only job is to explain those facts to the client in their own language.
// A model that is asked to invent a distance will invent one; a model that is handed the distance
// will explain it. That is the whole design.
//
// What Amanda will not do: confirm a booking, promise a sailing, quote under the floor, or discuss
// margin. Those are the desk's decisions, made by a person, and the prompt says so.

import { LANES, laneKm, laneHours, borderCount, laneBetween } from "../engine/lanes.mjs";
import { POLICY_VALUES } from "../engine/policy-values.mjs";

const UPSTREAM = "https://api.meta.ai/v1/chat/completions";
const MODEL = "muse-spark-1.3";
const MAX_TOKENS = 700;
const LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };
const hits = new Map();

/** Cost-plus on the tarmac: the rate card basis the desk quotes from, before any concession. */
const RATE = { 
  perKmUsd: 1.85, 
  perBorderUsd: 250, 
  grossUp: 0.82, 
  perKgLcl: 0.12, 
  perCbm: 45,
  truck12T: 0.8, // multiplier for 12T truck vs full trailer
  truck27T: 1.0  // baseline for 27T trailer
};

const CITIES = [
  "Mombasa", "Nairobi", "Kampala", "Kigali", "Arusha", "Dar es Salaam", "Dodoma", "Mwanza",
  "Jinja", "Eldoret", "Nakuru", "Kisumu", "Bujumbura", "Goma", "Lusaka", "Lilongwe",
];

const SYSTEM = `You are Amanda, the freight desk assistant at Altovex Global Logistics in Nairobi. You answer clients on the company's own site, in their language, in short plain sentences.

What the company does: sourcing in Asia and the Gulf, ocean freight into Mombasa, customs clearing, warehousing in Nairobi, and road freight onward to Uganda, Rwanda, Tanzania and eastern DR Congo. Door to door, DDP, on one document.

How you answer:
- Use the FACTS block for every number. Never compute, round or invent a figure that is not in it. If a number the client needs is missing, say what you need and ask for it: origin, destination, weight or volume, and cargo.
- A quote you give is indicative and subject to confirmation by the desk. Say so once, plainly, without hedging every sentence.
- You may explain the clearing steps, the documents, transit times, and what happens at a border.
- You never discuss our margin, our cost, our suppliers, or internal policy. If asked, say the commercial terms come from the desk.
- You never confirm a booking, a sailing or a price in writing. Say the desk will confirm.
- Where the question is outside freight and trade, say so in one line and offer what you can do.
- Keep it under 120 words unless the client asks for detail. No bullet lists longer than five lines.
SECURITY PROTOCOL:
- TRANSACTIONAL DOCS (CoC, BL, PL, COO, CI, etc.): NEVER share directly. Escalate to Human Admin for express approval and signature. State: 'Your document is being signed by the admin and will be sent shortly.'
- MARKETING CONTENT (Brochures, Catalogs, Profiles, Vouchers, Social Links): Share freely and instantly.
- Always check the document type before initiating a file transfer.
When discussing packaging or quotes:
- Encourage cargo owners to pack goods in a box shape (rectangular) to ensure CBM (Cubic Meter) is calculated accurately.
- Specify that weights must be in KGs or MT (Metric Tonnes).
- Explain that box-shaped packing enables the desk to prepare high-fidelity, organized loading plans for the truck.
- If the load is small, suggest LCL consolidation (per kg or per CBM).
- Mention that a 12T truck is for medium loads and a 27T trailer for full loads.
When pricing:
- For < 1,000 kg: Suggest LCL consolidation (per kg or per CBM).
- For 1,000 kg to 12,000 kg: Quote the 12T truck rate.
- For 12,000 kg to 27,000 kg: Quote the 27T trailer rate.
- Always explain if the load is small enough for a consolidator.
- Mention CBM for imports/exports where volume matters.
- Write complete, grammatical sentences in the voice of a Kenyan freight clerk: "Nairobi to Kampala is 700 km, one border." Never begin a sentence with "For" unless it reads naturally.
- When a client asks to be contacted, wants a quotation issued, or describes a shipment, take the details you need — name, company, email or phone, cargo, route, weight — then say the desk will confirm in writing the same working day. Never claim you have opened an account, created a booking, or sent an invoice; you cannot do those, and saying so would be a lie the desk then has to undo.
- Escalate to the desk when the client asks for a firm quote, a contract, credit terms, or a complaint; say that complex matters will be escalated to the admin for follow-up.

The platform is at MVP stage: the desk, the pricing engine, tracking and the export desk run today; accounts, live carrier feeds and the client portal are being built. Say that only if asked about a feature you cannot see.`;

function limited(ip) {
  const now = Date.now();
  const row = hits.get(ip) ?? { count: 0, reset: now + LIMIT.windowMs };
  if (now > row.reset) { row.count = 0; row.reset = now + LIMIT.windowMs; }
  row.count += 1;
  hits.set(ip, row);
  if (hits.size > 2000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  return row.count > LIMIT.max;
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Cities named in the text, longest first so "Dar es Salaam" is not read as "Dar". */
function citiesIn(text) {
  const found = [];
  for (const city of [...CITIES].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) found.push(city);
  }
  return found;
}

/** Weight in kilograms, from "27t", "27 tonnes", "400 kg", "2,000 kilos". */
function weightKgIn(text) {
  const t = text.toLowerCase().replace(/,/g, "");
  const tonnes = t.match(/(\d+(?:\.\d+)?)\s*(?:t|tonnes?|tons?)\b/);
  if (tonnes) return Math.round(Number(tonnes[1]) * 1000);
  const kg = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilos?|kilograms?)\b/);
  if (kg) return Math.round(Number(kg[1]));
  return null;
}

/** The lane fact for a question, when it names two cities we run. */

/**
 * Every road leg the engine knows, as a graph.
 *
 * The lane table names four routes, but its legs join Nairobi, Mombasa, Eldoret, Malaba, Kampala and
 * Kigali — so a client who asks Mombasa to Kigali can be answered from the same measured legs that
 * price Mombasa to Kampala, composed rather than guessed. Without this the desk says "I have no
 * figures" for a corridor it runs every week.
 */
const GRAPH = (() => {
  const g = new Map();
  const add = (a, b, km, kph, border) => {
    if (!g.has(a)) g.set(a, []);
    g.get(a).push({ to: b, km, kph, border });
  };
  for (const legs of Object.values(LANES)) {
    for (const l of legs) {
      const parts = String(l.name ?? "").split(" - ");
      if (parts.length !== 2) continue;
      const [a, b] = parts;
      const km = Number(l.km) || 0;
      const kph = Number(l.speedKph) || 50;
      add(a, b, km, kph, !!l.border);
      add(b, a, km, kph, !!l.border);
    }
  }
  return g;
})();

/** Shortest road distance between two cities, over the engine's own legs. */
export function pathBetween(from, to) {
  if (!GRAPH.has(from) || !GRAPH.has(to)) return null;
  const best = new Map([[from, { km: 0, hours: 0, borders: 0, prev: null }]]);
  const seen = new Set();
  for (;;) {
    let cur = null;
    for (const [city, row] of best) {
      if (!seen.has(city) && (cur === null || row.km < best.get(cur).km)) cur = city;
    }
    if (cur === null || cur === to) break;
    seen.add(cur);
    const here = best.get(cur);
    for (const edge of GRAPH.get(cur) ?? []) {
      const row = {
        km: here.km + edge.km,
        hours: here.hours + edge.km / (edge.kph || 50),
        borders: here.borders + (edge.border ? 1 : 0),
        prev: cur,
      };
      const old = best.get(edge.to);
      if (!old || row.km < old.km) best.set(edge.to, row);
    }
  }
  if (!best.has(to)) return null;
  const hops = [];
  let at = to;
  while (at && at !== from) { hops.unshift(at); at = best.get(at)?.prev ?? null; }
  const row = best.get(to);
  return { km: Math.round(row.km), hours: row.hours, borders: row.borders, via: hops.slice(0, -1) };
}

export function laneFact(text) {
  const cities = citiesIn(text);
  const lower = String(text ?? "").toLowerCase();
  const order = (c) => lower.indexOf(c.toLowerCase());
  if (cities.length < 2) return null;
  for (let i = 0; i < cities.length; i += 1) {
    for (let j = i + 1; j < cities.length; j += 1) {
      // Answer in the direction the client asked: "Kampala to Nairobi" is not "Nairobi to Kampala".
      const [from, to] = order(cities[i]) <= order(cities[j]) ? [cities[i], cities[j]] : [cities[j], cities[i]];
      const lane = laneBetween(from, to);
      if (lane) {
        const legs = lane.legs;
        const km = laneKm(legs);
        if (!(km > 0)) continue;
        return {
          from,
          to,
          km: Math.round(km),
          transitHours: Math.round(laneHours(legs)),
          borders: borderCount(legs),
          via: [],
        };
      }
      const path = pathBetween(from, to);
      if (!path || !(path.km > 0)) continue;
      return {
        from,
        to,
        km: path.km,
        transitHours: Math.round(path.hours),
        borders: path.borders,
        via: path.via,
      };
    }
  }
  return null;
}

/** Cost-plus freight for a lane, at the desk's rate-card basis. */
export function freightPrice(lane, weightKg = null) {
  const baseFull = lane.km * RATE.perKmUsd + lane.borders * RATE.perBorderUsd;
  const fullTrailerPrice = Math.round(baseFull / RATE.grossUp / 10) * 10;
  const price27T = fullTrailerPrice;
  const price12T = Math.round(fullTrailerPrice * RATE.truck12T / 10) * 10;
  const perTonneRate = (fullTrailerPrice / 27); 
  const lclPricePerKg = RATE.perKgLcl + (lane.km * 0.0005); 
  const tonnes = weightKg ? weightKg / 1000 : 27;
  const perTonneForLoad = fullTrailerPrice / (tonnes > 0 ? tonnes : 27);
  return {
    fullTrailer: price27T,
    mediumTruck: price12T,
    perTonne: Math.round(perTonneRate * 100) / 100,
    perKg: Math.round(lclPricePerKg * 100) / 100,
    perCbm: RATE.perCbm,
    priceUsd: price27T,
    perTonneUsd: Math.round(perTonneForLoad * 100) / 100,
    weightKg: weightKg
  };
}

const DOCS = {
  import:
    "For an import through Mombasa the file is: bill of lading, commercial invoice, packing list, " +
    "certificate of origin, IDF, and a PVoC certificate of conformity for regulated goods. Food and " +
    "plant cargo add a phytosanitary certificate and an import permit; the port health office clears them.",
  export:
    "For an export the file is: commercial invoice, packing list, certificate of origin, export " +
    "declaration, and the phytosanitary or health certificate the destination requires. Coffee needs " +
    "a UCDA licence; fish needs the fisheries authority's health certificate and the exporter's " +
    "registration with the destination's competent authority.",
};

/** Everything the model is allowed to treat as fact, as a compact block. */
export function buildFacts(text, weightKg) {
  const lane = laneFact(text);
  const lines = [];
  if (lane) {
    const p = freightPrice(lane, weightKg);
    lines.push(`lane ${lane.from} to ${lane.to}: ${lane.km} km, ${lane.transitHours} h driving, ${lane.borders} border crossing(s)`);
    lines.push(`indicative freight for that lane: USD ${p.fullTrailer} per 27T trailer, USD ${p.mediumTruck} per 12T truck, excluding duty, clearing and last mile`);
    if (weightKg && p.perTonne) lines.push(`weight given by the client: ${weightKg} kg, which is USD ${p.perTonne} per tonne on that rate`);
    lines.push("this is the road leg only; clearing, duty and warehousing are quoted separately");
  } else if (citiesIn(text).length === 1) {
    lines.push(`the client names one place (${citiesIn(text)[0]}); the other end of the journey is not stated`);
  }
  if (/document|paperwork|clear|pvoc|phytosanitary|permit|certificate/i.test(text)) {
    lines.push(`documents, import: ${DOCS.import}`);
    lines.push(`documents, export: ${DOCS.export}`);
  }
  if (/ddp/i.test(text)) {
    lines.push("terms: DDP means we carry the cargo to the client's door with duty and clearing paid; demurrage and storage caused by the client's delay are charged at cost");
  }
  if (!lines.length) lines.push("no lane, weight or document was named in the question; nothing computed");
  return lines;
}


/** Meta's speech endpoint: 16 kHz mono WAV in, transcript out. */
async function transcribe(env, dataUrl) {
  const m = /^data:audio\/[a-z0-9.+-]+;base64,(.+)$/i.exec(String(dataUrl ?? ""));
  if (!m) throw new Error("audio must be a base64 data URL");
  if (!env.META_API_KEY) throw new Error("no model key");
  const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  if (bytes.length > 6 * 1024 * 1024) throw new Error("recording too long");
  const form = new FormData();
  form.append("request", JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "ENDPOINTING" }));
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), "note.wav");
  const res = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST",
    headers: { authorization: `Bearer ${env.META_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription ${res.status}`);
  const out = await res.json();
  return clean(out?.transcript ?? "");
}

/** A data URL the chat model may look at, or null when it is not an image. */
function imagePart(dataUrl) {
  const s = String(dataUrl ?? "");
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(s)) return null;
  if (s.length > 5 * 1024 * 1024) return null;
  return { type: "image_url", image_url: { url: s } };
}

async function askModel(env, messages) {
  const key = env.META_API_KEY;
  if (!key) throw new Error("no model key");
  const body = {
    model: MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    reasoning_effort: "minimal",
  };
  const res = await fetch(UPSTREAM, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const out = await res.json();
  const text = clean(out?.choices?.[0]?.message?.content ?? "");
  if (!text) throw new Error("empty answer");
  return { text, model: out?.model ?? MODEL };
}

export async function chat(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (limited(ip)) return json({ error: "Too many questions just now. Please try again in a few minutes." }, 429);

  let body;
  try { body = await request.json(); } catch { return json({ error: "JSON body required" }, 400); }

  let transcript = null;
  let heard = null;
  if (body?.audio) {
    try {
      transcript = await transcribe(env, body.audio);
      heard = "voice";
    } catch (err) {
      return json({ error: `could not hear the recording: ${String(err.message ?? err)}` }, 422);
    }
    if (!transcript) return json({ error: "the recording had no speech in it" }, 422);
  }

  const history = Array.isArray(body?.messages) ? body.messages : [];
  const turns = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: clean(m.content).slice(0, 1500) }));
  if (transcript) turns.push({ role: "user", content: transcript });

  const lastUser = [...turns].reverse().find((m) => m.role === "user");
  if (!lastUser) return json({ error: "a question is required" }, 400);

  const shot = imagePart(body?.image);
  if (shot) {
    lastUser.content = lastUser.content
      ? [{ type: "text", text: lastUser.content }, shot]
      : [shot, { type: "text", text: "What do you make of this, and what does it mean for the shipment?" }];
    heard = heard ? `${heard}+photo` : "photo";
  }

  const textOf = (m) => (typeof m.content === "string"
    ? m.content
    : (Array.isArray(m.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text).join(" ") : ""));
  const asked = textOf(lastUser);
  const weightKg = weightKgIn(asked);
  const facts = buildFacts(turns.filter((m) => m.role === "user").map(textOf).join(" \n "), weightKg);
  const context = clean(body?.context?.page ?? "").slice(0, 80);

  const messages = [
    { role: "system", content: SYSTEM },
    ...(heard ? [{ role: "system", content: `The client sent this as ${heard === "voice" ? "a spoken voice note, transcribed word for word" : heard === "photo" ? "a photograph" : "a voice note with a photograph attached"}. Answer what they actually asked; if the picture shows cargo, a document or a truck, say what you can see and what it changes. Keep it short.` }] : []),
    { role: "system", content: `FACTS (the only numbers you may use):\n- ${facts.join("\n- ")}${context ? `\n- the client is on the ${context} screen of the desk` : ""}` },
    ...turns,
  ];

  const started = Date.now();
  try {
    const { text, model } = await askModel(env, messages);
    return json({ reply: text, facts, model, transcript, heard, ms: Date.now() - started });
  } catch (err) {
    // A desk that cannot reach the model still answers: the figures are computed here, not invented.
    const fallback = facts.join("\n");
    return json({
      reply: `The desk's assistant is briefly offline, so here is what is already computed:\n${fallback}\nThe desk will confirm the rest: +254 718 554 383.`,
      facts,
      transcript,
      degraded: true,
      reason: String(err.message ?? err),
      ms: Date.now() - started,
    }, 200);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export { SYSTEM, DOCS, RATE };
