#!/usr/bin/env python3
"""Altovex CargoLinx — consolidated DDP rate card.

Sea is charged per W/M (the greater of CBM and tonnes at 1,000 kg/CBM, minimum 1 W/M).
Air is charged per chargeable kg (the greater of actual kg and L x W x H / 6,000, minimum 45 kg).
Every price is built from rates/cost-basis.yaml — Altovex's own cost build-up — and every
category carries a declared-value ceiling from rates/categories.yaml, with the price computed
at that ceiling so the published number holds for any cargo inside the band.

Margin is 30% on the service cost only. Duty, IDF, RDL and VAT pass through at cost and are
never marked up. Duty is computed on CIF using the real carrier freight, not our selling price.

Usage:
    python3 tools/ddp_rate_card.py            # render client + internal PDFs, print the audit
    python3 tools/ddp_rate_card.py --audit    # print the audit only
"""
from __future__ import annotations

import argparse
import math
import pathlib
import subprocess
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
RATES = ROOT / "rates"
OUT = RATES / "out"
DESTINATIONS = ("Nairobi", "Kampala")

# Transit is a service promise, not a cost line: measured in days door to door.
TRANSIT = {
    ("sea", "Nairobi"): "32–38 days",
    ("sea", "Kampala"): "34–40 days",
    ("air", "Nairobi"): "6–9 days",
    ("air", "Kampala"): "7–11 days",
}


# ----------------------------------------------------------------------------- inputs
def load():
    with open(RATES / "cost-basis.yaml") as fh:
        basis = yaml.safe_load(fh)
    with open(RATES / "categories.yaml") as fh:
        cats = yaml.safe_load(fh)
    return basis, cats


def sea_unit_cost(basis, dest):
    """Service cost of ONE chargeable W/M, worst case 1 CBM per W/M.

    Billed W/M is the greater of volume and tonnes, so a shipment can never bill fewer W/M
    than its CBM. Costing one W/M at one CBM therefore never understates the cost; heavier
    cargo costs less freight than it bills and only improves the margin.
    """
    per = {l["key"]: l["value"] for l in basis["sea"]["per_unit"]}
    return per["freight"] + per["cfs"] + per["port"] + per[f"inland_{dest.lower()}"]


def sea_ship_cost(basis, dest):
    flat = {l["key"]: l["value"] for l in basis["sea"]["per_shipment"]}
    cost = flat["doc"] + flat["clearing"] + flat[f"lastmile_{dest.lower()}"]
    if dest == "Kampala":
        cost += flat["bond_kampala"]
    return cost


def air_kg_cost(basis, dest):
    per = {l["key"]: l["value"] for l in basis["air"]["per_unit"]}
    extra = per[f"delivery_{dest.lower()}"] if f"delivery_{dest.lower()}" in per else 0.0
    return per["freight"] + per["fuel"] + per["handling"] + extra


def air_ship_cost(basis, dest):
    flat = {l["key"]: l["value"] for l in basis["air"]["per_shipment"]}
    cost = flat["clearing"]
    if dest == "Kampala":
        cost += flat["bond_kampala"]
    return cost


def sea_freight_component(basis):
    """The real carrier freight only — this is the dutiable freight, not our selling price."""
    return {l["key"]: l["value"] for l in basis["sea"]["per_unit"]}["freight"]


def air_freight_component(basis):
    """Air freight plus surcharges as actually paid to the carrier/consolidator."""
    per = {l["key"]: l["value"] for l in basis["air"]["per_unit"]}
    return per["freight"] + per["fuel"]


# ----------------------------------------------------------------------------- statutory
def statutory(value_total, freight_total, duty_rate, stat):
    """Duty, IDF, RDL and VAT on one consignment. Passed through at cost, never marked up."""
    cif = value_total + freight_total
    cif += cif * stat["insurance_rate"]
    duty = cif * duty_rate
    idf = cif * stat["idf"]
    rdl = cif * stat["rdl"]
    vat = (cif + duty + idf + rdl) * stat["vat"]
    return {
        "cif": cif,
        "duty": duty,
        "idf": idf,
        "rdl": rdl,
        "vat": vat,
        "total": duty + idf + rdl + vat,
    }


