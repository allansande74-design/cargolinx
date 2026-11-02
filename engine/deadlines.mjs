/**
 * Deadlines, countdowns and client reporting — the clock behind SOP-TIMELINE-001.
 * Pure functions, no I/O, so the same logic runs in the browser, in a Worker and in tests.
 *
 * Every assignment carries a deadline, a milestone calendar, and a fixed reporting cadence
 * (T-7, T-3, T-1, T-0). A missed milestone is a service failure unless a documented external
 * factor is recorded before the deadline.
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** Reporting cadence in days before the deadline. */
export const REPORT_CADENCE = [7, 3, 1, 0];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function ms(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`invalid date: ${iso}`);
  return t;
}

/**
 * @param {object} a
 * @param {string} a.id
 * @param {string} a.title
 * @param {string} [a.client]
 * @param {string} a.deadline   ISO timestamp of the promise (EAT wall clock)
 * @param {string} [a.startedAt]
 * @param {Array<{name:string, at:string, owner?:string}>} [a.milestones]
 */
export function createAssignment(a) {
  if (!a?.id) throw new Error("id required");
  if (!a?.deadline) throw new Error("deadline required");
  ms(a.deadline);
  const milestones = (a.milestones ?? [])
    .map((m) => ({ name: m.name, at: m.at, owner: m.owner ?? null, doneAt: m.doneAt ?? null }))
    .map((m, i) => ({ ...m, order: i }))
    .sort((x, y) => ms(x.at) - ms(y.at));
  const startedAt = a.startedAt ?? new Date().toISOString();
  return {
    id: a.id,
    title: a.title ?? a.id,
    client: a.client ?? null,
    deadline: a.deadline,
    startedAt,
    milestones,
    reports: REPORT_CADENCE.map((d) => ({ label: `T-${d}`, daysBefore: d, sentAt: null })),
    delays: [],
  };
}

/** Milliseconds left; negative once overdue. */
export function remainingMs(assignment, now = Date.now()) {
  return ms(assignment.deadline) - now;
}

