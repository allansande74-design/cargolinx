/**
 * Third-party transport partners.
 *
 * A partner is a fleet we do not own: heavy trucks on the long-haul corridors, light trucks and
 * vans on the last mile, motorbike couriers, and drone operators whose lane is not open yet. The
 * register treats all of them the same way — a record is born `pending`, a document on file is a
 * claim until a named checker verifies it against a reference, and no vehicle is dispatched on the
 * strength of a plate and a promise.
 *
 * Two failures this module refuses to smooth over:
 *  - a document that is missing, one that is expired, and one that is simply too old to rely on are
 *    three different failures. A dispatcher needs to see which one it is, so each is its own
 *    blocker;
 *  - a booking conflict is a fact about a specific plate and a specific window, so it is named,
 *    never summarised into "not available".
 *
 * Per-bloc document applicability below is the desk's working configuration, not a legal opinion:
 * confirm the requirement and the interval with the member authority before relying on it at a
 * border. Pure functions only — no filesystem, no network. Constructors and bookings default to
 * the current time and accept an explicit override so a test or a replay can pin the clock.
 */

export const BLOCS = {
  EAC: { label: "East African Community" },
  COMESA: { label: "Common Market for Eastern and Southern Africa" },
  SADC: { label: "Southern African Development Community" },
};

/**
 * The five documents the register knows, in the order a file is checked.
 *
 * `blocs` is where the document is demanded on a lane this desk runs; `maxAgeDays` is how long a
 * verification stays usable even when the paper itself has not expired — an inspection from two
 * years ago is not evidence about the vehicle today.
 */
export const REQUIRED_DOCUMENTS = {
  insurance: {
    label: "Insurance",
    detail: "Third-party liability and goods-in-transit cover",
    issuer: "Licensed insurer; a COMESA or SADC yellow-card certificate where the lane crosses blocs",
    blocs: ["EAC", "COMESA", "SADC"],
    maxAgeDays: 365,
    basis: "cover must be live for every leg — an expired certificate is an uninsured vehicle",
  },
  inspection: {
    label: "Inspection",
    detail: "Roadworthiness inspection certificate",
    issuer: "National vehicle inspection authority",
    blocs: ["EAC", "COMESA"],
    maxAgeDays: 180,
    basis: "roadworthiness is checked on the EAC and COMESA lanes this desk runs; confirm the member authority's interval",
  },
  vehicle_licence: {
    label: "Vehicle licence",
    detail: "Current registration and road licence for the plate",
    issuer: "National vehicle registration authority",
    blocs: ["EAC", "COMESA", "SADC"],
    maxAgeDays: 365,
    basis: "the plate must be licensed in its home country for the period it is dispatched",
  },
  driver_licence: {
    label: "Driver licence",
    detail: "Driving licence for the class of vehicle, held by the named driver",
    issuer: "National driver licensing authority",
    blocs: ["EAC", "COMESA", "SADC"],
    maxAgeDays: 1095,
    basis: "a licence runs for years, so the age limit is three years; a licence checked once is not checked forever",
  },
  operating_permit: {
    label: "Operating permit",
    detail: "Cross-border goods transport permit for the carrier",
    issuer: "National transport regulator; bloc carrier licence where one is issued",
    blocs: ["EAC", "COMESA"],
    maxAgeDays: 365,
    basis: "the carrier, not the vehicle, is licensed to move goods for reward across these borders",
  },
};

/**
 * The lanes this desk quotes on. `kind` decides which vehicle classes may work them; `blocs`
 * decides which documents are demanded. `air` exists as a kind so a drone operator can be
 * registered, but no corridor carries it today — there is no drone freight lane to promise.
 */
