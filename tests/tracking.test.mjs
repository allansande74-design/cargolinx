import test from "node:test";
import assert from "node:assert/strict";
import {
  MILESTONES,
  EXCEPTION,
  EXCEPTION_KINDS,
  EXCEPTION_SEVERITIES,
  openTrack,
  applyTrackingEvent,
  detectStalls,
  exceptionOn,
  resolveException,
  health,
} from "../engine/tracking.mjs";

const plan = (over = {}) => ({
  legs: [
    { from: "NBO", to: "MBA", mode: "road", departAt: "2026-10-01T06:00:00Z", arriveAt: "2026-10-02T06:00:00Z" },
    { from: "MBA", to: "DXB", mode: "sea", departAt: "2026-10-02T18:00:00Z", arriveAt: "2026-10-12T06:00:00Z" },
  ],
  ...over,
});

const track = (over = {}) => openTrack({ shipmentId: "SHP-1", ...plan(), at: "2026-10-01T00:00:00Z", ...over });

const ev = (id, milestone, at, over = {}) => ({ id, milestone, at, source: "carrier-feed", ...over });

const plus = (iso, hours) => new Date(new Date(iso).getTime() + hours * 3600 * 1000).toISOString();

/** Walk a whole milestone list in order, one event each, returning the track. */
function walk(t, startIso, milestones = MILESTONES, leg = 0) {
  let out = t;
  let h = 0;
  for (const m of milestones) {
    out = applyTrackingEvent(out, ev(`walk-${h}-${m}`, m, plus(startIso, h), { leg })).track;
    h += 1;
  }
  return out;
}

// ---- the contract ----

test("the canonical milestone order is the contract, and EXCEPTION sits outside it", () => {
  assert.deepEqual(MILESTONES, [
    "gate_in",
    "loaded",
    "departed",
    "transhipped",
    "arrived_port",
    "customs_cleared",
    "in_transit",
    "at_warehouse",
    "out_for_delivery",
    "delivered",
  ]);
  assert.equal(EXCEPTION, "EXCEPTION");
  assert.deepEqual(EXCEPTION_KINDS, ["customs_hold", "breakdown", "accident", "weather", "document", "customer"]);
  assert.deepEqual(EXCEPTION_SEVERITIES, ["minor", "major", "critical"]);
  assert.ok(!MILESTONES.includes(EXCEPTION));
});

test("a track opens with its plan kept whole and nothing applied", () => {
  const t = track();
  assert.equal(t.shipmentId, "SHP-1");
  assert.equal(t.legs.length, 2);
  assert.deepEqual(t.milestones, []);
  assert.deepEqual(t.exceptions, []);
  assert.equal(t.lastEventAt, null);
  assert.equal(t.sequence, 0);
  assert.equal(t.currentLeg, 0);
  assert.equal(t.position, -1);
  assert.equal(t.legs[1].index, 1);
  assert.equal(t.legs[0].name, "NBO → MBA");
  assert.equal(t.legs[0].departAt, "2026-10-01T06:00:00.000Z");
  assert.equal(t.openedAt, "2026-10-01T00:00:00.000Z");
});

test("a plan that cannot happen is refused before it becomes a mystery stall", () => {
  assert.throws(() => openTrack({ shipmentId: "SHP-1", legs: [] }), /at least one leg/);
  assert.throws(() => openTrack({ shipmentId: "", ...plan() }), /shipment id/);
  assert.throws(
    () =>
      openTrack({
        shipmentId: "SHP-1",
        legs: [{ from: "NBO", to: "MBA", mode: "road", departAt: "2026-10-02T06:00:00Z", arriveAt: "2026-10-01T06:00:00Z" }],
      }),
    /before it departs/,
  );
  assert.throws(
    () =>
      openTrack({
        shipmentId: "SHP-1",
        legs: [
          { from: "NBO", to: "MBA", mode: "road", departAt: "2026-10-01T06:00:00Z", arriveAt: "2026-10-03T06:00:00Z" },
          { from: "MBA", to: "DXB", mode: "sea", departAt: "2026-10-02T18:00:00Z", arriveAt: "2026-10-12T06:00:00Z" },
        ],
      }),
    /overlaps itself/,
  );
  assert.throws(() => openTrack({ shipmentId: "SHP-1", legs: [{ to: "MBA", mode: "road" }] }), /from and to/);
});

