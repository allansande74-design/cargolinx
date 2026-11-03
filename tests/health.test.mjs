import test from "node:test";
import assert from "node:assert/strict";
import { health, report } from "../worker/health.mjs";

const json = async (res) => JSON.parse(await res.text());

test("health says it is alive and whether the key is present, never what it is", async () => {
  const withKey = await json(health({ META_API_KEY: "sk-live-do-not-print-0123456789abcd" }));
  assert.equal(withKey.status, "ok");
  assert.equal(withKey.models, "configured");
  const text = JSON.stringify(withKey);
  assert.ok(!text.includes("sk-live"), "the credential must never appear in the answer");

  const again = await json(health({}));
  assert.ok(Number.isFinite(again.servingSeconds), "the uptime must be a number, not fifty-six years");
  assert.ok(again.servingSeconds >= 0 && again.servingSeconds < 86_400, `implausible serving time ${again.servingSeconds}`);

  const without = await json(health({}));
  assert.equal(without.models, "missing");
  assert.equal(without.routes.meta, "/api/meta");
});

test("health is not cached by anything in the middle", () => {
  assert.equal(health({}).headers.get("cache-control"), "no-store");
});

function beacon(body, ip = "203.0.113.9") {
  return new Request("https://desk.example/api/errors", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

test("an error report is accepted and answered with nothing", async () => {
  const res = await report(beacon({ message: "boom", where: "desk:error", path: "/desk/new?token=secret" }), {});
  assert.equal(res.status, 204);
  assert.equal(await res.text(), "");
});

test("a report keeps the path but drops its query string", async () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await report(beacon({ message: "x", path: "/desk/new?email=someone%40example.com" }), {});
  } finally {
    console.error = original;
  }
  const written = lines.join(" ");
  assert.match(written, /\/desk\/new/);
  assert.ok(!written.includes("example.com"), "a query string can carry personal data");
});

test("rubbish is refused, and an oversized body is refused before it is read", async () => {
  const rubbish = new Request("https://desk.example/api/errors", { method: "POST", body: "not json" });
  assert.equal((await report(rubbish, {})).status, 400);

  const big = new Request("https://desk.example/api/errors", {
    method: "POST",
    headers: { "content-length": "9000" },
    body: "{}",
  });
  assert.equal((await report(big, {})).status, 413);
});

test("one caller cannot flood the log", async () => {
  let last = 0;
  for (let i = 0; i < 40; i += 1) {
    last = (await report(beacon({ message: `n${i}` }, "198.51.100.7"), {})).status;
  }
  assert.equal(last, 429);
});
