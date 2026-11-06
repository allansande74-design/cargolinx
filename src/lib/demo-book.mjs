import { all, put, STORES, saveOrder, kvSet } from "./db.js";
import { createAccount, createUser } from "../../engine/accounts.mjs";
import { createOrder, advance } from "../../engine/orders.mjs";
import { buildInvoice, recordPayment } from "../../engine/invoicing.mjs";
import { registerTruck, verifyTruckPapers, approveTruck } from "./truck-matching.mjs";
import { recordAdvance } from "./advance.mjs";

const DAY = 86400000;
const at = (now, days) => new Date(new Date(now).getTime() + days * DAY).toISOString();
const step = (order, patch = {}) => advance(order, patch, { role: "ops" });

/**
 * A demonstration book, seeded once, so a stakeholder opens a desk with real rows in it instead of
 * an empty table. Everything here goes through the same engine the desk uses: stages are entered one
 * at a time, invoices come from buildInvoice, and the truck is registered and approved like any other.
 */
export async function ensureDemoBook(now = new Date()) {
  const existing = await all(STORES.orders).catch(() => []);
  if (existing && existing.length) return { seeded: false, orders: existing.length };

  const accounts = [
    { ...createAccount({ name: "Otieno Stores", country: "KE", taxPin: "P051234567X", terms: "net30", creditLimitKes: 5000000 }), users: [] },
    { ...createAccount({ name: "Nairobi Hardware Ltd", country: "KE", terms: "net15", creditLimitKes: 2000000 }), users: [] },
    { ...createAccount({ name: "Kampala Traders Ltd", country: "UG", terms: "prepayment", creditLimitKes: 0 }), users: [] },
  ];
  accounts[0].users = [createUser({ accountId: accounts[0].id, name: "J. Otieno", email: "j.otieno@otienostores.co.ke", role: "client_admin" })];
  accounts[1].users = [createUser({ accountId: accounts[1].id, name: "W. Kamau", email: "w.kamau@nairobihardware.co.ke", role: "client_user" })];

  const [a1, a2, a3] = accounts;

  const line = (description, qty, unitValue, hs = null) => ({ description, qty, unitValue, hs });

  const base = (accountId, lines, promisedInDays, destination) =>
    createOrder({
      accountId,
      type: "import",
      lines,
      destination,
      promisedAt: at(now, promisedInDays),
    });

  // Delivered, and late against its promise — the file that shows a proof of delivery.
  let o1 = base(a1.id, [line("SP450 solar floodlight, 450W", 20, 156362.92, "9405.42")], -3, { city: "Nairobi", name: "Otieno Stores — Industrial Area" });
  o1 = step(step(o1, { stage: "confirmed" }), { stage: "sourcing" });
  o1 = step(o1, { stage: "purchased", supplier: "Kunpeng Industrial Ltd", poRef: "PO-2026-118", purchaseValue: 1850000 });
  o1 = step(o1, { stage: "freight_booked", carrier: "Otieno Haulage", transportRef: "TRP-4471" });
  o1 = step(o1, { stage: "in_transit" });
  o1 = step(o1, { stage: "arrived" });
  o1 = step(o1, { stage: "received", grnRef: "GRN-2291", receivedQty: 20, receiptVariance: 0, receiptStatus: "clean" });
  o1 = step(o1, { stage: "picked", pickedQty: 20 });
  o1 = step(o1, { stage: "packed", packedQty: 20 });
  o1 = step(o1, { stage: "dispatched", vehicleId: "KDA 123A", driverName: "Peter Mwangi", driverPhone: "+254712000111", trackingRef: "CLX-8841" });
  o1 = step(o1, { stage: "delivered", signedBy: "J. Otieno", pod: { signedBy: "J. Otieno", at: at(now, -2) } });

  // On the road, promised tomorrow morning — at risk.
  let o2 = base(a2.id, [line("Rotavator blade set, 12-piece", 40, 24500, "8432.90")], 0.4, { city: "Nakuru", name: "Nairobi Hardware — Nakuru branch" });
  o2 = step(step(o2, { stage: "confirmed" }), { stage: "sourcing" });
  o2 = step(o2, { stage: "purchased", supplier: "Sonalika Kenya", poRef: "PO-2026-121", purchaseValue: 760000 });
  o2 = step(o2, { stage: "freight_booked", carrier: "Otieno Haulage", transportRef: "TRP-4488" });
  o2 = step(o2, { stage: "in_transit" });

  // Dispatched on the last mile — a driver can close this one with a proof of delivery.
  let o3 = base(a1.id, [line("Cold room condensing unit, 5HP", 3, 412000, "8418.69")], 0.25, { city: "Nairobi", name: "Otieno Stores — cold store" });
  o3 = step(step(o3, { stage: "confirmed" }), { stage: "sourcing" });
  o3 = step(o3, { stage: "purchased", supplier: "Kunpeng Industrial Ltd", poRef: "PO-2026-124", purchaseValue: 985000 });
  o3 = step(o3, { stage: "freight_booked", carrier: "Otieno Haulage", transportRef: "TRP-4501" });
  o3 = step(o3, { stage: "in_transit" });
  o3 = step(o3, { stage: "arrived" });
  o3 = step(o3, { stage: "received", grnRef: "GRN-2298", receivedQty: 3, receiptVariance: 0, receiptStatus: "clean" });
  o3 = step(o3, { stage: "picked", pickedQty: 3 });
  o3 = step(o3, { stage: "packed", packedQty: 3 });
  o3 = step(o3, { stage: "dispatched", vehicleId: "KDA 123A", driverName: "Peter Mwangi", driverPhone: "+254****0111", trackingRef: "CLX-8850" });
  o3.tripAmountKes = 120000;
  o3.carrier = { id: "Otieno Haulage", verified: true };
  {
    const r = recordAdvance({ ...o3, stage: "dispatched", vehicleId: "KDA 123A", trackingRef: "CLX-8850", tripAmountKes: 120000, carrier: { id: "Otieno Haulage", verified: true } }, 30000);
    if (r.ok) o3.advance = r.advance;
  }

  // Purchased, in the warehouse queue.
  let o4 = base(a3.id, [line("LED high bay, 150W", 120, 8900, "9405.41")], 8, { city: "Kampala", name: "Kampala Traders — Ntinda" });
  o4 = step(step(o4, { stage: "confirmed" }), { stage: "sourcing" });
  o4 = step(o4, { stage: "purchased", supplier: "Kunpeng Industrial Ltd", poRef: "PO-2026-127", purchaseValue: 690000 });

  // Still being sourced — the quote that has not been bought.
  let o5 = base(a2.id, [line("Bakery deck oven, 3-deck", 2, 385000, "8417.20")], 14, { city: "Nairobi", name: "Nairobi Hardware — head office" });
  o5 = step(step(o5, { stage: "confirmed" }), { stage: "sourcing" });

  const orders = [o1, o2, o3, o4, o5];

  // Invoices: a tax invoice 40 days old and unpaid, and a proforma part-paid on the Kampala file.
  const tax = buildInvoice({ order: o1, kind: "tax", number: "INV-2611-0001", at: new Date(at(now, -40)) });
  const pro = buildInvoice({ order: o4, kind: "proforma", number: "PRO-2611-0001", at: new Date(at(now, -6)) });
  const proPaid = recordPayment(pro, { amount: Math.round(pro.total * 0.4), method: "mpesa", reference: "MPESA-QF72HB91", at: new Date(at(now, -2)) });

  const partner = (() => {
    const truck = registerTruck({
      ownerName: "Otieno Haulage",
      country: "KE",
      contact: "+254712000111",
      plate: "KDA 123A",
      classCode: "heavy_truck",
      capacityKg: 28000,
      corridors: ["northern"],
      at: at(now, -30),
    });
    const papers = ["insurance", "inspection", "vehicle_licence", "driver_licence", "operating_permit"].map((type) => ({
      type,
      reference: `${type.toUpperCase()}-2026-${String(1000 + type.length)}`,
      expiresAt: at(now, 240).slice(0, 10),
    }));
    return approveTruck(
      verifyTruckPapers(truck, { plate: "KDA 123A", documents: papers, verifiedBy: "Amanda", at: at(now, -29) }),
      { by: "Allan Sande", reference: "KRA PIN P052531547Z", at: at(now, -28) },
    );
  })();

  const suppliers = [
    { id: "sup_kunpeng", name: "Kunpeng Industrial Ltd", country: "CN", contact: "+86 20 8888 1200", leadTimeDays: 35, verified: true },
    { id: "sup_sonalika", name: "Sonalika Kenya", country: "KE", contact: "+254 20 555 0199", leadTimeDays: 12, verified: true },
  ];

  await kvSet("accounts", accounts);
  await kvSet("networkPartners", [partner]);
  await kvSet("suppliersAll", suppliers);
  for (const o of orders) await saveOrder(o);
  await put(STORES.invoices, tax);
  await put(STORES.invoices, proPaid);

  return { seeded: true, orders: orders.length, invoices: 2, accounts: accounts.length };
}
