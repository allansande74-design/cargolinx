/**
 * The desk's model roster, and the rules for the one screen that fans a question out to several of them.
 *
 * Two of the nine models on the account are contributor models. They are excluded by policy, not by
 * accident: no client or company data may reach a contributor model, so the desk never asks one a
 * question — and says so on screen rather than hiding it.
 *
 * Everything here is pure: it reads a model list and a set of answers, and returns rows and a verdict.
 * It computes no money and grants no authority.
 */

/** What each model actually does in the product, in the words used on screen. */
export const ROLES = Object.freeze({
  "muse-spark-1.3": "Document read, note to fields, quote explanation, condition note",
  "muse-spark-1.2": "One of the three parallel drafts on this screen",
  "muse-spark-1.1": "One of the three parallel drafts on this screen",
  "muse-wonder-1.0": "Judge: reads the drafts, picks one, and says why",
  "muse-voice-transcribe-1.0": "Driver voice notes, on the shipment screen",
  "sam-3.1": "Counting cargo in a photograph, on the shipment screen",
  "muse-image-1.0": "Drawing the load, on this screen",
});

export const POLICY_EXCLUDED = Object.freeze([
  "muse-spark-1.3-contributor",
  "muse-spark-1.2-contributor",
]);

export const isContributor = (id) => /contributor/i.test(String(id ?? ""));

/**
 * Turn the account's model list into rows the screen can draw: what each model is, and whether the
 * desk has work for it. A contributor model is marked excluded even though it is reachable.
 */
export function classifyModels(ids = []) {
  return ids.filter(Boolean).map((id) => ({
    id,
    excluded: isContributor(id),
    role: isContributor(id)
      ? "Reachable, never used: contributor models are outside the data policy"
      : ROLES[id] ?? "Reachable, no job assigned yet",
    working: !isContributor(id) && Boolean(ROLES[id]),
  }));
}

/** The three generations asked the same question at the same time. */
export const DRAFTS = Object.freeze(["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"]);

export const JUDGE = "muse-wonder-1.0";

/** A question whose answer the engine can check, so a wrong draft is visible rather than plausible. */
export function draftPrompt({ laneName, km, tonnes }) {
  return [
    "Write two sentences for a freight customer explaining what sets the price of a truck on their lane.",
    `Lane ${laneName}: ${km} km of road, a full truck carries ${tonnes} tonnes.`,
    "Use only these facts. State no rate, no fee and no total — the engine prices, you explain.",
  ].join(" ");
}

/** The judge sees the drafts blind and must answer with one number and one reason. */
export function judgePrompt(drafts) {
  const body = drafts.map((d, i) => `DRAFT ${i + 1} (${d.model}):\n${d.text || "(no words returned)"}`).join("\n\n");
  return [
    "Three drafts answer the same request for a freight customer.",
    body,
    "Pick the draft a customer could act on: accurate, plain, no invented figures.",
    "Reply exactly as: PICK n, then one short sentence saying why.",
  ].join("\n\n");
}

/** Read "PICK 2 …" out of the judge's reply. Anything unparseable is no pick at all. */
export function winnerFrom(judgeText, count = 3) {
  const m = /\bPICK\s*([1-9])\b/i.exec(String(judgeText ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n - 1 : null;
}

/** What the fan-out is worth saying about itself: who answered, how fast, who was picked. */
export function fanOutSummary(drafts = [], winner = null) {
  const answered = drafts.filter((d) => d && d.text);
  const fastest = answered.reduce((a, b) => (!a || b.ms < a.ms ? b : a), null);
  const slowest = answered.reduce((a, b) => (!a || b.ms > a.ms ? b : a), null);
  return {
    asked: drafts.length,
    answered: answered.length,
    fastestMs: fastest?.ms ?? null,
    slowestMs: slowest?.ms ?? null,
    winner: winner === null ? null : drafts[winner]?.model ?? null,
    tokens: drafts.reduce((n, d) => n + (Number(d?.tokens) || 0), 0),
  };
}
