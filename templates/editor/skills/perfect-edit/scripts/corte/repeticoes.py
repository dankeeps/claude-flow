"""Caça tomada repetida que sobrou no corte.

  repeticoes.py arquivo.mp4 [arquivo2 ...]

O Whisper "limpa" a fala: numa janela longa ele escreve "a ficha de academia, 4 de 12" mesmo quando o áudio
diz "a ficha de academia… a ficha de academia, 4 de 12" (repetição sem pausa, dentro do mesmo bloco).
Em janela curta (4 s, passo 2 s) ele não tem como limpar e a repetição aparece. Marca toda sequência
de 2+ palavras que se repete dentro da janela. Repetição que existe no roteiro ("cara 2 … cara 2",
"o seu físico… o seu objetivo") também aparece — confira no roteiro.

Roda no whisper-cli do whisper.cpp (no Mac pela Metal/GPU, ~70 s por anúncio de 90 s; o faster-whisper em CPU levaria
~6 min). No Windows: whisper-cli.exe da release do whisper.cpp no PATH (versão CUDA com placa NVIDIA; sem placa, CPU,
bem mais lento). WHISPER_CLI e WHISPER_GGML trocam o executável e o modelo.
"""
import sys, os, glob, shutil, tempfile, subprocess
from base import norm

MODELO = os.path.expanduser(os.environ.get("WHISPER_GGML", "~/whisper-models/ggml-large-v3-turbo.bin"))
CLI = os.environ.get("WHISPER_CLI", "whisper-cli")
VAZIAS = {"o", "a", "os", "as", "de", "do", "da", "e", "e", "que", "um", "uma", "no", "na", "em", "pra", "pro", "se", "seu", "sua"}


def repetidas(ws):
    achou = []
    for n in (4, 3, 2):
        for i in range(len(ws) - n):
            g = ws[i:i + n]
            if all(w in VAZIAS for w in g): continue
            for j in range(i + 1, min(len(ws) - n + 1, i + n + 6)):
                if ws[j:j + n] == g: achou.append(" ".join(g))
    return achou


def varrer(video, jan=4.0, passo=2.0):
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]))
    tmp = tempfile.mkdtemp(); ts = []
    t = 0.0
    while t < dur - .5:
        p = f"{tmp}/{t:07.1f}.wav"; ts.append((t, p))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-t", str(jan), "-i", video, "-ac", "1", "-ar", "16000", p], check=True)
        t += passo
    if not shutil.which(CLI): sys.exit(f"{CLI} não encontrado: instale o whisper.cpp (README, seção repeticoes.py)")
    cmd = [CLI, "-m", MODELO, "-l", "pt", "-nt", "-np", "-otxt"]
    for _, p in ts: cmd += ["-f", p]
    subprocess.run(cmd, capture_output=True)
    vistos = set()
    for t, p in ts:
        texto = open(p + ".txt", encoding="utf-8").read().strip().replace("\n", " ") if os.path.exists(p + ".txt") else ""
        toks = [norm(w) for w in texto.split() if norm(w)]
        for g in repetidas(toks):
            if (g, round(t / 4)) in vistos: continue
            vistos.add((g, round(t / 4)))
            print(f"   {t:6.1f}s  «{g}»  | {texto}", flush=True)
    shutil.rmtree(tmp)


if __name__ == "__main__":
    for v in sys.argv[1:]:
        print(f"== {os.path.basename(v)}", flush=True); varrer(v)
