## Live and demo

- **Live desk:** https://allansande74-design.github.io/cargolinx/
- **Demo film, the submission cut:** `demos/cargolinx-demo-entry-153s.mp4` (2 min 33.8 s, inside the 3-minute cap)
- **Commit window:** 27 October to 4 November 2026, full log in `git log --since=2026-10-27`

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
  **3,321,144.22** incl VAT; floor price (15%) 2,357,810.29. This run uses a code that is not a
  regulated category, so no conformity fee applies. A regulated code (for example HS 8544.42)
  adds the PVoC fee — KES 34,404.95 at the schedule minimum for that consignment — and the
  command below reproduces it.
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

## Sourcing and dropship plugins (added 29 October 2026)

Studied from the platforms' own documentation:

- **Alibaba.com Dropshipping** is an ISV programme, not a public API. A buyer account is registered at openapi.alibaba.com outside mainland China, an application is created in the App Console with category `ISV-Dropshipping` to obtain an AppKey and AppSecret, API permission groups are requested explicitly, buyers authorise through OAuth 2.0 code-for-token (`/auth/token/create`, `/auth/token/refresh`), products and seller warehouses are listed with freight estimates, BuyNow orders are created and the payment result is polled, and events arrive as HMAC-SHA256 signed webhooks that must be de-duplicated.
- **AliExpress Dropshipping Center** pairs with the AE-Dropshipper API family (offer lookup, order detail, freight calculation) behind the same AppKey/AppSecret plus a seller-authorised token.
- **Accio** is Alibaba International's AI sourcing engine, since extended into an agentic business platform. Its value is a structured brief and a shortlist — not a price.

Built as plugins with a declared contract (`engine/plugins.mjs`): a plugin cannot report ready without the credentials its capabilities require, an undeclared capability is refused, and a dry run prints the exact request that would be sent rather than a fabricated catalogue. `engine/sourcing.mjs` turns a plain-language request into a brief, selects the price tier for the quantity and states a below-MOQ shortfall, lands the cost per unit, scores and ranks offers on quantity, budget, lead time, certificates and whether they ship here, runs the stock-versus-dropship arithmetic, and drafts an RFQ.

Verified in the browser: "500 pcs solar panels under 120 usd to Kenya, HS 8541.43" parsed to product, quantity, budget, destination and HS hint; two offers ranked (shortlist 100, consider 51 with below-MOQ and budget reasons); the dropship-versus-stock arithmetic recommended holding stock at 23.02 against 40.80 per unit with KES 2.99M tied up over four months of cover; the Alibaba plugin's dry run reported `POST openapi.alibaba.com`, signed HMAC-SHA256, credentials present false. 101 tests pass.

**Not modelled:** any de-minimis duty or VAT threshold for small parcels. No threshold is applied because none is verified for these lanes, and a wrong threshold silently misprices every parcel.

## Money and stock (added 29 October 2026)

- **Invoicing from posted cost.** A tax invoice cannot be issued before dispatch; a proforma can. The invoice is built from the order's recorded line values, never from the quotation that opened it, and a line with no posted value stops the invoice instead of invoicing zero. Charges that were actually incurred are added as their own lines.
- **Honest gaps are printed on the document.** An invoice raised before the proof of delivery is on file says so, in the document itself.
- **Payments.** Part payment and settlement move the status, overpayment is refused rather than absorbed, and every payment keeps its method and reference.
- **Ageing by the buckets a credit controller works** — current, 1–30, 31–60, 60+ — and credit exposure is computed from unpaid balances, which is the figure the credit gate consumes, not the order value.
- **Invoice numbering** runs sequentially inside a month, and a bank statement can be reconciled against the ledger by amount and reference, with the unmatched lines named.
- **Stock is a promise only when it has a bin and a lot.** Receiving requires a bin; position separates on hand, allocated, expired and available; allocation is first-expiry-first-out, skips expired lots and states why, and reports a shortfall instead of silently part-filling.
- **The pick list is ordered by bin** so a picker walks the aisle once, and a delivery note and packing list print from the same allocation — the delivery note carrying the platform's name, the invoice carrying the seller's.

