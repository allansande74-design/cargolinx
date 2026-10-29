import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_DOCUMENTS,
  CORRIDORS,
  VEHICLE_CLASSES,
  BLOCS,
  registerPartner,
  verifyDocument,
  approvePartner,
  eligibility,
  capacityCalendar,
  bookWindow,
  documentsForBloc,
  documentsForCorridor,
} from "../engine/partners.mjs";

const CHECK = new Date("2026-10-29T09:00:00Z");

const fleet = () => [
  { plate: "kdg 123a", classCode: "heavy_truck", capacityKg: 24000, corridors: ["northern", "central"] },
  { plate: "KDA 456B", classCode: "light_truck", capacityKg: 3200, corridors: ["northern", "nairobi_last_mile"] },
];

const base = () => ({
  ownerName: "Rift Valley Haulage",
  country: "ke",
  contact: { email: "ops@riftvalley.example", phone: "+254 700 000 000", person: "J. Otieno" },
  fleet: fleet(),
  at: CHECK,
});

const approved = () => approvePartner(registerPartner(base()), { by: "Sande Allan", reference: "NTSA carrier licence 2026-88", at: CHECK });

/**
 * Build an approved partner whose named documents are verified. A `null` config leaves that
 * document off the vehicle entirely; `{}` verifies it with the house defaults.
 */
function withDocs(overrides = {}, plate = "KDG 123A") {
  let p = approved();
  const defaults = Object.fromEntries(Object.keys(REQUIRED_DOCUMENTS).map((t) => [t, {}]));
  for (const [type, cfg] of Object.entries({ ...defaults, ...overrides })) {
    if (cfg === null) continue;
    p = verifyDocument(p, {
      plate,
      type,
      reference: cfg.reference ?? `${type.toUpperCase()}-2026-001`,
      expiresAt: cfg.expiresAt ?? "2027-12-31T00:00:00Z",
      verifiedBy: cfg.verifiedBy ?? "Sande Allan",
      at: new Date(cfg.at ?? "2026-10-01T08:00:00Z"),
    });
  }
  return p;
}

// ---------------------------------------------------------------------------
// the document table
// ---------------------------------------------------------------------------

test("the document table states its blocs, its age limit and the reason for each", () => {
  assert.deepEqual(Object.keys(REQUIRED_DOCUMENTS), [
    "insurance",
    "inspection",
    "vehicle_licence",
    "driver_licence",
    "operating_permit",
  ]);

  for (const [type, spec] of Object.entries(REQUIRED_DOCUMENTS)) {
    assert.ok(spec.blocs.length > 0, `${type} applies to no bloc`);
    assert.ok(spec.blocs.every((b) => BLOCS[b]), `${type} names a bloc the register does not know`);
    assert.ok(spec.maxAgeDays > 0, `${type} has no age limit`);
    assert.ok(spec.label && spec.basis, `${type} carries no label or basis`);
  }

  assert.deepEqual(REQUIRED_DOCUMENTS.insurance.blocs, ["EAC", "COMESA", "SADC"]);
  assert.ok(!REQUIRED_DOCUMENTS.inspection.blocs.includes("SADC"));
  assert.equal(REQUIRED_DOCUMENTS.inspection.maxAgeDays, 180);
  assert.equal(REQUIRED_DOCUMENTS.driver_licence.maxAgeDays, 1095);
});

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

test("registration refuses a missing name, a non-code country and an unreachable contact", () => {
  assert.throws(() => registerPartner({ ...base(), ownerName: "  " }), /owner name required/);
  assert.throws(() => registerPartner({ ...base(), country: "Kenya" }), /two-letter code/);
  assert.throws(() => registerPartner({ ...base(), country: "" }), /two-letter code/);
  assert.throws(() => registerPartner({ ...base(), contact: null }), /contact email or phone required/);
  assert.throws(() => registerPartner({ ...base(), contact: { email: "not-an-email" } }), /contact email or phone required/);
  assert.throws(() => registerPartner({ ...base(), contact: { phone: "12345" } }), /contact email or phone required/);
});