export const CORRIDORS = {
  northern: { label: "Northern Corridor — Mombasa · Nairobi · Kampala · Kigali · Bujumbura", blocs: ["EAC"], kind: "long_haul" },
  central: { label: "Central Corridor — Dar es Salaam · Dodoma · Mwanza · Kampala · Kigali", blocs: ["EAC"], kind: "long_haul" },
  lamu: { label: "Lamu Port corridor — Lamu · Isiolo · Juba", blocs: ["EAC"], kind: "long_haul" },
  djibouti: { label: "Djibouti–Addis corridor", blocs: ["COMESA"], kind: "long_haul" },
  north_south: { label: "North–South Corridor — Durban · Lusaka · Dar es Salaam", blocs: ["COMESA", "SADC"], kind: "long_haul" },
  beira: { label: "Beira Corridor — Beira · Harare · Lusaka", blocs: ["SADC"], kind: "long_haul" },
  walvis_bay: { label: "Walvis Bay corridors — Walvis Bay · Lusaka · Lubumbashi", blocs: ["SADC"], kind: "long_haul" },
  nairobi_last_mile: { label: "Nairobi last mile", blocs: ["EAC"], kind: "urban" },
  kampala_last_mile: { label: "Kampala last mile", blocs: ["EAC"], kind: "urban" },
  lusaka_last_mile: { label: "Lusaka last mile", blocs: ["SADC"], kind: "urban" },
};
/**
 * The road class a named trade corridor implies. A long-haul lane needs a trunk-capable vehicle; a
 * last-mile lane does not. Without this bridge the register and the fleet matcher would disagree
 * about what "corridor" means, and a heavy truck would be offered for a Nairobi parcel run.
 */
export const CORRIDOR_CLASS = Object.freeze({ long_haul: "trunk", urban: "last_mile" });

export function roadClass(corridor) {
  const key = String(corridor ?? "").trim().toLowerCase();
  const lane = CORRIDORS[key];
  if (!lane) throw new Error(`unknown corridor "${corridor ?? ""}" — expected one of ${Object.keys(CORRIDORS).join(", ")}`);
  return CORRIDOR_CLASS[lane.kind];
}


/**
 * Vehicle classes from a heavy truck down to a motorbike, plus the drone operator the register
 * keeps a record for before any lane is open to it. `maxPayloadKg` is the class ceiling a
 * registered capacity may not exceed: a motorbike claiming two tonnes is a data error, not a
 * capable vehicle.
 */
export const VEHICLE_CLASSES = {
  trailer: { label: "Articulated trailer combination", maxPayloadKg: 34000, serves: ["long_haul"] },
  heavy_truck: { label: "Heavy truck / articulated combination", maxPayloadKg: 28000, serves: ["long_haul"] },
  medium_truck: { label: "Medium truck (7-14 t)", maxPayloadKg: 14000, serves: ["long_haul", "urban"] },
  rigid_truck: { label: "Rigid truck (two or three axles)", maxPayloadKg: 12000, serves: ["long_haul"] },
  light_truck: { label: "Light truck up to 3.5 t", maxPayloadKg: 3500, serves: ["long_haul", "urban"] },
  pickup: { label: "Pickup / utility vehicle", maxPayloadKg: 1000, serves: ["urban"] },
  van: { label: "Panel van", maxPayloadKg: 1200, serves: ["urban"] },
  motorbike: { label: "Motorbike courier", maxPayloadKg: 60, serves: ["urban"] },
  drone_last100: {
    label: "Drone operator (last 100 km)",
    maxPayloadKg: 20,
    serves: ["air"],
    note: "kept in the register so the operator and its papers exist before the lane does; no corridor here is open to drone freight yet",
  },
  drone: {
    label: "Drone operator",
    maxPayloadKg: 20,
    serves: ["air"],
    note: "kept in the register so the operator and its papers exist before the lane does; no corridor here is open to drone freight yet",
  },
};

const MS_DAY = 86400000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const round = (n) => Math.round(n * 100) / 100;

