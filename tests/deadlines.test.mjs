import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY, createAssignment, remainingMs, formatCountdown, status, pctElapsed,
  nextMilestone, completeMilestone, dueReports, markReportSent, recordDelay,
  excusedDelay, snapshot, formatEat, supplierTimeScore,
} from "../engine/deadlines.mjs";

const T0 = Date.parse("2026-11-02T06:00:00Z");           // Mon 09:00 EAT
const DEADLINE = "2026-11-11T09:00:00Z";                 // Wed 12:00 EAT, nine days out

function make(overrides = {}) {
  return createAssignment({
    id: "HACK-001",
    title: "Meta Global AI Developer Hackathon submission",
    client: "Meta",
    deadline: DEADLINE,
    startedAt: new Date(T0).toISOString(),
    milestones: [
      { name: "Demo filmed", at: "2026-11-05T15:00:00Z", owner: "Amanda" },
      { name: "Pack assembled", at: "2026-11-09T15:00:00Z", owner: "Amanda" },
      { name: "Submitted", at: DEADLINE, owner: "Allan" },
    ],
    ...overrides,
  });
}

test("countdown counts down and turns negative when late", () => {
  const a = make();
  assert.equal(remainingMs(a, T0), Date.parse(DEADLINE) - T0);
  assert.match(formatCountdown(remainingMs(a, T0)), /^9d 03h 00m 00s$/);
  assert.match(formatCountdown(-(1 * 60 * 1000 + 5000)), /^overdue 01m 05s$/);
});

test("status walks on-track -> due-soon -> at-risk -> overdue", () => {
  const a = make({ milestones: [] });
  assert.equal(status(a, T0).state, "on-track");
  assert.equal(status(a, T0 + 6.5 * DAY).state, "due-soon");
  assert.equal(status(a, T0 + 8.6 * DAY).state, "at-risk");
  assert.equal(status(a, Date.parse(DEADLINE) + 1000).state, "overdue");
});

test("a past-due milestone flips the assignment to at-risk even with days left", () => {
  const a = make();
  const at = Date.parse("2026-11-05T15:00:00Z") + 1000;   // demo not done
  const st = status(a, at);
  assert.equal(st.state, "at-risk");
  assert.equal(st.lateMilestone.name, "Demo filmed");
  assert.equal(st.overdueMilestones, 1);
});

test("progress never exceeds 100 and is 0 at the start", () => {
  const a = make();
  assert.equal(pctElapsed(a, T0), 0);
  assert.equal(pctElapsed(a, Date.parse(DEADLINE) + 5 * DAY), 100);
});

test("milestones complete in order and the next one advances", () => {
  let a = make();
  assert.equal(nextMilestone(a, T0).name, "Demo filmed");
  a = completeMilestone(a, "Demo filmed", new Date(T0 + DAY).toISOString());
  assert.equal(nextMilestone(a, T0 + DAY).name, "Pack assembled");
  assert.throws(() => completeMilestone(a, "Demo filmed"), /no open milestone/);
});

test("T-7, T-3, T-1 and T-0 reports fall due on schedule and stop once sent", () => {
  const a = make();
  const end = Date.parse(DEADLINE);
  assert.deepEqual(dueReports(a, end - 8 * DAY), []);
  assert.deepEqual(dueReports(a, end - 7 * DAY).map((r) => r.label), ["T-7"]);
  assert.deepEqual(dueReports(a, end - 3 * DAY).map((r) => r.label), ["T-7", "T-3"]);
  const sent = markReportSent(a, "T-7", new Date(end - 7 * DAY).toISOString());
  assert.deepEqual(dueReports(sent, end - 3 * DAY).map((r) => r.label), ["T-3"]);
  assert.deepEqual(dueReports(sent, end + DAY).map((r) => r.label), ["T-3", "T-1", "T-0"]);
});

test("a delay needs evidence; notified after the deadline it is not an excuse", () => {
  const a = make();
  assert.throws(() => recordDelay(a, { reason: "port strike" }), /evidence required/);
  const late = recordDelay(a, {
    reason: "KRA system outage", evidence: "KRA ticket 55821",
    notifiedAt: "2026-11-12T09:00:00Z",
  });
  assert.equal(excusedDelay(late, Date.parse("2026-11-13T00:00:00Z")), null);
  const inTime = recordDelay(a, {
    reason: "KRA system outage", evidence: "KRA ticket 55821",
    notifiedAt: "2026-11-10T09:00:00Z",
  });
  assert.equal(excusedDelay(inTime, Date.parse("2026-11-13T00:00:00Z")).reason, "KRA system outage");
});

test("snapshot carries the EAT clock and the next milestone owner", () => {
  const s = snapshot(make(), T0);
  assert.equal(s.deadlineEat, "11 Nov 2026, 12:00 EAT");
  assert.equal(s.nextMilestone.name, "Demo filmed");
  assert.equal(s.nextMilestone.owner, "Amanda");
  assert.equal(s.state, "on-track");
  assert.deepEqual(s.reportsDue, []);
});

test("supplier time score rewards on-time, factual replies only", () => {
  assert.equal(supplierTimeScore({ respondedOnTime: true, figuresHeld: true }).score, 1);
  assert.match(supplierTimeScore({ respondedOnTime: false, figuresHeld: true }).verdict, /too slow/);
  assert.match(supplierTimeScore({ respondedOnTime: true, figuresHeld: false }).verdict, /unreliable/);
});

test("formatEat renders Nairobi time regardless of host timezone", () => {
  assert.equal(formatEat("2026-11-04T09:00:00Z"), "04 Nov 2026, 12:00 EAT");
});
