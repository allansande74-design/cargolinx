/**
 * The dashboards are only trustworthy if the catalogue, the scope rule and the numbers are.
 * These tests exercise the pure layer the screens call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DASHBOARD_SPECS, dashboardIndex, specFor, canOpen, scopeOrders, scopeInvoices,
  kpisFor, attentionFor, blockers, orderTotal, truckState, trucks, atRisk, money,
} from "../src/lib/dashboards.mjs";
import { createOrder, advance } from "../engine/orders.mjs";
import { registerTruck } from "../src/lib/truck-matching.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dashDir = join(here, "..", "src", "dashboards");

const AT = new Date("2026-11-02T08:00:00.000Z");

const lines = [{ description: "SP450 solar floodlight", qty: 20, unitValue: 4500 }];

function order(overrides = {}) {
  return { ...createOrder({ accountId: "acc_a", lines, destination: { city: "Nairobi" }, promisedAt: "2026-11-06T09:00:00.000Z" }), ...overrides };
}

const invoices = [
  { number: "INV-1041", kind: "tax", accountId: "acc_a", issuedAt: "2026-08-29T00:00:00.000Z", total: 116000, paid: 0, balance: 116000, status: "unpaid", orderId: "ord_a" },
  { number: "INV-1042", kind: "tax", accountId: "acc_b", issuedAt: "2026-10-30T00:00:00.000Z", total: 58000, paid: 58000, balance: 0, status: "paid", orderId: "ord_b" },
];

test("every registered dashboard exists, is unique, and names a role", () => {
  assert.equal(DASHBOARD_SPECS.length, 18);
  assert.equal(new Set(DASHBOARD_SPECS.map((s) => s.key)).size, 18);
  for (const spec of dashboardIndex()) {
    assert.ok(spec.role && spec.title && spec.file, `${spec.key} is incomplete`);
    assert.ok(existsSync(join(dashDir, spec.file)), `missing screen ${spec.file} for ${spec.key}`);
  }
  assert.equal(specFor("match").title, "Match board");
  assert.equal(specFor("nope"), null);
});

test("access follows the role, and an administrator may open any dashboard", () => {
  assert.equal(canOpen({ role: "admin" }, "finance-partner").allowed, true);
  assert.equal(canOpen({ role: "operations" }, "operations").allowed, true);
  assert.equal(canOpen({ role: "operations" }, "finance-partner").allowed, false);
  assert.equal(canOpen({ role: "client_admin" }, "buyer").allowed, true);
  assert.equal(canOpen({ role: "client_user" }, "seller").allowed, false);
  assert.equal(canOpen({ role: "driver" }, "driver").allowed, true);
  assert.equal(canOpen({ role: "driver" }, "unknown").allowed, false);
  assert.match(canOpen({ role: "operations" }, "finance-partner").reason, /may not open/);
});

test("a client sees only their own book; the platform sees the whole book", () => {
  const book = [order({ id: "ord_a", accountId: "acc_a" }), order({ id: "ord_b", accountId: "acc_b" })];
  const mine = scopeOrders(book, { role: "client_admin", accountId: "acc_a", name: "Otieno" });
  assert.equal(mine.basis, "account");
  assert.deepEqual(mine.orders.map((o) => o.id), ["ord_a"]);

  const platform = scopeOrders(book, { role: "operations" });
  assert.equal(platform.basis, "platform");
  assert.equal(platform.orders.length, 2);

  const driver = scopeOrders([order({ id: "ord_d", stage: "dispatched", driverName: "Kamau" })], { role: "driver", name: "Kamau" });
  assert.equal(driver.basis, "assignment");
  assert.equal(driver.orders.length, 1);

  const anonymous = scopeOrders(book, null);
  assert.equal(anonymous.basis, "sample");
  assert.match(anonymous.note, /demonstration book/);
});

test("invoices are scoped by the same rule as orders", () => {
  const mine = scopeInvoices(invoices, { role: "client_user", accountId: "acc_a" });
  assert.equal(mine.invoices.length, 1);
  assert.equal(mine.invoices[0].number, "INV-1041");
  assert.equal(scopeInvoices(invoices, { role: "finance-partner" }).invoices.length, 2);
});

test("order value comes from the posted lines when there is no stored total", () => {
  const o = order({ valueKes: undefined });
  assert.equal(orderTotal(o), 90000);
  assert.equal(orderTotal({ ...o, valueKes: 120000 }), 120000);
  assert.equal(orderTotal({ lines: [{ qty: 2, unitPriceKes: 1500 }] }), 3000);
  assert.equal(orderTotal(null), 0);
});

test("blockers name exactly what the next stage is missing", () => {
  const draft = order({ stage: "confirmed" });
  const b = blockers(draft);
  assert.equal(b.target, "sourcing");
  assert.deepEqual(b.missing, []);

  const sourcing = advance(draft, { stage: "sourcing" });
  const next = blockers(sourcing);
  assert.equal(next.target, "purchased");
  assert.deepEqual(next.missing, ["supplier", "poRef", "purchaseValue"]);
});

test("every dashboard role gets four figures and a work list", () => {
  const book = [order({ id: "ord_a", accountId: "acc_a", stage: "in_transit", supplier: "Kunpeng", poRef: "PO-9", purchaseValue: 900000 })];
  const data = { orders: book, invoices, partners: [], accounts: [{ id: "acc_a", name: "Otieno Stores", terms: "net30", creditLimitKes: 5000000 }], now: AT };
  for (const spec of DASHBOARD_SPECS) {
    const kpis = kpisFor(spec.role, data);
    assert.equal(kpis.length, 4, `${spec.role} should publish four figures`);
    for (const k of kpis) assert.ok(k.k && k.v !== undefined, `${spec.role} figure incomplete`);
    assert.ok(Array.isArray(attentionFor(spec.role, data)), `${spec.role} work list is not a list`);
  }
});

test("the work list carries a reason an operator can act on", () => {
  const rows = attentionFor("finance-partner", { invoices, orders: [], now: AT });
  const old = rows.find((r) => r.ref === "ord_a");
  assert.ok(old, "a 65-day-old unpaid invoice should surface");
  assert.equal(old.severity, "high");
  assert.match(old.detail, /KES/);

  const ops = attentionFor("operations", {
    orders: [order({ id: "ord_late", stage: "in_transit", promisedAt: "2026-10-30T09:00:00.000Z" })],
    now: AT,
  });
  assert.ok(ops.some((r) => r.title.includes("late") && r.severity === "high"));
});

test("late and at-risk files are counted from the promise, not from opinion", () => {
  const rows = atRisk([
    order({ id: "a", stage: "in_transit", promisedAt: "2026-10-30T09:00:00.000Z" }),
    order({ id: "b", stage: "in_transit", promisedAt: "2026-11-02T20:00:00.000Z" }),
    order({ id: "c", stage: "in_transit", promisedAt: "2026-11-20T09:00:00.000Z" }),
  ], AT);
  assert.deepEqual(rows.map((r) => r.order.id).sort(), ["a", "b"]);
});

test("a truck with no verified papers is not offered as available", () => {
  const partner = registerTruck({ ownerName: "Otieno Haulage", contact: "+254700000000", plate: "KDA 123A", classCode: "heavy_truck", capacityKg: 28000, corridors: ["northern"] });
  const list = trucks([partner]);
  assert.equal(list.length, 1);
  const state = truckState([partner], list[0], AT);
  assert.equal(state.eligible, false);
  assert.ok(state.blockers.length > 0);
});

test("money is stated in whole shillings", () => {
  assert.equal(money(1234567.4), "KES 1,234,567");
  assert.equal(money(0), "KES 0");
  assert.equal(money(undefined), "KES 0");
});
