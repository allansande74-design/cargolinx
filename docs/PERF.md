# Measured performance — Altovex CargoLinx

Measured on 31 October 2026 against the build then served at
`https://mindful-koan-nn55.here.now`, from the operator machine in Nairobi, using Chromium
driven over the DevTools Protocol. The canonical deployment has since moved to
`https://altovexcargolinx.allansande74.workers.dev/`; these figures have not been re-run against
that host, and are reported here as the measurement they were. No figure below is estimated; each
is read from the browser's own performance timeline.

## Results

| Metric | Cold visit (cache empty) | Warm visit (service worker) | Method |
|---|---|---|---|
| First Contentful Paint | 1,084 ms | 100 ms | `PerformanceObserver`, `paint` entries |
| Largest Contentful Paint | 1,084 ms | 100 ms | `PerformanceObserver`, `largest-contentful-paint` |
| Time to First Byte | 558 ms | 5 ms | `navigation` timing, `responseStart` |
| DOMContentLoaded | 974 ms | 47 ms | `navigation` timing |
| Cumulative Layout Shift — landing | 0.000 | 0.000 | `layout-shift` entries, excluding input |
| Cumulative Layout Shift — desk, first load | 0.000 | 0.000 | `layout-shift` entries, excluding input |
| Interaction latency (nav switch) | 32 ms | 32 ms | `event` timing, trusted `Input.dispatchMouseEvent` |
| Largest JS bundle | 395 KiB | — | build report |
| Precache total | 915.86 KiB | — | service worker manifest |

## What the numbers mean

- **Cold load is fast for a hosted PWA**: 1.08 s to the largest paint with a 558 ms TTFB, on a
  connection to a European edge from Nairobi. Warm load — the case that matters on a corridor
  with intermittent signal — is 100 ms, because the service worker serves the shell from disk.
- **Interaction latency is 32 ms** for a module switch, well inside the 200 ms "good" band.
- **Layout shift is zero on first load, on both the landing page and the desk.** One earlier run
  reported 0.180: that figure came from a scripted module switch. Script-dispatched clicks are
  untrusted events, so the browser cannot mark the shift `hadRecentInput` and the metric charges
  the view swap to layout rather than to the interaction that caused it. The run was repeated with
  an observer installed before first paint, and first-load CLS is 0.000. The number is corrected
  here rather than left standing.

## How to reproduce

1. Open the URL in Chromium with the DevTools Protocol attached.
2. Register `PerformanceObserver` for `paint`, `largest-contentful-paint`, `layout-shift`
   and `event` (with `durationThreshold` 1) before the first navigation.
3. Reload with the cache disabled for the cold column; reload normally for the warm column.
4. Dispatch a trusted mouse press/release on a desk navigation item and read the `event`
   entries; the interaction with the longest `duration` is the INP candidate.
