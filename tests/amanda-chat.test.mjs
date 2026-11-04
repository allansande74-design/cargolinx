import test from "node:test";
import assert from "node:assert/strict";
import { laneFact, freightPrice, buildFacts, chat } from "../worker/amanda.mjs";

const ask = (text, extra = {}) =>
  new Request("https://desk.test/api/amanda/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": `test-${Math.random()}` },
    body: JSON.stringify({ messages: [{ role: "user", content: text }], ...extra }),
  });

test("a lane named in a question is found, with its kilometres and borders", () => {
  const lane = laneFact("Quote DDP Nairobi to Kampala, 27 tonnes of rice");
  assert.ok(lane, "lane not found");
  assert.equal(lane.from, "Nairobi");
  assert.equal(lane.to, "Kampala");
  assert.equal(lane.km, 700);
  assert.equal(lane.borders, 1);
});

test("the reverse direction answers with the same kilometres", () => {
  const back = laneFact("what does Kampala to Nairobi cost");
  assert.ok(back);
  assert.equal(back.km, 700);
});

test("one city alone is not a lane", () => {
  assert.equal(laneFact("how much to Kampala"), null);
});

test("freight is cost-plus on the lane and per-tonne when a weight is given", () => {
  const lane = laneFact("Nairobi to Kampala");
  const p = freightPrice(lane, 27000);
  assert.ok(p.priceUsd > 0);
  assert.equal(p.priceUsd % 10, 0, "price is rounded to ten dollars");
  assert.ok(p.perTonneUsd > 0);
});

test("facts carry the lane, the road-leg caveat and the DDP terms", () => {
  const facts = buildFacts("Quote me DDP Mombasa to Kampala for 20 tonnes", 20000).join(" ");
  assert.match(facts, /Mombasa to Kampala/);
  assert.match(facts, /road leg only/);
  assert.match(facts, /DDP means/);
});

test("a question with no freight content says so rather than inventing", () => {
  const facts = buildFacts("hello", null).join(" ");
  assert.match(facts, /nothing computed/);
});

test("the endpoint answers with the model's words and the computed facts", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content: "  It is 700 km, one border.  " } }] }), { status: 200 });
  try {
    const res = await chat(ask("Nairobi to Kampala, 27 tonnes", {}), { META_API_KEY: "k" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reply, "It is 700 km, one border.");
    assert.equal(body.model, "muse-spark-1.3");
    assert.ok(Array.isArray(body.facts) && body.facts.length > 0);
  } finally {
    globalThis.fetch = real;
  }
});

test("with no key the desk still answers from computed facts, and says it is degraded", async () => {
  const res = await chat(ask("Mombasa to Kigali, 12 tonnes"), {});
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.degraded, true);
  assert.match(body.reply, /Mombasa to Kigali|briefly offline/);
});

test("an empty upstream answer falls back rather than showing a blank bubble", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
  try {
    const res = await chat(ask("Nairobi to Kigali"), { META_API_KEY: "k" });
    const body = await res.json();
    assert.equal(body.degraded, true);
  } finally {
    globalThis.fetch = real;
  }
});

test("a GET is refused and a bodyless POST is refused", async () => {
  const get = await chat(new Request("https://desk.test/api/amanda/chat"), {});
  assert.equal(get.status, 405);
  const empty = await chat(
    new Request("https://desk.test/api/amanda/chat", { method: "POST", headers: { "cf-connecting-ip": "empty-1" }, body: JSON.stringify({ messages: [] }) }),
    {},
  );
  assert.equal(empty.status, 400);
});

test("the worker runs before the asset handler for the Amanda route", async () => {
  const { readFileSync } = await import("node:fs");
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /"\/api\/amanda\/\*"/, "run_worker_first must cover /api/amanda/* or the route 405s");
});
