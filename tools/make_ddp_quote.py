#!/usr/bin/env python3
"""One-page DDP quotation on the consolidated card basis.

Reads the same cost basis and categories as the card, so a quotation can never drift from the
published rates. Duty and VAT are trued to the client's actual declared value: the quotation
shows the duty inside the total, and the true-up is exact rather than an estimate.

    python3 tools/make_ddp_quote.py --client "Ndambuki" --dest Nairobi --mode sea \
        --cat C --units 8 --declared 6400 --ref "first consolidated load, general hardware" \
        --out rates/out/CargoLinx-quotation-<name>-2Nov2026.pdf
"""
from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ddp_rate_card as rc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]


def build_quote(client, dest, mode, code, units, declared, ref_note):
    basis, cats = rc.load()
    rows = rc.build(basis, cats)
    row = next(r for r in rows if r["mode"] == mode and r["dest"] == dest and r["code"] == code)
    cat = next(c for c in cats["categories"] if c["code"] == code)

    stat = {k: basis["statutory"][k] for k in ("idf", "rdl", "vat")}
    stat["insurance_rate"] = basis["meta"]["insurance_rate"]
    freight = rc.sea_freight_component(basis) if mode == "sea" else rc.air_freight_component(basis)

    base = row["price_unit"] * units + row["price_ship"]
    ref_value = row["reference"] * units
    at_ref = rc.statutory(ref_value, freight * units, row["duty_rate"], stat)["total"]
    at_declared = rc.statutory(declared, freight * units, row["duty_rate"], stat)["total"]
    true_up = at_declared - at_ref
    total = base + true_up

    if declared > row["ceiling"] * units:
        raise SystemExit(f"declared {declared:,.0f} is above the {cat['name']} ceiling "
                         f"({row['ceiling']:,.0f} per {row['unit']} × {units:g}); quote case by case")
    if declared < 0:
        raise SystemExit("declared value cannot be negative")

    fx = basis["meta"]["fx_kes_per_usd"]
    return dict(basis=basis, cats=cats, row=row, cat=cat, units=units, declared=declared,
                base=base, true_up=true_up, total=total, fx=fx, ref_note=ref_note,
                client=client, dest=dest, mode=mode,
                )


