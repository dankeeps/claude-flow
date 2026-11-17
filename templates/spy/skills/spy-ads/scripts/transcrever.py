"""Transcreve vídeos (anúncio ou VSL) no computador, com o Whisper do Atlas na placa de vídeo.
Rode com o Python do Atlas:  "$PERFECT_EDIT_ATLAS/.venv/Scripts/python.exe" transcrever.py <video> [<video>...]
Para cada vídeo grava, ao lado dele: <nome>.txt (texto corrido), <nome>.srt (legenda) e <nome>.json (trechos
com início/fim, para achar o hook, a promessa e as viradas pelo tempo). Idioma automático (pt, en, es).
"""
import json
import os
import sys
import time
from pathlib import Path

ATLAS = Path(os.environ.get("PERFECT_EDIT_ATLAS") or Path.home() / "Octo Edição" / "Atlas")
sys.path.insert(0, str(ATLAS / "lib"))
MODELOS = Path(os.environ.get("ESTUDIO_MODELOS") or Path.home() / "ClaudeFlow" / "cache" / "atlas-modelos")


def hms(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s % 1) * 1000):03d}"


def main(arquivos):
    try:
        import gpu
        kw = gpu.whisper_kwargs()
    except Exception:
        kw = dict(device="cpu", compute_type="int8")
    from faster_whisper import WhisperModel
    print(f"whisper na {'placa de vídeo' if kw['device'] == 'cuda' else 'CPU'}", file=sys.stderr)
    modelo = WhisperModel(os.environ.get("ESTUDIO_WHISPER_MODELO", "large-v3-turbo"),
                          download_root=str(MODELOS / "whisper"), **kw)
    saidas = []
    for a in arquivos:
        p = Path(a)
        t0 = time.time()
        segs, info = modelo.transcribe(str(p), vad_filter=True, beam_size=5)
        trechos = [{"ini": round(s.start, 2), "fim": round(s.end, 2), "texto": s.text.strip()} for s in segs]
        base = p.with_suffix("")
        Path(f"{base}.txt").write_text("\n".join(x["texto"] for x in trechos) + "\n", encoding="utf-8")
        Path(f"{base}.srt").write_text("".join(
            f"{i}\n{hms(x['ini'])} --> {hms(x['fim'])}\n{x['texto']}\n\n" for i, x in enumerate(trechos, 1)), encoding="utf-8")
        Path(f"{base}.json").write_text(json.dumps({"idioma": info.language, "duracao": round(info.duration, 1),
                                                     "trechos": trechos}, ensure_ascii=False, indent=1), encoding="utf-8")
        saidas.append({"video": str(p), "txt": f"{base}.txt", "idioma": info.language,
                       "duracao_s": round(info.duration), "palavras": sum(len(x["texto"].split()) for x in trechos),
                       "segundos_para_transcrever": round(time.time() - t0, 1)})
    print(json.dumps(saidas, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1:])
