/**
 * ETA engine — every estimate carries its basis.
 * An ETA without a printed basis is a guess, so the engine returns the segments,
 * the assumptions used and the reason for the last change alongside the time.
 */

const MIN = 60 * 1000;

/** Segment: distance km, planned speed, dwell hours, and where the number came from. */
export function corridor(segments) {
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("at least one segment required");
  return segments.map((s, i) => {
    if (!(s.km >= 0)) throw new Error(`segment ${i}: km required`);
    if (!(s.speedKph > 0)) throw new Error(`segment ${i}: speedKph required`);
    return {
      name: s.name ?? `segment ${i + 1}`,
      km: s.km,
      speedKph: s.speedKph,
      dwellHours: s.dwellHours ?? 0,
      border: s.border ?? false,
      source: s.source ?? "planner default",
    };
  });
}

export function planEta({ segments, departAt, customsHours = 0, bufferPct = 0.08 }) {
  const legs = corridor(segments).map((s) => {
    const driveHours = s.km / s.speedKph;
    return { ...s, driveHours: Math.round(driveHours * 100) / 100, hours: Math.round((driveHours + s.dwellHours) * 100) / 100 };
  });
  const driveHours = legs.reduce((a, l) => a + l.driveHours, 0);
  const dwellHours = legs.reduce((a, l) => a + l.dwellHours, 0);
  const baseHours = driveHours + dwellHours + customsHours;
  const bufferHours = baseHours * bufferPct;
  const totalHours = baseHours + bufferHours;
  const depart = new Date(departAt).getTime();
  if (Number.isNaN(depart)) throw new Error("departAt must be a date");
  const eta = new Date(depart + totalHours * 3600 * 1000);

  return {
    departAt: new Date(depart).toISOString(),
    eta: eta.toISOString(),
    etaHours: Math.round(totalHours * 100) / 100,
    confidence: confidenceFor(legs, customsHours),
    basis: {
      legs: legs.map((l) => ({ name: l.name, km: l.km, speedKph: l.speedKph, dwellHours: l.dwellHours, border: l.border, source: l.source })),
      driveHours: round2(driveHours),
      dwellHours: round2(dwellHours),
      customsHours,
      bufferPct,
      bufferHours: round2(bufferHours),
    },
    changes: [],
  };
}

function confidenceFor(legs, customsHours) {
  const borders = legs.filter((l) => l.border).length;
  const modelled = legs.filter((l) => l.source === "planner default").length;
  let score = 0.9 - borders * 0.1 - modelled * 0.03 - (customsHours > 24 ? 0.1 : 0);
  return Math.max(0.35, Math.min(0.95, Math.round(score * 100) / 100));
}

/**
 * Recompute after an event. The previous ETA is kept as history with the cause,
 * never overwritten silently — a client who was told Thursday deserves to see why it moved.
 */
export function applyEvent(plan, event) {
  const { type, delayHours = 0, at, note = "" } = event;
  if (!type) throw new Error("event type required");
  const from = new Date(plan.eta).getTime();
  const shift = (h) => new Date(from + h * 3600 * 1000);

  const changes = [...plan.changes];
  const next = { ...plan };
  switch (type) {
    case "departure":
      next.departAt = new Date(at).toISOString();
      break;
    case "delay":
      next.eta = shift(delayHours).toISOString();
      changes.push({ type, at: at ?? new Date().toISOString(), delayHours, note, previousEta: plan.eta, newEta: next.eta });
      next.confidence = Math.max(0.35, round2(plan.confidence - 0.05));
      break;
    case "border-queue":
      next.eta = shift(delayHours).toISOString();
      changes.push({ type, at: at ?? new Date().toISOString(), delayHours, note, previousEta: plan.eta, newEta: next.eta });
      next.confidence = Math.max(0.35, round2(plan.confidence - 0.1));
      break;
    case "delivered":
      next.status = "delivered";
      next.eta = new Date(at).toISOString();
      next.confidence = 1;
      changes.push({ type, at, note, previousEta: plan.eta, newEta: next.eta });
      break;
    default:
      throw new Error(`unknown event type ${type}`);
  }
  next.changes = changes;
  next.etaHours = round2((new Date(next.eta).getTime() - new Date(next.departAt).getTime()) / (3600 * 1000));
  return next;
}

const round2 = (n) => Math.round(n * 100) / 100;
export { MIN, round2 };