test("registration refuses a fleet that is empty or wrongly described", () => {
  assert.throws(() => registerPartner({ ...base(), fleet: [] }), /at least one vehicle required/);
  assert.throws(() => registerPartner({ ...base(), fleet: "KDG 123A" }), /at least one vehicle required/);

  const one = (vehicle) => registerPartner({ ...base(), fleet: [vehicle] });
  assert.throws(() => one({ ...fleet()[0], plate: "  " }), /plate required/);
  assert.throws(() => one({ ...fleet()[0], classCode: "spaceship" }), /unknown class/);
  assert.throws(() => one({ ...fleet()[0], capacityKg: 0 }), /capacityKg must be a positive/);
  assert.throws(() => one({ ...fleet()[0], capacityKg: "heavy" }), /capacityKg must be a positive/);
  assert.throws(() => one({ ...fleet()[1], classCode: "motorbike", capacityKg: 2700 }), /exceeds the .* class ceiling/);
  assert.throws(() => one({ ...fleet()[0], corridors: [] }), /at least one corridor required/);
  assert.throws(() => one({ ...fleet()[0], corridors: ["moon"] }), /unknown corridor/);
  assert.throws(() => registerPartner({ ...base(), fleet: [fleet()[0], { ...fleet()[0], plate: "kdg 123a" }] }), /duplicate plate/);

  assert.throws(() => one({ ...fleet()[0], documents: { insurance: {} } }), /carries no reference/);
  assert.throws(() => one({ ...fleet()[0], documents: { unicorn: { reference: "X", expiresAt: "2027-01-01T00:00:00Z" } } }), /unknown document/);
});

test("a new partner is pending, and a document supplied at registration is only a claim", () => {
  const p = registerPartner({
    ...base(),
    contact: "ops@riftvalley.example",
    fleet: [{ ...fleet()[0], documents: { insurance: { reference: "UAP-2026-4411", expiresAt: "2027-06-30T00:00:00Z" } } }],
  });

  assert.equal(p.status, "pending");
  assert.equal(p.verifiedAt, null);
  assert.equal(p.country, "KE");
  assert.equal(p.contact.email, "ops@riftvalley.example");
  assert.deepEqual(p.bookings, []);
  assert.equal(p.history[0].event, "registered");

  assert.equal(p.fleet[0].plate, "KDG 123A", "the plate is stored upper case");
  assert.equal(p.fleet[0].documents.insurance.status, "claimed");
  assert.equal(p.fleet[0].documents.insurance.verifiedBy, null);
  assert.equal(p.fleet[0].documents.insurance.reference, "UAP-2026-4411");

  // a phone-only contact is reachable too
  const phoneOnly = registerPartner({ ...base(), contact: "+254 711 222 333" });
  assert.equal(phoneOnly.contact.phone, "+254 711 222 333");
  assert.equal(phoneOnly.contact.email, null);
});

// ---------------------------------------------------------------------------
// document verification
// ---------------------------------------------------------------------------

test("verification is refused without a reference, a named checker or a usable document", () => {
  const p = registerPartner(base());

  assert.throws(() => verifyDocument(null, {}), /partner record is required/);
  assert.throws(() => verifyDocument(p, { plate: "NOPE 000", type: "insurance", reference: "R", expiresAt: "2027-01-01T00:00:00Z", verifiedBy: "X" }), /no vehicle with plate/);
  assert.throws(() => verifyDocument(p, { plate: "KDG 123A", type: "unicorn", reference: "R", expiresAt: "2027-01-01T00:00:00Z", verifiedBy: "X" }), /unknown document type/);
  assert.throws(() => verifyDocument(p, { plate: "KDG 123A", type: "insurance", expiresAt: "2027-01-01T00:00:00Z", verifiedBy: "X" }), /requires a reference/);
  assert.throws(() => verifyDocument(p, { plate: "KDG 123A", type: "insurance", reference: "   ", expiresAt: "2027-01-01T00:00:00Z", verifiedBy: "X" }), /requires a reference/);
  assert.throws(() => verifyDocument(p, { plate: "KDG 123A", type: "insurance", reference: "R-1", expiresAt: "2027-01-01T00:00:00Z" }), /must name who checked/);
  assert.throws(() => verifyDocument(p, { plate: "KDG 123A", type: "insurance", reference: "R-1", expiresAt: "next year", verifiedBy: "X" }), /must be a date/);
  assert.throws(() => verifyDocument(p, { plate: "KDG 123A", type: "insurance", reference: "R-1", expiresAt: undefined, verifiedBy: "X" }), /must be a date/);

  assert.equal(p.fleet[0].documents.insurance, undefined, "a refused verification writes nothing");
});

