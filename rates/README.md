# Consolidated DDP rate card — how it is built

The card is generated, never typed. Two files hold every input, one script does the arithmetic
and the layout, one test proves the arithmetic.

```
rates/cost-basis.yaml     what each service line costs, with its source and status
rates/categories.yaml     the five cargo categories, their duty tier, reference value, ceiling,
                          and the excluded list
tools/ddp_rate_card.py    pricing engine + client card + internal working sheet
tools/test_rate_math.py   the numbers a client would check, asserted
rates/out/                rendered PDFs
```

Run:

```bash
python3 tools/test_rate_math.py      # arithmetic and margin floor — must be green
python3 tools/ddp_rate_card.py       # renders both PDFs and prints the price table
python3 tools/ddp_rate_card.py --audit   # price table only, no render
```

Requires PyYAML and a Chrome/Chromium binary for the headless PDF render.

## The charging rules on the card

- **Sea** is billed per W/M: the greater of the volume in cubic metres and the weight in tonnes
  at 1,000 kg per CBM. Minimum one W/M per shipment.
- **Air** is billed per chargeable kg: the greater of the actual weight and the volumetric weight
  at L × W × H cm ÷ 6,000. Minimum 45 kg per shipment; anything lighter goes on the parcel lane.
- **Five categories**, each with its own duty tier, its own reference value density and its own
  ceiling. Above the ceiling, or outside the categories, the cargo is quoted case by case.
- **Six excluded groups** — restricted, excisable, hazardous, perishable, high-value, and
  anything above the ceiling.

## The pricing rules behind it

1. **Service cost carries 30% margin.** Freight, consolidation, port, haulage, clearing,
   documentation and delivery are marked up at 30%; the per-shipment charge carries the same
   margin as the per-unit rate, so a small shipment does not dilute it.
2. **Duty and VAT pass through at cost.** They are added to the price and removed from revenue
   before the margin is measured. They are never marked up, in either direction.
3. **Duty is computed on CIF using the real carrier freight**, not on our selling price. Marking
   duty up on a marked-up freight figure is how a forwarder quietly overcharges a client.
4. **Each line is priced at the category's reference value density**, with duty trued to the
   actual invoice value between reference and ceiling. The client pays for the duty their cargo
   actually attracts, and the margin holds at either end of the band.
5. **A published price that falls below the 15% policy floor is refused**, not printed. The
   generator exits non-zero rather than render it, and the test suite asserts the floor at the
   minimum, at eight times the minimum and at forty times it, for every line.

## Two documents, two audiences

- `CargoLinx-DDP-rate-card-client-…pdf` — price, value density, ceiling, minimums, transit,
  inclusions. No cost, no margin, no source line. It is grepped for `margin|floor|profit|
  provisional|our cost|buy rate|mark-up|cost build|30%` before it leaves the building, and that
  grep must return zero.
- `CargoLinx-DDP-rate-card-internal-…pdf` — the build-up, the margin audit at every shipment
  size, the provenance of every line, and the guard-rails. Not for any counterparty.

## Before this goes to a client

Every service line is currently a **provisional market band**, not a contracted rate. See
`rates/SOURCES.md` for the document required against each line. Replace the line, set its
status to `signed`, re-run the test, re-render. Until then the card may be used to structure a
quote, and the quotation put in front of a client should say the figure holds at booking.
