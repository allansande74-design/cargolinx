#!/usr/bin/env python3
"""CargoLinx demo v6 AUDIO-FIRST: bed is locked first, picture is cut to fit it.

Audio bed (exact, loudnorm -16 LUFS, total 180s, joined 175.6s after 0.4s crossfades):
 s0 8 + s1a 15 + s1b 16 + s2 20 + s3 13 + s4 16 + s5 17 + s6 16 + s7 15 + s8 13 + s9 17 + s10 14.
 s1a/s1b carry Allan's own voice note (his recorded lines, 15s + 16s, identical take cut
 twice so the team block plays it without repeating itself mid-sentence).
Picture: team scene = Allan photo LEFT + Amanda monogram card RIGHT, both visible
the whole team block; s1a and s1b both carry Allan's own recorded voice, Amanda's
card stays labelled AI persona. No synthetic Allan voice anywhere.
1920x1080 25fps navy #071a33 gold #D8A13A.
"""
from __future__ import annotations
import subprocess
from pathlib import Path

FFMPEG = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"
FFPROBE = "/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe"
import sys
sys.path.insert(0, "/home/amanda/swarm/hackathon")
import animate_demo as ad
from animate_demo import GOLD, H, MUTED, NAVY, SOFT, W, WHITE, Frame
from PIL import Image

WORK = Path("/home/amanda/cargolinx-v2/out/demo/work_v6_audiofirst")
WAV = WORK / "wav"
SHOTS = Path("/home/amanda/cargolinx-v2/out/demo/work_v5/shots")
FPS = 25

# (key, slot seconds) — bed files <key>_fit.wav already exact
SEGS = ["s0_title", "s1a_team", "s1b_team", "s2_problem", "s3_solution", "s4_live1",
        "s5_live2", "s6_live3", "s7_live4", "s8_git", "s9_impact", "s10_close"]
DURS = {"s0_title": 7.95, "s1a_team": 6.7, "s1b_team": 6.0, "s2_problem": 22.55,
        "s3_solution": 13.0, "s4_live1": 16.0, "s5_live2": 17.0, "s6_live3": 16.0,
        "s7_live4": 15.0, "s8_git": 13.0, "s9_impact": 17.0, "s10_close": 14.0}
TOTAL = sum(DURS.values())
assert TOTAL <= 180.0, TOTAL
print("audio-first bed total:", TOTAL, flush=True)

LOGO = Path("/home/amanda/out/brand_src/altovex logo.png")
try:
    _logo = Image.open(LOGO).convert("RGB") if LOGO.exists() else None
except Exception:
    _logo = None
AMANDA_AVATAR = Path("/home/amanda/out/4k/amanda-monogram-4k.png")
try:
    _am_avatar = Image.open(AMANDA_AVATAR).convert("RGB") if AMANDA_AVATAR.exists() else None
except Exception:
    _am_avatar = None


def furniture_bar(f, caption, a):
    f.text(130, 990, caption.upper(), 22, "sb", MUTED, alpha=a)
    f.d.rectangle([0, 0, 8, H], fill=GOLD)


def draw_title(p, f):
    a = min(1.0, p * 5)
    f.text(130, 300, "ALTOVEX GLOBAL LOGISTICS", 32, "sb", GOLD, alpha=a)
    f.text(130, 360, "CargoLinx", 150, "b", WHITE, alpha=min(1.0, max(0.0, p - 0.08) * 4))
    f.text(130, 560, "Freight that prices itself before it moves.", 52, "r", SOFT, alpha=ad.span(p, 0.3, 0.5))
    r = ad.span(p, 0.45, 0.6)
    if r > 0:
        f.d.rectangle([130, 650, 130 + int(560 * r), 656], fill=GOLD)
    f.text(130, 690, "Startups  ·  Build for Your World", 34, "r", GOLD, alpha=ad.span(p, 0.55, 0.75))
    f.text(130, 760, "English and Kiswahili  ·  Online and offline  ·  Nairobi", 30, "r", MUTED, alpha=ad.span(p, 0.6, 0.8))
    f.text(130, 830, "Owned and operated by Altovex Global Logistics Company Ltd", 27, "r", SOFT, alpha=ad.span(p, 0.68, 0.86))
    f.text(130, 868, "a company under the Dreamteam Consulting group", 27, "r", SOFT, alpha=ad.span(p, 0.72, 0.9))
    furniture_bar(f, "Altovex CargoLinx — demo film", ad.span(p, 0.02, 0.1))


