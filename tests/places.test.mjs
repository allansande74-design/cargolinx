import test from "node:test";
import assert from "node:assert/strict";
import { findPlace, placeForOrder, stopsFromOrders } from "../src/lib/places.mjs";

test("the specific place wins over the town that shares its name", () => {
  assert.equal(findPlace("Plot 4, Mombasa Road, Nairobi").name, "Mombasa Road");
  assert.equal(findPlace("Mombasa port, berth 12").name, "Mombasa port");
  assert.equal(findPlace("Mombasa").name, "Mombasa");
});

test("a street address in an estate resolves to the estate, not to the city", () => {
  assert.equal(findPlace("Industrial Area, Nairobi").name, "Industrial Area");
  assert.equal(findPlace("Racecourse Gardens, Block B30, off Ngong Road, Nairobi").name, "Ngong Road");
  assert.equal(findPlace("Ngong town centre").name, "Ngong");
  assert.equal(findPlace("Thika Road Mall").name, "Thika Road");
});

test("the inland container depot is not the airport", () => {
  assert.equal(findPlace("Nairobi ICD, Embakasi").name, "Nairobi ICD");
  assert.equal(findPlace("Cargo terminal JKIA").name, "JKIA");
});

test("text with no known place says so instead of guessing", () => {
  assert.equal(findPlace(""), null);
  assert.equal(findPlace("Somewhere near the lake"), null);
  assert.equal(findPlace(undefined), null);
});

test("an order is read from its address first, then its city", () => {
  assert.equal(placeForOrder({ destination: { address: "Mlolongo warehouse", city: "Nairobi" } }).name, "Mlolongo");
  assert.equal(placeForOrder({ destination: { city: "Nakuru" } }).name, "Nakuru");
  assert.equal(placeForOrder({ destination: {} }), null);
});

test("stops keep what could be placed and report what could not", () => {
  const { stops, unplaced } = stopsFromOrders([
    { id: "A", destination: { address: "Industrial Area" }, weightKg: 800 },
    { id: "B", destination: { city: "Nakuru" } },
    { id: "C", destination: { city: "Somewhere" } },
  ]);
  assert.deepEqual(stops.map((s) => s.id), ["A", "B"]);
  assert.equal(stops[1].weightKg, 500);
  assert.deepEqual(unplaced, ["C"]);
  for (const stop of stops) {
    assert.ok(Math.abs(stop.lat) < 6 && Math.abs(stop.lng - 36) < 6, `${stop.label} is not in Kenya`);
  }
});
