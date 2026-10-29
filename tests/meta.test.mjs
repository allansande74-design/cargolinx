/**
 * Meta layer tests. A local stub stands in for the Meta Model API so the wire, the validation and
 * the evidence trail are exercised for real — no key, no network, no invented response.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMetaClient, redact } from "../engine/meta/client.mjs";
import { explainLane, structureDriverNote, countCargo, jsonIn, textOf } from "../engine/meta/tasks.mjs";

const KEY = "test-key-not-a-real-secret-0001";

/** Boot a stub that answers with `reply` (a string body) at the given status. */
async function stub(status = 200, reply = "{}", headers = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
      res.writeHead(status, { "content-type": "application/json", "x-request-id": "req_stub_1", ...headers });
      res.end(typeof reply === "string" ? reply : JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, close: () => new Promise((r) => server.close(r)) };
}

const modelEnv = {
  META_API_KEY: KEY,
  META_MODEL_LANE: "muse-spark-1.3",
  META_MODEL_VOICE: "muse-voice-transcribe-1.0",
  META_MODEL_VISION: "sam-3.1",
};

function withEnv(extra = {}) {
  Object.assign(process.env, modelEnv, extra);
}

test("an unconfigured client refuses instead of calling something plausible", async () => {
  const saved = { ...process.env };
  for (const k of Object.keys(modelEnv)) delete process.env[k];
  const client = createMetaClient({ apiKey: "", baseUrl: "", fetchImpl: async () => { throw new Error("must not call"); } });
  const out = await explainLane(client, { weightKg: 900, corridor: "northern", candidates: [{ key: "nairobi_last_mile", rankHours: 6 }] });
  assert.equal(out.source, "deterministic");
  assert.equal(out.lane, "nairobi_last_mile");
  assert.equal(out.modelEntry.code, "no_model_configured");
  assert.match(out.modelEntry.reason, /META_API_KEY is not set/);
  Object.assign(process.env, saved);
});

test("lane reasoning accepts a valid answer and records evidence", async () => {
  withEnv();
  const s = await stub(200, { output_text: '{"lane":"northern","reason":"Northern is the only lane taking 20 tonnes on this corridor.","confidence":0.82}' });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base, fetchImpl: fetch });
    const out = await explainLane(client, {
      weightKg: 20000,
      corridor: "northern",
      candidates: [{ key: "northern", rankHours: 48 }, { key: "central", rankHours: 72 }],
    });
    assert.equal(out.source, "model");
    assert.equal(out.lane, "northern");
    assert.equal(out.confidence, 0.82);
    const ev = client.evidence().at(-1);
    assert.equal(ev.model, "muse-spark-1.3");
    assert.equal(ev.latencyMs >= 0, true);
    assert.equal(ev.requestId, "req_stub_1");
    assert.equal(s.seen[0].auth, `Bearer ${KEY}`);
    assert.match(s.seen[0].url, /\/v1\/responses$/);
  } finally { await s.close(); }
});

test("a lane the desk did not offer is refused, and the fallback carries the refusal", async () => {
  withEnv();
  const s = await stub(200, { output_text: '{"lane":"lake_tanganyika_barge","reason":"Cheaper by water.","confidence":0.9}' });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base });
    const out = await explainLane(client, { weightKg: 900, corridor: "northern", candidates: [{ key: "nairobi_last_mile", rankHours: 6 }] });
    assert.equal(out.source, "deterministic");
    assert.equal(out.modelEntry.code, "bad_response");
    assert.match(out.modelEntry.reason, /was not offered/);
  } finally { await s.close(); }
});

test("a driver note maps to a closed milestone only", async () => {
  withEnv();
  const s = await stub(200, { output_text: "```json\n{\"milestone\":\"gate_in\",\"detail\":\"Nimeingia gate saa tatu\"}\n```" });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base });
    const out = await structureDriverNote(client, { transcript: "Nimeingia gate saa tatu asubuhi" });
    assert.equal(out.source, "model");
    assert.equal(out.milestone, "gate_in");
    assert.equal(out.held, false);
  } finally { await s.close(); }
});

