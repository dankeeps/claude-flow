"""Proposta de corte para a timeline de corte do Atlas (Octo Edição, etapa 1): em vez de renderizar, grava no projeto
os trechos que FICAM do bruto — o mesmo cálculo do cortar.py (faixas do plano = erros fora, VAD + palavras, energia =
silêncio e trechos sem ninguém falando). O Daniel ajusta os blocos na tela de corte e aprova.

  propor_atlas.py <trabalho> <nome do corte no plano> <pasta do projeto no Atlas>

O projeto precisa ter sido criado no Atlas a partir do MESMO bruto (estudio.py novo --video <bruto>), para os tempos
baterem. Só cortes de uma parte (um arquivo de bruto). Roda com o Python da .venv da Perfect Edit (o mesmo do corte)."""
import os, sys, json
from base import *
from cortar import segmentos, energia


def propor(trab, nome, proj):
    p = plano(trab)["cortes"][nome]
    if len(p) != 1: sys.exit("a timeline de corte do Atlas recebe um bruto por anúncio (este corte junta vários arquivos)")
    parte = p[0]; d = fonte(trab, parte["key"]); fps = d["info"]["fps"]
    segs = segmentos(d, parte["keep"], parte.get("fora", ()), fps)
    segs = energia(pcm48(d["video"]), segs, d["palavras"], fps, manter=parte.get("manter", ()))
    dur = d["info"]["dur"]
    segs = [[round(a, 3), round(b, 3)] for a, b in segs if b - a >= 0.05]
    arq = os.path.join(proj, "fonte", "cortes.json")
    prop = json.load(open(arq)) if os.path.exists(arq) else dict(versoes=[], frases=[])
    ver = dict(id="A", nome="Versão única", faixas=[[0.0, round(dur, 3)]], segs=segs, secoes=[])
    prop["versoes"] = [ver] + [v for v in prop.get("versoes", []) if v.get("id") != "A"]
    prop.setdefault("frases", [])
    os.makedirs(os.path.dirname(arq), exist_ok=True)
    json.dump(prop, open(arq, "w"), ensure_ascii=False, indent=1)
    fica = sum(b - a for a, b in segs)
    print(f"{nome}: {len(segs)} trechos ficam, {fica:.1f}s de {dur:.1f}s ({len(segs) - 1 if segs else 0} cortes propostos) -> {arq}")


if __name__ == "__main__":
    if len(sys.argv) != 4: sys.exit(__doc__)
    propor(os.path.expanduser(sys.argv[1]), sys.argv[2], os.path.expanduser(sys.argv[3]))
