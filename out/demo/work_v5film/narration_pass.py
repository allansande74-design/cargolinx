#!/usr/bin/env python3
"""CargoLinx demo v5 — narration pass. Generates one clip per scene, measures it
against the slot, and writes word-timed subtitles for burned-in captions.

Voice: en-GB-RyanNeural (neural British male narrator).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

EDGE = "/home/amanda/.hermes/installs/b986bac74c95272e/environments/b62e2ab32c2245889d606557b9eaf499/venv/bin/edge-tts"
FFPROBE = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe"
VOICE = "en-GB-RyanNeural"
RATE = "+8%"

WORK = Path("/home/amanda/cargolinx-v2/out/demo/work_v5film")
AUD = WORK / "aud"
AUD.mkdir(parents=True, exist_ok=True)

# (key, slot seconds, narration) — words final, do not edit
SCENES = [
    ("01_title", 7.53, "Altovex CargoLinx. Freight that prices itself before it moves, in English and Kiswahili."),
    ("02_team", 13.81, "CargoLinx is built by Sande Allan, founder of Altovex Global Logistics Company Limited in Nairobi, with Amanda, an AI orchestrator running on Meta models. One human founder. One AI team."),
    ("03_loading", 14.78, "It starts at loading. A simple quote takes two days. Four different people retype the same figures. Nobody can prove the margin, so the buyer doesn't believe the number, and the deal slows down before the truck has even moved."),
    ("04_transit", 12.46, "Then the cargo goes into transit. When the network drops, the file goes dark. Trucks wait one to four days at the border, seals get disputed, and almost half of them drive home empty."),
    ("05_border", 12.53, "At the border, release is a paperwork problem. A wrong HS code or a missed treaty waiver costs real money, and paperwork shuts out the traders and drivers who need it most."),
    ("06_beforeafter", 9.50, "Before CargoLinx: two days, four people, and a number nobody trusts. After: one entry, and a priced, documented quote in minutes."),
    ("07_solution", 9.35, "CargoLinx fixes this with one entry, read by everything: from the quote, to the order, the documents, clearance, delivery, and proof."),
    ("08_voice", 11.51, "A driver simply sends a voice note. Muse Voice Transcribe turns it into a structured cargo record, origin, destination, cargo and quantity, without typing a word."),
    ("09_sam", 10.61, "Next, a photo of the load. SAM 3.1 segments the cargo and the seal, so the count and the seal status go straight into the file."),
    ("10_spark", 12.37, "Muse Spark prices every line, with its base and its rate: freight, insurance, duty, levies and VAT. Then it explains the quote in plain English the buyer can trust."),
    ("11_image", 4.50, "Muse Image draws the quote card, ready to share."),
    ("12_offline", 4.95, "No signal? The desk keeps working, and syncs exactly once."),
    ("13_git", 10.59, "Everything shown here was built between the twenty-seventh of October and the fourth of November. The full commit log is public, so you can check every line."),
    ("14_impact", 12.18, "This is built for importers, clearing agents, financiers and drivers on the Northern Corridor. A defensible price in minutes, not days, and a file that survives scrutiny."),
    ("15_close", 7.17, "Altovex CargoLinx. Built for our world, and ready for yours."),
]


def dur(p: Path) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", str(p)], capture_output=True, text=True)
    return float(r.stdout.strip())


def speak(key: str, text: str) -> tuple[Path, Path]:
    mp3 = AUD / f"{key}.mp3"
    vtt = AUD / f"{key}.vtt"
    if not mp3.exists():
        r = subprocess.run([EDGE, "--voice", VOICE, "--rate", RATE,
                            "--text", text, "--write-media", str(mp3),
                            "--write-subtitles", str(vtt)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"tts failed {key}: {r.stderr[:300]}")
    return mp3, vtt


def main() -> None:
    rows = []
    total = 0.0
    for key, slot, text in SCENES:
        mp3, vtt = speak(key, text)
        d = dur(mp3)
        words = len(text.split())
        total += slot
        head = 0.3
        tail = slot - head - d
        rows.append({"key": key, "slot": slot, "audio": round(d, 2),
                     "tail": round(tail, 2), "wpm": round(words / d * 60, 1),
                     "words": words})
        flag = "OK" if tail >= 0.4 else ("TIGHT" if tail >= 0.05 else "OVER")
        print(f"{key:16s} slot {slot:6.2f}  aud {d:6.2f}  head 0.30  tail {tail:6.2f}  {words:3d}w  {words/d*60:5.1f}wpm  {flag}", flush=True)
    print(f"TOTAL SLOT {total:.2f}s")
    (WORK / "narration_report.json").write_text(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
