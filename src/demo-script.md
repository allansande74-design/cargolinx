# CargoLinx — 165-Second Demo Script

Total: 165 seconds, 6 scenes. Read narration verbatim; do the listed action live.

## Scene 1 — 0–25s — Screen: Landing page (`#`, `Landing.jsx`)

Action shown: Landing page story strip (pain → fix → proof cards).
Narration: "Every quote in this trade lands two days late, and nobody can defend the number. CargoLinx is an offline freight desk: the engine computes landed cost from dated statutory rates, the model only reads and explains — it never prices. Watch one shipment go from entry to a verifiable quote in under three minutes."

## Scene 2 — 25–55s — Screen: Desk > New shipment (`#/desk/new`, `NewShipment` in `App.jsx`)

Action shown: New shipment form — enter cargo, origin → destination, quantity, duty band.
Narration: "I enter the consignment once — cargo, Mombasa to Kampala, quantity, and the EAC duty band. One record. Everything downstream — quote, tracking, documents — reads from this, so nothing gets retyped at 11pm."

## Scene 3 — 55–90s — Screen: Desk > Quote (`#/desk/quote`, `QuoteView` in `App.jsx`)

Action shown: Quote tab landed-cost ladder — CIF, duty, IDF 2.5%, RDL 2%, VAT 16%, clearing, transport, margin floor.
Narration: "The ladder prints every line with its base and rate — CIF, duty, IDF, RDL, VAT, clearing, transport, last mile — each rate carrying the date it was checked. The desk refuses any quote under a 15% margin and states the floor price instead of sliding. Same 20-unit run: landed 2,306,080.95, quote at 30% is 2,863,055.36 ex VAT."

## Scene 4 — 90–115s — Screen: Desk > Track (`#/desk/track`, `TrackView` in `App.jsx`)

Action shown: Track tab ETA segments plus header badge "Offline — writes queued" with queue count.
Narration: "The ETA carries its segments, dwell, customs time, buffer and confidence — and a change is kept with its cause, never silently overwritten. Kill the network: the write is stored on the device with an idempotency key and drains on reconnect with no duplicate row."

## Scene 5 — 115–145s — Meta-direct action: `readCargoPhoto` + `transcribeVoice` + `explainQuote` (`src/lib/meta.js`)

Action shown: Meta model assist — delivery-note photo read into shipment fields, driver voice note transcribed, quote explained in plain language; answer names its upstream model.
Narration: "The photo of the load, the driver's voice note and the clerk's shorthand land in three places — the desk reads all three into one shipment record and shows which upstream model served the reading. The model layer is narrow by design: it reads, transcribes and explains. It never sets a price or a date."

## Scene 6 — 145–165s — Screen: printed Quotation (`src/lib/quote-doc.mjs` `quoteHtml`) — QR-verified quote

Action shown: Printed ALTOVEX GLOBAL LOGISTICS quotation with cost-line table, price box, footer — scan its QR to verify the figures against the engine.
Narration: "And this is what the buyer gets: a quotation that restates the engine's figures line by line, valid 14 days, signed Sande Allan. Scan the QR — it verifies the numbers you just watched being built. That is the whole demo: one entry, one defended ladder, one verifiable quote."
