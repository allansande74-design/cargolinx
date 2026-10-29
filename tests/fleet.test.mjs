import test from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_CLASSES,
  RATE_CARD,
  CORRIDORS,
  matchVehicle,
  splitShipment,
  costEstimate,
  capacityCheck,
} from "../engine/fleet.mjs";

const cls = (code) => VEHICLE_CLASSES.find((c) => c.code === code);

test("the register carries the eight tiers, ascending by payload, each with a known corridor", () => {
  assert.equal(VEHICLE_CLASSES.length, 8);
  const codes = VEHICLE_CLASSES.map((c) => c.code);
  assert.deepEqual(codes, [
    "drone_last100",
    "motorbike",
    "pickup",
    "van",
    "light_truck",
    "medium_truck",
    "heavy_truck",
    "trailer",
  ]);
  assert.deepEqual(CORRIDORS, ["last_mile", "urban", "trunk", "regional"]);

  for (const c of VEHICLE_CLASSES) {
    assert.ok(c.label && c.axleOrWheelBaseNote, `${c.code} needs a label and an axle note`);
    assert.ok(c.payloadKg > 0 && c.volumeM3 > 0, `${c.code} needs positive payload and volume`);
    assert.ok(["available", "future"].includes(c.status), `${c.code} status must be available or future`);
    assert.ok(c.corridors.length > 0, `${c.code} must serve at least one corridor`);
    for (const corridor of c.corridors) assert.ok(CORRIDORS.includes(corridor), `${c.code} corridor ${corridor} unknown`);
    assert.equal(c.lastMileOnly, c.corridors.length === 1 && c.corridors[0] === "last_mile");
  }
});

test("the stated capacities are the ones the register holds", () => {
  const rows = VEHICLE_CLASSES.map((c) => [c.code, c.payloadKg, c.volumeM3]);
  assert.deepEqual(rows, [
    ["drone_last100", 5, 0.05],
    ["motorbike", 80, 0.15],
    ["pickup", 1000, 3],
    ["van", 1200, 6],
    ["light_truck", 3500, 18],
    ["medium_truck", 14000, 45],
    ["heavy_truck", 28000, 90],
    ["trailer", 34000, 120],
  ]);
  assert.equal(VEHICLE_CLASSES.motorbike.lastMileOnly, true);
  assert.equal(VEHICLE_CLASSES.motorbike.payloadKg, 80);
  assert.equal(VEHICLE_CLASSES.drone_last100.status, "future");
  assert.equal(VEHICLE_CLASSES.drone_last100.payloadKg, 5);
  assert.deepEqual(VEHICLE_CLASSES.drone_last100.corridors, ["last_mile"]);
  // codes are reachable by property as well as by scan
  assert.equal(VEHICLE_CLASSES.pickup.code, "pickup");
  assert.ok(Object.isFrozen(VEHICLE_CLASSES));
});

test("a 900 kg parcel gets the pickup — the smallest class that fits, not the next truck up", () => {
  const r = matchVehicle({ weightKg: 900, corridor: "urban" });
  assert.equal(r.vehicle.code, "pickup");
  assert.notEqual(r.vehicle.code, "heavy_truck");
  assert.equal(r.vehicle.payloadKg, 1000);
  assert.equal(r.utilisationKgPct, 90);
  assert.equal(r.utilisationM3Pct, null);
  assert.equal(r.basis.volumeConsidered, false);
});

test("the default corridor is trunk, and 900 kg on it is still the pickup", () => {
  const r = matchVehicle({ weightKg: 900 });
  assert.equal(r.basis.corridor, "trunk");
  assert.equal(r.vehicle.code, "pickup");
  assert.ok(r.alternatives.length > 0, "a match should offer the classes above it");
  assert.equal(r.alternatives[0].code, "van");
  assert.ok(r.alternatives.every((a) => a.payloadKg >= r.vehicle.payloadKg));
});

