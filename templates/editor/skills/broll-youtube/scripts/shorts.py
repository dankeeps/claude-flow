"""B-roll de YouTube Shorts para o Atlas: buscar (com folha de capas), baixar (um por vez) e importar na biblioteca.
Versão geral das ferramentas de ~/Edições/_ferramentas-broll (ytbusca, ytbaixar, importar), sem expert fixo.

  python shorts.py buscar <rotulo> "termo" ["termo" ...]
  python shorts.py baixar <rotulo> 1,3,5 [<rotulo> 2,4 ...]
  <python da .venv do Atlas> shorts.py importar --expert "Kellen" --oferta "Anúncios Kellen" [--anuncio K20] [--estudar]

Pasta de trabalho: $SHORTS_TRABALHO ou ~/Edições/_shorts  (busca/<rotulo>/ e baixados/<rotulo>/).
Regras (docs/busca-de-broll.md do Perfect Edit): termos em inglês de criador gringo, escolher pelas capas, baixar um
de cada vez com pausa (em paralelo o YouTube pede "Sign in to confirm you're not a bot"), descartar texto queimado.
"""
import argparse, glob, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

TRAB = os.path.expanduser(os.environ.get("SHORTS_TRABALHO") or "~/Edições/_shorts")
ATLAS = next((os.path.expanduser(p) for p in [os.environ.get("PERFECT_EDIT_ATLAS"), "~/Octo Edição/Atlas", "~/Editor Atlas"]
              if p and os.path.isdir(os.path.join(os.path.expanduser(p), "lib"))), None)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"}
FILTRO_SHORTS = "&sp=EgIQCQ%253D%253D"


def _busca(q):
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + FILTRO_SHORTS
    h = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf8", "ignore")
    out = []
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", h, re.S)
    if m:
        def walk(o):
            if isinstance(o, dict):
                if "shortsLockupViewModel" in o:
                    s = o["shortsLockupViewModel"]
                    try:
                        vid = s["onTap"]["innertubeCommand"]["reelWatchEndpoint"]["videoId"]
                    except Exception:
                        mm = re.search(r'"videoId":"([\w-]{11})"', json.dumps(s)); vid = mm and mm.group(1)
                    meta = s.get("overlayMetadata", {})
                    tit = (meta.get("primaryText") or {}).get("content") or s.get("accessibilityText", "")
                    views = (meta.get("secondaryText") or {}).get("content", "")
                    if vid: out.append(dict(id=vid, titulo=tit, views=views, termo=q))
                    return
                for v in o.values(): walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk(json.loads(m.group(1)))
    if not out:  # página mudou de formato: pega os IDs dos links /shorts/
        out = [dict(id=v, titulo="", views="", termo=q) for v in dict.fromkeys(re.findall(r"/shorts/([\w-]{11})", h))]
    return out


