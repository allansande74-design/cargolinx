#!/usr/bin/env python3
"""Find which inbound video is the CargoLinx app screen recording, by OCR.

One frame per file, text read locally. Prints files whose frame contains
CargoLinx vocabulary (freight desk, quote, shipment, landed cost, AX).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR

FFMPEG = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
FFPROBE = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe"
SRC = Path("/home/amanda/.hermes/cache/documents")
TMP = Path("/home/amanda/cargolinx-v2/out/demo/work_v5film/probe")
TMP.mkdir(parents=True, exist_ok=True)

NEEDLES = ("cargolinx", "altovex", "freight", "quote", "shipment", "landed",
           "mombasa", "kampala", "cargo", "duty", "clearance", "pipeline")


def dur(p: Path) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main() -> None:
    ocr = RapidOCR()
    out = []
    for v in sorted(SRC.glob("vid_*.mp4")):
        d = dur(v)
        if d < 1:
            continue
        for frac in (0.35, 0.6):
            img = TMP / f"{v.stem}_{int(frac*100)}.jpg"
            if not img.exists():
                subprocess.run([FFMPEG, "-v", "error", "-y", "-ss", f"{d*frac:.2f}",
                                "-i", str(v), "-frames:v", "1", "-vf", "scale=1280:-1",
                                "-q:v", "3", str(img)], capture_output=True)
            if not img.exists():
                continue
            res, _ = ocr(str(img))
            text = " ".join(r[1] for r in res).lower() if res else ""
            score = sum(1 for n in NEEDLES if n in text)
            if score >= 2:
                out.append({"file": v.name, "dur": round(d, 2), "frac": frac,
                            "score": score, "text": text[:400]})
                print(f"{v.name:24s} {d:7.2f}s frac {frac}  score {score}", flush=True)
                print("   ", text[:240], flush=True)
                break
    (TMP / "hits.json").write_text(json.dumps(out, indent=2))
    print(f"candidates found: {len(out)}")


if __name__ == "__main__":
    main()
