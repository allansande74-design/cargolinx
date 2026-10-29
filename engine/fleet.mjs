/**
 * Vehicle classes and cargo-to-vehicle matching across East African freight tiers.
 *
 * What this module will and will not do:
 * - It picks the SMALLEST class that physically fits the cargo on the corridor asked for. It does not
 *   pick by price, by which truck happens to be free, or by transit time; those belong to the quote.
 * - Volume is optional. When the caller gives none the match is weight-only, and the result says so
 *   in its basis rather than implying a volume was checked.
 * - Capacities are planning figures for our own quotes, not type-approval data. The axle/wheelbase
 *   note on each class describes the vehicle; it is not a permit and it does not clear a route.
 * - Rates live in RATE_CARD and only there. A class with no rate on file is refused. A rate we
 *   invented would be a quote we cannot stand behind.
 * - drone_last100 is a future class. It is never handed back without allowFuture: true, because a
 *   client must not be promised a capability that has not been proven on a corridor.
 *
 * Pure functions only: no filesystem, no network, no clock beyond what the caller passes.
 */

export const CORRIDORS = ["last_mile", "urban", "trunk", "regional"];

const round = (n) => Math.round(n * 100) / 100;

/** A refusal carries the reason code as well as the sentence, so a caller can branch without parsing text. */
function refuse(reason, message, extra = {}) {
  const err = new Error(message);
  err.name = "FleetRefusal";
  err.reason = reason;
  Object.assign(err, extra);
  throw err;
}

function num(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) refuse(`${field}_invalid`, `${field} must be a number, got "${value}"`);
  return n;
}

/**
 * The register. Ordered ascending by payload (then volume) so "smallest that fits" is a scan, not a
 * sort guess. Volumes are body volumes for the payload stated, not a maximum cube at any density.
 */
const CLASSES = [
  {
    code: "motorbike",
    label: "Motorbike (boda boda)",
    payloadKg: 80,
    volumeM3: 0.15,
    axleOrWheelBaseNote: "Two wheels, no axle limit; carried on the rider or a top box, so the practical limit is the rider's balance, not the frame.",
    corridors: ["last_mile"],
    status: "available",
  },
  {
    code: "drone_last100",
    label: "Cargo drone (last 100 km)",
    payloadKg: 5,
    volumeM3: 0.05,
    axleOrWheelBaseNote: "No axles and no road contact; the limit is the airframe's rated lift and the parcel's external dimensions against the bay.",
    corridors: ["last_mile"],
    status: "future",
  },
  {
    code: "pickup",
    label: "Pickup, single cab (1 t)",
    payloadKg: 1000,
    volumeM3: 3,
    axleOrWheelBaseNote: "Single rear axle, leaf-sprung, ~3.2 m wheelbase; tray load of 1,000 kg, and 3 m3 only with a canopy fitted.",
    corridors: ["last_mile", "urban", "trunk"],
    status: "available",
  },
  {
    code: "van",
    label: "Panel van (1.2 t)",
    payloadKg: 1200,
    volumeM3: 6,
    axleOrWheelBaseNote: "Single rear axle, 4 wheels within a 3.5 t gross weight; the body is the constraint well before the axle is.",
    corridors: ["last_mile", "urban", "trunk"],
    status: "available",
  },
  {
    code: "light_truck",
    label: "Light truck (3.5 t)",
    payloadKg: 3500,
    volumeM3: 18,
    axleOrWheelBaseNote: "Two axles, 3,500 kg payload class (NKR / Canter 3.5 t); the 18 m3 body is a long-wheelbase box.",
    corridors: ["urban", "trunk", "regional"],
    status: "available",
  },
  {
    code: "medium_truck",
    label: "Medium truck (14 t)",
    payloadKg: 14000,
    volumeM3: 45,
    axleOrWheelBaseNote: "Two axles typically, sometimes a lazy third; 14,000 kg payload, and axle loading must be confirmed per route before departure.",
    corridors: ["trunk", "regional"],
    status: "available",
  },
  {
    code: "heavy_truck",
    label: "Heavy truck (28 t)",
    payloadKg: 28000,
    volumeM3: 90,
    axleOrWheelBaseNote: "Three axles, 28,000 kg payload; axle-load compliance and any abnormal-load permit are route matters to confirm, not features of the class.",
    corridors: ["trunk", "regional"],
    status: "available",
  },
  {
    code: "trailer",
    label: "Trailer combination (34 t)",
    payloadKg: 34000,
    volumeM3: 120,
    axleOrWheelBaseNote: "Semi- or drawbar combination, 3 to 4 axles; the largest unit we quote, and the one most likely to need a permit per corridor.",
    corridors: ["trunk", "regional"],
    status: "available",
  },
];

