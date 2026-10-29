/**
 * Three model jobs that earn their place in the product, each with a deterministic fallback.
 *
 * The rule the whole entry rests on: a model *explains and structures*, it never computes a price
 * and never invents a status. Every answer is validated against something the system already
 * knows — a closed list of milestones, the set of candidate lanes it was given, an integer count —
 * and anything that fails validation is a refusal, not a guess.
 */
import { MetaError, redact } from "./client.mjs";
import { MILESTONES } from "../tracking.mjs";

/** Model responses arrive in several shapes; accept the documented ones and refuse the rest. */
export function textOf(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const choice = payload?.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content.map((p) => p?.text ?? "").join("");
  }
  if (Array.isArray(payload?.output)) {
    const joined = payload.output
      .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
      .map((c) => c?.text ?? "")
      .join("");
    if (joined) return joined;
  }
  throw new MetaError("bad_response", "no text found in the model response");
}

/** Pull the first JSON object out of a reply that may be wrapped in prose or a code fence. */
export function jsonIn(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new MetaError("bad_response", "no JSON object in the model response");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new MetaError("bad_response", `model JSON did not parse: ${redact(err.message)}`);
  }
}

/**
 * 1. Lane reasoning.
 * Input: the load and the candidate lanes the desk is already willing to run.
 * Output: one of those lanes, a reason a clerk can repeat to a customer, and a confidence.
 * The model may not introduce a lane that was not offered.
 */
export async function explainLane(client, { weightKg, corridor, candidates, notes = [] }) {
  const offered = candidates.map((c) => c.key ?? c.lane ?? c);
  const fallback = () => {
    const ranked = [...candidates].sort((a, b) => (a.rankHours ?? 0) - (b.rankHours ?? 0));
    const pick = ranked[0];
    return {
      ok: true,
      source: "deterministic",
      lane: pick?.key ?? pick?.lane ?? pick ?? null,
      reason: "Chosen by the corridor model: shortest planned transit among the lanes that accept this load.",
      confidence: null,
      note: "No model was called. This is the fallback path, and it is labelled as one.",
    };
  };

  const entry = await client.run(
    "lane",
    { weightKg, corridor, candidates: offered, notes },
    {
      build: ({ model, input }) => ({
        model,
        input: [
          `Load: ${input.weightKg} kg on the ${input.corridor} corridor.`,
          `Candidate lanes: ${input.candidates.join(", ")}.`,
          input.notes.length ? `Desk notes: ${input.notes.join("; ")}` : "",
          "Choose exactly one candidate lane. Reply with JSON only:",
          '{"lane":"<one of the candidates>","reason":"<one sentence a clerk can say to a customer>","confidence":<0..1>}',
        ].filter(Boolean).join("\n"),
      }),
      parse: (payload) => {
        const obj = jsonIn(textOf(payload));
        if (!offered.includes(obj.lane)) {
          throw new MetaError("bad_response", `model chose "${obj.lane}", which was not offered`);
        }
        if (typeof obj.reason !== "string" || obj.reason.trim().length < 8) {
          throw new MetaError("bad_response", "reason missing or too short to repeat");
        }
        const confidence = typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : null;
        return { lane: obj.lane, reason: obj.reason.trim(), confidence };
      },
    },
  );

  if (!entry.ok) return { ...fallback(), modelEntry: entry };
  return { ok: true, source: "model", ...entry.output, modelEntry: entry };
}

/**
 * 2. Driver note -> structured milestone.
 * A driver speaks; the model maps the sentence to the closed milestone list. Anything that is not
 * on the list is refused, because a wrong milestone moves a customer's delivery date.
 */