def _folha(pasta, itens):
    """Folha de capas pelo folhas.py do Atlas (mesma fonte e layout das outras folhas)."""
    if not ATLAS or not itens: return None
    py = os.path.join(ATLAS, ".venv", "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
    saida = os.path.join(pasta, "folha.jpg")
    subprocess.run([py if os.path.exists(py) else sys.executable, os.path.join(ATLAS, "lib", "folhas.py"), saida, "8", "180", "320",
                    *[f"{f}::{x['n']}" for x, f in itens]], capture_output=True)
    return saida if os.path.exists(saida) else None


def buscar(rotulo, termos):
    pasta = os.path.join(TRAB, "busca", rotulo); os.makedirs(pasta, exist_ok=True)
    res, vistos = [], set()
    for t in termos:
        try: r = _busca(t)
        except Exception as e: print("erro na busca", t, e); r = []
        for x in r:
            if x["id"] not in vistos: vistos.add(x["id"]); res.append(x)
        time.sleep(1.5)
    for n, x in enumerate(res, 1): x["n"] = n
    json.dump(res, open(os.path.join(pasta, "res.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)

    def capa(x):
        f = os.path.join(pasta, f"c{x['n']:02d}.jpg")
        for nome in ("oardefault.jpg", "hq2.jpg", "hqdefault.jpg"):
            try:
                b = urllib.request.urlopen(urllib.request.Request(f"https://i.ytimg.com/vi/{x['id']}/{nome}", headers=UA), timeout=20).read()
                if len(b) > 3000: open(f, "wb").write(b); return f
            except Exception: pass
        return None
    with ThreadPoolExecutor(8) as ex: capas = list(ex.map(capa, res))
    folha = _folha(pasta, [(x, f) for x, f in zip(res, capas) if f])
    for x in res: print(x["n"], x["id"], x["views"], "|", x["titulo"][:90])
    print("folha:", folha or "(sem folha: Atlas não encontrado)")
    print("resultados:", os.path.join(pasta, "res.json"))


def baixar(pares):
    pool = ThreadPoolExecutor(3)
    for rotulo, ns in pares:
        res = {x["n"]: x for x in json.load(open(os.path.join(TRAB, "busca", rotulo, "res.json"), encoding="utf8"))}
        out = os.path.join(TRAB, "baixados", rotulo); os.makedirs(out, exist_ok=True)
        for n in [int(v) for v in ns.split(",") if v.strip()]:
            x = res[n]; final = os.path.join(out, f"{n:02d}_{x['id']}.mp4")
            if os.path.exists(final): continue
            raw = os.path.join(out, f"raw_{x['id']}")
            r = subprocess.run(["yt-dlp", "--no-warnings", "--no-playlist", "-f", "bv*[height<=1920][width<=1080]/bv*",
                                "-o", raw + ".%(ext)s", f"https://www.youtube.com/shorts/{x['id']}"], capture_output=True, text=True, timeout=300)
            if r.returncode != 0:
                err = (r.stderr.strip().splitlines() or ["?"])[-1]
                print("FALHA", rotulo, n, x["id"], err[:200], flush=True)
                if "bot" in r.stderr.lower() and "sign in" in r.stderr.lower():
                    print("BLOQUEIO do YouTube: pare e tente de novo daqui a algumas horas.", flush=True); pool.shutdown(wait=True); sys.exit(2)
                time.sleep(4); continue
            src = glob.glob(raw + ".*")[0]

            def recodificar(src=src, final=final, x=x, n=n, rotulo=rotulo):
                tmp = final[:-4] + ".tmp.mp4"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-an", "-vf", "scale='min(1080,iw)':-2", "-c:v", "libx264",
                                "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp])
                os.replace(tmp, final); os.remove(src)
                json.dump(x, open(final[:-4] + ".json", "w", encoding="utf8"), ensure_ascii=False)
                print("ok", rotulo, n, x["id"], flush=True)
            pool.submit(recodificar)
            time.sleep(2.5)
    pool.shutdown(wait=True)
    print("FIM", flush=True)


def importar(expert, oferta, anuncio=None, estudar=False, prefixo="Shorts"):
    if not ATLAS: sys.exit("Atlas não encontrado (defina PERFECT_EDIT_ATLAS)")
    sys.path.insert(0, os.path.join(ATLAS, "lib")); os.chdir(os.path.join(ATLAS, "lib"))
    import biblioteca
    reg_arq = os.path.join(TRAB, "importados.json")
    reg = json.load(open(reg_arq, encoding="utf8")) if os.path.exists(reg_arq) else {}
    novos = []
    for f in sorted(glob.glob(os.path.join(TRAB, "baixados", "*", "*.mp4"))):
        if f.endswith(".tmp.mp4") or not os.path.exists(f[:-4] + ".json") or f in reg: continue
        rotulo = os.path.basename(os.path.dirname(f)); meta = json.load(open(f[:-4] + ".json", encoding="utf8"))
        i = biblioteca.adicionar(arquivo=f, fonte="youtube", video_id=meta["id"], yt_ini=0, url=f"https://www.youtube.com/shorts/{meta['id']}",
                                 autor="", views=meta.get("views", ""), termo=meta.get("termo", ""), busca=f"shorts-{rotulo}",
                                 nicho=oferta, titulo=meta.get("titulo", "")[:200])
        biblioteca.mover(i, expert, oferta, f"{prefixo} {rotulo}")
        if anuncio: biblioteca.marcar_anuncios([i], [anuncio])
        reg[f] = i; novos.append(i)
        json.dump(reg, open(reg_arq, "w", encoding="utf8"), indent=1)
    print("importados", len(novos), " ".join(novos))
    if estudar and novos:
        print("Gemini (OpenRouter) estudando", len(novos), "clipes novos (cobra por clipe)...")
        biblioteca.estudar_pendentes(novos)
        print("estudo concluído")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("buscar"); b.add_argument("rotulo"); b.add_argument("termos", nargs="+")
    d = sub.add_parser("baixar"); d.add_argument("pares", nargs="+", help="rotulo 1,2,3 [rotulo 4,5]")
    i = sub.add_parser("importar"); i.add_argument("--expert", required=True); i.add_argument("--oferta", required=True)
    i.add_argument("--anuncio"); i.add_argument("--estudar", action="store_true"); i.add_argument("--prefixo", default="Shorts")
    a = ap.parse_args()
    if a.cmd == "buscar": buscar(a.rotulo, a.termos)
    elif a.cmd == "baixar":
        if len(a.pares) % 2: sys.exit("use pares: rotulo 1,2,3 [rotulo 4,5]")
        baixar(list(zip(a.pares[::2], a.pares[1::2])))
    else: importar(a.expert, a.oferta, a.anuncio, a.estudar, a.prefixo)
