// The desk announces "Models live" on its own word, so the probe has to be hard to fool: a static
// host answers an unknown path with the app page and a 200, which used to read as a live route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { probe, withReasoningEffort, readCargoPhoto, explainQuote } from "../src/lib/meta.js";

const answer = (body, type = "application/json", status = 200) => {
  globalThis.fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": type },
  });
};

test("a page where a model list should be is not a live desk", async () => {
  answer("<!doctype html><html><body>app</body></html>", "text/html");
  const out = await probe();
  assert.equal(out.live, false);
  assert.match(out.reason, /answered with a page/);
});

test("an empty model list is not a live desk", async () => {
  answer({ object: "list", data: [] });
  const out = await probe();
  assert.equal(out.live, false);
  assert.match(out.reason, /no models/);
});

test("our own model list is a live desk", async () => {
  answer({ object: "list", data: [{ id: "muse-spark-1.3" }, { id: "sam-3.1" }] });
  const out = await probe();
  assert.equal(out.live, true);
  assert.equal(out.viaBridge, false);
});

test("a router list without Spark is still live, and says it is bridged", async () => {
  answer({ object: "list", data: [{ id: "amanda-primary" }] });
  const out = await probe();
  assert.equal(out.live, true);
  assert.equal(out.viaBridge, true);
});

test("a refused call is reported as off, with the status", async () => {
  answer({ error: "no" }, "application/json", 401);
  const out = await probe();
  assert.equal(out.live, false);
  assert.match(out.reason, /401/);
});

test("Spark is asked to reason lightly so it has room to answer", () => {
  const out = withReasoningEffort({ model: "muse-spark-1.3", messages: [] });
  assert.equal(out.reasoning_effort, "low");
  assert.deepEqual(out.messages, []);
});

test("an effort chosen by the caller is left alone", () => {
  const out = withReasoningEffort({ model: "muse-spark-1.3", reasoning_effort: "high" });
  assert.equal(out.reasoning_effort, "high");
});

test("no other model is given an effort it may not understand", () => {
  for (const model of ["sam-3.1", "muse-wonder-1.0", "muse-image-1.0"]) {
    assert.equal(withReasoningEffort({ model }).reasoning_effort, undefined);
  }
});

test("a picked photo is sent inline, because a temporary browser address is refused", async () => {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push(String(url));
    if (String(url).startsWith("blob:")) {
      return new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    const body = JSON.parse(init.body);
    const imageUrl = body.input[0].content[1].image_url;
    assert.match(imageUrl, /^data:image\/jpeg;base64,/);
    assert.equal(body.input[0].content[0].text, "pallet");
    return new Response('data: {"type":"response.output_text.delta","delta":"<|box;x1=1;y1=2;x2=3;y2=4;"}\n', {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
  };
  const out = await readCargoPhoto("blob:https://desk.example/123", "pallet");
  assert.equal(seen.length, 2);
  assert.equal(out.totalCount, 1);
  assert.equal(out.concept, "pallet");
});

test("the client explanation never names a margin", async () => {
  let sent = null;
  globalThis.fetch = async (url, init = {}) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content: "ok" } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  await explainQuote({ landedCost: 1, price: 2 }, "test");
  const system = sent.messages[0].content.toLowerCase();
  assert.ok(!/mention the margin|and the margin/.test(system));
  assert.match(system, /never state or hint at a margin/);
  assert.equal(sent.reasoning_effort, "low");
});
