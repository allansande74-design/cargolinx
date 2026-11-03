import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Cloudflare answers a static asset before it ever calls the Worker. A route that lives in the
// Worker but is not listed here returns index.html with a 200 instead of JSON - a health check that
// always says "fine" is worse than no health check, and this test exists because that happened.
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

function workerFirstPaths() {
  const match = config.match(/"run_worker_first"\s*:\s*\[([^\]]*)\]/);
  assert.ok(match, "wrangler.jsonc must declare run_worker_first");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("every API route in the Worker reaches the Worker first", () => {
  const paths = workerFirstPaths();
  for (const route of ["/api/health", "/api/errors", "/api/meta", "/api/meta/*"]) {
    assert.ok(paths.includes(route), `${route} is served by the Worker but is not listed in run_worker_first`);
  }
});

test("media still runs through the Worker so a range request gets a 206", () => {
  assert.ok(workerFirstPaths().includes("/demo/*"));
});
