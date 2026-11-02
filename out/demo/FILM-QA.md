# Film quality report — cargolinx-demo-v5-film.mp4

**Score 100.0/100 — PASS**

- File: `cargolinx-demo-v5-film.mp4`, 15.7 MB, 153.8 s
- Picture 1920x1080 at 25 fps, h264
- Sound -16.1 LUFS integrated, true peak -1.5 dBTP

## Checks

- **Picture resolution** — pass: 1920x1080 (target: 1920x1080)
- **Frame rate** — pass: 25 fps (target: 25 fps)
- **Video codec** — pass: h264 (target: h264)
- **Audio present** — pass: aac (target: aac)
- **Duration in window** — pass: 153.8 s (target: 60-300 s)
- **Integrated loudness** — pass: -16.1 LUFS (target: -16 +/- 2 LUFS)
- **True peak** — pass: -1.5 dBTP (target: at or below -1.0 dBTP)
- **No dead shot** — pass: longest hold 1.28 s (target: no shot held still beyond 2 s)
- **Frames keep moving** — pass: smallest 2 s change 0.960, median 4.074 (target: every sampled gap changes)

Every figure above is measured from the delivered file with ffprobe and ffmpeg (ebur128, freezedetect).
Content checks — no placeholder copy, the live URL on the close card, every cited figure matching the
product's own builders — are recorded in FILM-CONTENT-QA.md.
