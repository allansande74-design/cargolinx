# Rate sources register

Every figure on the card is derived from `rates/cost-basis.yaml`. This register records what
backs each line, what is still missing, and what has to be attached before the card is called
firm. **No number here comes from another forwarder's published card** — the Choice Logistics
card was read for format only (per W/M, per kg, per container), not for figures.

Status of the current build (2 November 2026): all service lines are **provisional market
bands** observed on the China → Mombasa → Nairobi/Kampala corridor. Statutory lines are
**set by law** and are cited. That means the card is internally consistent and margin-safe,
but it is not yet a contracted rate sheet.

## Statutory lines — fixed by instrument

| Line | Value | Instrument |
|---|---|---|
| Import duty | 0 / 10 / 25 / 35 % by HS line | EAC Common External Tariff (ad valorem tiers) |
| IDF | 2.5% of CIF | Import Declaration Fee |
| RDL | 2.0% of CIF | Railway Development Levy |
| VAT | 16% on CIF + duty + IDF + RDL | VAT Act 2013 |
| Insurance | 0.5% of CIF | Marine cargo cover, included in the duty base |

Reorder the duty tier per HS line at classification; the categories on the card group lines
that sit in the same tier, and the desk confirms the line before the cargo moves.

## Service lines — what to attach to make them firm

| Line (file key) | Today | What makes it firm |
|---|---|---|
| `sea.per_unit.freight` | market band 145 / CBM | signed consolidator or NVOCC tariff, China base port → Mombasa, valid for the card period |
| `sea.per_unit.cfs` | 48 / CBM | CFS tariff sheet from the origin warehouse |
| `sea.per_unit.port` | 12 / CBM | KPA / terminal tariff applicable to LCL de-stuffing |
| `sea.per_unit.inland_nairobi` | 32 / CBM | transporter quotation, Mombasa → Nairobi, per CBM on a consolidated trailer |
| `sea.per_unit.inland_kampala` | 48 / CBM | transporter quotation, Mombasa → Kampala via Malaba, including border |
| `sea.per_shipment.doc` | 40 / shipment | internal costed rate (staff time, manifest, release) |
| `sea.per_shipment.clearing` | 130 / shipment | clearing agent's quotation for an LCL entry |
| `sea.per_shipment.lastmile_*` | 30 / 45 | internal costed rate for a 1-tonne delivery run |
| `sea.per_shipment.bond_kampala` | 130 / shipment | bond provider's quotation for a Uganda transit bond |
| `air.per_unit.freight` | 6.20 / kg | airline or consolidator tariff, China hub → NBO, including the fuel and security line as quoted |
| `air.per_unit.fuel` | 0.60 / kg | the same quotation, split out |
| `air.per_unit.handling` | 0.35 / kg | ground handler's tariff at origin and destination |
| `air.per_unit.delivery_*` | 0.45 / 0.80 | internal costed rate per kg for the delivery run |
| `air.per_shipment.clearing` | 130 / shipment | clearing agent's quotation for an air entry |
| `air.per_shipment.bond_kampala` | 95 / shipment | bond provider's quotation |

## How to firm a line

1. Obtain the document and file it under `rates/sources/<date>-<supplier>-<line>.pdf`.
2. Change the line's `status` from `provisional` to `signed` and point `source` at the file.
3. Run `python3 tools/ddp_rate_card.py` — the card re-prices from the file.
4. Run `python3 tools/test_rate_math.py` — the floor test must stay green before release.

## Category value densities — why they are set where they are

Each category carries a reference declared value per W/M and per kg: the value density that
cargo of that kind normally shows on an invoice. The card publishes the all-in price at that
reference. Duty and VAT are then trued to the actual invoice value, at cost, between the
reference and the ceiling. This is what keeps a flat per-CBM rate from losing money on
value-dense cargo while not overcharging light cargo.

Reference values are a commercial judgement, not a cost. They should be revisited against the
first ten real invoices in each category; if the observed densities differ, change
`reference_sea` / `reference_air` in `rates/categories.yaml` and re-render.

## Deliberately not on the card

- Marine cargo insurance — quoted per shipment on request.
- PVoC / conformity assessment for regulated HS codes — third-party fee, passed through.
- Storage, demurrage, detention beyond free days.
- Heavy lift, escort, out-of-gauge, and any cargo on the excluded list.