function toTime(value, label = "date") {
  if (value === undefined || value === null || value === "") throw new Error(`${label} must be a date, got "${value ?? ""}"`);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${label} must be a date, got "${value}"`);
  return d.getTime();
}

const stampOf = (value, label) => new Date(toTime(value, label)).toISOString();

function normaliseContact(contact) {
  if (!contact) return { email: null, phone: null, person: null };
  if (typeof contact === "string") {
    const text = contact.trim();
    if (!text) return { email: null, phone: null, person: null };
    return text.includes("@") ? { email: text, phone: null, person: null } : { email: null, phone: text, person: null };
  }
  return {
    email: contact.email ? String(contact.email).trim() : null,
    phone: contact.phone ? String(contact.phone).trim() : null,
    person: contact.person ?? contact.name ?? null,
  };
}

const reachable = (c) => Boolean((c.email && EMAIL.test(c.email)) || digits(c.phone).length >= 7);

function normaliseDocuments(documents, plate) {
  const out = {};
  for (const [type, doc] of Object.entries(documents ?? {})) {
    if (!REQUIRED_DOCUMENTS[type]) {
      throw new Error(`vehicle ${plate}: unknown document "${type}" — expected one of ${Object.keys(REQUIRED_DOCUMENTS).join(", ")}`);
    }
    const reference = String(doc?.reference ?? "").trim();
    if (!reference) {
      throw new Error(`vehicle ${plate}: ${type} carries no reference — a document without a reference cannot be checked later`);
    }
    out[type] = {
      reference,
      expiresAt: stampOf(doc?.expiresAt, `vehicle ${plate}: ${type} expiresAt`),
      status: "claimed",
      verifiedBy: null,
      verifiedAt: null,
    };
  }
  return out;
}

function normaliseVehicle(vehicle, index, seen) {
  if (!vehicle || typeof vehicle !== "object") throw new Error(`vehicle ${index + 1}: a vehicle record is required`);

  const plate = String(vehicle.plate ?? "").trim().toUpperCase();
  if (!plate) throw new Error(`vehicle ${index + 1}: plate required — a vehicle is dispatched by its plate`);
  if (seen.has(plate)) throw new Error(`vehicle ${plate}: duplicate plate — one vehicle cannot appear twice in a fleet`);
  seen.add(plate);

  const cls = VEHICLE_CLASSES[vehicle.classCode];
  if (!cls) {
    throw new Error(`vehicle ${plate}: unknown class "${vehicle.classCode ?? ""}" — expected one of ${Object.keys(VEHICLE_CLASSES).join(", ")}`);
  }

  const capacityKg = Number(vehicle.capacityKg);
  if (!Number.isFinite(capacityKg) || capacityKg <= 0) {
    throw new Error(`vehicle ${plate}: capacityKg must be a positive number, got "${vehicle.capacityKg ?? ""}"`);
  }
  if (capacityKg > cls.maxPayloadKg) {
    throw new Error(`vehicle ${plate}: ${capacityKg} kg exceeds the ${cls.label} class ceiling of ${cls.maxPayloadKg} kg`);
  }

  const rawRoutes = Array.isArray(vehicle.corridors) ? vehicle.corridors : vehicle.corridors ? [vehicle.corridors] : [];
  const corridors = [...new Set(rawRoutes.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean))];
  if (corridors.length === 0) {
    throw new Error(`vehicle ${plate}: at least one corridor required — a vehicle with no lane cannot be dispatched`);
  }
  for (const c of corridors) {
    if (!CORRIDORS[c]) throw new Error(`vehicle ${plate}: unknown corridor "${c}" — expected one of ${Object.keys(CORRIDORS).join(", ")}`);
  }

  return {
    plate,
    classCode: vehicle.classCode,
    capacityKg: round(capacityKg),
    corridors,
    documents: normaliseDocuments(vehicle.documents, plate),
  };
}

/**
 * Register a transport owner. The record always starts `pending`: an owner cannot be born trusted,
 * and a claimed document stays a claim until `verifyDocument` names who checked it.
 */
export function registerPartner({ ownerName, country, contact = null, fleet = [], at = new Date() } = {}) {
  const name = String(ownerName ?? "").trim();
  if (name.length < 2) throw new Error("owner name required — the register cannot carry an unnamed transport owner");

  const cc = String(country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new Error(`country must be a two-letter code, got "${country ?? ""}"`);

  const reach = normaliseContact(contact);
  if (!reachable(reach)) {
    throw new Error("contact email or phone required — a partner we cannot reach cannot be dispatched");
  }

  if (!Array.isArray(fleet) || fleet.length === 0) {
    throw new Error("at least one vehicle required — a transport partner without a vehicle has nothing to dispatch");
  }

  const seen = new Set();
  const vehicles = fleet.map((v, i) => normaliseVehicle(v, i, seen));
  const createdAt = stampOf(at, "at");

  return {
    id: `ptn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    ownerName: name,
    country: cc,
    contact: reach,
    fleet: vehicles,
    status: "pending",
    verifiedAt: null,
    verification: null,
    bookings: [],
    history: [{ event: "registered", at: createdAt, note: `${vehicles.length} vehicle(s) on file` }],
    createdAt,
  };
}

