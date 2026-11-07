"""Coloca depoimentos de outra versão (ex.: a V0 que já rodava) dentro do vídeo pronto, num render só.

  inserir_depoimentos.py plano.json

plano.json:
  {"base":  "LEAD K01 + VSL1.mp4",          # o vídeo editado (vertical 1080x1920, 30 fps)
   "fonte": "V0.mp4",                       # de onde saem os depoimentos e as imagens
   "saida": "LEAD K01 + VSL1 - com depoimentos.mp4",
   "depoimentos": [                         # entram COM o áudio deles e empurram o resto do vídeo
     {"apos": 239.53, "de": 303.17, "ate": 313.12, "nome": "Fernando"}],
   "imagens": [                             # entram POR CIMA da fala da base, sem áudio (antes/depois, prints)
     {"no_base": 669.0, "de": 749.5, "ate": 750.8, "lento": 2.0, "nome": "fotos antes e depois"}]}

- "apos" = tempo NA BASE entre o fim da frase-gancho e a próxima palavra ("Foi o que aconteceu com o Fernando." | depoimento).
  Ache com o Whisper da base (whisper.json do Atlas + duração da LEAD, se ela vier antes).
- "de"/"ate" = tempo na fonte: primeira e última palavra do depoimento (Whisper da fonte com word_timestamps).
- Imagem: recorte só os quadros em que ela aparece (olhe quadro a quadro: 0,05 s a mais já mostra o apresentador da fonte).
- O volume de cada depoimento é igualado (loudnorm -15 LUFS). A fonte é ampliada para 1080x1920.
- Conferência: transcreva SÓ o trecho inserido (em janela longa o Whisper pula o depoimento e parece que sumiu).
"""
import json, os, subprocess, sys

def mmss(t): return f"{int(t // 60)}:{t % 60:05.2f}"

def main(p):
    P = json.load(open(p)); base = os.path.dirname(os.path.abspath(p)); j = lambda f: os.path.join(base, f)
    q = lambda t: round(round(t * 30) / 30, 4)
    deps = sorted(P.get("depoimentos", []), key=lambda d: d["apos"]); imgs = P.get("imagens", [])
    cortes = [q(d["apos"]) for d in deps]
    fc = ["[0:v]setsar=1[b0v]"]; cur = "b0v"
    for k, im in enumerate(imgs):
        dur = (im["ate"] - im["de"]) * im.get("lento", 1.0); t0 = q(im["no_base"])
        fc.append(f"[2:v]trim={im['de']}:{im['ate']},setpts=(PTS-STARTPTS)*{im.get('lento', 1.0)}+{t0}/TB,"
                  f"scale=1080:1920:flags=lanczos,setsar=1,fps=30,format=yuv420p[im{k}]")
        fc.append(f"[{cur}][im{k}]overlay=enable='between(t,{t0},{t0 + dur:.3f})':eof_action=pass[ov{k}]"); cur = f"ov{k}"
    n = len(cortes) + 1
    fc.append(f"[{cur}]split={n}" + "".join(f"[b{i}]" for i in range(n)))
    fc.append(f"[0:a]asplit={n}" + "".join(f"[ba{i}]" for i in range(n)))
    if deps:
        fc.append(f"[1:v]split={len(deps)}" + "".join(f"[d{i}]" for i in range(len(deps))))
        fc.append(f"[1:a]asplit={len(deps)}" + "".join(f"[da{i}]" for i in range(len(deps))))
    lim = [0] + cortes + [None]; partes = []
    for i in range(n):
        a, b = lim[i], lim[i + 1]; tr = f"{a}" + (f":{b}" if b is not None else "")
        fc.append(f"[b{i}]trim={tr},setpts=PTS-STARTPTS,setsar=1[s{i}]")
        fc.append(f"[ba{i}]atrim={tr},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,aformat=sample_rates=48000:channel_layouts=stereo[sa{i}]")
        partes.append(f"[s{i}][sa{i}]")
        if i < len(deps):
            x, y = deps[i]["de"], deps[i]["ate"]; d = y - x
            fc.append(f"[d{i}]trim={x}:{y},setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,setsar=1,fps=30,format=yuv420p[t{i}]")
            fc.append(f"[da{i}]atrim={x}:{y},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-15:TP=-1.5,"
                      f"aresample=48000,afade=t=in:d=0.02,afade=t=out:st={d - 0.03:.3f}:d=0.03[ta{i}]")
            partes.append(f"[t{i}][ta{i}]")
    fc.append("".join(partes) + f"concat=n={len(partes)}:v=1:a=1[v][a]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", j(P["base"]), "-i", j(P["fonte"]), "-i", j(P["fonte"]),
                    "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", j(P["saida"])], check=True)
    print("minutagem no vídeo novo:"); off = 0
    for c, d in zip(cortes, deps):
        ini = c + off; dur = d["ate"] - d["de"]
        print(f"  depoimento {d.get('nome', '')}: {mmss(ini)} a {mmss(ini + dur)} ({dur:.1f}s, fonte {mmss(d['de'])})"); off += dur
    for im in imgs:
        t = q(im["no_base"]) + sum(d["ate"] - d["de"] for c, d in zip(cortes, deps) if c < im["no_base"])
        print(f"  imagem {im.get('nome', '')}: {mmss(t)} a {mmss(t + (im['ate'] - im['de']) * im.get('lento', 1.0))} (sem áudio)")

if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(__doc__)
    main(sys.argv[1])