test("a document that has already expired cannot be verified", () => {
  const p = registerPartner(base());
  const call = (expiresAt) =>
    verifyDocument(p, { plate: "KDG 123A", type: "insurance", reference: "UAP-2026-1", expiresAt, verifiedBy: "Sande Allan", at: CHECK });

  assert.throws(() => call("2026-09-01T00:00:00Z"), /expired on 2026-09-01.*cannot be verified/);
  assert.throws(() => call("2026-10-29T09:00:00Z"), /cannot be verified/, "a document expiring exactly at the check is expired");
});

test("verification records the reference, the checker and the expiry, and leaves the original alone", () => {
  const p = registerPartner(base());
  const q = verifyDocument(p, {
    plate: "kdg 123a",
    type: "insurance",
    reference: "UAP-2026-4411",
    expiresAt: "2027-06-30T00:00:00Z",
    verifiedBy: "Sande Allan",
    at: new Date("2026-10-01T08:00:00Z"),
  });

  const doc = q.fleet[0].documents.insurance;
  assert.equal(doc.status, "verified");
  assert.equal(doc.reference, "UAP-2026-4411");
  assert.equal(doc.verifiedBy, "Sande Allan");
  assert.equal(doc.verifiedAt, "2026-10-01T08:00:00.000Z");
  assert.equal(doc.expiresAt, "2027-06-30T00:00:00.000Z");

  const entry = q.history.at(-1);
  assert.equal(entry.event, "document_verified");
  assert.equal(entry.plate, "KDG 123A");
  assert.equal(entry.type, "insurance");
  assert.equal(entry.reference, "UAP-2026-4411");

  assert.equal(p.fleet[0].documents.insurance, undefined, "the partner handed in is not mutated");
});

// ---------------------------------------------------------------------------
// approval
// ---------------------------------------------------------------------------

test("approval without a reference or a checker is refused and leaves the partner pending", () => {
  const p = registerPartner(base());
  assert.throws(() => approvePartner(p, { by: "Sande Allan" }), /requires a verification reference/);
  assert.throws(() => approvePartner(p, { by: "Sande Allan", reference: "  " }), /requires a verification reference/);
  assert.throws(() => approvePartner(p, { reference: "NTSA-2026-88" }), /must name who checked/);
  assert.equal(p.status, "pending");
});

test("approval moves the partner to verified with the checker and the reference on file", () => {
  const q = approvePartner(registerPartner(base()), { by: "Sande Allan", reference: "NTSA carrier licence 2026-88", at: CHECK });

  assert.equal(q.status, "verified");
  assert.equal(q.verifiedAt, "2026-10-29T09:00:00.000Z");
  assert.equal(q.verification.reference, "NTSA carrier licence 2026-88");
  assert.equal(q.verification.by, "Sande Allan");
  assert.equal(q.history.at(-1).event, "approved");
});

// ---------------------------------------------------------------------------
// eligibility
// ---------------------------------------------------------------------------

test("a verified partner with every paper current is eligible on its lane", () => {
  const p = withDocs();
  const res = eligibility(p, { plate: "kdg 123a", at: CHECK, corridor: "northern", weightKg: 12000 });
  assert.deepEqual(res, { eligible: true, blockers: [] });
});

test("partner standing is its own blocker", () => {
  const res = eligibility(registerPartner(base()), { plate: "KDG 123A", at: CHECK, corridor: "northern", weightKg: 1000 });
  assert.equal(res.eligible, false);
  assert.match(res.blockers[0], /partner "Rift Valley Haulage" is pending — not verified/);
});

