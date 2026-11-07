"""Renderiza os cortes do plano.json: mantém só as faixas escolhidas e tira TODO silêncio entre as palavras.

  cortar.py <trabalho> [nome ...]        (sem nomes = todos do plano)

plano.json:
  {"saida": "~/Downloads/cortados",
   "cortes": {"o_k01_tsn_v1_r1": [ {"key": "AD01_IMG_1746", "keep": [[0,164], [167,179], {"t": [126.8,130.4]}],
                                    "fora": [[t0,t1]] } , ... ]}}
  keep: [i,j] = palavras i..j (inclusive) da transcrição; {"t":[a,b]} = trecho por tempo (retomada escondida).
  fora: trechos por tempo que saem mesmo dentro de um keep (opcional).
  Várias partes num corte = emendadas na ordem (diálogo gravado em arquivos separados, bruto em 2 arquivos);
  o vídeo é emendado sem recodificar e o áudio vira um AAC só (ver render).

Silêncio sai em duas camadas:
  1. VAD (Silero, dois limiares) + palavras: remove pausa >= 150 ms, deixa 1 quadro de cada lado.
  2. Energia: remove todo trecho abaixo do limiar por >= 120 ms (respiro/pausa que o VAD guardou como fala).
     Em bruto com ruído de fundo (piso > -50 dB), o miolo das palavras é protegido para não abrir buraco
     em consoante fraca.
Cortes caem no grade de quadros (áudio e vídeo com a mesma duração), emendas com fade de 4 ms (sem estalo).
Resolução, proporção e fps originais.
"""
import os, sys, math, shutil, tempfile, subprocess
from base import *
from vad import planejar_segmentos


def menos(faixas, fora):
    out = []
    for a, b in faixas:
        partes = [[a, b]]
        for c, e in fora:
            partes = [q for x, y in partes for q in ([[x, min(y, c)]] if c > x else []) + ([[max(x, e), y]] if e < y else []) if q[1] > q[0]]
        out += partes
    return out


def segmentos(d, keep, fora, fps, pausa=.15):
    W = d["palavras"]; dur = d["info"]["dur"]; faixas, prot = [], []
    for item in keep:
        if isinstance(item, dict):
            t0, t1 = item["t"]; faixas.append([t0, t1]); prot += [w for w in W if w["start"] >= t0 and w["end"] <= t1]; continue
        a, b = item
        lo = W[a]["start"] - .12; hi = W[b]["end"] + .15
        if a > 0: lo = max(lo, W[a - 1]["end"])
        if b + 1 < len(W): hi = min(hi, W[b + 1]["start"])
        faixas.append([max(0, lo), min(dur, hi)]); prot += W[a:b + 1]
    faixas = menos(faixas, fora)
    prot = [w for w in prot if not any(min(w["end"], e) > max(w["start"], c) for c, e in fora)]
    return planejar_segmentos(dur, faixas, d["vad_baixo"], d["vad_alto"], prot, pausa_min=pausa,
                              respiro=1 / fps, cauda=1 / fps, fps=fps)


def energia(x, segs, palavras, fps, run=.12, pad=.03, manter=()):
    db = db_10ms(x, 48000)
    piso = np.percentile(db, 5)
    thr = max(piso + 8, min(np.percentile(db, 90) - 28, -38))
    quieto = db < thr
    if piso > -50:   # ruído de fundo: consoante fraca fica abaixo do limiar, então protege o miolo da palavra
        for w in palavras:
            if w["end"] - w["start"] >= .8: continue
            fim = .25 if w["word"].strip()[-1:] in ".,?!;:" else .15   # Whisper estica o fim da palavra para dentro da pausa
            a, b = w["start"] + .08, w["end"] - fim
            if b > a: quieto[int(a * 100):int(b * 100) + 1] = False
    for a, b in manter: quieto[int(a * 100):int(b * 100) + 1] = False   # trecho que o plano mandou não picar
    out = []
    for a, b in segs:
        cortes = []; i = int(a * 100); fim = min(int(b * 100), len(quieto))
        while i < fim:
            if quieto[i]:
                j = i
                while j < fim and quieto[j]: j += 1
                if (j - i) / 100 >= run:
                    c = math.ceil((i / 100 + pad) * fps - 1e-7) / fps; e = math.floor((j / 100 - pad) * fps + 1e-7) / fps
                    if e > c: cortes.append((c, e))
                i = j
            else: i += 1
        cur = a
        for c, e in cortes:
            if c > cur: out.append([cur, c])
            cur = max(cur, e)
        if b > cur: out.append([cur, b])
    return [s for s in out if s[1] - s[0] >= 2 / fps - 1e-6]