Verified in the browser: invoice INV-2610-0001 raised for 600,000 plus 96,000 VAT with "proof of delivery not yet on file" printed on it; a 300,000 M-PESA payment left 396,000 part paid and moved the ageing bucket; 60 units received into bin NBO-01-01-01 under lot L-2026-11; 50 allocated to the order, producing pick line 1 at that bin, leaving 10 on hand, 50 allocated and zero available, with the statement "No available stock of SP450 at the Nairobi warehouse". 121 tests pass.

## Messages, suppliers and stock control (added 29 October 2026)

- **Nothing is sent without a person.** Every customer message is queued as pending, approved by a named approver, and only then eligible for a send run; quiet hours are checked at send time, not at queue time, so a message queued at eight in the evening does not slip out at eleven.
- **A message cannot invent a fact.** Templates carry no defaults: if the order cannot supply the driver name or the tracking reference, the message refuses to render and names the field. That is visible in the screen, not buried in a log.
- **Channels have hard limits.** SMS is 160 characters, WhatsApp 1,024, email 2,000, in-app 500; exceeding the limit is refused rather than silently truncated, because a truncated tracking reference is a wrong one. Recipients are masked once recorded.
- **A supplier is unverified until someone names a document.** Verification without a reference is refused. A purchase order cannot be raised against an unverified supplier, a line without a price stops the order, and the order carries no VAT line — tax belongs on the supplier's invoice.
- **Suppliers are scored on facts we hold:** verification, certification, lead time, whether we have an email, and whether the terms are better than prepayment. The score is shown with its reasons, not as a single magic number.
- **Stock is counted, not assumed.** A count records variance as match, over or short; applying it moves stock and writes an audit entry; replaying the same count is refused. Write-offs need a reason from a fixed list and cannot exceed what remains. Shrinkage is reported by reason and value, with the largest single loss named.

Verified in the browser on the live build: a delivery message queued, approved and sent with the recipient masked as +254\*\*\*\*1222; a supplier refused verification with no reference and accepted with a KRA PIN, scoring 75; a purchase order printed for 170,000 with no VAT line; 40 units received, a count of 36 recorded as short by 4, two damaged units written off, and the stock position and the shrinkage report agreeing at 27 units and 156,000 lost.

## Not yet verified

- The Meta model calls (photo counting, transcription, lane matching, explanation) run
  direct-first against api.meta.ai (verified live 31 Oct 2026; receipts in
  swarm/hackathon/evidence/meta_tool_runs.jsonl). Where the direct line fails the UI
  reports the labelled fallback and the app keeps running on the deterministic engine.
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

MIT License — see `LICENSE` (© 2026 Allan Sande, Altovex Global Logistics). The entry can be judged, forked and reused,
including commercially, provided the notice and attribution are kept.

## Submission readiness checklist (added 29 October 2026)

Each box is a fact checked against this working tree by `tests/submission.test.mjs`, not a claim
carried over from the prose above.

What is verified:

- [x] Every file this README names exists on disk — the engine modules under `engine/` (more than
      eight of them), the library modules under `src/lib/`, and the application component — counted
      from the tree rather than taken from the prose above.
- [x] `npm test` invokes `node --test`, and `npm run build` invokes `vite build`.
- [x] `.gitignore` excludes `node_modules/` and `dist/`, so neither build output nor installed
      dependencies reach the repository.
- [x] A licence is in the tree — MIT in `LICENSE` (© 2026 Allan Sande, Altovex Global Logistics), named in the Licence section above.
- [x] `docs/CONTRIBUTION.md` records what was built, what is measured, and what is explicitly not
      claimed.
- [x] The Meta model layer is live direct: muse-spark-1.3 and muse-wonder-1.0 answer on
      api.meta.ai (verified 31 Oct 2026; chat 1716 ms, doc extract 9376 ms; receipts in
      swarm/hackathon/evidence/meta_tool_runs.jsonl). Photo counting, transcription, lane
      matching and explanation run direct-first with labelled fallback.

What is still missing before this can be submitted:

- [x] A public repository URL — https://github.com/allansande74-design/cargolinx (verified HTTP 200).
- [ ] A deployed submission URL — build in progress; judges open the live URL from the status report.
- [x] A Meta model key — live 31 Oct 2026; real calls receipted in swarm/hackathon/evidence/meta_tool_runs.jsonl.

