# The demo film

One cut ships with this repository: `public/demo/CargoLinx-demo-3Nov2026.mp4` — 68.8 s, 1920×1080 at
30 fps, h264. It is silent (the desk's own screens carry the story), it needs no login, and it is the
file the submission links to:

- Film page: https://altovexcargolinx.allansande74.workers.dev/demo/
- Direct file: https://altovexcargolinx.allansande74.workers.dev/demo/CargoLinx-demo-3Nov2026.mp4
- Repository copy: `public/demo/CargoLinx-demo-3Nov2026.mp4`

The cut spends every second on a result: waiting inside a scene is compressed to a flash while the
parsed rate card, the filled note, the counted cargo, the spoken transcript and the written quote
explanation all stay on screen, and the film closes on a card that says what to do next.

Nothing in the film is a mock-up. Every document on screen is raised by the product itself for one
shipment — order `CLX-261031-714`, buyer Kampala Power & Cable Ltd, vehicle KDH 417X — and every
figure on screen comes out of the engine that ships in this repository.

## Scene order

| # | Scene | What is on screen |
|---|---|---|
| 1 | Title | Altovex CargoLinx on the Mombasa–Kampala corridor |
| 2 | The team | Who stands behind the desk |
| 3 | Loading | The consignment, packed and documented |
| 4 | Transit | The corridor, the distance, the days |
| 5 | Border | Where a quote goes to die: clearance, certificates, waiting |
| 6 | Before and after | Two days late against a price that answers in a minute |
| 7 | The solution | The desk: one ledger, twelve modules |
| 8 | 1:23 — voice note | A driver's note transcribed by `muse-voice-transcribe-1.0` |
| 9 | 1:34 — counting cargo | `sam-3.1` read of the cargo photograph, count returned |
| 10 | 1:45 — explanation | `muse-spark-1.3` explains a quote in plain English, using only the engine's figures |
| 11 | 1:57 — imagery | `muse-image-1.0` document furniture |
| 12 | 2:0x — offline | Signal off; the desk keeps quoting from IndexedDB |
| 13 | 2:1x — the repository | The public tree, the MIT licence, the test suite |
| 14 | 2:1x — measured impact | The benchmark numbers, each beside the command that reproduces it |
| 15 | 2:29 — close | The live address a judge can open |

The model scenes name their upstream model on screen because the code names it: the desk addresses
models by task (`src/lib/meta.js`), and the task table records which model answered.

## What the film does not show, and why

- **No SAM overlay painted onto the cargo frame.** A segmentation response is indexed to the exact
  frame the model saw; drawing a saved mask onto a different photograph would be an off-subject mask
  presented as a measurement. The film therefore shows the count and the recorded response, and
  `out/demo/mask_card.py` decodes that response rather than re-drawing it.
- **No live model call after 30 October 2026.** The Meta account behind this project is
  billing-blocked (payment past due), so the desk takes the deterministic path it was built to take:
  `Models off`, a refusal instead of a fabricated answer. The calls that did run are recorded in
  `docs/evidence/meta_live_calls.json`.

## Checking it

```
node --test tests/*.test.mjs
ffprobe -v error -show_entries format=duration,size -of default=nw=1 demos/cargolinx-demo-entry-153s.mp4
```