test("the alternatives are the classes above on that corridor, never a smaller one", () => {
  const r = matchVehicle({ weightKg: 3000, volumeM3: 5, corridor: "trunk" });
  assert.equal(r.vehicle.code, "light_truck");
  assert.deepEqual(r.alternatives.map((a) => a.code), ["medium_truck", "heavy_truck", "trailer"]);
  assert.ok(r.alternatives.every((a) => a.payloadKg >= r.vehicle.payloadKg));

  // on urban the medium truck and up do not run, so there is nothing above the light truck
  const urban = matchVehicle({ weightKg: 3000, volumeM3: 5, corridor: "urban" });
  assert.equal(urban.vehicle.code, "light_truck");
  assert.deepEqual(urban.alternatives, []);
});

test("volume, not weight, pushes the load to a larger class", () => {
  const byWeight = matchVehicle({ weightKg: 900, corridor: "trunk" });
  assert.equal(byWeight.vehicle.code, "pickup");

  const byVolume = matchVehicle({ weightKg: 900, volumeM3: 4, corridor: "trunk" });
  assert.equal(byVolume.vehicle.code, "van", "4 m3 does not fit the pickup's 3 m3");
  assert.equal(byVolume.utilisationKgPct, 75);
  assert.equal(byVolume.utilisationM3Pct, 66.67);
  assert.equal(byVolume.basis.volumeConsidered, true);
});

test("the corridor filters the register both ways", () => {
  // regional excludes the pickup and the van
  const regional = matchVehicle({ weightKg: 900, corridor: "regional" });
  assert.equal(regional.vehicle.code, "light_truck");
  assert.ok(regional.vehicle.corridors.includes("regional"));
  assert.ok(!regional.alternatives.some((a) => a.code === "pickup"), "the pickup does not run regional");

  // last_mile cannot carry 1,000 kg: the largest on that corridor is the 1.2 t van
  assert.throws(
    () => matchVehicle({ weightKg: 5000, corridor: "last_mile" }),
    /cargo exceeds the largest class on this corridor/,
  );

  // an unknown corridor is refused by name
  assert.throws(() => matchVehicle({ weightKg: 100, corridor: "air" }), /no class serves corridor "air"/);
});

test("cargo above the largest class on a corridor is refused with that reason", () => {
  assert.throws(
    () => matchVehicle({ weightKg: 40000, volumeM3: 100, corridor: "trunk" }),
    (err) => {
      assert.equal(err.name, "FleetRefusal");
      assert.equal(err.reason, "cargo_exceeds_largest");
      assert.match(err.message, /cargo exceeds the largest class on this corridor/);
      assert.match(err.message, /trailer/, "the refusal names the biggest class it measured against");
      return true;
    },
  );
});

test("the future drone is refused unless allowFuture is asked for explicitly", () => {
  assert.throws(
    () => matchVehicle({ weightKg: 3, corridor: "last_mile" }),
    (err) => {
      assert.equal(err.reason, "future_class_requires_allowFuture");
      assert.match(err.message, /drone_last100/);
      assert.match(err.message, /allowFuture/);
      assert.equal(err.vehicle.code, "drone_last100");
      assert.ok(err.alternatives.some((a) => a.code === "motorbike"), "the refusal offers what we can do today");
      return true;
    },
  );

  const allowed = matchVehicle({ weightKg: 3, corridor: "last_mile", allowFuture: true });
  assert.equal(allowed.vehicle.code, "drone_last100");
  assert.equal(allowed.vehicle.status, "future");
  assert.equal(allowed.utilisationKgPct, 60);
  assert.ok(allowed.alternatives.every((a) => a.status === "available"), "alternatives are only classes we can quote");
});

test("a false allowFuture still refuses; only a boolean true unlocks the drone", () => {
  assert.throws(() => matchVehicle({ weightKg: 3, corridor: "last_mile", allowFuture: false }), /future class/);
  for (const sneaky of ["yes", 1, "true", {}]) {
    assert.throws(
      () => matchVehicle({ weightKg: 3, corridor: "last_mile", allowFuture: sneaky }),
      /allowFuture must be true or false/,
      `${JSON.stringify(sneaky)} must not count as a yes`,
    );
  }
});

