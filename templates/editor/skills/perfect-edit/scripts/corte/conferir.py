"""Conferência do corte.

  conferir.py <trabalho> pausas [nome ...]   sincronia A/V + pausas >= 0,2 s que sobraram (mapeadas para o bruto)
  conferir.py <trabalho> texto  [nome ...]   re-transcreve a saída e compara com as palavras que deviam ficar
  conferir.py <trabalho> janela nome:ini:fim ...   transcreve um trecho da SAÍDA (tira dúvida de palavra comida)
  conferir.py <trabalho> fonte  chave:ini:fim ...  transcreve um trecho do BRUTO sozinho (acha retomada escondida
                                                   dentro de palavra esticada ⟨2.3s⟩)
  conferir.py <trabalho> quadro chave:seg ...      salva um quadro do bruto em <trabalho>/quadros/ para olhar
"""
import os, sys, re, difflib, subprocess
from base import *


def saida_de(trab, nome): return os.path.join(plano(trab)["saida"], nome + ".mp4")


def pausas(trab, nomes):
    p = plano(trab)
    for nome in nomes:
        f = saida_de(trab, nome)
        dv = float(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", f]).split()[0])
        da = float(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", f]).split()[0])
        fontes = [fonte(trab, q["key"]) for q in p["cortes"][nome]]
        piso = max(d["info"]["piso"] for d in fontes); fps = fontes[0]["info"]["fps"]
        lim = -40 if piso <= -50 else round(piso + 6)
        err = subprocess.run(["ffmpeg", "-hide_banner", "-i", f, "-af", f"silencedetect=n={lim}dB:d=0.2", "-f", "null", "-"], capture_output=True, text=True).stderr
        st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]; du = [float(x) for x in re.findall(r"silence_duration: ([\d.]+)", err)]
        dif = abs(dv - da) * fps
        print(f"{nome}: {dv:.1f}s | A/V difere {dif:.1f} quadro(s) | pausas >= 0,2 s (limiar {lim} dB): {len(st)}")
        mapa = []; t = 0
        for m in ler_json(f"{trab}/segs/{nome}.json"):
            for a, b in m["segs"]: mapa.append((t, t + b - a, a, m["key"])); t += b - a
        for s0, d in zip(st, du):
            hit = next((m for m in mapa if m[1] > s0), None)
            if not hit: continue
            o, e, a, k = hit; src = a + (s0 - o)
            ctx = " ".join(w["word"].strip() for w in fonte(trab, k)["palavras"] if src - 2 < w["start"] < src + 2)
            print(f"   saída {s0:.2f}s ({d:.2f}s) <- {k} {src:.2f}s | {ctx}")


def transcrever_arquivo(m, video, a=None, b=None):
    args = ["ffmpeg", "-v", "error"] + (["-ss", str(a), "-t", str(b - a)] if a is not None else []) + ["-i", video, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
    x = np.frombuffer(subprocess.run(args, check=True, capture_output=True).stdout, np.int16).astype(np.float32) / 32768
    return x


def texto(trab, nomes):
    from base import modelo
    m = modelo(); p = plano(trab)
    for nome in nomes:
        esp = []
        for q in p["cortes"][nome]:
            W = fonte(trab, q["key"])["palavras"]
            for it in q["keep"]:
                if isinstance(it, dict): esp += [w["word"] for w in W if w["start"] >= it["t"][0] - .05 and w["end"] <= it["t"][1] + .05]
                else: esp += [W[i]["word"] for i in range(it[0], it[1] + 1)]
        x = transcrever_arquivo(m, saida_de(trab, nome)); e = db_10ms(x, 16000)
        cortes = [0]   # blocos de ~20 s cortados no ponto mais quieto, para não partir palavra
        while cortes[-1] + 2000 < len(e):
            c = cortes[-1] + 1800; cortes.append(c + int(np.argmin(e[c:c + 400])))
        cortes.append(len(e)); got = []; T = []
        for c0, c1 in zip(cortes, cortes[1:]):
            for w, s, _ in transcrever_trecho(m, x[c0 * 160:c1 * 160]):
                if norm(w): got.append(norm(w)); T.append(c0 / 100 + s)
        a = [norm(w) for w in esp if norm(w)]
        sm = difflib.SequenceMatcher(None, a, got, autojunk=False)
        print(f"== {nome}: esperado {len(a)} palavras, saída {len(got)}, similaridade {sm.ratio():.3f}")
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op != "equal":
                t = T[min(j1, len(T) - 1)] if T else 0
                print(f"   {op:7} esperado[{' '.join(a[i1:i2])}] saída[{' '.join(got[j1:j2])}] @{t:.1f}s")


def janelas(trab, itens, da_fonte):
    from base import modelo
    m = modelo()
    for it in itens:
        n, a, b = it.rsplit(":", 2); a, b = float(a), float(b)
        video = fonte(trab, n)["video"] if da_fonte else saida_de(trab, n)
        x = transcrever_arquivo(m, video, a, b)
        print(n, f"{a}-{b} |", " ".join(f"{w.strip()}@{a + s:.2f}" for w, s, _ in transcrever_trecho(m, x)))


def quadros(trab, itens):
    os.makedirs(f"{trab}/quadros", exist_ok=True)
    for it in itens:
        k, t = it.rsplit(":", 1); dest = f"{trab}/quadros/{k}_{t}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", t, "-i", fonte(trab, k)["video"], "-frames:v", "1", "-vf", "scale=-2:480", dest], check=True)
        print(dest)


if __name__ == "__main__":
    trab = os.path.expanduser(sys.argv[1]); cmd = sys.argv[2]; resto = sys.argv[3:]
    if cmd in ("pausas", "texto") and not resto: resto = list(plano(trab)["cortes"])
    {"pausas": lambda: pausas(trab, resto), "texto": lambda: texto(trab, resto),
     "janela": lambda: janelas(trab, resto, False), "fonte": lambda: janelas(trab, resto, True),
     "quadro": lambda: quadros(trab, resto)}[cmd]()