const ordered = CLASSES.map((c) =>
  Object.freeze({
    ...c,
    corridors: Object.freeze([...c.corridors]),
    lastMileOnly: c.corridors.length === 1 && c.corridors[0] === "last_mile",
  }),
).sort((a, b) => a.payloadKg - b.payloadKg || a.volumeM3 - b.volumeM3);

// Codes are reachable as properties (VEHICLE_CLASSES.pickup) as well as by scan (.find), because both
// read naturally at a call site and neither should force a wrapper.
for (const c of ordered) ordered[c.code] = c;

export const VEHICLE_CLASSES = Object.freeze(ordered);

/**
 * KES per km, per class, as internal planning rates. These are ours, not a carrier's published
 * tariff: they exist so a quote has a stated basis, and every one of them wants replacing with a
 * signed carrier rate before a figure is issued to a client. A null entry means no rate on file.
 */
export const RATE_CARD = Object.freeze({
  motorbike: Object.freeze({ kesPerKm: 38, basis: "boda-boda city rate, internal planning figure" }),
  drone_last100: null,
  pickup: Object.freeze({ kesPerKm: 62, basis: "1 t pickup, internal planning figure" }),
  van: Object.freeze({ kesPerKm: 70, basis: "1.2 t panel van, internal planning figure" }),
  light_truck: Object.freeze({ kesPerKm: 115, basis: "3.5 t light truck, internal planning figure" }),
  medium_truck: Object.freeze({ kesPerKm: 190, basis: "14 t medium truck, internal planning figure" }),
  heavy_truck: Object.freeze({ kesPerKm: 255, basis: "28 t heavy truck, internal planning figure" }),
  trailer: Object.freeze({ kesPerKm: 320, basis: "34 t trailer combination, internal planning figure" }),
});

const CURRENCY = "KES";

function resolveVehicle(vehicle) {
  const code = typeof vehicle === "string" ? vehicle : vehicle?.code;
  if (!code) refuse("unknown_vehicle", "a vehicle class or class code is required — classes come from VEHICLE_CLASSES");
  const found = VEHICLE_CLASSES[code];
  if (!found) {
    refuse("unknown_vehicle", `unknown vehicle class "${code}" — known classes are ${VEHICLE_CLASSES.map((c) => c.code).join(", ")}`);
  }
  return found;
}

const fitsCargo = (c, weightKg, volumeM3) =>
  weightKg <= c.payloadKg && (volumeM3 === null || volumeM3 <= c.volumeM3);

const utilisation = (c, weightKg, volumeM3) => ({
  utilisationKgPct: round((weightKg / c.payloadKg) * 100),
  utilisationM3Pct: volumeM3 === null ? null : round((volumeM3 / c.volumeM3) * 100),
});

/**
 * Choose the smallest class that carries the weight (and the volume, when one is given) on the
 * corridor asked for. Refuses, naming the reason, when nothing on that corridor fits.
 */
export function matchVehicle({ weightKg, volumeM3 = null, corridor = "trunk", allowFuture = false } = {}) {
  const weight = num(weightKg, "weightKg");
  if (weight === null) refuse("weight_required", "weightKg is required — a match needs a weight in kilograms");
  if (weight <= 0) refuse("weight_invalid", `weightKg must be greater than zero, got ${weight} — cargo with no weight is not cargo`);

  const volume = num(volumeM3, "volumeM3");
  if (volume !== null && volume <= 0) refuse("volume_invalid", `volumeM3 must be greater than zero, got ${volume}`);

  if (typeof allowFuture !== "boolean") {
    refuse("allowFuture_invalid", `allowFuture must be true or false, got "${allowFuture}" — a future class is only quoted on a boolean yes`);
  }

  const onCorridor = VEHICLE_CLASSES.filter((c) => c.corridors.includes(corridor));
  if (onCorridor.length === 0) {
    refuse(
      "no_class_on_corridor",
      `no class serves corridor "${corridor}" — known corridors are ${CORRIDORS.join(", ")}`,
    );
  }

  const fitting = onCorridor.filter((c) => fitsCargo(c, weight, volume));
  if (fitting.length === 0) {
    const largest = onCorridor[onCorridor.length - 1];
    refuse(
      "cargo_exceeds_largest",
      `cargo exceeds the largest class on this corridor — ${weight} kg${volume !== null ? ` / ${volume} m3` : ""} against ${largest.code} at ${largest.payloadKg} kg / ${largest.volumeM3} m3, the biggest on ${corridor}`,
    );
  }

  const best = fitting[0];
  const alternatives = fitting
    .slice(1)
    .filter((c) => allowFuture || c.status === "available")
    .map((c) => ({ ...c, ...utilisation(c, weight, volume) }));

  if (best.status === "future" && !allowFuture) {
    const next = alternatives[0] ?? null;
    refuse(
      "future_class_requires_allowFuture",
      `${best.code} is a future class — ask for it with allowFuture: true${next ? `, or use ${next.code} (${next.payloadKg} kg / ${next.volumeM3} m3) today` : ", and no available class carries this load"}`,
      { vehicle: best, alternatives },
    );
  }

  return {
    vehicle: best,
    vehicleCode: best.code,
    ...utilisation(best, weight, volume),
    alternatives,
    basis: {
      corridor,
      weightKg: weight,
      volumeM3: volume,
      volumeConsidered: volume !== null,
      allowFuture,
      classesOnCorridor: onCorridor.map((c) => c.code),
    },
  };
}

