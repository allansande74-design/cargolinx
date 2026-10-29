# Contributions — CargoLinx, Meta Global AI Developer Hackathon 2026

Solo entrant: Sande Allan (Altovex Global Logistics Ltd), team ID 1670994694448117.
Built during the event window; every figure below is measured from this repository, not estimated.

## What was built in the event window

| Area | What exists | Evidence |
|---|---|---|
| Freight position and ETA | Deterministic ETA engine with a documented rate model and a refusal path when the class is unknown | `engine/eta.mjs`, tests green |
| Landed cost | Duty, VAT, IDF, RDL and EAC CET bands computed per consignment, with a quote gate that refuses an unscoreable deal | `engine/landed.mjs`, `engine/quote.mjs` |
| Dispatch | One thread from a packed order to a matched vehicle, booked window and live track | `engine/dispatch.mjs` |
| Dataset | 26 African markets, one verified against its sources, the rest marked draft and refused by `defineDataset` until sourced | `engine/dataset.mjs` |
| Meta model layer | Task-scoped model calls behind a configuration gate; unconfigured tasks take a deterministic path and say so | `engine/meta/client.mjs`, `engine/meta/tasks.mjs` |
| Offline layer | IndexedDB persistence so the trader keeps working with no signal | `src/` |
| Verification | 320 tests, 0 failing, plus a judge simulation scoring the entry against the public rubric | `tests/` |

## Deliberate design decisions

1. **Cite or refuse.** A dataset without sources, ISO dates and numbers is rejected by the loader, not
   quietly displayed. The entry would rather show nothing than show a guess.
2. **A model explains, it does not invent.** Every generative path sits behind a task definition with a
   deterministic fallback, so a missing model degrades the wording, never the arithmetic.
3. **Secrets never travel.** Model keys are read from the environment, redacted from logs and never
   written into evidence or test fixtures.
4. **Measured, not asserted.** The status page renders from live probes: tests, files, services and the
   remaining countdown.

## Using Meta open weights and models

- Model calls are addressed by task, not by hard-coded model name, so the same code runs on the hosted
  endpoints and on open-weight deployments without a rewrite.
- Image work uses Muse Image; transcription uses Muse Voice Transcribe; segmentation and counting use
  SAM 3.1 — each behind the same gate.

## What is not claimed

- No Meta endpoint is called until a key is configured; the layer reports `no_model_configured` rather
  than pretending a call happened.
- The market dataset is 1 verified of 26. The other 25 are drafts and are labelled as such in the app.
- Telematics partners are modelled, not integrated; the adapter contract exists and is tested against a
  fixture, and the entry says so.
