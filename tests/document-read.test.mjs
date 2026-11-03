// The document read is the desk's oldest model call and the one that broke in silence on the live
// build: Spark spent its whole allowance reasoning and returned finish_reason "length" with no words,
// so a rate card uploaded on the site produced "the model did not return a readable field set".
// These tests hold the measured fix in place — reason lightly first, and retry once if the answer is
// empty — without needing a model to be up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readDocument } from "../src/lib/meta.js";

const RATE_CARD = `ALTISEA LINE - EAST AFRICA RATE CARD
Effective 1 November 2026. All rates per cbm, port to port.
Mombasa - Kampala 145.00 USD per cbm, 9 days
Mombasa - Nairobi 95.00 USD per cbm, 3 days
Quote reference: AST/EA/2026/1101`;

const file = (name = "rate-card.txt") => ({
  name,
  text: async () => RATE_CARD,
  arrayBuffer: async () => new TextEncoder().encode(RATE_CARD).buffer,
});

/** A fetch that answers each call in turn and remembers what was asked. */
function scripted(answers) {
  const seen = [];
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    seen.push({ url: String(url), body });
    const next = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  };
  return seen;
}

const said = (content, finish = "stop") => ({
  model: "muse-spark-1.3",
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { total_tokens: 500 },
});

test("the document read asks the model to reason lightly, which is the only setting that answers", async () => {
  const seen = scripted([said('{"currency":"USD","comments":"Quote reference: AST/EA/2026/1101."}')]);
  const out = await readDocument(file());
  assert.equal(seen.length, 1, "one call is enough when the model answers");
  assert.equal(seen[0].body.reasoning_effort, "minimal");
  assert.equal(seen[0].body.max_tokens, 1000);
  assert.equal(out.fields.currency, "USD");
});

test("a wordless answer is retried at a raised ceiling, not reported as an unreadable document", async () => {
  const seen = scripted([
    said("", "length"), // what the live build returned before this fix
    said('{"cargo":"solar panels","quantity":"20","weightKg":"4800"}'),
  ]);
  const out = await readDocument(file());
  assert.equal(seen.length, 2, "an empty answer must be asked again");
  assert.ok(seen[1].body.max_tokens > seen[0].body.max_tokens, "the retry gives the model more room");
  assert.equal(seen[1].body.reasoning_effort, "minimal", "and keeps the instruction that makes it answer");
  assert.equal(out.fields.cargo, "solar panels");
  assert.equal(out.fields.weightKg, "4800");
});

test("a scan with no text says so instead of asking a model to guess", async () => {
  const seen = scripted([said("{}")]);
  const blank = { name: "scan.txt", text: async () => "   " };
  await assert.rejects(() => readDocument(blank), /no text layer/);
  assert.equal(seen.length, 0, "no model call is made for a document with no words");
});
