"""v6 audio-first bed fit: pad/trim + loudnorm every clip to exact slot. No tempo except s2 (done).

Slots: s0 8, s1a 7, s1b 8, s2 20(fit done), s3 15, s4 18, s5 18, s6 17, s7 17, s8 15, s9 18, s10 14.
Total = 175s (<=180 cap, 5s headroom for xfades).
"""
import subprocess

FF = '/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg'
FP = '/home/amanda/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffprobe'
D = '/home/amanda/cargolinx-v2/out/demo/work_v6_audiofirst/wav'

SLOTS = {'s0_title': 8.0, 's1a_team': 7.0, 's1b_team': 8.0, 's3_solution': 15.0,
         's4_live1': 18.0, 's5_live2': 18.0, 's6_live3': 17.0, 's7_live4': 17.0,
         's8_git': 15.0, 's9_impact': 18.0, 's10_close': 14.0}
SRC = {'s0_title': 's0_title_allan.wav', 's1a_team': 's1a_team_allan.wav',
       's1b_team': 's1b_team_amanda.mp3', 's3_solution': 's3_solution_allan.wav',
       's4_live1': 's4_live1_allan.wav', 's5_live2': 's5_live2_allan.wav',
       's6_live3': 's6_live3_allan.wav', 's7_live4': 's7_live4_allan.wav',
       's8_git': 's8_git_allan.wav', 's9_impact': 's9_impact_allan.wav',
       's10_close': 's10_close_allan.wav'}


def dur(p):
    return float(subprocess.run(
        [FP, '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', p], capture_output=True, text=True).stdout.strip())


for k, target in SLOTS.items():
    src = f'{D}/{SRC[k]}'
    dst = f'{D}/{k}_fit.wav'
    d = dur(src)
    print(k, 'src', round(d, 2), '-> slot', target,
          ('PAD+%.1fs' % (target - d)) if d < target else ('TRIM-%.1fs' % (d - target)))
    subprocess.run([FF, '-v', 'error', '-y', '-i', src, '-filter_complex',
                    f'[0:a]apad=whole_dur={target:.3f},atrim=0:{target:.3f},'
                    f'loudnorm=I=-16:TP=-1.5:LRA=11[s]',
                    '-map', '[s]', '-ar', '44100', '-ac', '2', '-t', f'{target:.3f}', dst],
                   check=True)
print('slots sum:', sum(SLOTS.values()) + 20.0, '(+s2 20s fit)')