test("a missing document and an expired document are named separately", () => {
  const missing = eligibility(withDocs({ inspection: null }), { plate: "KDG 123A", at: CHECK, corridor: "northern", weightKg: 1000 });
  const expired = eligibility(
    withDocs({ insurance: { at: "2026-01-05T00:00:00Z", expiresAt: "2026-06-30T00:00:00Z" } }),
    { plate: "KDG 123A", at: CHECK, corridor: "northern", weightKg: 1000 },
  );

  assert.equal(missing.eligible, false);
  assert.equal(missing.blockers.length, 1);
  assert.match(missing.blockers[0], /Inspection \(inspection\) is missing for KDG 123A/);
  assert.doesNotMatch(missing.blockers[0], /expired/);

  assert.equal(expired.eligible, false);
  assert.equal(expired.blockers.length, 1);
  assert.match(expired.blockers[0], /Insurance \(insurance\) on KDG 123A expired on 2026-06-30T00:00:00.000Z, before the check at 2026-10-29T09:00:00.000Z/);
  assert.doesNotMatch(expired.blockers[0], /missing/);

  assert.notEqual(missing.blockers[0], expired.blockers[0], "the two failures are never merged");

  // the same file is fine before the expiry: the check is made at `at`, not at verification time
  const early = eligibility(
    withDocs({ insurance: { at: "2026-01-05T00:00:00Z", expiresAt: "2026-06-30T00:00:00Z" } }),
    { plate: "KDG 123A", at: new Date("2026-03-01T00:00:00Z"), corridor: "northern", weightKg: 1000 },
  );
  assert.equal(early.eligible, true);
});

test("a document older than its age limit is stale, not merely present", () => {
  const res = eligibility(
    withDocs({ inspection: { at: "2025-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z" } }),
    { plate: "KDG 123A", at: CHECK, corridor: "northern", weightKg: 1000 },
  );

  assert.equal(res.eligible, false);
  assert.equal(res.blockers.length, 1);
  assert.match(res.blockers[0], /Inspection \(inspection\) on KDG 123A was verified 666 days before the check, over the 180-day limit/);
  assert.doesNotMatch(res.blockers[0], /missing|expired/);
});

test("a document on file but never verified is its own blocker", () => {
  const claimed = registerPartner({
    ...base(),
    fleet: fleet().map((v) =>
      v.plate.toUpperCase() === "KDG 123A"
        ? { ...v, documents: { insurance: { reference: "UAP-2026-1", expiresAt: "2027-06-30T00:00:00Z" } } }
        : v,
    ),
  });

  const res = eligibility(claimed, { plate: "KDG 123A", at: CHECK, corridor: "northern" });
  assert.ok(res.blockers.some((b) => /Insurance \(insurance\) is on file for KDG 123A but not verified/.test(b)));
  assert.ok(!res.blockers.some((b) => /Insurance \(insurance\) is missing/.test(b)));
});

test("vehicle class and capacity are separate blockers, each with its number", () => {
  const motorbikeFleet = [{ plate: "KME 789C", classCode: "motorbike", capacityKg: 45, corridors: ["northern"] }];
  let bike = approvePartner(registerPartner({ ...base(), fleet: motorbikeFleet }), { by: "Sande Allan", reference: "NTSA-2026-90", at: CHECK });
  for (const type of documentsForCorridor("northern")) {
    bike = verifyDocument(bike, {
      plate: "KME 789C",
      type,
      reference: `${type}-BIKE-1`,
      expiresAt: "2027-12-31T00:00:00Z",
      verifiedBy: "Sande Allan",
      at: new Date("2026-10-01T08:00:00Z"),
    });
  }

  const res = eligibility(bike, { plate: "KME 789C", at: CHECK, corridor: "northern", weightKg: 100 });
  assert.equal(res.eligible, false);
  assert.equal(res.blockers.length, 2);
  assert.match(res.blockers[0], /vehicle class "motorbike" cannot serve corridor "northern" \(long-haul\)/);
  assert.match(res.blockers[1], /vehicle KME 789C capacity 45 kg is below the 100 kg requested/);

  // the light truck is registered on the lane and of the right class, so only capacity stands in the way
  const truck = withDocs({}, "KDA 456B");
  const heavyLoad = eligibility(truck, { plate: "KDA 456B", at: CHECK, corridor: "northern", weightKg: 5000 });
  assert.deepEqual(heavyLoad.blockers, ["vehicle KDA 456B capacity 3200 kg is below the 5000 kg requested"]);
  assert.equal(eligibility(truck, { plate: "KDA 456B", at: CHECK, corridor: "northern", weightKg: 3200 }).eligible, true);
});

test("a vehicle not registered for the lane is named separately from its class", () => {
  const res = eligibility(withDocs(), { plate: "KDG 123A", at: CHECK, corridor: "beira", weightKg: 1000 });
  assert.equal(res.eligible, false);
  assert.deepEqual(res.blockers, [
    'vehicle KDG 123A is not registered for corridor "beira" — its lanes are northern, central',
  ]);
});