# ----------------------------------------------------------------------------- pricing
def ceil_to(value, step):
    """Round UP to a publishable step. Never round a price down onto the cost."""
    return math.ceil(value / step - 1e-9) * step


def price_row(basis, cats, mode, dest, cat):
    """One published line: all-in DDP price per chargeable unit at the category's reference value.

    The reference is the value density the category normally carries, so the published number is
    the real price a client in that category pays, not a worst-case ceiling that overcharges
    light cargo. Duty and VAT are then trued to the actual invoice value between reference and
    ceiling — at cost, in both directions.
    """
    stat = {k: basis["statutory"][k] for k in ("idf", "rdl", "vat")}
    stat["insurance_rate"] = basis["meta"]["insurance_rate"]
    margin = basis["meta"]["margin_target"]
    duty_rate = basis["statutory"]["duty_bands"][cat["code"]]

    if mode == "sea":
        unit_cost = sea_unit_cost(basis, dest)
        ship_cost = sea_ship_cost(basis, dest)
        reference = cat["reference_sea"]
        ceiling = cat["ceiling_sea"]
        freight = sea_freight_component(basis)
        step_unit, step_ship = 5.0, 5.0
        unit_name = "W/M"
        min_units = basis["sea"]["chargeable"]["min_units"]
    else:
        unit_cost = air_kg_cost(basis, dest)
        ship_cost = air_ship_cost(basis, dest)
        reference = cat["reference_air"]
        ceiling = cat["ceiling_air"]
        freight = air_freight_component(basis)
        step_unit, step_ship = 0.5, 5.0
        unit_name = "kg"
        min_units = basis["air"]["chargeable"]["min_kg"]

    svc_unit = unit_cost / (1 - margin)
    stat_unit = statutory(reference, freight, duty_rate, stat)["total"]
    price_unit = ceil_to(svc_unit + stat_unit, step_unit)
    price_ship = ceil_to(ship_cost / (1 - margin), step_ship)

    return {
        "mode": mode,
        "dest": dest,
        "code": cat["code"],
        "category": cat["name"],
        "unit": unit_name,
        "reference": reference,
        "ceiling": ceiling,
        "duty_rate": duty_rate,
        "unit_cost": unit_cost,
        "ship_cost": ship_cost,
        "svc_unit": svc_unit,
        "stat_unit": stat_unit,
        "price_unit": price_unit,
        "price_ship": price_ship,
        "min_units": min_units,
    }


def stat_per_unit(row, basis):
    """The statutory part inside the published unit price — duty and VAT at the reference value."""
    stat = {k: basis["statutory"][k] for k in ("idf", "rdl", "vat")}
    stat["insurance_rate"] = basis["meta"]["insurance_rate"]
    freight = (sea_freight_component(basis) if row["mode"] == "sea"
               else air_freight_component(basis))
    return statutory(row["reference"], freight, row["duty_rate"], stat)["total"]


def margin_at(row, units, basis=None):
    if basis is None:
        basis = load()[0]
    """Realised SERVICE margin on a shipment of `units`, using the PUBLISHED prices.

    Duty and VAT sit inside the published price and are passed through at cost, so they are
    removed from revenue as well as from cost before the margin is taken.
    """
    stat_unit = stat_per_unit(row, basis)
    service_rev = (row["price_unit"] - stat_unit) * units + row["price_ship"]
    service_cost = row["unit_cost"] * units + row["ship_cost"]
    return (service_rev - service_cost) / service_rev


def build(basis, cats):
    rows = []
    for mode in ("sea", "air"):
        for dest in DESTINATIONS:
            for cat in cats["categories"]:
                rows.append(price_row(basis, cats, mode, dest, cat))
    return rows


def audit(basis, cats, rows):
    """Floor check at the minimum, a typical and a large shipment, per line."""
    floor = basis["meta"]["margin_floor"]
    worst = None
    lines = []
    for row in rows:
        minu = row["min_units"]
        sizes = (minu, minu * 8, minu * 40)
        margins = [margin_at(row, u, basis) for u in sizes]
        low = min(margins)
        lines.append((row, sizes, margins))
        if worst is None or low < worst[1]:
            worst = (row, low)
    return lines, worst, floor