// ---- idempotency ----

test("the same event cannot be applied twice, and the refusal names it", () => {
  const first = applyTrackingEvent(track(), ev("ev-1", "gate_in", "2026-10-01T06:05:00Z"));
  assert.equal(first.status, "applied");
  assert.equal(first.track.history.length, 1);

  const again = applyTrackingEvent(first.track, ev("ev-1", "gate_in", "2026-10-01T06:05:00Z"));
  assert.equal(again.status, "refused");
  assert.equal(again.applied, false);
  assert.equal(again.refusal.code, "duplicate");
  assert.match(again.refusal.message, /ev-1 was already applied at 2026-10-01T06:05:00.000Z/);
  assert.equal(again.track.history.length, 1);
  assert.equal(again.track.milestones.length, 1);
  assert.equal(again.track.sequence, 1);
  assert.equal(again.track.refusals.length, 1);
  assert.equal(first.track.history.length, 1); // the track handed back is not edited in place
  assert.deepEqual(first.track.refusals, []);

  // a third copy, same id, different milestone: still the same event id
  const third = applyTrackingEvent(again.track, ev("ev-1", "loaded", "2026-10-01T07:00:00Z"));
  assert.equal(third.status, "refused");
  assert.match(third.refusal.message, /ev-1 was already applied/);
});

test("a held event is not duplicated by a second copy of the same id", () => {
  const held = applyTrackingEvent(track(), ev("ev-dep", "departed", "2026-10-01T08:00:00Z"));
  assert.equal(held.status, "held");

  const copy = applyTrackingEvent(held.track, ev("ev-dep", "departed", "2026-10-01T08:00:00Z"));
  assert.equal(copy.status, "refused");
  assert.equal(copy.refusal.code, "duplicate");
  assert.match(copy.refusal.message, /already held pending "departed"/);
  assert.equal(copy.track.pending.length, 1);

  // a different id for the same held milestone is also refused rather than queued twice
  const twin = applyTrackingEvent(held.track, ev("ev-dep-2", "departed", "2026-10-01T08:05:00Z"));
  assert.equal(twin.status, "refused");
  assert.equal(twin.refusal.code, "already_pending");
  assert.match(twin.refusal.message, /ev-dep already holds "departed"/);
  assert.equal(twin.track.pending.length, 1);
});

// ---- monotonic guard ----

test("a milestone earlier than the last recorded one is refused, naming both", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-1", "gate_in", "2026-10-01T06:05:00Z")).track;
  t = applyTrackingEvent(t, ev("ev-2", "loaded", "2026-10-01T07:00:00Z")).track;
  t = applyTrackingEvent(t, ev("ev-3", "departed", "2026-10-01T08:00:00Z")).track;

  const back = applyTrackingEvent(t, ev("ev-4", "gate_in", "2026-10-01T09:00:00Z"));
  assert.equal(back.status, "refused");
  assert.equal(back.refusal.code, "backwards");
  assert.match(back.refusal.message, /"gate_in" cannot follow "departed"/);
  assert.deepEqual(back.track.milestones, ["gate_in", "loaded", "departed"]);
  assert.equal(back.track.history.length, 3);
  assert.equal(back.track.refusals.length, 1);

  // transhipped is still allowed: it is later, not earlier
  const forward = applyTrackingEvent(t, ev("ev-5", "transhipped", "2026-10-01T09:00:00Z"));
  assert.equal(forward.status, "applied");
});

