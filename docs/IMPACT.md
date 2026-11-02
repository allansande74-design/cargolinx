# Impact, measured

Every number here was produced on this machine and can be reproduced with the command beside it.
Nothing in this file is an estimate, a projection or a testimonial.

## The quote path is fast enough to be a conversation

The deterministic engine computes a full landed cost — customs value, marine insurance, import
duty, IDF, RDL, VAT — and a 30 per cent quote on top, then checks the result against the policy band:

```
node scripts/bench-quote.mjs 2000
```

Output on 1 November 2026, Node 22, 4 vCPU container:

| measure | value |
|---|---|
| runs | 2,000 (after 500 warm-up) |
| median | 0.003 ms |
| p95 | 0.006 ms |
| p99 | 0.020 ms |
| worst observed | 0.133 ms |
| landed before VAT, sample shipment | KES 1,887,138.75 |
| price inside the band at 30 per cent, incl. VAT | KES 3,127,258.50 |

The sample shipment is goods KES 1,200,000 and freight KES 250,000, duty 25 per cent, one unit. The
arithmetic is reproducible with `node cli/quote.mjs --goods 1200000 --freight 250000 --duty 0.25 --margin 0.30`.

What this does and does not mean: the *calculation* is microseconds. The time a trader actually saves
comes from not retyping the same figures into four places and not waiting for a person to be at a desk
— that part is an operational claim, not something this benchmark measures.

## What is deliberately absent

- **No pilot commitments are claimed.** Three are wanted; none is signed. A named pilot appears in this
  repository only when there is a name, a date and a sentence from the pilot.
- **No customer testimonials.** There are none yet.
- **No market-size projections.** A number nobody can check does not belong in a submission.

## Reproduce everything

```
node --test tests/*.test.mjs      # 382 tests, 0 failing (2 November 2026)
node scripts/bench-quote.mjs     # this file's timing table
node cli/quote.mjs               # the itemised quote card
```
