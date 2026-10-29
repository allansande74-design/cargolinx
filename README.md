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
- Engine maths, refusal below the margin floor, ETA change history, outbox idempotency, conflict
  resolution, document content, tariff and PVoC rules, dossier guards, account scoping, order-stage
  guards, goods-received variance and LocoNav payload mapping — 78 tests (`npm test`).

## Tariff, conformity and clearance (added 29 October 2026)

- **HS-driven duty.** An HS code resolves to its EAC CET band; an unresolved code stops the quote instead of being guessed. Preferred rate: EAC-origin goods with a valid certificate of origin pay 0%; without the certificate the full band applies, because the preference is claimed by document.
- **PVoC priced properly.** Conformity verification is 0.6% of FOB on route A (0.55% B, 0.35% C), floor USD 265, cap USD 2,700 (KEBS PVoC Manual v12). It is not charged on EAC-origin goods moving under the customs union — the certificate of origin governs there.
- **Waivers are evidence.** Diplomatic, project, EPZ and raw-material exemptions apply only with a reference number and the named supporting letters.
- **Document dossier per consignment.** Commercial invoice, packing list, transport document, insurance, certificate of origin (Chamber of Commerce, or the EAC certificate), PVoC certificate (KEBS agent), phytosanitary certificate (KEPHIS) for plant-product chapters, transit bond, entry and duty receipt. Each document carries its issuer and a missing/attached/verified state; verifying something that was never attached is refused.
- **Clearance systems stated honestly.** Kenya: KRA iCMS, iTax, KenTrade TradeNet — file prepared and pre-validated here, lodged by a licensed agent. Uganda, Tanzania, Rwanda, Burundi, South Sudan and DR Congo are in the registry marked "to confirm" until access is verified with each revenue authority. No filing API is claimed anywhere.
- **Express corridor score.** Green, yellow or red from document verification, duty evidence, PVoC status and trusted-trader standing, with the reasons printed.

## Accounts, orders and last mile (added 29 October 2026)

- **Accounts and roles.** A trading company opens an account with terms (prepayment, net 15, net 30) and a credit limit; users are invited as client administrator, client user, operations, driver or platform administrator. Every read is scoped by account: a client user cannot see another client's records, and an administrator sees everything.
- **Credit control before acceptance.** A prepayment account must fund before dispatch; a credit account is capped. An order over the limit is held with the shortfall stated, not quietly accepted.
- **Order lifecycle.** Draft → confirmed → sourcing → purchased → freight booked → in transit → arrived → received at the Nairobi warehouse → picked → packed → dispatched → delivered. Each stage refuses to open without the data that makes it true: no purchase without supplier, PO and value; no receipt without a goods-received note and counts; no dispatch without a vehicle, a driver and a tracking reference; no delivery without a named signature.
- **Dropship is a different flow, not a different system.** A dropship order skips the warehouse stages entirely and goes from arrival to dispatch.
- **Goods received states variance.** Over, short and damaged are recorded per line and summarised; a short delivery is never rounded into a clean receipt.
- **Two legal entities, one platform.** Quotations, invoices and purchase orders carry Altovex Global Logistics Co. Ltd; tracking, customs files and proofs of delivery carry Altovex CargoLinx. The header is chosen by the document, not by the user.
- **Last mile through LocoNav.** Adapter written against LocoNav's developer documentation (host per region, `User-Authentication` token header, epoch-second time parameters, pagination object). With no token every call reports "not configured" and the desk shows no position rather than a guess. Webhook payloads are normalised defensively, and a fix older than fifteen minutes is labelled stale instead of live.

### Verified against a real run (29 October 2026)

Account opened with net 30 and a KES 1,000,000 limit; a KES 2,400,000 order was **held** ("exceeds credit headroom by 1,400,000"); a KES 600,000 order was accepted; the pipeline was walked stage by stage to delivered, with the guards firing on cue (delivery refused until a signatory was named); dispatch created a last-mile job against vehicle KDG 123A; a GPS payload parsed to a valid fix and was correctly reported as stale at 4,688 minutes old. 78 tests pass.

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
