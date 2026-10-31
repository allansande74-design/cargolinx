# CargoLinx — Meta Global AI Developer Hackathon 2026

**Entrant:** Sande Allan, Altovex Global Logistics Co. Ltd, Nairobi, Kenya.
**Build:** Altovex CargoLinx — an offline freight desk for the East African corridor.
**Live:** https://mindful-koan-nn55.here.now
**Repository:** https://github.com/allansande74-design/cargolinx
**Licence:** MIT (see `LICENSE`).

## Where this entry sits in the event

Verified on the event page on 31 October 2026:

- **Track:** Startup — "for teams and founders building a real product… judged on technical
  execution and whether it holds up in production". Altovex Global Logistics is a trading company
  running the desk on its own corridor shipments, which is what the track asks for.
- **Theme:** Build for Your World — a problem the entrant knows firsthand, in his own domain.
- **Submissions close 4 November, 9:00 PM ET**, which is 05:00 EAT on 5 November. The build is
  worked to 12:00 EAT on 4 November, seventeen hours earlier, so the entry is filed with margin.
- **Judging runs 4–8 November; winners are announced on 9 November.**
- The submission itself is filed through the participant portal, which needs the entrant's login;
  the agent prepares the pack, the entrant files it.

## The problem the build answers

A trader on the Mombasa–Kampala corridor gets a quote two days late and cannot defend the
number when the buyer pushes back. CargoLinx does the opposite: the landing cost is computed on
the device from dated statutory rates, every line shows its base and its rate, and the document
the buyer receives restates exactly the figures that produced the price. The model layer explains
and reads; it never prices and never dates.

## What is in the repository

| Layer | Where | What it does |
|---|---|---|
| Landed cost | `engine/landed.mjs` | CIF, duty, IDF 2.5%, RDL 2%, VAT 16%, clearing, transport, last mile, PVoC |
| Tariff and conformity | `engine/tariff.mjs` | HS table for corridor codes, EAC CET bands, PVoC fees, refusal on an unclassified code |
| ETA | `engine/eta.mjs` | Segmented transit plan with dwell, border time and confidence |
| Quote gate | `engine/quote.mjs` | 30–40% policy band, 15% floor, refuses a quote below the floor instead of sliding |
| Documents | `src/lib/quote-doc.mjs` | Quotation HTML with a QR that verifies the figures against the engine |
| Offline layer | `src/lib/db.js`, `src/lib/sync.js` | IndexedDB persistence, idempotent queue, drain on reconnect |
| Desk | `src/App.jsx` | Twelve modules on one ledger: shipment, quote, tracking, compliance, sourcing, suppliers, orders, money, warehouse, messages, network, plugins |
| Meta model layer | `src/lib/meta.js` | Four task-scoped calls: cargo photo read, voice note transcript, lane match, quote explanation |
| Model bridge | `server/proxy.mjs` | Holds the provider key server-side so the browser never carries one |
| Tests | `tests/` | 341 tests, 0 failing (`npm test`) |

## Working with Meta models

The model layer is narrow on purpose and every call names the model that served it.

- **Models used:** `muse-spark-1.3` for reasoning and explanation, `muse-image-1.0` for imagery,
  `sam-3.1` for counting cargo from a photograph, `muse-voice-transcribe-1.0` for driver notes.
- **Real call, recorded:** the quote-explanation task was run against the live desk on
  31 October 2026 and returned in 5.64 s, 934 tokens, cost recorded in `evidence/bridge_usage.jsonl`.
  Its answer, for a KES 2,038,543.70 landed cost, named the two largest lines (duty
  KES 364,312.50; VAT KES 301,942.20) and the 30% margin — all figures supplied by the engine,
  none produced by the model.
- **Honest degradation:** with no key configured, the desk says `Models off` and the four
  model-assisted steps take a deterministic path or are disabled. It never fabricates a call.
- **The prompt is a product surface.** The explanation prompt was tightened during the event so
  the model writes "customs value (CIF)", never a JSON key, which is what a client reads.

## The demo

- `cargolinx-demo-165s.mp4` — 165 seconds, nine scenes, 1920×1080, narrated, captured from the
  running build: landing, one shipment entry, the landed-cost ladder, the model explaining the
  quote, the printed quotation, tracking, compliance, airplane mode, and the close.
- Cut from real screens; no mock-ups and no invented figures. Scene 3's figures are the ones the
  engine returned for the shipment in the video: landed cost before VAT KES 2,038,543.70,
  quoted at 30% margin KES 2,912,205.29 ex-VAT.

## Measured, not asserted

`docs/PERF.md` records the browser's own numbers for the deployed build: LCP 1,084 ms cold and
100 ms warm, TTFB 558 ms cold, interaction latency 32 ms, and first-load CLS 0.000 on both the
landing page and the desk. An earlier 0.180 reading came from a scripted module switch and was
corrected after the run was repeated with the observer installed before first paint.

## What is not claimed

- The 26-market dataset has one verified market (Kenya); the rest are drafts and the app labels
  them as drafts.
- Customs lodgement is done by a licensed clearing agent; the desk prepares and verifies the
  entry file and claims no filing API.
- Telematics partners are modelled through an adapter contract tested against a fixture, not
  integrated live.
- Direct calls to `api.meta.ai` returned `billing_not_configured` on the entrant's team during
  the event; the working path is the same Meta model through the local gateway, and the desk
  reports which upstream model served each answer.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 341 tests
node cli/quote.mjs --qty 20 --clearing 48000 --transport 55000 --lastmile 14000 --margin 0.30
node server/proxy.mjs --port=8787   # optional model bridge; the desk works without it
```
