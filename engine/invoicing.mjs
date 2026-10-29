/**
 * Invoicing and settlement.
 *
 * A quotation is an offer; an invoice is a demand supported by posted cost. This module builds the
 * invoice from the order's recorded figures — never from the estimate that opened it — numbers it,
 * applies VAT, and keeps a payment ledger per invoice with an ageing position per account.
 */

const round = (n) => Math.round(n * 100) / 100;
const cents = (n) => Math.round(n * 100);

export const INVOICE_KINDS = {
  proforma: { label: "Proforma invoice", taxDocument: false, requiresStage: ["confirmed", "sourcing", "purchased", "freight_booked", "in_transit", "arrived", "received", "picked", "packed", "dispatched", "delivered"] },
  tax: { label: "Tax invoice", taxDocument: true, requiresStage: ["dispatched", "delivered"] },
  credit_note: { label: "Credit note", taxDocument: true, requiresStage: ["dispatched", "delivered"] },
};

export function nextInvoiceNumber({ prefix = "INV", series = [], at = new Date() } = {}) {
  const ym = `${String(at.getFullYear()).slice(2)}${String(at.getMonth() + 1).padStart(2, "0")}`;
  const used = series
    .filter((n) => n.includes(`-${ym}-`))
    .map((n) => Number(n.split("-").pop()))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}-${ym}-${String(next).padStart(4, "0")}`;
}

/**
 * Build an invoice from posted order cost.
 * Lines come from the order; charges come from what was actually incurred, and any line still
 * unposted is named rather than estimated.
 */
export function buildInvoice({ order, kind = "tax", charges = [], number, at = new Date(), vatRate = 0.16, currency = "KES" }) {
  const spec = INVOICE_KINDS[kind];
  if (!spec) throw new Error(`unknown invoice kind ${kind}`);
  if (!spec.requiresStage.includes(order.stage)) {
    throw new Error(`a ${spec.label.toLowerCase()} cannot be issued at stage ${order.stage}`);
  }
  if (!Array.isArray(order.lines) || order.lines.length === 0) throw new Error("order has no lines to invoice");

  const lines = order.lines.map((l) => {
    if (l.unitValue === null || l.unitValue === undefined || l.unitValue === "") {
      throw new Error(`line "${l.description}" has no posted unit value`);
    }
    const unit = Number(l.unitValue);
    if (!Number.isFinite(unit) || unit < 0) throw new Error(`line "${l.description}" has no posted unit value`);
    return {
      description: l.description,
      qty: Number(l.qty),
      unitPrice: round(unit),
      amount: round(Number(l.qty) * unit),
      hs: l.hs ?? null,
    };
  });

  for (const c of charges) {
    if (!c.description) throw new Error("every charge needs a description");
    if (!Number.isFinite(Number(c.amount))) throw new Error(`charge "${c.description}" has no amount`);
    lines.push({ description: c.description, qty: 1, unitPrice: round(Number(c.amount)), amount: round(Number(c.amount)), hs: null, charge: true });
  }

  const subtotal = round(lines.reduce((a, l) => a + l.amount, 0));
  const vat = kind === "proforma" ? round(subtotal * vatRate) : round(subtotal * vatRate);
  const total = round(subtotal + vat);
  const unposted = [];

  if (!order.vehicleId && kind === "tax" && order.stage !== "delivered") unposted.push("last-mile charges not yet posted");
  if (!order.pod) unposted.push("proof of delivery not yet on file");

  return {
    number: number ?? null,
    kind,
    taxDocument: spec.taxDocument,
    orderId: order.id,
    accountId: order.accountId,
    currency,
    issuedAt: at.toISOString(),
    stage: order.stage,
    lines,
    subtotal,
    vatRate,
    vat,
    total,
    unposted,
    status: "unpaid",
    paid: 0,
    balance: total,
  };
}

/** Apply a payment. Overpayment is refused, not absorbed. */
export function recordPayment(invoice, { amount, method = "bank", reference = null, at = new Date() } = {}) {
  const amt = round(Number(amount));
  if (!(amt > 0)) throw new Error("payment amount must be positive");
  if (!["bank", "mpesa", "cash", "card", "offset"].includes(method)) throw new Error(`unknown payment method ${method}`);
  const balance = round(invoice.total - invoice.paid);
  if (amt > balance + 0.005) throw new Error(`payment ${amt} exceeds the balance ${balance}`);
  const paid = round(invoice.paid + amt);
  const remaining = round(invoice.total - paid);
  return {
    ...invoice,
    paid,
    balance: remaining,
    status: remaining <= 0.005 ? "paid" : "part paid",
    payments: [...(invoice.payments ?? []), { amount: amt, method, reference, at: at.toISOString() }],
  };
}

/** Ageing as at a date, in the buckets a credit controller actually works. */
export function ageing(invoices, asOf = new Date()) {
  const buckets = { current: 0, "1-30": 0, "31-60": 0, "60+": 0 };
  let outstanding = 0;
  for (const inv of invoices) {
    if (inv.status === "paid") continue;
    const days = Math.floor((new Date(asOf).getTime() - new Date(inv.issuedAt).getTime()) / 86400000);
    const bal = inv.balance ?? round(inv.total - (inv.paid ?? 0));
    outstanding = round(outstanding + bal);
    if (days <= 0) buckets.current = round(buckets.current + bal);
    else if (days <= 30) buckets["1-30"] = round(buckets["1-30"] + bal);
    else if (days <= 60) buckets["31-60"] = round(buckets["31-60"] + bal);
    else buckets["60+"] = round(buckets["60+"] + bal);
  }
  return { asOf: new Date(asOf).toISOString(), buckets, outstanding };
}

/** The exposure figure the credit gate should be fed — unpaid invoices, not order values. */
export function creditExposure(invoices, accountId) {
  return round(invoices.filter((i) => i.accountId === accountId && i.status !== "paid").reduce((a, i) => a + (i.balance ?? 0), 0));
}

/** Reconciliation: what the bank says against what the ledger says. */
export function reconcile({ invoices, statement = [] }) {
  const matches = [];
  const unmatched = [];
  const used = new Set();
  for (const line of statement) {
    const hit = invoices.find((inv) => !used.has(inv.number) && Math.abs(inv.balance - Number(line.amount)) < 0.01 && (!line.reference || line.reference === inv.number));
    if (hit) {
      used.add(hit.number);
      matches.push({ invoice: hit.number, amount: Number(line.amount) });
    } else {
      unmatched.push(line);
    }
  }
  return { matches, unmatched, matched: matches.length, unmatchedCount: unmatched.length };
}