export async function structureDriverNote(client, { transcript }) {
  if (typeof transcript !== "string" || transcript.trim().length < 3) {
    throw new MetaError("bad_input", "a transcript is required");
  }

  const keywords = [
    [["gate", "entered", "inside", "ameingia"], "gate_in"],
    [["loaded", "loading", "imepakiwa", "kupakia"], "loaded"],
    [["departed", "left", "leaving", "ameondoka", "toka"], "departed"],
    [["customs", "cleared", "forodha"], "customs_cleared"],
    [["warehouse", "godown", "ghala"], "at_warehouse"],
    [["out for delivery", "delivery", "out for", "anapeleka"], "out_for_delivery"],
    [["delivered", "signed", "received", "amekabidhi"], "delivered"],
    [["breakdown", "broken", "imeharibika"], "breakdown"],
  ];
  const fallback = () => {
    const normalised = transcript.toLowerCase();
    const hit = keywords.find(([words]) => words.some((w) => normalised.includes(w)));
    const milestone = hit ? hit[1] : null;
    return {
      ok: milestone !== null,
      source: "deterministic",
      milestone,
      detail: milestone ? "Matched on keywords in the note." : "No milestone could be read from the note; it is held for a human.",
      held: milestone === null,
      note: "No model was called. Keyword match, labelled as such.",
    };
  };

  const entry = await client.run(
    "voice",
    { transcript },
    {
      build: ({ model, input }) => ({
        model,
        input: [
          "Map this driver note to exactly one milestone. Allowed milestones:",
          MILESTONES.join(", "),
          "If the note does not state one of them, return null. Reply with JSON only:",
          '{"milestone":"<allowed milestone or null>","detail":"<the words that support it>"}',
          `Note (Swahili or English): ${input.transcript}`,
        ].join("\n"),
      }),
      parse: (payload) => {
        const obj = jsonIn(textOf(payload));
        if (obj.milestone === null) return { milestone: null, detail: "The model found no milestone in the note." };
        if (!MILESTONES.includes(obj.milestone)) {
          throw new MetaError("bad_response", `"${obj.milestone}" is not a milestone in this system`);
        }
        return { milestone: obj.milestone, detail: String(obj.detail ?? "").slice(0, 300) };
      },
    },
  );

  if (!entry.ok) return { ...fallback(), modelEntry: entry };
  return {
    ok: entry.output.milestone !== null,
    source: "model",
    milestone: entry.output.milestone,
    detail: entry.output.detail,
    held: entry.output.milestone === null,
    modelEntry: entry,
  };
}

/**
 * 3. Cargo count from a photo.
 * A count is a number and a confidence. Below the threshold the count is held for the clerk, never
 * silently accepted, because a wrong count becomes a wrong customs declaration.
 */
export async function countCargo(client, { imageUrl, expected = null, threshold = 0.85 }) {
  if (typeof imageUrl !== "string" || !imageUrl) throw new MetaError("bad_input", "an image reference is required");

  const entry = await client.run(
    "vision",
    { imageUrl, expected },
    {
      build: ({ model, input }) => ({
        model,
        input: [
          "Count the discrete cargo units visible in this image. Ignore pallets and packaging.",
          'Reply with JSON only: {"count":<integer>,"confidence":<0..1>,"uncertain":["<what you could not see>"]}',
          `Image: ${input.imageUrl}`,
        ].join("\n"),
      }),
      parse: (payload) => {
        const obj = jsonIn(textOf(payload));
        const count = Number(obj.count);
        if (!Number.isInteger(count) || count < 0) throw new MetaError("bad_response", "count is not a whole number");
        const confidence = Number(obj.confidence);
        if (!(confidence >= 0 && confidence <= 1)) throw new MetaError("bad_response", "confidence is not between 0 and 1");
        return { count, confidence, uncertain: Array.isArray(obj.uncertain) ? obj.uncertain.slice(0, 5) : [] };
      },
    },
  );

  if (!entry.ok) {
    return {
      ok: false,
      source: "none",
      count: null,
      reason: "no count was produced without a model — a number invented here would end up on a customs declaration",
      modelEntry: entry,
    };
  }

  const { count, confidence, uncertain } = entry.output;
  const accepted = confidence >= threshold;
  return {
    ok: true,
    source: "model",
    count,
    confidence,
    uncertain,
    accepted,
    needsReview: !accepted,
    reason: accepted
      ? `The model counted ${count} units at ${(confidence * 100).toFixed(0)}% confidence.`
      : `Count of ${count} at ${(confidence * 100).toFixed(0)}% confidence is below the ${(threshold * 100).toFixed(0)}% line — held for the clerk.`,
    modelEntry: entry,
  };
}