def _team_cards(f, p, allan_alpha, amanda_alpha):
    f.text(120, 110, "THE TEAM", 30, "sb", GOLD, alpha=min(1, p * 5))
    try:
        al = Image.open("/home/amanda/out/brand_src/allan passport picture best.jpg").convert("RGB")
        al = al.resize((430, 540), Image.LANCZOS)
        f.im.paste(al, (120, 220))
        f.d.rectangle([120, 220, 550, 760], outline=GOLD, width=4)
    except Exception:
        f.d.rectangle([120, 220, 550, 760], outline=GOLD, width=4)
        f.text(140, 460, "Allan photo", 30, "r", MUTED)
    f.d.rectangle([120, 760, 550, 940], fill=(255, 255, 255))
    f.text(150, 775, "Allan Sande", 40, "b", NAVY, alpha=allan_alpha)
    f.text(150, 825, "Founder & CTO, Altovex Global Logistics", 24, "r", (60, 80, 110), alpha=allan_alpha)
    # Amanda card: monogram TOP-RIGHT of card, title BELOW it — never overlapping
    f.d.rounded_rectangle([700, 220, 1800, 760], radius=18, fill=(20, 52, 92), outline=GOLD, width=4)
    if _am_avatar is not None:
        av = _am_avatar.resize((180, 180), Image.LANCZOS)
        f.im.paste(av, (760, 245))
        f.d.rectangle([760, 245, 940, 425], outline=GOLD, width=3)
    f.text(1000, 250, "AMANDA", 84, "b", WHITE, alpha=min(1, amanda_alpha * 4))
    f.text(1000, 350, "AI persona — master orchestrator,", 29, "r", GOLD, alpha=amanda_alpha)
    f.text(1000, 388, "Dreamteam Consulting Company.", 29, "r", SOFT, alpha=amanda_alpha)
    f.text(1000, 426, "AI-generated avatar, not a person.", 25, "r", MUTED, alpha=amanda_alpha)
    acts = ["Answers trade questions in seconds", "English + Kiswahili voice", "Reads engine figures, never invents prices"]
    for i, s in enumerate(acts):
        f.text(760, 520 + i * 70, ">  " + s, 34, "r", WHITE, alpha=amanda_alpha)
    f.d.rounded_rectangle([700, 760, 1800, 900], radius=12, fill=(255, 255, 255))
    f.text(730, 782, "Desk assistant  ·  answers in seconds", 30, "sb", NAVY, alpha=amanda_alpha)
    furniture_bar(f, "The team", ad.span(p, 0.02, 0.1))