test("documents are demanded per bloc: a SADC lane does not ask for the EAC inspection", () => {
  assert.deepEqual(documentsForBloc("eac"), ["insurance", "inspection", "vehicle_licence", "driver_licence", "operating_permit"]);
  assert.deepEqual(documentsForBloc("sadc"), ["insurance", "vehicle_licence", "driver_licence"]);
  assert.deepEqual(documentsForCorridor("beira"), ["insurance", "vehicle_licence", "driver_licence"]);
  assert.deepEqual(documentsForCorridor("north_south"), ["insurance", "inspection", "vehicle_licence", "driver_licence", "operating_permit"]);
  assert.deepEqual(documentsForCorridor("nairobi_last_mile"), ["insurance", "inspection", "vehicle_licence", "driver_licence", "operating_permit"]);

  assert.throws(() => documentsForBloc("ASEAN"), /unknown bloc/);
  assert.throws(() => documentsForCorridor("silk_road"), /unknown corridor/);
  assert.deepEqual(CORRIDORS.north_south.blocs, ["COMESA", "SADC"]);

  // and the table is load-bearing: a beira truck carrying only the three SADC papers is eligible
  const truck = { plate: "B 1234 ZW", classCode: "heavy_truck", capacityKg: 20000, corridors: ["beira"] };
  let p = approvePartner(registerPartner({ ...base(), fleet: [truck] }), { by: "Sande Allan", reference: "ZINARA-2026-7", at: CHECK });
  for (const type of documentsForCorridor("beira")) {
    p = verifyDocument(p, { plate: "B 1234 ZW", type, reference: `${type}-ZW-1`, expiresAt: "2027-12-31T00:00:00Z", verifiedBy: "Sande Allan", at: new Date("2026-10-01T08:00:00Z") });
  }
  assert.deepEqual(eligibility(p, { plate: "B 1234 ZW", at: CHECK, corridor: "beira", weightKg: 8000 }), { eligible: true, blockers: [] });
});

test("a drone operator can be registered, but no corridor is open to it yet", () => {
  const drone = { plate: "DRN 001", classCode: "drone", capacityKg: 15, corridors: ["nairobi_last_mile"] };
  assert.equal(VEHICLE_CLASSES.drone.serves.includes("air"), true);

  let p = approvePartner(registerPartner({ ...base(), fleet: [drone] }), { by: "Sande Allan", reference: "KCAA-2026-3", at: CHECK });
  for (const type of documentsForCorridor("nairobi_last_mile")) {
    p = verifyDocument(p, { plate: "DRN 001", type, reference: `${type}-DRN-1`, expiresAt: "2027-12-31T00:00:00Z", verifiedBy: "Sande Allan", at: new Date("2026-10-01T08:00:00Z") });
  }

  const res = eligibility(p, { plate: "DRN 001", at: CHECK, corridor: "nairobi_last_mile", weightKg: 5 });
  assert.equal(res.eligible, false);
  assert.match(res.blockers[0], /vehicle class "drone" cannot serve corridor "nairobi_last_mile" \(urban\)/);
  assert.match(res.blockers[0], /no corridor here is open to drone freight yet/);
});

test("eligibility refuses a guessed corridor, a missing plate or a nonsense weight", () => {
  const p = withDocs();
  assert.throws(() => eligibility(p, { plate: "KDG 123A", corridor: "silk_road" }), /unknown corridor/);
  assert.throws(() => eligibility(p, { corridor: "northern" }), /plate required/);
  assert.throws(() => eligibility(p, { plate: "KDG 123A", corridor: "northern", weightKg: 0 }), /weightKg must be a positive/);

  const missing = eligibility(p, { plate: "XXX 000", corridor: "northern" });
  assert.equal(missing.eligible, false);
  assert.match(missing.blockers[0], /no vehicle with plate "XXX 000"/);
});

// ---------------------------------------------------------------------------
// capacity calendar and bookings
// ---------------------------------------------------------------------------

