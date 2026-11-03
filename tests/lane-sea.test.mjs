// The export corridor now continues to China. The sea distance is computed from coordinates, so these
// tests check the arithmetic and the honesty about what the number is.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHINA_PORTS, MOMBASA, greatCircleNm, planningNm, seaDays, corridorToChina, chinaLaneRows, LANES,
} from "../engine/lanes.mjs";

test("the great circle is symmetric and zero to itself", () => {
  const a = CHINA_PORTS.Shanghai;
  assert.ok(Math.abs(greatCircleNm(MOMBASA, a) - greatCircleNm(a, MOMBASA)) < 1e-9);
  assert.equal(Math.round(greatCircleNm(MOMBASA, MOMBASA)), 0);
});

test("Mombasa to Shanghai is about five thousand nautical miles, before routing", () => {
  const gc = greatCircleNm(MOMBASA, CHINA_PORTS.Shanghai);
  assert.ok(gc > 4900 && gc < 5300, `great circle was ${Math.round(gc)} nm`);
  assert.ok(planningNm(MOMBASA, CHINA_PORTS.Shanghai) > gc, "routing adds to the straight line");
});

test("the southern Chinese ports are nearer than the northern ones", () => {
  const gz = planningNm(MOMBASA, CHINA_PORTS.Guangzhou);
  const sh = planningNm(MOMBASA, CHINA_PORTS.Shanghai);
  assert.ok(gz < sh, "Guangzhou should be closer than Shanghai from Mombasa");
  for (const p of Object.values(CHINA_PORTS)) {
    assert.equal(p.country, "CN");
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon));
  }
});

test("sea days are distance over speed, and exclude port time", () => {
  assert.ok(Math.abs(seaDays(384) - 1) < 1e-9, "384 nm at 16 knots is one day");
  assert.ok(Math.abs(seaDays(384, 12) - 384 / 288) < 1e-9);
});

test("a corridor is the reversed road plus the sea, in their own units", () => {
  const c = corridorToChina("Kampala - Mombasa", "Shanghai");
  assert.equal(c.inlandKm, 1185);
  assert.equal(c.borders, 1);
  assert.equal(c.portName, "Shanghai");
  assert.ok(c.nm > c.greatCircleNm, "planning distance exceeds the great circle");
  assert.ok(c.seaDays > 10 && c.seaDays < 20, `sea days were ${c.seaDays}`);
});

test("a corridor with no inland lane, or no such port, is null rather than a guess", () => {
  assert.equal(corridorToChina("Kampala - Nowhere", "Shanghai"), null);
  assert.equal(corridorToChina("Kampala - Mombasa", "Rotterdam"), null);
});

test("every Chinese port is measured from Mombasa, once", () => {
  const rows = chinaLaneRows();
  assert.equal(rows.length, Object.keys(CHINA_PORTS).length);
  for (const r of rows) {
    assert.match(r.name, /^Mombasa - /);
    assert.ok(r.nm > 0 && r.seaDays > 0);
  }
  assert.ok(rows.every((r) => r.nm >= r.greatCircleNm));
});

test("the lane table itself is untouched by the sea leg", () => {
  assert.deepEqual(Object.keys(LANES).sort(), ["Mombasa - Kampala", "Mombasa - Nairobi", "Nairobi - Kampala", "Nairobi - Kigali"]);
});
