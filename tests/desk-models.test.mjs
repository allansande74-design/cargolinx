// The desk announces "Models live" on its own word, so the probe has to be hard to fool: a static
// host answers an unknown path with the app page and a 200, which used to read as a live route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { probe } from "../src/lib/meta.js";

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
