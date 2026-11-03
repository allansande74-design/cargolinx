# Sequencing a day's stops

The matcher answers *which vehicle*. This answers *in what order*, which is the question that
decides whether a Nairobi day needs one truck or two.

## Method, in plain terms

1. **Distance** — great-circle kilometres between points. It is a proxy for road distance, and the
   desk says so on screen: no turn-by-turn routing, no traffic, no one-way streets.
2. **Under nine stops — solved exactly.** Every possible order is enumerated (40,320 of them at
   eight stops) and the shortest is returned. A small day gets the best answer that exists, not a
   good one.
3. **Nine stops and above — three steps.**
   - **Clarke–Wright savings**: begin with one out-and-back trip per stop, then join the two trips
     whose joining saves the most kilometres, respecting capacity.
   - **2-opt**: reverse a stretch of the order whenever that shortens the loop.
   - **Or-opt**: lift one stop, or two neighbours, out of the order and reinsert them where they
     save the most.
4. **Capacity is a hard rule.** A stop that cannot ride comes back with a sentence saying what was
   already loaded and what would not fit — never a silent drop.

## Measured, not claimed

`node scripts/route-bench.mjs` — deterministic seeds, Nairobi-shaped instances (stops scattered
2–20 km around an Industrial Area depot), 12 runs at six and eight stops and 40 runs at each larger
size.

- **Against the order a driver takes unaided** (nearest neighbour, the honest baseline): 6.8%
  shorter at six stops, 7.0% at eight, 8.2% at twelve, 12.3% at eighteen, 12.8% at twenty-six,
  14.7% at forty.
- **Against the best order that exists** (brute force, only knowable on small days): **0.00% gap —
  the exact answer every time**, at both six and eight stops.
- **Speed**: 0.67 ms for twenty stops, 6.74 ms for forty, 39 ms for eighty. A dispatcher does not
  wait.

The one place it is beaten: at six stops the unaided order happened to win once in twelve runs,
because nearest neighbour occasionally stumbles onto the loop. Twelve of twelve were still optimal.

## Where a judge sees it

The Dispatch tab of the desk carries a **Day plan** card. It reads every order waiting to move in
that browser, resolves each destination against a table of Kenyan area centres (`src/lib/places.mjs`,
accurate to a few hundred metres and labelled as such), and prints the visit order with the total
distance, the load, and what a nearest-stop-first order would have cost instead.

Measured in the browser on four seeded loads — Athi River, Mlolongo, Westlands, Nakuru, from an
Industrial Area depot: **325.48 km** in the planned order against **348.78 km** nearest-first, 6.7%
shorter. The card says so itself, on screen, so nobody has to take the benchmark's word for it.

## What it does not do

- No road network: the distance is a straight line over the earth's surface. OR-Tools or VROOM with
  OSM data would answer the road question; that is a hosted dependency and a licensing decision,
  not an afternoon's work.
- No delivery time windows inside the sequence. Windows are checked when a load is assigned to a
  vehicle, not when the stops are ordered.
- No multi-vehicle simultaneous optimisation: loads are placed first, then each vehicle's own stops
  are ordered. A joint solve would sometimes find a better split.

Those three are written down here so nobody has to discover them in front of a client.