def render(trab, nome, partes, saida, formato=None):
    os.makedirs(saida, exist_ok=True); os.makedirs(f"{trab}/segs", exist_ok=True)
    tmp = tempfile.mkdtemp(dir=trab); pedacos = []; total = 0; mapa = []
    fps = fonte(trab, partes[0]["key"])["info"]["fps"]
    # Partes de câmeras diferentes (4K/60 + 1080/30): "formato" no plano iguala tudo para emendar.
    escala = ""
    if formato: fps = formato["fps"]; escala = f",scale={formato['w']}:{formato['h']}:flags=lanczos,setsar=1"
    # O áudio de todas as partes vai num f32 só e vira AAC uma vez, no fim. Emendar AAC por pedaço (-c copy)
    # soma ~40 ms de atraso e um bolsão de silêncio em cada costura (10 partes = boca fora de sincronia no fim).
    todo = open(f"{tmp}/audio.f32", "wb")
    for i, p in enumerate(partes):
        d = fonte(trab, p["key"]); video = d["video"]
        segs = segmentos(d, p["keep"], p.get("fora", ()), fps)
        x = pcm48(video)
        segs = energia(x, segs, d["palavras"], fps, manter=p.get("manter", ()))
        total += sum(b - a for a, b in segs); mapa.append(dict(key=p["key"], segs=segs))
        f = 192; rampa = np.linspace(0, 1, f, dtype=np.float32)
        for a, b in segs:
            c = x[int(round(a * 48000)):int(round(b * 48000))].copy()
            if len(c) > 2 * f: c[:f] *= rampa; c[-f:] *= rampa[::-1]
            c.astype(np.float32).tofile(todo)
        sfps = d["info"]["fps"]
        # Em lotes: expressão select com centenas de faixas estoura o parser do ffmpeg (bruto longo de VSL).
        # Cada lote faz seek no começo (-copyts mantém os tempos originais no select) e para no fim.
        for g in range(0, len(segs), 40):
            lote = segs[g:g + 40]
            expr = "+".join(f"between(t,{a - 1e-4:.4f},{b - 1e-4:.4f})" for a, b in lote)
            sel = f"{tmp}/sel{i}_{g}.txt"; mp4 = f"{tmp}/p{i}_{g}.mp4"
            open(sel, "w").write(f"select='{expr}',setpts=N/{sfps}/TB{escala}")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, lote[0][0] - 2):.3f}", "-to", f"{lote[-1][1] + 1:.3f}",
                            "-copyts", "-i", video, "-/filter:v", sel, "-map", "0:v:0",
                            "-fps_mode", "cfr", "-r", str(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                            "-pix_fmt", "yuv420p", mp4], check=True)
            pedacos.append(mp4)
    todo.close()
    gravar_json(f"{trab}/segs/{nome}.json", mapa)
    final = os.path.join(saida, nome + ".mp4")
    lst = f"{tmp}/lista.txt"; open(lst, "w").write("".join(f"file '{p}'\n" for p in pedacos))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                    "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", f"{tmp}/audio.f32",
                    "-map", "0:v:0", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart", final], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"{nome}: {total:.1f}s -> {final}", flush=True)

if __name__ == "__main__":
    trab = os.path.expanduser(sys.argv[1]); p = plano(trab)
    nomes = sys.argv[2:] or list(p["cortes"])
    for n in nomes: render(trab, n, p["cortes"][n], p["saida"], p.get("formato", {}).get(n))