test("a milestone from a leg the shipment has already left is refused", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-1", "gate_in", "2026-10-01T06:05:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-2", "loaded", "2026-10-01T07:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-3", "departed", "2026-10-01T08:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-4", "transhipped", "2026-10-02T05:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-5", "departed", "2026-10-02T18:00:00Z", { leg: 1 })).track;
  assert.equal(t.currentLeg, 1);

  const stale = applyTrackingEvent(t, ev("ev-6", "arrived_port", "2026-10-02T06:10:00Z", { leg: 0 }));
  assert.equal(stale.status, "refused");
  assert.equal(stale.refusal.code, "stale_leg");
  assert.match(stale.refusal.message, /leg 0, but the shipment has already reached leg 1/);
});

// ---- out-of-order tolerance / self-healing ----

test("an event that arrives before its predecessor is held, then released when the gap fills", () => {
  const departed = ev("ev-dep", "departed", "2026-10-01T08:00:00Z");

  const held = applyTrackingEvent(track(), departed);
  assert.equal(held.status, "held");
  assert.equal(held.applied, false);
  assert.equal(held.refusal, null);
  assert.deepEqual(held.waitingFor, ["gate_in", "loaded"]);
  assert.equal(held.track.pending.length, 1);
  assert.deepEqual(held.track.milestones, []);
  assert.equal(held.track.history.length, 0);
  assert.equal(held.track.sequence, 0);
  assert.equal(held.track.lastEventAt, null);

  const gate = applyTrackingEvent(held.track, ev("ev-gate", "gate_in", "2026-10-01T06:05:00Z"));
  assert.equal(gate.status, "applied");
  assert.equal(gate.released.length, 0); // one gap still open
  assert.equal(gate.track.pending.length, 1);

  const loaded = applyTrackingEvent(gate.track, ev("ev-load", "loaded", "2026-10-01T07:00:00Z"));
  assert.equal(loaded.status, "applied");
  assert.equal(loaded.released.length, 1);
  assert.equal(loaded.released[0].milestone, "departed");
  assert.equal(loaded.released[0].id, "ev-dep");
  assert.equal(loaded.released[0].released, true);
  assert.equal(loaded.track.pending.length, 0);
  assert.deepEqual(loaded.track.milestones, ["gate_in", "loaded", "departed"]);
  assert.deepEqual(
    loaded.track.history.map((h) => [h.sequence, h.milestone]),
    [
      [1, "gate_in"],
      [2, "loaded"],
      [3, "departed"],
    ],
  );
  assert.equal(loaded.track.history[2].at, "2026-10-01T08:00:00.000Z"); // the event keeps its own time
  assert.equal(loaded.track.sequence, 3);
  assert.equal(loaded.track.lastEventAt, "2026-10-01T08:00:00.000Z");
});

test("a chain of held events releases in one pass once the gap is filled", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-ap", "arrived_port", "2026-10-02T06:05:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-dep", "departed", "2026-10-01T08:00:00Z", { leg: 0 })).track;
  assert.equal(t.pending.length, 2);

  t = applyTrackingEvent(t, ev("ev-gate", "gate_in", "2026-10-01T06:05:00Z", { leg: 0 })).track;
  const loaded = applyTrackingEvent(t, ev("ev-load", "loaded", "2026-10-01T07:00:00Z", { leg: 0 }));
  assert.deepEqual(
    loaded.released.map((r) => r.milestone),
    ["departed"],
  );

  const tx = applyTrackingEvent(loaded.track, ev("ev-tx", "transhipped", "2026-10-02T05:00:00Z", { leg: 0 }));
  assert.deepEqual(
    tx.released.map((r) => r.milestone),
    ["arrived_port"],
  );
  assert.equal(tx.track.pending.length, 0);
  assert.deepEqual(tx.track.milestones, ["gate_in", "loaded", "departed", "transhipped", "arrived_port"]);
  assert.deepEqual(
    tx.track.history.map((h) => h.sequence),
    [1, 2, 3, 4, 5],
  );
});