test("a milestone outside the system is refused and the note is held", async () => {
  withEnv();
  const s = await stub(200, { output_text: '{"milestone":"in_the_air","detail":"drone launched"}' });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base });
    const out = await structureDriverNote(client, { transcript: "Drone launched" });
    assert.equal(out.source, "deterministic");
    assert.equal(out.modelEntry.code, "bad_response");
  } finally { await s.close(); }
});

test("without a model the keyword path still reads a plain note, and says so", async () => {
  const saved = { ...process.env };
  for (const k of Object.keys(modelEnv)) delete process.env[k];
  const client = createMetaClient({ apiKey: "", baseUrl: "" });
  const out = await structureDriverNote(client, { transcript: "Mizigo imepakiwa, tunaondoka sasa" });
  assert.equal(out.source, "deterministic");
  assert.equal(out.milestone, "loaded");
  assert.match(out.note, /No model was called/);
  Object.assign(process.env, saved);
});

test("a cargo count below the confidence line is held for the clerk", async () => {
  withEnv();
  const s = await stub(200, { output_text: '{"count":47,"confidence":0.61,"uncertain":["back row occluded"]}' });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base });
    const out = await countCargo(client, { imageUrl: "https://example.test/intake/1.jpg", expected: 48 });
    assert.equal(out.ok, true);
    assert.equal(out.accepted, false);
    assert.equal(out.needsReview, true);
    assert.match(out.reason, /held for the clerk/);
  } finally { await s.close(); }
});

test("no count is invented without a model", async () => {
  const saved = { ...process.env };
  for (const k of Object.keys(modelEnv)) delete process.env[k];
  const client = createMetaClient({ apiKey: "", baseUrl: "" });
  const out = await countCargo(client, { imageUrl: "https://example.test/intake/1.jpg" });
  assert.equal(out.ok, false);
  assert.equal(out.count, null);
  assert.match(out.reason, /customs declaration/);
  Object.assign(process.env, saved);
});

test("an endpoint that answers 500 is an http_error, not a result", async () => {
  withEnv();
  const s = await stub(500, { error: "upstream" });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base });
    const out = await explainLane(client, { weightKg: 900, corridor: "northern", candidates: [{ key: "nairobi_last_mile", rankHours: 6 }] });
    assert.equal(out.modelEntry.code, "http_error");
    assert.equal(out.modelEntry.status, 500);
  } finally { await s.close(); }
});

test("a slow endpoint times out and the caller falls back", async () => {
  withEnv();
  const s = await stub(200, { output_text: "{}" });
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base, timeoutMs: 25 });
    const slowFetch = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted"); err.name = "AbortError"; reject(err);
      });
    });
    const c2 = createMetaClient({ apiKey: KEY, baseUrl: s.base, timeoutMs: 25, fetchImpl: slowFetch });
    const out = await explainLane(c2, { weightKg: 900, corridor: "northern", candidates: [{ key: "nairobi_last_mile", rankHours: 6 }] });
    assert.equal(out.modelEntry.code, "timeout");
    assert.equal(out.source, "deterministic");
    void client;
  } finally { await s.close(); }
});

test("the key never appears in the evidence trail or an error string", async () => {
  withEnv();
  const s = await stub(401, "unauthorised");
  try {
    const client = createMetaClient({ apiKey: KEY, baseUrl: s.base });
    const out = await explainLane(client, { weightKg: 900, corridor: "northern", candidates: [{ key: "nairobi_last_mile", rankHours: 6 }] });
    assert.equal(out.modelEntry.code, "unauthorised");
    const trail = JSON.stringify(client.evidence());
    assert.equal(trail.includes(KEY), false);
    assert.equal(redact(`boom ${KEY}`), "boom [redacted]");
  } finally { await s.close(); }
});

test("jsonIn and textOf refuse shapes they cannot verify", () => {
  assert.throws(() => jsonIn("no object here"), /no JSON object/);
  assert.throws(() => textOf({ nothing: true }), /no text found/);
  assert.deepEqual(jsonIn('prose {"a":1} more'), { a: 1 });
  assert.equal(textOf({ choices: [{ message: { content: "hi" } }] }), "hi");
});