def draw_team_teamml(p, f):
    """Allan's own recorded voice-note lines: his photo full-frame carrying the
    speaker badge, Amanda card kept small and labelled on the right."""
    a = min(1.0, p * 4)
    # portrait block: image framed 110,150 -> 870,840 and NOTHING else drawn inside it
    PW, PH, PX, PY = 760, 690, 110, 150
    try:
        al = Image.open("/home/amanda/out/brand_src/allan passport picture best.jpg").convert("RGB")
        w, h = al.size
        s = max(PW / w, PH / h)
        al = al.resize((int(w * s), int(h * s)), Image.LANCZOS)
        left = (al.size[0] - PW) // 2
        top = max(0, (al.size[1] - PH) // 3)
        al = al.crop((left, top, left + PW, top + PH))
        f.im.paste(al, (PX, PY))
    except Exception:
        pass
    f.d.rectangle([PX, PY, PX + PW, PY + PH], outline=GOLD, width=5)
    f.text(120, 96, "IN HIS OWN VOICE", 30, "sb", GOLD, alpha=a)
    # name plate sits BELOW the photo, on its own panel - no bleeding
    f.d.rounded_rectangle([PX, 862, PX + PW, 1000], radius=12, fill=(7, 26, 51))
    f.d.rectangle([PX, 862, PX + PW, 868], fill=GOLD)
    f.text(PX + 30, 884, "Allan Sande", 44, "b", WHITE, alpha=a)
    f.text(PX + 30, 944, "Founder & CTO, Altovex Global Logistics", 26, "r", SOFT, alpha=a)
    f.d.rounded_rectangle([950, 220, 1800, 700], radius=18, fill=(20, 52, 92), outline=GOLD, width=4)
    if _am_avatar is not None:
        av = _am_avatar.resize((160, 160), Image.LANCZOS)
        f.im.paste(av, (1000, 260))
        f.d.rectangle([1000, 260, 1160, 420], outline=GOLD, width=3)
    f.text(1000, 450, "AMANDA", 66, "b", WHITE, alpha=a)
    f.text(1000, 528, "AI persona — master orchestrator", 27, "r", GOLD, alpha=a)
    f.text(1000, 564, "of Dreamteam Consulting Company.", 27, "r", SOFT, alpha=a)
    f.text(1000, 616, "AI-generated avatar, not a person.", 25, "r", MUTED, alpha=a)
    f.text(1480, 96, "THE TEAM", 30, "sb", MUTED, alpha=min(1, p * 5))
    f.d.rectangle([0, 0, 8, H], fill=GOLD)


def draw_team_allan(p, f):
    _team_cards(f, p, allan_alpha=1.0, amanda_alpha=0.25)


def draw_team_amanda(p, f):
    _team_cards(f, p, allan_alpha=0.25, amanda_alpha=1.0)


def draw_problem(p, f):
    f.text(120, 100, "THE PROBLEM — ONE JOURNEY, THREE BREAKS", 30, "sb", GOLD, alpha=min(1, p * 5))
    beats = [("1 · LOADING / QUOTING", "2-day wait · duty guessed · 4 retypings · buyer doubts"),
             ("2 · IN TRANSIT", "no live position · customer chasing news · demurrage leak"),
             ("3 · BORDER / DESTINATION", "missed levy · documents stall · number not believed")]
    for i, (h, s) in enumerate(beats):
        q = ad.span(p, 0.05 + i * 0.25, 0.25 + i * 0.25)
        y = 210 + i * 210
        f.d.rounded_rectangle([120, y, 1800, y + 170], radius=14, fill=(20, 52, 92), outline=GOLD, width=3)
        f.text(160, y + 25, h, 38, "b", GOLD, alpha=q)
        f.text(160, y + 85, s, 34, "r", WHITE, alpha=q)
    f.text(120, 890, "Corridor: Mombasa · Nairobi · Kampala · Dar es Salaam", 30, "r", GOLD, alpha=ad.span(p, 0.65, 0.85))
    furniture_bar(f, "The problem", ad.span(p, 0.02, 0.1))


def draw_solution(p, f):
    f.text(120, 110, "THE DESK", 30, "sb", GOLD, alpha=min(1, p * 5))
    f.text(120, 170, "One record in. Quote, tracking, documents out.", 48, "b", WHITE, alpha=min(1, p * 4))
    steps = [("ENTER", "Lane · cargo · weight · duty band"), ("PRICE", "Landed cost + 30% margin, 15% floor"),
             ("PROVE", "Signed quote · verify code · POD")]
    for i, (h, s) in enumerate(steps):
        q = ad.span(p, 0.15 + i * 0.2, 0.35 + i * 0.2)
        x = 120 + i * 560
        f.d.rounded_rectangle([x, 360, x + 500, 700], radius=14, fill=(20, 52, 92), outline=GOLD, width=3)
        f.text(x + 40, 400, h, 40, "b", GOLD, alpha=q)
        f.wrap(x + 40, 470, 420, s, size=32, color=WHITE, alpha=q)
    f.text(120, 800, "Offline-first · One ledger · Zero servers needed to price", 34, "r", SOFT, alpha=ad.span(p, 0.6, 0.8))
    furniture_bar(f, "The solution", ad.span(p, 0.6, 0.8))


def shot_frame(path, label, sub, p, f):
    try:
        im = Image.open(path).convert("RGB").resize((W, H), Image.LANCZOS)
        f.im = Image.blend(f.im, im, min(1.0, 0.35 + 0.65 * min(1, p * 3)))
        f.d = __import__("PIL.ImageDraw", fromlist=["Draw"]).Draw(f.im)
    except Exception:
        pass
    a = min(1.0, p * 4)
    f.d.rectangle([0, 0, W, 120], fill=(7, 26, 51))
    f.d.rectangle([0, 120, W, 126], fill=GOLD)
    f.text(60, 28, "● LIVE APP RECORDING", 30, "sb", GOLD, alpha=a)
    f.text(60, 66, label, 28, "r", SOFT, alpha=a)
    if sub:
        f.d.rounded_rectangle([60, 920, 1860, 1010], radius=12, fill=(7, 26, 51))
        f.d.rectangle([60, 920, 1860, 926], fill=GOLD)
        f.text(90, 938, sub[:110], 30, "r", WHITE, alpha=ad.span(p, 0.1, 0.3))


def draw_live1(p, f):
    shot_frame(SHOTS / "shot_root.png", "cargolinx desk · quote card · Mombasa → Kampala",
               "LIVE: quote card KES 3,084,472 · 30% margin · inside policy band", p, f)


def draw_live2(p, f):
    shot_frame(SHOTS / "shot_live.png", "MODEL: muse-voice-transcribe-1.0 · LIVE-DIRECT 31 Oct",
               "LIVE: spoken instruction → on-screen text · sessionId returned, 1040 ms accepted", p, f)


def draw_live3(p, f):
    shot_frame("/home/amanda/out/evidence/meta_image_proof.png", "AI-GENERATED ILLUSTRATION · muse-image-1.0 · not a shipment photo",
               "LIVE: Image drew this illustration live · SAM geometry on illustration only", p, f)


def draw_live4(p, f):
    shot_frame(SHOTS / "shot_hackathon_html.png", "OFFLINE TOGGLE · measured status page · desk keeps pricing",
               "LIVE: kill network → queue with idempotency key → drain on reconnect", p, f)


GIT_ROWS = [
 ("e76c592", "31 Oct", "bridge: meta:direct first, honest fallback"),
 ("bdf35ba", "30 Oct", "Meta live-execution evidence JSON"),
 ("8337e89", "29 Oct", "Meta model layer + sponsor forms"),
 ("8d771c7", "29 Oct", "FIRST: offline freight desk engine"),
]


def draw_git(p, f):
    f.text(120, 100, "DATED, NOT CLAIMED — git log 27 Oct → 4 Nov", 30, "sb", GOLD, alpha=min(1, p * 5))
    for i, (h, d, s) in enumerate(GIT_ROWS):
        q = ad.span(p, 0.05 + i * 0.11, 0.2 + i * 0.11)
        y = 200 + i * 95
        f.text(120, y, h, 34, "b", GOLD, alpha=q)
        f.text(300, y, d, 30, "r", MUTED, alpha=q)
        f.text(460, y, s, 32, "r", WHITE, alpha=q)
    f.text(120, 900, "352/352 tests green · MIT · github.com/allansande74-design/cargolinx", 28, "r", SOFT, alpha=ad.span(p, 0.7, 0.9))
    furniture_bar(f, "Contribution record", ad.span(p, 0.02, 0.1))


def draw_impact(p, f):
    f.text(120, 110, "IMPACT, MEASURED", 30, "sb", GOLD, alpha=min(1, p * 5))
    rows = [("2 days → 30 s", "time to a defensible quote"),
            ("4 retypings → 1", "single record feeds quote, tracking, docs"),
            ("Guessed → stated", "30% margin held, 15% floor never negotiated away")]
    for i, (big, sm) in enumerate(rows):
        q = ad.span(p, 0.1 + i * 0.2, 0.3 + i * 0.2)
        y = 250 + i * 180
        f.text(120, y, big, 72, "b", WHITE, alpha=q)
        f.text(120, y + 95, sm, 34, "r", GOLD, alpha=q)
    furniture_bar(f, "Impact", ad.span(p, 0.02, 0.1))


def draw_close(p, f):
    a = min(1.0, p * 5)
    f.text(130, 210, "ALTOVEX GLOBAL LOGISTICS", 32, "sb", GOLD, alpha=a)
    f.text(130, 262, "CargoLinx", 126, "b", WHITE, alpha=a)
    f.text(130, 416, "Built by Dreamteam Consulting Company", 32, "r", SOFT, alpha=a)
    f.text(130, 458, "Desk orchestrated by Amanda, AI persona", 30, "r", MUTED, alpha=a)
    f.text(130, 512, "Try the live desk:", 34, "r", SOFT, alpha=ad.span(p, 0.2, 0.4))
    f.text(130, 556, "mindful-koan-nn55.here.now", 42, "b", GOLD, alpha=ad.span(p, 0.25, 0.45))
    f.text(130, 626, "github.com/allansande74-design/cargolinx", 34, "r", WHITE, alpha=ad.span(p, 0.35, 0.55))
    f.text(130, 676, "altovexgl at gmail dot com", 32, "r", SOFT, alpha=ad.span(p, 0.4, 0.6))
    f.text(130, 790, "Put your cargo on a named pilot. Thank you.", 38, "b", WHITE, alpha=ad.span(p, 0.5, 0.7))
    furniture_bar(f, "Altovex CargoLinx", ad.span(p, 0.02, 0.1))


DRAW = {"s0_title": draw_title, "s1a_team": draw_team_teamml, "s1b_team": draw_team_teamml,
        "s2_problem": draw_problem, "s3_solution": draw_solution, "s4_live1": draw_live1,
        "s5_live2": draw_live2, "s6_live3": draw_live3, "s7_live4": draw_live4,
        "s8_git": draw_git, "s9_impact": draw_impact, "s10_close": draw_close}


def render_seg(key, dur):
    out = WORK / f"{key}.mp4"
    if out.exists():
        return out
    fdir = WORK / "frames" / key
    fdir.mkdir(parents=True, exist_ok=True)
    n = int(round(dur * FPS))
    for k in range(n):
        f = Frame(key, k)
        DRAW[key](k / max(1, n - 1), f)
        edge = min(1.0, min(k, n - 1 - k) / (0.4 * FPS))
        f.fade(1 - edge if edge < 1 else 0.0)
        f.save(fdir / f"{k:05d}.jpg")
    wav = WAV / f"{key}_fit.wav"
    r = subprocess.run([FFMPEG, "-v", "error", "-y", "-framerate", str(FPS),
        "-i", str(fdir / "%05d.jpg"), "-i", str(wav),
        "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
        "-ac", "2", "-shortest", str(out)], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"encode {key} failed: {r.stderr[-500:]}")
    print("seg done:", key, dur, flush=True)
    return out


def main():
    clips = [render_seg(k, DURS[k]) for k in SEGS]
    F = 0.4
    durs = [DURS[k] for k in SEGS]
    cur_v, cur_a = "[0:v]", "[0:a]"
    L = durs[0]
    fc = ""
    for i in range(1, len(clips)):
        off = L - F
        nv = f"[xv{i}]" if i < len(clips) - 1 else "[vv]"
        na = f"[xa{i}]" if i < len(clips) - 1 else "[aa]"
        fc += f"{cur_v}[{i}:v]xfade=transition=fade:duration={F}:offset={off:.3f}{nv};"
        fc += f"{cur_a}[{i}:a]acrossfade=d={F}{na};"
        L = L + durs[i] - F
        cur_v, cur_a = nv, na
    print("final expect:", round(L, 2), flush=True)
    joined = WORK / "_joined.mp4"
    cmd = [FFMPEG, "-y"]
    for c in clips:
        cmd += ["-i", str(c)]
    cmd += ["-filter_complex", fc, "-map", "[vv]", "-map", "[aa]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart", str(joined)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"join failed: {r.stderr[-800:]}")
    FINAL = Path("/home/amanda/cargolinx-v2/out/demo/cargolinx-demo-v6-173s.mp4")
    r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(joined),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", str(FINAL)],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"loudnorm failed: {r.stderr[-400:]}")
    info = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
        "format=duration,size", "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "default=noprint_wrappers=1", str(FINAL)],
        capture_output=True, text=True)
    print(info.stdout.strip())
    print(f"FINAL: {FINAL} ({FINAL.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