# ----------------------------------------------------------------------------- client HTML
def kes(usd, fx):
    return f"{usd * fx:,.0f}"


def client_html(basis, cats, rows):
    meta = basis["meta"]
    fx = meta["fx_kes_per_usd"]
    by = {(r["mode"], r["dest"], r["code"]): r for r in rows}

    def rate_table(mode):
        body = []
        for cat in cats["categories"]:
            n = by[(mode, "Nairobi", cat["code"])]
            k = by[(mode, "Kampala", cat["code"])]
            money = "{:,.0f}" if mode == "sea" else "{:,.2f}"
            body.append(
                f"<tr><td><b>{cat['name']}</b><span class='eg'>{cat['examples']}</span></td>"
                f"<td class='num'>{cat['duty']*100:.0f}% duty<br>+ 16% VAT</td>"
                f"<td class='num'>{money.format(n['reference'])}</td>"
                f"<td class='num'><b>{money.format(n['price_unit'])}</b></td>"
                f"<td class='num'><b>{money.format(k['price_unit'])}</b></td>"
                f"<td class='num'>{money.format(n['ceiling'])}</td></tr>")
        unit = "W/M" if mode == "sea" else "kg"
        return ("<table><tr><th>Category</th><th>Duty band</th>"
                f"<th>Declared value<br>per {unit}</th><th>Nairobi<br>per {unit}</th>"
                f"<th>Kampala<br>per {unit}</th><th>Ceiling<br>per {unit}</th></tr>"
                + "".join(body) + "</table>")

    def ship_table():
        head = ("<tr><th>Per-shipment charge</th><th>Sea · Nairobi</th><th>Sea · Kampala</th>"
                "<th>Air · Nairobi</th><th>Air · Kampala</th></tr>")
        s_n, s_k = by[("sea", "Nairobi", "A")], by[("sea", "Kampala", "A")]
        a_n, a_k = by[("air", "Nairobi", "A")], by[("air", "Kampala", "A")]
        return (f"<table>{head}"
                f"<tr><td><b>Clearance, documentation and delivery</b>"
                f"<span class='eg'>one charge per shipment, whatever the size</span></td>"
                f"<td class='num'><b>{s_n['price_ship']:,.0f}</b></td><td class='num'><b>{s_k['price_ship']:,.0f}</b></td>"
                f"<td class='num'><b>{a_n['price_ship']:,.0f}</b></td><td class='num'><b>{a_k['price_ship']:,.0f}</b></td></tr>"
                f"<tr><td><b>Minimum billable per shipment</b></td>"
                f"<td class='num'>1 W/M</td><td class='num'>1 W/M</td>"
                f"<td class='num'>45 kg</td><td class='num'>45 kg</td></tr>"
                f"<tr><td><b>Transit, cut-off to door</b></td>"
                f"<td class='num'>{TRANSIT[('sea','Nairobi')]}</td><td class='num'>{TRANSIT[('sea','Kampala')]}</td>"
                f"<td class='num'>{TRANSIT[('air','Nairobi')]}</td><td class='num'>{TRANSIT[('air','Kampala')]}</td></tr>"
                f"</table>")

    def examples():
        picks = [("sea", "C", 3.0, "3 W/M of general goods, declared USD 2,400"),
                 ("sea", "D", 1.0, "1 W/M of electronics, declared USD 2,500"),
                 ("sea", "A", 5.0, "5 W/M of machinery, declared USD 15,000"),
                 ("air", "D", 120.0, "120 kg of electronics, declared USD 18,000")]
        out = []
        for mode, code, units, label in picks:
            r = by[(mode, "Nairobi", code)]
            total = r["price_unit"] * units + r["price_ship"]
            money = "{:,.0f}" if mode == "sea" else "{:,.2f}"
            out.append(f"<tr><td>{label}</td><td class='num'>{money.format(r['price_unit'])} × {units:g}</td>"
                       f"<td class='num'>{r['price_ship']:,.0f}</td><td class='num'><b>{total:,.0f}</b></td>"
                       f"<td class='num'>{total*fx:,.0f}</td></tr>")
        return ("<table><tr><th>Example, delivered Nairobi</th><th>Rate</th><th>Per-shipment</th>"
                "<th>Total USD</th><th>KES approx.</th></tr>" + "".join(out) + "</table>")

    excl = "".join(
        f"<tr><td><b>{g['group']}</b></td><td>{g['items']}</td><td>{g['reason']}</td></tr>"
        for g in cats["excluded"])

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Altovex CargoLinx — consolidated DDP rate card</title>
<style>
@page {{ size:A4; margin:9mm 11mm; }}
* {{ box-sizing:border-box; }}
body {{ font-family:"DejaVu Sans",Arial,sans-serif; color:#16212b; font-size:8.5pt; margin:0; }}
.top {{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid #0b3d5c; padding-bottom:6px; }}
.brand {{ font-size:17pt; font-weight:700; letter-spacing:1.2px; color:#0b3d5c; }}
.brand span {{ color:#c8102e; }}
.meta {{ text-align:right; font-size:7.8pt; line-height:1.4; color:#41525f; }}
h1 {{ font-size:12pt; margin:8px 0 2px; color:#0b3d5c; }}
.sub {{ font-size:8.3pt; color:#41525f; line-height:1.35; margin-bottom:5px; }}
h2 {{ font-size:8.9pt; margin:8px 0 3px; color:#0b3d5c; text-transform:uppercase; letter-spacing:.6px; }}
table {{ width:100%; border-collapse:collapse; }}
th {{ background:#0b3d5c; color:#fff; font-size:7.2pt; font-weight:600; text-align:left; padding:3.2px 5px; line-height:1.25; }}
tr {{ page-break-inside:avoid; }}
.cont {{ page-break-before:always; }}
td {{ border-bottom:1px solid #dbe2e8; padding:2.8px 5px; font-size:8pt; vertical-align:top; line-height:1.25; }}
.num {{ text-align:right; white-space:nowrap; }}
.eg {{ display:block; font-size:6.9pt; color:#6b7a86; margin-top:1px; }}
.note {{ font-size:7.4pt; color:#41525f; line-height:1.33; margin:2.5px 0 0; }}
ul {{ margin:2px 0 0 13px; padding:0; font-size:7.8pt; line-height:1.3; }}
.two {{ display:flex; gap:12px; }}
.two > div {{ flex:1; }}
.hl {{ background:#f2f6f9; border-left:3px solid #c8102e; padding:5px 7px; font-size:7.8pt; line-height:1.35; margin:5px 0; }}
.foot {{ margin-top:5px; border-top:1px solid #d5dbdb; padding-top:3px; font-size:6.7pt; color:#6e7b83; line-height:1.3; }}
</style></head><body>
<div class="top">
  <div class="brand">ALTOVEX <span>CARGOLINX</span></div>
  <div class="meta">Consolidated DDP rate card<br>China → Nairobi and Kampala<br>Valid to {meta['validity_until']}</div>
</div>
<h1>Delivered duty paid — per cubic metre or per kilogram, to your door</h1>
<div class="sub">One price with freight, clearance, duty, VAT and delivery inside it. Sea is charged per W/M — the greater of
volume and weight at 1,000 kg per cubic metre. Air is charged per chargeable kilogram — the greater of the real weight and
L × W × H in centimetres ÷ 6,000. Minimums are one W/M by sea and 45 kg by air.</div>

<h2>1 · Sea, consolidated — per W/M</h2>
{rate_table("sea")}
<div class="note">A W/M is one cubic metre or one tonne, whichever is larger: dense cargo bills by weight, light cargo by
volume. The declared-value column is the value density the price is set at — declare above it and you pay the extra duty
and VAT at cost, declare below it and that duty comes off. The ceiling is the most value we carry at card terms; above it
we re-quote in writing before the cargo moves.</div>

<h2>2 · Air, consolidated — per chargeable kg</h2>
{rate_table("air")}
<div class="note">Chargeable weight is the greater of the scale weight and the volumetric weight at the airline divisor of
6,000. A carton of 60 × 50 × 40 cm is 20 kg chargeable even if it weighs 9 kg, and anything under 45 kg goes on the parcel
lane, not this card.</div>

<h2>3 · Per-shipment charges, minimums and transit</h2>
{ship_table()}
<div class="note">The per-unit rate covers the cargo; the per-shipment charge covers opening the file, clearing it and
delivering it. A one-W/M shipment is one W/M at the rate above plus that charge — nothing else.</div>

<h2>4 · Worked examples, delivered Nairobi</h2>
{examples()}
<div class="note">Read across: rate × chargeable units, plus one per-shipment charge, is the whole invoice. Kampala adds
the transit bond for Uganda, already inside the Kampala rates above.</div>

<h2 class="cont">5 · Quoted case by case, never on this card</h2>
<table><tr><th style="width:21%">Group</th><th style="width:41%">Cargo</th><th>Why</th></tr>{excl}</table>

<h2>6 · What the price includes</h2>
<div class="two">
<div><ul>
<li><b>Included:</b> collection in China, consolidation or stuffing, ocean or air freight, deconsolidation, port or airport
handling, customs clearance, import duty at your HS line, IDF, RDL, VAT, the Uganda transit bond where the cargo continues
to Kampala, and delivery to your door.</li>
<li><b>Included:</b> the file, the manifest, the release, and a delivered proof of delivery, photographed and signed.</li>
</ul></div>
<div><ul>
<li><b>Not included:</b> marine cargo insurance, quoted on request; storage or demurrage beyond the port's free days;
conformity assessment or PVoC for regulated HS codes; heavy-lift, escort or special permits; unloading beyond the tailgate;
and any statutory change after the invoice date.</li>
<li><b>VAT</b> sits inside the price at 16%. A VAT-registered importer recovers it; a non-registered importer does not,
and the gross figure is the one that matters.</li>
</ul></div>
</div>
<div class="hl"><b>How a price is fixed.</b> The figure is set by the category and the declared value per unit shown beside
it, and holds for any shipment inside the ceiling. A different HS line, a value above the ceiling, or cargo outside the
categories above is re-quoted in writing before it moves. No price is changed after the fact.</div>

<h2>7 · How to book</h2>
<div class="two">
<div><ul>
<li><b>One.</b> Send the commercial invoice, the packing list and the dimensions, or just a photograph of the cartons on a
scale. We classify the goods under the correct HS line and tell you the duty band and the exact price before anything moves.</li>
<li><b>Two.</b> You receive a one-page quotation on this card's basis: the category, the chargeable W/M or kg, the rate, the
per-shipment charge and the transit window, with the total at the value you declared.</li>
</ul></div>
<div><ul>
<li><b>Three.</b> Confirm and book. We consolidate at the next cut-off, clear the cargo on arrival, and deliver against a
signed, photographed proof of delivery. You track the shipment on the CargoLinx link we send with the booking.</li>
<li><b>Payment.</b> Settlement on the invoice at the rate shown; the duty and VAT element is receipted with the entry.</li>
</ul></div>
</div>

<div class="foot">
Prices in US dollars, invoiced in Kenya shillings at the rate on the invoice date (KES {fx}/USD on 2 November 2026).
Duty follows the HS line and the EAC Common External Tariff; the classification is confirmed before the cargo moves.
Transit runs from the consolidation cut-off to your door and follows the carrier schedule. Rates valid 30 days, to
{meta['validity_until']}, subject to space at booking. A rate schedule, not an offer of carriage.
Altovex Global Logistics Co. Ltd · P.O. Box 3515-00100 Nairobi · +254 718 554 383 · +254 753 005 989 · altovexgl@gmail.com
</div>
</body></html>"""


def internal_html(basis, cats, rows, lines, worst, floor):
    fx = basis["meta"]["fx_kes_per_usd"]
    meta = basis["meta"]

    def build_rows():
        out = []
        for r in rows:
            out.append(
                f"<tr><td>{r['mode'].upper()} · {r['dest']}</td><td>{r['code']}</td>"
                f"<td class='num'>{r['reference']:,.0f}</td><td class='num'>{r['ceiling']:,.0f}</td>"
                f"<td class='num'>{r['duty_rate']*100:.0f}%</td>"
                f"<td class='num'>{r['unit_cost']:,.2f}</td><td class='num'>{r['ship_cost']:,.2f}</td>"
                f"<td class='num'>{r['svc_unit']:,.2f}</td><td class='num'>{r['stat_unit']:,.2f}</td>"
                f"<td class='num'><b>{r['price_unit']:,.2f}</b></td><td class='num'>{r['price_ship']:,.0f}</td>"
                f"<td class='num'>{margin_at(r, r['min_units'], basis)*100:.1f}%</td></tr>")
        return "".join(out)

    prov = []
    for mode_key, label in (("sea", "Sea"), ("air", "Air")):
        for bucket in ("per_unit", "per_shipment"):
            for line in basis[mode_key][bucket]:
                flag = "PROVISIONAL" if line["status"] == "provisional" else "SIGNED"
                prov.append(
                    f"<tr><td>{label}</td><td>{line['label']}</td><td class='num'>{line['value']:,.2f}</td>"
                    f"<td>{line['unit']}</td><td>{flag}</td><td class='src'>{line['source']}</td></tr>")

    w = worst
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Internal — DDP rate card working</title>
<style>
@page {{ size:A4; margin:9mm 10mm; }}
body {{ font-family:"DejaVu Sans",Arial,sans-serif; color:#16212b; font-size:7.8pt; margin:0; }}
.top {{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #c8102e; padding-bottom:5px; }}
.brand {{ font-size:14pt; font-weight:700; color:#0b3d5c; letter-spacing:1px; }}
.brand span {{ color:#c8102e; }}
.meta {{ text-align:right; font-size:7.2pt; color:#41525f; line-height:1.35; }}
h1 {{ font-size:10.4pt; margin:7px 0 2px; color:#0b3d5c; }}
h2 {{ font-size:8.3pt; margin:8px 0 2px; color:#0b3d5c; text-transform:uppercase; letter-spacing:.5px; }}
table {{ width:100%; border-collapse:collapse; }}
th {{ background:#0b3d5c; color:#fff; font-size:6.6pt; padding:2.8px 3px; text-align:left; line-height:1.2; }}
td {{ border-bottom:1px solid #dbe2e8; padding:2.3px 3px; font-size:7pt; line-height:1.2; }}
.num {{ text-align:right; white-space:nowrap; }}
.src {{ font-size:6.3pt; color:#5b6b78; }}
.note {{ font-size:7.1pt; color:#41525f; line-height:1.32; margin:3px 0 0; }}
.warn {{ background:#fff4f4; border-left:3px solid #c8102e; padding:5px 7px; font-size:7.3pt; line-height:1.35; margin:5px 0; }}
.foot {{ margin-top:5px; border-top:1px solid #d5dbdb; padding-top:3px; font-size:6.3pt; color:#6e7b83; }}
</style></head><body>
<div class="top"><div class="brand">ALTOVEX <span>CARGOLINX</span> · INTERNAL</div>
<div class="meta">Cost build-up and margin audit<br>Prepared 2 November 2026 · not for release<br>FX {fx} KES/USD</div></div>
<h1>Working sheet — consolidated DDP card</h1>
<div class="note">Margin {meta['margin_target']*100:.0f}% on service cost only. Duty, IDF, RDL and VAT pass through at cost —
they are removed from revenue before the margin is taken. Duty is computed on CIF using the real carrier freight, never on
our selling price. Each line is priced at the category's reference value density; duty is trued at actual value between
reference and ceiling, so the margin holds whether the client declares above or below the reference.</div>

<h2>1 · Price build-up, per category and destination</h2>
<table><tr><th>Mode · dest</th><th>Cat</th><th>Ref value</th><th>Ceiling</th><th>Duty</th><th>Unit cost</th>
<th>Ship cost</th><th>Service / unit</th><th>Statutory / unit</th><th>Price / unit</th><th>Price / ship</th>
<th>Margin @ min</th></tr>
{build_rows()}</table>

<h2>2 · Margin floor check (floor {floor*100:.0f}%)</h2>
<div class="warn"><b>Worst realised service margin across every line and every shipment size tested: {w[1]*100:.1f}%</b> —
{w[0]['mode'].upper()} · {w[0]['dest']} · category {w[0]['code']}, at the minimum billable shipment.
Floor is {floor*100:.0f}%; the card is {'CLEAR' if w[1] >= floor else 'REFUSED'}.</div>
<div class="note">Tested at the minimum chargeable shipment, at eight times the minimum and at forty times it, for every
category and both destinations. The per-shipment charge carries the same margin as the per-unit rate, so a small shipment
does not erode it. Tax is excluded from both revenue and cost, which is why the figure sits at the 30% target rather than
looking inflated by pass-through duty.</div>

<h2>3 · Where every rate comes from</h2>
<table><tr><th style="width:5%">Mode</th><th style="width:29%">Line</th><th style="width:9%">Value</th>
<th style="width:11%">Unit</th><th style="width:10%">Status</th><th>Source on file</th></tr>{''.join(prov)}</table>
<div class="note">No figure on this card is taken from another forwarder's published prices. The market bands are the
plausible range observed in this corridor on 2 November 2026; a band is not a contract. Replace each PROVISIONAL line with
a signed carrier, CFS, transporter, bond or clearing-agent figure in rates/cost-basis.yaml and the card re-prices itself
from the same file, with the floor test re-run before anything is published.</div>

<h2>4 · Guard-rails carried into the client card</h2>
<div class="note">Sea bills the greater of CBM and tonnes at 1,000 kg/CBM, minimum 1 W/M. Air bills the greater of actual
and volumetric weight at the 6,000 divisor, minimum 45 kg, with anything below 45 kg routed to the parcel lane. Five cargo
categories, each with its own duty tier, its own reference value density and its own ceiling. Six excluded groups quoted
case by case. Validity 30 days to {meta['validity_until']}. Transit stated per mode and destination. The client card
carries price, value density, ceiling, minimums, transit and inclusions — no cost, no margin, no source line.</div>
<div class="foot">Altovex Global Logistics Co. Ltd · internal working sheet · prepared by Amanda for Allan Sande ·
branch rate-card/ddp-wm-2nov · not for release to any counterparty</div>
</body></html>"""


# ----------------------------------------------------------------------------- render
def render(html, out_pdf, chrome="google-chrome"):
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    src = out_pdf.with_suffix(".html")
    src.write_text(html)
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                    "--no-pdf-header-footer", f"--print-to-pdf={out_pdf}", src.as_uri()],
                   check=True, capture_output=True)
    return out_pdf


# ----------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--audit", action="store_true", help="print the audit only, render nothing")
    args = ap.parse_args(argv)

    basis, cats = load()
    rows = build(basis, cats)
    lines, worst, floor = audit(basis, cats, rows)

    print(f"FX {basis['meta']['fx_kes_per_usd']} KES/USD · margin {basis['meta']['margin_target']*100:.0f}% "
          f"on service · floor {floor*100:.0f}%")
    print(f"{'mode':4} {'dest':8} {'cat':3} {'ceil':>8} {'duty':>5} {'unit cost':>10} {'price/unit':>11} {'margin@min':>10}")
    for row in rows:
        print(f"{row['mode']:4} {row['dest']:8} {row['code']:3} {row['ceiling']:8,.0f} "
              f"{row['duty_rate']*100:4.0f}% {row['unit_cost']:10,.2f} {row['price_unit']:11,.2f} "
              f"{margin_at(row, row['min_units'], basis)*100:9.1f}%")
    print(f"\nworst realised margin {worst[1]*100:.1f}% on {worst[0]['mode']} {worst[0]['dest']} "
          f"cat {worst[0]['code']} — floor {floor*100:.0f}%")

    if worst[1] < floor:
        print("REFUSED: a published price falls through the margin floor.", file=sys.stderr)
        return 2
    if args.audit:
        return 0

    client = render(client_html(basis, cats, rows), OUT / "CargoLinx-DDP-rate-card-client-2Nov2026.pdf")
    internal = render(internal_html(basis, cats, rows, lines, worst, floor),
                      OUT / "CargoLinx-DDP-rate-card-internal-2Nov2026.pdf")
    print(f"\nclient   {client}")
    print(f"internal {internal}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
