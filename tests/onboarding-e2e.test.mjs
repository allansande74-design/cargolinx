/**
 * Onboarding to closed transaction, end to end, for every pilot on the register.
 *
 * One test per pilot: the account is created, an order is raised and carried through every stage
 * to delivery, a tax invoice is issued from the posted order, the payment is applied in full, the
 * bank line is reconciled, and the ledger is read back to prove the balance is zero and the record
 * survives the round trip. Then the carrier side: a partner is registered, every required document
 * is verified, the partner is approved and a plate is tested for a live corridor.
 *
 * Company names only — no personal contact detail is carried in this file.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAccount, createUser, can, creditDecision } from "../engine/accounts.mjs";
import { createOrder, advance, deliver, STAGES } from "../engine/orders.mjs";
import { buildInvoice, recordPayment, nextInvoiceNumber, reconcile, ageing, creditExposure } from "../engine/invoicing.mjs";
import { registerPartner, verifyDocument, approvePartner, eligibility, REQUIRED_DOCUMENTS } from "../engine/partners.mjs";

const PILOTS = [
  { name: "Milicons Ltd", country: "KE", type: "import", lines: [{ description: "Milking equipment spares", qty: 12, unitValue: 48_500, hs: "8434.20" }] },
  { name: "Urban Edge Landscaping Company", country: "KE", type: "import", lines: [{ description: "Portable hybrid solar dry-cleaning machine", qty: 1, unitValue: 1_243_944.37, hs: "8451.10" }] },
  { name: "Facts Africa", country: "KE", type: "import", lines: [{ description: "Field survey tablets", qty: 20, unitValue: 62_000, hs: "8471.30" }] },
  { name: "2Michaelz Ltd", country: "UG", type: "import", lines: [{ description: "Solar water pumps", qty: 6, unitValue: 185_000, hs: "8413.70" }] },
];

/** The data each transition needs, in stage order, so the guard is satisfied by a recorded value. */
function dataFor(stage, order) {
  const qty = order.lines.reduce((a, l) => a + Number(l.qty), 0);
  switch (stage) {
    case "purchased": return { supplier: "Shenzhen Trading Co", poRef: "PO-1001", purchaseValue: Math.round(order.valueKes * 0.62) };
    case "freight_booked": return { carrier: "Maersk", transportRef: "MAEU-7741203" };
    case "received": return { grnRef: "GRN-2026-118", receivedQty: qty };
    case "picked": return { pickedQty: qty };
    case "packed": return { packedQty: qty };
    case "dispatched": return { vehicleId: "veh_nairobi_04", driverName: "Driver 04", trackingRef: "TRK-88213" };
    case "delivered": return { signedBy: "Consignee" };
    default: return {};
  }
}

function runLifecycle(pilot, index) {
  const account = createAccount({ name: pilot.name, country: pilot.country, creditLimitKes: 0, terms: "prepayment" });
  assert.equal(account.name, pilot.name);

  const user = createUser({ accountId: account.id, name: `${pilot.name} buyer`, email: `buyer${index + 1}@example.com`, role: "client_admin" });
  assert.equal(can(user.role, "order.create"), true);
  assert.equal(can(user.role, "pricing.policy.view"), false, "a client must never hold the policy permission");

  let order = createOrder({ accountId: account.id, type: pilot.type, lines: pilot.lines, incoterm: "DDP", currency: "KES" });
  assert.equal(order.stage, "draft");

  const trail = [];
  for (const stage of STAGES.map((s) => s.key).slice(1)) {
    order = advance(order, { ...dataFor(stage, order), stage }, { role: "ops" });
    trail.push(order.stage);
  }
  assert.equal(order.stage, "delivered", `${pilot.name}: order did not reach delivery`);
  assert.equal(order.history.length, STAGES.length, `${pilot.name}: history does not record every stage`);

  const number = nextInvoiceNumber({ prefix: "INV", series: [`INV-2611-0001`, `INV-2611-0002`], at: new Date("2026-11-03T08:00:00Z") });
  let invoice = buildInvoice({
    order,
    kind: "tax",
    charges: [{ description: "Delivery to door", amount: 3_894.9 }],
    number,
    at: new Date("2026-11-03T08:05:00Z"),
  });
  assert.equal(Math.round((invoice.subtotal + invoice.vat) * 100) / 100, invoice.total, `${pilot.name}: invoice lines do not sum to the total`);
  assert.equal(invoice.status, "unpaid");

  const rec = reconcile({ invoices: [invoice], statement: [{ amount: invoice.balance, reference: number }] });
  assert.equal(rec.matched, 1, `${pilot.name}: bank line did not reconcile against the outstanding balance`);

  invoice = recordPayment(invoice, { amount: invoice.total, method: "bank", reference: number, at: new Date("2026-11-03T09:00:00Z") });
  assert.equal(invoice.status, "paid", `${pilot.name}: invoice did not settle`);
  assert.equal(invoice.balance, 0, `${pilot.name}: balance did not clear to zero`);
  assert.equal(invoice.payments.length, 1);

  const afterSettle = reconcile({ invoices: [invoice], statement: [{ amount: 0, reference: number }] });
  assert.equal(afterSettle.matched, 1, `${pilot.name}: settled invoice does not reconcile to a zero balance`);

  const age = ageing([invoice], new Date("2026-11-04T09:00:00Z"));
  assert.equal(age.outstanding, 0, `${pilot.name}: settled invoice still shows as outstanding`);
  assert.equal(creditExposure([invoice], account.id), 0, `${pilot.name}: exposure did not clear`);

  const decision = creditDecision({ account, orderValueKes: order.valueKes, outstandingKes: 0 });
  assert.equal(decision.approved, true, `${pilot.name}: prepayment account was not cleared to order`);

  // Read the settlement back the way a later reader would: the record must carry its own proof.
  const reopened = JSON.parse(JSON.stringify(invoice));
  assert.equal(reopened.status, "paid");
  assert.equal(reopened.payments[0].reference, number);
  assert.equal(reopened.orderId, order.id);

  return { pilot: pilot.name, order: order.id, valueKes: order.valueKes, invoice: number, total: invoice.total, stages: trail.length, reconciled: rec.matched };
}

