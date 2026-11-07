"""Cena de clone: duas tomadas no tripé (a mesma pessoa em dois papéis) viram um quadro só, metade de cada uma.

  clone_lado_a_lado.py plano.json

plano.json:
  {"esquerda": "IMG_2901.MOV",          # tomada de quem fica na metade esquerda
   "direita":  "IMG_2897.MOV",          # tomada de quem fica na metade direita
   "corte": 0.5,                        # onde as metades se encontram (fração da largura)
   "saida": "cena_clone.mp4",
   "partes": [                          # na ordem do roteiro; o áudio vem de quem fala
     {"fala": "esquerda", "esq": 7.067,  "dir": 12.4,   "dur": 3.9},
     {"fala": "direita",  "esq": 14.7,   "dir": 17.733, "dur": 1.3}]}

Regras que custaram retrabalho (LEAD K01, 2026-10-26):
- Quem NÃO fala tem que estar fazendo a ação do roteiro (ex.: as roscas) desde o 1º quadro — escolha o trecho da tomada
  dele olhando quadro a quadro, não pelo tempo da fala.
- "esq"/"dir" são os tempos DE CADA ARQUIVO. Trocar os dois deixa a parte muda: confira o volume de cada parte
  (o script imprime) e olhe um quadro antes de seguir.
"""
import json, os, subprocess, sys

def main(p):
    P = json.load(open(p)); base = os.path.dirname(os.path.abspath(p))
    E = os.path.join(base, P["esquerda"]); D = os.path.join(base, P["direita"]); saida = os.path.join(base, P["saida"])
    w, h = map(int, subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                             "stream=width,height", "-of", "csv=p=0", E]).decode().split(","))
    x = int(round(w * P.get("corte", 0.5) / 2)) * 2
    tmp = []
    for i, pt in enumerate(P["partes"]):
        a = 0 if pt["fala"] == "esquerda" else 1; d = pt["dur"]; o = f"{saida}.parte{i}.mp4"; tmp.append(o)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(pt["esq"]), "-t", str(d), "-i", E, "-ss", str(pt["dir"]), "-t", str(d), "-i", D,
                        "-filter_complex",
                        f"[0:v]crop={x}:{h}:0:0,setpts=PTS-STARTPTS[l];[1:v]crop={w - x}:{h}:{x}:0,setpts=PTS-STARTPTS[r];"
                        f"[l][r]hstack=2,fps=30,format=yuv420p[v];[{a}:a]aresample=48000,afade=t=in:d=0.004,afade=t=out:st={d - 0.004:.3f}:d=0.004[a]",
                        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-c:a", "aac", "-b:a", "192k", o], check=True)
        vol = subprocess.run(["ffmpeg", "-hide_banner", "-i", o, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
        mv = next((l.split(":")[-1].strip() for l in vol.splitlines() if "mean_volume" in l), "?")
        print(f"parte {i + 1} ({pt['fala']} fala, {d}s): volume médio {mv}  <- se for menor que -30 dB, os tempos estão trocados")
    lista = saida + ".lista.txt"; open(lista, "w").write("".join(f"file '{t}'\n" for t in tmp))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", saida], check=True)
    for t in tmp + [lista]: os.remove(t)
    print("pronto:", saida)

if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(__doc__)
    main(sys.argv[1])
