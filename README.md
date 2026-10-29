# CargoLinx v2 — offline freight desk for East African corridors

Built for the Meta Global AI Developer Hackathon, October–November 2026, by Altovex Global
Logistics with Dreamteam Consulting. This repository is the application; the parent folder holds the
deterministic engine and its tests.

## What it does

A freight desk that works when the link does not:

1. **Landed cost in seconds, itemised.** CIF, EAC CET duty band, excise, Import Declaration Fee,
   Railway Development Levy, VAT, clearing, inland transport, last mile — every line printed with its
   base and its rate, so a figure can be defended at a KRA counter.
2. **Quote with a floor that refuses.** The engine will not issue a quote under a 15% margin; it also
   states the cheapest defensible counter-offer.
3. **ETA with its basis printed.** Segments, speeds, dwell, customs time, buffer and confidence, plus
   the history of every change with its cause. A previous ETA is never overwritten silently.
4. **Proof of delivery captured on device**, and a printable quotation generated from the same figures.
5. **Offline-first writes.** A POD signed at the border is stored locally and queued with an
   idempotency key; it drains to the backend on reconnect without duplicates.

The model layer is deliberately narrow: read a cargo photograph, transcribe a voice note, match a lane,
explain a quote. **No model ever sets a price or a date.**

## Verified against a real run (29 October 2026)

- 20 units, goods KES 1,200,000, freight KES 250,000, 25% duty band, clearing 45,000, transport
  60,000, last mile 12,000 → CIF 1,457,250.00; duty 364,312.50; IDF 36,431.25; RDL 29,145.00;
  VAT 301,942.20; **landed cost 2,306,080.95**; quote at 30% = **2,863,055.36** ex-VAT,
  **3,321,144.22** incl VAT; floor price (15%) 2,357,810.29.
- Offline: an ETA delay recorded with no network, page reloaded from the service worker with the data
  intact and one write queued; on reconnect `pushed 1, pulled 1`, outbox 0, one server row, no
  duplicate, local record intact.
- 28 automated tests pass (`npm test`): engine maths, refusal below the margin floor, ETA change
  history, outbox idempotency, conflict resolution, document content.

## Not yet verified

- The Meta model calls (photo counting, transcription, lane matching, explanation) are written against
  the documented endpoint shape but have **not been executed** — no live key was available on the build
  machine. Until then the UI reports "models off" and the app runs on the deterministic engine alone.
- Lane speeds are planner defaults, marked as such in the interface; replace them with the operator's
  own run data before any ETA is promised to a client.
- The VAT base composition (CIF + duty + excise + IDF + RDL) is a modelling choice; confirm against a
  live KRA assessment.

## Rates

`engine/rates/ke-2026.mjs` — IDF 2.5%, RDL 2%, VAT 16% (8% fuel), EAC CET bands 0/10/25/35, verified
28 October 2026 against PwC Worldwide Tax Summaries (Kenya, corporate other taxes, last reviewed
17 July 2026) and the EAC CET 2022.

## Run

```
npm install
npm test          # engine and sync tests, no browser needed
npm run dev       # local desk at http://localhost:5173
npm run build && npm run preview
```

## Layout

- `engine/` — landed cost, quoting, ETA (pure, tested, no network)
- `src/lib/` — local IndexedDB store, sync core, Meta model adapter, quotation document
- `src/App.jsx` — four screens: intake, quote, tracking and POD, setup
- `tests/` — node test suites

## Licence

No licence file yet; the choice is pending the founder's sign-off. Nothing here may be reused until
a licence is added.
