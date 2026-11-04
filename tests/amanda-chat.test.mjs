import test from "node:test";
import assert from "node:assert/strict";
import { laneFact, freightPrice, buildFacts, chat, pathBetween } from "../worker/amanda.mjs";

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

// ---------------------------------------------------------------------------- voice and pictures

const ENV = { META_API_KEY: "test-key" };

function stubFetch(handlers) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [match, reply] of handlers) {
      if (String(url).includes(match)) return reply();
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const json = (body) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("a voice note is transcribed before the model is asked, and the transcript comes back", async () => {
  const stub = stubFetch([
    ["/asr/transcribe", json({ transcript: "How long does Mombasa to Kigali take?" })],
    ["/chat/completions", json({ choices: [{ message: { content: "Kigali is 1,194 km from Nairobi, about 31 hours by road." } }] })],
  ]);
  try {
    const res = await chat(
      ask("", { messages: [], audio: `data:audio/wav;base64,${Buffer.from("RIFF0000WAVE").toString("base64")}` }),
      ENV,
    );
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.transcript, "How long does Mombasa to Kigali take?");
    assert.equal(out.heard, "voice");
    assert.match(out.reply, /Kigali/);
    assert.ok(stub.calls[0].url.includes("/asr/transcribe"), "speech is asked before the chat model");
    assert.ok(stub.calls[1].url.includes("/chat/completions"));
    const sent = JSON.parse(stub.calls[1].init.body);
    assert.ok(sent.messages.some((m) => m.content.includes("Kigali")), "the transcript became the question");
  } finally {
    stub.restore();
  }
});

test("a photograph reaches the model as an image part", async () => {
  const stub = stubFetch([
    ["/chat/completions", json({ choices: [{ message: { content: "That is a forty-foot container, loaded." } }] })],
  ]);
  try {
    const png = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a").toString("base64")}`;
    const res = await chat(ask("What is this?", { messages: [{ role: "user", content: "What is this?" }], image: png }), ENV);
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.heard, "photo");
    const sent = JSON.parse(stub.calls[0].init.body);
    const user = sent.messages.filter((m) => m.role === "user").pop();
    assert.ok(Array.isArray(user.content), "the user turn carries parts, not a bare string");
    assert.ok(user.content.some((p) => p.type === "image_url"), "the picture is attached");
  } finally {
    stub.restore();
  }
});

test("something that is not audio is refused with a straight answer, not a guess", async () => {
  const res = await chat(ask("", { messages: [], audio: "not-a-recording" }), ENV);
  const out = await res.json();
  assert.equal(res.status, 422);
  assert.match(out.error, /audio/i);
});

// ---------------------------------------------------------------------------- composed lanes

test("a corridor the lane table does not name is composed from its measured legs, not refused", () => {
  const lane = laneFact("How long does Mombasa to Kigali take for 20 tonnes?");
  assert.ok(lane, "Mombasa to Kigali should resolve over the engine's own legs");
  assert.equal(lane.from, "Mombasa");
  assert.equal(lane.to, "Kigali");
  assert.ok(lane.km > 1600 && lane.km < 1800, `expected about 1,695 km, got ${lane.km}`);
  assert.equal(lane.borders, 2);
  assert.ok(lane.via.includes("Kampala"), "the route is stated as passing Kampala");
});

test("the lane is answered in the direction the client asked", () => {
  const back = laneFact("Kampala to Nairobi, 27 tonnes");
  assert.equal(back.from, "Kampala");
  assert.equal(back.to, "Nairobi");
  assert.equal(back.km, 700);
});
