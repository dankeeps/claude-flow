"""Prepara uma trilha para entrar no Atlas como sfx_extra, já no volume certo em relação à voz.

  trilha.py <musica> <projeto> [--ini 0] [--abaixo 26] [--nome trilha.wav] [--t 0] [--dur auto]

Corta a música (a partir de --ini s), põe fade e nivela em (LUFS da voz − abaixo). Grava em <projeto>/sfx/<nome> e
acrescenta/atualiza o extra no plano.json da versão A (ganho = pico do arquivo, que é como o mixer do Atlas lê).

Volumes que o Daniel aprovou (2026-10-26/27):
- criativos curtos: SEM música (ele recusou trend viral e violino nos K01–K05);
- lead/trailer com violino épico: ~19 dB abaixo da voz (13 dB ficou alto);
- VSL longa: 25–30 dB abaixo no começo (atrapalhava a voz), 22–25 dB no resto.
Teste se a música tem voz: transcreva com o Whisper (vad_filter=True); qualquer frase real = descarta.
"""
import argparse, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas import EDICOES

ap = argparse.ArgumentParser(); ap.add_argument("musica"); ap.add_argument("projeto")
ap.add_argument("--ini", type=float, default=0); ap.add_argument("--abaixo", type=float, default=26)
ap.add_argument("--nome", default="trilha.wav"); ap.add_argument("--t", type=float, default=0); ap.add_argument("--dur", type=float)
a = ap.parse_args()
proj = a.projeto if os.path.isdir(a.projeto) else os.path.join(EDICOES, a.projeto); vd = os.path.join(proj, "versoes", "A")
P = json.load(open(os.path.join(vd, "plano.json"))); dur = a.dur or (P["dur"] - a.t)
r = subprocess.run(["ffmpeg", "-i", os.path.join(vd, "voz.wav"), "-af", "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
voz = float(json.loads(r[r.rfind("{"):r.rfind("}") + 1])["input_i"])
os.makedirs(os.path.join(proj, "sfx"), exist_ok=True); out = os.path.join(proj, "sfx", a.nome)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-stream_loop", "2", "-ss", str(a.ini), "-i", a.musica, "-t", f"{dur:.3f}", "-af",
                f"afade=t=in:d=0.4,afade=t=out:st={max(0, dur - 2):.3f}:d=2,loudnorm=I={voz - a.abaixo:.2f}:TP=-2:LRA=11",
                "-ac", "2", "-ar", "48000", out], check=True)
pk = float(re.search(r"max_volume: (-?[\d.]+)", subprocess.run(["ffmpeg", "-i", out, "-af", "volumedetect", "-f", "null", "-"],
                                                                 capture_output=True, text=True).stderr).group(1))
ex = [e for e in P.get("sfx_extras", []) if e["f"] != a.nome] + [dict(t=a.t, f=a.nome, g=pk)]
P["sfx_extras"] = sorted(ex, key=lambda e: e["t"]); json.dump(P, open(os.path.join(vd, "plano.json"), "w"), ensure_ascii=False, indent=1)
print(f"voz {voz:.1f} LUFS · trilha em {voz - a.abaixo:.1f} LUFS · ganho {pk} · {out}")