test("a held event whose leg is left behind is stranded, never silently dropped", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-tx0", "transhipped", "2026-10-02T05:00:00Z", { leg: 0 })).track;
  assert.equal(t.pending.length, 1);

  const next = applyTrackingEvent(t, ev("ev-dep1", "departed", "2026-10-02T18:00:00Z", { leg: 1 }));
  assert.equal(next.status, "applied");
  assert.equal(next.track.currentLeg, 1);
  assert.equal(next.track.pending.length, 0);
  assert.equal(next.track.stranded.length, 1);
  assert.equal(next.track.stranded[0].id, "ev-tx0");
  assert.match(next.track.stranded[0].reason, /leg 0 closed before "transhipped" arrived/);
});

test("an exception lands out of order and does not move the milestone position", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-1", "gate_in", "2026-10-01T06:05:00Z")).track;
  t = applyTrackingEvent(t, ev("ev-2", "loaded", "2026-10-01T07:00:00Z")).track;

  const exc = applyTrackingEvent(t, {
    id: "ev-x",
    milestone: EXCEPTION,
    at: "2026-10-01T07:30:00Z",
    kind: "breakdown",
    detail: "gearbox, 40km past Arusha",
    severity: "major",
    leg: 0,
  });
  assert.equal(exc.status, "applied");
  assert.equal(exc.track.exceptions.length, 1);
  assert.deepEqual(exc.track.milestones, ["gate_in", "loaded"]); // exceptions are not milestones
  assert.equal(exc.track.position, 1);
  assert.equal(exc.track.history.length, 3);
  assert.equal(exc.track.history[2].type, "exception");

  // and the move carries on from where it was
  const departed = applyTrackingEvent(exc.track, ev("ev-3", "departed", "2026-10-01T11:00:00Z"));
  assert.equal(departed.status, "applied");
  assert.deepEqual(departed.track.milestones, ["gate_in", "loaded", "departed"]);
});

test("malformed events throw; the feed is not allowed to invent milestones", () => {
  const t = track();
  assert.throws(() => applyTrackingEvent(t, { milestone: "gate_in", at: "2026-10-01T06:00:00Z" }), /must carry an id/);
  assert.throws(() => applyTrackingEvent(t, { id: "e1", at: "2026-10-01T06:00:00Z" }), /has no milestone/);
  assert.throws(() => applyTrackingEvent(t, { id: "e1", milestone: "gate_out", at: "2026-10-01T06:00:00Z" }), /unknown milestone/);
  assert.throws(() => applyTrackingEvent(t, { id: "e1", milestone: "gate_in" }), /at is required/);
  assert.throws(() => applyTrackingEvent(t, { id: "e1", milestone: "gate_in", at: "yesterday" }), /must be a date/);
  assert.throws(() => applyTrackingEvent(t, { id: "e1", milestone: "gate_in", at: "2026-10-01T06:00:00Z", leg: 7 }), /plan has 2 leg/);
  assert.throws(() => applyTrackingEvent(t, { id: "e1", milestone: "gate_in", at: "2026-10-01T06:00:00Z", leg: "KGL" }), /not in the plan/);
});

// ---- stall detection ----

test("stalls are arithmetic against the schedule: watch, late, critical", () => {
  const t = track();

  const watch = detectStalls(t, { at: "2026-10-02T12:00:00Z" }); // 6h past leg 0's 06:00 arrival
  assert.equal(watch.length, 1);
  assert.equal(watch[0].leg, 0);
  assert.equal(watch[0].expectedArriveAt, "2026-10-02T06:00:00.000Z");
  assert.equal(watch[0].hoursLate, 6);
  assert.equal(watch[0].severity, "watch");

  const nearlyLate = detectStalls(t, { at: "2026-10-03T17:00:00Z" }); // 35h
  assert.equal(nearlyLate[0].hoursLate, 35);
  assert.equal(nearlyLate[0].severity, "watch");

  const late = detectStalls(t, { at: "2026-10-03T18:00:00Z" }); // 36h = stallHours
  assert.equal(late[0].hoursLate, 36);
  assert.equal(late[0].severity, "late");

  const nearlyCritical = detectStalls(t, { at: "2026-10-05T05:00:00Z" }); // 71h
  assert.equal(nearlyCritical[0].hoursLate, 71);
  assert.equal(nearlyCritical[0].severity, "late");

  const critical = detectStalls(t, { at: "2026-10-05T06:00:00Z" }); // 72h = 2 x stallHours
  assert.equal(critical[0].hoursLate, 72);
  assert.equal(critical[0].severity, "critical");
});