/**
 * Split cargo that no single unit carries into several loads of one class. Loads are spread evenly,
 * which is also how a transporter loads for axle balance. The leftover reported is spare capacity on
 * the convoy after loading, not cargo left behind: cargo left behind is a refusal, not a number.
 *
 * The class chosen is the one that needs the FEWEST units within maxUnits, and the smallest class
 * that achieves that count. Units are not free — every extra one is another driver, another handover
 * and another chance to damage the cargo — but neither is a 34 t trailer worth sending for 900 kg.
 * So 60 t is two trailers, and 900 kg stays one pickup.
 */
export function splitShipment({ weightKg, volumeM3 = null, corridor = "trunk", maxUnits = 5 } = {}) {
  const weight = num(weightKg, "weightKg");
  if (weight === null) refuse("weight_required", "weightKg is required — a split needs a weight in kilograms");
  if (weight <= 0) refuse("weight_invalid", `weightKg must be greater than zero, got ${weight}`);

  const volume = num(volumeM3, "volumeM3");
  if (volume !== null && volume <= 0) refuse("volume_invalid", `volumeM3 must be greater than zero, got ${volume}`);

  const cap = Number(maxUnits);
  if (!Number.isInteger(cap) || cap < 1) refuse("maxUnits_invalid", `maxUnits must be a whole number of loads, got "${maxUnits}"`);

  const onCorridor = VEHICLE_CLASSES.filter((c) => c.corridors.includes(corridor) && c.status === "available");
  if (onCorridor.length === 0) {
    refuse("no_class_on_corridor", `no class serves corridor "${corridor}" — known corridors are ${CORRIDORS.join(", ")}`);
  }

  // Ceil on the raw ratio with a float guard: rounding first could turn 34,000.1 kg into one 34,000 kg load.
  const unitsFor = (total, per) => Math.ceil(total / per - 1e-9);
  const options = onCorridor.map((c) => {
    const byWeight = unitsFor(weight, c.payloadKg);
    const byVolume = volume === null ? 1 : unitsFor(volume, c.volumeM3);
    return { unit: c, units: Math.max(1, byWeight, byVolume), byWeight, byVolume };
  });

  const feasible = options
    .filter((o) => o.units <= cap)
    .sort((a, b) => a.units - b.units || a.unit.payloadKg - b.unit.payloadKg);

  if (feasible.length === 0) {
    const fewest = options.reduce((a, b) => (b.units < a.units || (b.units === a.units && b.unit.payloadKg > a.unit.payloadKg) ? b : a));
    refuse(
      "exceeds_max_units",
      `cargo needs ${fewest.units} × ${fewest.unit.code} loads but maxUnits is ${cap} — ${weight} kg${volume !== null ? ` / ${volume} m3` : ""} against ${fewest.unit.payloadKg} kg / ${fewest.unit.volumeM3} m3 per unit`,
    );
  }

  const chosen = feasible[0];
  const unit = chosen.unit;
  const units = chosen.units;
  const byWeight = chosen.byWeight;
  const byVolume = chosen.byVolume;

  const loads = Array.from({ length: units }, (_, i) => {
    const w = round(weight / units);
    const v = volume === null ? null : round(volume / units);
    return { seq: i + 1, ...utilisation(unit, w, v), weightKg: w, volumeM3: v };
  });

  return {
    vehicle: unit,
    vehicleCode: unit.code,
    corridor,
    units,
    perUnit: { payloadKg: unit.payloadKg, volumeM3: unit.volumeM3 },
    loads,
    leftover: {
      weightKg: round(units * unit.payloadKg - weight),
      volumeM3: volume === null ? null : round(units * unit.volumeM3 - volume),
    },
    lastUnitPartial: loads[loads.length - 1].utilisationKgPct < 100 || (volume !== null && loads[loads.length - 1].utilisationM3Pct < 100),
    basis: {
      limitedBy: byVolume > byWeight ? "volume" : "payload",
      maxUnits: cap,
    },
  };
}

