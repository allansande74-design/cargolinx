import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoice, recordPayment, ageing, creditExposure, reconcile, nextInvoiceNumber } from "../engine/invoicing.mjs";
import { binName, receiveLot, stockPosition, allocate, pickList, availabilityStatement, release } from "../engine/inventory.mjs";
import { invoiceHtml, deliveryNoteHtml, packingListHtml } from "../src/lib/doc-templates.mjs";

const order = {
  id: "ord_abc123",
  accountId: "acc_1",
  stage: "dispatched",
  origin: "Shanghai",
  destination: "Kampala",
  incoterm: "DAP",
  vehicleId: "KDG 123A",
  driverName: "Otieno",
  lines: [
    { description: "Solar panels 450W", hs: "8541.43", qty: 50, unitValue: 12000 },
    { description: "Mounting rails", qty: 100, unitValue: 1500 },
  ],
};

// ---- invoicing ----

test("a tax invoice cannot be issued before dispatch", () => {
  assert.throws(() => buildInvoice({ order: { ...order, stage: "confirmed" }, kind: "tax" }), /cannot be issued at stage confirmed/);
});

test("a proforma can be issued early and is not a tax document", () => {
  const inv = buildInvoice({ order: { ...order, stage: "confirmed" }, kind: "proforma", number: "PF-2610-0001" });
  assert.equal(inv.taxDocument, false);
  assert.equal(inv.total, 870_000); // 750,000 subtotal + 16% VAT
});

test("an invoice is built from posted line values, and a line without one stops it", () => {
  const inv = buildInvoice({ order, kind: "tax", number: "INV-2610-0001" });
  assert.equal(inv.subtotal, 750_000);
  assert.equal(inv.vat, 120_000);
  assert.equal(inv.total, 870_000);
  assert.equal(inv.balance, 870_000);
  assert.throws(
    () => buildInvoice({ order: { ...order, lines: [{ description: "x", qty: 2, unitValue: null }] }, kind: "tax" }),
    /no posted unit value/
  );
});

test("posted charges are added as lines, not hidden in a total", () => {
  const inv = buildInvoice({ order, kind: "tax", number: "INV-2610-0002", charges: [{ description: "Clearing and documentation", amount: 45000 }, { description: "Last mile", amount: 12000 }] });
  assert.equal(inv.lines.length, 4);
  assert.equal(inv.subtotal, 807_000);
});

test("a payment larger than the balance is refused", () => {
  const inv = buildInvoice({ order, kind: "tax", number: "INV-2610-0003" });
  assert.throws(() => recordPayment(inv, { amount: 900_000 }), /exceeds the balance/);
});

test("part payment and settlement move the status honestly", () => {
  let inv = buildInvoice({ order, kind: "tax", number: "INV-2610-0004" });
  inv = recordPayment(inv, { amount: 400_000, method: "mpesa", reference: "QK12" });
  assert.equal(inv.status, "part paid");
  assert.equal(inv.balance, 470_000);
  inv = recordPayment(inv, { amount: 470_000, method: "bank" });
  assert.equal(inv.status, "paid");
  assert.equal(inv.balance, 0);
  assert.equal(inv.payments.length, 2);
});

test("ageing buckets unpaid invoices by issue date", () => {
  const asOf = new Date("2026-11-30T00:00:00Z");
  const invoices = [
    { number: "A", accountId: "acc_1", total: 100, paid: 0, balance: 100, status: "unpaid", issuedAt: "2026-11-29T00:00:00Z" },
    { number: "B", accountId: "acc_1", total: 200, paid: 0, balance: 200, status: "unpaid", issuedAt: "2026-11-10T00:00:00Z" },
    { number: "C", accountId: "acc_1", total: 300, paid: 0, balance: 300, status: "unpaid", issuedAt: "2026-10-01T00:00:00Z" },
    { number: "D", accountId: "acc_1", total: 400, paid: 400, balance: 0, status: "paid", issuedAt: "2026-09-01T00:00:00Z" },
  ];
  const a = ageing(invoices, asOf);
  assert.equal(a.buckets.current, 0);
  assert.equal(a.buckets["1-30"], 300);
  assert.equal(a.buckets["31-60"], 300);
  assert.equal(a.buckets["60+"], 0);
  assert.equal(a.outstanding, 600);
  assert.equal(creditExposure(invoices, "acc_1"), 600);
});

test("invoice numbers run in sequence inside a month", () => {
  const at = new Date("2026-10-29T00:00:00Z");
  assert.equal(nextInvoiceNumber({ series: [], at }), "INV-2610-0001");
  assert.equal(nextInvoiceNumber({ series: ["INV-2610-0001", "INV-2610-0007"], at }), "INV-2610-0008");
});

test("reconciliation matches by amount and reference, and names what did not match", () => {
  const invoices = [
    { number: "INV-1", balance: 500, status: "unpaid" },
    { number: "INV-2", balance: 250, status: "unpaid" },
  ];
  const r = reconcile({ invoices, statement: [{ amount: 500, reference: "INV-1" }, { amount: 999 }] });
  assert.equal(r.matched, 1);
  assert.equal(r.unmatchedCount, 1);
});

// ---- inventory ----

