import test from "node:test";
import assert from "node:assert/strict";
import {
  PORTS,
  SEA_LANES,
  INLAND_LEGS,
  FACTORY_GATES,
  DESTINATIONS,
  planInternational,
  replan,
  validateCorridors,
  portByCode,
} from "../engine/corridors.mjs";

const HOUR = 3600 * 1000;
const hoursBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
const sum = (items, key) => items.reduce((acc, i) => acc + i[key], 0);

const chinaToNairobi = () =>
  planInternational({ originCity: "Guangzhou", destinationCity: "Nairobi", departAt: "2026-11-02T06:00:00Z" });

/* ------------------------------------------------------------------ data */

test("the file passes its own invariants", () => {
  const counts = validateCorridors();
  assert.equal(counts.ports, PORTS.length);
  assert.ok(counts.lanes >= 8);
  assert.ok(counts.inlandLegs >= 9);
});

test("every required port is on file with a valid type", () => {
  const required = ["Shanghai", "Ningbo", "Shenzhen", "Mombasa", "Dar es Salaam", "Beira", "Durban", "Walvis Bay", "Tema", "Lagos"];
  for (const name of required) {
    const port = PORTS.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
    assert.ok(port, `missing port ${name}`);
    assert.ok(["load", "discharge"].includes(port.type));
    assert.match(port.code, /^[A-Z]{5}$/);
    assert.ok(port.country);
  }
  assert.equal(portByCode("KEMBA").country, "KE");
  assert.equal(portByCode("kemba").name, "Mombasa");
  assert.equal(PORTS.find((p) => p.name.includes("Lagos")).code, "NGAPP");
});

test("sea lanes run load to discharge and carry a basis and a confidence", () => {
  assert.ok(SEA_LANES.length >= 8);
  const pairs = new Set();
  for (const lane of SEA_LANES) {
    assert.equal(portByCode(lane.from).type, "load", `${lane.id} does not load`);
    assert.equal(portByCode(lane.to).type, "discharge", `${lane.id} does not discharge`);
    assert.ok(lane.transitDays > 0);
    assert.ok(lane.basis.length > 10);
    assert.ok(["indicative", "firm"].includes(lane.confidence));
    assert.ok(!pairs.has(`${lane.from}-${lane.to}`), `duplicate lane ${lane.id}`);
    pairs.add(`${lane.from}-${lane.to}`);
  }
  assert.ok(SEA_LANES.some((l) => l.confidence === "firm"));
  assert.ok(SEA_LANES.some((l) => l.confidence === "indicative"));
});

test("every inland destination has a leg from a discharge port, with border delay labelled as an assumption", () => {
  const required = ["Nairobi", "Kampala", "Kigali", "Dar es Salaam", "Lusaka", "Harare", "Johannesburg", "Gaborone", "Maputo"];
  for (const city of required) {
    const legs = INLAND_LEGS.filter((l) => l.to === city);
    assert.ok(legs.length >= 1, `no inland leg to ${city}`);
    for (const leg of legs) {
      assert.equal(portByCode(leg.from).type, "discharge");
      assert.ok(leg.distanceKm > 0);
      assert.ok(leg.transitHours > 0);
      assert.ok(Array.isArray(leg.borderPosts));
      assert.equal(typeof leg.borderHours.hours, "number");
      assert.match(leg.borderHours.basis, /assumption/i, `${leg.id} border delay is not labelled an assumption`);
      assert.ok(leg.basis.length > 10);
      assert.ok(["indicative", "firm"].includes(leg.confidence));
    }
  }
  assert.deepEqual([...DESTINATIONS].sort(), [...required].sort());
  // a border leg names its post; an unnamed crossing must still carry an assumption
  const kampala = INLAND_LEGS.find((l) => l.id === "KEMBA-KAMPALA");
  assert.deepEqual(kampala.borderPosts, ["Malaba"]);
  const walvisJoburg = INLAND_LEGS.find((l) => l.id === "NAWVB-JOHANNESBURG");
  assert.deepEqual(walvisJoburg.borderPosts, []);
  assert.ok(walvisJoburg.borderHours.hours > 0);
});

/* ------------------------------------------------------------- planning */

