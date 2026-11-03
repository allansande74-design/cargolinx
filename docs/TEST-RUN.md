# Test run — Altovex CargoLinx

The suite is run on the build machine and the result is committed here, because the
repository no longer uses GitHub-hosted runners (see `.github/workflows/README.md`). Every figure below is
copied from a real terminal run, not written by hand.

- **Date:** 2 November 2026, 08:28 UTC (latest re-run)
- **Machine:** Linux 6.8, Node v22.23.4, npm bundled with that Node
- **Tree under test:** `7d08abf` plus the timestamp change in this commit
- **Package:** `cargolinx-v2@0.2.0`

## 1. Test suite

```
$ npm test
> cargolinx-v2@0.2.0 test
> node --test tests/*.test.mjs

TAP version 13
# Subtest: the file passes its own invariants
...
1..520
# tests 520
# pass 520
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1283.051052
```

Exit status `0`. 520 assertions across the engine, the quote ladder, the offline queue, the
document renderer and the submission-readiness checks.

## 2. Production build

```
$ npm run build
> cargolinx-v2@0.2.0 build
> vite build

vite v5.4.21 building for production...
...
✓ built in 1.94s

PWA v0.21.2
mode      generateSW
precache  47 entries (824.67 KiB)
files generated
  dist/sw.js
  dist/workbox-abeb32eb.js
```

Exit status `0`. The service worker and the web app manifest are emitted by the build, so an
installable offline desk is part of the artefact rather than a manual step.

## 3. The deployed build answers

Fetched from the operator machine on 2 November 2026 at 08:28 UTC:

```
https://altovexcargolinx.allansande74.workers.dev/                      -> 200
https://altovexcargolinx.allansande74.workers.dev/sw.js                 -> 200
https://altovexcargolinx.allansande74.workers.dev/manifest.webmanifest  -> 200
https://altovexcargolinx.allansande74.workers.dev/demo/                 -> 200
https://altovexcargolinx.allansande74.workers.dev/demo/cargolinx-demo-entry-153s.mp4 -> 200 (video/mp4)
```

No login, no interstitial. The page shell, the service worker and the manifest are served by
the same host, which is what makes the install prompt and the offline first load work.

## 4. Reproducing this run

```
git clone https://github.com/allansande74-design/cargolinx
cd cargolinx
npm ci
npm test
npm run build
```

Nothing in the suite reaches the network: the live-call evidence used by the demo is replayed
from `evidence/`, so the result does not depend on an API key or on the model being reachable.
