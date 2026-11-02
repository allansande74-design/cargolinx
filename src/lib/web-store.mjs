/**
 * Web store: your own shop, at your own address, on your own books.
 *
 * Rules this module stands behind:
 *  - The shelf is the warehouse. An item is offerable only while stock exists for it, and the film
 *    that sells it in chat sells it here — same product, same landed-backed price, one catalogue.
 *  - Checkout makes a real order in the freight lifecycle, an invoice from the invoicing engine,
 *    and a payment against that invoice. Nothing here is a separate ledger.
 *  - Overpayment is refused by the engine, not absorbed; underpayment stays a balance. The store
 *    reports exactly what the invoice says, nothing smoother.
 *  - Access is scoped by the accounts engine: a customer sees their own orders and invoices,
 *    never another customer's, and the store never widens that scope.
 */
import { stockPosition } from "../../engine/inventory.mjs";
import { createOrder, advance } from "../../engine/orders.mjs";
import { buildInvoice, recordPayment, nextInvoiceNumber } from "../../engine/invoicing.mjs";
import { creditDecision } from "../../engine/accounts.mjs";
import { catalogueLine } from "./whatsapp-store.mjs";

/** One shelf item: offerable only while stock exists, priced by the same film-price path as chat. */
export function shelfItem({ sku, item, lots, now = new Date() }) {
  const stock = stockPosition(lots, { sku, now });
  const line = catalogueLine(item);
  return {
    sku,
    name: item.name,
    priceKes: line.priceKes,
    underWholesale: line.underWholesale,
    filmReady: line.filmReady,
    film: line.film,
    available: stock.available,
    offerable: stock.available > 0,
  };
}

/** The whole shelf, with what is out of stock still named so the store never silently drops a line. */
export function shelf(items, { lots, now = new Date() } = {}) {
  return items.map((it) => shelfItem({ sku: it.sku, item: it, lots, now }));
}

/**
 * Checkout: real order, real invoice, credit gate first. The order is confirmed, invoiced at the
 * stage the invoicing engine allows, and left at its true balance for the payment step.
 */
export function checkout({ account, lines, outstandingKes = 0, series = [], role = "ops" }) {
  const value = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.priceKes) || 0), 0);
  const gate = creditDecision({ account, orderValueKes: value, outstandingKes });
  if (!gate.approved) return { ok: false, gate };

  const order = advance(
    createOrder({
      accountId: account.id,
      type: "domestic",
      lines: lines.map((l) => ({ description: l.name, qty: Number(l.qty) || 1, unitValue: l.priceKes })),
    }),
    { stage: "confirmed" },
    { role },
  );
  const number = nextInvoiceNumber({ series });
  const invoice = buildInvoice({ order, kind: "proforma", number });
  return { ok: true, order, invoice, gate };
}

/** Settle against the invoice. The engine refuses overpayment; the store says so plainly. */
export function pay(invoice, { amount, method = "mpesa", reference = null }) {
  try {
    const settled = recordPayment(invoice, { amount, method, reference });
    return { ok: true, invoice: settled, balance: settled.balance, paid: settled.paid };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
