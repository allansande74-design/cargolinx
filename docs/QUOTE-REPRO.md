# Reproducing the numbers on the film

The ladder and the quote card in the demo film come from one command:

```
node cli/quote.mjs --goods 1200000 --freight 250000 --duty 0.25 --margin 0.30 --hs 7326.90 --origin CN
```

Inputs: goods KES 1,200,000 (FOB), international freight KES 250,000, EAC CET duty 25 per cent,
HS 7326.90 (articles of iron or steel, a regulated category), origin China, quote margin 30 per cent.
The PVoC fee is the KEBS schedule minimum, USD 265, converted at the reference rate recorded in
`engine/tariff.mjs`.

Output at the time of writing:

```
CARGOLINX LANDED COST  —  KES  —  1 unit(s)
------------------------------------------------------------------------
Goods (customs value)                                             1,200,000.00
International freight                                               250,000.00
Marine insurance                                                      7,250.00
CIF / customs value                                               1,457,250.00
Import duty (EAC CET 25%)                   on 1,457,250.00         364,312.50
Import declaration fee (2.5%)               on 1,457,250.00          36,431.25
Railway development levy (2%)               on 1,457,250.00          29,145.00
VAT (16%)                                   on 1,887,138.75         301,942.20
Other charges                                                        34,404.95
------------------------------------------------------------------------
Statutory total                                                     731,830.95
Landed cost incl. VAT                                             2,223,485.90
Landed cost excl. recoverable VAT                                 1,921,543.70
Cost per unit excl. VAT                                           2,223,485.90

QUOTE at 30.0% margin   (policy band 30-40%, floor 15%)
Selling price excl. VAT                                           2,745,062.43
VAT on sale                                                         439,209.99
Selling price incl. VAT                                           3,184,272.42
Gross profit                                                        823,518.73
Cheapest defensible price (15% floor)                             2,260,639.65
PVoC route A on FOB USD 9242.86: USD 265.00 = KES 34,404.95 (minimum of the schedule)
```

Landed cost before VAT is KES 1,921,543.70. The card the buyer receives is KES 3,184,272.42
including VAT at 30 per cent margin, inside the 30 to 40 per cent policy band.