test("the stall threshold is the caller's, not a hidden constant", () => {
  const t = track();
  const tight = detectStalls(t, { at: "2026-10-03T18:00:00Z", stallHours: 12 }); // 36h = 3 x 12
  assert.equal(tight[0].severity, "critical");

  const patient = detectStalls(t, { at: "2026-10-03T18:00:00Z", stallHours: 48 });
  assert.equal(patient[0].severity, "watch");
  assert.throws(() => detectStalls(t, { at: "2026-10-03T18:00:00Z", stallHours: 0 }), /positive number of hours/);
});

test("a leg that is not yet due is not a stall", () => {
  const t = track();
  assert.deepEqual(detectStalls(t, { at: "2026-10-02T05:59:00Z" }), []);
  assert.deepEqual(detectStalls(t, { at: "2026-10-01T06:00:00Z" }), []);
  // both legs overdue by 2026-10-20: the open legs are leg 1 (leg 0 has not begun? no — leg 0 is open too)
  const both = detectStalls(t, { at: "2026-10-20T06:00:00Z" });
  assert.deepEqual(
    both.map((s) => s.leg),
    [0, 1],
  );
});

test("only open legs are reported once the shipment has moved on", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-1", "gate_in", "2026-10-01T06:05:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-2", "loaded", "2026-10-01T07:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-3", "departed", "2026-10-01T08:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-4", "transhipped", "2026-10-02T05:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("ev-5", "departed", "2026-10-02T18:00:00Z", { leg: 1 })).track;

  const stalls = detectStalls(t, { at: "2026-10-20T06:00:00Z" });
  assert.deepEqual(
    stalls.map((s) => s.leg),
    [1],
  );
  assert.equal(stalls[0].hoursLate, 192);
  assert.equal(stalls[0].severity, "critical");
  assert.equal(stalls[0].mode, "sea");
});

test("a delivered shipment is never stalled", () => {
  const t = walk(track(), "2026-10-01T06:05:00Z");
  assert.equal(t.milestones.at(-1), "delivered");
  assert.deepEqual(detectStalls(t, { at: "2026-12-01T00:00:00Z" }), []);
});

test("stall detection reads no clock: without a time it falls back to the last event, and says so", () => {
  const bare = openTrack({ shipmentId: "SHP-1", ...plan() });
  assert.throws(() => detectStalls(bare), /at is required/);

  const t = applyTrackingEvent(track(), ev("ev-1", "gate_in", "2026-10-02T12:00:00Z")).track;
  const stalls = detectStalls(t); // no `at` handed in: the last event is the measuring point
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].hoursLate, 6);
});

// ---- exceptions ----

