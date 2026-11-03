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

test("no demonstration job carries a client, a person, an address or a currency", () => {
  const text = JSON.stringify(DEMO_JOBS);
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, /\+254/);
  assert.doesNotMatch(text, /KES|USD/);
  assert.doesNotMatch(text, /Ltd|Limited|Company/i);
});

// A sample job missing its services block crashed the quote screen: reading shipment.services.clearing
// on an incomplete record took the whole desk to "This screen stopped working".
test("every demonstration job carries the fields the quote screen reads", () => {
  for (const job of DEMO_JOBS) {
    assert.equal(typeof job.value?.goods, "number", `${job.ref} has no goods value`);
    assert.equal(typeof job.value?.freight, "number", `${job.ref} has no freight value`);
    for (const k of ["clearing", "transport", "lastMile"]) {
      assert.equal(typeof job.services?.[k], "number", `${job.ref} has no services.${k}`);
    }
    assert.equal(typeof job.dutyRate, "number", `${job.ref} has no duty band`);
  }
});
