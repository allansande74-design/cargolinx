#!/usr/bin/env python3
"""Build the v5 film audio master: narration bed + generated ambient pad.

Voice: the 15 fitted scene wavs, butt-joined (each already carries its 0.30 s head
and its breath tail), so the file is exactly the sum of the slots.
Music: synthesised here from sine layers — generated, not licensed stock — ducked
under the voice with a sidechain compressor, 3 s fade in and out at the ends.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

FFMPEG = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
FFPROBE = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe"
WORK = Path("/home/amanda/cargolinx-v2/out/demo/work_v5film")
WAV = WORK / "wav"
OUT = WORK / "audio"
OUT.mkdir(parents=True, exist_ok=True)
TOTAL = 153.84


def run(args: list[str]) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg failed: " + r.stderr[-800:])


def dur(p: Path) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True)
    return float(r.stdout.strip())


def voice_bed() -> Path:
    files = sorted(WAV.glob("*.wav"))
    assert len(files) == 15, [f.name for f in files]
    lst = OUT / "voice_list.txt"
    lst.write_text("".join(f"file '{f}'\n" for f in files))
    out = OUT / "voice_full.wav"
    run([FFMPEG, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(out)])
    d = dur(out)
    print(f"voice bed {d:.2f}s (expect {TOTAL:.2f})", flush=True)
    assert abs(d - TOTAL) < 0.06, d
    return out


def music_bed() -> Path:
    """Three slow sine layers, an octave apart, breathing via tremolo."""
    out = OUT / "music_full.wav"
    graph = (
        f"sine=frequency=110:duration={TOTAL}:sample_rate=44100[a];"
        f"sine=frequency=164.81:duration={TOTAL}:sample_rate=44100[b];"
        f"sine=frequency=220:duration={TOTAL}:sample_rate=44100[c];"
        f"sine=frequency=329.63:duration={TOTAL}:sample_rate=44100[d];"
        "[a]volume=0.30,tremolo=f=0.10:d=0.5[a1];"
        "[b]volume=0.20,tremolo=f=0.12:d=0.6[b1];"
        "[c]volume=0.14,tremolo=f=0.15:d=0.55[c1];"
        "[d]volume=0.06,tremolo=f=0.11:d=0.7[d1];"
        "[a1][b1][c1][d1]amix=inputs=4:normalize=0,"
        "lowpass=f=1200,aecho=0.7:0.6:420|780:0.32|0.18,"
        f"afade=t=in:st=0:d=3,afade=t=out:st={TOTAL-3:.2f}:d=3,"
        "alimiter=limit=0.6,"
        f"aformat=sample_rates=44100:channel_layouts=stereo[out]"
    )
    run([FFMPEG, "-v", "error", "-y", "-filter_complex", graph, "-map", "[out]",
         "-t", f"{TOTAL}", "-c:a", "pcm_s16le", str(out)])
    print(f"music bed {dur(out):.2f}s", flush=True)
    return out


def master(voice: Path, music: Path) -> Path:
    out = OUT / "master.wav"
    graph = (
        "[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.0[voice];"
        "[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.62[mus];"
        "[mus][voice]sidechaincompress=threshold=0.045:ratio=6:attack=12:release=380:"
        "makeup=1[duck];"
        "[voice][duck]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,"
        f"afade=t=out:st={TOTAL-1.2:.2f}:d=1.2,apad=whole_dur={TOTAL}[out]"
    )
    run([FFMPEG, "-v", "error", "-y", "-i", str(voice), "-i", str(music),
         "-filter_complex", graph, "-map", "[out]", "-t", f"{TOTAL}",
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(out)])
    d = dur(out)
    print(f"master {d:.2f}s", flush=True)
    return out


if __name__ == "__main__":
    v = voice_bed()
    m = music_bed()
    out = master(v, m)
    print(json.dumps({"master": str(out), "duration": round(dur(out), 2)}))
