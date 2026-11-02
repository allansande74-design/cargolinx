#!/usr/bin/env python3
"""Draw the mask from the recorded SAM 3.1 call onto the photograph that call saw.

No new API call: reads the saved response in ~/out/evidence/meta_sam_proof.json,
decodes every mask payload with the official parser, composites them over
meta_image_proof.png (the exact 1600x1600 image the call was made on), then
crops a 1350x630 card for the film with the provenance burned in.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from meta_sam_parser import SegmentationMask, SegmentationMaskEncoding, decode_mask_to_raster

EV = Path.home() / "out" / "evidence"
OUT = Path(__file__).resolve().parent / "shots" / "sam_mask_card.png"
ACCENT = (60, 232, 176)
CARD = (1350, 630)
BAR = 52


def font(size: int) -> ImageFont.FreeTypeFont:
    for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    raise SystemExit("no font")


def main() -> int:
    proof = json.loads((EV / "meta_sam_proof.json").read_text())
    text = proof["output"][0]["content"][0]["text"]
    src = Image.open(EV / "meta_image_proof.png").convert("RGB")

    records = []
    for seg in text.split("<|box;")[1:]:
        mbox = re.match(
            r"x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>", seg
        )
        if not mbox:
            continue
        rest = seg[mbox.end():]
        mi = rest.find("<|mask;")
        if mi < 0:
            continue
        head = rest[mi + 7:]
        mhead = re.match(r"x=(\d+);y=(\d+)(?:;c=[\d.]+)?;data=(\d+),(\d+),([~!])", head)
        if not mhead:
            continue
        body = head[mhead.end():]
        cut = body.rfind("|>")
        if cut < 0:
            continue
        mark = mhead.group(5)
        records.append((*mbox.groups(), *mhead.groups(), mark + body[:cut]))
    print(f"recorded objects: {len(records)}  image: {src.size}")

    lay = Image.new("RGBA", src.size, (0, 0, 0, 0))
    boxes = []
    for x1, y1, x2, y2, _w, _h, conf, _mx, _my, mh, mw, enc, payload in records:
        try:
            m = SegmentationMask(
                encoding="lossless" if enc == "~" else "one_bit",
                payload=payload,
                width=int(mw),
                height=int(mh),
            )
            raster = decode_mask_to_raster(m)
        except Exception as exc:  # report how many decoded, keep the rest
            print("  mask skipped:", exc)
            continue
        w, h = int(x2) - int(x1) + 1, int(y2) - int(y1) + 1
        mask = Image.frombytes("L", (int(mw), int(mh)), bytes(1 if v else 0 for v in raster))
        mask = mask.point(lambda v: 255 if v else 0).resize((w, h), Image.NEAREST)
        patch = Image.new("RGBA", (w, h), ACCENT + (0,))
        patch.putalpha(mask.point(lambda v: int(v * 0.5)))
        lay.alpha_composite(patch, (int(x1), int(y1)))
        boxes.append((int(x1), int(y1), int(x2), int(y2), float(conf) if conf else None))

    print(f"decoded and drawn: {len(boxes)}")
    comp = Image.alpha_composite(src.convert("RGBA"), lay).convert("RGB")
    d = ImageDraw.Draw(comp)
    for x1, y1, x2, y2, conf in boxes:
        d.rectangle([x1, y1, x2, y2], outline=ACCENT, width=3)
        if conf:
            d.text((x1, max(0, y1 - 22)), f"{conf:.2f}", font=font(18), fill=ACCENT)

    # crop a 5:2-ish window around the first box so the mask fills the frame
    x1, y1, x2, y2, _ = boxes[0]
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    cw, ch = CARD[0], CARD[1] - BAR
    scale = 2.1
    vw, vh = int(cw * scale), int(ch * scale)
    left = max(0, min(comp.width - vw, cx - vw // 2))
    top = max(0, min(comp.height - vh, cy - vh // 2))
    crop = comp.crop((left, top, left + vw, top + vh)).resize((cw, ch), Image.LANCZOS)

    card = Image.new("RGB", CARD, (11, 18, 32))
    card.paste(crop, (0, 0))
    dd = ImageDraw.Draw(card)
    dd.rectangle([0, ch, CARD[0], CARD[1]], fill=(11, 18, 32))
    caption = "SAM 3.1 mask decoded from a recorded Meta call  ·  image generated with Meta Muse Image"
    dd.text((28, ch + 14), caption, font=font(26), fill=(150, 163, 185))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    card.save(OUT)
    print("wrote", OUT, card.size, "bytes", OUT.stat().st_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