test("booked windows are listed on the plate's calendar with the free gaps between them", () => {
  let p = withDocs();
  p = bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T08:00:00Z", to: "2026-10-30T12:00:00Z", orderId: "ORD-1001", now: CHECK, by: "Dispatcher" });
  p = bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T14:00:00Z", to: "2026-10-30T18:00:00Z", orderId: "ORD-1002", now: CHECK, by: "Dispatcher" });

  const cal = capacityCalendar(p, { plate: "kdg 123a", from: "2026-10-30T07:00:00Z", to: "2026-10-30T20:00:00Z" });

  assert.equal(cal.plate, "KDG 123A");
  assert.deepEqual(cal.bookings, [
    { orderId: "ORD-1001", from: "2026-10-30T08:00:00.000Z", to: "2026-10-30T12:00:00.000Z" },
    { orderId: "ORD-1002", from: "2026-10-30T14:00:00.000Z", to: "2026-10-30T18:00:00.000Z" },
  ]);
  assert.deepEqual(cal.free, [
    { from: "2026-10-30T07:00:00.000Z", to: "2026-10-30T08:00:00.000Z" },
    { from: "2026-10-30T12:00:00.000Z", to: "2026-10-30T14:00:00.000Z" },
    { from: "2026-10-30T18:00:00.000Z", to: "2026-10-30T20:00:00.000Z" },
  ]);
  assert.equal(p.history.at(-1).event, "window_booked");

  // the other plate's calendar is not polluted by KDG's bookings
  assert.deepEqual(capacityCalendar(p, { plate: "KDA 456B", from: "2026-10-30T07:00:00Z", to: "2026-10-30T20:00:00Z" }).bookings, []);
  // a window outside the asked range is not listed
  assert.deepEqual(capacityCalendar(p, { plate: "KDG 123A", from: "2026-10-30T12:30:00Z", to: "2026-10-30T13:30:00Z" }).bookings, []);
});

test("an overlapping booking is refused and names the order already holding the window", () => {
  let p = withDocs();
  p = bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T08:00:00Z", to: "2026-10-30T12:00:00Z", orderId: "ORD-1001", now: CHECK });

  assert.throws(
    () => bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T10:00:00Z", to: "2026-10-30T13:00:00Z", orderId: "ORD-1002", now: CHECK }),
    /overlaps order "ORD-1001" booked 2026-10-30T08:00:00.000Z–2026-10-30T12:00:00.000Z/,
  );
  assert.throws(
    () => bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T07:00:00Z", to: "2026-10-30T09:00:00Z", orderId: "ORD-1003", now: CHECK }),
    /overlaps order "ORD-1001"/,
  );
  assert.equal(p.bookings.length, 1, "a refused booking writes nothing");

  // half-open windows: a drop at 12:00 frees the truck for a 12:00 pickup
  const touching = bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T12:00:00Z", to: "2026-10-30T13:00:00Z", orderId: "ORD-1004", now: CHECK });
  assert.equal(touching.bookings.length, 2);
});

test("a window in the past relative to the passed now is refused", () => {
  const p = withDocs();

  assert.throws(
    () => bookWindow(p, { plate: "KDG 123A", from: "2026-10-29T05:00:00Z", to: "2026-10-29T07:00:00Z", orderId: "ORD-2000", now: CHECK }),
    /starts before now 2026-10-29T09:00:00.000Z — a vehicle cannot be booked into the past/,
  );
  assert.throws(() => bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T10:00:00Z", to: "2026-10-30T10:00:00Z", orderId: "ORD-2001", now: CHECK }), /must end after it starts/);
  assert.throws(() => bookWindow(p, { plate: "KDG 123A", from: "2026-10-30T10:00:00Z", to: "2026-10-30T11:00:00Z", now: CHECK }), /orderId required/);
  assert.throws(() => bookWindow(p, { plate: "XXX 000", from: "2026-10-30T10:00:00Z", to: "2026-10-30T11:00:00Z", orderId: "ORD-2002", now: CHECK }), /no vehicle with plate/);

  // a window that starts exactly now is not in the past
  const open = bookWindow(p, { plate: "KDG 123A", from: "2026-10-29T09:00:00Z", to: "2026-10-29T10:00:00Z", orderId: "ORD-2003", now: CHECK });
  assert.equal(open.bookings.length, 1);

  const twice = bookWindow(open, { plate: "KDG 123A", from: "2026-10-31T09:00:00Z", to: "2026-10-31T10:00:00Z", orderId: "ORD-2004", now: CHECK });
  assert.equal(twice.bookings.length, 2, "two orders can hold separate windows on one plate");
  assert.throws(
    () => bookWindow(open, { plate: "KDG 123A", from: "2026-10-29T11:00:00Z", to: "2026-10-29T12:00:00Z", orderId: "ORD-2003", now: CHECK }),
    /already holds/,
  );
});
