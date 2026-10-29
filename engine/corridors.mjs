/**
 * International corridor planner — factory gate to partner warehouse.
 *
 * The honest position: the desk holds no live carrier feed and no booking API. Every lane and
 * every inland leg below is a planning model with a printed basis; nothing here is a confirmed
 * sailing, a reserved slot, a rate, or a measured border queue. Where a border post could not be
 * named with confidence the array is left empty and the gap is printed in `assumptions` instead
 * of being filled with a plausible-sounding guess.
 *
 * Pure and browser-safe: plain data, no network, no clock reads (every time comes from the caller).
 */

const HOUR_MS = 3600 * 1000;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString();
const clean = (s) => String(s ?? "").trim().toLowerCase();

/** Refusals are named: the caller gets a code and a sentence it can show a client. */
function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  err.reason = message;
  throw err;
}

function parseTime(value, label) {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (value === null || value === undefined || value === "" || Number.isNaN(ms)) {
    refuse("BAD_TIME", `${label} must be a date (ISO string, Date or epoch ms)`);
  }
  return ms;
}

export const CORRIDOR_META = Object.freeze({
  asOf: "2026-10-29",
  coverage: "China, India and Gulf load ports to East, Southern and West African discharge ports",
  basisStatement:
    "Transit days are indicative carrier-schedule bands seen on the desk, not a booked sailing. Inland hours are planning speeds for a laden truck, not a tracked vehicle.",
  notClaimed: [
    "No carrier booking, slot, equipment or rate is held by this module.",
    "No border queue is measured; border delay is an assumption the quote must disclose.",
    "No transit time here is a commitment to a client.",
  ],
});

/* ------------------------------------------------------------------ ports */

export const PORTS = Object.freeze(
  [
    { code: "CNSHA", name: "Shanghai", country: "CN", type: "load", city: "Shanghai", notes: "Yangshan deep-water terminals; feeder to the mainline berths." },
    { code: "CNNGB", name: "Ningbo", country: "CN", type: "load", city: "Ningbo", notes: "Ningbo-Zhoushan; the busiest load port on this file." },
    { code: "CNSZX", name: "Shenzhen (Yantian)", country: "CN", type: "load", city: "Shenzhen", notes: "Yantian and Shekou; the usual gate for Pearl River Delta factories." },
    { code: "INNSA", name: "Nhava Sheva", country: "IN", type: "load", city: "Nhava Sheva", notes: "JNPT; West India gateway." },
    { code: "AEJEA", name: "Jebel Ali", country: "AE", type: "load", city: "Jebel Ali", notes: "Gulf hub with direct feeder calls to East Africa." },
    { code: "KEMBA", name: "Mombasa", country: "KE", type: "discharge", city: "Mombasa", notes: "Northern Corridor gateway for Kenya, Uganda, Rwanda, South Sudan." },
    { code: "TZDAR", name: "Dar es Salaam", country: "TZ", type: "discharge", city: "Dar es Salaam", notes: "Central Corridor gateway for Tanzania, Zambia, DRC, Rwanda, Burundi." },
    { code: "MZBEI", name: "Beira", country: "MZ", type: "discharge", city: "Beira", notes: "Beira Corridor to Zimbabwe and Zambia; dredged access, weather-sensitive." },
    { code: "ZADUR", name: "Durban", country: "ZA", type: "discharge", city: "Durban", notes: "Southern Africa hub; congestion at Pier 1/2 is a known variable." },
    { code: "NAWVB", name: "Walvis Bay", country: "NA", type: "discharge", city: "Walvis Bay", notes: "Trans-Kalahari and Trans-Cunene corridors." },
    { code: "MZMPT", name: "Maputo", country: "MZ", type: "discharge", city: "Maputo", notes: "Maputo Corridor; road and rail to Gauteng." },
    { code: "GHTEM", name: "Tema", country: "GH", type: "discharge", city: "Tema", notes: "Ghana gateway; no inland leg is modelled beyond the port on this file." },
    { code: "NGAPP", name: "Lagos (Apapa)", country: "NG", type: "discharge", city: "Lagos", notes: "Apapa/Tin Can; berth and road congestion are the main variables." },
  ].map(Object.freeze)
);

/* ------------------------------------------------------------- sea lanes */

/**
 * transitDays is a planning figure from the middle of the schedule band on the desk.
 * `confidence: "firm"` means the service is a published weekly/direct call on this file —
 * firm for planning only, still not a booking.
 */
