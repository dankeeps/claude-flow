"""Folhas de quadros para OLHAR vídeo: B-roll candidato e o render/prévia final.

Substitui a folha improvisada de 1 quadro/s a 120 px (pequena demais para ver texto queimado, marca d'água, corte
no meio do clipe ou o movimento). Cada quadro sai com o segundo escrito em cima, para você citar "B0007 @3,5 s".

  python folhas.py clipes <video ou pasta> [...] [--saida DIR] [--fps 2] [--larg 300] [--max 24]
      uma folha por clipe (até --max quadros, espalhados pelo clipe todo se ele for longo) → DIR/<clipe>.jpg
  python folhas.py video <video> [--saida DIR] [--fps 2] [--larg 270] [--de S] [--ate S] [--por-folha 24]
      o vídeo inteiro (ou um trecho) em folhas numeradas → DIR/<nome>_01.jpg, _02.jpg…  Use no render final:
      2 quadros/s pega B-roll fora da palavra, legenda saindo da tela, recorte com fundo vazando, quadro preto.

Leia as folhas com a ferramenta Read (imagem). Rode com o Python do Atlas (tem Pillow).
"""
import os, sys, json, glob, shutil, subprocess, tempfile, argparse
from PIL import Image, ImageDraw, ImageFont

VIDEOS = (".mp4", ".mov", ".m4v", ".mkv", ".webm")


def fonte(tam):
    for f in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(f):
            try: return ImageFont.truetype(f, tam)
            except OSError: pass
    return ImageFont.load_default()


def duracao(v):
    try:
        return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                              "csv=p=0", v], text=True).strip())
    except Exception:
        return 0.0


def quadros(v, tempos, larg, tmp):
    """Um JPG por tempo (seek rápido por quadro; mais rápido que decodificar tudo em clipe curto)."""
    out = []
    for i, t in enumerate(tempos):
        arq = os.path.join(tmp, f"q{i:04d}.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", v, "-frames:v", "1",
                        "-vf", f"scale={larg}:-2", "-q:v", "3", arq], capture_output=True)
        if os.path.exists(arq): out.append((t, arq))
    return out


def montar(itens, titulo, colunas, saida):
    if not itens: return None
    ims = [(t, Image.open(a).convert("RGB")) for t, a in itens]
    w, h = ims[0][1].size; pad = 6; topo = 34
    linhas = (len(ims) + colunas - 1) // colunas
    folha = Image.new("RGB", (colunas * (w + pad) + pad, topo + linhas * (h + pad) + pad), (24, 24, 24))
    d = ImageDraw.Draw(folha); f = fonte(18); ft = fonte(20)
    d.text((pad, 7), titulo, fill=(240, 240, 240), font=ft)
    for k, (t, im) in enumerate(ims):
        x = pad + (k % colunas) * (w + pad); y = topo + (k // colunas) * (h + pad)
        folha.paste(im, (x, y))
        rot = f"{t:.1f}s"; bx = d.textbbox((0, 0), rot, font=f)
        d.rectangle((x, y, x + bx[2] + 8, y + bx[3] + 6), fill=(0, 0, 0))
        d.text((x + 4, y + 2), rot, fill=(255, 220, 0), font=f)
    folha.save(saida, quality=85)
    return saida


def tempos(dur, fps, maximo, de=0.0, ate=None):
    ate = min(ate or dur, dur) - 0.05
    n = max(1, int((ate - de) * fps) + 1)
    if maximo and n > maximo:                       # clipe longo: espalha os quadros pelo clipe todo
        return [de + (ate - de) * i / (maximo - 1) for i in range(maximo)]
    return [de + i / fps for i in range(n) if de + i / fps <= ate]


def cmd_clipes(a):
    arqs = []
    for p in a.alvos:
        if os.path.isdir(p):
            arqs += sorted(f for f in glob.glob(os.path.join(p, "**", "*"), recursive=True) if f.lower().endswith(VIDEOS))
        else: arqs.append(p)
    os.makedirs(a.saida, exist_ok=True)
    for v in arqs:
        dur = duracao(v); tmp = tempfile.mkdtemp()
        try:
            nome = os.path.splitext(os.path.basename(v))[0]
            it = quadros(v, tempos(dur, a.fps, a.max), a.larg or 300, tmp)
            col = 8 if len(it) > 16 else 6
            s = montar(it, f"{nome}  ·  {dur:.1f}s", col, os.path.join(a.saida, nome + ".jpg"))
            print(s or f"sem quadros: {v}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def cmd_video(a):
    v = a.alvos[0]; dur = duracao(v); nome = os.path.splitext(os.path.basename(v))[0]
    os.makedirs(a.saida, exist_ok=True)
    ts = tempos(dur, a.fps, 0, a.de or 0.0, a.ate)
    tmp = tempfile.mkdtemp()
    try:
        # vídeo longo: decodifica uma vez em vez de um seek por quadro
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a.de or 0:.3f}", *(["-to", f"{a.ate:.3f}"] if a.ate else []),
                        "-i", v, "-vf", f"fps={a.fps},scale={a.larg or 270}:-2", "-q:v", "3",
                        os.path.join(tmp, "q%05d.jpg")], capture_output=True)
        js = sorted(glob.glob(os.path.join(tmp, "q*.jpg")))
        it = [((a.de or 0) + i / a.fps, f) for i, f in enumerate(js)]
        por = a.por_folha
        for k in range(0, len(it), por):
            parte = it[k:k + por]
            s = montar(parte, f"{nome}  ·  {parte[0][0]:.1f}–{parte[-1][0]:.1f}s de {dur:.1f}s", 8,
                       os.path.join(a.saida, f"{nome}_{k // por + 1:02d}.jpg"))
            print(s)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["clipes", "video"]); ap.add_argument("alvos", nargs="+")
    ap.add_argument("--saida", default=os.path.join(os.environ.get("FLOW_TRABALHO") or ".", "folhas"))
    ap.add_argument("--fps", type=float, default=2); ap.add_argument("--larg", type=int, default=0)
    ap.add_argument("--max", type=int, default=24); ap.add_argument("--de", type=float); ap.add_argument("--ate", type=float)
    ap.add_argument("--por-folha", type=int, default=24)
    a = ap.parse_args()
    (cmd_clipes if a.modo == "clipes" else cmd_video)(a)
