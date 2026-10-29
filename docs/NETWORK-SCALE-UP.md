# Network scale-up: 26 countries, three blocs, every vehicle tier

Operating standard for extending CargoLinx from East African matchmaking to continental coverage.
Written 29 October 2026. Every number here is either cited, marked *target*, or marked
*estimated* — nothing is presented as measured that has not been measured.

## 1. Scope

- **Geography.** 26 countries across EAC, COMESA and SADC, with the corridor logic to reach them
  through a sea gate plus inland legs.
- **Sourcing.** Altovex Global Logistics as the sourcing arm: factory gate in China (or India,
  Türkiye, UAE) to our Nairobi warehouse or a partner warehouse in-country.
- **Legs.** International (sea, air), port dwell and clearance, line-haul, city-to-city, urban
  distribution, last mile, and a reserved tier for the last 100 km by drone.
- **Vehicle tiers.** Trailer, heavy, medium, light truck, pickup, van, motorbike, and future drone —
  each matched to a corridor class, not to a guess.
- **Parties.** Transport owners onboard themselves with documents; a dispatcher sees eligibility and
  blockers before assigning.

## 2. The rule that governs everything: a rate we cannot cite is not a rate

Twenty-six countries do not mean twenty-six guessed duty tables. Coverage is a **two-state** model:

- `verified` — a tariff and tax dataset is on file with its sources, effective date and a content
  fingerprint. Kenya is the only country in that state today, citing PwC Worldwide Tax Summaries
  (reviewed 17 July 2026) and the EAC CET 2022 bands.
- `draft` — the country is in the network, corridors and partners work, but **quoting is refused**.
  The refusal names the country and says plainly: no verified dataset on file, duty cannot be
  computed, this is not a zero rate.

This is deliberate and it is the difference between a platform and a calculator with opinions. A
wrong duty figure on a 40-foot container is a five-figure loss and a customs penalty; a refusal costs
a phone call.

**What unlocks a country** — one dataset per country: CET or national tariff applied at HS heading
level, import VAT, the specific levies (IDF/RDL-type, ECOWAS levy, excise), the preferential
agreement text that can reduce the rate, the customs system and whether an agent API exists, and the
insurance minimum. Each is entered with its source URL and effective date, then fingerprinted.

## 3. Stack, open source first, free first

| Layer | Today (free) | Scale trigger | Paid step (indicative) |
|---|---|---|---|
| Web app | Static PWA on Cloudflare Workers free tier | >100k requests/day | Workers paid, ~USD 5/month |
| Data | Supabase free (Postgres 500 MB) | >400 MB or >50 connections | Supabase Pro USD 25/month |
| Geo | PostGIS inside the same Postgres | >1M position rows | Managed Postgres with PostGIS |
| Queue / outbox | Postgres outbox table + `SKIP LOCKED` | >200 events/s sustained | NATS JetStream or Redis Streams (free, self-hosted) |
| Tracking ingest | Same outbox, batched | >1k events/s | NATS cluster, 3 nodes |
| Search / matching | Postgres indexes | >50k vehicles | Postgres + `pg_trgm`, then Meilisearch |
| Identity | Supabase auth + row-level security | Multi-tenant SSO need | Keycloak (free, self-hosted) |
| Observability | OpenTelemetry SDK + Grafana Cloud free | >10k series | Self-hosted Prometheus + Loki |
| Maps / routing | OSRM self-hosted, OSM data | >1M route calls/month | Managed routing, ~USD 50/month |
| SMS | None connected | First client | Africa's Talking, ~KES 1 per SMS |

Nothing in the paid column is needed to run the pilot. The triggers are stated so the move is a
decision, not a surprise.

## 4. Resilience and self-healing

The design rule: **the platform must survive its own worst day without a human at 3 a.m.**

- **Idempotency everywhere.** Every write carries a client-generated id; a replayed event is refused
  by name rather than duplicated. Proven in the tracking module: re-applying an event id is refused.
- **Out-of-order tolerance.** A tracking event that arrives before its predecessor is held, not
  discarded, and released automatically once the gap fills. This is what happens when a driver's
  phone reconnects after a dead zone.
- **Monotonic guards.** A milestone cannot move backwards; the refusal names both milestones.
- **Outbox pattern.** Business writes and the events they emit commit together, so a lost network
  call cannot lose an event or invent one.
- **Stall detection.** Every leg has a schedule; a leg 12 hours behind is `watch`, 36 hours is
  `late`, 72 hours is `critical`, and a recorded exception (customs hold, breakdown) pauses
  escalation so the dashboard does not cry wolf.
- **Retry with backoff and a dead-letter path.** Nothing retries forever; a message that fails five
  times lands in a queue a human can see.
- **Backups.** Postgres point-in-time recovery, plus a nightly logical dump stored off the primary
  host. A restore is tested, not assumed — a backup that has never been restored is a hope.
- **Tenant isolation at the database, not the app.** Row-level security policies per account, so a
  bug in a view cannot leak another client's invoices.
- **Self-healing has a limit.** The system recovers data, order and schedule; it does not recover a
  truck. What it does is tell a human, early, with the leg and the hours late.

## 5. Benchmarks, named

We benchmark against the best operator in each lane, on a metric that can be measured here.

| Comparator | What they set the bar on | Our target | How measured |
|---|---|---|---|
| Lori Systems (Kenya/East Africa) | Instant rate estimate, managed FTL, 20,000+ trucks, 29% backhaul | Quote in under 3 seconds with itemised duty | Timing script on the quote path |
| Kobo360 (Nigeria/West Africa) | Driver app literacy, pan-African corridors | Onboarding in under 10 minutes on a phone | Timed walkthrough, one hand |
| Sendy (Kenya) | Last-mile and FMCG distribution | Vehicle matched to cargo tier, never oversized | Unit test: 900 kg must select a pickup |
| Flexport (global forwarder) | Document status visible at every stage, no black box | Every shipment has a stated next milestone and a date | Data completeness check per shipment |
| Maersk / carrier schedules | Schedule reliability published, not implied | ETA carries a basis and a confidence label | Field required on every plan |

Targets are targets. The measured column is filled in as each is run, and a target is never reported
as a result.

## 6. Scale path and what breaks first

1. **Single VPS (now).** One node, 4 GB. Breaks at roughly 200 concurrent users or 50 writes/second.
2. **Split the database.** Managed Postgres with PostGIS, app stays stateless. Breaks when tracking
   ingest exceeds what one database can absorb.
3. **Queue the ingest.** NATS or Redis Streams in front of the write path, batched commits.
4. **Read replicas and a CDN.** Reporting and dashboards move to replicas; the app is entirely
   static and already cacheable.
5. **Multi-region.** Only when latency from West Africa justifies it; until then the cost is real
   and the benefit is not.

## 7. What must be supplied before a country goes live

Per country: tariff and tax dataset with sources; the customs system and whether agent access
exists; the certificate-of-origin authority; the conformity authority; the insurance minimum; one
licensed clearing agent; one verified transport partner per corridor class.

Per partner: insurance, inspection, vehicle licence, driver licence, operating permit — each with a
reference, an expiry date and a named verifier.

## 8. Honest position on the revenue systems

No African revenue authority gives a third party a self-service filing API without an agent licence
and a bilateral arrangement. The platform prepares, pre-validates and hands over a file in the shape
the agent keys in, and records who did what. Claiming direct filing would be a lie that a customs
officer discovers at the counter.