export const SEA_LANES = Object.freeze(
  [
    { id: "CNSHA-KEMBA", from: "CNSHA", to: "KEMBA", transitDays: 30, band: [28, 35], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Shanghai to Mombasa via Singapore, 28-35 days" },
    { id: "CNSHA-TZDAR", from: "CNSHA", to: "TZDAR", transitDays: 32, band: [30, 38], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Shanghai to Dar es Salaam via Singapore, 30-38 days" },
    { id: "CNSHA-ZADUR", from: "CNSHA", to: "ZADUR", transitDays: 30, band: [28, 34], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Shanghai to Durban, 28-34 days" },
    { id: "CNSHA-MZBEI", from: "CNSHA", to: "MZBEI", transitDays: 35, band: [32, 40], via: "Singapore, Beira range", confidence: "indicative", basis: "carrier schedule, indicative — Shanghai to Beira, 32-40 days; Beira calls are less frequent" },
    { id: "CNSHA-GHTEM", from: "CNSHA", to: "GHTEM", transitDays: 44, band: [40, 48], via: "Suez, Algeciras", confidence: "indicative", basis: "carrier schedule, indicative — Shanghai to Tema via Suez, 40-48 days" },
    { id: "CNSHA-NGAPP", from: "CNSHA", to: "NGAPP", transitDays: 40, band: [36, 45], via: "Suez", confidence: "indicative", basis: "carrier schedule, indicative — Shanghai to Lagos (Apapa) via Suez, 36-45 days" },

    { id: "CNNGB-KEMBA", from: "CNNGB", to: "KEMBA", transitDays: 31, band: [29, 36], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Ningbo to Mombasa via Singapore, 29-36 days" },
    { id: "CNNGB-TZDAR", from: "CNNGB", to: "TZDAR", transitDays: 33, band: [31, 39], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Ningbo to Dar es Salaam via Singapore, 31-39 days" },
    { id: "CNNGB-NAWVB", from: "CNNGB", to: "NAWVB", transitDays: 33, band: [30, 38], via: "Singapore, Cape", confidence: "indicative", basis: "carrier schedule, indicative — Ningbo to Walvis Bay, 30-38 days" },

    { id: "CNSZX-KEMBA", from: "CNSZX", to: "KEMBA", transitDays: 28, band: [26, 32], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Yantian to Mombasa via Singapore, 26-32 days" },
    { id: "CNSZX-MZBEI", from: "CNSZX", to: "MZBEI", transitDays: 34, band: [31, 39], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Yantian to Beira, 31-39 days" },
    { id: "CNSZX-ZADUR", from: "CNSZX", to: "ZADUR", transitDays: 29, band: [27, 33], via: "Singapore", confidence: "indicative", basis: "carrier schedule, indicative — Yantian to Durban, 27-33 days" },
    { id: "CNSZX-NAWVB", from: "CNSZX", to: "NAWVB", transitDays: 32, band: [29, 37], via: "Singapore, Cape", confidence: "indicative", basis: "carrier schedule, indicative — Yantian to Walvis Bay, 29-37 days" },
    { id: "CNSZX-GHTEM", from: "CNSZX", to: "GHTEM", transitDays: 42, band: [38, 47], via: "Suez", confidence: "indicative", basis: "carrier schedule, indicative — Yantian to Tema via Suez, 38-47 days" },
    { id: "CNSZX-NGAPP", from: "CNSZX", to: "NGAPP", transitDays: 38, band: [35, 43], via: "Suez", confidence: "indicative", basis: "carrier schedule, indicative — Yantian to Lagos (Apapa) via Suez, 35-43 days" },

    { id: "INNSA-KEMBA", from: "INNSA", to: "KEMBA", transitDays: 14, band: [12, 17], via: "direct", confidence: "indicative", basis: "carrier schedule, indicative — Nhava Sheva to Mombasa direct, 12-17 days" },
    { id: "INNSA-TZDAR", from: "INNSA", to: "TZDAR", transitDays: 16, band: [14, 19], via: "direct", confidence: "indicative", basis: "carrier schedule, indicative — Nhava Sheva to Dar es Salaam direct, 14-19 days" },

    { id: "AEJEA-KEMBA", from: "AEJEA", to: "KEMBA", transitDays: 12, band: [11, 14], via: "direct", confidence: "firm", basis: "published weekly direct Jebel Ali-Mombasa feeder, firm for planning — slot and equipment still not reserved" },
    { id: "AEJEA-TZDAR", from: "AEJEA", to: "TZDAR", transitDays: 14, band: [12, 17], via: "direct", confidence: "indicative", basis: "carrier schedule, indicative — Jebel Ali to Dar es Salaam, 12-17 days" },
    { id: "AEJEA-ZADUR", from: "AEJEA", to: "ZADUR", transitDays: 21, band: [18, 24], via: "direct", confidence: "indicative", basis: "carrier schedule, indicative — Jebel Ali to Durban, 18-24 days" },
  ].map(Object.freeze)
);

/* ----------------------------------------------------------- inland legs */

/**
 * One leg per discharge port and destination. transitHours is door-to-door driving plus the
 * border delay named in borderHours — the two are never counted twice in a plan.
 * borderPosts is empty wherever the crossing could not be named with confidence; the plan prints
 * that gap in `assumptions` rather than inventing a post.
 */
export const INLAND_LEGS = Object.freeze(
  [
    /* Mombasa — Northern Corridor */
    {
      id: "KEMBA-NAIROBI", from: "KEMBA", to: "Nairobi", mode: "road", distanceKm: 485, transitHours: 10,
      borderPosts: [], borderHours: { hours: 0, basis: "assumption: no international border between Mombasa and Nairobi; 0 h allowed" },
      basis: "road linehaul, Mombasa-Nairobi highway, daily departures; running time for a laden 40ft", confidence: "firm",
    },
    {
      id: "KEMBA-KAMPALA", from: "KEMBA", to: "Kampala", mode: "road", distanceKm: 1170, transitHours: 28,
      borderPosts: ["Malaba"], borderHours: { hours: 8, basis: "assumption: 8 h at Malaba (one-stop border post), not a measured queue" },
      basis: "road linehaul via Nairobi, Eldoret and Malaba; 20 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "KEMBA-KIGALI", from: "KEMBA", to: "Kigali", mode: "road", distanceKm: 1680, transitHours: 44,
      borderPosts: ["Malaba", "Katuna"], borderHours: { hours: 10, basis: "assumption: 5 h at each of Malaba and Katuna, not a measured queue" },
      basis: "road linehaul via Kampala and Katuna; 34 h driving plus assumed border delay", confidence: "indicative",
    },

    /* Dar es Salaam — Central Corridor */
    {
      id: "TZDAR-DAR-ES-SALAAM", from: "TZDAR", to: "Dar es Salaam", mode: "road", distanceKm: 12, transitHours: 1,
      borderPosts: [], borderHours: { hours: 0, basis: "assumption: port gate to city delivery points, no border; 0 h allowed" },
      basis: "drayage from the port gate to city delivery points", confidence: "firm",
    },
    {
      id: "TZDAR-NAIROBI", from: "TZDAR", to: "Nairobi", mode: "road", distanceKm: 1090, transitHours: 26,
      borderPosts: ["Namanga"], borderHours: { hours: 5, basis: "assumption: 5 h at Namanga, not a measured queue" },
      basis: "road via Arusha and Namanga; 21 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "TZDAR-KAMPALA", from: "TZDAR", to: "Kampala", mode: "road", distanceKm: 1620, transitHours: 38,
      borderPosts: ["Mutukula"], borderHours: { hours: 8, basis: "assumption: 8 h at Mutukula, not a measured queue" },
      basis: "road via Morogoro, Mwanza and Mutukula; 30 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "TZDAR-KIGALI", from: "TZDAR", to: "Kigali", mode: "road", distanceKm: 1450, transitHours: 36,
      borderPosts: ["Rusumo"], borderHours: { hours: 6, basis: "assumption: 6 h at Rusumo, not a measured queue" },
      basis: "road via Dodoma, Kahama and Rusumo; 30 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "TZDAR-LUSAKA", from: "TZDAR", to: "Lusaka", mode: "road", distanceKm: 1900, transitHours: 44,
      borderPosts: ["Nakonde/Tunduma"], borderHours: { hours: 8, basis: "assumption: 8 h at Nakonde/Tunduma, not a measured queue" },
      basis: "road via Mbeya and the Tunduma/Nakonde crossing (TAZARA rail is not modelled); 36 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "TZDAR-HARARE", from: "TZDAR", to: "Harare", mode: "road", distanceKm: 2350, transitHours: 54,
      borderPosts: ["Nakonde/Tunduma", "Chirundu"], borderHours: { hours: 12, basis: "assumption: 8 h at Nakonde/Tunduma plus 4 h at Chirundu, not measured" },
      basis: "road via Lusaka and Chirundu; 42 h driving plus assumed border delay", confidence: "indicative",
    },

    /* Beira — Beira Corridor */
    {
      id: "MZBEI-HARARE", from: "MZBEI", to: "Harare", mode: "road", distanceKm: 580, transitHours: 14,
      borderPosts: ["Machipanda"], borderHours: { hours: 6, basis: "assumption: 6 h at Machipanda, not a measured queue" },
      basis: "road via Manica and Machipanda; 8 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "MZBEI-LUSAKA", from: "MZBEI", to: "Lusaka", mode: "road", distanceKm: 1450, transitHours: 36,
      borderPosts: ["Machipanda", "Chirundu"], borderHours: { hours: 10, basis: "assumption: 6 h at Machipanda plus 4 h at Chirundu, not measured" },
      basis: "road via Harare and Chirundu; 26 h driving plus assumed border delay", confidence: "indicative",
    },

    /* Durban — Southern Africa */
    {
      id: "ZADUR-JOHANNESBURG", from: "ZADUR", to: "Johannesburg", mode: "road", distanceKm: 570, transitHours: 9,
      borderPosts: [], borderHours: { hours: 0, basis: "assumption: domestic South African move, no border; 0 h allowed" },
      basis: "road linehaul, N3 Durban-Johannesburg, daily departures; running time for a laden 40ft", confidence: "firm",
    },
    {
      id: "ZADUR-GABORONE", from: "ZADUR", to: "Gaborone", mode: "road", distanceKm: 850, transitHours: 16,
      borderPosts: ["Ramatlabama"], borderHours: { hours: 4, basis: "assumption: 4 h at Ramatlabama (SA/Botswana), not a measured queue" },
      basis: "road via Johannesburg and Ramatlabama; 12 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "ZADUR-MAPUTO", from: "ZADUR", to: "Maputo", mode: "road", distanceKm: 600, transitHours: 12,
      borderPosts: ["Ressano Garcia"], borderHours: { hours: 5, basis: "assumption: 5 h at Ressano Garcia (SA/Mozambique), not a measured queue" },
      basis: "road via Komatipoort and Ressano Garcia; 7 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "ZADUR-HARARE", from: "ZADUR", to: "Harare", mode: "road", distanceKm: 1700, transitHours: 36,
      borderPosts: ["Beitbridge"], borderHours: { hours: 8, basis: "assumption: 8 h at Beitbridge, not a measured queue; the post is the corridor's known constraint" },
      basis: "road via Polokwane and Beitbridge; 28 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "ZADUR-LUSAKA", from: "ZADUR", to: "Lusaka", mode: "road", distanceKm: 2300, transitHours: 48,
      borderPosts: ["Beitbridge", "Chirundu"], borderHours: { hours: 12, basis: "assumption: 8 h at Beitbridge plus 4 h at Chirundu, not measured" },
      basis: "road via Harare and Chirundu; 36 h driving plus assumed border delay; TAZARA and Beitbridge rail are not modelled", confidence: "indicative",
    },

    /* Walvis Bay — Trans-Kalahari and Trans-Cunene */
    {
      id: "NAWVB-GABORONE", from: "NAWVB", to: "Gaborone", mode: "road", distanceKm: 1500, transitHours: 22,
      borderPosts: ["Buitepos"], borderHours: { hours: 4, basis: "assumption: 4 h at Buitepos/Mamuno (Namibia/Botswana), not a measured queue" },
      basis: "road via Windhoek and the Trans-Kalahari highway; 18 h driving plus assumed border delay", confidence: "indicative",
    },
    {
      id: "NAWVB-JOHANNESBURG", from: "NAWVB", to: "Johannesburg", mode: "road", distanceKm: 1850, transitHours: 30,
      borderPosts: [], borderHours: { hours: 6, basis: "assumption: 6 h for two crossings on the Trans-Kalahari route" },
      basis: "road via Windhoek and the Trans-Kalahari; the South African crossing point varies by haulier, so no post is named", confidence: "indicative",
    },
    {
      id: "NAWVB-LUSAKA", from: "NAWVB", to: "Lusaka", mode: "road", distanceKm: 2250, transitHours: 40,
      borderPosts: ["Wenela (Katima Mulilo)"], borderHours: { hours: 6, basis: "assumption: 6 h at Wenela/Katima Mulilo (Namibia/Zambia), not a measured queue" },
      basis: "road via Rundu, Katima Mulilo and Sesheke; 34 h driving plus assumed border delay", confidence: "indicative",
    },
  ].map(Object.freeze)
);

/* ---------------------------------------------------------- factory gates */

/** Pre-carriage from a factory city to the load port. Modelled truck move, not a tracked vehicle. */
export const FACTORY_GATES = Object.freeze(
  [
    { city: "Guangzhou", port: "CNSZX", mode: "road", distanceKm: 150, transitHours: 4, borderPosts: [], basis: "gate truck move, Guangzhou-Pearl River Delta terminals; terminal cut-off dependent", confidence: "indicative" },
    { city: "Dongguan", port: "CNSZX", mode: "road", distanceKm: 60, transitHours: 2, borderPosts: [], basis: "gate truck move, Dongguan-Yantian; terminal cut-off dependent", confidence: "indicative" },
    { city: "Foshan", port: "CNSZX", mode: "road", distanceKm: 175, transitHours: 5, borderPosts: [], basis: "gate truck move, Foshan-Yantian; terminal cut-off dependent", confidence: "indicative" },
    { city: "Yiwu", port: "CNNGB", mode: "road", distanceKm: 185, transitHours: 4.5, borderPosts: [], basis: "gate truck move, Yiwu-Ningbo; the export consolidator's cut-off governs", confidence: "indicative" },
    { city: "Hangzhou", port: "CNNGB", mode: "road", distanceKm: 170, transitHours: 3.5, borderPosts: [], basis: "gate truck move, Hangzhou-Ningbo; terminal cut-off dependent", confidence: "indicative" },
    { city: "Suzhou", port: "CNSHA", mode: "road", distanceKm: 100, transitHours: 2.5, borderPosts: [], basis: "gate truck move, Suzhou-Shanghai; terminal cut-off dependent", confidence: "indicative" },
    { city: "Kunshan", port: "CNSHA", mode: "road", distanceKm: 70, transitHours: 2, borderPosts: [], basis: "gate truck move, Kunshan-Shanghai; terminal cut-off dependent", confidence: "indicative" },
    { city: "Mumbai", port: "INNSA", mode: "road", distanceKm: 45, transitHours: 1.5, borderPosts: [], basis: "gate truck move, Mumbai-Nhava Sheva; port road congestion is the variable", confidence: "indicative" },
    { city: "Dubai", port: "AEJEA", mode: "road", distanceKm: 40, transitHours: 1, borderPosts: [], basis: "gate truck move, Dubai-Jebel Ali; free-zone gate formalities not modelled", confidence: "indicative" },
  ].map(Object.freeze)
);

export const DEFAULT_DWELL_HOURS = Object.freeze({ load: 48, discharge: 72 });

/** Destination cities the desk has a modelled inland leg to. */
export const DESTINATIONS = Object.freeze([...new Set(INLAND_LEGS.map((l) => l.to))]);

/* -------------------------------------------------------------- lookups */

export function portByCode(code) {
  const port = PORTS.find((p) => p.code === String(code ?? "").toUpperCase());
  if (!port) refuse("NO_PORT", `unknown port code ${code}`);
  return port;
}

/** Lanes from one port, optionally to one port, optionally narrowed by a lane selector. */
export function seaLanes({ from, to } = {}) {
  return SEA_LANES.filter(
    (l) => (!from || l.from === String(from).toUpperCase()) && (!to || l.to === String(to).toUpperCase())
  );
}

export function inlandLegsTo(city) {
  const key = clean(city);
  return INLAND_LEGS.filter((l) => clean(l.to) === key);
}

/* ------------------------------------------------------------- planning */

export function planInternational({ originCity, destinationCity, departAt, seaLane = null, dwellHours } = {}) {
  const origin = resolveOrigin(originCity);
  const destination = resolveDestination(destinationCity);
  const dwell = normaliseDwell(dwellHours);
  const departMs = parseTime(departAt, "departAt");
  const choice = chooseRoute({ origin, destination, seaLane, dwell });

  const loadPort = portByCode(choice.lane.from);
  const dischargePort = portByCode(choice.lane.to);

  const legs = [];
  const customsStops = [];
  const assumptions = [
    "No carrier booking, slot, equipment or rate is confirmed by this plan; every time is a planning model.",
  ];

  let cursor = departMs;
  const pushLeg = (spec) => {
    const start = cursor;
    const end = start + spec.hours * HOUR_MS;
    legs.push({
      mode: spec.mode,
      from: spec.from,
      to: spec.to,
      departAt: iso(start),
      arriveAt: iso(end),
      hours: round2((end - start) / HOUR_MS),
      basis: spec.basis,
      confidence: spec.confidence,
      ...(spec.extra ?? {}),
    });
    cursor = end;
  };
  const pushStop = (spec) => {
    const start = cursor;
    const end = start + spec.hours * HOUR_MS;
    customsStops.push({
      at: spec.at,
      kind: spec.kind,
      hours: round2((end - start) / HOUR_MS),
      basis: spec.basis,
      startAt: iso(start),
      endAt: iso(end),
    });
    cursor = end;
  };

  if (origin.gate) {
    pushLeg({
      mode: "road",
      from: origin.city,
      to: origin.port.name,
      hours: origin.gate.transitHours,
      basis: origin.gate.basis,
      confidence: origin.gate.confidence,
      extra: { distanceKm: origin.gate.distanceKm, kind: "pre-carriage", borderPosts: origin.gate.borderPosts },
    });
    assumptions.push(
      `Pre-carriage ${origin.city} -> ${origin.port.name}: ${origin.gate.distanceKm} km, ${origin.gate.transitHours} h by truck (${origin.gate.basis}); no live telematics.`
    );
  } else {
    assumptions.push(`Origin ${origin.city} is the load port itself; no pre-carriage is modelled.`);
  }

  pushStop({
    at: loadPort.name,
    kind: "export",
    hours: dwell.load,
    basis: `assumption: ${dwell.load} h at ${loadPort.name} for export clearance and terminal cut-off — a desk default, not a measured clearance`,
  });

  pushLeg({
    mode: "sea",
    from: loadPort.name,
    to: dischargePort.name,
    hours: choice.lane.transitDays * 24,
    basis: choice.lane.basis,
    confidence: choice.lane.confidence,
    extra: {
      transitDays: choice.lane.transitDays,
      transitDaysBand: choice.lane.band,
      via: choice.lane.via,
      laneId: choice.lane.id,
    },
  });
  assumptions.push(
    `Sea ${loadPort.name} -> ${dischargePort.name}: ${choice.lane.transitDays} days, ${choice.lane.basis} (band ${choice.lane.band[0]}-${choice.lane.band[1]} days).`
  );

  pushStop({
    at: dischargePort.name,
    kind: "import",
    hours: dwell.discharge,
    basis: `assumption: ${dwell.discharge} h at ${dischargePort.name} for import clearance and release — a desk default, not a measured clearance`,
  });

  pushLeg({
    mode: choice.inland.mode,
    from: dischargePort.name,
    to: choice.inland.to,
    hours: choice.inland.transitHours,
    basis: choice.inland.basis,
    confidence: choice.inland.confidence,
    extra: {
      distanceKm: choice.inland.distanceKm,
      borderPosts: choice.inland.borderPosts,
      borderHours: choice.inland.borderHours.hours,
      borderHoursBasis: choice.inland.borderHours.basis,
    },
  });
  assumptions.push(
    `Inland ${dischargePort.name} -> ${choice.inland.to}: ${choice.inland.distanceKm} km, ${choice.inland.transitHours} h door-to-door, including ${
      choice.inland.borderHours.hours
    } h assumed border delay (${
      choice.inland.borderHours.hours === 0
        ? "no border on this leg"
        : choice.inland.borderPosts.length
        ? choice.inland.borderPosts.join(", ")
        : "crossings not named on this file"
    }).`
  );
  if (choice.inland.borderHours.hours > 0) {
    assumptions.push("Border delay is an assumption, not a measured queue; confirm the post before any client-facing date is issued.");
  }
  if (choice.inland.borderPosts.length === 0 && choice.inland.borderHours.hours > 0) {
    assumptions.push(
      `The border post for ${dischargePort.name} -> ${choice.inland.to} is not named on this file — that gap is deliberate, not an omission of zero delay.`
    );
  }

  const arriveAt = legs.at(-1).arriveAt;
  const legHours = round2(legs.reduce((a, l) => a + l.hours, 0));
  const codeHours = round2(customsStops.reduce((a, s) => a + s.hours, 0));
  // Elapsed time is the headline; the itemised sums must add up to it on a fresh plan.
  const totalHours = round2((parseTime(arriveAt, "arriveAt") - departMs) / HOUR_MS);
  const indicative = legs.filter((l) => l.confidence === "indicative");

  return {
    originCity: origin.city,
    destinationCity: destination.city,
    departAt: legs[0].departAt,
    arriveAt,
    totalHours,
    hoursBreakdown: { legs: legHours, customs: codeHours, idle: round2(totalHours - legHours - codeHours) },
    legs,
    customsStops,
    assumptions,
    confidence: indicative.length ? "indicative" : "firm",
    confidenceBasis: indicative.length
      ? indicative.map((l) => `${l.mode} ${l.from} -> ${l.to} is indicative`)
      : ["every leg on this route is firm on the file"],
    route: {
      originCity: origin.city,
      originPort: loadPort.code,
      destinationPort: dischargePort.code,
      destinationCity: destination.city,
      gateModelled: Boolean(origin.gate),
      laneId: choice.lane.id,
      inlandLegId: choice.inland.id,
      considered: choice.considered,
    },
    dwellHours: dwell,
    changes: [],
  };
}

/**
 * Replan after an event. Only what had not finished at `at` moves: a completed leg keeps its
 * times, a leg or clearance still running is extended, and everything downstream is pushed by
 * the same delay. The reason is recorded with the previous arrival — a client told Thursday
 * deserves to see why it became Friday.
 */
export function replan(plan, { at, delayHours, reason } = {}) {
  if (!plan || !Array.isArray(plan.legs) || plan.legs.length === 0) {
    refuse("BAD_PLAN", "a plan with at least one leg is required");
  }
  if (typeof delayHours !== "number" || !Number.isFinite(delayHours)) {
    refuse("BAD_DELAY", "delayHours must be a finite number of hours");
  }
  if (delayHours < 0) {
    refuse(
      "NEGATIVE_DELAY",
      `negative delay ${delayHours} h refused — replan only moves a plan later; a faster corridor is a different plan, not a replan`
    );
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    refuse("NO_REASON", "reason required — a moved plan without a stated cause is a guess");
  }

  const atMs = parseTime(at ?? plan.departAt, "at");
  const shiftMs = delayHours * HOUR_MS;

  /**
   * A leg that had not departed at `at` slides whole (a delayed truck keeps its running time);
   * a leg already running, and a clearance already open, take the delay as extra time in place.
   * Anything that finished at or before `at` does not move.
   */
  const shiftItem = (item, startKey, endKey, kind) => {
    const startMs = parseTime(item[startKey], `${startKey} of ${item.from ?? item.at}`);
    const endMs = parseTime(item[endKey], `${endKey} of ${item.from ?? item.at}`);
    const notStarted = kind === "leg" ? startMs >= atMs : startMs > atMs;
    const nextStart = notStarted ? startMs + shiftMs : startMs;
    const nextEnd = endMs > atMs ? endMs + shiftMs : endMs;
    const moved = nextStart !== startMs || nextEnd !== endMs;
    return {
      moved,
      item: {
        ...item,
        [startKey]: iso(nextStart),
        [endKey]: iso(nextEnd),
        hours: round2((nextEnd - nextStart) / HOUR_MS),
      },
    };
  };

  const legsShifted = [];
  const legs = plan.legs.map((leg, i) => {
    const { moved, item } = shiftItem(leg, "departAt", "arriveAt", "leg");
    if (moved) legsShifted.push(i);
    return item;
  });

  const stopsShifted = [];
  const customsStops = (plan.customsStops ?? []).map((stop, i) => {
    const { moved, item } = shiftItem(stop, "startAt", "endAt", "stop");
    if (moved) stopsShifted.push(i);
    return item;
  });

  if (legsShifted.length === 0 && stopsShifted.length === 0) {
    refuse(
      "AT_AFTER_ARRIVAL",
      `at ${iso(atMs)} is at or after the last arrival (${plan.legs.at(-1).arriveAt}) — nothing downstream to move`
    );
  }

  const arriveAt = legs.at(-1).arriveAt;
  const legHours = round2(legs.reduce((a, l) => a + l.hours, 0));
  const codeHours = round2(customsStops.reduce((a, s) => a + s.hours, 0));
  const totalHours = round2((parseTime(arriveAt, "arriveAt") - parseTime(legs[0].departAt, "departAt")) / HOUR_MS);
  // A pushed departure can leave the cargo waiting; that wait is reported, never hidden in a gap.
  const idleHours = round2(totalHours - legHours - codeHours);
  const change = {
    kind: "replan",
    at: iso(atMs),
    delayHours,
    reason,
    previousArriveAt: plan.arriveAt ?? plan.legs.at(-1).arriveAt,
    arriveAt,
    legsShifted,
    stopsShifted,
  };

  return {
    ...plan,
    departAt: legs[0].departAt,
    arriveAt,
    totalHours,
    hoursBreakdown: { legs: legHours, customs: codeHours, idle: idleHours },
    legs,
    customsStops,
    changes: [...(plan.changes ?? []), change],
  };
}

/* ------------------------------------------------------------ resolution */

function resolveOrigin(originCity) {
  if (typeof originCity !== "string" || originCity.trim() === "") {
    refuse("NO_ORIGIN", "originCity required — a corridor starts at a factory gate or a load port");
  }
  const key = clean(originCity);

  const port = PORTS.find(
    (p) => clean(p.name) === key || clean(p.city ?? "") === key || clean(p.code) === key
  );
  if (port) {
    if (port.type !== "load") {
      refuse("NO_LOAD_PORT", `${port.name} is a discharge port — nothing loads there for export`);
    }
    return { city: port.city ?? port.name, port, gate: null };
  }

  const gate = FACTORY_GATES.find((g) => clean(g.city) === key);
  if (!gate) {
    refuse(
      "NO_ORIGIN",
      `unknown origin city ${originCity} — no factory gate and no load port of that name is on file`
    );
  }
  const gatePort = PORTS.find((p) => p.code === gate.port);
  return { city: gate.city, port: gatePort, gate };
}

function resolveDestination(destinationCity) {
  if (typeof destinationCity !== "string" || destinationCity.trim() === "") {
    refuse("NO_DESTINATION", "destinationCity required — a corridor ends at a partner warehouse");
  }
  const key = clean(destinationCity);
  const city = DESTINATIONS.find((c) => clean(c) === key);
  if (!city) {
    refuse(
      "NO_INLAND_LEG",
      `no inland leg to ${destinationCity} — the desk has no modelled road or rail leg to that city`
    );
  }
  return { city };
}

function normaliseDwell(override) {
  const merged = { ...DEFAULT_DWELL_HOURS, ...(override ?? {}) };
  for (const key of ["load", "discharge"]) {
    const value = merged[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      refuse("BAD_DWELL", `dwellHours.${key} must be a non-negative number of hours`);
    }
    merged[key] = round2(value);
  }
  return merged;
}

function normaliseSelector(seaLane) {
  if (seaLane === null || seaLane === undefined) return null;
  if (typeof seaLane === "string") {
    const raw = seaLane.trim();
    if (!raw) refuse("NO_SEA_LANE", "seaLane selector is an empty string");
    const id = raw.toUpperCase().replace(/\s*>\s*/g, "-");
    return { kind: "id", id };
  }
  if (typeof seaLane === "object") {
    const from = String(seaLane.from ?? seaLane.fromCode ?? "").toUpperCase();
    const to = String(seaLane.to ?? seaLane.toCode ?? "").toUpperCase();
    if (!from || !to) refuse("NO_SEA_LANE", "seaLane object needs both from and to");
    return { kind: "pair", id: `${from}-${to}` };
  }
  refuse("NO_SEA_LANE", "seaLane must be a lane id string, a { from, to } pair, or null");
}

const matchesSelector = (lane, selector) => lane.id.toUpperCase() === selector.id;

function chooseRoute({ origin, destination, seaLane, dwell }) {
  const selector = normaliseSelector(seaLane);
  if (selector && !SEA_LANES.some((l) => matchesSelector(l, selector))) {
    refuse("NO_SEA_LANE", `no sea lane matches ${selector.id} on this file`);
  }

  const candidates = inlandLegsTo(destination.city);
  const options = [];
  for (const inland of candidates) {
    for (const lane of SEA_LANES) {
      if (lane.from !== origin.port.code || lane.to !== inland.from) continue;
      if (selector && !matchesSelector(lane, selector)) continue;
      const gateHours = origin.gate ? origin.gate.transitHours : 0;
      const score =
        gateHours + dwell.load + lane.transitDays * 24 + dwell.discharge + inland.transitHours;
      options.push({ lane, inland, score: round2(score) });
    }
  }

  if (options.length === 0) {
    const suffix = selector ? ` for lane ${selector.id}` : "";
    refuse(
      "NO_SEA_LANE",
      `no sea lane from ${origin.port.name} to ${destination.city}${suffix} — no modelled sailing on this file reaches a port with an inland leg to ${destination.city}`
    );
  }

  options.sort(
    (a, b) =>
      a.score - b.score ||
      a.lane.id.localeCompare(b.lane.id) ||
      a.inland.id.localeCompare(b.inland.id)
  );
  return { ...options[0], considered: options.length };
}

/* ----------------------------------------------------------- self-check */

/**
 * Invariants the file must satisfy before anyone quotes a client from it.
 * Called by the tests, and safe to call at boot: it throws on drift rather than shipping it.
 */
export function validateCorridors() {
  const codes = new Set();
  for (const p of PORTS) {
    if (codes.has(p.code)) refuse("BAD_PORTS", `duplicate port code ${p.code}`);
    codes.add(p.code);
    if (p.type !== "load" && p.type !== "discharge") refuse("BAD_PORTS", `${p.code} has type ${p.type}`);
    if (!p.name || !p.country) refuse("BAD_PORTS", `${p.code} is missing name or country`);
  }

  const laneIds = new Set();
  for (const lane of SEA_LANES) {
    if (laneIds.has(lane.id)) refuse("BAD_LANES", `duplicate lane ${lane.id}`);
    laneIds.add(lane.id);
    const from = PORTS.find((p) => p.code === lane.from);
    const to = PORTS.find((p) => p.code === lane.to);
    if (!from || from.type !== "load") refuse("BAD_LANES", `${lane.id}: origin is not a load port`);
    if (!to || to.type !== "discharge") refuse("BAD_LANES", `${lane.id}: destination is not a discharge port`);
    if (!(lane.transitDays > 0)) refuse("BAD_LANES", `${lane.id}: transitDays required`);
    if (!lane.basis) refuse("BAD_LANES", `${lane.id}: basis required`);
    if (lane.confidence !== "indicative" && lane.confidence !== "firm") {
      refuse("BAD_LANES", `${lane.id}: confidence ${lane.confidence} is not indicative|firm`);
    }
    if (lane.id !== `${lane.from}-${lane.to}`) refuse("BAD_LANES", `${lane.id} does not match its port pair`);
  }

  const legIds = new Set();
  for (const leg of INLAND_LEGS) {
    if (legIds.has(leg.id)) refuse("BAD_INLAND", `duplicate inland leg ${leg.id}`);
    legIds.add(leg.id);
    const port = PORTS.find((p) => p.code === leg.from);
    if (!port || port.type !== "discharge") refuse("BAD_INLAND", `${leg.id}: origin is not a discharge port`);
    if (!(leg.distanceKm > 0)) refuse("BAD_INLAND", `${leg.id}: distanceKm required`);
    if (!(leg.transitHours > 0)) refuse("BAD_INLAND", `${leg.id}: transitHours required`);
    if (!Array.isArray(leg.borderPosts)) refuse("BAD_INLAND", `${leg.id}: borderPosts must be an array`);
    if (typeof leg.borderHours?.hours !== "number") refuse("BAD_INLAND", `${leg.id}: borderHours.hours required`);
    if (!/assumption/i.test(leg.borderHours.basis ?? "")) {
      refuse("BAD_INLAND", `${leg.id}: borderHours must be labelled as an assumption`);
    }
    if (leg.borderPosts.length === 0 && leg.borderHours.hours > 40) {
      refuse("BAD_INLAND", `${leg.id}: unnamed crossings cannot carry that much assumed delay`);
    }
    if (!leg.basis) refuse("BAD_INLAND", `${leg.id}: basis required`);
    if (leg.confidence !== "indicative" && leg.confidence !== "firm") {
      refuse("BAD_INLAND", `${leg.id}: confidence ${leg.confidence} is not indicative|firm`);
    }
  }

  for (const city of ["Nairobi", "Kampala", "Kigali", "Dar es Salaam", "Lusaka", "Harare", "Johannesburg", "Gaborone", "Maputo"]) {
    if (!INLAND_LEGS.some((l) => l.to === city)) refuse("BAD_INLAND", `no inland leg to ${city}`);
  }

  for (const gate of FACTORY_GATES) {
    const port = PORTS.find((p) => p.code === gate.port);
    if (!port || port.type !== "load") refuse("BAD_GATES", `${gate.city}: gate port is not a load port`);
    if (!(gate.transitHours > 0)) refuse("BAD_GATES", `${gate.city}: transitHours required`);
    if (!gate.basis) refuse("BAD_GATES", `${gate.city}: basis required`);
  }

  if (!(DEFAULT_DWELL_HOURS.load >= 0) || !(DEFAULT_DWELL_HOURS.discharge >= 0)) {
    refuse("BAD_DWELL", "default dwell hours must be non-negative");
  }

  return { ports: PORTS.length, lanes: SEA_LANES.length, inlandLegs: INLAND_LEGS.length, gates: FACTORY_GATES.length };
}

export { round2 };