test("missing or negative cargo is refused, and nothing is guessed", () => {
  assert.throws(() => matchVehicle({}), /weightKg is required/);
  assert.throws(() => matchVehicle({ weightKg: null }), /weightKg is required/);
  assert.throws(() => matchVehicle({ weightKg: "" }), /weightKg is required/);
  assert.throws(() => matchVehicle({ weightKg: -1 }), /weightKg must be greater than zero/);
  assert.throws(() => matchVehicle({ weightKg: 0 }), /weightKg must be greater than zero/);
  assert.throws(() => matchVehicle({ weightKg: 10, volumeM3: -1 }), /volumeM3 must be greater than zero/);
  assert.throws(() => matchVehicle({ weightKg: "heavy" }), /weightKg must be a number/);
});

test("oversized cargo splits into units of one class and reports the leftover", () => {
  const r = splitShipment({ weightKg: 60000, volumeM3: 200, corridor: "trunk" });
  assert.equal(r.vehicle.code, "trailer");
  assert.equal(r.units, 2);
  assert.equal(r.loads.length, 2);
  assert.equal(r.loads[0].weightKg, 30000);
  assert.equal(r.loads[0].volumeM3, 100);
  assert.equal(r.loads[0].utilisationKgPct, 88.24);
  assert.equal(r.loads[0].utilisationM3Pct, 83.33);
  assert.deepEqual(r.leftover, { weightKg: 8000, volumeM3: 40 });
  assert.equal(r.lastUnitPartial, true);
  // weight and volume both need two trailers here, so the tie is reported as payload
  assert.equal(r.basis.limitedBy, "payload");
});

test("the split takes fewest units, then the smallest class that achieves it", () => {
  // one unit of both heavy truck (28 t) and trailer (34 t) — the heavy truck wins on size
  const one = splitShipment({ weightKg: 20000, volumeM3: 40, corridor: "trunk" });
  assert.equal(one.vehicle.code, "heavy_truck");
  assert.equal(one.units, 1);

  // 30 t needs one trailer but two heavy trucks
  const two = splitShipment({ weightKg: 30000, volumeM3: 80, corridor: "trunk" });
  assert.equal(two.vehicle.code, "trailer");
  assert.equal(two.units, 1);

  // and 900 kg never becomes a truck of any size
  assert.equal(splitShipment({ weightKg: 900, corridor: "urban" }).vehicle.code, "pickup");
});

test("the split is refused when it would exceed maxUnits", () => {
  assert.throws(
    () => splitShipment({ weightKg: 200000, volumeM3: 400, corridor: "trunk", maxUnits: 5 }),
    (err) => {
      assert.equal(err.reason, "exceeds_max_units");
      assert.match(err.message, /6 × trailer/);
      assert.match(err.message, /maxUnits is 5/);
      return true;
    },
  );
  // six is allowed, five is not
  assert.equal(splitShipment({ weightKg: 200000, volumeM3: 400, corridor: "trunk", maxUnits: 6 }).units, 6);
});

test("cargo a single unit carries is reported as one load, not a split", () => {
  const r = splitShipment({ weightKg: 900, volumeM3: 2, corridor: "trunk" });
  assert.equal(r.vehicle.code, "pickup");
  assert.equal(r.units, 1);
  assert.equal(r.leftover.weightKg, 100);
  assert.equal(r.lastUnitPartial, true);
  assert.throws(() => splitShipment({ weightKg: 900, volumeM3: 2, corridor: "trunk", maxUnits: 0 }), /maxUnits/);
  assert.throws(() => splitShipment({ weightKg: 900, volumeM3: 2, corridor: "sea" }), /no class serves corridor/);
});

test("a class with no rate on file is refused, not defaulted", () => {
  assert.equal(RATE_CARD.drone_last100, null);
  assert.throws(
    () => costEstimate("drone_last100", { distanceKm: 100 }),
    (err) => {
      assert.equal(err.reason, "no_rate_on_file");
      assert.match(err.message, /no rate on file for drone_last100/);
      assert.match(err.message, /will not invent one/);
      return true;
    },
  );
  // the refusal stands even if only fuel was supplied
  assert.throws(() => costEstimate(VEHICLE_CLASSES.drone_last100, { distanceKm: 100, fuelPerKm: 10 }), /no rate on file/);
  // a caller who puts a rate in writing can still be priced, and it is labelled as theirs
  const supplied = costEstimate("drone_last100", { distanceKm: 100, ratePerKm: 50 });
  assert.equal(supplied.freightKes, 5000);
  assert.equal(supplied.rateSource, "caller supplied");
});