## Network scale-up: 26 countries, bloc corridors, fleet tiers

The platform stopped being an East African matchmaker on 29 October 2026. It now carries a
twenty-six country registry spanning the East African Community, COMESA and SADC, a multi-leg
international corridor planner that starts at a factory gate in Asia and ends at a partner warehouse
inland, a vehicle matcher that reaches from a 34-tonne trailer combination down to a motorbike and a
reserved cargo-drone tier, partner onboarding with document compliance, and a tracking engine that
recovers from out-of-order carrier feeds instead of losing them.

What is real and measured:

- **26 countries** in `engine/network.mjs`: 7 EAC, 21 COMESA, 13 SADC. A country can be a member of
  more than one bloc, and `membershipOf(code)` says which.
- **1 of 26 quotable.** Kenya carries a verified dataset with its sources; the other 25 are `draft`
  and the quote gate refuses them with a reason naming what must be confirmed. There is no duty
  rate, VAT rate or fee invented for any of those 25 — a test fails if a currency figure or a
  percentage appears in their citations.
- **Corridor plans are multi-leg** and honest about what they are: sea, inland and last-mile legs
  with hours, customs stops and an `indicative` confidence, and an explicit statement that no
  carrier booking, slot, equipment or rate is confirmed by a plan.
- **Delay replanning moves downstream legs.** Adding 24 or 72 hours to a leg shifts the arrival and
  the following legs rather than quietly keeping the original promise.
- **Vehicle matching is capacity-honest.** A 900 kg parcel on a Nairobi lane resolves to a pickup,
  not a truck; 20 tonnes on the Northern Corridor resolves to a heavy truck at 71% of payload.
- **Partners cannot be born trusted.** An owner registers as pending, each document is verified
  against a reference and an expiry date, and approval needs a named approver and a reference.
  Eligibility then refuses with specific blockers: an expired insurance, a vehicle smaller than the
  load, a lane the owner is not registered for.
- **A vehicle cannot be booked twice.** An overlapping window on the same plate is refused, naming
  the order that already holds it.
- **Tracking self-heals.** `departed` arriving before `gate_in` is held, not dropped, and released
  automatically once the gap fills — the screen shows the release. Lateness escalates from on time
  to at risk to late by elapsed hours against the expected arrival.

What is still refused, deliberately:

- 25 country datasets, until a human enters a sourced tariff dataset per country. A wrong duty
  figure on one container costs more than every other mistake in this system combined.
- Any cost that would be presented as a carrier rate. Freight figures are a planning model built on
  stated assumptions, and the engine says so where it prints them.
- Drone delivery: the vehicle tier exists and is marked `future`. The last 100 km by air is a
  regulatory question before it is an engineering one.

## Dispatch: one thread from order to moving vehicle (added 29 October 2026)

`engine/dispatch.mjs` joins the pieces an operator used to carry by hand: order stage, vehicle class,
partner papers, booking window and tracking.

```js
import { dispatchOrder, dispatchSummary } from "./engine/dispatch.mjs";

const result = dispatchOrder(order, {
  partners,            // records from the partner register
  weightKg: 12000,
  lane: "northern",     // partner lane key, not a fleet road class
  driverName: "Peter Mwangi",
  distanceKm: 480,      // optional; without it no estimate is attached
  at: "2026-11-06T08:00:00Z",
});

if (!result.ok) return result.refusals;   // code + sentence, plus per-candidate blockers
```

It refuses to skip a stage, chooses the smallest eligible vehicle rather than the first one, books the
plate before dispatching so two orders cannot take the same truck, and opens the track on the same legs
the promise was made against. Every refusal is data, never an exception.

Two vocabulary fixes came with it: the partner register now carries `trailer`, `medium_truck` and
`drone_last100` alongside its original classes, and `rigid_truck → medium_truck` is bridged for
matching, because a registered 12 t truck had been silently ineligible for a 9 t load.

In the app: the Network tab's **Dispatch** panel. Tests: `tests/dispatch.test.mjs` (11 cases). Full SOP:
`docs/DISPATCH.md`.
