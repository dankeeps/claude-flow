"""Segmentação acústica conservadora: remove só ausência de fala concordante.

Não escolhe takes, não altera transcrição e não chama provedores. Faixas são o
complemento cronológico de exclusões aprovadas. Silero embarcado no faster-whisper
mantém fala mesmo omitida pelo ASR; palavras curtas preservam discordâncias/baixa voz.
Palavras com timestamps >1s não bloqueiam pausas internas evidentes de vários segundos.
"""
import math
import wave


def unir(intervalos, gap=0.0):
    out = []
    for a, b in sorted((float(a), float(b)) for a, b in intervalos if b > a):
        if out and a <= out[-1][1] + gap + 1e-9: out[-1][1] = max(out[-1][1], b)
        else: out.append([a, b])
    return out


def ler_audio(wav16k):
    import numpy as np
    with wave.open(str(wav16k), 'rb') as f:
        if (f.getframerate(), f.getnchannels(), f.getsampwidth()) != (16000, 1, 2):
            raise ValueError('VAD requer WAV mono PCM16 a 16 kHz')
        return np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def detectar_fala(audio):
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    resultado = []
    for limiar in (0.35, 0.5):
        partes = get_speech_timestamps(audio, VadOptions(threshold=limiar,
            min_speech_duration_ms=0, min_silence_duration_ms=160, speech_pad_ms=0), sampling_rate=16000)
        resultado.append([[p['start'] / 16000, p['end'] / 16000] for p in partes])
    return resultado


def confianca_refino(p):
    value=p.get('probabilidade')
    if isinstance(value,bool) or not isinstance(value,(int,float)):
        return None
    return float(value) if math.isfinite(value) and 0<=value<=1 else None


def protecoes_palavras(palavras, voz, margem=.08):
    """Protege 80ms antes/depois da voz; palavra sem VAD fica inteira/incerta.

    ASR curto sobreposto à voz não é prova de que sua antecedência inteira tem
    fala. Limitá-lo pela acústica evita os600ms artificiais, mantendo margem
    para consoantes fracas. Ausência TOTAL de VAD não autoriza apagar a palavra.
    """
    if not math.isfinite(margem) or not 0<=margem<=.12:
        raise ValueError('Margem acústica deve estar entre0 e120ms')
    protecoes=[];incertas=[]
    voz=unir(voz)
    for p in palavras or ():
        a,b=float(p.get('t',p.get('start',0))),float(p.get('e',p.get('end',0)))
        if not all(math.isfinite(v) for v in (a,b)) or not 0<b-a<=1:
            continue
        sobrepostas=[[c,d] for c,d in voz if min(b,d)>max(a,c)]
        if not sobrepostas:
            # Uma hipótese nova e fraca do refino não pode criar uma ilha de
            # silêncio protegido. Originais permanecem conservadoras.
            confianca=confianca_refino(p)
            if p.get('_refino_adicional') and (confianca is None or confianca<.6):
                continue
            protecoes.append([a,b])
            incertas.append(dict(p,motivo='palavra inteira fora dos dois detectores de voz'))
        else:
            protecoes.extend([[max(a,c-margem),min(b,d+margem)] for c,d in sobrepostas])
    return unir(protecoes),incertas


def planejar_segmentos(duracao, faixas, fala_baixa, fala_alta, palavras=(), *, pausa_min=0.16,
                        respiro=1/30, cauda=1/30, fps=30, relatorio=None):
    """Planeja sem I/O; só retira silêncio de ambos limiares e fora de palavra plausível.

    Intervalos curtos do ASR são proteções conservadoras, não prova de ruído/fala.
    Um timestamp esticado não é tratado como 12 segundos de fala contínua.
    Padding é de um frame e fica dentro das faixas aprovadas. Todas as bordas
    arredondam para fora para proteger fala válida adjacente; pode retornar
    menos de um frame da fronteira removida, nunca uma palavra/take inteiro.
    """
    params = (duracao, pausa_min, respiro, cauda, fps)
    if not all(math.isfinite(float(v)) for v in params) or duracao <= 0 or fps <= 0:
        raise ValueError('Duração/parâmetros VAD inválidos')
    if pausa_min < .15 or not 0 <= respiro <= .12 or not 0 <= cauda <= .12:
        raise ValueError('VAD requer pausa mínima de 150 ms e padding entre 0 e 120 ms')
    limitadas = []
    for a, b in faixas:
        a, b = float(a), float(b)
        if not all(math.isfinite(v) for v in (a, b)) or b <= a: raise ValueError('Faixa inválida')
        a, b = max(0., a), min(float(duracao), b)
        if b > a: limitadas.append([a, b])
    limitadas = unir(limitadas)
    voz=unir([*fala_baixa,*fala_alta])
    protecoes,incertas=protecoes_palavras(palavras,voz)
    if relatorio is not None:
        relatorio['margem_protecao_asr']=.08
        relatorio['palavras_sem_vad']=[p for p in incertas if any(
            min(float(p.get('e',p.get('end',0))),hi)>
            max(float(p.get('t',p.get('start',0))),lo) for lo,hi in limitadas)]
    # Toda voz detectada permanece; ASR só amplia80ms onde sobrepõe voz.
    fala = unir([*voz, *protecoes], gap=pausa_min)
    out = []
    for lo, hi in limitadas:
        first_frame = math.floor(lo*fps + 1e-7)
        last_frame = math.ceil(hi*fps - 1e-7)
        local = []
        for a, b in fala:
            if b <= lo or a >= hi: continue
            a, b = max(lo, a), min(hi, b)
            start = max(0., max(first_frame, math.floor((a-respiro)*fps + 1e-7)) / fps)
            end = min(float(duracao), min(last_frame, math.ceil((b+cauda)*fps - 1e-7)) / fps)
            if end > start: local.append([start, end])
        # Não criar um jump cut que removeria menos de um frame.
        out.extend(unir(local, gap=1/fps - 1e-7))
    # Arredondamento externo de faixas vizinhas pode sobrepor um frame.
    return unir(out)