test("a rated class costs the card rate times the distance", () => {
  const r = costEstimate("heavy_truck", { distanceKm: 400 });
  assert.equal(r.ratePerKm, RATE_CARD.heavy_truck.kesPerKm);
  assert.equal(r.ratePerKm, 255);
  assert.equal(r.freightKes, 102000);
  assert.equal(r.fuelKes, null);
  assert.equal(r.totalKes, 102000);
  assert.equal(r.currency, "KES");
  assert.match(r.rateSource, /^Rate card/);
  assert.equal(r.vehicle.code, "heavy_truck");
});

test("fuel is added only when the caller gives a fuel rate", () => {
  const r = costEstimate("medium_truck", { distanceKm: 200, fuelPerKm: 30 });
  assert.equal(r.freightKes, 38000);
  assert.equal(r.fuelKes, 6000);
  assert.equal(r.totalKes, 44000);
  assert.equal(r.basis.length, 2);
});

test("cost refuses a missing or nonsense distance, and an unknown class", () => {
  assert.throws(() => costEstimate("pickup", {}), /distanceKm is required/);
  assert.throws(() => costEstimate("pickup", { distanceKm: 0 }), /distanceKm must be greater than zero/);
  assert.throws(() => costEstimate("pickup", { distanceKm: -5 }), /distanceKm must be greater than zero/);
  assert.throws(() => costEstimate("unicorn", { distanceKm: 10 }), /unknown vehicle class "unicorn"/);
});

test("capacityCheck names the limiting dimension", () => {
  const overVolume = capacityCheck("pickup", { weightKg: 900, volumeM3: 5 });
  assert.equal(overVolume.fits, false);
  assert.equal(overVolume.reasons.length, 1);
  assert.equal(overVolume.reasons[0].dimension, "volume");
  assert.match(overVolume.reasons[0].message, /volume: 5 m3 exceeds the 3 m3 body/);
  assert.deepEqual(overVolume.limiting, ["volume"]);
  assert.equal(overVolume.reasons[0].excess, 2);

  const overWeight = capacityCheck(VEHICLE_CLASSES.pickup, { weightKg: 1200, volumeM3: 2 });
  assert.equal(overWeight.fits, false);
  assert.deepEqual(overWeight.limiting, ["payload"]);
  assert.equal(overWeight.reasons[0].dimension, "payload");
  assert.equal(overWeight.reasons[0].excess, 200);
});

test("capacityCheck passes a load that fits and renames both limits when both are broken", () => {
  const fits = capacityCheck("pickup", { weightKg: 900, volumeM3: 2 });
  assert.equal(fits.fits, true);
  assert.deepEqual(fits.reasons, []);
  assert.deepEqual(fits.limiting, []);
  assert.equal(fits.utilisationKgPct, 90);

  const both = capacityCheck("pickup", { weightKg: 2000, volumeM3: 9, corridor: "regional" });
  assert.deepEqual(both.limiting, ["payload", "volume", "corridor"]);
  assert.match(both.reasons[2].message, /does not serve regional/);
});

test("capacityCheck refuses an empty check and records the drone's future status as a note", () => {
  assert.throws(() => capacityCheck("pickup", {}), /weightKg and\/or volumeM3/);
  assert.throws(() => capacityCheck("pickup", { weightKg: -1 }), /cannot be negative/);

  const drone = capacityCheck("drone_last100", { weightKg: 3, volumeM3: 0.02 });
  assert.equal(drone.fits, true, "the airframe does carry it; the status is a note, not a capacity failure");
  assert.equal(drone.notes.length, 1);
  assert.match(drone.notes[0], /future class/);
});
