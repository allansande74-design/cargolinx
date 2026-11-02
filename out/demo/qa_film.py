"""Measure the delivered film and write FILM-QA.md from real ffmpeg output.

Usage: python3 qa_film.py [file.mp4]
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

FF = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
FP = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe"
ROOT = Path(__file__).resolve().parent


def sh(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stderr + subprocess.run(
        args, capture_output=True, text=True, check=True
    ).stdout


def probe(path: Path) -> dict:
    out = subprocess.run(
        [FP, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def loudness(path: Path) -> tuple[float, float]:
    p = subprocess.run(
        [FF, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    text = p.stderr
    integrated = re.findall(r"I:\s+(-?\d+\.\d+) LUFS", text)
    peak = re.findall(r"Peak:\s+(-?\d+\.\d+) dBFS", text)
    return float(integrated[-1]), float(peak[-1])


def freezes(path: Path, seconds: float = 2.0) -> list[tuple[float, float]]:
    """Intervals held still for longer than `seconds`; shorter holds are normal graphic holds."""
    p = subprocess.run(
        [FF, "-hide_banner", "-nostats", "-i", str(path),
         "-vf", f"freezedetect=n=0.0008:d={seconds}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    starts = [float(x) for x in re.findall(r"freeze_start:\s+(\d+\.?\d*)", p.stderr)]
    ends = [float(x) for x in re.findall(r"freeze_end:\s+(\d+\.?\d*)", p.stderr)]
    return list(zip(starts, ends))


def frame_diff(path: Path, step: float = 2.0) -> tuple[float, float]:
    """Smallest and median mean-absolute difference between frames `step` seconds apart."""
    from PIL import Image, ImageChops, ImageStat
    import io

    dur = float(probe(path)["format"]["duration"])
    t = 0.0
    prev = None
    diffs = []
    while t + step < dur:
        p = subprocess.run(
            [FF, "-v", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True,
        )
        if not p.stdout:
            break
        im = Image.open(io.BytesIO(p.stdout)).convert("L")
        if prev is not None:
            diffs.append(sum(ImageStat.Stat(ImageChops.difference(prev, im)).mean))
        prev = im
        t += step
    diffs.sort()
    if not diffs:
        return 0.0, 0.0
    return diffs[0], diffs[len(diffs) // 2]


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "cargolinx-demo-v5-film.mp4"
    info = probe(path)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    dur = float(info["format"]["duration"])
    lufs, peak = loudness(path)
    frozen = freezes(path, 2.0)
    holds = freezes(path, 1.0)
    dmin, dmed = frame_diff(path)

    checks = [
        ("Picture resolution", v["width"] == 1920 and v["height"] == 1080, f"{v['width']}x{v['height']}", "1920x1080"),
        ("Frame rate", abs(eval(v["r_frame_rate"]) - 25) < 0.01, f"{eval(v['r_frame_rate']):.0f} fps", "25 fps"),
        ("Video codec", v["codec_name"] == "h264", v["codec_name"], "h264"),
        ("Audio present", bool(a) and a["codec_name"] == "aac", a["codec_name"] if a else "none", "aac"),
        ("Duration in window", 60 <= dur <= 300, f"{dur:.1f} s", "60-300 s"),
        ("Integrated loudness", -18.0 <= lufs <= -14.0, f"{lufs:.1f} LUFS", "-16 +/- 2 LUFS"),
        ("True peak", peak <= -1.0, f"{peak:.1f} dBTP", "at or below -1.0 dBTP"),
        ("No dead shot", not frozen,
         f"{len(frozen)} hold(s) over 2 s" if frozen else f"longest hold {max([b - a for a, b in holds], default=0.0):.2f} s",
         "no shot held still beyond 2 s"),
        ("Frames keep moving", dmin > 0.02, f"smallest 2 s change {dmin:.3f}, median {dmed:.3f}", "every sampled gap changes"),
    ]
    passed = sum(1 for _, ok, _, _ in checks if ok)
    lines = [
        f"# Film quality report — {path.name}",
        "",
        f"**Score {100.0 * passed / len(checks):.1f}/100 — {'PASS' if passed == len(checks) else 'REVIEW'}**",
        "",
        f"- File: `{path.name}`, {path.stat().st_size / 1e6:.1f} MB, {dur:.1f} s",
        f"- Picture {v['width']}x{v['height']} at {eval(v['r_frame_rate']):.0f} fps, {v['codec_name']}",
        f"- Sound {lufs:.1f} LUFS integrated, true peak {peak:.1f} dBTP",
        "",
        "## Checks",
        "",
    ]
    for name, ok, got, target in checks:
        lines.append(f"- **{name}** — {'pass' if ok else 'FAIL'}: {got} (target: {target})")
    lines += [
        "",
        "Every figure above is measured from the delivered file with ffprobe and ffmpeg (ebur128, freezedetect).",
        "Content checks — no placeholder copy, the live URL on the close card, every cited figure matching the",
        "product's own builders — are recorded in FILM-CONTENT-QA.md.",
    ]
    (ROOT / "FILM-QA.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[3:6]))
    print(f"score {100.0 * passed / len(checks):.1f}")


if __name__ == "__main__":
    main()