test("a China factory gate to a Nairobi warehouse resolves gate, sea and inland legs in order", () => {
  const plan = chinaToNairobi();

  assert.deepEqual(
    plan.legs.map((l) => [l.mode, l.from, l.to]),
    [
      ["road", "Guangzhou", "Shenzhen (Yantian)"],
      ["sea", "Shenzhen (Yantian)", "Mombasa"],
      ["road", "Mombasa", "Nairobi"],
    ]
  );
  assert.equal(plan.route.originPort, "CNSZX");
  assert.equal(plan.route.destinationPort, "KEMBA");
  assert.equal(plan.route.laneId, "CNSZX-KEMBA");
  assert.equal(plan.legs[1].hours, SEA_LANES.find((l) => l.id === "CNSZX-KEMBA").transitDays * 24);

  // legs are contiguous, each carrying its basis and confidence
  for (let i = 1; i < plan.legs.length; i += 1) {
    const gapHours = hoursBetween(plan.legs[i - 1].arriveAt, plan.legs[i].departAt);
    assert.equal(gapHours, plan.customsStops[i - 1].hours, `unexplained gap before leg ${i + 1}`);
  }
  for (const leg of plan.legs) {
    assert.ok(leg.basis.length > 10);
    assert.ok(["indicative", "firm"].includes(leg.confidence));
    assert.ok(leg.hours > 0);
    assert.ok(new Date(leg.arriveAt) > new Date(leg.departAt));
  }

  assert.equal(plan.arriveAt, plan.legs.at(-1).arriveAt);
  assert.ok(new Date(plan.arriveAt) > new Date(plan.departAt));
  assert.ok(plan.assumptions.length >= 4);
  assert.ok(plan.assumptions.some((a) => /Pre-carriage Guangzhou/.test(a)));
  assert.ok(plan.assumptions.some((a) => /Sea Shenzhen \(Yantian\) -> Mombasa: 28 days/.test(a)));

  // where a border is crossed, the delay is stated as an assumption and the post is named
  const kampala = planInternational({ originCity: "Guangzhou", destinationCity: "Kampala", departAt: "2026-11-02T06:00:00Z" });
  assert.equal(kampala.legs.at(-1).to, "Kampala");
  assert.deepEqual(kampala.legs.at(-1).borderPosts, ["Malaba"]);
  assert.ok(kampala.assumptions.some((a) => /Malaba/.test(a) && /assumed border delay/.test(a)));
  assert.ok(kampala.assumptions.some((a) => /assumption, not a measured queue/.test(a)));
  assert.ok(kampala.totalHours > plan.totalHours);
});

test("customs stops are export at the load port and import at the discharge port, default 48 and 72 hours", () => {
  const plan = chinaToNairobi();
  assert.equal(plan.customsStops.length, 2);
  assert.deepEqual(
    plan.customsStops.map((s) => [s.at, s.kind, s.hours]),
    [
      ["Shenzhen (Yantian)", "export", 48],
      ["Mombasa", "import", 72],
    ]
  );
  for (const stop of plan.customsStops) {
    assert.match(stop.basis, /assumption/i);
    assert.equal(hoursBetween(stop.startAt, stop.endAt), stop.hours);
  }
  assert.equal(plan.customsStops[0].startAt, plan.legs[0].arriveAt);
  assert.equal(plan.customsStops[1].endAt, plan.legs[2].departAt);
});

test("total hours equal the legs plus the customs dwell, and reply to a dwell override", () => {
  const plan = chinaToNairobi();
  assert.equal(plan.totalHours, sum(plan.legs, "hours") + sum(plan.customsStops, "hours"));
  assert.equal(plan.totalHours, hoursBetween(plan.departAt, plan.arriveAt));
  assert.equal(plan.hoursBreakdown.idle, 0);
  assert.equal(plan.totalHours, 4 + 48 + 672 + 72 + 10);

  const fast = planInternational({
    originCity: "Guangzhou",
    destinationCity: "Nairobi",
    departAt: "2026-11-02T06:00:00Z",
    dwellHours: { load: 24, discharge: 36 },
  });
  assert.equal(fast.totalHours, plan.totalHours - (24 + 36));
  assert.deepEqual(fast.dwellHours, { load: 24, discharge: 36 });
  assert.equal(fast.arriveAt, new Date(new Date(fast.departAt).getTime() + fast.totalHours * HOUR).toISOString());
});

