/**
 * WhatsApp commerce: the chat is the shop. Catalogue, order, and payment happen in the thread the
 * customer already trusts, and nothing leaves the platform until a named human approves it.
 *
 * Rules this module stands behind:
 *  - The catalogue in chat is the same catalogue as the store and the film: same products, same
 *    prices from the landed engine. A chat cannot promise a price the engine did not issue.
 *  - A WhatsApp message is rendered, never typed by hand: it comes from the notifications engine,
 *    so a missing field names itself instead of printing a blank to a customer.
 *  - The order becomes a real order in the order engine — same lifecycle, same guards — not a note
 *    in a chat. Payment settles against an invoice, and the proof of delivery closes the file.
 *  - Outbound messages to anyone other than the owner go out only after approval on the queue.
 *    Enqueue and send are two different acts, and this module never sends.
 */
import { createOrder, advance, deliver } from "../../engine/orders.mjs";
import { render } from "../../engine/notifications.mjs";
import { filmPrice } from "./video-commerce.mjs";
import { checkFilm } from "./video-commerce.mjs";

export const WA_CHANNEL = "whatsapp";
export const WA_MAX_LENGTH = 1024;

/** Phone to the international form WhatsApp addresses: 2547…, no plus, no spaces. */
export function waNumber(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  return digits;
}

export function waLink(phone, text = "") {
  const base = `https://wa.me/${waNumber(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** One catalogue line for the chat: name, landed-backed price, and the film that sells it. */
export function catalogueLine(item) {
  const { name, product, film, marginPct = 0.3, wholesaleKes } = item;
  const check = checkFilm({ product, filmRef: film?.filmRef, posterRef: film?.posterRef, transcript: film?.transcript, countedUnits: film?.countedUnits });
  const price = filmPrice({ product, marginPct, wholesaleKes });
  return {
    name,
    priceKes: price.priceKes,
    marginPct: price.marginPct,
    underWholesale: price.underWholesale,
    film: check.ok ? film : null,
    filmReady: check.ok,
    filmBlockers: check.blockers,
  };
}

export function catalogueMessage(items, { brand = "Altovex CargoLinx" } = {}) {
  const lines = items.map((l, i) => `${i + 1}. ${l.name} — KES ${l.priceKes.toLocaleString("en-KE")}`);
  const body = `${brand} catalogue:\n${lines.join("\n")}\nReply with a number to order.`;
  if (body.length > WA_MAX_LENGTH) throw new Error(`catalogue message is ${body.length} characters, above the ${WA_MAX_LENGTH} WhatsApp limit`);
  return body;
}

/**
 * Turn a chat reply into a real order. The order enters the same lifecycle as every other order:
 * confirmed only when it has an account and lines, dispatched only on a booked vehicle.
 */
export function orderFromChat({ account, line, qty, phone }) {
  const order = createOrder({
    accountId: account.id,
    type: "domestic",
    lines: [{ description: line.name, qty: Number(qty) || 1, unitValue: line.priceKes }],
  });
  const confirmed = advance(order, { stage: "confirmed" }, { role: "ops" });
  return { order: confirmed, contact: waNumber(phone) };
}

/** Render the confirmation from the notifications engine: same words, every channel, no hand typing. */
export function confirmationMessage(order, { accountName, amount, promisedAt }) {
  const r = render("order_confirmed", {
    orderRef: order.id ?? order.ref,
    accountName,
    lineCount: order.lines?.length ?? 0,
    amount,
    promisedAt,
  }, WA_CHANNEL);
  return r.text;
}

/** Deliver in the engine and tell the customer, in that order — never the reverse. */
export function deliveredMessage(order, { signedBy, deliveredAt }) {
  const done = deliver(order, { signedBy });
  const r = render("delivered", {
    orderRef: order.id ?? order.ref,
    signedBy,
    deliveredAt,
  }, WA_CHANNEL);
  return { order: done, text: r.text };
}
