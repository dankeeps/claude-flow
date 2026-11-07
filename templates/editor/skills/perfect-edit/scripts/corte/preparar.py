"""Transcreve cada bruto em blocos curtos (separados por pausa do VAD) e gera a transcrição indexada.

  preparar.py <pasta_dos_brutos> [--trabalho DIR] [--prompt "termos da oferta"]

Por que em blocos: numa passada só, o Whisper engole tomadas repetidas (estica uma palavra por cima de 2-4 s
e some com a retomada). Transcrevendo cada trecho de fala sozinho, as repetições aparecem.

Saída em <trabalho>: wav/, tr/<chave>.json e transcricao.txt (o que se lê para decidir os cortes).
Chave = <pasta>_<arquivo> (ex.: AD01_IMG_1746). Já transcrito não é refeito.
"""
import os, sys, glob, time, argparse
from base import *
from vad import detectar_fala, unir

SUSPEITAS = ("tchau", "obrigad", "inscreva", "sininho", "legenda", "amara", "notificac")


def blocos_de_fala(baixo):
    out = []
    for a, b in unir(baixo, gap=0.35):
        if out and b - out[-1][0] < 12 and a - out[-1][1] < 0.8: out[-1][1] = b
        else: out.append([a, b])
    return out


def preparar(pasta, trab, prompt):
    from base import modelo
    m = modelo()
    os.makedirs(f"{trab}/wav", exist_ok=True); os.makedirs(f"{trab}/tr", exist_ok=True)
    videos = sorted(v for v in glob.glob(os.path.join(pasta, "**", "*"), recursive=True)
                    if v.lower().endswith(VIDEOS) and "/cortados/" not in v)
    for v in videos:
        pai = os.path.basename(os.path.dirname(v)); stem = os.path.splitext(os.path.basename(v))[0]
        key = stem if os.path.normpath(os.path.dirname(v)) == os.path.normpath(pasta) else f"{pai}_{stem}"
        out = f"{trab}/tr/{key}.json"
        if os.path.exists(out): continue
        t = time.time(); wav = f"{trab}/wav/{key}.wav"; wav16(v, wav)
        x = ler_wav16(wav); baixo, alto = detectar_fala(x)
        blocos = blocos_de_fala(baixo); W = []
        for j, (a, b) in enumerate(blocos):
            a0 = max(0, a - .2); b0 = min(len(x) / 16000, b + .2)
            for w, s, e in transcrever_trecho(m, x[int(a0 * 16000):int(b0 * 16000)], prompt):
                W.append(dict(word=w, start=a0 + s, end=a0 + e, bloco=j))
        db = db_10ms(x, 16000)
        info = sonda(v); info.update(piso=float(np.percentile(db, 5)), fala90=float(np.percentile(db, 90)))
        gravar_json(out, dict(video=v, info=info, palavras=W, vad_baixo=baixo, vad_alto=alto, blocos=blocos))
        print(f"{key}: {len(W)} palavras, {time.time() - t:.0f}s", flush=True)
    escrever_transcricao(trab)


def escrever_transcricao(trab):
    linhas = []
    for f in sorted(glob.glob(f"{trab}/tr/*.json")):
        d = ler_json(f); W = d["palavras"]; i = d["info"]; key = os.path.basename(f)[:-5]
        tipo = "HORIZONTAL" if i["w"] > i["h"] else "vertical"
        ruido = "com ruído de fundo" if i["piso"] > -50 else "limpo"
        linhas.append(f"\n######## {key}  ({len(W)} palavras | {i['w']}x{i['h']} {tipo} | {i['dur']:.0f}s | {i['fps']:.4g}fps | áudio {ruido}, piso {i['piso']:.0f} dB)")
        if not W: linhas.append("   (SEM FALA — provável take visual/mudo; ver um quadro antes de decidir)"); continue
        linha = ""; prev = None
        for k, w in enumerate(W):
            if prev is not None and (w["bloco"] != W[prev]["bloco"] or w["start"] - W[prev]["end"] > .5):
                linhas.append(linha); linha = ""
            if not linha:
                txt = " ".join(x["word"] for x in W if x["bloco"] == w["bloco"]).lower()
                flag = " «ALUCINAÇÃO?»" if any(s in txt for s in SUSPEITAS) else ""
                linha = f"@{w['start']:.1f}{flag} "
            dur = w["end"] - w["start"]
            linha += f" {k}:{w['word'].strip()}" + (f"⟨{dur:.1f}s⟩" if dur > 1.0 else "")
            prev = k
        linhas.append(linha)
    open(f"{trab}/transcricao.txt", "w").write("\n".join(linhas) + "\n")
    print(f"transcrição indexada: {trab}/transcricao.txt")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pasta"); ap.add_argument("--trabalho"); ap.add_argument("--prompt", default=PROMPT_PADRAO)
    a = ap.parse_args()
    pasta = os.path.abspath(os.path.expanduser(a.pasta))
    trab = os.path.expanduser(a.trabalho) if a.trabalho else trabalho_padrao(pasta)
    print("trabalho:", trab, flush=True)
    preparar(pasta, trab, a.prompt)