function vehicleOn(partner, plate, { required = true } = {}) {
  const wanted = String(plate ?? "").trim().toUpperCase();
  if (!wanted) {
    if (required) throw new Error("plate required — every check is about one vehicle");
    return null;
  }
  const vehicle = (partner.fleet ?? []).find((v) => v.plate === wanted);
  if (!vehicle && required) {
    throw new Error(`no vehicle with plate "${wanted}" on partner "${partner.ownerName ?? partner.id ?? "(unnamed)"}"`);
  }
  return vehicle ?? null;
}

/**
 * Verify one document against a reference. No reference, no verifier, no verification — that is
 * the whole point of the fields, and the reason the file can be reconstructed at a border later.
 * A document that has already expired is refused: recording it would put a dead paper on a live
 * vehicle.
 */
export function verifyDocument(partner, { plate, type, reference, expiresAt, verifiedBy, at = new Date() } = {}) {
  if (!partner || typeof partner !== "object") throw new Error("a partner record is required");

  const spec = REQUIRED_DOCUMENTS[type];
  if (!spec) {
    throw new Error(`unknown document type "${type ?? ""}" — expected one of ${Object.keys(REQUIRED_DOCUMENTS).join(", ")}`);
  }

  const vehicle = vehicleOn(partner, plate);
  const ref = String(reference ?? "").trim();
  if (!ref) throw new Error("verification requires a reference — a claim without a document is not verification");

  const by = String(verifiedBy ?? "").trim();
  if (!by) throw new Error("verification must name who checked the document");

  const verifiedAt = stampOf(at, "at");
  const expires = stampOf(expiresAt, `${type} expiresAt`);
  if (Date.parse(expires) <= Date.parse(verifiedAt)) {
    throw new Error(`${spec.label} on ${vehicle.plate} expired on ${expires} — an expired document cannot be verified`);
  }

  const record = { reference: ref, expiresAt: expires, status: "verified", verifiedBy: by, verifiedAt };

  return {
    ...partner,
    fleet: (partner.fleet ?? []).map((v) =>
      v.plate === vehicle.plate ? { ...v, documents: { ...(v.documents ?? {}), [type]: record } } : v,
    ),
    history: [
      ...(partner.history ?? []),
      { event: "document_verified", plate: vehicle.plate, type, reference: ref, expiresAt: expires, by, at: verifiedAt },
    ],
  };
}

/**
 * Approve the owner. Approval is an event with a named checker and a reference document, not a
 * flag; without both, the partner stays `pending`.
 */
export function approvePartner(partner, { by, reference, at = new Date() } = {}) {
  if (!partner || typeof partner !== "object") throw new Error("a partner record is required");

  const ref = String(reference ?? "").trim();
  if (!ref) throw new Error("approval requires a verification reference — a claim without a document is not verification");

  const checker = String(by ?? "").trim();
  if (!checker) throw new Error("approval must name who checked the partner");

  const verifiedAt = stampOf(at, "at");

  return {
    ...partner,
    status: "verified",
    verifiedAt,
    verification: { by: checker, reference: ref, at: verifiedAt },
    history: [...(partner.history ?? []), { event: "approved", by: checker, reference: ref, at: verifiedAt }],
  };
}

/** Which documents a bloc demands, in register order. */
export function documentsForBloc(bloc) {
  const key = String(bloc ?? "").trim().toUpperCase();
  if (!BLOCS[key]) throw new Error(`unknown bloc "${bloc ?? ""}" — expected one of ${Object.keys(BLOCS).join(", ")}`);
  return Object.keys(REQUIRED_DOCUMENTS).filter((t) => REQUIRED_DOCUMENTS[t].blocs.includes(key));
}

/** Which documents a corridor demands: the union over every bloc the lane crosses. */
export function documentsForCorridor(corridor) {
  const lane = CORRIDORS[String(corridor ?? "").trim().toLowerCase()];
  if (!lane) throw new Error(`unknown corridor "${corridor ?? ""}" — expected one of ${Object.keys(CORRIDORS).join(", ")}`);
  return Object.keys(REQUIRED_DOCUMENTS).filter((t) => REQUIRED_DOCUMENTS[t].blocs.some((b) => lane.blocs.includes(b)));
}