test("every pilot onboards and closes out a transaction end to end", () => {
  const results = PILOTS.map(runLifecycle);
  assert.equal(results.length, PILOTS.length);
  for (const r of results) {
    assert.ok(r.stages === STAGES.length - 1, `${r.pilot}: expected ${STAGES.length - 1} transitions, got ${r.stages}`);
    assert.ok(r.total > 0, `${r.pilot}: invoice total not positive`);
    assert.equal(r.reconciled, 1);
  }
  console.log("\n  onboarding -> closed transaction\n" + results.map((r) =>
    `  ${r.pilot.padEnd(34)} ${r.invoice}  KES ${r.total.toLocaleString("en-KE")}  ${r.stages} stages  reconciled`).join("\n"));
});

test("a carrier partner onboards, verifies and becomes dispatchable", () => {
  let partner = registerPartner({
    ownerName: "Rift Valley Haulage",
    country: "KE",
    contact: { phone: "+254700000001" },
    fleet: [{ plate: "KDA 001A", classCode: "light_truck", capacityKg: 3000, corridors: ["nairobi_last_mile"] }],
  });
  assert.equal(partner.status, "pending");

  const plates = partner.fleet.map((v) => v.plate);
  assert.equal(plates.length, 1);

  for (const [i, type] of Object.keys(REQUIRED_DOCUMENTS).entries()) {
    partner = verifyDocument(partner, {
      plate: plates[0],
      type,
      reference: `DOC-${1000 + i}`,
      expiresAt: "2027-06-30T00:00:00Z",
      verifiedBy: "Altovex ops",
      at: new Date("2026-11-03T08:00:00Z"),
    });
  }

  partner = approvePartner(partner, { by: "Altovex ops", reference: "VER-2026-0042", at: new Date("2026-11-03T08:30:00Z") });
  assert.equal(partner.status, "verified");

  const verdict = eligibility(partner, { plate: plates[0], corridor: "nairobi_last_mile", at: new Date("2026-11-03T09:00:00Z"), weightKg: 1200 });
  assert.equal(verdict.eligible, true, `partner not dispatchable: ${JSON.stringify(verdict.blockers)}`);

  // A plate with no verification on file must not become eligible by being asked twice.
  const second = registerPartner({ ownerName: "Coast Carriers", country: "KE", contact: { phone: "+254700000002" }, fleet: [{ plate: "KDB 002B", classCode: "light_truck", capacityKg: 3000, corridors: ["nairobi_last_mile"] }] });
  const refused = eligibility(second, { plate: "KDB 002B", corridor: "nairobi_last_mile", at: new Date("2026-11-03T09:00:00Z") });
  assert.equal(refused.eligible, false, "an unverified partner was treated as dispatchable");
  assert.ok(refused.blockers.length > 0);
});
