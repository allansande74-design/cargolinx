# Film content check — cargolinx-demo-v5-film.mp4

Measured on the delivered file (`cargolinx-demo-v5-film.mp4`, 153.8 s, 15.7 MB) by extracting one frame
every three seconds (51 frames) and reading every frame's text with RapidOCR. No frame was skipped.

## Text results across all 51 frames

- Forbidden or stale wording — `solar`, `here.now`, `rising-hollow`, `vercel`, `github.io`,
  `muse image`, `no meta key`, `placeholder`, `lorem`: **0 hits**.
- Live address `altovexcargolinx.allansande74.workers.dev`: present on the close frames (f_050, f_051)
  and nowhere replaced by an old host.
- Buyer and shipment identity `Kampala Power & Cable Ltd`: 13 frames; vehicle `KDH 417X`: 4 frames —
  the delivery note and packing list are the real documents raised for this shipment.
- Money: `2,038,543.70` (landed cost before VAT) and `2,912,205.29` (price before VAT at 30% margin)
  appear together on the quotation frames (f_038, f_040) and once in the impact close (f_049).

## Provenance of every image in the film

- Mombasa container terminal — public-domain photograph, Wikimedia Commons; credit burned into the card.
- Cable reels — public-domain photograph (Win Henderson / FEMA), Wikimedia Commons; credit burned in.
- Quotation — HTML raised by the product's own builder (`src/lib/quote-doc.mjs`) for order
  CLX-261031-714, captured headless at 3x; values reconcile to the on-screen ladder.
- Delivery note and packing list — raised by `deliveryNoteHtml` / `packingListHtml`
  (`src/lib/doc-templates.mjs`) for the same order, captured the same way.
- No stock imagery, no generated mock UI, no AI stand-in panel remains in the cut.

## Figures reconcile with source

- Ladder rows excluding VAT sum to `2,038,543.70`, including the 117,000.00 clearing and transport row.
- `2,912,205.29` is `2,038,543.70` at a 30% margin; the quotation document carries the same two figures.
