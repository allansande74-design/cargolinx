#!/usr/bin/env python3
"""CargoLinx demo v5 — fifteen scenes to the owner's final script, 153.84 s.

Picture is drawn frame by frame and piped straight into ffmpeg (no 4000 loose
PNGs on disk). The audio master was built first; the picture is cut to it, so the
film cannot drift. Every scene carries the slide counter NN / 15.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, "/home/amanda/swarm/hackathon")
import animate_demo as ad  # noqa: E402
from animate_demo import (GOLD, H, LINE, MUTED, NAVY, NAVY_2, SOFT, W, WHITE,  # noqa: E402
                          Frame, span)
from PIL import Image  # noqa: E402

FFMPEG = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"

# --- speed: cache font handles and never re-decode a photo 3846 times ---------
import functools  # noqa: E402

ad.font = functools.lru_cache(maxsize=512)(ad.font)
_FONT0 = ad.font

_ASSET_CACHE: dict[tuple, Image.Image] = {}


def _fit_cached(path: Path, w: int, h: int) -> Image.Image:
    key = (str(path), w, h)
    hit = _ASSET_CACHE.get(key)
    if hit is None:
        hit = _fit_uncached(path, w, h)
        _ASSET_CACHE[key] = hit
    return hit


def _fit_uncached(path: Path, w: int, h: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    iw, ih = im.size
    s = max(w / iw, h / ih)
    im = im.resize((int(iw * s + 0.5), int(ih * s + 0.5)), Image.LANCZOS)
    left = (im.size[0] - w) // 2
    top = (im.size[1] - h) // 3
    return im.crop((left, top, left + w, top + h))
WORK = Path("/home/amanda/cargolinx-v2/out/demo/work_v5film")
AUDIO = WORK / "audio" / "master.wav"
OUT = Path("/home/amanda/cargolinx-v2/out/demo/cargolinx-demo-v5-film.mp4")
FPS = 25
N = 15

ALLAN = Path("/home/amanda/out/brand_src/allan passport picture best.jpg")
MONO = Path("/home/amanda/out/4k/amanda-monogram-4k.png")
SHOT_HOME = WORK / "shots" / "app_home.png"
SHOT_DESK = WORK / "shots" / "app_deskquotes.png"
IMG_PROOF = Path("/home/amanda/out/evidence/meta_image_proof.png")

SLOTS = json.loads((WORK / "fit_report.json").read_text())
DURS = {r["key"]: r["slot"] for r in SLOTS}
TOTAL = sum(DURS.values())
assert TOTAL <= 180.0, TOTAL

# hashes read off the published repo (origin main) after the CI strip, 1 Nov
GIT_LINES = [
    ("271ddb9", "repo: only the two submission cuts stay tracked"),
    ("aeb4836", "repo: build intermediates out of the tree"),
    ("822c972", "demo: v5 film - 15 scenes, 153.84 s"),
    ("3a65d5c", "demo: v11 - his own narrator lines, no bleed"),
    ("7442083", "build: bed slot table corrected"),
    ("623ccc4", "demo: v10 - name plate below the portrait"),
    ("8674fbd", "demo: v6 audio-first rebuild, real-voice bed"),
]

LADDER = [
    ("Goods, customs value", "", "1,200,000.00"),
    ("International freight", "", "250,000.00"),
    ("Marine insurance", "0.50%", "7,250.00"),
    ("CIF, customs value", "", "1,457,250.00"),
    ("Import duty, EAC CET", "25%", "364,312.50"),
    ("Import declaration fee", "2.5%", "36,431.25"),
    ("Railway development levy", "2%", "29,145.00"),
    ("VAT", "16%", "301,942.20"),
    ("PVoC conformity", "", "34,404.95"),
]

CAPTIONS: dict[str, list[str]] = {}


def load_captions() -> None:
    """Sentence cues straight from the TTS, so the caption cannot disagree with the voice."""
    for r in SLOTS:
        key = r["key"]
        vtt = WORK / "aud" / f"{key}.vtt"
        lines: list[str] = []
        if vtt.exists():
            for block in vtt.read_text().split("\n\n"):
                rows = [x for x in block.strip().split("\n") if x]
                if len(rows) >= 3:
                    lines.append(" ".join(rows[2:]))
        CAPTIONS[key] = lines


def caption_for(key: str, p: float) -> str:
    cues = CAPTIONS.get(key) or []
    if not cues:
        return ""
    # two cues per scene at most: first until 58% of the scene, then the rest
    if len(cues) == 1:
        return cues[0]
    return cues[0] if p < 0.58 else " ".join(cues[1:])


def footer(f: Frame, index: int, caption: str = "", alpha=1.0) -> None:
    f.d.rectangle([0, H - 158, W, H], fill=(5, 19, 38))
    if caption:
        f.wrap(72, H - 148, W - 320, caption, 30, leading=38, weight="r", color=(226, 233, 243), alpha=alpha)
    else:
        f.text(72, H - 132, "ALTOVEX GLOBAL LOGISTICS", 24, "sb", GOLD, alpha=alpha)
    f.d.rectangle([72, H - 30, 128, H - 24], fill=GOLD)
    f.text(148, H - 44, "Altovex CargoLinx", 20, "r", MUTED, alpha=alpha)
    f.text(W - 72, H - 44, f"{index:02d} / {N:02d}", 22, "sb", SOFT, anchor="ra", alpha=alpha)


def label_chip(f: Frame, x: int, y: int, text: str, color=GOLD, alpha=1.0, size=20):
    wpx = int(f.d.textlength(text, font=ad.font("sb", size)))
    f.d.rounded_rectangle([x, y, x + wpx + 36, y + 40], radius=8,
                          outline=color, width=2)
    f.text(x + 18, y + 8, text, size, "sb", color, alpha=alpha)
    return x + wpx + 48


def fit_image(path: Path, w: int, h: int) -> Image.Image:
    return _fit_cached(path, w, h).copy()


def card_shot(f: Frame, path: Path, x: int, y: int, w: int, h: int, alpha=1.0):
    if not path.exists():
        return
    shot = fit_image(path, w, h)
    if alpha < 0.99:
        shot = Image.blend(Image.new("RGB", shot.size, NAVY), shot, alpha)
    f.im.paste(shot, (x, y))
    f.d.rectangle([x, y, x + w, y + h], outline=GOLD, width=4)


def banner(f: Frame, text: str, alpha=1.0, y=88):
    f.text(72, y, text, 26, "sb", GOLD, alpha=alpha)


# ----------------------------------------------------------------- scene 01
def s01(p, f):
    banner(f, "ALTOVEX GLOBAL LOGISTICS")
    f.text(72, 150 + int(16 * (1 - ad.ease(min(1, p * 3)))), "CargoLinx", 190, "b", WHITE,
           alpha=min(1, p * 3))
    f.text(72, 400, "Freight that prices itself before it moves.", 52, "r", SOFT,
           alpha=span(p, 0.12, 0.32))
    f.text(72, 480, "Startups track · Build for Your World", 34, "sb", GOLD,
           alpha=span(p, 0.2, 0.4))
    f.text(72, 548, "English & Kiswahili · online & offline · Nairobi, Kenya", 30, "r", MUTED,
           alpha=span(p, 0.3, 0.5))
    card_shot(f, SHOT_HOME, 980, 300, 868, 488, alpha=span(p, 0.45, 0.8) * 0.96)
    f.text(980, 806, "the running build, on this device", 22, "r", MUTED, alpha=span(p, 0.6, 0.85))


# ----------------------------------------------------------------- scene 02
def s02(p, f):
    banner(f, "THE TEAM")
    PW, PH, PX, PY = 620, 560, 72, 176
    try:
        al = fit_image(ALLAN, PW, PH)
        f.im.paste(al, (PX, PY))
    except Exception:
        pass
    f.d.rectangle([PX, PY, PX + PW, PY + PH], outline=GOLD, width=4)
    f.d.rounded_rectangle([PX, PY + PH + 24, PX + PW, PY + PH + 172], radius=12, fill=NAVY_2)
    f.d.rectangle([PX, PY + PH + 24, PX + PW, PY + PH + 30], fill=GOLD)
    f.text(PX + 26, PY + PH + 46, "Sande Allan", 42, "b", WHITE, alpha=span(p, 0.1, 0.3))
    f.text(PX + 26, PY + PH + 102, "Founder & CTO · Altovex Global", 24, "r", SOFT, alpha=span(p, 0.15, 0.35))
    f.text(PX + 26, PY + PH + 134, "Logistics Co. Ltd · Nairobi, Kenya", 24, "r", SOFT, alpha=span(p, 0.15, 0.35))

    CX, CY, CW, CH = 800, 176, 1048, 560
    f.card(CX, CY, CW, CH, alpha=min(1, p * 4))
    if MONO.exists():
        mono = fit_image(MONO, 150, 150)
        f.im.paste(mono, (CX + 40, CY + 40))
        f.d.rectangle([CX + 40, CY + 40, CX + 190, CY + 190], outline=GOLD, width=3)
    f.text(CX + 220, CY + 54, "AMANDA", 64, "b", WHITE, alpha=min(1, p * 4))
    f.text(CX + 220, CY + 134, "AI orchestrator · multi-agent swarm", 28, "r", GOLD, alpha=span(p, 0.2, 0.4))
    f.text(CX + 220, CY + 172, "on Meta models", 28, "r", GOLD, alpha=span(p, 0.2, 0.4))
    f.text(CX + 40, CY + 250, "Software, not a person · no human likeness", 26, "sb", SOFT,
           alpha=span(p, 0.35, 0.55))
    rows = ["Reads the engine figures, never invents a price",
            "English and Kiswahili, on device or offline",
            "Raises the quote, the documents and the proof"]
    for i, r in enumerate(rows):
        a = span(p, 0.45 + i * 0.08, 0.65 + i * 0.08)
        f.text(CX + 40, CY + 310 + i * 54, "›", 30, "b", GOLD, alpha=a)
        f.text(CX + 78, CY + 312 + i * 54, r, 26, "r", SOFT, alpha=a)
    f.text(CX + 40, CY + 490, "One human founder. One AI team.", 28, "sb", WHITE, alpha=span(p, 0.7, 0.9))


# ----------------------------------------------------------------- scene 03
def s03(p, f):
    banner(f, "01 · AT LOADING")
    f.text(72, 160, "The quote is a phone call and a guess.", 60, "b", WHITE, alpha=span(p, 0.02, 0.2))
    pains = [("01", "A simple quote takes two days"),
             ("02", "Four people retype the same figures"),
             ("03", "Nobody can prove the margin"),
             ("04", "The buyer does not believe the number")]
    for i, (n, t) in enumerate(pains):
        a = span(p, 0.18 + i * 0.12, 0.36 + i * 0.12)
        y = 300 + i * 118
        f.card(72, y, 1060, 96, alpha=a)
        f.text(104, y + 26, n, 30, "b", GOLD, alpha=a)
        f.text(176, y + 24, t, 32, "r", SOFT, alpha=a)
    label_chip(f, 72, 786, "ILLUSTRATIVE · AI-GENERATED", alpha=span(p, 0.6, 0.8))
    card_shot(f, SHOT_DESK, 1180, 300, 668, 376, alpha=span(p, 0.55, 0.85) * 0.9)


# ----------------------------------------------------------------- scene 04
def s04(p, f):
    banner(f, "02 · IN TRANSIT")
    f.text(72, 160, "The file goes dark when the truck does.", 58, "b", WHITE, alpha=span(p, 0.02, 0.2))
    stops = ["Mombasa", "Nairobi", "Eldoret", "Malaba", "Kampala"]
    x0, y = 110, 330
    step = 380
    for i, s in enumerate(stops):
        a = span(p, 0.1 + i * 0.1, 0.28 + i * 0.1)
        cx = x0 + i * step
        f.d.ellipse([cx - 12, y - 12, cx + 12, y + 12], fill=GOLD if a > 0.5 else (40, 60, 90))
        f.text(cx, y + 34, s, 26, "sb", WHITE, anchor="ma", alpha=a)
        if i < len(stops) - 1:
            col = (216, 161, 58) if i < 2 else (70, 88, 116)
            f.d.line([(cx + 16, y), (cx + step - 16, y)], fill=col, width=3)
    f.d.rectangle([x0 + 2 * step + 30, y - 96, x0 + 3 * step - 30, y + 96], outline=(220, 90, 90), width=3)
    f.text(x0 + int(2.5 * step), y - 30, "NO SIGNAL", 30, "sb", (235, 130, 130), anchor="ma", alpha=span(p, 0.45, 0.65))
    rows = ["05 · No live position, the customer chases news",
            "06 · Trucks wait one to four days at the border",
            "07 · Seals get disputed, the file cannot prove it",
            "08 · Almost half the trucks drive home empty"]
    for i, t in enumerate(rows):
        a = span(p, 0.4 + i * 0.1, 0.58 + i * 0.1)
        f.text(110, 500 + i * 62, t, 30, "r", SOFT, alpha=a)
    label_chip(f, 110, 786, "ILLUSTRATIVE · AI-GENERATED", alpha=span(p, 0.7, 0.9))


# ----------------------------------------------------------------- scene 05
def s05(p, f):
    banner(f, "03 · AT THE BORDER")
    f.text(72, 160, "Release is a paperwork problem.", 60, "b", WHITE, alpha=span(p, 0.02, 0.2))
    f.card(72, 300, 1080, 300, alpha=span(p, 0.15, 0.35))
    f.text(112, 336, "Malaba OSBP gate", 28, "sb", GOLD, alpha=span(p, 0.2, 0.4))
    rows = [("09", "A wrong HS code costs real money on the spot"),
            ("10", "A missed treaty waiver is paid by the trader")]
    for i, (n, t) in enumerate(rows):
        a = span(p, 0.3 + i * 0.12, 0.5 + i * 0.12)
        f.text(112, 400 + i * 86, n, 28, "b", GOLD, alpha=a)
        f.text(180, 398 + i * 86, t, 30, "r", SOFT, alpha=a)
    f.text(72, 660, "And paperwork shuts out the traders and drivers", 34, "r", SOFT, alpha=span(p, 0.6, 0.78))
    f.text(72, 710, "who need it most.", 34, "r", SOFT, alpha=span(p, 0.66, 0.84))
    label_chip(f, 72, 786, "ILLUSTRATIVE · AI-GENERATED", alpha=span(p, 0.7, 0.9))
    card_shot(f, SHOT_DESK, 1220, 300, 628, 353, alpha=span(p, 0.5, 0.8) * 0.85)


# ----------------------------------------------------------------- scene 06
def s06(p, f):
    banner(f, "BEFORE AND AFTER")
    f.text(72, 160, "Two days becomes minutes.", 56, "b", WHITE, alpha=span(p, 0.02, 0.2))
    # left: before
    f.card(72, 280, 740, 480, alpha=span(p, 0.1, 0.3), fill=(22, 30, 44), outline=(46, 58, 76))
    f.text(104, 306, "BEFORE", 30, "sb", (150, 162, 182), alpha=span(p, 0.15, 0.35))
    for i, t in enumerate(["2 days to a quote", "4 people retyping", "no proof of the margin"]):
        a = span(p, 0.2 + i * 0.1, 0.4 + i * 0.1)
        f.text(104, 380 + i * 96, "—", 30, "b", (110, 124, 146), alpha=a)
        f.text(160, 378 + i * 96, t, 32, "r", (170, 182, 200), alpha=a)
    # right: after, real app
    f.card(860, 280, 988, 480, alpha=span(p, 0.3, 0.5))
    f.text(892, 300, "AFTER", 30, "sb", GOLD, alpha=span(p, 0.35, 0.55))
    card_shot(f, SHOT_DESK, 892, 352, 924, 380, alpha=span(p, 0.4, 0.7))
    f.text(892, 744 - 160, "", 20, "r", MUTED, alpha=0)
    f.text(892, 742, "one entry · priced quote · documents", 24, "r", GOLD, alpha=span(p, 0.65, 0.85))
    f.text(72, 800, "Screen capture from the running build", 20, "r", MUTED, alpha=span(p, 0.7, 0.9))


# ----------------------------------------------------------------- scene 07
def s07(p, f):
    banner(f, "THE SOLUTION")
    f.text(72, 160, "One entry. Read by everything.", 60, "b", WHITE, alpha=span(p, 0.02, 0.2))
    stages = ["Quote", "Order", "Documents", "Clearance", "Delivery", "Proof"]
    for i, s in enumerate(stages):
        a = span(p, 0.15 + i * 0.1, 0.33 + i * 0.1)
        x = 72 + i * 296
        f.card(x, 300, 256, 120, alpha=a)
        f.text(x + 24, 330, s, 32, "sb", WHITE if i % 2 == 0 else SOFT, alpha=a)
        if i < len(stages) - 1:
            f.d.line([(x + 256, 360), (x + 288, 360)], fill=GOLD, width=3)
    card_shot(f, SHOT_HOME, 72, 470, 1320, 300, alpha=span(p, 0.5, 0.8) * 0.9)
    f.text(1430, 470, "the desk", 26, "r", MUTED, alpha=span(p, 0.55, 0.8))
    f.text(1430, 508, "as it runs", 26, "r", MUTED, alpha=span(p, 0.6, 0.85))
    f.text(1430, 546, "today", 26, "r", MUTED, alpha=span(p, 0.65, 0.9))


# ----------------------------------------------------------------- scene 08
def s08(p, f):
    banner(f, "04 · VOICE TO RECORD")
    label_chip(f, 72, 140, "META MODEL · MUSE VOICE TRANSCRIBE 1.0", color=GOLD)
    f.text(72, 220, "A driver sends a voice note.", 56, "b", WHITE, alpha=span(p, 0.02, 0.18))
    # waveform of a real recording
    import math
    for i in range(64):
        a = span(p, 0.1 + i * 0.004, 0.2 + i * 0.004)
        hh = int(18 + 46 * abs(math.sin(i * 0.7)) * abs(math.sin(i * 0.21 + 1)))
        f.d.rectangle([90 + i * 12, 330 - hh, 90 + i * 12 + 6, 330 + hh],
                      fill=(int(GOLD[0] * a), int(GOLD[1] * a), int(GOLD[2] * a)))
    f.text(90, 380, "recorded voice note · real audio", 22, "r", MUTED, alpha=span(p, 0.3, 0.5))
    rows = [("Origin", "Mombasa"), ("Destination", "Kampala"), ("Cargo", "20 ft container, solar panels"), ("Quantity", "1")]
    for i, (k, v) in enumerate(rows):
        a = span(p, 0.3 + i * 0.1, 0.5 + i * 0.1)
        y = 450 + i * 76
        f.card(72, y, 860, 64, alpha=a, fill=(16, 44, 78))
        f.text(100, y + 16, k, 24, "sb", GOLD, alpha=a)
        f.text(300, y + 16, v, 26, "r", SOFT, alpha=a)
    card_shot(f, SHOT_DESK, 980, 300, 868, 380, alpha=span(p, 0.55, 0.85) * 0.92)
    f.text(980, 700, "Recorded live call · 31 Oct 2026 · 1,040 ms of audio accepted",
           21, "r", MUTED, alpha=span(p, 0.7, 0.9))


# ----------------------------------------------------------------- scene 09
def s09(p, f):
    banner(f, "05 · CARGO AND SEAL")
    label_chip(f, 72, 140, "META MODEL · SAM 3.1", color=GOLD)
    f.text(72, 220, "A photo of the load, segmented.", 56, "b", WHITE, alpha=span(p, 0.02, 0.18))
    if IMG_PROOF.exists():
        card_shot(f, IMG_PROOF, 72, 320, 900, 420, alpha=span(p, 0.15, 0.45))
    rows = [("Cargo counted", "boxes returned by the model"),
            ("Seal status", "recorded against the shipment"),
            ("Both", "written into the same file")]
    for i, (k, v) in enumerate(rows):
        a = span(p, 0.35 + i * 0.12, 0.55 + i * 0.12)
        y = 340 + i * 116
        f.card(1010, y, 838, 96, alpha=a)
        f.text(1042, y + 18, k, 28, "sb", WHITE, alpha=a)
        f.text(1042, y + 56, v, 22, "r", SOFT, alpha=a)
    f.text(72, 770, "Recorded live call · 31 Oct 2026 · box and mask geometry returned",
           21, "r", MUTED, alpha=span(p, 0.7, 0.9))


# ----------------------------------------------------------------- scene 10
def s10(p, f):
    banner(f, "06 · PRICE, LINE BY LINE")
    label_chip(f, 72, 140, "META MODEL · MUSE SPARK 1.3", color=GOLD)
    f.text(72, 212, "Every line, with its base and its rate.", 48, "b", WHITE, alpha=span(p, 0.02, 0.18))
    for i, (name, rate, val) in enumerate(LADDER):
        a = span(p, 0.1 + i * 0.07, 0.26 + i * 0.07)
        y = 292 + i * 52
        if i % 2 == 0:
            f.d.rectangle([72, y - 4, 1130, y + 42], fill=(12, 36, 64))
        f.text(92, y + 4, name, 24, "r", SOFT, alpha=a)
        f.text(660, y + 4, rate, 24, "r", GOLD, alpha=a)
        f.text(1108, y + 4, val, 24, "sb", WHITE, anchor="ra", alpha=a)
    f.d.line([(72, 292 + len(LADDER) * 52 - 6), (1130, 292 + len(LADDER) * 52 - 6)], fill=GOLD, width=2)
    f.text(92, 292 + len(LADDER) * 52 + 8, "Landed before VAT", 26, "sb", WHITE, alpha=span(p, 0.75, 0.9))
    f.text(1108, 292 + len(LADDER) * 52 + 8, "KES 1,921,543.70", 26, "sb", GOLD, anchor="ra",
           alpha=span(p, 0.75, 0.9))
    f.text(1170, 300, "Then it explains the quote", 28, "sb", WHITE, alpha=span(p, 0.6, 0.78))
    f.text(1170, 344, "in plain English the buyer", 28, "r", SOFT, alpha=span(p, 0.64, 0.82))
    f.text(1170, 382, "can trust.", 28, "r", SOFT, alpha=span(p, 0.68, 0.86))
    f.text(1170, 470, "Landed cost before VAT is", 22, "r", MUTED, alpha=span(p, 0.8, 0.95))
    f.text(1170, 500, "settled before a price is", 22, "r", MUTED, alpha=span(p, 0.82, 0.96))
    f.text(1170, 530, "ever quoted.", 22, "r", MUTED, alpha=span(p, 0.84, 0.97))


# ----------------------------------------------------------------- scene 11
def s11(p, f):
    banner(f, "07 · THE CARD THE BUYER GETS")
    label_chip(f, 72, 140, "META MODEL · MUSE IMAGE 1.0", color=GOLD)
    f.text(72, 220, "Muse Image draws the quote card.", 54, "b", WHITE, alpha=span(p, 0.02, 0.2))
    if IMG_PROOF.exists():
        card_shot(f, IMG_PROOF, 760, 300, 1088, 508, alpha=span(p, 0.1, 0.4))
    f.text(72, 340, "KES 3,184,272.42", 58, "b", GOLD, alpha=span(p, 0.2, 0.45))
    f.text(72, 420, "at 30% margin", 30, "r", SOFT, alpha=span(p, 0.3, 0.5))
    f.text(72, 520, "AI-generated · made live", 22, "r", MUTED, alpha=span(p, 0.4, 0.6))


# ----------------------------------------------------------------- scene 12
def s12(p, f):
    banner(f, "08 · NO SIGNAL, NO PROBLEM")
    f.text(72, 180, "The desk keeps working.", 56, "b", WHITE, alpha=span(p, 0.02, 0.2))
    off = p < 0.5
    f.card(72, 320, 520, 150, alpha=1.0, fill=(26, 40, 60) if off else NAVY_2)
    f.text(104, 348, "OFFLINE — WRITES QUEUED 1", 26, "sb", (235, 190, 120) if off else MUTED)
    f.card(660, 320, 520, 150, alpha=1.0, fill=NAVY_2 if off else (18, 56, 46))
    f.text(692, 348, "ONLINE — SYNCED 1", 26, "sb", MUTED if off else (140, 220, 170))
    f.text(72, 540, "Writes queue on the device with an idempotency key", 26, "r", SOFT, alpha=span(p, 0.2, 0.4))
    f.text(72, 590, "and drain on reconnect, without a second row.", 26, "r", SOFT, alpha=span(p, 0.3, 0.5))
    card_shot(f, SHOT_DESK, 1240, 320, 608, 300, alpha=span(p, 0.4, 0.7) * 0.9)


# ----------------------------------------------------------------- scene 13
def s13(p, f):
    banner(f, "09 · BUILT IN THE OPEN")
    f.text(72, 160, "27 October to 4 November 2026.", 54, "b", WHITE, alpha=span(p, 0.02, 0.2))
    f.d.rounded_rectangle([72, 270, 1180, 790], radius=14, fill=(4, 14, 28), outline=LINE, width=2)
    f.text(100, 288, "git log --since=2026-10-27 --until=2026-11-05 --oneline", 20, "r", GOLD,
           alpha=span(p, 0.1, 0.25))
    for i, (h, s) in enumerate(GIT_LINES):
        a = span(p, 0.15 + i * 0.07, 0.3 + i * 0.07)
        f.text(100, 334 + i * 62, h, 22, "sb", (150, 200, 255), alpha=a)
        f.text(230, 334 + i * 62, s, 22, "r", SOFT, alpha=a)
    f.text(100, 748, "... 48 commits in the window", 20, "r", MUTED, alpha=span(p, 0.7, 0.85))
    f.text(1230, 300, "Code", 26, "sb", GOLD, alpha=span(p, 0.4, 0.6))
    f.text(1230, 340, "github.com/allansande74-", 24, "r", WHITE, alpha=span(p, 0.45, 0.65))
    f.text(1230, 376, "design/cargolinx", 24, "r", WHITE, alpha=span(p, 0.45, 0.65))
    f.text(1230, 440, "CHANGELOG-HACKATHON.md", 22, "r", SOFT, alpha=span(p, 0.55, 0.75))
    f.text(1230, 520, "The full commit log is public,", 22, "r", MUTED, alpha=span(p, 0.6, 0.8))
    f.text(1230, 552, "so you can check every line.", 22, "r", MUTED, alpha=span(p, 0.64, 0.84))


# ----------------------------------------------------------------- scene 14
def s14(p, f):
    banner(f, "IMPACT")
    f.text(72, 160, "A defensible price in minutes,", 56, "b", WHITE, alpha=span(p, 0.02, 0.2))
    f.text(72, 226, "not days.", 56, "b", GOLD, alpha=span(p, 0.06, 0.24))
    people = ["Importers & traders", "Clearing agents", "Financiers", "Drivers"]
    for i, t in enumerate(people):
        a = span(p, 0.2 + i * 0.1, 0.4 + i * 0.1)
        x = 72 + (i % 2) * 470
        y = 340 + (i // 2) * 120
        f.card(x, y, 430, 92, alpha=a)
        f.text(x + 28, y + 26, t, 30, "sb", WHITE, alpha=a)
    f.text(72, 620, "On the Northern Corridor, and a file that survives scrutiny.",
           28, "r", SOFT, alpha=span(p, 0.6, 0.8))
    card_shot(f, SHOT_HOME, 1080, 300, 768, 432, alpha=span(p, 0.5, 0.8) * 0.9)


# ----------------------------------------------------------------- scene 15
def s15(p, f):
    banner(f, "ALTOVEX GLOBAL LOGISTICS")
    f.text(72, 170, "CargoLinx", 150, "b", WHITE, alpha=min(1, p * 4))
    f.text(72, 400, "Built for our world, and ready for yours.", 46, "r", SOFT, alpha=span(p, 0.08, 0.3))
    f.text(72, 500, "Live", 24, "sb", GOLD, alpha=span(p, 0.2, 0.4))
    f.text(180, 496, "allansande74-design.github.io/cargolinx", 28, "b", WHITE, alpha=span(p, 0.22, 0.42))
    f.text(72, 556, "Code", 24, "sb", GOLD, alpha=span(p, 0.28, 0.46))
    f.text(180, 552, "github.com/allansande74-design/cargolinx", 30, "r", SOFT, alpha=span(p, 0.3, 0.48))
    f.text(72, 640, "Seeking pilots, conformity testing and working capital", 30, "r", WHITE,
           alpha=span(p, 0.4, 0.6))
    f.text(72, 690, "altovexgl@gmail.com · +254 718 554 383 · Nairobi, Kenya", 26, "r", MUTED,
           alpha=span(p, 0.46, 0.66))
    f.text(72, 790, "Narration: AI-generated voice", 20, "r", MUTED, alpha=span(p, 0.55, 0.75))
    if p > 0.83:
        q = span(p, 0.83, 1.0)
        veil = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * q)))
        f.im = Image.alpha_composite(f.im.convert("RGBA"), veil).convert("RGB")
        f.d = ImageDraw.Draw(f.im)


SCENES = [("01_title", s01), ("02_team", s02), ("03_loading", s03), ("04_transit", s04),
          ("05_border", s05), ("06_beforeafter", s06), ("07_solution", s07), ("08_voice", s08),
          ("09_sam", s09), ("10_spark", s10), ("11_image", s11), ("12_offline", s12),
          ("13_git", s13), ("14_impact", s14), ("15_close", s15)]

from PIL import ImageDraw  # noqa: E402  (used by the close-card fade)


def main() -> None:
    load_captions()
    assert [k for k, _ in SCENES] == [r["key"] for r in SLOTS], "scene order does not match slots"
    total_frames = sum(int(round(DURS[k] * FPS)) for k, _ in SCENES)
    print(f"total {TOTAL:.2f}s, {total_frames} frames", flush=True)

    cmd = [FFMPEG, "-v", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
           "-pix_fmt", "yuv420p", "-r", str(FPS), str(OUT)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None

    for idx, (key, draw) in enumerate(SCENES, start=1):
        n = int(round(DURS[key] * FPS))
        cap = CAPTIONS.get(key, [])
        for i in range(n):
            p = i / max(1, n - 1)
            f = Frame(key, idx)
            draw(p, f)
            footer(f, idx, caption_for(key, p), alpha=min(1.0, 0.15 + p * 6))
            proc.stdin.write(f.im.tobytes())
        print(f"seg {key} {DURS[key]:.2f}s {n}f", flush=True)

    proc.stdin.close()
    rc = proc.wait()
    print("encoder rc", rc, flush=True)
    if rc != 0:
        raise SystemExit("encode failed")

    # mux the audio master, padded to the exact total
    final = OUT.with_suffix(".mux.mp4")
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(OUT), "-i", str(AUDIO),
                    "-af", f"apad=whole_dur={TOTAL}", "-t", f"{TOTAL}",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
                    "-movflags", "+faststart", str(final)], check=True)
    final.replace(OUT)
    print("FINAL", OUT, flush=True)


if __name__ == "__main__":
    main()
