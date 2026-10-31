# Hackathon status — Sat 31 Oct 2026, 22:22 UTC (01:22 EAT Sun 1 Nov)

**Score: 80/80** (prev 80, delta +0 — Lane A: demo+QR committed, QR chain live, film QA re-verified)
**CALENDAR:** Sat 31 Oct 2026 22:22 UTC / 01:22 EAT Sun 1 Nov. Deadline Wed 4 Nov 12:00 EAT (09:00 UTC). **3d 11h left (~82.6h).**
**PIPELINE:** next review Sun 1 Nov morning EAT; register: submission pack assembly → demo smoke test → final deploy. 3 items open.

## Status
Lane A complete: demo cuts + QR pair committed as real artifacts (4c6a528), QR decode+solve chain live both docs
(HTTP 200 local + live, hash-prefix match), film_qa re-run 100/100 PASS. 82.6h to deadline.

## Done (measured)
- [x] Demo+QR commit — `4c6a528` on master, 2026-10-31 ~22:22 UTC: 7 mp4 (87,270,123B total: v4-captioned
  16,529,629B/237.1s, v4 14,186,871B, v3-captioned 14,268,146B, v3 12,872,948B, 165s 16,738,203B,
  165s-animated 8,438,741B, 720p-small 4,235,585B) + QR pair (qr-atv 467B, qr-clx 470B) + proof gates
  (121,182B + 543,606B) + film_qa.json/FILM-QA.md. Working tree clean after commit.
- [x] QR chain live — segno error level **l** (m fails cv2 decode on v4 payloads), navy #071a33, scale 8,
  border 4 (border 2 too tight for decode). cv2 decode MATCH both URLs. Resolve HTTP 200 local :8101
  AND live mindful-koan-nn55.here.now both docs. Register fp8 prefix MATCH: 3fc684ce→content_fp
  3fc684ce3541bb4f, 29697d83→29697d83fbd89229 (content_fp, not sha256 prefix — verified by recompute).
- [x] Film QA re-run — `film_qa.py` exit 0, score **100.0/100 PASS**, 18/18 checks, v4-captioned 237.1s
  1920x1080@25 h264/aac, -16.3 LUFS, 118 caption events. Results in out/demo/qa + committed copy.
- [x] Prior baseline holds — vite dist/ 820K fresh, tests 341/341, bridge meta:direct (21:48 report).

## In progress
- Submission pack assembly (entry track, demo film link, evidence JSON) — evidence files exist, pack doc not yet assembled.
- Public URL / deploy confirmation — build verified locally only; verify/ live on here.now but app bundle URL needs its own HTTP 200 probe.
- Demo smoke test of multilingual chat path end-to-end against the fresh bundle.

## Needs approval
- None blocking. (If a deploy target or submission-portal account is needed before Wed, flag it now — 82.6h left.)

## Risks
- **82.6h to deadline, no submitted artefact yet** — demo+QR now committed but nothing handed in; next 3 actions close that gap.
- **QR route is static-file based** — no GET /qr/<id>.png route on :8101; QR PNGs live in out/verify/ + committed
  out/verify/ in repo. If judges need a live /qr/ endpoint, add it to the verify server or publish the PNGs.
- **Committed mp4s add ~87MB to repo history** — HEAD commit only; consider LFS or release attachments if the pack grows.

## Next 3 actions (toward submission)
1. Smoke-test the fresh bundle (serve dist/, load hackathon.html + Amanda bar, one multilingual ping) and record HTTP statuses.
2. Assemble the submission pack (track, repo link, demo film, evidence JSONs, performance figures) in `/home/amanda/out/reports-hackathon/`.
3. Deploy to a public URL, probe it HTTP 200, and re-stamp one `meta:direct` live call as final judge evidence.

*All numbers from real probes run 22:15–22:22 UTC 31 Oct 2026 (segno+cv2 QR chain, curl :8101 + here.now,
film_qa.py re-run, git log/status, du/stat). Commit 4c6a528.*
