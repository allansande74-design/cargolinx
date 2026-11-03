// The proxy is the only thing standing between a public desk and a bill with no ceiling, so its
// guards are tested rather than assumed: the credential never reaches the browser, only our models
// pass, the token cap holds, and a flood of calls from one address stops.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, __testing } from "../worker/meta-proxy.mjs";

const KEY = "LLM_test_key_value_that_must_never_leak";
const env = { META_API_KEY: KEY };

function capture() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

const post = (path, body, headers = { "content-type": "application/json", "cf-connecting-ip": "10.0.0.1" }) =>
  new Request(`https://desk.example/api/meta${path}`, { method: "POST", body, headers });

test("without a configured credential the desk is told plainly", async () => {
  const res = await handle(post("/chat/completions", "{}"), {});
  assert.equal(res.status, 503);
  assert.match(await res.text(), /no model credential/);
});

test("the key stays server-side and the upstream call is the real one", async () => {
  const calls = capture();
  const res = await handle(post("/chat/completions", JSON.stringify({ model: "muse-spark-1.3", messages: [] })), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!res.headers.get("authorization"), "the response must not carry a credential");
});

test("contributor models are refused by policy", async () => {
  capture();
  const res = await handle(post("/chat/completions", JSON.stringify({ model: "muse-spark-1.3-contributor" })), env);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /not allowed/);
});

test("the token cap is applied rather than trusted", async () => {
  const calls = capture();
  await handle(post("/chat/completions", JSON.stringify({ model: "muse-spark-1.3", max_tokens: 99999 })), env);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.max_tokens, __testing.MAX_TOKENS);
});

test("a route that is not a model route is not forwarded", async () => {
  const calls = capture();
  const res = await handle(post("/models/../../secrets", "{}"), env);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test("one address flooding the desk is stopped", async () => {
  capture();
  const ip = "10.9.9.9";
  let last;
  for (let i = 0; i < __testing.LIMIT.max + 2; i += 1) {
    last = await handle(
      new Request("https://desk.example/api/meta/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "muse-spark-1.3" }),
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      }),
      env,
    );
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});

test("audio passes through as a form, with its model checked", async () => {
  const calls = capture();
  const form = new FormData();
  form.append("request", JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" }));
  form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "note.wav");
  const req = new Request("https://desk.example/api/meta/asr/transcribe", {
    method: "POST",
    body: form,
    headers: { "cf-connecting-ip": "10.0.0.2" },
  });
  const res = await handle(req, env);
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/asr/transcribe");
});

test("an audio form naming a model we do not own is refused", async () => {
  const calls = capture();
  const form = new FormData();
  form.append("request", JSON.stringify({ model: "someone-elses-model" }));
  form.append("audio", new Blob([new Uint8Array([1])]), "note.wav");
  const res = await handle(
    new Request("https://desk.example/api/meta/asr/transcribe", { method: "POST", body: form, headers: { "cf-connecting-ip": "10.0.0.3" } }),
    env,
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("the three Spark generations are allowed, and a contributor model is still refused", async () => {
  for (const id of ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"]) {
    assert.equal(__testing.ALLOWED.has(id), true, `${id} must be allowed: the fan-out asks all three`);
  }
  assert.equal(__testing.ALLOWED.has("muse-spark-1.3-contributor"), false);
  assert.equal(__testing.ALLOWED.has("muse-spark-1.2-contributor"), false);
});
