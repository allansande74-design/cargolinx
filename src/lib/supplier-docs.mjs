/**
 * Printable purchase order.
 *
 * A purchase order is our commitment to buy at an agreed price, so it takes the seller's letterhead
 * and carries no tax line: duty and tax on the goods belong on the supplier's invoice and in the
 * customs file, not on our order. What it must state plainly is who we are buying from, what we are
 * buying, at what price, and who signed for it.
 */
import { documentHeader } from "../../engine/accounts.mjs";

const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
  .sign{margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:36px}
  .line{border-top:1px solid #0b2545;padding-top:6px;font-size:11px;color:#5d6b80}
  .foot{margin-top:22px;font-size:10px;color:#5d6b80;line-height:1.5}
`;

const DATE_FMT = { day: "2-digit", month: "long", year: "numeric" };

function asDate(value) {
  if (value instanceof Date) return value;
  if (value === undefined || value === null) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function purchaseOrderHtml({ po, supplier, order, today = new Date() }) {
  const header = documentHeader("purchase_order");
  const date = asDate(today).toLocaleDateString("en-GB", DATE_FMT);
  const currency = po?.currency ?? order?.currency ?? "KES";
  const supplierName = supplier?.name ?? po?.supplierName ?? po?.supplierId ?? "supplier not named";
  const lines = Array.isArray(po?.lines) ? po.lines : [];

  const rows = lines
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}${l.hs ? `<div class="sub">HS ${esc(l.hs)}</div>` : ""}</td><td class="n">${esc(l.qty)}</td><td class="n">${fmt(l.unitPrice)}</td><td class="n">${fmt(l.amount)}</td></tr>`,
    )
    .join("");

  const subtotal = po?.subtotal ?? lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const total = po?.total ?? subtotal;

  const body = `
  <div class="meta">
    <div><strong>Supplier</strong><br>${esc(supplierName)}<br>${esc(supplier?.country ?? "")}${supplier?.contact?.person ? `<br>${esc(supplier.contact.person)}` : ""}${supplier?.contact?.email ? `<br>${esc(supplier.contact.email)}` : ""}${supplier?.contact?.phone ? `<br>${esc(supplier.contact.phone)}` : ""}<br>${esc(supplier?.verification?.reference ? `Verified: ${supplier.verification.reference}` : "")}</div>
    <div><strong>Our reference</strong><br>Order ${esc(order?.id ?? po?.orderId ?? "—")}<br>${esc(order?.origin ?? "")}${order?.origin ? " → " : ""}${esc(order?.destination ?? "Nairobi, Kenya")}<br>${esc(order?.incoterm ?? "DAP")} · ${esc(supplier?.paymentTerms ?? "terms as agreed")}${supplier?.leadTimeDays !== null && supplier?.leadTimeDays !== undefined ? `<br>Lead time ${esc(supplier.leadTimeDays)} days` : ""}</div>
  </div>
  <table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead>
  <tbody>${rows}
    <tr><td colspan="3" class="n">Subtotal</td><td class="n">${fmt(subtotal)}</td></tr>
    <tr class="tot"><td colspan="3" class="n">Total payable</td><td class="n">${fmt(total)}</td></tr>
  </tbody></table>
  <div class="box">Prices are as agreed with the supplier and are stated in ${esc(currency)}. No tax is added on this order; the supplier's invoice carries whatever tax applies. Delivery is to ${esc(order?.destination ?? "Nairobi, Kenya")} on ${esc(order?.incoterm ?? "DAP")} terms unless agreed otherwise in writing.</div>
  <div class="sign">
    <div><div class="line">For ${esc(header.name)} — Authorised signatory: Sande Allan</div></div>
    <div><div class="line">Accepted for the supplier — name, signature and date</div></div>
  </div>`;

  const footer = `Purchase order ${esc(po?.number ?? "unnumbered")} issued by ${esc(header.name)}, ${esc(header.address)} · ${esc(header.contact)}. This order is not a tax document. Authorised signatory: Sande Allan.`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Purchase order ${esc(po?.number ?? "unnumbered")} — ${esc(supplierName)}</title><style>${CSS}</style></head><body>
  <div class="head"><div><h1>${esc(header.name)}</h1><div class="sub">${esc(header.address)} · ${esc(header.contact)}</div></div>
  <div style="text-align:right"><strong>PURCHASE ORDER</strong><div class="sub">${esc(po?.number ?? "unnumbered")}</div><div class="sub">${esc(date)}</div></div></div>
  ${body}
  <div class="foot">${footer}</div></body></html>`;
}
