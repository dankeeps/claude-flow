"""Ditado do app (microfone no celular): fica de pé recebendo caminhos de áudio pela entrada, um por linha, e
responde uma linha JSON {"texto": ...} ou {"erro": ...}. Usa o Whisper do Atlas (placa de vídeo quando dá).
Rodado pelo server/ditado.js com o python da .venv do Atlas; sai sozinho quando a entrada fecha."""
import json
import os
import sys

atlas = sys.argv[1]
sys.path.insert(0, os.path.join(atlas, "lib"))
import gpu  # noqa: E402

gpu.libs_nvidia()
from faster_whisper import WhisperModel  # noqa: E402
from comum import MODELOS  # noqa: E402

modelo = WhisperModel(os.environ.get("DITADO_MODELO", "large-v3-turbo"), **gpu.whisper_kwargs(),
                      download_root=os.path.join(MODELOS, "whisper"))
print(json.dumps({"pronto": True}), flush=True)

for linha in sys.stdin:
    arq = linha.strip()
    if not arq:
        continue
    try:
        segs, _ = modelo.transcribe(arq, language="pt", vad_filter=True, condition_on_previous_text=False)
        texto = " ".join(s.text.strip() for s in segs).strip()
        print(json.dumps({"texto": texto}, ensure_ascii=False), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"erro": str(e)[:300]}, ensure_ascii=False), flush=True)
