// A first visit should not be an empty desk. These tests hold the seed honest: sample data that says
// so, no client, no price, and every job on a lane that actually exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_JOBS } from "../src/lib/db.js";
import { laneBetween } from "../engine/lanes.mjs";

test("three demonstration jobs, each with a reference and a cargo", () => {
  assert.equal(DEMO_JOBS.length, 3);
  for (const job of DEMO_JOBS) {
    assert.match(job.ref, /^CLX-DEMO-\d{4}$/);
    assert.ok(job.cargo.length > 5);
    assert.ok(job.weightKg > 0);
    assert.ok(job.qty > 0);
  }
});

test("every demonstration job runs on a lane the desk can price", () => {
  for (const job of DEMO_JOBS) {
    assert.ok(laneBetween(job.origin, job.destination), `${job.origin} - ${job.destination} has no lane`);
  }
});

test("no demonstration job carries a client, a person, an address or a price", () => {
  const text = JSON.stringify(DEMO_JOBS);
  assert.doesNotMatch(text, /@/)
  assert.doesNotMatch(text, /\+254/);
  assert.doesNotMatch(text, /KES|USD/);
  assert.doesNotMatch(text, /Ltd|Limited|Company/i);
});
