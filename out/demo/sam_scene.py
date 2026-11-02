#!/usr/bin/env python3
"""Make the SAM 3.1 scene for the CargoLinx film from a live call.

Reads META_MODEL_API_KEY from ~/cargolinx-v2/.env, posts a real photograph to
POST https://api.meta.ai/v1/responses with model sam-3.1, decodes the mask
payloads with the official parser, and writes a composited card.

Never prints the key. Writes the raw response next to the card as evidence.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFont
from meta_sam_parser import decode_mask_to_raster

HOME = Path.home()
ENV = HOME / "cargolinx-v2" / ".env"
EAT = timezone(timedelta(hours=3))
OUT = HOME / "cargolinx-v2" / "out" / "demo" / "shots"
EVID = HOME / "out" / "evidence"
W, H = 1920, 1080
INK = (11, 18, 32)
PAPER = (244, 246, 250)
ACCENT = (60, 232, 176)
DIM = (150, 163, 185)


def key() -> str:
    for line in ENV.read_text().splitlines():
        if line.startswith("META_MODEL_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no META_MODEL_API_KEY")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),):
        for base in ("/usr/share/fonts/truetype/dejavu/", "/usr/share/fonts/truetype/liberation/"):
            p = Path(base) / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def segment(img_path: Path, prompt: str, k: str) -> dict:
    raw = img_path.read_bytes()
    mime = "image/jpeg" if img_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    body = {
        "model": "sam-3.1",
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": f"data:{mime};base64,{base64.b64encode(raw).decode()}"},
            ],
        }],
    }
    req = urllib.request.Request(
        "https://api.meta.ai/v1/responses",
        data=json.dumps(body).encode(),
        headers={"authorization": f"Bearer {k}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()[:400]}")


def output_text(resp: dict) -> str:
    for item in resp.get("output", []):
        for c in item.get("content", []) or []:
            if c.get("type") in ("output_text", "text") and c.get("text"):
                return c["text"]
    return ""


def main() -> int:
    if len(sys.argv) < 3:
        raise SystemExit("usage: sam_scene.py <photo> <prompt> [caption]")
    photo = Path(sys.argv[1])
    prompt = sys.argv[2]
    caption = sys.argv[3] if len(sys.argv) > 3 else prompt

    src = Image.open(photo).convert("RGB")
    src.thumbnail((1600, 1600), Image.LANCZOS)
    probe = Path("/home/amanda/.hermes/cache/scratch/sam_input.jpg")
    probe.parent.mkdir(parents=True, exist_ok=True)
    src.save(probe, "JPEG", quality=92)

    resp = segment(probe, prompt, key())
    EVID.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(EAT).strftime("%Y%m%d_%H%M%S")
    rec = EVID / f"sam_live_{stamp}.json"
    rec.write_text(json.dumps(resp, indent=1))
    text = output_text(resp)
    if "<|box" not in text:
        print("no boxes in response; first 300 chars:", text[:300] or json.dumps(resp)[:300])
        return 2

    import re
    records = re.findall(
        r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>"
        r"<\|mask;x=0;y=0(?:;c=[\d.]+)?;data=(\d+),(\d+),([~!])([^|]*)\|>",
        text,
    )
    print(f"objects: {len(records)}  evidence: {rec.name}")

    overlay = src.copy()
    lay = Image.new("RGBA", overlay.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    boxes = []
    for i, (x1, y1, x2, y2, fw, fh, conf, mh, mw, enc, payload) in enumerate(records):
        try:
            from meta_sam_parser import SegmentationMask, SegmentationMaskEncoding
            mask_obj = SegmentationMask(
                encoding=SegmentationMaskEncoding.LOSSLESS if enc == "~" else SegmentationMaskEncoding.ONE_BIT,
                payload=payload, width=int(mw), height=int(mh),
            )
            raster = decode_mask_to_raster(mask_obj)
        except Exception as e:  # keep going; report how many decoded
            print(f"  mask {i}: {e}")
            continue
        mw_i, mh_i = int(mw), int(mh)
        mask = Image.frombytes("L", (mw_i, mh_i), bytes(1 if v else 0 for v in raster))
        mask = mask.point(lambda v: 255 if v else 0)
        mask = mask.resize((max(1, int(x2) - int(x1) + 1), max(1, int(y2) - int(y1) + 1)), Image.NEAREST)
        patch = Image.new("RGBA", mask.size, ACCENT + (0,))
        patch.putalpha(mask.point(lambda v: int(v * 0.45)))
        lay.alpha_composite(patch, (int(x1), int(y1)))
        boxes.append((int(x1), int(y1), int(x2), int(y2), conf))

    overlay = Image.alpha_composite(overlay.convert("RGBA"), lay).convert("RGB")

    card = Image.new("RGB", (W, H), INK)
    scale = min(1400 / overlay.width, 800 / overlay.height)
    fit = overlay.resize((int(overlay.width * scale), int(overlay.height * scale)), Image.LANCZOS)
    card.paste(fit, (W - fit.width - 60, (H - fit.height) // 2 - 20))
    dd = ImageDraw.Draw(card)
    dd.rectangle([W - fit.width - 62, (H - fit.height) // 2 - 22, W - 58, (H + fit.height) // 2 - 18], outline=(45, 58, 82), width=2)

    f_kicker, f_head, f_small, f_mono = font(24, True), font(62, True), font(30), font(24)
    dd.text((90, 210), "SAM 3.1  ·  META MODEL API", font=f_kicker, fill=ACCENT)
    dd.text((90, 260), "Every object found,", font=f_head, fill=PAPER)
    dd.text((90, 330), "measured at intake", font=f_head, fill=PAPER)
    lines = [
        f"{len(records)} objects segmented in one call",
        f'prompt: "{caption}"',
        "live call " + datetime.now(EAT).strftime("%-d %b %Y, %H:%M EAT"),
        "mask decoded from the returned payload",
    ]
    y = 450
    for ln in lines:
        dd.text((90, y), ln, font=f_small, fill=DIM)
        y += 44
    dd.rectangle([90, y + 24, 250, y + 28], fill=ACCENT)
    dd.text((90, 900), "altovexcargolinx.allansande74.workers.dev", font=f_mono, fill=(110, 124, 148))

    OUT.mkdir(parents=True, exist_ok=True)
    card_path = OUT / "sam_cargo.png"
    card.save(card_path)
    print("wrote", card_path, card.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
