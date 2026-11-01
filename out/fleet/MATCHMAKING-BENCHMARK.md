# Cargo↔Vehicle Matchmaking Benchmark

**Date:** 2026-10-31 · **Lane:** benchmark · **Repo:** cargolinx-v2 (master @ cff1958)
**Platforms benchmarked:** Uber Freight, Convoy (→ DAT Convoy Platform), Lori Systems, Kobo360, Transfix (→ SaaS TMS), sennder.

> Sources: vendor help/docs pages, TechCrunch/GSMA/CIO reporting, Sacra, FreightWaves/Overdrive, Valhalla/OSRM docs. All figures are reported claims, not independently verified.

## 1. Feature matrix

| Feature | Uber Freight (US/EU broker) | Convoy → DAT Platform (US) | Lori Systems (EA/Nigeria) | Kobo360 (West/East Africa) | Transfix → SaaS TMS (US) | sennder (EU FTL) | CargoLinx v2 (today) |
|---|---|---|---|---|---|---|---|
| **Matching algorithm** | Preference-learning push: learns lanes/home-base/haul from history, pushes best-fit loads to driver app | Automated auction: shipper price estimate → carrier-side auction, lowest accept wins; 100% auto-match in top markets claimed (pre-shutdown) | AI match cargo↔trucks; price discovery + backhaul focus (40%+ empty-rate problem) | Big-data analytics on pickup/drop-off; lane matching + inefficiency detection | ML pricing + auto-matching (brokerage era) → now sold as TMS SaaS w/ NFI as anchor | Network optimisation: next-load suggestion, tour bundling, "tour back home" empty-km minimiser | **Legacy to recover:** rule+score match (haversine reposition+haul, cost model, 20% min-margin gate, score = 0.6·margin − 0.4·km/10k, strict truck-type match, compliance filter). Currently only WhatsApp parse templates in v2. |
| **Map-matching precision claim** | GPS load tracking in carrier app; no public precision figure | Real-time GPS tracking + POD docs in app; no public precision figure | GPS tracking + accountability updates; no public precision figure | GPS tracking + analytics; no public precision figure | GPS tracking (brokerage era); no public precision figure | GPS-based visibility + dynamic ETA (partner-dependent) | **Plan (FLEET-MAPMATCH):** Traccar + Leaflet/OSM + OSRM fork-first, Valhalla alternative. OSRM/Valhalla are the proven OSS map-matchers (Valhalla ~95% trace success in 1.2M-trace study). None of the six vendors publishes a precision % — parity is achievable. |
| **Vehicle tiers** | Class-8 tractor-trailer; box/reefer/flatbed equipment types. No small tiers. | Owner-operator + small-fleet tractor-trailers (~30k carriers). No small tiers. | Trucks via transport companies (FTL focus, enterprise). | 10k+ truckers, FTL focus; local-language app (Hausa, Pidgin). | Truckload only. | FTL only, 250k vehicles / 40k carriers. | **Edge:** must span truck → van → pickup → tuk-tuk → bike (WhatsApp flow already tiers by weight; formalise tiers in matching). None of the six covers sub-truck tiers. |
| **Onboarding flow** | Self-serve: DOT/MC, safety rating, insurance proof, equipment type, ACH details → contract → add drivers | App self-serve + automated carrier vetting (DAT now sells vetting as the safety story) | Verified transport companies; invoicing + fuel financing as hook | Local-language app, driver training on mobile tech; KoPay/KoboSAFE/KoboCARE as retention | Broker-era carrier onboarding → now TMS seat sales | Free freight exchange self-serve; contract lanes for committed volume | **Edge:** WhatsApp paste-format cards (TRUCK AVAILABLE / MOVE MY GOODS) = zero-app onboarding. Formalise into: phone-number identity → plate + docs (insurance/inspection/driver licence, expiry-tracked per legacy engine) → tier assignment. |
| **Broker commission / take rate** | Spread on auction + 2.5% QuickPay fee; 2% paper-check fee; std 30-day pay, 2-day for fee/Top-Carrier, same-day via Carrier Card ($3.5k spend/truck/mo) | Low take-rate flywheel (failed: compromised margins for enterprise volume → shutdown Oct 2023, $3.8B→$12M Flexport→$250M DAT Jul 2025) | Marketplace spread; Moove partnership for vehicle loans | Spread + embedded finance (KoPay ≤$5k/mo working capital; first bank attempt failed — had to self-insure driver misconduct first) | Brokerage sold to NFI Jun 2024; now per-seat SaaS (no cycle exposure — the model lesson) | Direct shipper↔carrier (no middleman spread claimed); contract + spot mix | **Edge:** 5% broker cap (BROKER_RULES, committed) — lower and explicit vs all six. Keep + enforce in matching (legacy min-margin gate is the mechanism). |
| **Tracking** | In-app GPS tracking, facility ratings, document mgmt | GPS tracking, docs, QuickPay in one app | Shipment updates + tracking, accountability layer | Pickup/drop-off analytics, real-time tracking | TMS tracking module | Real-time visibility, journey visualisation, ETA, CO₂ reporting | **Plan:** Traccar (Teltonika FMB) + forward-to-Supabase pattern proven in legacy zip (docker-compose + traccar.xml present). Rebuild as fork-first service. |
| **Payments** | ACH 30-day std; 2-day @2.5%; same-day Carrier Card; factoring supported | QuickPay (now inside DAT) | Invoicing + fuel financing; Moove credit scoring on platform data | KoPay working capital, KoboSAFE insurance, discounted fuel, HMO, tuition | Billing inside TMS | Invoicing ops; freight-audit depth unverified | **Edge:** M-Pesa/Airtel/T-Kash rails per COUNTRIES pack (8 countries) — none of the six does mobile-money-native settlement. Gap: no carrier wallet / advance product yet (see gaps). |
| **Offline / low-connectivity** | None found (smartphone-app only) | None found | None found (app-based) | Local-language + driver training, but still app-based | None found | None found | **Edge:** WhatsApp-first + offline-first PWA already in repo; USSD/SMS fallback is the open gap. |

