# Export: the lanes, the other way round

Import runs port-inward — Mombasa to Kampala, Mombasa to Nairobi, Nairobi to Kigali. Export runs the same
tarmac the other way, and the desk does not keep a second table for it.

## How the reversal works

`engine/lanes.mjs` holds the lane table once. `reverseLane()` puts the legs in reverse order and turns each
leg's own name round, so `Mombasa - Kampala` becomes `Kampala - Mombasa` made of `Kampala - Malaba`,
`Malaba - Eldoret`, `Eldoret - Nairobi`, `Nairobi - Mombasa`.

- Kilometres are the import lane's own: 1,185 km either way, because it is the same road.
- Speeds are the printed planning speeds, not a tracked vehicle.
- Border posts do not move; a reversal keeps each leg's `border` flag.
- Reversing twice returns the original lane, and a test asserts it for every lane.

## Where the symmetry stops

| | Import | Export |
| --- | --- | --- |
| Declaration | entry lodged **after** the border post | entry lodged **before** the border post |
| Kenyan duty | duty band applies on entry | no Kenyan import duty — no duty line exists |
| Destination charge | the desk's own tariff table | **not quoted**, because no destination tariff is held |
| Empty running | the truck arrives loaded | the truck returns light unless a backload is booked |

The build-up therefore stops at the destination port: goods, ocean freight, marine insurance, inland to port
and export papers make up the CIF figure and the Kenya-side costs. Destination duty is printed as missing.
A guessed duty would follow the container all the way to a customer, so the desk refuses to guess it.

## Where a judge sees it

Desk → **Trade → Export desk**. Two cards and a table:

- the export lanes with kilometres, driving hours and border count, computed from the import table;
- a build-up that reads, on the demo figures, **CIF USD 21,507.00** and **KES 2,792,253.81** at 129.83, with
  the destination duty row naming what is not included;
- a plain statement of what reverses and what does not.

The lane numbers are measured by `tests/lanes-direction.test.mjs` (seven tests: naming, leg preservation,
reverse-twice identity, hours, one export lane per import lane, 1,185 km on Kampala - Mombasa).
