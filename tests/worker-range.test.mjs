import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker/index.js";
import { parseRange, isMediaPath } from "../worker/byte-range.mjs";

const TOTAL = 1000;

test("parseRange: explicit span", () => {
  assert.deepEqual(parseRange("bytes=0-1023", TOTAL), { start: 0, end: 999 });
  assert.deepEqual(parseRange("bytes=100-199", TOTAL), { start: 100, end: 199 });
});

test("parseRange: open-ended and suffix forms", () => {
  assert.deepEqual(parseRange("bytes=400-", TOTAL), { start: 400, end: 999 });
  assert.deepEqual(parseRange("bytes=-500", TOTAL), { start: 500, end: 999 });
  assert.deepEqual(parseRange("bytes=-5000", TOTAL), { start: 0, end: 999 });
});

test("parseRange: unsatisfiable", () => {
  assert.equal(parseRange("bytes=1000-", TOTAL), "unsatisfiable");
  assert.equal(parseRange("bytes=2500-2600", TOTAL), "unsatisfiable");
  assert.equal(parseRange("bytes=500-100", TOTAL), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", TOTAL), "unsatisfiable");
});

test("parseRange: header we cannot honour means the whole file", () => {
  assert.equal(parseRange(null, TOTAL), null);
  assert.equal(parseRange("", TOTAL), null);
  assert.equal(parseRange("items=0-10", TOTAL), null);
  assert.equal(parseRange("bytes=abc-def", TOTAL), null);
  assert.equal(parseRange("bytes=0-10", 0), null);
});

test("isMediaPath only claims the media files", () => {
  assert.equal(isMediaPath("/demo/cargolinx-demo-entry-153s.mp4"), true);
  assert.equal(isMediaPath("/demo/film.WEBM"), true);
  assert.equal(isMediaPath("/demo/index.html"), false);
  assert.equal(isMediaPath("/assets/index-abc.js"), false);
});

function assetEnv(total) {
  const bytes = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) bytes[i] = i % 251;
  const calls = [];
  return {
    calls,
    env: {
      ASSETS: {
        async fetch(request) {
          calls.push(new URL(request.url).pathname);
          return new Response(bytes, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": String(total) },
          });
        },
      },
    },
  };
}

test("worker: a Range request is answered 206 with a real slice", async () => {
  const { env } = assetEnv(2048);
  const req = new Request("https://example.test/demo/film.mp4", {
    headers: { Range: "bytes=100-199" },
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 100-199/2048");
  assert.equal(res.headers.get("content-length"), "100");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  const body = new Uint8Array(await res.arrayBuffer());
  assert.equal(body.byteLength, 100);
  assert.equal(body[0], 100 % 251);
  assert.equal(body[99], 199 % 251);
});

test("worker: no Range means the whole file with accept-ranges advertised", async () => {
  const { env } = assetEnv(2048);
  const res = await worker.fetch(new Request("https://example.test/demo/film.mp4"), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-length"), "2048");
});

test("worker: a range past the end is refused with 416", async () => {
  const { env } = assetEnv(2048);
  const req = new Request("https://example.test/demo/film.mp4", {
    headers: { Range: "bytes=5000-6000" },
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), "bytes */2048");
});

test("worker: pages and bundles are left to the asset router", async () => {
  const { env, calls } = assetEnv(64);
  for (const path of ["/", "/assets/index-abc.js", "/demo/"]) {
    const res = await worker.fetch(new Request(`https://example.test${path}`), env);
    assert.equal(res.status, 200);
  }
  assert.deepEqual(calls, ["/", "/assets/index-abc.js", "/demo/"]);
});
