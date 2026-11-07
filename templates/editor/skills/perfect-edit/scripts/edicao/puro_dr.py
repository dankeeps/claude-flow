"""Ajudantes do modelo Puro DR no Editor Atlas (rode com o Python da .venv do Atlas).

  puro_dr.py integral  "<projeto>"               vídeo que já chega cortado (corte-bruto): versão A integral, sem cortes
  puro_dr.py biblioteca "<projeto>" [--estudar]  a lógica de B-roll do Atlas: pasta/nicho do projeto, clipes sem ficha (com
                                                 --estudar o Gemini assiste cada um, ~US$ 0,01) e as fichas que combinam com
                                                 a fala (1º etiqueta do anúncio ★, 2º match com a fala, 3º maior nota) -> fichas.txt
  puro_dr.py reservar  "<projeto>" ID ...        marca os escolhidos como usados por este projeto (saem da prateleira dos outros)
  puro_dr.py pescoco   "<projeto>" [--versao A]   mede o pescoço da expert e grava a legenda logo abaixo (plano.json)
  puro_dr.py densidade "<projeto>" [--versao A]   B-rolls por minuto, maior buraco sem B-roll, mistura de formatos
  puro_dr.py assistir  "<projeto>" [--versao A]   o Gemini assiste o último render inteiro e aponta problemas (~US$ 0,02)
"""
import os, sys, json, glob, shutil, subprocess, tempfile
from atlas import ATLAS, LIB, EDICOES
import comum

def args():
    a = sys.argv[1:]; v = "A"
    if "--versao" in a: i = a.index("--versao"); v = a[i + 1]; del a[i:i + 2]
    if len(a) < 2: sys.exit(__doc__)
    proj = a[1] if os.path.isdir(a[1]) else os.path.join(comum.RAIZ, a[1])
    vd = os.path.join(proj, "versoes", v)
    if a[0] not in ("integral", "biblioteca", "reservar") and not os.path.isfile(os.path.join(vd, "plano.json")): sys.exit(f"sem plano: {vd} (rode estudio.py plano antes)")
    return a[0], proj, vd

def integral(proj, vd):
    from video_integral import preparar
    print(f"versão A integral: {preparar(proj):.1f}s")

class _Est:                                               # o "estado" que o auto.py espera: aqui só imprime
    def log(self, m): print(m, flush=True)
    def custo(self, *_): pass
    def marca(self, *_): pass

def ctx_atlas(proj):
    import auto
    return auto, auto.Ctx(proj, {}, _Est())

def biblioteca_cmd(proj, vd):
    import biblioteca
    auto, ctx = ctx_atlas(proj); P = ctx.P()
    print(f"pasta de B-roll: {auto.rotulo_pasta(ctx)} (nada sai dessa pasta/nicho)")
    disp = auto.disponiveis(ctx); pend = [x["id"] for x in disp if not x.get("estudo")]
    print(f"{len(disp)} disponível(is) · {len(pend)} sem ficha do Gemini")
    if pend and "--estudar" in sys.argv:
        print(f"estudando {len(pend)} clipe(s) ({biblioteca.motor_estudo()}, ~US$ {0.01 * len(pend):.2f}); a ficha fica guardada…", flush=True)
        feitos = biblioteca.estudar_pendentes(pend, contexto=P.get("nicho") or P.get("oferta") or "", log=print)
        print(f"{len(feitos)} estudado(s)")
    elif pend: print("  -> ignorados (clipe sem ficha não entra; --estudar só se o Daniel pedir)")
    ids = auto.fichas_para(ctx); B = biblioteca.ler()["itens"]; marc = set(auto.marcados_do_anuncio(ctx))
    linhas = [("★ " if i in marc else "") + biblioteca.resumo_estudo(B[i]) for i in ids if i in B]
    arq = os.path.join(proj, "fichas.txt"); open(arq, "w").write("\n".join(linhas) + "\n")
    print(f"{len(linhas)} ficha(s) separadas para este anúncio ({len(marc)} com a etiqueta dele) -> {arq}")

