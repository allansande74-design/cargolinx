// The desk announces "Models live" on its own word, so the probe has to be hard to fool: a static
// host answers an unknown path with the app page and a 200, which used to read as a live route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { probe, withReasoningEffort, readCargoPhoto, explainQuote, conceptsFrom, conditionNote } from "../src/lib/meta.js";

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

test("a phrase is tried, then its own word, then a plain pallet", () => {
  assert.deepEqual(conceptsFrom("dry cartons"), ["dry cartons", "carton", "pallet"]);
  assert.deepEqual(conceptsFrom("20 ft container, solar panels"), ["20 ft container,", "container", "pallet"]);
  assert.deepEqual(conceptsFrom(""), ["carton", "pallet", "box"]);
});

test("a blank first answer falls through to the next concept", async () => {
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("blob:")) {
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    const concept = JSON.parse(init.body).input[0].content[0].text;
    asked.push(concept);
    const delta = concept === "dry cartons" ? "" : "<|box;x1=1;y1=2;x2=3;y2=4;";
    return new Response(`data: {"type":"response.output_text.delta","delta":${JSON.stringify(delta)}}\n`, {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
  };
  const out = await readCargoPhoto("blob:https://desk.example/9", "dry cartons");
  assert.deepEqual(asked, ["dry cartons", "carton"]);
  assert.equal(out.totalCount, 1);
  assert.equal(out.concept, "carton");
  assert.match(out.notes, /asked for "dry cartons" first/);
});

test("Spark is never given a budget too small to answer in", async () => {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push(JSON.parse(init.body).max_tokens);
    return new Response(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content: "answered" } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  await conditionNote("data:image/jpeg;base64,AAAA");
  assert.ok(seen[0] >= 1000, `asked for ${seen[0]} tokens`);
  assert.equal(seen.length, 1, "a real answer is not retried");
});

test("a wordless reply is asked again with room to think, and the second answer is used", async () => {
  let n = 0;
  const budgets = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    budgets.push(body.max_tokens);
    n += 1;
    const content = n === 1 ? "" : "Second time, with words.";
    return new Response(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: n === 1 ? "length" : "stop" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  const out = await conditionNote("data:image/jpeg;base64,AAAA");
  assert.equal(out.text, "Second time, with words.");
  assert.deepEqual(budgets, [1000, 1600]);
});

test("a blank twice is reported blank rather than pretended", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content: "" } }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  const out = await conditionNote("data:image/jpeg;base64,AAAA");
  assert.equal(out.text, "");
});
