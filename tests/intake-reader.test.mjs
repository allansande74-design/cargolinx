/**
 * The intake reader: what the model says, what the schema keeps, and what happens when the model
 * is wrong, slow or absent. No network in these tests — the caller is a double.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { readIntake, validateIntake, extractJson, buildPrompt, deterministicRead, FORBIDDEN_FIELDS } from "../engine/intake-reader.mjs";

const MESSAGE = "Habari, I need 5 solar water pumps delivered to Kisumu, DDP please, before 20th November";

test("a good reading survives the schema and is marked usable", async () => {
  const r = await readIntake(MESSAGE, {
    model: "muse-spark-1.3",
    call: async () => JSON.stringify({ product: "solar water pumps", qty: 5, destinationCity: "Kisumu", incoterm: "DDP", neededBy: "2027-11-20" }),
  });
  assert.equal(r.source, "model");
  assert.equal(r.usable, true);
  assert.equal(r.draft.qty, 5);
  assert.equal(r.draft.incoterm, "DDP");
  assert.equal(r.draft.neededBy, "2027-11-20");
  assert.equal(r.errors.length, 0);
});

test("the model is never allowed to set money", async () => {
  const r = await readIntake(MESSAGE, {
    model: "muse-spark-1.3",
    call: async () => JSON.stringify({ product: "pumps", qty: 5, price: 120000, unitPrice: 24000, margin: 0.3, currency: "KES" }),
  });
  assert.equal(r.draft.price, undefined);
  assert.equal(r.draft.unitPrice, undefined);
  assert.equal(r.draft.margin, undefined);
  assert.equal(r.draft.currency, undefined);
  for (const f of FORBIDDEN_FIELDS) assert.ok(!(f in r.draft), `${f} leaked into the draft`);
  assert.equal(r.dropped.length, 4);
  assert.ok(r.dropped.every((d) => d.includes("money is not the model's to set") || d.includes("unknown field")));
});

test("a wrong incoterm is refused and the sentence fills the gap", async () => {
  const r = await readIntake(MESSAGE, {
    call: async () => JSON.stringify({ product: "pumps", qty: 5, incoterm: "FOB NAIROBI" }),
  });
  assert.equal(r.source, "merged");
  assert.equal(r.draft.incoterm, "DDP", "the message says DDP and the deterministic read must win");
  assert.ok(r.errors.some((e) => e.includes("incoterm")));
});

test("a slow model falls back without hanging the desk", async () => {
  const r = await readIntake(MESSAGE, {
    timeoutMs: 40,
    call: () => new Promise((res) => setTimeout(() => res("{}"), 400)),
  });
  assert.equal(r.source, "merged");
  assert.equal(r.usable, true);
  assert.equal(r.draft.qty, 5);
  assert.equal(r.draft.destinationCity, "Kisumu");
  assert.ok(r.ms < 1000);
  assert.ok(r.errors.join(" ").includes("timeout"));
});

test("no model at all still answers", async () => {
  const r = await readIntake(MESSAGE, {});
  assert.equal(r.source, "deterministic");
  assert.equal(r.usable, true);
  assert.equal(r.draft.qty, 5);
  assert.equal(r.draft.incoterm, "DDP");
});

test("JSON wrapped in prose or a code fence is still read", async () => {
  const fenced = 'Here you go:\n```json\n{"product":"pumps","qty":5}\n```\nThanks';
  assert.deepEqual(extractJson(fenced), { product: "pumps", qty: 5 });
  const prose = 'Sure. {"product":"pumps","qty":3} That is all.';
  assert.deepEqual(extractJson(prose), { product: "pumps", qty: 3 });
  assert.equal(extractJson("no json here"), null);
});

test("a message with nothing countable is reported as unusable, not guessed at", async () => {
  const r = await readIntake("Hello, please send me a catalogue", { call: async () => "not json" });
  assert.equal(r.usable, false);
  assert.equal(r.draft.product, null);
});

test("the prompt forbids pricing and names every allowed incoterm", () => {
  const p = buildPrompt("x");
  assert.match(p, /Never include a price/);
  for (const t of ["EXW", "FOB", "CIF", "DDP"]) assert.ok(p.includes(t), `${t} missing from prompt`);
});

test("validation rejects nonsense rather than passing it through", () => {
  const v = validateIntake({ product: "pumps", qty: -2, incoterm: "XYZ", neededBy: "sometime" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("qty below")));
  assert.ok(v.errors.some((e) => e.includes("incoterm")));
  assert.ok(v.errors.some((e) => e.includes("neededBy")));
});

test("the deterministic read finds quantity, city, term and date", () => {
  const d = deterministicRead(MESSAGE);
  assert.equal(d.qty, 5);
  assert.equal(d.destinationCity, "Kisumu");
  assert.equal(d.incoterm, "DDP");
  assert.match(String(d.neededBy), /^20\d\d-11-20$/);
});