test("goods need a bin before they count as stock", () => {
  assert.throws(() => receiveLot({ sku: "SP450", qty: 10 }), /bin is required/);
  assert.equal(binName({ aisle: 1, rack: 2, level: 3 }), "NBO-01-02-03");
});

test("stock position separates on hand, allocated and expired", () => {
  const lots = [
    receiveLot({ sku: "SP450", qty: 50, bin: "NBO-01-01-01", lot: "L1" }),
    receiveLot({ sku: "SP450", qty: 20, bin: "NBO-01-01-02", lot: "L2", expiresAt: "2020-01-01" }),
  ];
  const p = stockPosition(lots, { sku: "SP450" });
  assert.equal(p.onHand, 70);
  assert.equal(p.expired, 20);
  assert.equal(p.available, 50);
  assert.match(availabilityStatement(p), /50 available/);
});

test("allocation takes the earliest expiry first and skips expired lots with a reason", () => {
  const lots = [
    receiveLot({ sku: "SP450", qty: 30, bin: "B-2", lot: "LATE", expiresAt: "2027-12-01" }),
    receiveLot({ sku: "SP450", qty: 40, bin: "B-1", lot: "SOON", expiresAt: "2026-12-01" }),
    receiveLot({ sku: "SP450", qty: 10, bin: "B-3", lot: "DEAD", expiresAt: "2020-01-01" }),
  ];
  const r = allocate(lots, { sku: "SP450", qty: 50, orderId: "ord_1", now: new Date("2026-11-01T00:00:00Z") });
  assert.equal(r.complete, true);
  assert.equal(r.allocations[0].lot, "SOON");
  assert.equal(r.allocations[0].qty, 40);
  assert.equal(r.allocations[1].lot, "LATE");
  assert.equal(r.allocations[1].qty, 10);
  assert.deepEqual(r.skipped[0], { lot: "DEAD", why: "expired" });
  const total = r.allocations.reduce((a, x) => a + x.qty, 0);
  assert.equal(total, 50);
});

test("allocating more than is available states the shortfall instead of silently part-filling", () => {
  const lots = [receiveLot({ sku: "SP450", qty: 20, bin: "B-1", lot: "L1" })];
  const r = allocate(lots, { sku: "SP450", qty: 35, orderId: "ord_1" });
  assert.equal(r.complete, false);
  assert.equal(r.shortfall, 15);
  assert.equal(r.allocations[0].qty, 20);
});

test("allocating stock that does not exist is refused with the availability figure", () => {
  assert.throws(() => allocate([], { sku: "SP450", qty: 5, orderId: "ord_1" }), /no available stock/);
});

test("an allocation must name its order", () => {
  const lots = [receiveLot({ sku: "SP450", qty: 20, bin: "B-1" })];
  assert.throws(() => allocate(lots, { sku: "SP450", qty: 5 }), /must name the order/);
});

test("the pick list is ordered by bin so a picker walks the aisle once", () => {
  const list = pickList([
    { bin: "NBO-01-03-01", lot: "L3", sku: "A", qty: 2, orderId: "o1" },
    { bin: "NBO-01-01-01", lot: "L1", sku: "A", qty: 5, orderId: "o1" },
  ]);
  assert.equal(list[0].bin, "NBO-01-01-01");
  assert.equal(list[0].seq, 1);
});

test("releasing an order puts stock back", () => {
  const lots = [{ id: "1", sku: "A", lot: "L1", remaining: 5, allocated: 10, holds: [{ orderId: "ord_9", qty: 10 }] }];
  const r = release(lots, { orderId: "ord_9" });
  assert.equal(r.lots[0].remaining, 15);
  assert.equal(r.lots[0].allocated, 0);
  assert.deepEqual(r.released, [{ lot: "L1", qty: 10 }]);
});

// ---- documents ----

test("an invoice carries the seller's name and bank, never the platform's", () => {
  const inv = buildInvoice({ order, kind: "tax", number: "INV-2610-0009" });
  const html = invoiceHtml({ invoice: inv, order, account: { name: "Ndumbuki Enterprises", taxPin: "P051234567X", terms: "net30" } });
  assert.match(html, /ALTOVEX GLOBAL LOGISTICS CO\. LTD/);
  assert.match(html, /Cooperative Bank/);
  assert.doesNotMatch(html, /CARGOLINX/);
  assert.match(html, /870,000\.00/);
});

test("a delivery note carries the platform and a signature line", () => {
  const html = deliveryNoteHtml({ order, account: { name: "Ndumbuki" }, noteNumber: "DN-2610-0004" });
  assert.match(html, /ALTOVEX CARGOLINX/);
  assert.match(html, /Received in good order by/);
  assert.doesNotMatch(html, /Cooperative Bank/);
});

test("a packing list shows lots and bins, and says the values are cost values", () => {
  const html = packingListHtml({ order, account: { name: "Ndumbuki" }, listNumber: "PL-1", lots: [{ description: "Solar panels", lot: "L1", bin: "NBO-01-01-01", qty: 50, unitCost: 12000 }] });
  assert.match(html, /NBO-01-01-01/);
  assert.match(html, /cost values, not selling prices/);
});
