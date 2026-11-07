"""Leva a biblioteca de B-roll (e os projetos) de um computador para outro: troca o começo dos caminhos absolutos
gravados nos .json (biblioteca.json guarda "arquivo" e "capa" com o caminho inteiro; plano.json e acervo.json também).

  migrar_biblioteca.py --de "/Users/danieldias/Octo Edição/B-rolls" --para "C:/Users/<você>/Octo Edição/B-rolls" <pasta ou .json> ...

Exemplo no Windows, depois de copiar a pasta B-rolls do Mac para %USERPROFILE%\\Octo Edição\\B-rolls:
  python migrar_biblioteca.py --de "/Users/danieldias/Octo Edição/B-rolls" --para "%USERPROFILE%/Octo Edição/B-rolls" "%USERPROFILE%/Octo Edição/B-rolls"
Pasta = todos os .json dentro dela. Guarda uma cópia <arquivo>.antes-da-migracao de cada .json que mudou.
Rode de novo com --de "/Users/danieldias/Edições" --para ".../Edições" para os projetos. --teste só conta, não grava.
"""
import argparse, json, os, shutil


def trocar(v, de, para):
    if isinstance(v, str): return (para + v[len(de):], 1) if v.startswith(de) else (v, 0)
    if isinstance(v, list):
        r = [trocar(x, de, para) for x in v]; return [x for x, _ in r], sum(n for _, n in r)
    if isinstance(v, dict):
        r = {k: trocar(x, de, para) for k, x in v.items()}; return {k: x for k, (x, _) in r.items()}, sum(n for _, n in r.values())
    return v, 0


def arquivos(alvos):
    for a in alvos:
        a = os.path.expanduser(os.path.expandvars(a))
        if os.path.isfile(a): yield a
        for raiz, _, nomes in os.walk(a):
            yield from (os.path.join(raiz, n) for n in nomes if n.endswith(".json"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--de", required=True); ap.add_argument("--para", required=True)
    ap.add_argument("--teste", action="store_true"); ap.add_argument("alvos", nargs="+"); a = ap.parse_args()
    para = os.path.expandvars(os.path.expanduser(a.para)).replace("\\", "/").rstrip("/")
    total = 0
    for f in arquivos(a.alvos):
        try: d = json.load(open(f, encoding="utf-8"))
        except (OSError, ValueError): continue
        novo, n = trocar(d, a.de.rstrip("/"), para)
        if not n: continue
        total += n; print(f"{n:6d}  {f}")
        if a.teste: continue
        shutil.copy2(f, f + ".antes-da-migracao")
        json.dump(novo, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{total} caminhos {'encontrados' if a.teste else 'trocados'}")
