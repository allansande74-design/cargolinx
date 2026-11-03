// The document button used to call a route Meta does not serve. These tests hold the replacement:
// text lifted in the browser, the file never uploaded, and a field left null rather than guessed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readDocument, isReadableDocument, DOC_PROMPT } from "../src/lib/meta.js";
import { fileText, suffixOf } from "../src/lib/doctext.mjs";

const reply = (content) =>
  new Response(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const rateCard = () =>
  new File(
    ["Lane,Rate per cbm\nMombasa - Kampala,145\nValidity: 30 days\n"],
    "rate-card.csv",
    { type: "text/csv" },
  );

test("a text document is read locally, and only its words are sent", async () => {
  let sent = null;
  globalThis.fetch = async (url, init = {}) => {
    sent = JSON.parse(init.body);
    return reply(JSON.stringify({ cargo: null, quantity: null, weightKg: null, origin: "Mombasa", destination: "Kampala", hs: null, value: 145, currency: "USD", comments: "Validity: 30 days" }));
  };
  const out = await readDocument(rateCard());
  const userText = sent.messages[1].content;
  assert.match(userText, /Mombasa - Kampala,145/);
  assert.ok(!/data_b64/.test(JSON.stringify(sent)), "the file itself is not uploaded");
  assert.equal(out.fields.origin, "Mombasa");
  assert.equal(out.fields.currency, "USD");
  assert.equal(out.servedBy, "muse-spark-1.3");
  assert.ok(sent.max_tokens >= 1000);
});

test("a fenced answer is still read", async () => {
  globalThis.fetch = async () => reply('```json\n{"cargo":"solar panels","quantity":12}\n```');
  const out = await readDocument(rateCard());
  assert.equal(out.fields.cargo, "solar panels");
});

test("prose instead of JSON is an error, not a field set", async () => {
  globalThis.fetch = async () => reply("I could read the document and it says Mombasa to Kampala.");
  await assert.rejects(() => readDocument(rateCard()), /readable field set/);
});

test("a file type this build cannot read says which one, and what to do", async () => {
  const docx = new File(["binary"], "quotation.docx", { type: "application/octet-stream" });
  await assert.rejects(() => fileText(docx), /\.docx files are not read in this build/);
  assert.equal(suffixOf("a/b/quotation.docx"), ".docx");
  assert.equal(isReadableDocument("rate-card.pdf"), true);
  assert.equal(isReadableDocument("quotation.docx"), false);
});

test("the instruction forbids estimating anything the paper does not state", () => {
  assert.match(DOC_PROMPT, /Never estimate/);
  assert.match(DOC_PROMPT, /use null/);
  assert.match(DOC_PROMPT, /copied, not summarised/);
});
