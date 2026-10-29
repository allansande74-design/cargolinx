/**
 * Quotation document. Pure string builder so it can be tested without a browser.
 * The document restates the engine's figures; it never recomputes them.
 */
const fmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function quoteHtml({ shipment, lc, q, today = new Date() }) {
  const rows = lc.lines
    .filter((l) => l.amount !== 0)
    .map(
      (l) =>
        `<tr><td>${l.label}</td><td class="n">${l.base ? fmt(l.base) : "—"}</td><td class="n">${l.rate ? (l.rate * 100).toFixed(2) + "%" : "—"}</td><td class="n">${fmt(l.amount)}</td></tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${shipment.ref} — Quotation</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0f1b2d;margin:32px;font-size:12px}
  h1{font-size:20px;margin:0;color:#0b2545} .sub{color:#5d6b80;font-size:11px;letter-spacing:.4px}
  .head{display:flex;justify-content:space-between;border-bottom:3px solid #0b2545;padding-bottom:10px}
  .meta{margin:14px 0;display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{background:#0b2545;color:#fff;text-align:left;padding:6px;font-size:11px}
  td{padding:5px 6px;border-bottom:1px solid #dde4ee}
  .n{text-align:right;font-variant-numeric:tabular-nums}
  .tot{font-weight:700;border-top:2px solid #0b2545}
  .box{margin-top:14px;background:#f3f7fb;border:1px solid #dde4ee;padding:10px;border-radius:6px}
  .foot{margin-top:22px;font-size:10px;color:#5d6b80;line-height:1.5}
</style></head><body>
<div class="head"><div><h1>ALTOVEX GLOBAL LOGISTICS</h1><div class="sub">P.O. Box 3515-00100 Nairobi, Kenya · +254 718 554 383 · altovexgl@gmail.com</div></div>
<div style="text-align:right"><strong>QUOTATION</strong><div class="sub">${shipment.ref}</div><div class="sub">${today.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div></div></div>
<div class="meta">
  <div><strong>Consignment</strong><br>${shipment.cargo}<br>${shipment.origin} → ${shipment.destination}</div>
  <div><strong>Quantity</strong><br>${shipment.qty} unit(s)${shipment.weightKg ? ` · ${shipment.weightKg} kg` : ""}<br>Duty band: ${(shipment.dutyRate * 100).toFixed(0)}% (EAC CET)</div>
</div>
<table><thead><tr><th>Cost line</th><th class="n">Base</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
<tbody>${rows}<tr class="tot"><td colspan="3">Landed cost including VAT</td><td class="n">${fmt(lc.totals.total)}</td></tr></tbody></table>
<div class="box">
  <strong>Our price</strong><br>
  Excluding VAT: ${fmt(q.price)}<br>
  VAT (16%): ${fmt(q.vatOnSale)}<br>
  <strong>Total including VAT: ${fmt(q.priceIncVat)}</strong>
</div>
<div class="foot">
  All amounts in Kenya Shillings. Statutory lines are computed on the customs value: import duty at the EAC CET band shown, Import Declaration Fee 2.5%, Railway Development Levy 2%, VAT 16%. Rates verified 28 October 2026 against PwC Kenya tax summaries and the EAC CET 2022. Duty and VAT treatment remains subject to KRA assessment on entry. Quotation valid 14 days. Authorised signatory: Sande Allan.
</div>
</body></html>`;
}
