// A condition note is read by a claims clerk and, one day, by the other side's lawyer. It may say
// what the photograph shows and nothing else. These tests hold that line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONDITION_PROMPT, conditionNote } from "../src/lib/meta.js";

const reply = (content, model = "muse-spark-1.3") =>
  new Response(JSON.stringify({ model, choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("the photograph goes inline with the shipment reference", async () => {
  let sent = null;
  globalThis.fetch = async (url, init = {}) => {
    sent = JSON.parse(init.body);
    return reply("  Twelve cartons on two pallets; the outer wrap is torn at the near corner.  ", "muse-spark-1.3");
  };
  const out = await conditionNote("data:image/jpeg;base64,AAAA", { reference: "UE-2026-11-001" });
  assert.equal(sent.messages[1].content[1].image_url.url, "data:image/jpeg;base64,AAAA");
  assert.match(sent.messages[1].content[0].text, /UE-2026-11-001/);
  assert.equal(sent.model, "muse-spark-1.3");
  assert.equal(sent.reasoning_effort, "low");
  assert.ok(sent.max_tokens >= 600, "Spark needs room to think and still answer");
  assert.equal(out.text, "Twelve cartons on two pallets; the outer wrap is torn at the near corner.");
  assert.equal(out.model, "muse-spark-1.3");
});

test("the instruction refuses cause, names and money", () => {
  const p = CONDITION_PROMPT.toLowerCase();
  assert.match(p, /claim file/);
  assert.match(p, /do not guess the cause/);
  assert.match(p, /physical inspection/);
  assert.match(p, /do not name people, companies, vehicles or number plates/);
  assert.match(p, /do not mention price, cost, freight rates, margin or profit/);
  assert.ok(!/mention the margin|state the margin/.test(p));
});

test("a blank answer comes back as a blank, not as invented damage", async () => {
  globalThis.fetch = async () => reply("", "muse-spark-1.3");
  const out = await conditionNote("data:image/jpeg;base64,AAAA");
  assert.equal(out.text, "");
});
