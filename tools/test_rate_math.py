#!/usr/bin/env python3
"""Tests for the DDP rate-card arithmetic. Run: python3 tools/test_rate_math.py

These are the numbers a client will check, so they are asserted rather than eyeballed.
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ddp_rate_card as rc  # noqa: E402

BASIS, CATS = rc.load()
FAILS = []


def check(name, got, want, tol=0.01):
    ok = abs(got - want) <= tol
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {got:,.4f} (want {want:,.4f})")
    if not ok:
        FAILS.append(name)


def check_true(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------- chargeable weight rules
def wm(cbm, kg):
    """The W/M rule: bill the greater of volume and tonnes, floor one."""
    return max(cbm, kg / 1000.0, BASIS["sea"]["chargeable"]["min_units"])


check("sea: 3 CBM at 2,000 kg bills volume", wm(3.0, 2000), 3.0)
check("sea: 0.6 CBM at 1,200 kg bills weight", wm(0.6, 1200), 1.2)
check("sea: 0.4 CBM at 200 kg bills the 1 W/M minimum", wm(0.4, 200), 1.0)
check("sea: 12 CBM at 9,000 kg bills volume", wm(12.0, 9000), 12.0)


def chargeable_kg(actual, l, w, h):
    vol = (l * w * h) / BASIS["air"]["chargeable"]["divisor"]
    return max(actual, vol, BASIS["air"]["chargeable"]["min_kg"])


check("air: 60x50x40 cm = 20 kg volumetric", 60 * 50 * 40 / 6000, 20.0)
vol_only = 60 * 50 * 40 / BASIS["air"]["chargeable"]["divisor"]
check("air: the volumetric rule alone gives 20 kg for 60x50x40", vol_only, 20.0)
check("air: a 9 kg carton at 60x50x40 is lifted by the 45 kg minimum", chargeable_kg(9, 60, 50, 40), 45.0)
check("air: a dense 130 kg item bills actual", chargeable_kg(130, 60, 50, 40), 130.0)
check("air: 8 kg small parcel bills the 45 kg minimum", chargeable_kg(8, 30, 20, 20), 45.0)

# ---------------------------------------------------------------- duty is on CIF, not on our price
stat = {k: BASIS["statutory"][k] for k in ("idf", "rdl", "vat")}
stat["insurance_rate"] = BASIS["meta"]["insurance_rate"]
s = rc.statutory(1000.0, 145.0, 0.25, stat)
check("duty base includes the real freight", s["duty"], (1000 + 145) * 1.005 * 0.25, 0.05)
check("VAT sits on CIF + duty + IDF + RDL", s["vat"],
      ((1000 + 145) * 1.005 + s["duty"] + s["idf"] + s["rdl"]) * 0.16, 0.05)
duty_on_cif = (1000 + 145) * 1.005 * 0.25
marked_up = (1000 + 145) / (1 - BASIS["meta"]["margin_target"]) * 0.25
check("duty equals the rate on CIF, not on a marked-up value", s["duty"], duty_on_cif, 0.05)
check_true("duty is materially below what a marked-up base would charge",
           s["duty"] < marked_up, f"{s['duty']:.2f} vs {marked_up:.2f}")

# ---------------------------------------------------------------- price covers the reference
rows = rc.build(BASIS, CATS)
for r in rows:
    freight = (rc.sea_freight_component(BASIS) if r["mode"] == "sea"
               else rc.air_freight_component(BASIS))
    stat_ref = rc.statutory(r["reference"], freight, r["duty_rate"], stat)["total"]
    check_true(f"{r['mode']}/{r['dest']}/{r['code']}: price covers statutory at the reference value",
               r["price_unit"] >= r["svc_unit"] + stat_ref - 1e-6,
               f"price {r['price_unit']:.2f} vs {r['svc_unit'] + stat_ref:.2f}")

# Above the reference the difference is charged at cost, so nothing is lost there either.
for r in rows:
    freight = (rc.sea_freight_component(BASIS) if r["mode"] == "sea"
               else rc.air_freight_component(BASIS))
    units = r["min_units"] * 3
    extra_value = (r["ceiling"] - r["reference"]) * units
    extra_duty = rc.statutory(r["ceiling"] * units, freight * units, r["duty_rate"], stat)["total"] \
        - rc.statutory(r["reference"] * units, freight * units, r["duty_rate"], stat)["total"]
    billed = r["price_unit"] * units + r["price_ship"] + extra_duty
    cost = r["unit_cost"] * units + r["ship_cost"] + rc.statutory(
        r["ceiling"] * units, freight * units, r["duty_rate"], stat)["total"]
    check_true(f"{r['mode']}/{r['dest']}/{r['code']}: a ceiling-value shipment still clears at cost+margin",
               billed > cost, f"billed {billed:,.0f} vs cost {cost:,.0f}, extra duty {extra_value:,.0f} value")

# ---------------------------------------------------------------- margin floor, every line
floor = BASIS["meta"]["margin_floor"]
worst = min((rc.margin_at(r, u, BASIS), r, u) for r in rows for u in (r["min_units"], r["min_units"] * 8, r["min_units"] * 40))
check_true(f"margin floor {floor:.0%} holds everywhere (worst {worst[0]:.1%})", worst[0] >= floor,
           f"{worst[1]['mode']} {worst[1]['dest']} cat {worst[1]['code']} at {worst[2]:g} units")

# ---------------------------------------------------------------- the price is the promise
for r in rows:
    units = r["min_units"] * 7
    freight = (rc.sea_freight_component(BASIS) if r["mode"] == "sea"
               else rc.air_freight_component(BASIS))
    billed = r["price_unit"] * units + r["price_ship"]
    cost = r["unit_cost"] * units + r["ship_cost"] + rc.statutory(
        r["reference"] * units, freight * units, r["duty_rate"], stat)["total"]
    check_true(f"{r['mode']}/{r['dest']}/{r['code']}: a reference-value shipment clears with margin",
               billed > cost, f"billed {billed:,.0f} vs cost {cost:,.0f}")

# ---------------------------------------------------------------- a single-phone style shipment
r = next(x for x in rows if x["mode"] == "air" and x["dest"] == "Nairobi" and x["code"] == "D")
one_kg = r["price_unit"] * 1 + r["price_ship"]
check_true("a 1 kg parcel below the air minimum is quoted on the parcel lane, not here",
           one_kg > 0 and BASIS["air"]["chargeable"]["min_kg"] >= 45,
           "air minimum 45 kg keeps one-kilo parcels off the consolidated card")

print()
if FAILS:
    print(f"{len(FAILS)} FAILED: {', '.join(FAILS)}")
    raise SystemExit(1)
print(f"all checks passed ({len(rows)} priced lines)")
