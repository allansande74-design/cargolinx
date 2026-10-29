/**
 * Shipment tracking for a multi-leg international move.
 *
 * The feed will lie to us. It will replay the same event twice, deliver the arrival before the
 * departure, and then go quiet for three days. This module assumes all three. A replay is refused
 * on its id; a milestone that runs backwards is refused by name; an event that arrives before its
 * predecessor is held — never dropped — until the gap fills, then released in order. Nothing is
 * applied twice and nothing disappears without a line in the record saying so.
 *
 * Stalls are arithmetic against the corridor plan, not a poller. Hand in the time and the module
 * says which open legs are overdue. An open exception pauses escalation for its leg until someone
 * resolves it, because a customs hold is not a mystery and should not be alarmed about as one.
 *
 * Pure functions only: no clock reads (every `at` is the caller's), no network, no filesystem. Every
 * function returns a new track; the one handed in is never modified.
 */

export const MILESTONES = [
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
];

/** Not a milestone: an exception may land at any point in the move and never moves the position. */
export const EXCEPTION = "EXCEPTION";

export const EXCEPTION_KINDS = ["customs_hold", "breakdown", "accident", "weather", "document", "customer"];

export const EXCEPTION_SEVERITIES = ["minor", "major", "critical"];

/**
 * How late a leg must be, as a multiple of stallHours, to be called late and then critical.
 * Default stallHours is 36, so anything overdue is at least a watch, 36h is late, 72h is critical.
 */
export const STALL_BANDS = { late: 1, critical: 2 };

const HOUR = 3600 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;

