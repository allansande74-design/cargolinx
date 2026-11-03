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

/* ------------------------------------------------------------------ reversing a shipment */

const key = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The lane that runs from one place to another, by the lane table's own names. */
export function laneBetween(from, to, lanes = LANES) {
  const want = `${key(from)} - ${key(to)}`;
  for (const [name, legs] of Object.entries(lanes)) {
    if (key(name) === want) return { name, legs };
  }
  // The reverse direction is not a second entry in the table - it is the same lane turned round.
  for (const [name, legs] of Object.entries(lanes)) {
    if (key(reverseName(name)) === want) return { name: reverseName(name), legs: reverseLane(legs) };
  }
  return null;
}

/**
 * A shipment as the desk holds it, read the other way.
 *
 * The point is not to invent an export order out of an import one - the cargo, the parties and the money
 * change - but to answer the question an operator actually asks: "if this load were going back, which lane
 * would it run and how long is it?" So the two place names swap, the lane is looked up by name, and when
 * no lane runs that way the answer says so instead of assembling a route from fragments.
 */
export function reverseShipment(shipment, lanes = LANES) {
  const from = String(shipment?.destination ?? "").trim();
  const to = String(shipment?.origin ?? "").trim();
  const lane = from && to ? laneBetween(from, to, lanes) : null;
  return {
    id: shipment?.id ?? null,
    asCarried: `${shipment?.origin ?? "?"} → ${shipment?.destination ?? "?"}`,
    reversed: `${from || "?"} → ${to || "?"}`,
    laneName: lane?.name ?? null,
    km: lane ? Math.round(laneKm(lane.legs)) : null,
    hours: lane ? Math.round(laneHours(lane.legs) * 10) / 10 : null,
    borders: lane ? borderCount(lane.legs) : null,
    cargo: shipment?.cargo ?? "",
    weightKg: Number(shipment?.weightKg) || 0,
    goodsUsd: Number(shipment?.value?.goods) || 0,
    reason: lane ? null : `No lane runs ${from || "?"} to ${to || "?"} in the desk's table, so no distance is claimed.`,
  };
}

/* ------------------------------------------------------------------ the sea leg, on to China */

/**
 * Imported goods come from China; an export to China runs the whole corridor the other way, inland to
 * Mombasa and then across the water. The sea distance is computed rather than typed: great circle between
 * the two ports, plus a routing allowance for the fact that a ship does not sail the straight line.
 *
 * What is deliberately not here is a carrier's transit time or a freight rate. Sea days are the passage
 * at a stated speed and exclude port calls, canal and berthing - a service's own quoted transit is longer,
 * and the operator types that in. No Chinese duty is quoted at all: the desk holds no Chinese tariff.
 */
export const ROUTING_FACTOR = 1.15;
export const SERVICE_KNOTS = 16;

export const CHINA_PORTS = Object.freeze({
  Shanghai: { country: "CN", lat: 31.2304, lon: 121.4737 },
  Ningbo: { country: "CN", lat: 29.8683, lon: 121.544 },
  Shenzhen: { country: "CN", lat: 22.5431, lon: 114.0579 },
  Guangzhou: { country: "CN", lat: 22.75, lon: 113.6 },
  Tianjin: { country: "CN", lat: 38.98, lon: 117.7 },
});

export const MOMBASA = { country: "KE", lat: -4.0435, lon: 39.6682 };

/** Great-circle distance in nautical miles. */
export function greatCircleNm(a, b) {
  const R = 3440.065;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The planning sea distance: the straight line plus the routing allowance. */
export function planningNm(a, b, factor = ROUTING_FACTOR) {
  return greatCircleNm(a, b) * factor;
}

/** Sea passage at the stated service speed, in days; excludes port calls, canal and berthing. */
export function seaDays(nm, knots = SERVICE_KNOTS) {
  return nm / (knots * 24);
}

/**
 * An export corridor: a reversed inland lane, then the sea leg to a Chinese port. The two halves keep
 * their own units - kilometres on the road, nautical miles at sea - because adding them would produce a
 * number that means nothing.
 */
export function corridorToChina(laneName, portName, lanes = LANES, ports = CHINA_PORTS) {
  const direct = laneName ? lanes[laneName] : null;
  const inland = direct
    ? reverseLane(direct)
    : laneBetween(...String(laneName || "").split(" - "), lanes)?.legs ?? null;
  const port = ports[portName];
  if (!inland) return null;
  if (!port) return null;
  const nm = planningNm(MOMBASA, port);
  return {
    laneName,
    portName,
    legs: inland,
    inlandKm: Math.round(laneKm(inland)),
    drivingHours: Math.round(laneHours(inland) * 10) / 10,
    borders: borderCount(inland),
    nm: Math.round(nm),
    seaDays: Math.round(seaDays(nm) * 10) / 10,
    greatCircleNm: Math.round(greatCircleNm(MOMBASA, port)),
  };
}

/** The same corridor read from the other end: China to the Kenyan port. */
export function chinaLaneRows(ports = CHINA_PORTS) {
  return Object.entries(ports).map(([name, port]) => {
    const nm = planningNm(MOMBASA, port);
    return {
      name: `Mombasa - ${name}`,
      nm: Math.round(nm),
      greatCircleNm: Math.round(greatCircleNm(MOMBASA, port)),
      seaDays: Math.round(seaDays(nm) * 10) / 10,
      country: port.country,
    };
  });
}
