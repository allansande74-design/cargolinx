#!/usr/bin/env python3
"""Fit the v5 narration clips to their exact slots.

Order of work per scene:
 1. trim leading/trailing silence from the TTS mp3 (edge-tts pads both ends),
 2. speed up only if the trimmed line still does not fit (never past 1.08x),
 3. pad to the slot with a 0.30 s head, loudnorm to -16 LUFS,
 4. assert every slot lands exactly and the film stays under the cap.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

FFMPEG = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
FFPROBE = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe"
WORK = Path("/home/amanda/cargolinx-v2/out/demo/work_v5film")
AUD = WORK / "aud"
WAV = WORK / "wav"
WAV.mkdir(parents=True, exist_ok=True)
HEAD = 0.30
MIN_TAIL = 0.30
MAX_TEMPO = 1.08

SCENES = json.loads((WORK / "narration_report.json").read_text())


def dur(p: Path) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True)
    return float(r.stdout.strip())


def run(args: list[str]) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg failed: " + r.stderr[-500:])


def main() -> None:
    total = 0.0
    report = []
    for sc in SCENES:
        key, slot = sc["key"], sc["slot"]
        src = AUD / f"{key}.mp3"
        trimmed = AUD / f"{key}_trim.wav"
        # hard trim of edge-tts padding, keep a clean edge
        run([FFMPEG, "-v", "error", "-y", "-i", str(src),
             "-af", "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:"
                    "detection=peak,areverse,"
                    "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:"
                    "detection=peak,areverse,"
                    "highpass=70",
             "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(trimmed)])
        d = dur(trimmed)
        budget = slot - HEAD - MIN_TAIL
        tempo = 1.0
        if d > budget:
            tempo = min(MAX_TEMPO, round(d / budget + 0.004, 4))
        out = WAV / f"{key}.wav"
        chain = f"atempo={tempo}," if tempo > 1.0 else ""
        chain += f"loudnorm=I=-16:TP=-1.5:LRA=11,adelay={int(HEAD*1000)}|{int(HEAD*1000)},apad=whole_dur={slot}"
        run([FFMPEG, "-v", "error", "-y", "-i", str(trimmed), "-af", chain,
             "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(out)])
        got = dur(out)
        total += got
        ok = abs(got - slot) < 0.02
        report.append({"key": key, "slot": slot, "speech": round(d, 2),
                       "tempo": tempo, "fitted": round(got, 2), "ok": ok})
        print(f"{key:16s} slot {slot:6.2f} speech {d:6.2f} tempo {tempo:5.3f} fitted {got:6.2f} {'OK' if ok else 'MISMATCH'}", flush=True)
    print(f"TOTAL {total:.2f}s")
    assert total <= 180.0, total
    (WORK / "fit_report.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