/** Human countdown: "2d 04h 11m 07s" / "47m 12s" / "overdue 3h 02m". */
export function formatCountdown(deltaMs) {
  const late = deltaMs < 0;
  let s = Math.floor(Math.abs(deltaMs) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${String(h).padStart(2, "0")}h`);
  parts.push(`${String(m).padStart(2, "0")}m`);
  parts.push(`${String(s).padStart(2, "0")}s`);
  return (late ? "overdue " : "") + parts.join(" ");
}

/**
 * on-track  → more than 3 days left
 * due-soon  → 3 days or less
 * at-risk   → 1 day or less, or a milestone already past and not done
 * overdue   → deadline passed
 */
export function status(assignment, now = Date.now()) {
  const left = remainingMs(assignment, now);
  const lateMilestone = (assignment.milestones ?? []).find(
    (m) => !m.doneAt && ms(m.at) < now,
  );
  const overdueMilestones = (assignment.milestones ?? []).filter(
    (m) => !m.doneAt && ms(m.at) < now,
  ).length;
  let state = "on-track";
  if (left < 0) state = "overdue";
  else if (left <= DAY || lateMilestone) state = "at-risk";
  else if (left <= 3 * DAY) state = "due-soon";
  return {
    state,
    leftMs: left,
    countdown: formatCountdown(left),
    progressPct: pctElapsed(assignment, now),
    overdueMilestones,
    lateMilestone: lateMilestone ? { name: lateMilestone.name, at: lateMilestone.at } : null,
    excused: excusedDelay(assignment, now) !== null,
  };
}

/** 0–100 of the promised window consumed (never negative, capped at 100). */
export function pctElapsed(assignment, now = Date.now()) {
  const start = ms(assignment.startedAt);
  const end = ms(assignment.deadline);
  if (end <= start) return 100;
  return clamp(Math.round(((now - start) / (end - start)) * 100), 0, 100);
}

export function nextMilestone(assignment, now = Date.now()) {
  const open = (assignment.milestones ?? []).filter((m) => !m.doneAt);
  if (!open.length) return null;
  const due = open.filter((m) => ms(m.at) >= now);
  return due[0] ?? open[open.length - 1];
}

export function completeMilestone(assignment, name, at = new Date().toISOString()) {
  const m = (assignment.milestones ?? []).find((x) => x.name === name && !x.doneAt);
  if (!m) throw new Error(`no open milestone named ${name}`);
  return {
    ...assignment,
    milestones: assignment.milestones.map((x) => (x === m ? { ...x, doneAt: at } : x)),
  };
}

/** The report that should be on its way now, if any. T-0 fires at the deadline. */
export function dueReports(assignment, now = Date.now()) {
  const end = ms(assignment.deadline);
  return (assignment.reports ?? [])
    .filter((r) => !r.sentAt)
    .map((r) => ({ ...r, dueAt: new Date(end - r.daysBefore * DAY).toISOString() }))
    .filter((r) => now >= ms(r.dueAt));
}

export function markReportSent(assignment, label, at = new Date().toISOString()) {
  const r = (assignment.reports ?? []).find((x) => x.label === label);
  if (!r) throw new Error(`no report ${label}`);
  return {
    ...assignment,
    reports: assignment.reports.map((x) => (x.label === label ? { ...x, sentAt: at } : x)),
  };
}

/**
 * Delay exemption, per SOP-TIMELINE-001 §4: named, evidenced, and notified before the deadline.
 * Anything less is our failure, and the tracker says so.
 */
export function recordDelay(assignment, { reason, evidence, notifiedAt }) {
  if (!reason) throw new Error("reason required");
  if (!evidence) throw new Error("evidence required — a delay without evidence is not excused");
  const deadlineNow = Date.now() >= ms(assignment.deadline);
  return {
    ...assignment,
    delays: [
      ...(assignment.delays ?? []),
      {
        reason,
        evidence,
        notifiedAt: notifiedAt ?? new Date().toISOString(),
        notifiedBeforeDeadline: notifiedAt ? ms(notifiedAt) < ms(assignment.deadline) : !deadlineNow,
      },
    ],
  };
}

export function excusedDelay(assignment, now = Date.now()) {
  const delays = assignment.delays ?? [];
  const ok = delays.filter((d) => d.evidence && d.notifiedBeforeDeadline);
  if (!ok.length) return null;
  return now >= ms(assignment.deadline) ? ok[ok.length - 1] : null;
}

/** Everything the desk needs in one call: the row the tracker renders. */
export function snapshot(assignment, now = Date.now()) {
  const st = status(assignment, now);
  const nm = nextMilestone(assignment, now);
  const due = dueReports(assignment, now);
  return {
    id: assignment.id,
    title: assignment.title,
    client: assignment.client,
    deadline: assignment.deadline,
    deadlineEat: formatEat(assignment.deadline),
    ...st,
    nextMilestone: nm ? { name: nm.name, at: nm.at, atEat: formatEat(nm.at), owner: nm.owner } : null,
    reportsDue: due.map((r) => ({ label: r.label, dueAt: r.dueAt })),
  };
}

/** East Africa Time, the only clock a client in Nairobi should ever be shown. */
export function formatEat(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso)) + " EAT";
}

/** Clock the tracker displays beside the countdown. */
export function nowEat(now = Date.now()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(now));
}

/** Supplier time discipline scoring (SOP-TIMELINE-001 §3). */
export function supplierTimeScore({ respondedOnTime, figuresHeld }) {
  const onTime = respondedOnTime ? 1 : 0;
  const held = figuresHeld ? 1 : 0;
  return {
    score: onTime * 0.6 + held * 0.4,
    verdict: onTime && held ? "trusted" : !onTime ? "too slow — deprioritise" : "fast but unreliable figures",
  };
}