def reservar(proj, vd):
    import biblioteca
    ids = [a for a in sys.argv[3:] if not a.startswith("--")]
    nome = json.load(open(os.path.join(proj, "projeto.json")))["nome"]; B = biblioteca.ler()["itens"]
    ok = [i for i in ids if i in B and (B[i]["estado"] == "disponivel" or any(u.get("projeto") == nome for u in B[i].get("usos", [])))]
    ruins = [i for i in ids if i not in ok]
    if ok: biblioteca.marcar_usado(ok, nome)
    print(f"{len(ok)} reservado(s) para '{nome}'" + (f" · fora da prateleira (usado por outro ou inexistente): {' '.join(ruins)}" if ruins else ""))

def ler(vd): return json.load(open(os.path.join(vd, "plano.json")))
def gravar(vd, P):
    f = os.path.join(vd, "plano.json"); tmp = f + ".tmp"; json.dump(P, open(tmp, "w"), ensure_ascii=False, indent=1); os.replace(tmp, f)

def livres(P, n=9):
    """Instantes com a expert sozinha na tela cheia (fora de qualquer cena), espalhados pelo vídeo."""
    dur = P["dur"]; cenas = P["cenas"]
    ts = [dur * (k + 0.5) / 40 for k in range(40)]
    ts = [t for t in ts if not any(c["ini"] - 0.3 <= t <= c["fim"] + 0.3 for c in cenas)]
    passo = max(1, len(ts) // n); return [round(t, 2) for t in ts[::passo][:n]]

def pescoco(proj, vd):
    from pose import juntas_pasta
    from PIL import Image
    P = ler(vd); E = comum.estilo(json.load(open(os.path.join(proj, "projeto.json")))["estilo"])
    cfg = E["legenda"].get("pescoco", {"abaixo": 0.045, "min": 0.40, "max": 0.78})
    ts = livres(P)
    if not ts: sys.exit("nenhum trecho só com a expert para medir")
    prev = os.path.join(vd, "prev"); antes = set(glob.glob(os.path.join(prev, "*.jpg")))
    subprocess.run([sys.executable, os.path.join(LIB, "motor.py"), vd, "preview", *map(str, ts)], check=True, stderr=subprocess.DEVNULL)
    d = tempfile.mkdtemp(prefix="pesc")
    try:
        fotos = [os.path.join(prev, f"quadro_{t:07.2f}.jpg") for t in ts]
        W, H = Image.open(fotos[0]).size
        for n, f in enumerate(fotos): Image.open(f).convert("RGB").resize((540, 960)).save(os.path.join(d, f"{n:03d}.jpg"))
        _, pesc, _ = juntas_pasta(d, W, H)
    finally:
        shutil.rmtree(d, ignore_errors=True)
        for f in set(glob.glob(os.path.join(prev, "*.jpg"))) - antes: os.remove(f)
    if pesc is None: sys.exit("a pose não achou os ombros: ajuste a Altura da legenda no editor")
    y = min(cfg["max"], max(cfg["min"], pesc / H + cfg["abaixo"]))
    lp = P.setdefault("legenda_pos", {}); velho = lp.get("y"); lp["y"] = round(y, 3); gravar(vd, P)
    print(f"pescoço em {pesc / H:.1%} da altura ({len(ts)} quadros) -> legenda em y={y:.3f} (antes {velho})")
    # Padrão do Daniel (2026-10-24): na dividida e no canto a legenda vai para o MEIO (o motor faz isso pelo estilo,
    # "meio"). Só mede o pescoço na metade de baixo se o estilo desligou essa regra para a dividida.
    if "dividida" not in E["legenda"].get("meio", ["dividida", "canto"]): divididas(vd, cfg)
    print("confira: motor.py <versão> preview", " ".join(map(str, ts[:3])))

def divididas(vd, cfg):
    """Na tela dividida a expert aparece na metade de baixo com outro enquadramento: o deslocamento fixo do modelo
    (dividida_dy) põe a legenda na boca quando ela está perto da câmera. Mede o pescoço na metade de baixo de cada
    dividida e grava o y das legendas daquele trecho (lg["y"], o mesmo campo que o editor usa)."""
    from pose import juntas_pasta
    from PIL import Image
    P = ler(vd); cenas = [c for c in P["cenas"] if c["tipo"] == "dividida" and not c.get("inverte")]
    if not cenas: return
    prev = os.path.join(vd, "prev"); antes = set(glob.glob(os.path.join(prev, "*.jpg")))
    ts = [round(c["ini"] + (c["fim"] - c["ini"]) * f, 2) for c in cenas for f in (0.35, 0.7)]
    subprocess.run([sys.executable, os.path.join(LIB, "motor.py"), vd, "preview", *map(str, ts)], check=True, stderr=subprocess.DEVNULL)
    ajustes = 0
    try:
        for k, c in enumerate(cenas):
            d = tempfile.mkdtemp(prefix="pescdiv")
            try:
                for n, t in enumerate(ts[2 * k:2 * k + 2]):
                    im = Image.open(os.path.join(prev, f"quadro_{t:07.2f}.jpg")).convert("RGB"); W, H = im.size
                    im.crop((0, H // 2, W, H)).resize((540, 480)).save(os.path.join(d, f"{n:03d}.jpg"))
                _, pesc, _ = juntas_pasta(d, W, H // 2)
            finally: shutil.rmtree(d, ignore_errors=True)
            if pesc is None: continue
            y = round(min(0.93, 0.5 + pesc / H + cfg["abaixo"]), 3)
            for lg in P.get("legendas", []):
                if lg["ini"] < c["fim"] and lg["fim"] > c["ini"]: lg["y"] = y; ajustes += 1
    finally:
        for f in set(glob.glob(os.path.join(prev, "*.jpg"))) - antes: os.remove(f)
    gravar(vd, P); print(f"tela dividida: {len(cenas)} cena(s), {ajustes} legenda(s) postas abaixo do pescoço")

def densidade(proj, vd):
    P = ler(vd); c = sorted(P["cenas"], key=lambda x: x["ini"]); dur = P["dur"]
    from collections import Counter
    fim = 0.0; buracos = []
    for x in c + [dict(ini=dur, fim=dur)]:
        buracos.append((x["ini"] - fim, fim)); fim = max(fim, x["fim"])
    g, onde = max(buracos)
    tipos = Counter(x["tipo"] for x in c); fora = sum(v for k, v in tipos.items() if k != "cheia")
    print(f"{len(c)} B-rolls em {dur:.0f}s = {len(c) / dur * 60:.1f}/min (alvo 9–13) · maior buraco {g:.1f}s em {onde:.1f}s (máx 6)")
    print(f"formatos {dict(tipos)} · fora da cheia {fora}/{len(c)} (mín 40%) · primeiro B-roll em {c[0]['ini']:.1f}s" if c else "nenhum B-roll")

def assistir(proj, vd):
    import gemini
    gemini.FORCADO = "openrouter"                          # a API direta do Google não funciona (memória gemini-via-openrouter)
    rs = sorted(glob.glob(os.path.join(vd, "renders", "*.mp4")), key=os.path.getmtime)
    if not rs: sys.exit("sem render: rode estudio.py render antes")
    P = ler(vd); rot = "\n".join(f"{x['ini']:.1f}–{x['fim']:.1f}s: B-roll {x['tipo']} ({x.get('broll', '')})" for x in sorted(P["cenas"], key=lambda x: x["ini"]))
    r = gemini.assistir_montagem(rs[-1], "Modelo Puro DR: sem letreiro, só legenda abaixo do pescoço; expert, B-roll cheia, "
                                 "tela dividida ou expert no canto.\n" + rot, log=print)
    print(json.dumps(r, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    cmd, proj, vd = args()
    {"biblioteca": biblioteca_cmd, "reservar": reservar, "integral": integral, "pescoco": pescoco, "densidade": densidade, "assistir": assistir}.get(cmd, lambda *_: sys.exit(__doc__))(proj, vd)
