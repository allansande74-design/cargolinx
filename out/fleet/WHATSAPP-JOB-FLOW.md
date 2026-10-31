# WhatsApp-to-Job Engine — Altovex Pipeline (Lane B)

How Mr. Allan's three live WhatsApp group types feed jobs into the CargoLinx
digital ecosystem. Source of truth for paste formats; parser maps in
`src/lib/onboarding.mjs` (`GROUP_TEMPLATES`).

## 1. Group → job map

| # | Group | Members | Feeds | Lands as |
|---|-------|---------|-------|----------|
| 1 | Transporters / truck owners | Drivers, fleet owners | Available capacity | Fleet supply board → lane matching |
| 2 | Clients (transport + cross-border clearing + tax execution) | Shippers, traders | Load / clearing / tax requests | Job intake → quote → execute → follow-up |
| 3 | Clearing agents | Licensed agents | Border capability + live clearance jobs | Execution lane (docs + border ETA) |

Flow per message: **member pastes in-format reply → desk parses to job fields
→ quote (engine) → broker-cap check (5%) → execute → follow-up/after-sales.**
Voice notes in any group go through voice-clerk → note-structurer
(`src/lib/agents.mjs`: job-intake).

## 2. Paste-format templates (pin one per group)

### 🚛 Transporters / truck owners
```
🚛 TRUCK AVAILABLE
Name: <driver/owner name>
Phone: <07xx xxx xxx>
Truck: <e.g. 28T flatbed / lowloader / tanker>
Plate: <plate no>
Empty at: <town, date>
Wants: <destination / corridor>
Rate ask: <amount + currency, or OPEN>
```

### 📦 Clients (transport + clearing + tax)
```
📦 MOVE MY GOODS
Name: <name>
Phone: <07xx xxx xxx>
From: <town, country>
To: <town, country>
Goods: <what + packaging>
Weight/Qty: <e.g. 15T / 40ft / 200 cartons>
Date needed: <date>
Need clearing? YES/NO — Border: <e.g. Malaba>
Need tax filing? YES/NO — PIN/TIN: <yes/no>
```

### 🛃 Clearing agents
```
🛃 CLEARING JOB / AGENT
Agent: <name + licence no>
Phone: <07xx xxx xxx>
Border: <e.g. Malaba / Busia / Namanga>
Job: <e.g. clear 1×40ft ex Mombasa, docs ready>
Docs: <CIF / IDF / CoO / KEBS — READY or MISSING:…>
ETA border: <date>
```

## 3. Broker onboarding pack (outline)

1. Who this is for — commission agents bringing loads or trucks (inbound or outbound).
2. **Commercial rule: fee capped at 5% of total trip cost, either direction.**
   Formula: `fee_max = tripCost × 5 / 100`.
3. Worked KES example: trip cost **KES 480,000** → max broker fee
   **480,000 × 5 / 100 = KES 24,000**. Any quote above KES 24,000 on that
   trip is rejected by the desk (`brokerFeeWithinCap` returns false).
4. Payout trigger — proof of delivery + client payment; settled via M-Pesa/bank.
5. Code of conduct — no double-brokering without disclosure; real plates, real docs.
6. Offboarding — dormant 90 days → re-verify before next job.

## 4. Fleet-owner onboarding checklist

- [ ] Owner + contact (name, phone, WhatsApp), company / sole trader
- [ ] Fleet list: truck type, plate, capacity, year, insurance + inspection validity
- [ ] Driver roster + licences + contact per truck
- [ ] Tracking: Traccar-compatible GPS per truck (see fleet map-match plan)
- [ ] Rate card per corridor (or OPEN to spot-quote)
- [ ] Settlement account (M-Pesa till/paybill or bank)
- [ ] Signed fleet-owner contract (contract lane, not the 5% broker lane)

## 5. Institutional / contract client lane (e.g. Uganda oil & gas haulage-type)

1. NDA + framework haulage contract (volume, lanes, SLA, penalties).
2. Dedicated account + monthly consolidated billing (mini-ERP + DreamTeQ Titanium ERP).
3. Assigned trucks + backup capacity commitment.
4. Clearing + tax execution bundled per cross-border leg.
5. Monthly review: OTIF, claims, rate adjustment.

## 6. Closed-loop sales tie-in

pitch → lead-gen → engage → close → execute → follow-up → after-sales →
account → growth. Every WhatsApp-sourced job carries its source group +
client type (`spot` / `fleet_owner` / `broker` / `institutional`) so the
mini-ERP can report conversion per group.
