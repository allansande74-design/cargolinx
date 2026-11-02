import test from "node:test";
import assert from "node:assert/strict";

import { receiveLot } from "../engine/inventory.mjs";
import { shelf, shelfItem, checkout, pay } from "../src/lib/web-store.mjs";

const pitch = "Solar lanterns, twenty in a carton, wired stock, ready today in Nairobi";
const film = { filmRef: "film.mp4", posterRef: "poster.jpg", transcript: pitch, countedUnits: 20 };
const solar = { sku: "LANTERN-20", name: "Solar lantern carton", product: { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 20 }, film, wholesaleKes: 175_000 };

test("the shelf is the warehouse: offerable only while stock exists, priced as in chat", () => {
  const lots = [receiveLot({ sku: "LANTERN-20", description: "Solar lanterns", qty: 40, bin: "A1" })];
  const rows = shelf([solar], { lots });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offerable, true);
  assert.equal(rows[0].available, 40);
  assert.equal(rows[0].underWholesale, true);
  assert.ok(rows[0].filmReady);
  const empty = shelfItem({ sku: "GHOST", item: solar, lots });
  assert.equal(empty.available, 0);
  assert.equal(empty.offerable, false);
});

test("checkout makes a real order and invoice, and the credit gate refuses what exceeds headroom", () => {
  const account = { id: "A1", status: "active", terms: "net30", creditLimitKes: 5_000_000 };
  const done = checkout({ account, lines: [{ name: "Solar lantern carton", qty: 2, priceKes: 156_362.92 }] });
  assert.equal(done.ok, true);
  assert.equal(done.order.stage, "confirmed");
  assert.equal(done.invoice.kind, "proforma");
  assert.equal(done.invoice.total, Math.round(2 * 156_362.92 * 1.16 * 100) / 100);

  const blocked = checkout({ account: { ...account, creditLimitKes: 100_000 }, lines: [{ name: "x", qty: 1, priceKes: 300_000 }] });
  assert.equal(blocked.ok, false);
  assert.match(blocked.gate.reason, /exceeds credit headroom/);
});

test("payment settles against the invoice, part then full, and overpayment is refused plainly", () => {
  const account = { id: "A1", status: "active", terms: "net30", creditLimitKes: 5_000_000 };
  const { invoice } = checkout({ account, lines: [{ name: "Solar lantern carton", qty: 1, priceKes: 156_362.92 }] });
  const part = pay(invoice, { amount: 100_000, reference: "M1" });
  assert.equal(part.ok, true);
  assert.equal(part.balance, Math.round((invoice.total - 100_000) * 100) / 100);
  const full = pay(part.invoice, { amount: part.balance, reference: "M2" });
  assert.equal(full.ok, true);
  assert.equal(full.balance, 0);
  const over = pay(full.invoice, { amount: 5_000 });
  assert.equal(over.ok, false);
  assert.match(over.reason, /exceeds the balance/);
});
