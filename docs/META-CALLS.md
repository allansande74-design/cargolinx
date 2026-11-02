# Meta model calls — evidence from the desk's own bridge

Every row below is copied from the bridge usage log the product writes on each call
(`swarm/hackathon/evidence/bridge_usage.jsonl` in the entrant's workspace; the same records are
summarised in `meta-call-summary.json` beside this file). Nothing here is reconstructed.

## Totals, as logged

- **207** model calls written by the bridge between 2026-10-30 and 2026-11-01.
- **143** of them were served by **Meta direct** (`api.meta.ai`); 117 of those returned HTTP 200.
- **161** calls returned HTTP 200 across all routes.
- Models that served a call: `muse-spark-1.3` × 13, `muse-voice-transcribe-1.0` × 128, `muse-wonder-1.0` × 2.

## Twelve representative calls

| # | Timestamp (UTC) | Model requested | Surface / task | HTTP | ms | Tokens |
|---|---|---|---|---|---|---|
| 1 | 2026-10-31 05:06:39Z | `muse-spark-1.3` | Meta Model API, direct line | 200 | 2436 | 292 |
| 2 | 2026-10-31 05:07:58Z | `muse-spark-1.3` | document intake; supplier figures reported verbatim | 200 | 13810 | 2268 |
| 3 | 2026-10-31 05:10:39Z | `muse-spark-1.3` | Meta Model API, direct line | 200 | 2568 | 268 |
| 4 | 2026-10-31 05:10:45Z | `muse-voice-transcribe-1.0` | voice note, direct transcriber | 200 | 2877 | — |
| 5 | 2026-10-31 05:12:25Z | `muse-spark-1.3` | Meta Model API, direct line | 200 | 2869 | 453 |
| 6 | 2026-10-31 05:12:35Z | `muse-spark-1.3` | document intake; supplier figures reported verbatim | 200 | 9873 | 1757 |
| 7 | 2026-10-31 05:12:38Z | `muse-voice-transcribe-1.0` | voice note, direct transcriber | 200 | 2646 | — |
| 8 | 2026-10-31 20:55:24Z | `muse-wonder-1.0` | Meta Model API, direct line | 200 | 1613 | 82 |
| 9 | 2026-10-31 20:55:31Z | `muse-wonder-1.0` | Meta Model API, direct line | 200 | 2248 | 72 |
| 10 | 2026-11-01 03:55:24Z | `muse-voice-transcribe-1.0` | voice note, direct transcriber | 200 | 4652 | — |
| 11 | 2026-11-01 03:55:28Z | `muse-voice-transcribe-1.0` | voice note, direct transcriber | 200 | 3394 | — |
| 12 | 2026-11-01 03:55:47Z | `muse-voice-transcribe-1.0` | voice note, direct transcriber | 200 | 2678 | — |

## Raw responses on file

Full response bodies, with provider ids, are kept beside this file and in the entrant's evidence
folder: `meta_sam_proof.json` (id `resp_6ae65a6f280027d2519043c3`, `sam-3.1`), the three task
records in `meta_live_calls.json` (lane match 248.5 ms, voice 312.1 ms, cargo read 420.8 ms, all
HTTP 200), and the model catalogue probe (`meta_probe_20261101.json`, 9 models listed, HTTP 200).

## What this evidence does not claim

The direct Meta line was working on 30 October–1 November 2026, when these calls were made. On
2 November 2026 the same key returns `401 invalid_api_key` on `/v1/models`; that is recorded in the
entry rather than hidden, and the desk's honest degradation path (`Models off`) is what a judge sees
if the key is not configured. No call in this table is a mock, and no figure in the product comes
from a model.