test("an exception pauses escalation for its leg, and resolving it restores the stall", () => {
  const t = track();

  const raised = exceptionOn(t, {
    at: "2026-10-02T09:00:00Z",
    kind: "customs_hold",
    detail: "KRA query on the PVoC certificate",
    severity: "major",
    leg: 0,
  });
  const exc = raised.exception;
  assert.equal(exc.id, "exc_SHP-1_1");
  assert.equal(exc.kind, "customs_hold");
  assert.equal(exc.severity, "major");
  assert.equal(exc.leg, 0);
  assert.equal(exc.resolvedAt, null);
  assert.equal(raised.track.exceptions.length, 1);
  assert.equal(raised.track.sequence, 1);
  assert.equal(raised.track.lastEventAt, "2026-10-02T09:00:00.000Z");
  assert.equal(t.exceptions.length, 0); // the track handed in is untouched

  // three days late, but escalation is paused for leg 0
  assert.deepEqual(detectStalls(raised.track, { at: "2026-10-05T06:00:00Z" }), []);

  const check = health(raised.track, { at: "2026-10-05T06:00:00Z" });
  assert.equal(check.state, "at_risk");
  assert.equal(check.openExceptions, 1);
  assert.equal(check.lateLegs, 0);
  assert.equal(check.lastEventAt, "2026-10-02T09:00:00.000Z");

  const solved = resolveException(raised.track, {
    id: exc.id,
    at: "2026-10-05T07:00:00Z",
    resolution: "PVoC reissued, released same day",
  });
  assert.equal(solved.exception.resolvedAt, "2026-10-05T07:00:00.000Z");
  assert.equal(solved.exception.resolution, "PVoC reissued, released same day");
  assert.equal(solved.track.exceptions.filter((e) => !e.resolvedAt).length, 0);
  assert.equal(solved.track.history.at(-1).type, "resolution");

  // the leg is as late as it always was, and now it is allowed to say so
  const after = detectStalls(solved.track, { at: "2026-10-05T08:00:00Z" });
  assert.equal(after.length, 1);
  assert.equal(after[0].leg, 0);
  assert.equal(after[0].hoursLate, 74);
  assert.equal(after[0].severity, "critical");
  assert.equal(health(solved.track, { at: "2026-10-05T08:00:00Z" }).state, "escalated");
});

test("exceptions are validated: known kinds, known severities, and a resolution with a reason", () => {
  const t = track();
  assert.throws(() => exceptionOn(t, { at: "2026-10-02T09:00:00Z", kind: "vibes", severity: "major" }), /not recognised/);
  assert.throws(() => exceptionOn(t, { at: "2026-10-02T09:00:00Z" }), /must state a kind/);
  assert.throws(() => exceptionOn(t, { at: "2026-10-02T09:00:00Z", kind: "weather", severity: "apocalyptic" }), /severity "apocalyptic"/);

  const raised = exceptionOn(t, { at: "2026-10-02T09:00:00Z", kind: "weather", severity: "minor", leg: 1 });
  assert.equal(raised.exception.severity, "minor");
  assert.equal(raised.exception.leg, 1);

  assert.throws(() => resolveException(raised.track, { id: "exc_nope", at: "2026-10-02T10:00:00Z", resolution: "x" }), /not on shipment/);
  assert.throws(() => resolveException(raised.track, { id: raised.exception.id, at: "2026-10-02T10:00:00Z" }), /requires a resolution/);
  assert.throws(() => resolveException(raised.track, { id: raised.exception.id, resolution: "x" }), /at is required/);

  const solved = resolveException(raised.track, { id: raised.exception.id, at: "2026-10-02T10:00:00Z", resolution: "storm passed" });
  assert.throws(() => resolveException(solved.track, { id: raised.exception.id, at: "2026-10-02T11:00:00Z", resolution: "again" }), /already resolved/);
});

test("an exception never counts as a milestone and never fills a gap", () => {
  const t = track();
  const held = applyTrackingEvent(t, ev("ev-dep", "departed", "2026-10-01T08:00:00Z"));
  const withExc = applyTrackingEvent(held.track, {
    id: "ev-x",
    milestone: EXCEPTION,
    at: "2026-10-01T08:30:00Z",
    kind: "accident",
    severity: "critical",
    leg: 0,
  });
  assert.equal(withExc.status, "applied");
  assert.equal(withExc.track.pending.length, 1); // departed is still waiting for its predecessor
  assert.deepEqual(withExc.track.milestones, []);
  assert.equal(health(withExc.track).state, "escalated");
});

// ---- health ----

