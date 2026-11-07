"""Legenda abaixo do pescoço EM CADA LEGENDA, para vídeo que junta takes com enquadramentos diferentes
(close no rosto num take, corpo inteiro no outro): a altura única do `puro_dr.py pescoco` cai na boca de um e no peito
do outro. Mede os ombros pela pose a cada 0,5 s no vídeo da versão e grava lg["y"] de cada legenda que cai com a
expert na tela cheia (na dividida e no canto o motor já põe a legenda no meio).

  .venv/bin/python legenda_por_take.py "<projeto>" [--versao A]
"""
import os, sys, json, glob, shutil, tempfile, subprocess, argparse
import numpy as np
from atlas import ATLAS, LIB, EDICOES
from pose import sessao, preparar, pessoas, maior_tronco
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument("projeto"); ap.add_argument("--versao", default="A")
ap.add_argument("--abaixo", type=float, default=0.045); a = ap.parse_args()
vd = os.path.join(EDICOES, a.projeto, "versoes", a.versao)
P = json.load(open(os.path.join(vd, "plano.json")))
src = os.path.join(vd, "jc.mov")
d = tempfile.mkdtemp(prefix="legtake")
try:
    subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", "fps=2,scale=540:960", os.path.join(d, "%05d.jpg")], check=True)
    s = sessao(); ombro = {}
    for f in sorted(glob.glob(os.path.join(d, "*.jpg"))):
        t = (int(os.path.basename(f)[:5]) - 1) / 2 + 0.25
        with Image.open(f) as im: tensor, tr = preparar(im)
        _, pesc, _ = maior_tronco(pessoas(s.run(None, {s.get_inputs()[0].name: tensor})[0], tr), 1.0, 1.0)
        if pesc is not None: ombro[t] = pesc
finally:
    shutil.rmtree(d, ignore_errors=True)
if not ombro: sys.exit("a pose não achou os ombros em nenhum quadro")

ts = np.array(sorted(ombro)); vs = np.array([ombro[t] for t in ts])
broll = [c for c in P.get("cenas", [])]
n = 0; usados = []
for lg in P.get("legendas", []):
    meio = (lg["ini"] + lg["fim"]) / 2
    if any(c["ini"] <= meio < c["fim"] for c in broll): continue        # B-roll: o motor/estilo decide
    dentro = vs[(ts >= lg["ini"] - 0.25) & (ts <= lg["fim"] + 0.25)]
    y0 = float(np.median(dentro)) if len(dentro) else float(vs[np.abs(ts - meio).argmin()])
    y = round(min(0.86, max(0.30, y0 + a.abaixo)), 3)
    lg["y"] = y; n += 1; usados.append(y)
json.dump(P, open(os.path.join(vd, "plano.json"), "w"), ensure_ascii=False, indent=1)
print(f"{a.projeto}: {n} legendas posicionadas por take · y de {min(usados):.2f} a {max(usados):.2f} · {len(ombro)} quadros medidos")