/**
 * Cost a class over a distance from the rate card. No rate on file means no number, and the refusal
 * says which class is missing one. A caller-supplied ratePerKm is used only because someone put it
 * in writing, and it is labelled as supplied.
 */
export function costEstimate(vehicle, { distanceKm, ratePerKm = null, fuelPerKm = null } = {}) {
  const cls = resolveVehicle(vehicle);

  const distance = num(distanceKm, "distanceKm");
  if (distance === null) refuse("distance_required", "distanceKm is required — a rate per km needs kilometres");
  if (distance <= 0) refuse("distance_invalid", `distanceKm must be greater than zero, got ${distance}`);

  const suppliedRate = num(ratePerKm, "ratePerKm");
  if (suppliedRate !== null && suppliedRate <= 0) refuse("rate_invalid", `ratePerKm must be greater than zero, got ${suppliedRate}`);

  const fuel = num(fuelPerKm, "fuelPerKm");
  if (fuel !== null && fuel < 0) refuse("fuel_invalid", `fuelPerKm cannot be negative, got ${fuel}`);

  const card = RATE_CARD[cls.code];
  const rate = suppliedRate ?? card?.kesPerKm ?? null;
  if (rate === null) {
    refuse(
      "no_rate_on_file",
      `no rate on file for ${cls.code} — the rate card does not price this class and this engine will not invent one; pass ratePerKm from a carrier quote`,
    );
  }

  const freightKes = round(rate * distance);
  const fuelKes = fuel === null ? null : round(fuel * distance);

  return {
    vehicle: cls,
    vehicleCode: cls.code,
    currency: CURRENCY,
    distanceKm: distance,
    ratePerKm: rate,
    rateSource: suppliedRate !== null ? "caller supplied" : "Rate card, internal planning figure — replace with a signed carrier rate before issuing",
    rateBasis: suppliedRate !== null ? "supplied with the request" : card.basis,
    freightKes,
    fuelKes,
    totalKes: round(freightKes + (fuelKes ?? 0)),
    basis: [`${rate} KES/km × ${distance} km`].concat(fuel === null ? [] : [`fuel ${fuel} KES/km × ${distance} km`]),
  };
}

/**
 * Does this class carry this cargo? Every reason names its dimension (payload, volume, corridor), so
 * a client is told which limit they hit rather than that they are simply over.
 */
export function capacityCheck(vehicle, cargo = {}) {
  const cls = resolveVehicle(vehicle);
  const weight = num(cargo?.weightKg, "weightKg");
  const volume = num(cargo?.volumeM3, "volumeM3");

  if (weight === null && volume === null) {
    refuse("cargo_required", "cargo must state weightKg and/or volumeM3 — an empty check would pass anything");
  }
  if (weight !== null && weight < 0) refuse("weight_invalid", `weightKg cannot be negative, got ${weight}`);
  if (volume !== null && volume < 0) refuse("volume_invalid", `volumeM3 cannot be negative, got ${volume}`);

  const reasons = [];

  if (weight !== null && weight > cls.payloadKg) {
    reasons.push({
      dimension: "payload",
      message: `payload: ${weight} kg exceeds the ${cls.payloadKg} kg rating of ${cls.code} by ${round(weight - cls.payloadKg)} kg`,
      cargo: weight,
      limit: cls.payloadKg,
      excess: round(weight - cls.payloadKg),
    });
  }

  if (volume !== null && volume > cls.volumeM3) {
    reasons.push({
      dimension: "volume",
      message: `volume: ${volume} m3 exceeds the ${cls.volumeM3} m3 body of ${cls.code} by ${round(volume - cls.volumeM3)} m3`,
      cargo: volume,
      limit: cls.volumeM3,
      excess: round(volume - cls.volumeM3),
    });
  }

  if (cargo?.corridor && !cls.corridors.includes(cargo.corridor)) {
    reasons.push({
      dimension: "corridor",
      message: `corridor: ${cls.code} does not serve ${cargo.corridor} — it runs ${cls.corridors.join(", ")}`,
      cargo: cargo.corridor,
      limit: cls.corridors,
      excess: null,
    });
  }

  const notes = [];
  if (cls.status === "future") {
    notes.push(`${cls.code} is a future class: capacity is a stated design figure and no corridor has been flown commercially`);
  }

  return {
    vehicle: cls,
    vehicleCode: cls.code,
    fits: reasons.length === 0,
    reasons,
    limiting: reasons.map((r) => r.dimension),
    notes,
    utilisationKgPct: weight === null ? null : round((weight / cls.payloadKg) * 100),
    utilisationM3Pct: volume === null ? null : round((volume / cls.volumeM3) * 100),
  };
}
