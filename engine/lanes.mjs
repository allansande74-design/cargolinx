/**
 * The lanes, in both directions.
 *
 * Import runs port-inward: Mombasa to Kampala, Mombasa to Nairobi, Nairobi to Kigali. Export runs the
 * same tarmac the other way. A lane is a list of legs with a distance and a planning speed, so the
 * reverse is the same legs in the opposite order with each leg's own name turned round - the kilometres
 * do not change, and the borders do not move.
 *
 * What does change is the paperwork, and the desk says so rather than letting the symmetry imply
 * otherwise: an export declaration is lodged before the truck reaches the border, an import entry after
 * it, and the export consignment carries no Kenyan import duty at all. Those are the facts that make an
 * export quote a different document from an import quote, not the distance.
 *
 * Pure data and pure functions: no clock, no network, safe in a browser and in a test.
 */

export const LANES = Object.freeze({
  "Mombasa - Kampala": [
    { name: "Mombasa - Nairobi", km: 485, speedKph: 50 },
    { name: "Nairobi - Eldoret", km: 320, speedKph: 55 },
    { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
    { name: "Malaba - Kampala", km: 250, speedKph: 45 },
  ],
  "Nairobi - Kampala": [
    { name: "Nairobi - Eldoret", km: 320, speedKph: 55 },
    { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
    { name: "Malaba - Kampala", km: 250, speedKph: 45 },
  ],
  "Mombasa - Nairobi": [{ name: "Mombasa - Nairobi", km: 485, speedKph: 50 }],
  "Nairobi - Kigali": [
    { name: "Nairobi - Eldoret", km: 320, speedKph: 55 },
    { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
    { name: "Malaba - Kampala", km: 250, speedKph: 45 },
    { name: "Kampala - Kigali", km: 510, speedKph: 50, border: true },
  ],
});

/** "Mombasa - Kampala" becomes "Kampala - Mombasa"; anything without a dash is returned unchanged. */
export function reverseName(name) {
  const parts = String(name || "").split(" - ");
  if (parts.length !== 2) return String(name || "");
  return `${parts[1]} - ${parts[0]}`;
}

/** One leg the other way round: same road, same kilometres, same speed, same border. */
export function reverseLeg(leg) {
  return { ...leg, name: reverseName(leg.name) };
}

/**
 * A lane the other way: the legs in reverse order, each turned round. Reversing the order alone would
 * name a road that does not exist on the last leg, and turning each leg alone would drive Ndalu to
 * Mombasa first.
 */
export function reverseLane(legs) {
  return [...legs].reverse().map(reverseLeg);
}

/** Total kilometres on a lane. */
export function laneKm(legs) {
  return (legs || []).reduce((sum, l) => sum + (Number(l.km) || 0), 0);
}

/** Driving hours at the printed planning speeds, with a rest allowance the caller names. */
export function laneHours(legs, { restHours = 0 } = {}) {
  const driving = (legs || []).reduce((sum, l) => sum + (Number(l.km) || 0) / (Number(l.speedKph) || 50), 0);
  return driving + restHours;
}

export function borderCount(legs) {
  return (legs || []).filter((l) => l.border).length;
}

/**
 * Every lane and its reverse, keyed by the direction's own name. Where two imports share a road
 * (Mombasa - Kampala and Mombasa - Nairobi both run Mombasa - Nairobi first) the export key simply
 * appears once, because it is the same road and quoting it twice would only confuse the desk.
 */
export function lanesBothWays(lanes = LANES) {
  const out = {};
  for (const [name, legs] of Object.entries(lanes)) {
    const back = reverseLane(legs);
    const key = reverseName(name);
    if (!out[key]) out[key] = back;
  }
  return out;
}

/** The export view of the table: direction, kilometres, hours, borders crossed. */
export function exportLaneRows(lanes = LANES, { restHours = 0 } = {}) {
  return Object.entries(lanesBothWays(lanes)).map(([name, legs]) => ({
    name,
    legs: legs.length,
    km: Math.round(laneKm(legs)),
    hours: Math.round(laneHours(legs, { restHours }) * 10) / 10,
    borders: borderCount(legs),
    route: legs.map((l) => l.name).join(" · "),
  }));
}