test("a leg that is indicative downgrades the whole plan; an all-firm route stays firm", () => {
  const mixed = chinaToNairobi();
  assert.equal(mixed.confidence, "indicative");
  assert.ok(mixed.legs.some((l) => l.confidence === "indicative"));
  assert.ok(mixed.confidenceBasis.length >= 1);
  assert.ok(mixed.confidenceBasis.some((c) => /indicative/.test(c)));

  const firm = planInternational({ originCity: "Jebel Ali", destinationCity: "Nairobi", departAt: "2026-11-02T06:00:00Z" });
  assert.deepEqual(firm.legs.map((l) => l.mode), ["sea", "road"]);
  assert.ok(firm.legs.every((l) => l.confidence === "firm"));
  assert.equal(firm.confidence, "firm");
  assert.equal(firm.route.gateModelled, false);

  // same origin, one lane down: an indicative lane drags the plan to indicative
  const downgraded = planInternational({
    originCity: "Jebel Ali",
    destinationCity: "Nairobi",
    departAt: "2026-11-02T06:00:00Z",
    seaLane: "AEJEA-TZDAR",
  });
  assert.equal(downgraded.route.laneId, "AEJEA-TZDAR");
  assert.equal(downgraded.legs[0].confidence, "indicative");
  assert.equal(downgraded.confidence, "indicative");
});

test("an explicit sea lane is honoured, and an unknown one is refused by name", () => {
  // Ningbo -> Harare would default to Durban; naming the Beira lane overrides that choice
  const plan = planInternational({
    originCity: "Foshan",
    destinationCity: "Harare",
    departAt: "2026-11-02T06:00:00Z",
    seaLane: { from: "CNSZX", to: "MZBEI" },
  });
  assert.equal(plan.route.laneId, "CNSZX-MZBEI");
  assert.equal(plan.route.destinationPort, "MZBEI");
  assert.deepEqual(plan.legs.map((l) => l.to), ["Shenzhen (Yantian)", "Beira", "Harare"]);

  assert.throws(
    () => planInternational({ originCity: "Foshan", destinationCity: "Harare", departAt: "2026-11-02T06:00:00Z", seaLane: "CNSHA-LOS" }),
    /no sea lane matches CNSHA-LOS/
  );

  // a lane that exists but does not start at the origin port is refused, not silently swapped
  assert.throws(
    () => planInternational({ originCity: "Ningbo", destinationCity: "Harare", departAt: "2026-11-02T06:00:00Z", seaLane: "CNSZX-MZBEI" }),
    (err) => err.code === "NO_SEA_LANE" && /no sea lane from Ningbo to Harare/.test(err.message)
  );
});

test("an unroutable pair is refused with a named reason, not an empty plan", () => {
  assert.throws(
    () => planInternational({ originCity: "Guangzhou", destinationCity: "Kinshasa", departAt: "2026-11-02T06:00:00Z" }),
    (err) => {
      assert.equal(err.code, "NO_INLAND_LEG");
      assert.match(err.message, /no inland leg to Kinshasa/);
      return true;
    }
  );

  // Nhava Sheva has lanes to East Africa, but none reaching Gaborone's inland ports
  assert.throws(
    () => planInternational({ originCity: "Nhava Sheva", destinationCity: "Gaborone", departAt: "2026-11-02T06:00:00Z" }),
    (err) => {
      assert.equal(err.code, "NO_SEA_LANE");
      assert.match(err.message, /no sea lane from Nhava Sheva to Gaborone/);
      return true;
    }
  );

  assert.throws(
    () => planInternational({ originCity: "Atlantis", destinationCity: "Nairobi", departAt: "2026-11-02T06:00:00Z" }),
    /unknown origin city Atlantis/
  );
  // a discharge port cannot load
  assert.throws(
    () => planInternational({ originCity: "Mombasa", destinationCity: "Nairobi", departAt: "2026-11-02T06:00:00Z" }),
    (err) => err.code === "NO_LOAD_PORT" && /discharge port/.test(err.message)
  );
  // a missing or unusable departure time is refused too
  assert.throws(
    () => planInternational({ originCity: "Guangzhou", destinationCity: "Nairobi", departAt: "next Thursday" }),
    /departAt must be a date/
  );
});

test("the same inputs give the same plan — nothing inside reads a clock", () => {
  assert.deepEqual(chinaToNairobi(), chinaToNairobi());
});

/* --------------------------------------------------------------- replan */

