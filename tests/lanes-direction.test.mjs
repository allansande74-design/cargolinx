// The export page is only honest if it is the import lanes reversed, not a second table that can drift.
// These tests pin the symmetry and pin where it stops.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANES, reverseName, reverseLeg, reverseLane, laneKm, laneHours, borderCount, lanesBothWays, exportLaneRows,
  laneBetween, reverseShipment,
} from "../engine/lanes.mjs";

test("a lane name turns round, and a name without a dash is left alone", () => {
  assert.equal(reverseName("Mombasa - Kampala"), "Kampala - Mombasa");
  assert.equal(reverseName("Nairobi - Kigali"), "Kigali - Nairobi");
  assert.equal(reverseName("Depot"), "Depot");
  assert.equal(reverseName(""), "");
});

test("a leg keeps its road, its kilometres, its speed and its border", () => {
  const leg = { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true };
  assert.deepEqual(reverseLeg(leg), { name: "Malaba - Eldoret", km: 130, speedKph: 50, border: true });
});

test("the reverse of a lane starts where the import lane ended", () => {
  const back = reverseLane(LANES["Mombasa - Kampala"]);
  assert.equal(back[0].name, "Kampala - Malaba");
  assert.equal(back[back.length - 1].name, "Nairobi - Mombasa");
  assert.equal(laneKm(back), laneKm(LANES["Mombasa - Kampala"]));
  assert.equal(borderCount(back), 1, "one border post either way");
});

test("reversing twice returns the original lane", () => {
  for (const legs of Object.values(LANES)) {
    assert.deepEqual(reverseLane(reverseLane(legs)), legs);
  }
});

test("hours are the printed speeds, and a rest allowance is added once", () => {
  const legs = LANES["Nairobi - Kampala"];
  const driving = legs.reduce((s, l) => s + l.km / l.speedKph, 0);
  assert.ok(Math.abs(laneHours(legs) - driving) < 1e-9);
  assert.ok(Math.abs(laneHours(legs, { restHours: 10 }) - (driving + 10)) < 1e-9);
});

test("every import lane has an export lane, and no export lane is invented", () => {
  const both = lanesBothWays(LANES);
  const imports = Object.keys(LANES);
  for (const name of imports) assert.ok(both[reverseName(name)], `${name} has no reverse`);
  assert.equal(Object.keys(both).length, imports.length);
});

test("the export table carries the reversed route and the same kilometres", () => {
  const rows = exportLaneRows(LANES);
  const kampala = rows.find((r) => r.name === "Kampala - Mombasa");
  assert.ok(kampala);
  assert.equal(kampala.km, 1185);
  assert.equal(kampala.borders, 1);
  assert.match(kampala.route, /^Kampala - Malaba · Malaba - Eldoret/);
});

test("a lane is found by the two ends, whatever the casing and spacing", () => {
  assert.equal(laneBetween("Mombasa", "Kampala")?.name, "Mombasa - Kampala");
  assert.equal(laneBetween("  mombasa ", "KAMPALA")?.name, "Mombasa - Kampala");
  assert.equal(laneBetween("Kampala", "Mombasa")?.name, "Kampala - Mombasa", "the reverse comes from the same lane turned round");
  assert.equal(laneBetween("Kisumu", "Kampala"), null);
});

test("a carried load reads back the other way, with the distance it would really run", () => {
  const job = { id: "clx_1", origin: "Mombasa", destination: "Kampala", cargo: "Solar panels", weightKg: 900, value: { goods: 18500 } };
  const rev = reverseShipment(job);
  assert.equal(rev.asCarried, "Mombasa → Kampala");
  assert.equal(rev.reversed, "Kampala → Mombasa");
  assert.equal(rev.laneName, "Kampala - Mombasa");
  assert.equal(rev.km, 1185);
  assert.equal(rev.hours, 23.7);
  assert.equal(rev.cargo, "Solar panels");
  assert.equal(rev.goodsUsd, 18500);
  assert.equal(rev.reason, null);
});

test("a pair with no lane says so, and claims no distance", () => {
  const rev = reverseShipment({ id: "clx_2", origin: "Kisumu", destination: "Kampala", cargo: "Fish" });
  assert.equal(rev.laneName, null);
  assert.equal(rev.km, null);
  assert.match(rev.reason, /No lane runs Kampala to Kisumu/);
});
