# Dispatch — order to moving vehicle in one record

Status: implemented, tested (308 automated tests green), exercised in a browser.
Owner: Amanda. Human approval point: any spend, any message to a counterparty, any deployment under a
user-owned account.

## Why this exists

The platform already held five honest pieces: an order lifecycle, a corridor planner, a vehicle
matcher, a partner register with document checks, and self-healing tracking. An operator still had to
carry the facts between them by hand — read the weight off the order, guess a truck, ring the owner,
write the reference down, then open tracking separately. Every hand-off was a place for the promise
to drift from the record.

`engine/dispatch.mjs` is that hand-off in code: one pure function, `dispatchOrder(order, options)`,
which either produces a complete dispatch or a list of reasons it refused.

## What one call does

1. **Refuses to skip a stage.** A warehouse order dispatches from `picked` or `packed`. A dropship
   file dispatches from `arrived` or `in_transit` — it never routes through the Nairobi warehouse.
2. **Matches a class, not a truck.** The load's weight resolves to a vehicle floor (`matchVehicle`).
   Classes below that floor are excluded; anything at or above it may bid.
3. **Chooses the smallest eligible vehicle.** Candidates are every registered vehicle at or above the
   floor, and every one is put through `eligibility()`: partner approved, all five documents valid on
   the dispatch date, vehicle registered for that lane, load inside the registered capacity. Sorted by
   registered payload, smallest first, so a 9 t load does not take a 34 t trailer.
4. **Books before it dispatches.** `bookWindow` reserves the plate for the window. Two orders cannot
   take the same truck; the refusal names the order that already holds it.
5. **Marks the order dispatched** through the existing lifecycle (`orders.dispatch`), which writes the
   vehicle, driver, reference and planned route onto the order and opens a job.
6. **Opens the track on the same legs**, so the window the customer was promised is the window that is
   monitored.

## The bridge this fixed

The partner register and the fleet matcher each named the middle of the range differently — "rigid
truck" in the register, "medium truck" in the fleet — and the register did not know about trailers or
the last-100-km drone class at all. A registered 12 t truck was silently ineligible for a 9 t load.
`dispatch.mjs` bridges the vocabularies (`rigid_truck → medium_truck`, `drone → drone_last100`) and the
register now carries `trailer`, `medium_truck` and `drone_last100` as first-class classes with their
payload ceilings. This is the second time a vocabulary drift has caused a wrong offer; any new vehicle
class must be added to **both** modules and to the bridge.

## Refusals are data

Every failure returns `{ ok: false, refusals: [...] }` with a `code` and a sentence an operator can act
on. No exception is thrown for a business refusal, because a retrying client needs something to log
and a person needs the reason:

| code | meaning |
| --- | --- |
| `no_order` | no order record supplied |
| `bad_time` | the dispatch date does not parse |
| `order_not_ready` | the order is at a stage that cannot dispatch; the message names the allowed stages |
| `unknown_lane` | the lane is not in the partner register; the message lists the known lanes |
| `bad_weight` | weight missing or not positive |
| `no_driver` | no named driver — the person who drives is part of the record |
| `vehicle_too_small` | the load exceeds the largest class on that road class |
| `no_eligible_partner` | eligible vehicles exist in the fleet but none is verified, documented, registered for the lane and free; each candidate is listed with its blockers |
| `booking_refused` | the window is already held, or the order already holds it |

`refusedAlternatives` on a successful dispatch lists the vehicles that were passed over and why, so an
operator can see the decision rather than trust it.

## Cost discipline

An estimate is attached only when a distance is supplied, and it is labelled as a planning figure from
the internal rate card — never as a carrier quote. `estimateNote` says so in the payload the UI renders.
Rates observed: motorbike 38, pickup 62, van 70, light truck 115, medium truck 190, heavy truck 255,
trailer 320 KES/km.

## In the app

The Network tab's **Dispatch** panel: choose an order that is packed (or add a demonstration order when
none is), enter weight, lane, driver, distance and date, then Dispatch. The panel renders either the
refusal with its candidate list, or the dispatch — order stage, job, reference, vehicle, booked window,
first leg, estimate — and hands the reference to the Tracking panel above, which then accepts milestones
against that shipment.

## Tests

`tests/dispatch.test.mjs` — 11 cases: stage skipping, dropship-vs-warehouse entry points, unknown lane,
overweight, missing driver, the full happy path (order stage, booking, track, estimate), smallest-fit
selection, unverified partner, papers that lapsed after approval, double booking, readiness reporting.

## Next

- Persist dispatch jobs to the shipment store so the Tracking tab (not just the Network panel) can pick
  a dispatched reference after a reload.
- Wire the Loconav adapter to feed milestones into the track once a key exists.
- Add a cancellation path: release a booked window when an order is cancelled, so the plate returns to
  the pool.