test("replan pushes only the legs downstream of the event", () => {
  const plan = chinaToNairobi();
  const at = plan.customsStops[1].startAt; // cargo is on the quay at Mombasa, clearance just opened
  const next = replan(plan, { at, delayHours: 18, reason: "Mombasa clearance queue" });

  assert.equal(next.legs[0].departAt, plan.legs[0].departAt);
  assert.equal(next.legs[0].arriveAt, plan.legs[0].arriveAt);
  assert.equal(next.legs[1].arriveAt, plan.legs[1].arriveAt, "the sea leg had finished and must not move");
  assert.equal(next.legs[2].departAt, new Date(new Date(plan.legs[2].departAt).getTime() + 18 * HOUR).toISOString());
  assert.equal(next.legs[2].arriveAt, new Date(new Date(plan.legs[2].arriveAt).getTime() + 18 * HOUR).toISOString());

  assert.equal(hoursBetween(plan.arriveAt, next.arriveAt), 18);
  assert.equal(next.totalHours, plan.totalHours + 18);
  assert.equal(next.changes.length, 1);
  const change = next.changes[0];
  assert.equal(change.reason, "Mombasa clearance queue");
  assert.equal(change.delayHours, 18);
  assert.equal(change.at, new Date(at).toISOString());
  assert.equal(change.previousArriveAt, plan.arriveAt);
  assert.deepEqual(change.legsShifted, [2]);
  assert.equal(change.stopsShifted.includes(1), true);

  // the timeline stays contiguous — the dwell absorbed the queue rather than opening a hole
  assert.equal(next.customsStops[1].startAt, plan.customsStops[1].startAt);
  assert.equal(next.customsStops[1].hours, 90);
  assert.equal(next.legs[2].departAt, next.customsStops[1].endAt);
  assert.equal(next.hoursBreakdown.idle, 0);
});

test("replan does not mutate the plan it was given", () => {
  const plan = chinaToNairobi();
  const before = JSON.parse(JSON.stringify(plan));
  const next = replan(plan, { at: plan.customsStops[1].startAt, delayHours: 12, reason: "port strike" });
  assert.deepEqual(plan, before);
  assert.notEqual(next.legs[2], plan.legs[2]);
  assert.notEqual(next.changes, plan.changes);
  assert.equal(next.changes.length, 1);
  assert.notEqual(next, plan);

  // replanning twice keeps both causes, newest last
  const twice = replan(next, { at: next.legs[2].departAt, delayHours: 6, reason: "truck breakdown" });
  assert.deepEqual(twice.changes.map((c) => c.reason), ["port strike", "truck breakdown"]);
  assert.equal(twice.arriveAt, new Date(new Date(next.arriveAt).getTime() + 6 * HOUR).toISOString());
  assert.deepEqual(plan, before, "the first plan is still untouched after two replans");
});

test("replan refuses a negative delay, a missing reason and an event after arrival", () => {
  const plan = chinaToNairobi();
  assert.throws(
    () => replan(plan, { at: plan.departAt, delayHours: -5, reason: "wishful" }),
    (err) => err.code === "NEGATIVE_DELAY" && /negative delay -5 h refused/.test(err.message)
  );
  assert.throws(
    () => replan(plan, { at: plan.departAt, delayHours: 5, reason: "   " }),
    (err) => err.code === "NO_REASON" && /reason required/.test(err.message)
  );
  assert.throws(
    () => replan(plan, { at: plan.arriveAt, delayHours: 5, reason: "too late" }),
    (err) => err.code === "AT_AFTER_ARRIVAL"
  );
  assert.throws(() => replan({ legs: [] }, { delayHours: 1, reason: "x" }), /at least one leg/);
});

test("a delay inside a running leg extends that leg instead of teleporting the truck", () => {
  const plan = chinaToNairobi();
  const midSea = new Date(new Date(plan.legs[1].departAt).getTime() + 100 * HOUR).toISOString();
  const next = replan(plan, { at: midSea, delayHours: 24, reason: "vessel omitted Singapore" });

  assert.equal(next.legs[0].arriveAt, plan.legs[0].arriveAt);
  assert.equal(next.legs[1].departAt, plan.legs[1].departAt, "the sea leg had already sailed");
  assert.equal(next.legs[1].hours, plan.legs[1].hours + 24);
  assert.equal(hoursBetween(plan.legs[1].arriveAt, next.legs[1].arriveAt), 24);
  assert.equal(next.totalHours, plan.totalHours + 24);
  assert.deepEqual(next.changes[0].legsShifted, [1, 2]);
});