/**
 * Can this plate serve this lane at this weight, today? Every blocker is returned as its own line
 * with the fact that produced it: partner standing, missing paper, expired paper, stale paper,
 * class capability, lane registration and capacity are never merged into "not eligible".
 */
export function eligibility(partner, { plate, at = new Date(), corridor, weightKg = null } = {}) {
  if (!partner || typeof partner !== "object") throw new Error("a partner record is required");

  const laneKey = String(corridor ?? "").trim().toLowerCase();
  const lane = CORRIDORS[laneKey];
  if (!lane) throw new Error(`unknown corridor "${corridor ?? ""}" — expected one of ${Object.keys(CORRIDORS).join(", ")}`);

  const checkedAt = toTime(at, "at");
  const checkedIso = new Date(checkedAt).toISOString();
  const wanted = String(plate ?? "").trim().toUpperCase();
  if (!wanted) throw new Error("plate required — eligibility is about one vehicle");

  let weight = null;
  if (weightKg !== null && weightKg !== undefined && weightKg !== "") {
    weight = Number(weightKg);
    if (!Number.isFinite(weight) || weight <= 0) throw new Error(`weightKg must be a positive number, got "${weightKg}"`);
  }

  const blockers = [];

  if (partner.status !== "verified") {
    blockers.push(
      `partner "${partner.ownerName ?? partner.id ?? "(unnamed)"}" is ${partner.status ?? "pending"} — not verified, so its vehicles cannot be dispatched`,
    );
  }

  const vehicle = (partner.fleet ?? []).find((v) => v.plate === wanted);
  if (!vehicle) {
    blockers.push(`no vehicle with plate "${wanted}" on partner "${partner.ownerName ?? partner.id ?? "(unnamed)"}"`);
    return { eligible: false, blockers };
  }

  const cls = VEHICLE_CLASSES[vehicle.classCode];
  const kindLabel = lane.kind === "long_haul" ? "long-haul" : lane.kind;
  if (!cls || !cls.serves.includes(lane.kind)) {
    blockers.push(
      `vehicle class "${vehicle.classCode}" cannot serve corridor "${laneKey}" (${kindLabel})` +
        (cls?.note ? ` — ${cls.note}` : ""),
    );
  }

  if (!(vehicle.corridors ?? []).includes(laneKey)) {
    blockers.push(`vehicle ${wanted} is not registered for corridor "${laneKey}" — its lanes are ${(vehicle.corridors ?? []).join(", ") || "none"}`);
  }

  if (weight !== null && weight > Number(vehicle.capacityKg)) {
    blockers.push(`vehicle ${wanted} capacity ${vehicle.capacityKg} kg is below the ${weight} kg requested`);
  }

  for (const type of documentsForCorridor(laneKey)) {
    const spec = REQUIRED_DOCUMENTS[type];
    const record = vehicle.documents?.[type];

    if (!record) {
      blockers.push(`${spec.label} (${type}) is missing for ${wanted} — ${spec.detail}`);
      continue;
    }

    if (record.status !== "verified") {
      blockers.push(`${spec.label} (${type}) is on file for ${wanted} but not verified — a reference is a claim, not a check`);
    }

    if (record.expiresAt) {
      const expires = toTime(record.expiresAt, `${type} expiresAt`);
      if (expires <= checkedAt) {
        blockers.push(`${spec.label} (${type}) on ${wanted} expired on ${new Date(expires).toISOString()}, before the check at ${checkedIso}`);
      }
    }

    if (record.status === "verified" && record.verifiedAt) {
      const ageDays = (checkedAt - toTime(record.verifiedAt, `${type} verifiedAt`)) / MS_DAY;
      if (ageDays > spec.maxAgeDays) {
        blockers.push(
          `${spec.label} (${type}) on ${wanted} was verified ${Math.floor(ageDays)} days before the check, over the ${spec.maxAgeDays}-day limit`,
        );
      }
    }
  }

  return { eligible: blockers.length === 0, blockers };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const windowsOn = (partner, plate) =>
  (partner.bookings ?? []).filter((b) => String(b.plate ?? "").trim().toUpperCase() === plate);

/**
 * What is already booked on this plate between two dates, and what is still free. A dispatcher
 * reading this should be able to see the conflicting order, not just a yes/no.
 */
export function capacityCalendar(partner, { plate, from = null, to = null } = {}) {
  if (!partner || typeof partner !== "object") throw new Error("a partner record is required");
  const vehicle = vehicleOn(partner, plate);

  const fromT = from === null || from === undefined || from === "" ? Number.NEGATIVE_INFINITY : toTime(from, "from");
  const toT = to === null || to === undefined || to === "" ? Number.POSITIVE_INFINITY : toTime(to, "to");
  if (fromT > toT) throw new Error(`from ${new Date(fromT).toISOString()} is after to ${new Date(toT).toISOString()}`);

  const booked = windowsOn(partner, vehicle.plate)
    .filter((b) => overlaps(toTime(b.from, "booking from"), toTime(b.to, "booking to"), fromT, toT))
    .sort((a, b) => toTime(a.from) - toTime(b.from) || String(a.orderId).localeCompare(String(b.orderId)));

  const bookings = booked.map((b) => ({ orderId: b.orderId, from: stampOf(b.from, "booking from"), to: stampOf(b.to, "booking to") }));

  const free = [];
  if (Number.isFinite(fromT) && Number.isFinite(toT)) {
    let cursor = fromT;
    for (const b of booked) {
      const start = Math.max(fromT, toTime(b.from));
      const end = Math.min(toT, toTime(b.to));
      if (start > cursor) free.push({ from: new Date(cursor).toISOString(), to: new Date(start).toISOString() });
      cursor = Math.max(cursor, end);
    }
    if (cursor < toT) free.push({ from: new Date(cursor).toISOString(), to: new Date(toT).toISOString() });
  }

  return {
    plate: vehicle.plate,
    from: Number.isFinite(fromT) ? new Date(fromT).toISOString() : null,
    to: Number.isFinite(toT) ? new Date(toT).toISOString() : null,
    bookings,
    free,
  };
}

/**
 * Hold a window on one plate for one order. Two refusals matter: a window that starts in the past
 * (relative to the `now` the caller passes) and a window that overlaps a booking already held.
 * Windows are half-open, so a truck that drops at 12:00 can be picked up at 12:00.
 */
export function bookWindow(partner, { plate, from, to, orderId, now = new Date(), by = null } = {}) {
  if (!partner || typeof partner !== "object") throw new Error("a partner record is required");
  const vehicle = vehicleOn(partner, plate);

  const ref = String(orderId ?? "").trim();
  if (!ref) throw new Error("orderId required — every booked window belongs to an order");

  const startT = toTime(from, "from");
  const endT = toTime(to, "to");
  if (startT >= endT) {
    throw new Error(`window from ${new Date(startT).toISOString()} must end after it starts, got ${new Date(endT).toISOString()}`);
  }

  const nowT = toTime(now, "now");
  if (startT < nowT) {
    throw new Error(
      `window ${new Date(startT).toISOString()}–${new Date(endT).toISOString()} on ${vehicle.plate} starts before now ${new Date(nowT).toISOString()} — a vehicle cannot be booked into the past`,
    );
  }

  const existing = windowsOn(partner, vehicle.plate);

  const duplicate = existing.find((b) => b.orderId === ref);
  if (duplicate) {
    throw new Error(`order "${ref}" already holds ${duplicate.from}–${duplicate.to} on ${vehicle.plate}`);
  }

  const clash = existing.find((b) => overlaps(startT, endT, toTime(b.from, "booking from"), toTime(b.to, "booking to")));
  if (clash) {
    throw new Error(
      `window ${new Date(startT).toISOString()}–${new Date(endT).toISOString()} on ${vehicle.plate} overlaps order "${clash.orderId}" booked ${clash.from}–${clash.to}`,
    );
  }

  const booking = {
    plate: vehicle.plate,
    orderId: ref,
    from: new Date(startT).toISOString(),
    to: new Date(endT).toISOString(),
    bookedAt: new Date(nowT).toISOString(),
    bookedBy: by ? String(by).trim() : null,
  };

  return {
    ...partner,
    bookings: [...(partner.bookings ?? []), booking].sort((a, b) => toTime(a.from) - toTime(b.from) || String(a.orderId).localeCompare(String(b.orderId))),
    history: [...(partner.history ?? []), { event: "window_booked", plate: vehicle.plate, orderId: ref, from: booking.from, to: booking.to, at: booking.bookedAt }],
  };
}
