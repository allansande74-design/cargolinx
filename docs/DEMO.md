# The demo cuts — what each one is for

Two cuts exist, from the same engine and the same figures.

| File | Length | What it is |
|---|---|---|
| `cargolinx-demo-v3.mp4` | 165.8 s | Presenter-led animated cut: Amanda introduces the problem and Allan Sande, the desk is then drawn scene by scene from the engine's own figures, and the film closes on the ask. |
| `cargolinx-demo-165s.mp4` | 165.1 s | Screen-capture cut: the same story told over the running product — the real form, the real ladder, the real model answer, the real quotation, airplane mode. |

The animated cut explains; the filmed cut proves. A judge who wants to see it running watches the
second; a funder or a first-time viewer watches the first.

## The animated cut, scene by scene

| # | Time | Scene | What is on screen |
|---|---|---|---|
| 0 | 0:00 | Introduction | Amanda's panel, then Allan Sande's portrait with his name and title |
| 1 | 0:18 | The problem | *Two days late. Nobody can defend the number.* over the corridor and a clock sweeping twice |
| 2 | 0:31 | The pain, named | Five lines land in sequence, each with its cost |
| 3 | 0:46 | Who we are | The corridor drawn from Mombasa to Dar es Salaam; head office Nairobi |
| 4 | 0:56 | One entry | The shipment card fills itself; three lines run to quote, tracking, documents |
| 5 | 1:08 | The ladder | Bars build with real figures; landed cost lands; margin and floor markers |
| 6 | 1:31 | The model | The answer types itself; the panel names the model that served it |
| 7 | 1:45 | The document and the proof | The quotation, tracking segments, compliance ticks, the refusal line |
| 8 | 2:03 | Without signal | Status flips to offline, writes queue, the counter drains on reconnect |
| 9 | 2:14 | The ask | Support in money beside support in kind; the contact block |

**Verified for the animated cut:** 165.78 s by `ffprobe`; −16.0 LUFS integrated and −2.0 dBTP true
peak; the finished audio transcribed and matched to the film (2,038,543 · 30% · 15% · 14 days ·
SADC · the mailbox all present). The presenter panel holds a still portrait — her lips do not move,
because that needs a face-reenactment model (about USD 0.70–3.00 a minute, on an account not funded
here) — and the film says so rather than showing a synthetic mouth.

## The screen-capture cut, scene by scene

| # | Time | Screen | What the narration claims | Where it is proved |
|---|---|---|---|---|
| 1 | 0:00 | Landing page | The engine prices from dated statutory rates; the model explains and never prices | `engine/landed.mjs`, footer line on the desk |
| 2 | 0:23 | Desk → New shipment | One record feeds quote, tracking and documents | `src/App.jsx`, one shipment object read by three views |
| 3 | 0:43 | Quotes & pricing | The ladder prints base and rate per line; 30% held, 15% floor stated | `engine/landed.mjs`, `engine/quote.mjs` |
| 4 | 1:11 | Quote → Explain this quote | The model answers in plain English and names the upstream model | live call, `evidence/bridge_usage.jsonl` |
| 5 | 1:30 | Quotation document | The document restates the same figures, signed, with a verifying QR | `src/lib/quote-doc.mjs` |
| 6 | 1:45 | Tracking & POD | Segments, dwell, customs time, confidence; changes kept with their cause | `engine/eta.mjs` |
| 7 | 1:57 | Compliance | Classification, EAC origin, conformity and waivers before the border | `engine/tariff.mjs` |
| 8 | 2:10 | Desk, network killed | Writes queue on the device with an idempotency key and drain on reconnect | `src/lib/sync.js`, badge reads *Offline — writes queued* |
| 9 | 2:24 | Landing page | One entry, one defended ladder, one verifiable quote | the whole run |

## The figures in scene 3

Shipment `CLX-261031-714`: 20 ft container of electrical cable, Mombasa → Kampala, 20 units,
12,000 kg, goods KES 1,200,000, freight KES 250,000, EAC CET 25%, clearing KES 48,000,
transport KES 55,000, last mile KES 14,000.

- CIF KES 1,457,250.00 · duty KES 364,312.50 · IDF KES 36,431.25 · RDL KES 29,145.00
- VAT KES 301,942.20 · PVoC KES 34,404.95 (the code is regulated)
- **Landed cost before VAT KES 2,038,543.70** · landed incl. VAT KES 2,340,485.90
- **Quoted at 30% margin: KES 2,912,205.29 ex-VAT** · floor price at 15%: KES 2,398,286.71

Reproduce the engine without the browser:

```bash
node cli/quote.mjs --qty 20 --clearing 48000 --transport 55000 --lastmile 14000 \
  --margin 0.30 --hs 8544.42 --origin CN
```

Without `--hs`, the CLI cannot know the code is regulated and omits the conformity fee; with it,
the CLI and the desk return the same total. That gap was found while writing this note and the
CLI now takes the same fee path as the app.

## How it was captured

1. Chromium over the DevTools Protocol at 1920 × 1080; trusted `Input.dispatchMouseEvent` for
   clicks, because scripted clicks do not produce the same event timings.
2. The desk was pointed at the local model bridge with one button (`Use local bridge`), so the
   browser holds no key and the model scene is a genuine call.
3. Airplane mode was `Network.emulateNetworkConditions(offline: true)`; the frame was captured
   through `Page.printToPDF` because a screenshot request cannot complete with the network down.
4. The quotation in scene 5 was rendered by `scripts/demo-quote-doc.mjs` through the product's
   own `quoteHtml`, not redrawn.

## What the video does not show

- No cargo-photo read and no voice-note transcript on film: both need a microphone and a camera
  permission prompt, which makes an unedited 165-second capture unreliable. They exist in the
  build (`src/lib/meta.js`) and are covered by the recorded task calls instead.
- No multi-user or role-based scene: the demo runs as one operator.
