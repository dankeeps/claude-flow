---
name: spy-ads
description: Spy de ofertas de resposta direta na Biblioteca de Anúncios da Meta, sem login e sem API paga — busca por palavras combinadas (termo+termo), filtra por escala (anúncios ativos ou tempo no ar), confere se a página de destino é VSL ou quiz, tira a darklist e o que já foi mostrado; baixa o vídeo de um anúncio pelo ID, baixa a VSL de uma página de vendas (captura o stream e passa ao yt-dlp), transcreve na placa de vídeo e monitora bibliotecas. Use para "procura ofertas de X", "spy de VSL", "acha quem está escalando", "baixa esse anúncio", "baixa essa VSL", "transcreve/analisa esse anúncio", "monitora essa biblioteca".
---

# spy-ads

Scripts em `.claude/skills/spy-ads/scripts/` (rode a partir da pasta do bot). Tudo grava em `$FLOW_TRABALHO/spy/`.
Progresso sai no stderr; o resultado em JSON no stdout. O coletor usa um Chromium próprio, sem login (perfil em
`$FLOW_TRABALHO/spy/.perfil-navegador`), não o navegador do Claude Flow.

```bash
S=.claude/skills/spy-ads/scripts
```

## 1. Buscar ofertas

```bash
node $S/coletor.mjs buscar --nicho "Glúteo" --pais BR --palavras "gluteo+truque;bumbum+receita;bumbum+segredinho" \
  --min-anuncios 20 --min-dias 10 --max 15
```

- `--palavras`: termos separados por `;` (ou `--arquivo termos.txt`, um por linha). Com `+` = as palavras em qualquer
  ordem dentro do anúncio (inclusive na fala); sem `+` = expressão exata (nome chiclete: `pink salt`).
- Escala: passa quem tem `--min-anuncios` ativos **ou** algum anúncio com `--min-dias` ou mais no ar.
- `--max`: para depois de N ofertas aprovadas pelos filtros. `--rolagens` (6): quanto rola em cada termo (~10 anúncios por rolagem).
- `--midia all`: conta também anúncio de imagem (padrão: só vídeo). `--pais US|MX|CO|ALL…`.
- `--todos-destinos`: não descarta WhatsApp/loja (só marca o tipo). `--sem-destino`: não abre as páginas (mais rápido).
- `--repetir`: mostra de novo o que já foi mostrado (vistos.json).
- Tempo: ~10 s por anunciante conferido + ~8 s por página de destino. Um termo com 20 anunciantes ≈ 3 min.

Saída: `achados` (ordem de descoberta) com pagina, page_id, biblioteca, ativos, dias_max, tipo (vsl/quiz),
destino, plataformas de checkout, sinais, palavras e anúncios de exemplo. O completo (com os descartados e o motivo)
fica em `resultado.json` na pasta da busca. `bloqueio` preenchido = a Meta parou de mostrar: espere ~20 min.

Os achados entram sozinhos em `vistos.json` (não voltam na próxima busca).

## 2. Uma biblioteca só (link que o usuário mandou)

```bash
node $S/coletor.mjs biblioteca "<link com view_all_page_id=… ou link de anúncio ?id=…>"
```

## 3. Aba Spy: blacklist e monitoradas

Dentro do Claude Flow, a blacklist e as monitoradas são da **aba Spy da sala do squad** (o coletor lê de lá pela
variável FLOW_SPY). Use as ferramentas mcp__flow__spy_monitorar / spy_blacklist / spy_listar, ou:

```bash
node $S/coletor.mjs darklist --page_id 123 --pagina "Marca X" --motivo "cliente"                 # vai para a blacklist
node $S/coletor.mjs monitorada --page_id 123 --pagina "Oferta Y" --nicho "Glúteo" --tipo quiz+vsl  # entra na aba Spy
node $S/coletor.mjs monitorar                                                                      # confere as monitoradas ligadas
```

`monitorar` conta os anúncios ativos de cada monitorada (as pausadas na aba ficam de fora) e grava na aba Spy sozinho
(`aba_spy` no resultado diz se gravou). Também devolve anterior e variação.

## 4. Página de destino

```bash
node $S/destino.mjs "<url>" ["<url>" ...]
```

Tipo: `vsl` (player de vídeo: vturb/ConverteAI, Panda, Vimeo, Wistia, YouTube, HLS), `quiz` (Inlead, xquiz, Typebot,
texto de quiz), `whatsapp`, `loja`, `outro`. Também diz a plataforma de checkout que aparece (hotmart, kiwify, cakto…).

## 5. Baixar

```bash
node $S/coletor.mjs baixar <id do anúncio> [<id> ...]     # vídeo direto do servidor da Meta, ~5 s cada → spy/anuncios/<id>.mp4
node $S/vsl.mjs "<url da página de vendas>" --nome oferta-x  # captura o stream e baixa com yt-dlp → spy/vsl/
```

VSL atrás de quiz: responda o quiz no navegador do Claude Flow até o vídeo e passe a URL final ao vsl.mjs.

## 6. Transcrever (placa de vídeo)

```bash
"$PERFECT_EDIT_ATLAS/.venv/Scripts/python.exe" $S/transcrever.py spy/anuncios/<id>.mp4 [...]
```

Grava `.txt`, `.srt` e `.json` (trechos com tempo) ao lado do vídeo. Anúncio de 30 s ≈ 2 s; VSL de 20 min ≈ 1 min.

## 7. YouTube e TikTok (yt-dlp)

- Por link: `yt-dlp -o "$FLOW_TRABALHO/spy/videos/%(id)s.%(ext)s" "<link>"`.
- YouTube por termo, ordenado por visualizações por dia:
  `yt-dlp "ytsearch30:<termo>" --flat-playlist --print "%(view_count)s|%(upload_date)s|%(duration)s|%(title)s|%(url)s"`
  e calcule views ÷ dias desde a publicação.
- TikTok: busca por palavra não existe; ordene os vídeos de um perfil:
  `yt-dlp "https://www.tiktok.com/@perfil" --flat-playlist --print "%(view_count)s|%(timestamp)s|%(url)s"`.
- Um download de cada vez com pausa (em paralelo o YouTube bloqueia).

## Armadilhas

- Três palavras na busca quase sempre voltam vazio. Duas, com `+`.
- O coletor e o navegador do Claude Flow são navegadores diferentes: o do coletor não tem login (e não precisa).
- Link do anúncio que vai para `l.facebook.com/l.php?u=` já é desembrulhado. Página que abre só no celular pode
  ser classificada "outro": confira no navegador do Claude Flow antes de descartar uma oferta forte.
- O endereço do vídeo de um anúncio expira em algumas horas: baixe na hora, não guarde o link.