## 2. Per-feature winner

| Feature | Winner | Why |
|---|---|---|
| Matching algorithm | Convoy-platform (DAT) | Only one with a published automation claim (100% auto-match top markets) + auction price discovery |
| Map-matching precision | NO WINNER | Nobody publishes a figure; OSS OSRM/Valhalla is the credible parity path |
| Vehicle tiers | CargoLinx (by intent) | Only platform scoping below truck; all six are FTL-only |
| Onboarding | Kobo360 (execution) / CargoLinx (lowest friction) | Kobo proved local-language + training at 10k-driver scale; WhatsApp cards beat any app install |
| Commission | CargoLinx (5% explicit cap) | Lowest stated take; Convoy is the cautionary tale on unsustainable take |
| Tracking | sennder (visibility+ETA+CO₂) / Uber Freight (facility ratings) | Richest shipper-side + the only two-sided rating loop worth copying |
| Payments/finance | Kobo360 (KoPay+SAFE+CARE stack) | Only full driver-financial stack; Uber's speed-ladder (30d→2d→same-day) is the mechanism to copy onto M-Pesa rails |
| Offline | CargoLinx (PWA + WhatsApp) | Only player with an offline story at all |

## 3. Gap list for CargoLinx (ordered by hackathon impact)

1. **Match engine not in v2 runtime** — legacy `match-engine/index.ts` (margin gate + score + compliance filter) exists only in the C: zip, not in cargolinx-v2. Re-implement as `src/lib/match.mjs` (pure) + bridge endpoint. *Highest value, ~1 day.*
2. **No carrier advance / quick-pay** — every African competitor wins retention on fuel/working-capital advance; Uber ladders pay speed. CargoLinx has mobile-money rails but no advance product. *Design: M-Pesa advance against accepted job, capped % of job value, recovered on POD.*
3. **No two-sided ratings** — Transfix/Uber proved ratings drive behaviour (detention pricing, priority matching). CargoLinx has no rating field anywhere. *Cheap: shipper↔carrier 1–5 + tags at POD.*
4. **Tracking is plan-only** — Traccar pattern proven in legacy (compose + forward config present) but nothing in v2. *Fork-first rebuild per FLEET-MAPMATCH-PLAN.*
5. **No formal vehicle tiers** — WhatsApp flow implies tiers; matching needs explicit tier table (bike/tuk-tuk/pickup/van/truck + capacity floors) feeding the dispatch seam (smallest registered vehicle ≥ weight).
6. **No USSD/SMS fallback** — all six competitors are app-only (our opening), but our offline claim needs at least an SMS job-alert path to be real for feature-phone drivers.
7. **No shipper analytics / visibility dashboard** — sennder-grade ETA + lane analytics is what closes institutional clients (oil & gas haulage-type). Post-hackathon.
8. **Business-model lesson (Convoy/Transfix)** — pure transaction-spread brokerage died twice (Convoy shutdown 2023; Transfix sold brokerage to NFI Jun 2024, now SaaS). CargoLinx's 5% cap + contract institutional lanes + future SaaS desk tools is the right shape; do NOT chase volume at negative margin for the demo.

## 4. Local/teleport/Vercel findings (honest report)

- **SSH to laptop C: WORKED** (key auth, no password needed): `ssh 25479@100.82.70.110`, C: root listed.
- **D: drive: ABSENT** — `dir D:\` → "system cannot find the path specified". Only C: exists (Get-PSDrive shows C: only).
- **Drive G (Google Drive): not mounted** on laptop; no G: drive. Instead found `C:\gdrive-export\` — 14 zips from a prior export. Two are CargoLinx: `Altovexcargolinx__altovex-cargolinx.zip` (485 KB) and `AMANDATEAM__Altovexcargolinx__altovex-cargolinx.zip` (159 KB).
- **Legacy gold inside `Altovexcargolinx__altovex-cargolinx.zip`** (read-only listing + targeted extraction, no modification): Supabase match-engine (haversine + cost model + 20% margin gate + score + compliance/expiry filter + warnings), Traccar telematics stack (docker-compose + traccar.xml forward pattern), RBAC migrations, `.vercel/project.json` (`prj_6lf7dL3VGTUIaz8ypnYT28ahLAZm`, project `altovex-cargolinx`), ROADMAP.md, TECH_STACK.md. **No matchmaking work beyond this zip; second zip not introspected (smaller, likely subset).**
- **vercel.json in cargolinx-v2: NONE.** No `.vercel/` dir, no vercel.json, no Vercel refs in package.json/docs. Deploy target per wrangler.jsonc is Cloudflare (`cargolinx-preview`). The old Vercel project (`altovex-cargolinx`) belongs to the legacy zip, not this repo — Vercel deployment state for v2 does not exist.