/** Dates are the caller's job. A tracker that reads the clock cannot be replayed or tested. */
function stamp(at, field) {
  if (at === undefined || at === null || at === "") {
    throw new Error(`${field} is required — the tracker never reads the clock itself`);
  }
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} must be a date, got "${at}"`);
  return d.toISOString();
}

function assertTrack(track, message) {
  if (!track || !Array.isArray(track.legs) || !Array.isArray(track.history) || !Array.isArray(track.milestones)) {
    throw new Error(message ?? "a tracking function needs the track it works on");
  }
}

/** Shallow copy with fresh arrays: applying an event never edits the track that was handed in. */
function clone(track) {
  return {
    ...track,
    milestones: [...track.milestones],
    exceptions: [...track.exceptions],
    pending: [...track.pending],
    history: [...track.history],
    refusals: [...(track.refusals ?? [])],
    stranded: [...(track.stranded ?? [])],
  };
}

const laterOf = (a, b) => (!a || new Date(b) > new Date(a) ? b : a);

const rankLabel = (rank) => (rank >= 0 && rank < MILESTONES.length ? `"${MILESTONES[rank]}"` : "nothing");

/**
 * Read the corridor plan the way the rest of the system states it: from, to, mode, departure,
 * arrival. A leg that arrives before it departs, or starts before the leg before it lands, is a
 * broken plan and is refused here rather than discovered as a mystery stall three days later.
 */
function normaliseLegs(legs) {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new Error("a track needs at least one leg from the corridor plan");
  }
  const out = legs.map((l, i) => {
    if (!l?.from || !l?.to) throw new Error(`leg ${i} must name the from and to points`);
    const departAt = stamp(l.departAt, `leg ${i} departAt`);
    const arriveAt = stamp(l.arriveAt, `leg ${i} arriveAt`);
    if (new Date(arriveAt) < new Date(departAt)) {
      throw new Error(`leg ${i} arrives (${arriveAt}) before it departs (${departAt}) — the plan is impossible`);
    }
    return {
      ...l,
      index: i,
      name: String(l.name ?? `${l.from} → ${l.to}`),
      from: String(l.from),
      to: String(l.to),
      mode: l.mode ? String(l.mode) : "unknown",
      departAt,
      arriveAt,
    };
  });
  for (let i = 1; i < out.length; i += 1) {
    if (new Date(out[i].departAt) < new Date(out[i - 1].arriveAt)) {
      throw new Error(
        `leg ${i} departs (${out[i].departAt}) before leg ${i - 1} arrives (${out[i - 1].arriveAt}) — the plan overlaps itself`,
      );
    }
  }
  return out;
}

/** A leg is named by its index, its plan name ("NBO → MBA") or by an endpoint the plan knows. */
function legIndexFor(track, leg, eventId) {
  if (leg === undefined || leg === null || leg === "") return track.currentLeg;
  if (typeof leg === "number") {
    if (!Number.isInteger(leg) || leg < 0 || leg >= track.legs.length) {
      throw new Error(`event ${eventId} names leg ${leg}, but the plan has ${track.legs.length} leg(s)`);
    }
    return leg;
  }
  const text = String(leg).trim();
  if (/^\d+$/.test(text)) return legIndexFor(track, Number(text), eventId);
  const hit = track.legs.find((l) => l.name === text || l.from === text || l.to === text);
  if (!hit) {
    throw new Error(`event ${eventId} names leg "${text}", which is not in the plan (${track.legs.map((l) => l.name).join(", ")})`);
  }
  return hit.index;
}

/**
 * Open a track against a corridor plan.
 *
 * The plan is kept whole — every leg with its schedule — because a stall is only meaningful against
 * the arrival that was promised. Nothing is applied yet: position -1 means the next milestone that
 * may land is MILESTONES[0], and anything later waits until the gap is filled.
 */
export function openTrack({ shipmentId, legs, at = null } = {}) {
  const id = String(shipmentId ?? "").trim();
  if (!id) throw new Error("a track must carry the shipment id it follows");
  return {
    shipmentId: id,
    legs: normaliseLegs(legs),
    milestones: [], // applied progress milestones, in the order accepted
    exceptions: [], // every exception raised, resolved or not
    pending: [], // events held for a gap that has not been filled
    stranded: [], // held events whose leg was left before they arrived — kept, not deleted
    history: [], // every accepted event, numbered
    refusals: [], // every event turned away, with the reason
    currentLeg: 0,
    position: -1, // rank of the last accepted milestone within currentLeg
    sequence: 0,
    lastEventAt: null,
    openedAt: at === null || at === undefined || at === "" ? null : stamp(at, "at"),
  };
}

function refuse(track, { id, milestone, at, code, message }) {
  const next = clone(track);
  const refusal = { id, milestone, at, code, message };
  next.refusals = [...next.refusals, refusal];
  return { track: next, event: null, status: "refused", applied: false, refusal, released: [] };
}

/** Release held events, lowest rank first, for as long as each release fills the next gap. */
function drainPending(next) {
  const released = [];
  for (;;) {
    const ready = next.pending
      .filter((p) => p.leg === next.currentLeg && p.rank <= next.position + 1)
      .sort((a, b) => a.rank - b.rank || new Date(a.at) - new Date(b.at))[0];
    if (!ready) break;

    next.pending = next.pending.filter((p) => p !== ready);
    next.position = ready.rank;
    next.sequence += 1;
    const entry = {
      sequence: next.sequence,
      type: "milestone",
      milestone: ready.milestone,
      at: ready.at,
      leg: ready.leg,
      note: ready.note,
      source: ready.source,
      id: ready.id,
      released: true,
    };
    next.history = [...next.history, entry];
    next.milestones = [...next.milestones, ready.milestone];
    next.lastEventAt = laterOf(next.lastEventAt, ready.at);
    released.push(entry);
  }
  return released;
}

function openException(track, { id, at, kind, detail = "", severity = "major", leg = null, source = "unknown" }) {
  const code = String(kind ?? "").trim();
  if (!code) throw new Error(`exception ${id} must state a kind — one of ${EXCEPTION_KINDS.join(", ")}`);
  if (!EXCEPTION_KINDS.includes(code)) {
    throw new Error(`exception kind "${kind}" is not recognised — use one of ${EXCEPTION_KINDS.join(", ")}`);
  }
  const level = String(severity ?? "major").trim();
  if (!EXCEPTION_SEVERITIES.includes(level)) {
    throw new Error(`exception severity "${severity}" is not recognised — use one of ${EXCEPTION_SEVERITIES.join(", ")}`);
  }

  const legIndex = legIndexFor(track, leg, id);
  const next = clone(track);
  next.sequence = track.sequence + 1;
  const exception = {
    id,
    kind: code,
    detail: String(detail ?? ""),
    severity: level,
    leg: legIndex,
    at,
    resolvedAt: null,
    resolution: null,
    source,
    sequence: next.sequence,
  };
  next.exceptions = [...track.exceptions, exception];
  next.history = [
    ...track.history,
    {
      sequence: next.sequence,
      type: "exception",
      milestone: EXCEPTION,
      exceptionId: id,
      kind: code,
      severity: level,
      at,
      leg: legIndex,
      note: exception.detail,
      source,
      id,
    },
  ];
  next.lastEventAt = laterOf(track.lastEventAt, at);
  return { track: next, event: exception, exception, status: "applied", applied: true, refusal: null, released: [] };
}

/**
 * Apply one tracking event.
 *
 * The order of checks is the order the feed lies in: a replay by id, then a milestone from a leg the
 * shipment has already left, then a milestone behind the last one recorded on this leg, then a
 * milestone so far ahead that its predecessors have not arrived — which is held, not refused.
 *
 * The result is a decision, not a throw: { track, status, applied, refusal, released, waitingFor }.
 * A refusal is recorded on the track as well as returned, so the morning's "why did this event not
 * show up" has an answer. Malformed input (no id, no milestone, an unknown milestone) is a caller
 * bug and throws, because a feed that invents milestone names is not a feed we can interpret.
 *
 * A second copy carrying a *different* id cannot be told from a genuine repeat (a second `departed`
 * on the next leg is real), which is exactly why the id is mandatory.
 */
export function applyTrackingEvent(track, { milestone, at, leg, note = "", source = "unknown", id, kind, detail, severity } = {}) {
  assertTrack(track, "a tracking event needs the track it belongs to");

  const eventId = String(id ?? "").trim();
  if (!eventId) {
    throw new Error("a tracking event must carry an id — an anonymous event cannot be proven applied once");
  }
  const when = stamp(at, "at");
  const name = String(milestone ?? "").trim();
  if (!name) throw new Error(`event ${eventId} has no milestone`);

  const isException = name === EXCEPTION;
  const rank = MILESTONES.indexOf(name);
  if (!isException && rank < 0) {
    throw new Error(`event ${eventId} names unknown milestone "${name}" — expected one of ${MILESTONES.join(", ")} or ${EXCEPTION}`);
  }

  const appliedBefore = track.history.find((h) => h.id === eventId);
  if (appliedBefore) {
    return refuse(track, {
      id: eventId,
      milestone: name,
      at: when,
      code: "duplicate",
      message: `event ${eventId} was already applied at ${appliedBefore.at} — refusing to apply it twice`,
    });
  }
  const heldBefore = track.pending.find((p) => p.id === eventId);
  if (heldBefore) {
    return refuse(track, {
      id: eventId,
      milestone: name,
      at: when,
      code: "duplicate",
      message: `event ${eventId} is already held pending ${rankLabel(heldBefore.rank)} — refusing a second copy`,
    });
  }

  if (isException) {
    return openException(track, { id: eventId, at: when, kind, detail: detail ?? note, severity, leg, source });
  }

  const legIndex = legIndexFor(track, leg, eventId);

  if (legIndex < track.currentLeg) {
    return refuse(track, {
      id: eventId,
      milestone: name,
      at: when,
      code: "stale_leg",
      message: `event ${eventId} reports "${name}" on leg ${legIndex}, but the shipment has already reached leg ${track.currentLeg} — a milestone from a finished leg is refused`,
    });
  }

  const lastRecorded = track.position >= 0 ? MILESTONES[track.position] : null;
  if (legIndex === track.currentLeg && rank < track.position) {
    return refuse(track, {
      id: eventId,
      milestone: name,
      at: when,
      code: "backwards",
      message: `event ${eventId}: "${name}" cannot follow "${lastRecorded}" — a milestone earlier than the last recorded one is refused`,
    });
  }

  if (legIndex === track.currentLeg && rank > track.position + 1) {
    const waitingFor = MILESTONES.slice(track.position + 1, rank);
    const twin = track.pending.find((p) => p.leg === legIndex && p.rank === rank);
    if (twin) {
      return refuse(track, {
        id: eventId,
        milestone: name,
        at: when,
        code: "already_pending",
        message: `event ${twin.id} already holds "${name}" on leg ${legIndex} — event ${eventId} would duplicate a held milestone`,
      });
    }
    const next = clone(track);
    const held = { id: eventId, milestone: name, rank, leg: legIndex, at: when, note, source };
    next.pending = [...next.pending, held].sort((a, b) => a.leg - b.leg || a.rank - b.rank);
    return {
      track: next,
      event: held,
      status: "held",
      applied: false,
      refusal: null,
      released: [],
      waitingFor,
      message: `"${name}" is held until ${waitingFor.map((m) => `"${m}"`).join(", ")} arrive(s)`,
    };
  }

  const next = clone(track);
  if (legIndex > track.currentLeg) {
    // A later leg has begun: the earlier legs are closed, and anything still held for them can
    // never be released in order. It is stranded, and said so, rather than deleted.
    const stranded = next.pending.filter((p) => p.leg < legIndex);
    next.pending = next.pending.filter((p) => p.leg >= legIndex);
    next.stranded = [...next.stranded, ...stranded.map((p) => ({ ...p, reason: `leg ${p.leg} closed before "${p.milestone}" arrived` }))];
  }

  next.currentLeg = legIndex;
  next.position = rank;
  next.sequence = track.sequence + 1;
  const entry = { sequence: next.sequence, type: "milestone", milestone: name, at: when, leg: legIndex, note, source, id: eventId };
  next.history = [...track.history, entry];
  next.milestones = [...track.milestones, name];
  next.lastEventAt = laterOf(track.lastEventAt, when);

  const released = drainPending(next);
  return { track: next, event: entry, status: "applied", applied: true, refusal: null, released };
}

/** Which leg a stall is measured against: the caller's clock, else the last thing we heard. */
function reference(track, at) {
  if (at !== null && at !== undefined && at !== "") return stamp(at, "at");
  const last = track.lastEventAt ?? track.openedAt ?? null;
  if (!last) throw new Error("at is required — the track has no event and no opening time to measure from");
  return last;
}

function severityFor(hoursLate, stallHours) {
  if (hoursLate >= stallHours * STALL_BANDS.critical) return "critical";
  if (hoursLate >= stallHours * STALL_BANDS.late) return "late";
  return "watch";
}

/**
 * Which open legs have missed their promised arrival, and by how much.
 *
 * A leg is open until a later leg begins or the shipment is delivered. Only open legs that were due
 * are listed: a leg whose arrival is still in the future is not stalled, it is on schedule. A leg
 * carrying an unresolved exception is left out entirely — escalation is paused for it, not hidden,
 * because the exception itself is on the track and on the dashboard.
 */
export function detectStalls(track, { at = null, stallHours = 36 } = {}) {
  assertTrack(track, "stall detection needs a track");

  const hours = Number(stallHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`stallHours must be a positive number of hours, got "${stallHours}"`);
  }
  const now = new Date(reference(track, at)).getTime();

  if (track.milestones.includes("delivered")) return [];

  const paused = new Set(track.exceptions.filter((e) => !e.resolvedAt).map((e) => e.leg));
  const stalls = [];

  for (const leg of track.legs) {
    if (leg.index < track.currentLeg) continue; // closed: a later leg has begun
    if (paused.has(leg.index)) continue; // an open exception holds escalation for this leg
    const arriveMs = new Date(leg.arriveAt).getTime();
    if (arriveMs > now) continue; // not due yet
    if (new Date(leg.departAt).getTime() > now) continue; // cannot be late before it starts

    const hoursLate = round2((now - arriveMs) / HOUR);
    if (!(hoursLate > 0)) continue;

    stalls.push({
      leg: leg.index,
      name: leg.name,
      from: leg.from,
      to: leg.to,
      mode: leg.mode,
      expectedArriveAt: leg.arriveAt,
      hoursLate,
      severity: severityFor(hoursLate, hours),
    });
  }
  return stalls;
}

/**
 * Raise an exception. It may be raised at any point in the move — the monotonic guard does not apply
 * to it — and it never moves the milestone position. Severity decides how loud the dashboard is.
 */
export function exceptionOn(track, { at, kind, detail = "", severity = "major", leg = null, id = null, source = "unknown" } = {}) {
  assertTrack(track, "an exception needs the track it happened on");
  const when = stamp(at, "at");
  const excId = String(id ?? `exc_${track.shipmentId}_${track.sequence + 1}`);
  return openException(track, { id: excId, at: when, kind, detail, severity, leg, source });
}

/**
 * Close an exception with its resolution. A resolution is mandatory: closing a customs hold without
 * saying how it was cleared leaves a record that lies about what happened. Closing twice is refused.
 * The moment it is resolved the leg goes back into stall arithmetic, as late as it always was.
 */
export function resolveException(track, { id, at, resolution = "" } = {}) {
  assertTrack(track, "resolving an exception needs the track it happened on");

  const excId = String(id ?? "").trim();
  if (!excId) throw new Error("resolving an exception requires its id");
  const when = stamp(at, "at");

  const target = track.exceptions.find((e) => e.id === excId);
  if (!target) throw new Error(`exception ${excId} is not on shipment ${track.shipmentId} — nothing to resolve`);
  if (target.resolvedAt) throw new Error(`exception ${excId} was already resolved at ${target.resolvedAt}`);

  const text = String(resolution ?? "").trim();
  if (!text) throw new Error(`resolving exception ${excId} requires a resolution — closing it without a reason proves nothing`);

  const next = clone(track);
  next.sequence = track.sequence + 1;
  const exception = { ...target, resolvedAt: when, resolution: text, resolvedSequence: next.sequence };
  next.exceptions = track.exceptions.map((e) => (e.id === excId ? exception : e));
  next.history = [
    ...track.history,
    {
      sequence: next.sequence,
      type: "resolution",
      milestone: EXCEPTION,
      exceptionId: excId,
      at: when,
      leg: target.leg,
      note: text,
      source: target.source,
      id: `${excId}:resolved`,
    },
  ];
  next.lastEventAt = laterOf(track.lastEventAt, when);
  return { track: next, exception };
}

/**
 * What a dashboard tile needs, in one call.
 *
 * Delivery wins: a delivered shipment is delivered even if a claim is still open, and openExceptions
 * still reports the claim. Otherwise a critical exception or a critical stall escalates; any open
 * exception or any overdue leg is at risk; nothing at all is on time. `at` is optional — without it
 * the last event heard is used, so the function stays clock-free.
 */
export function health(track, { at = null, stallHours = 36 } = {}) {
  assertTrack(track, "health needs a track");

  const ref = at ?? track.lastEventAt ?? track.openedAt ?? null;
  const stalls = ref ? detectStalls(track, { at: ref, stallHours }) : [];
  const open = track.exceptions.filter((e) => !e.resolvedAt);
  const delivered = track.milestones.includes("delivered");

  const critical = open.some((e) => e.severity === "critical") || stalls.some((s) => s.severity === "critical");
  const state = delivered ? "delivered" : critical ? "escalated" : open.length > 0 || stalls.length > 0 ? "at_risk" : "on_time";

  return {
    state,
    openExceptions: open.length,
    lateLegs: stalls.length,
    lastEventAt: track.lastEventAt ?? null,
    stalls,
  };
}
