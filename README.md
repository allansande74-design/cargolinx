- The export corridor runs all the way to China: the reversed road to Mombasa, then the sea leg, with the
  distance computed from the two ports coordinates and the Chinese duty named as not held.
- Export runs the same lanes backwards: the lane table is reversed rather than retyped, and the quote stops at
  the destination port with the destination's duty printed as missing rather than guessed. See `docs/EXPORT.md`.
- [x] A licence is in the tree — MIT in `LICENSE` (© 2026 Allan Sande, Altovex Global Logistics), named in the Licence section above.
- A photograph of the load becomes a *condition note* a claims clerk can file: what is visible and where, with cause, names and money refused by instruction. 
- [x] `docs/ROUTING.md` answers the question the matcher does not: in what order a vehicle visits its stops. Exact under nine stops, Clarke–Wright with 2-opt and or-opt above that — measured at 6.8% shorter than an unaided order at six stops and 14.7% at forty, with a 0.00% gap to the provable optimum wherever the optimum is knowable.
- [x] `docs/OPERATIONS.md` is the page you read at 2 a.m.: how to tell the desk is up (`/api/health`), where faults land (`/api/errors` and `wrangler tail`), how to deploy and roll back, how to rotate the Meta key, and — written down rather than hidden — the five gaps that remain.
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
