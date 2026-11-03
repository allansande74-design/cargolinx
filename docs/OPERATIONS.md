# Operating CargoLinx

What runs, how you know it is up, what to do when it is not, and what is honestly not covered yet.
This is the page to read at 2 a.m.

## What runs where

- **The desk** — a static bundle served by the Cloudflare Worker `altovexcargolinx` from `dist/`.
  Everything the operator types is stored in the browser's own IndexedDB and syncs when a link is
  available. There is no application database to lose.
- **`/api/meta`** — a same-origin proxy inside the same Worker. It holds the Meta credential and
  forwards chat, reading and segmentation calls. The bundle a phone downloads never contains a key.
- **`/api/health`** and **`/api/errors`** — liveness and fault intake, both in `worker/health.mjs`.
- **Media** — `/demo/*` film is served with real byte-range support by `worker/index.js`.

## Is it up?

```
curl -s https://altovexcargolinx.allansande74.workers.dev/api/health
```

A healthy answer looks like:

```json
{ "status": "ok", "models": "configured", "routes": { "meta": "/api/meta", "errors": "/api/errors" },
  "servingSeconds": 412, "time": "2026-11-03T15:40:00.000Z" }
```

`models` says `configured` or `missing` and never shows the key. Poll it every five minutes from a
cron job; two consecutive non-200 answers or `models: "missing"` is a page-worthy event.

Checked from the far side, not just from inside: the desk is the only thing that matters, so the
poll must fetch `/api/meta/models` too — a 200 there means the key works, not merely that the
Worker answers.

## What broke?

The browser reports its own failures to `/api/errors` (three per page load, message and path only,
query string stripped). Read them with:

```
npx wrangler tail altovexcargolinx --format pretty
```

Lines are prefixed `desk-error` and carry `message`, `where`, `path`, `at`. They are not stored
anywhere else, so if nobody was tailing, the log line is gone — see the gaps below.

## Deploy and roll back

Deploy only from a pulled, tested commit:

```
git pull && npm test && npm run build && npx wrangler deploy
```

Write down the version id the deploy prints. To go back:

```
npx wrangler rollback            # previous version
npx wrangler deployments list    # what exists
```

A rollback of the Worker rolls back the route and the assets together, because both ship in the same
deployment. The static Pages copy at `allansande74-design.github.io/cargolinx/` is separate and only
moves when `gh-pages` is pushed.

## The Meta credential

Set once, on the owner's laptop, never echoed:

```
npx wrangler secret put META_API_KEY
```

Rotate by creating a new key in the Meta console, running that command with the new value, and
deploying. The old key is revoked in the console afterwards — never before, or the desk goes dark
between the two steps. Keys live in the Worker secret and in the owner's vault; they never enter the
repository, the bundle or a chat.

## Cost guardrails

The proxy allows five models, caps an answer at 1,200 output tokens, and allows 40 calls per ten
minutes per caller (counted per Worker instance, so a wide attack can exceed it). The owner also sets
a monthly spend limit in the Meta console. If the desk must be silenced, deleting the secret stops
every model call while the desk keeps serving pages.

## Known gaps

- No off-site log store: error reports live only in `wrangler tail`. A durable sink is the next piece
  of work, and it is deliberately not built yet.
- Rate limiting is per Worker instance, not global. Cloudflare's own rate-limit rules would make it
  global.
- No pager: health is polled, but nothing wakes a human except a cron job that posts to the owner.
- No automated restore drill. The data is in the browser, so recovery means re-opening the desk on
  the device that holds it.
- Accessibility and Lighthouse figures are measured by hand, not gated in CI.