def quote_html(q):
    row, cat = q["row"], q["cat"]
    basis = q["basis"]
    fx = q["fx"]
    unit = row["unit"]
    mode_label = "Consolidated sea freight" if q["mode"] == "sea" else "Consolidated air freight"
    money = "{:,.0f}" if q["mode"] == "sea" else "{:,.2f}"
    transit = rc.TRANSIT[(q["mode"], q["dest"])]
    valid = basis["meta"]["validity_until"]

    statutory_note = ("no movement" if abs(q["true_up"]) < 0.5
                      else ("added, duty and VAT on the value above the card reference"
                            if q["true_up"] > 0 else "credited, duty and VAT on the value below the card reference"))

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Altovex CargoLinx — quotation</title>
<style>
@page {{ size:A4; margin:16mm 15mm; }}
body {{ font-family:"DejaVu Sans",Arial,sans-serif; color:#16212b; font-size:9.6pt; margin:0; line-height:1.42; }}
.top {{ display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2.5px solid #0b3d5c; padding-bottom:7px; }}
.brand {{ font-size:19pt; font-weight:700; letter-spacing:1.2px; color:#0b3d5c; }}
.brand span {{ color:#c8102e; }}
.meta {{ text-align:right; font-size:8.4pt; color:#41525f; line-height:1.45; }}
h1 {{ font-size:13pt; color:#0b3d5c; margin:14px 0 2px; }}
.sub {{ font-size:9pt; color:#41525f; margin-bottom:10px; }}
table {{ width:100%; border-collapse:collapse; margin:8px 0; }}
th {{ background:#0b3d5c; color:#fff; font-size:8.4pt; text-align:left; padding:5px 7px; }}
td {{ border-bottom:1px solid #dbe2e8; padding:5.5px 7px; font-size:9.2pt; vertical-align:top; }}
.num {{ text-align:right; white-space:nowrap; }}
.tot td {{ border-top:2px solid #0b3d5c; border-bottom:none; font-weight:700; font-size:10.4pt; padding-top:7px; }}
.small {{ font-size:8.6pt; color:#41525f; }}
.box {{ background:#f2f6f9; border-left:3px solid #c8102e; padding:8px 10px; font-size:8.9pt; margin:10px 0; }}
ul {{ margin:4px 0 0 15px; padding:0; font-size:9pt; }}
.foot {{ margin-top:14px; border-top:1px solid #d5dbdb; padding-top:6px; font-size:7.8pt; color:#6e7b83; line-height:1.35; }}
</style></head><body>
<div class="top"><div class="brand">ALTOVEX <span>CARGOLINX</span></div>
<div class="meta">Quotation<br>2 November 2026<br>Valid to {valid}</div></div>
<h1>Delivered duty paid to {q['dest']}</h1>
<div class="sub">Prepared for <b>{q['client']}</b> · {mode_label} · {q['ref_note']}</div>

<table>
<tr><th>Line</th><th style="width:22%">Basis</th><th style="width:20%" class="num">Amount</th></tr>
<tr><td><b>{q['units']:g} {unit}</b> — {cat['name']}<span class="small"><br>{cat['examples']}</span></td>
<td class="small">{money.format(row['price_unit'])} per {unit}</td>
<td class="num">{q['base'] - row['price_ship']:,.2f}</td></tr>
<tr><td><b>Clearance, documentation and delivery</b><span class="small"><br>one charge per shipment</span></td>
<td class="small">per shipment</td><td class="num">{row['price_ship']:,.0f}</td></tr>
<tr><td><b>Duty and VAT adjustment</b><span class="small"><br>your declared value {q['declared']:,.0f} against the card reference
{q['row']['reference'] * q['units']:,.0f}</span></td>
<td class="small">{statutory_note}</td><td class="num">{q['true_up']:+,.2f}</td></tr>
<tr class="tot"><td>Total, delivered {q['dest']}, duty and VAT paid</td>
<td class="small">≈ KES {q['total'] * fx:,.0f}</td><td class="num">USD {q['total']:,.2f}</td></tr>
</table>

<div class="box"><b>What this covers.</b> Collection in China, consolidation, ocean freight to Mombasa, de-stuffing and port
handling, customs clearance and agency, import duty at the HS line confirmed for these goods, IDF, RDL, VAT at 16%, and
delivery to your door in {q['dest']}. Duty and VAT are passed through at cost, with the duty receipt provided.
<b>Transit {transit}</b> from the consolidation cut-off.</div>

<div class="small"><b>Not included:</b> marine cargo insurance; storage or demurrage beyond the port's free days; PVoC or
conformity assessment for regulated codes; heavy-lift, escort or special permits; unloading beyond the tailgate.
Cargo outside the categories on our card — restricted, excisable, hazardous, perishable, or above the declared value we show for its category — is
quoted separately.</div>

<div class="small" style="margin-top:10px"><b>What we need to confirm this figure:</b> the commercial invoice or proforma,
the packing list with dimensions, and the intended departure week. The HS classification is confirmed from the invoice
before the cargo moves; if the goods fall under a different duty band the price changes by the duty alone, and we tell you
before anything is booked.</div>

<div class="foot">Prices in US dollars, invoiced in Kenya shillings at the rate on the invoice date (KES {fx}/USD on
2 November 2026). Rates valid to {valid}, subject to space at booking. This quotation is a rate schedule, not an offer of
carriage; carriage is on the Altovex standard trading conditions.
<br>Altovex Global Logistics Co. Ltd · P.O. Box 3515-00100 Nairobi, Kenya · +254 718 554 383 · +254 753 005 989 ·
altovexgl@gmail.com</div>
</body></html>"""


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True)
    ap.add_argument("--dest", default="Nairobi", choices=("Nairobi", "Kampala"))
    ap.add_argument("--mode", default="sea", choices=("sea", "air"))
    ap.add_argument("--cat", default="C")
    ap.add_argument("--units", type=float, required=True)
    ap.add_argument("--declared", type=float, required=True, help="total invoice value, USD")
    ap.add_argument("--ref", default="first consolidated load")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    q = build_quote(args.client, args.dest, args.mode, args.cat, args.units, args.declared, args.ref)
    out = pathlib.Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    rc.render(quote_html(q), out)
    print(f"{out}  total USD {q['total']:,.2f}  (base {q['base']:,.2f}, duty/VAT true-up {q['true_up']:+,.2f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
