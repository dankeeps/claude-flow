"""Peças comuns do Perfect Cut: Whisper (faster-whisper large-v3-turbo) e o VAD Silero que vem junto com ele."""
import os, sys, json, subprocess, re, unicodedata, wave
import numpy as np

# ffmpeg/ffprobe do Homebrew no PATH (o shell de app às vezes não carrega o perfil)
os.environ["PATH"] = os.pathsep.join(dict.fromkeys(os.environ.get("PATH", "/usr/bin:/bin").split(os.pathsep)
                                                   + ["/opt/homebrew/bin", "/usr/local/bin"]))
MODELOS = os.path.expanduser(os.environ.get("PERFECT_CUT_MODELOS", "~/.cache/perfect-cut"))
_modelo = None


def modelo():
    """Whisper large-v3-turbo na CPU (int8). Baixa uma vez para ~/.cache/perfect-cut/whisper.
    PERFECT_CUT_DEVICE=cuda usa a placa NVIDIA (Windows/Linux, precisa do CUDA 12 + cuDNN 9)."""
    global _modelo
    if _modelo is None:
        from faster_whisper import WhisperModel
        dev = os.environ.get("PERFECT_CUT_DEVICE", "cpu")
        _modelo = WhisperModel(os.environ.get("PERFECT_CUT_WHISPER", "large-v3-turbo"), device=dev,
                               compute_type="int8" if dev == "cpu" else "float16",
                               cpu_threads=max(1, os.cpu_count() or 8), download_root=os.path.join(MODELOS, "whisper"))
    return _modelo

VIDEOS = (".mov", ".mp4", ".m4v", ".mkv")
PROMPT_PADRAO = ""


def trabalho_padrao(pasta_brutos):
    return os.path.expanduser(os.path.join("~/Perfect Cut/trabalho", os.path.basename(os.path.normpath(pasta_brutos))))


def ler_json(p): return json.load(open(p))
def gravar_json(p, d): json.dump(d, open(p, "w"), ensure_ascii=False)


def plano(trab):
    p = ler_json(os.path.join(trab, "plano.json"))
    p["saida"] = os.path.expanduser(p.get("saida", "~/Downloads/cortados"))
    return p


def fonte(trab, key):
    return ler_json(os.path.join(trab, "tr", key + ".json"))


def sonda(video):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,r_frame_rate:stream_side_data=rotation:format=duration", "-of", "json", video])
    d = json.loads(out); s = d["streams"][0]; n, q = s["r_frame_rate"].split("/")
    # Câmera (Canon 0N3A…) grava 3840x2160 com rotação 90: o ffmpeg gira ao decodificar, então o vídeo é VERTICAL.
    # Sem isso, "formato" 1920x1080 achatou a VSL 1 (2026-10-21). w/h aqui = como o vídeo aparece.
    rot = abs(int(next((x.get("rotation", 0) for x in s.get("side_data_list", []) if "rotation" in x), 0)))
    if rot % 180 == 90: s["width"], s["height"] = s["height"], s["width"]
    fps = int(n) / int(q)   # 59,94 fica 59,94: arredondar para 60 descola a boca do áudio 0,1% (0,27 s em 4 min)
    return dict(w=s["width"], h=s["height"], fps=round(fps) if abs(fps - round(fps)) < 1e-6 else fps,
                dur=float(d["format"]["duration"]))


def wav16(video, destino):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", destino], check=True)


def ler_wav16(p):
    with wave.open(p, "rb") as f:
        return np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def pcm48(video):
    """Áudio mono 48 kHz float32 do vídeo inteiro."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def db_10ms(x, sr):
    h = sr // 100; n = len(x) // h
    return 20 * np.log10(np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1)) + 1e-9)


def norm(w):
    w = unicodedata.normalize("NFD", w.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


def transcrever_trecho(modelo, x, prompt=""):
    """Transcreve um pedaço de áudio 16 kHz; devolve [(palavra, ini, fim)] relativos ao pedaço.
    O alinhamento por palavra às vezes quebra em trecho curto: cai para distribuição uniforme no segmento."""
    try:
        segs = list(modelo.transcribe(x, language="pt", word_timestamps=True, condition_on_previous_text=False,
                                      initial_prompt=prompt or None)[0])
        return [(w.word, float(w.start), float(w.end)) for s in segs for w in (s.words or [])]
    except Exception:
        segs = list(modelo.transcribe(x, language="pt", condition_on_previous_text=False, initial_prompt=prompt or None)[0])
        out = []
        for s in segs:
            ws = s.text.split()
            for i, t in enumerate(ws):
                a = s.start + (s.end - s.start) * i / len(ws); b = s.start + (s.end - s.start) * (i + 1) / len(ws)
                out.append((" " + t, a, b))
        return out