test("health tells a dashboard which of the four states it is in", () => {
  // on time: nothing overdue, nothing open
  const t = track();
  const fresh = health(t, { at: "2026-10-01T12:00:00Z" });
  assert.equal(fresh.state, "on_time");
  assert.equal(fresh.openExceptions, 0);
  assert.equal(fresh.lateLegs, 0);
  assert.equal(fresh.lastEventAt, null);

  // at risk: a leg slipped past its arrival but under the late band
  const watch = health(t, { at: "2026-10-02T12:00:00Z" });
  assert.equal(watch.state, "at_risk");
  assert.equal(watch.lateLegs, 1);
  assert.deepEqual(watch.stalls.map((s) => s.severity), ["watch"]);

  // escalated: a critical stall
  const late = health(t, { at: "2026-10-05T06:00:00Z" });
  assert.equal(late.state, "escalated");
  assert.equal(late.lateLegs, 1); // leg 1's 2026-10-12 arrival is not due yet, so only leg 0 counts
  assert.equal(late.stalls[0].severity, "critical");

  // escalated: a critical exception, with no stall at all
  const criticalExc = exceptionOn(t, { at: "2026-10-01T09:00:00Z", kind: "accident", severity: "critical", leg: 0 });
  const escalated = health(criticalExc.track, { at: "2026-10-01T10:00:00Z" });
  assert.equal(escalated.state, "escalated");
  assert.equal(escalated.openExceptions, 1);

  // delivered wins over everything, and the open claim is still reported
  const delivered = walk(t, "2026-10-01T06:05:00Z");
  const claim = exceptionOn(delivered, { at: "2026-10-12T08:00:00Z", kind: "customer", severity: "critical", detail: "carton crushed" });
  const done = health(claim.track, { at: "2026-10-20T00:00:00Z" });
  assert.equal(done.state, "delivered");
  assert.equal(done.openExceptions, 1);
  assert.equal(done.lateLegs, 0);
});

test("health works from the last event when no clock is handed in", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("ev-1", "gate_in", "2026-10-03T18:00:00Z")).track; // already 36h late
  const h = health(t);
  assert.equal(h.lastEventAt, "2026-10-03T18:00:00.000Z");
  assert.equal(h.stalls[0].hoursLate, 36); // measured at the last event, not at a clock read
  assert.equal(h.stalls[0].severity, "late");
  assert.equal(h.state, "at_risk");
});

// ---- multi-leg ----

test("a multi-leg move repeats departed and transhipped without tripping the guard", () => {
  let t = track();
  t = applyTrackingEvent(t, ev("l0-1", "gate_in", "2026-10-01T06:05:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("l0-2", "loaded", "2026-10-01T07:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("l0-3", "departed", "2026-10-01T08:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("l0-4", "transhipped", "2026-10-02T05:00:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("l0-5", "arrived_port", "2026-10-02T06:05:00Z", { leg: 0 })).track;
  t = applyTrackingEvent(t, ev("l1-1", "departed", "2026-10-02T18:00:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-2", "transhipped", "2026-10-05T00:00:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-3", "arrived_port", "2026-10-12T06:10:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-4", "customs_cleared", "2026-10-13T09:00:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-5", "in_transit", "2026-10-13T12:00:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-6", "at_warehouse", "2026-10-14T08:00:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-7", "out_for_delivery", "2026-10-15T06:00:00Z", { leg: 1 })).track;
  t = applyTrackingEvent(t, ev("l1-8", "delivered", "2026-10-15T14:00:00Z", { leg: 1 })).track;

  assert.equal(t.refusals.length, 0);
  assert.equal(t.pending.length, 0);
  assert.equal(t.currentLeg, 1);
  assert.equal(t.history.length, 13);
  assert.equal(t.history.at(-1).sequence, 13);
  assert.deepEqual(
    t.history.map((h) => h.sequence),
    Array.from({ length: 13 }, (_, i) => i + 1),
  );
  assert.deepEqual(t.milestones, [
    "gate_in",
    "loaded",
    "departed",
    "transhipped",
    "arrived_port",
    "departed",
    "transhipped",
    "arrived_port",
    "customs_cleared",
    "in_transit",
    "at_warehouse",
    "out_for_delivery",
    "delivered",
  ]);
  assert.equal(health(t, { at: "2026-10-16T00:00:00Z" }).state, "delivered");
});
