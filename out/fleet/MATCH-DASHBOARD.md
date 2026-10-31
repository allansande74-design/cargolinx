# MATCH-DASHBOARD — CargoLinx matchmaking portal spec

Status: SPEC (build reads this file; `match` is registered in `src/dashboards/registry.mjs`).
Engine: `src/lib/matchmaking.mjs` (dispatch seam, VEHICLE_TIERS, ORDER_STAGES, canAdvance)
+ `src/lib/roles.mjs` (ROLES, ENTITIES, documentHeader, creditDecision).

## 0. Theme tokens (glassmorphin ultra-luxury over navy/gold, all views)

| Token | Value | Use |
|---|---|---|
| `--navy` | `#071a33` | page base, header bar |
| `--navy-2` | `#0b2547` | gradient stop under navy |
| `--gold` | `#D8A13A` | accents, active borders, KPI numerals |
| `--glass` | `rgba(255,255,255,.08)` | card fill over navy |
| `--glass-border` | `rgba(216,161,58,.35)` | card border |
| `--blur` | `blur(14px)` | card backdrop-filter |
| `--ink` | `#f4f6fa` | primary text on navy |
| `--muted` | `rgba(244,246,250,.65)` | secondary text |
| `--ok` | `#159a8c` | success badges |
| `--hold` | `#c0392b` | refusal / hold badges |

Page: navy gradient background (`linear-gradient(160deg,#071a33,#0b2547)`),
glass cards (`background: var(--glass); backdrop-filter: var(--blur);
border: 1px solid var(--glass-border); border-radius: 14px`),
gold 3px header rule, same `DashboardShell` chrome as other portals
(header `#071a33`, gold `C` badge). No invented fields: every card shows
only keys declared in ORDER_STAGES / VEHICLE_TIERS / GROUP_TEMPLATES.

## 1. Cargo board (demand)

Lists open orders (stage < dispatched) as glass cards: order id, corridor,
weightKg, required tier (from `tierFor`), client type badge
(spot / fleet_owner / broker-5%-cap / institutional), credit state
(`creditDecision`: within-terms vs HELD + shortfall KES).
Sort: held orders sink with the shortfall printed, never hidden.
Action per card: `dispatch(order, fleet)` one call; result renders inline —
assignment (plate + trackingRef) or each refusal (code + sentence).

## 2. Vehicle board (supply)

Lists registered fleet as glass cards: plate, tier badge, capacityKg,
status (available / booked + orderId). Transporter WhatsApp posts
(`GROUP_TEMPLATES.transporters` parseTo: contact, capacity, emptyLocation,
wantedLane, rateAsk) land here as unregistered capacity with an
"onboard → verify → approve" lane; unverified supply is shown, never matched.
Filter: tier chips (motorbike → truck); a chip shows the floor
(0 / 300 / 1000 / 2500 / 8000 kg).

## 3. Match view (the seam)

Runs `dispatch(order, fleet)` and shows: chosen vehicle (smallest at/above),
rejected candidates with per-vehicle blockers (tier too low / capacity short /
booked / unverified), and the refusal list when `ok: false`
(overweight / no_vehicle / over_credit / no_weight — code + sentence each).
Broker jobs show the 5% cap line (`brokerFee(tripCost)` from onboarding.mjs);
a quoted fee above cap blocks match with the cap figure printed.

## 4. Trip view (execution)

The won assignment: order → vehicle → legs → trackingRef (`CLX-…`),
driver name, stage stepper derived from ORDER_STAGES (draft → delivered,
dropship skips received/picked/packed). Each step shows its evidence keys
from the table (`requires`), so the operator fills what the guard checks —
no renamed fields, no dead-ends. Dispatch step requires vehicleId,
driverName, trackingRef (named, not "proof object").

## 5. Evidence view (proof)

Per-stage evidence ledger: what was produced at each transition
(confirmedAt, poRef, transportRef, grnRef, trackingRef, pod.signedBy).
Delivery requires `signedBy` (name + time; photo optional supporting).
Letterhead per `documentHeader`: invoice/PO under
ALTOVEX GLOBAL LOGISTICS CO. LTD, tracking/PoD/customs under
ALTOVEX CARGOLINX. Refusals log: every `ok:false` with code + sentence,
kept per order for the retry trail.

## 6. Build order (implements §1–5 against the same table the engine uses)

1. `src/dashboards/match.jsx` — shell + theme tokens + five views above.
2. Wire `dispatch`, `canAdvance`, `creditDecision`, `brokerFee` live;
   no mock positions, no plausible values when the board is empty
   (empty fleet → "no vehicles registered", not a grey map pin).
3. Gap register on delivery: identity, tenancy enforcement, invoicing,
   inventory allocation, sourcing depth, last mile, notifications,
   document verification — in money-blocking order.
