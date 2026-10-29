/**
 * Printable documents. Each one takes its letterhead from the entity map, so an invoice can never
 * carry the platform's name and a delivery note can never carry the seller's.
 */
import { documentHeader } from "../../engine/accounts.mjs";

const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const CSS = `
  body{font-family:Arial,Helvetica,sans-serif;color:#0f1b2d;margin:32px;font-size:12px}
  h1{font-size:19px;margin:0;color:#0b2545} .sub{color:#5d6b80;font-size:11px;letter-spacing:.4px}
  .head{display:flex;justify-content:space-between;border-bottom:3px solid #0b2545;padding-bottom:10px}
  .meta{margin:14px 0;display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th{background:#0b2545;color:#fff;text-align:left;padding:6px;font-size:11px}
  td{padding:6px;border-bottom:1px solid #dde4ee;vertical-align:top}
  .n{text-align:right;font-variant-numeric:tabular-nums}
  .tot{font-weight:700;border-top:2px solid #0b2545}
  .box{margin-top:14px;background:#f3f7fb;border:1px solid #dde4ee;padding:10px;border-radius:6px}
  .foot{margin-top:22px;font-size:10px;color:#5d6b80;line-height:1.5}
  .stamp{color:#a3282e;font-weight:700;letter-spacing:1px}
`;

function shell({ header, title, number, date, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(number)} — ${esc(title)}</title><style>${CSS}</style></head><body>
  <div class="head"><div><h1>${esc(header.name)}</h1><div class="sub">${esc(header.address)} · ${esc(header.contact)}</div>${header.bank ? `<div class="sub">${esc(header.bank)}</div>` : ""}</div>
  <div style="text-align:right"><strong>${esc(title.toUpperCase())}</strong><div class="sub">${esc(number)}</div><div class="sub">${esc(date)}</div></div></div>
  ${body}
  <div class="foot">${footer}</div></body></html>`;
}

export function invoiceHtml({ invoice, order, account, today = new Date() }) {
  const header = documentHeader("invoice");
  const rows = invoice.lines
    .map((l) => `<tr><td>${esc(l.description)}${l.hs ? `<div class="sub">HS ${esc(l.hs)}</div>` : ""}</td><td class="n">${l.qty}</td><td class="n">${fmt(l.unitPrice)}</td><td class="n">${fmt(l.amount)}</td></tr>`)
    .join("");
  const body = `
  <div class="meta">
    <div><strong>Billed to</strong><br>${esc(account?.name ?? invoice.accountId)}<br>${esc(account?.taxPin ? `PIN ${account.taxPin}` : "PIN not on file")}<br>${esc(account?.terms ?? "")}</div>
    <div><strong>Order</strong><br>${esc(order?.id ?? invoice.orderId)}<br>${esc(order?.origin ?? "")} → ${esc(order?.destination ?? "")}<br>Stage: ${esc(invoice.stage)}</div>
  </div>
  <table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th></tr></thead>
  <tbody>${rows}
    <tr><td colspan="3" class="n">Subtotal</td><td class="n">${fmt(invoice.subtotal)}</td></tr>
    <tr><td colspan="3" class="n">VAT ${(invoice.vatRate * 100).toFixed(0)}%</td><td class="n">${fmt(invoice.vat)}</td></tr>
    <tr class="tot"><td colspan="3" class="n">Total due</td><td class="n">${fmt(invoice.total)}</td></tr>
    ${invoice.paid ? `<tr><td colspan="3" class="n">Received</td><td class="n">${fmt(invoice.paid)}</td></tr><tr class="tot"><td colspan="3" class="n">Balance</td><td class="n">${fmt(invoice.balance)}</td></tr>` : ""}
  </tbody></table>
  ${invoice.unposted?.length ? `<div class="box"><strong>Not yet posted:</strong> ${invoice.unposted.map(esc).join("; ")}. This invoice excludes them.</div>` : ""}`;
  const footer = `All amounts in ${esc(invoice.currency)}. Payment to ${esc(header.name)}${header.bank ? `, ${esc(header.bank)}` : ""}. VAT charged at ${(invoice.vatRate * 100).toFixed(0)}%. E&OE. Authorised signatory: Sande Allan.`;
  return shell({ header, title: invoice.kind === "proforma" ? "Proforma invoice" : invoice.kind === "credit_note" ? "Credit note" : "Tax invoice", number: invoice.number ?? "unnumbered", date: today.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }), body, footer });
}

export function deliveryNoteHtml({ order, account, noteNumber, today = new Date(), items = [] }) {
  const header = documentHeader("tracking");
  const rows = items.length
    ? items.map((i) => `<tr><td>${esc(i.description)}</td><td>${esc(i.bin ?? "—")}</td><td>${esc(i.lot ?? "—")}</td><td class="n">${i.qty}</td></tr>`).join("")
    : (order?.lines ?? []).map((l) => `<tr><td>${esc(l.description)}</td><td>—</td><td>—</td><td class="n">${l.qty}</td></tr>`).join("");
  const body = `
  <div class="meta">
    <div><strong>Deliver to</strong><br>${esc(order?.destination ?? "—")}<br>${esc(account?.name ?? "")}</div>
    <div><strong>Order</strong><br>${esc(order?.id ?? "")}<br>Vehicle ${esc(order?.vehicleId ?? "not assigned")}<br>${esc(order?.driverName ?? "")}</div>
  </div>
  <table><thead><tr><th>Item</th><th>Bin</th><th>Lot</th><th class="n">Qty</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="box">Received in good order by: ______________________ &nbsp;&nbsp; Date: ______________</div>`;
  const footer = `Issued by ${esc(header.name)} — freight coordination and last-mile tracking. This note is not a tax document.`;
  return shell({ header, title: "Delivery note", number: noteNumber ?? "—", date: today.toLocaleDateString("en-GB"), body, footer });
}

export function packingListHtml({ order, account, listNumber, lots = [], today = new Date() }) {
  const header = documentHeader("purchase_order");
  const rows = lots.length
    ? lots.map((l) => `<tr><td>${esc(l.description ?? l.sku)}</td><td>${esc(l.lot ?? "—")}</td><td>${esc(l.bin ?? "—")}</td><td class="n">${l.qty ?? l.remaining}</td><td class="n">${fmt((l.qty ?? l.remaining) * (l.unitCost ?? 0))}</td></tr>`).join("")
    : (order?.lines ?? []).map((l) => `<tr><td>${esc(l.description)}</td><td>—</td><td>—</td><td class="n">${l.qty}</td><td class="n">—</td></tr>`).join("");
  const body = `
  <div class="meta"><div><strong>Consignment</strong><br>${esc(order?.origin ?? "")} → ${esc(order?.destination ?? "")}<br>${esc(order?.incoterm ?? "DAP")}</div>
  <div><strong>Account</strong><br>${esc(account?.name ?? "")}</div></div>
  <table><thead><tr><th>Item</th><th>Lot</th><th>Bin</th><th class="n">Qty</th><th class="n">Value</th></tr></thead><tbody>${rows}</tbody></table>`;
  const footer = `Packing list issued by ${esc(header.name)}. Values are cost values, not selling prices.`;
  return shell({ header, title: "Packing list", number: listNumber ?? "—", date: today.toLocaleDateString("en-GB"), body, footer });
}
