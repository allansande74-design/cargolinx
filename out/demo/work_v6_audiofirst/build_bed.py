"""v6 audio-first bed: fit every Allan clip + Amanda s1b to exact slot durs, loudnorm -16 LUFS.

Slots (must total <=180s):
 s0_title 8, s1a_team 7, s1b_team 8, s2_problem 18, s3_solution 15,
 s4_live1 18, s5_live2 18, s6_live3 17, s7_live4 17, s8_git 15, s9_impact 20, s10_close 14 = 175s
Source: Allan guide windows (his real voice) + Amanda TTS only for s1b_team.
s2 gets extra atempo (1.68x in two clean stages) because 34s of problem speech -> 18s.
Everything else: pad/trim only, NO speed change on Allan's voice.
"""
import subprocess

FF = '/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg'
FP = '/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe'
D = '/home/amanda/cargolinx-v2/out/demo/work_v6_audiofirst/wav'
G = '/home/amanda/out/voice/guide_audio.wav'


def dur(p):
    return float(subprocess.run([FP, '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'default=nw=1:nk=1', p],
                                capture_output=True, text=True).stdout.strip())


def norm(src, dst, target):
    """Pad/trim + loudnorm to exact target. No tempo change."""
    subprocess.run([FF, '-v', 'error', '-y', '-i', src, '-filter_complex',
                    f'[0:a]apad=whole_dur={target:.3f},atrim=0:{target:.3f},'
                    f'loudnorm=I=-16:TP=-1.5:LRA=11[s]',
                    '-map', '[s]', '-ar', '44100', '-ac', '2', '-t', f'{target:.3f}', dst],
                   check=True)
    print('norm', dst.split('/')[-1], round(dur(dst), 2))


# s2 special: 34s cut -> 18s via atempo 1.35*1.4=1.89? No: 34/18=1.89 too fast.
# Re-cut tighter: drop the 31.5-34 stall already done (34s). Use atempo 1.25*1.25*1.21=1.89. Too fast.
# Instead: accept 20s for s2 by borrowing 2s from s9 (20->18)? Keep slots: s2=20, s9=18 => total still 175.
# Simpler: keep 18s slot, atempo 34/18 = 1.889 = 1.3*1.453. Intelligibility limit ~1.7. Recut s2 shorter instead.
# Tighter recut: guide 21-63 minus stalls (27.5-32.5, 51.5-55) = 34s. Drop "In transit" repeat (33-39)? No, needed.
# Decision: s2 slot 20s (borrow 2s from s9_impact 20->18). Allan at ~81wpm needs room; 65 words/20s = 195wpm equivalent at 1.7x. OK.
print('bed builder ready; run fits next')
