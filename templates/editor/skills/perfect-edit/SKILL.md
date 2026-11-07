---
name: perfect-edit
description: Perfect Edit — corte + edição dinâmica de anúncio e VSL vertical, do jeito que o Daniel aprovou, no Windows ou no Mac. Parte 1 (Perfect Cut) corta brutos conferindo com o roteiro, tira erros, tomadas repetidas, conversa com a equipe e TODO silêncio — renderizando direto ou propondo os cortes na timeline de corte do Atlas (Octo Edição) para ele aprovar. Parte 2 edita no Atlas no modelo Puro DR: B-roll na palavra certa (biblioteca primeiro, depois TikTok pela Apify ou Shorts do YouTube, estudados pelo Gemini) alternando tela cheia, tela dividida e expert recortado no canto, B-rolls científicos nas falas de hormônio, legenda branca logo abaixo do pescoço em cada take (no meio na dividida e no canto), P&B, efeitos sonoros e trilha no volume certo. Parte 3 tem as montagens especiais: clone lado a lado, espelhar trecho, depoimentos de outra versão, juntar lead + VSL. Use quando pedirem "corta e edita", "tira o silêncio", "edição dinâmica", "perfect edit", "/perfect-edit", "Octo Edição", "sobe no Atlas", "coloca B-roll", "tela dividida", "edita a lead/VSL", ou mandarem brutos com roteiro para virar anúncio pronto. Só cortar: Parte 1. Só ajustar uma edição pronta no Atlas: Parte 2.
---

# Perfect Edit

Regras de edição completas (o feedback do Daniel que virou regra): `docs/regras-de-edicao.md`. Busca e biblioteca de
B-roll: `docs/busca-de-broll.md`. Armadilhas técnicas: `docs/armadilhas.md`. **Leia os três antes da primeira edição.**

## Caminhos

```
PE=~/.claude/skills/perfect-edit;  ATLAS=~/"Octo Edição/Atlas"
V=.venv/Scripts/python.exe      # Windows (o Bash do Claude Code no Windows é o Git Bash)
V=.venv/bin/python              # Mac/Linux
PYC="$PE/$V"                    # corte, montagens especiais e motion-vox (faster-whisper + VAD, Pillow, opencv)
PYA="$ATLAS/$V"                 # edição (Atlas)
L="$ATLAS/lib"; E="$PYA $L/estudio.py"; ED=$PE/scripts/edicao; SC=$PE/scripts/corte
```
O shell não guarda variável de um comando para o outro: repita as que precisar em cada chamada.
Projetos do Atlas em `~/Edições/<nome>`; B-rolls em `~/Octo Edição/B-rolls/Principal/<Expert>/<Oferta>/<Categoria>/`;
chaves (Apify, OpenRouter) no ⚙ Configurações do Atlas, gravadas em `~/.config/estudio-edicao/chaves.json` — **nunca**
escreva chave em outro arquivo nem repita no chat. Instalação na máquina nova: `install.ps1` (Windows) ou `install.sh` (Mac).
No Windows o `PYTHONUTF8=1` tem que estar ligado (o instalador liga): sem ele acento e emoji quebram os .json.

---

## Parte 1 — Corte (Perfect Cut)

Padrão: **terminou uma palavra, já entra a outra.** De cada frase fica a última tomada boa. Um arquivo por anúncio,
na ordem do roteiro, resolução original, com o nome do anúncio que está no roteiro (ex.: `o_k01_tsn_v1_r1`).

1. **Material**: roteiros (anote nome, marcações `[Pessoa / cena]`, "não precisa gravar", "usar do outro vídeo", ❌) e brutos.
   Pasta do Google Drive para desktop → **copie** os brutos para o trabalho antes. Confirme pela fala que o bruto é
   daquele anúncio (nome de pasta engana; `IMG_xxxx` costuma estar com nome errado). Bruto original nunca é mexido.
2. **Transcrever em blocos** (em segundo plano, ~50 s por bruto):
   `$PYC $SC/preparar.py "<brutos>" --trabalho "<trab>" --prompt "termos da oferta"`.
   Em blocos, as tomadas repetidas aparecem (numa passada só, o Whisper as engole). O prompt melhora a grafia mas vira
   alucinação em trecho de ruído (o dump marca `«ALUCINAÇÃO?»`).
3. **Ler `transcricao.txt` inteiro contra o roteiro** e decidir: última tomada; retomada no meio da frase = começo da
   primeira + retomada (`[38,42]` + `[53,67]`); sai conversa com a equipe e alucinação (`Tchau`, `Obrigado`, o prompt —
   nunca deixe uma dentro de uma faixa); fica palavra diferente mas certa ("pro" por "para o") e nome trocado de propósito
   (avisar no fim). Palavra esticada `⟨≥1s⟩` → `$PYC $SC/conferir.py <trab> fonte CHAVE:ini:fim` (segundos). Diálogo
   gravado por personagem → intercale as partes (a mesma chave pode repetir no plano). "Usar do outro vídeo" → a parte
   vem da chave do outro anúncio. Bruto sem fala → `conferir.py <trab> quadro chave:5` e olhe a imagem.
4. **plano.json** (`keep` por índices ou `{"t":[a,b]}`, `fora` por tempo, `manter` = trecho que o corte de energia não
   pode picar, `"formato"` para juntar câmeras diferentes — veja `plano.exemplo.json`) e
   `$PYC $SC/cortar.py <trab> NOME` — **um primeiro**, confira, depois os outros.
5. **Três rodadas de revisão, sempre**: (1) leitura + escuta dos duvidosos antes do plano; (2) `conferir.py <trab> pausas`
   (meta 0 ≥ 0,2 s, A/V ≤ 2 quadros) e `conferir.py <trab> texto`; (3) ouvir com `janela NOME:ini:fim` cada `delete`,
   `insert` > 1 palavra e palavra deformada — **insert de frase inteira = retomada escondida** → `fora`, renderizar de novo,
   repetir 2 e 3. Fala corrida longa (VSL): `$PYC $SC/repeticoes.py arquivo.mp4` (janela de 4 s, whisper.cpp) pega
   repetição sem pausa. Clipes de IA: conferir bloco a bloco (fala repetida dentro do clipe, botão/texto desenhado,
   personagens trocando de lado) — `docs/armadilhas.md`.
6. **Entrega**: `~/Downloads/cortados/<nome>.mp4`. Resposta curta: quantos, o que foi conferido, os avisos (anúncio sem
   bruto, fala não gravada, arquivos juntados, nome trocado, vídeo horizontal).

### 1b — Corte na timeline do Atlas (Octo Edição), quando o vídeo vai ser editado lá

Em vez de renderizar, os cortes vão como proposta para a timeline de corte e o Daniel aprova:
```
$E novo --nome "<nome>" --video "<bruto original>" --estilo puro-dr --expert "<Expert>" --oferta "<Oferta>"
cd $SC && $PYC propor_atlas.py <trab> "<nome do corte no plano>" ~/"Edições/<nome>"
$E cortes "<nome>" --aplicar --versoes A --manter-copia
$E rascunho "<nome>" --forcar && $E plano "<nome>" --versao A --forcar
```
Um bruto por anúncio (um arquivo). Link: `http://localhost:4123/cortes?p=<nome>&v=A` — cada corte é um bloco azul; o
olhinho abre o trecho na prévia; ele arrasta as bordas, a tesourinha cria corte novo, **Salvar cortes** e **Aprovar corte**.
**Não siga para os B-rolls antes da aprovação** (`projeto.json` → `corte_aprovado`). Não chame essa etapa de "revisão".

---

## Parte 2 — Edição dinâmica no Atlas (Puro DR)

0. **Primeira pergunta**, se ele não disse: de que **expert / oferta** é (é a pasta de B-roll). Feedback específico do
   anúncio ("sem B-roll no diálogo", "esse clipe no hook") vira **trava**, acima de qualquer regra.
1. Projeto a partir do vídeo cortado (ou o da 1b, já com o corte aprovado):
```
$E novo --nome "<nome>" --video "<cortado.mp4>" --estilo puro-dr --expert "<Expert>" --oferta "<Oferta>"
$PYA $ED/puro_dr.py integral "<nome>" && $E rascunho "<nome>"     # rascunho = fala com tempo no edicao.py
$E preparar "<nome>"                                              # recorte do expert (canto/dividida), em 2º plano
```
Leia `~/Octo Edição/Atlas/estilos/puro-dr/LEIA.md` (os 4 jeitos, regras, som) e `BUSCA.md` (termos) antes de montar.

### B-roll: de onde vem (ordem fixa) — detalhes em `docs/busca-de-broll.md`
1. **Biblioteca primeiro**: `$PYA $ED/puro_dr.py biblioteca "<nome>"` → `fichas.txt` (só clipes estudados, disponíveis,
   da pasta Expert › Oferta; ordem ★ etiqueta do anúncio → match com a fala → nota). Nunca estude os antigos sem ficha
   (`--estudar`) sem ele pedir. **Clipe usado num anúncio não volta em outro.** B-roll solto do computador, nunca — só
   pasta que ele indicar (`$E acervo "<nome>" --pasta "<pasta>"`).
2. **Faltou → TikTok**: `$PYA $L/tiktok.py buscar "<nome>" "<rótulo>" "termo en-US" "termo" --n 15 --regiao US`
   (Apify, cobra por resultado; o Gemini estuda só os novos; texto queimado o vídeo todo = excluído). ~15–25% saem
   limpos: use "raw / aesthetic / cinematic / no text / no talking". Uma busca grande por vez (a Apify estoura 900 s).
   **Shorts do YouTube** (grátis, yt-dlp): `$PYA $L/youtube.py buscar "<termos>"` → `quadros <id> <pasta>` →
   `baixar <projeto> <id> <início> <duração> <nome> "<descrição>"`; um download por vez (em paralelo o YouTube bloqueia).
3. **Antes de usar, olhe os quadros** (`tiktok.py quadros "<nome>" <busca> 3,7` ou `motor.py <versão> preview t1 t2…`):
   a ficha erra. Use só a janela limpa da ficha (o `ini` e o fim).
4. **Reserve na escolha**: `$PYA $ED/puro_dr.py reservar "<nome>" B0012 B0015 …` e
   `$E acervo "<nome>" --biblioteca B0012 B0015 …` (entram no editor). No Bash, IDs separados por espaço, sem aspas.

### O que entra e onde (resumo — tudo em `docs/regras-de-edicao.md`)
- **Formato**: tela cheia e canto = só clipe **vertical** (TikTok/Shorts); tela dividida aceita horizontal.
- **Científicos** (moléculas, células, DNA, neurônios, corpo/hormônio brilhando) em toda fala de hormônio, enzima,
  metabolismo. **Gancho** com B-roll literal na palavra mais visual (ex.: "barriga dura e redonda" → barrigudo de verdade).
- **Densidade**: criativo dinâmico ~10–12 B-rolls/min (9–13), buraco ≤ 6 s; pelo menos 40% fora da cheia (dividida +
  canto). **Sem B-roll** em interação entre duas pessoas (diálogo, clone): só o vídeo e a legenda.
- **Tela dividida** só com clipe em que o assunto aparece inteiro na metade de cima; cortou rosto/corpo → `crop=[x,y,w,h]`
  no `E.broll` ou troque por cheia. Expert em close nesse trecho → use cheia (a legenda cairia no rosto).
- **Canto** (expert recortado do fundo, B-roll atrás): ≥ 3 s. Expert sentada/em close o vídeo todo → só cheia (o canto
  mostra a borda reta do recorte).
- **Final de VSL (oferta, bônus, garantias)**: sem B-roll de pessoas — só ilustrações, motions e letreiros.
- **Troca de cor/take** no meio da fala → cubra a emenda com um B-roll cheio. P&B (`E.pb`) nas falas de dor.

### Montar e conferir
- `edicao.py`: `E.broll("cheia"|"dividida"|"canto", "<âncora>", ate="<âncora>", broll="ID", ini=s, crop=[...],
  trans="corte"|"whip"|"slide"|"zoom"|"fade")`. Âncoras de 2–3 palavras **na ordem da fala** (o cursor só anda pra frente);
  vídeo longo: âncora por tempo `T(s)`. Whisper grafou errado a âncora → `CORRECOES = {"bumu": "bumbum"}`.
- `$E plano "<nome>" --forcar` até sumir toda linha `regra:` (cheia 1,2–3,5 s, dividida 2–5, canto 3–6; respiro 1,5 s;
  direto só dividida→cheia e cheia→cheia, máx. 3 seguidas). `plano --forcar` **zera sfx_extras e posição de legenda**:
  guarde e recoloque. **Depois que o Daniel mexeu no editor, nunca `--forcar`**: edite o `plano.json` direto.
- `$PYA $L/motor.py ~/"Edições/<nome>/versoes/A" cabecas` → recorte do canto/dividida.
- **Legenda**: branca, **logo abaixo do pescoço em cada take**: `$PYA $ED/legenda_por_take.py "<nome>" --abaixo -0.01`
  (mede os ombros a cada 0,5 s). Na dividida e no canto ela vai para o **meio da tela** (estilo, `legenda.meio`). Onde há
  imagem importante (quadro com antes/depois), baixe a legenda daquele trecho (`lg["y"]` no plano). Rode de novo depois
  de cada `plano --forcar`.
- Zoom num trecho: `P["zoom"]` com pontos `[t, z, "suave"]` e `P["ancora"]=[x, y]`.
- `$PYA $ED/puro_dr.py densidade "<nome>"` → 9–13/min e buraco ≤ 6 s (fora das travas).
- Prévias em ~15 pontos (`motor.py <versão> preview t1 t2 …`): **olhe os quadros** (texto queimado, cabeça cortada,
  legenda na boca, clipe que não bate).
- **Trilha**: `$PYA $ED/trilha.py musica.wav "<nome>" --abaixo 19 --nome trilha.wav`. Só instrumental (teste com Whisper).
  Criativo curto: **sem música**. Lead: ~19 dB abaixo da voz. VSL: 25–30 dB no começo, 22–25 no resto.
- **SFX** saem pelas regras do modelo (sutis, −23 a −26 dB, nunca dois em < 1,2 s); extras em `sfx_extras` (impacto na
  abertura, whoosh na troca de cena, glitch no P&B, riser antes da virada) só para dar ritmo à lead.

### Entregar
1. Atlas no ar: `preview_start` com `atlas-editor` (porta 4123; o instalador grava no `~/.claude/launch.json`).
2. `http://localhost:4123/editor?p=<nome URL-encoded>&v=A` aberto e conferido por screenshot; mande o link com: quantos
   B-rolls, formatos, o gancho, o que ficou por decidir.
3. **Render só quando ele pedir**: `$E render "<nome>"` (um de cada vez — dois juntos derrubam o render; precisa de ~3×
   o tamanho do vídeo livre no disco). Confira duração, LUFS (−14) e quadros. Os B-rolls viram "usados" no render.
4. Pedidos depois: "troca o B-roll N" → `$E broll "<nome>" A N --id <ID> [--ini s] [--tipo canto]`; "coloca esse vídeo
   no hook" → acervo + `E.broll("cheia", "<1ª palavra>", …)`; "sem B-roll nesse trecho" → tira e registra a trava.

---

## Parte 3 — Montagens especiais

- **Clone lado a lado** (mesma pessoa em dois papéis, tripé): `$PYC $ED/clone_lado_a_lado.py plano_clone.json` — quem
  não fala já faz a ação desde o 1º quadro; confira o volume de cada parte (tempos trocados = parte muda). Depois a cena
  vai na frente do resto cortado (`concat`) e o conjunto vira o projeto no Atlas.
- **Espelhar um trecho** (quadro escrito ao contrário, antes/depois invertido):
  `ffmpeg -i in.mp4 -filter_complex "[0:v]split[a][b];[b]hflip[f];[a][f]overlay=enable='between(t,T0,T1)'[v]" -map "[v]" -map 0:a -c:a copy out.mp4`
  e recrie o projeto (as âncoras por palavra mantêm a edição).
- **Juntar lead + VSL**: mesmo formato → `ffmpeg -f concat -safe 0 -i lista.txt -c copy -movflags +faststart saida.mp4`.
- **Depoimentos de outra versão** (V0): `$PYC $ED/inserir_depoimentos.py plano_dep.json` — depoimento com áudio entra
  depois da frase-gancho e empurra o vídeo; imagem (antes/depois) entra por cima da fala, sem áudio. Imprime a minutagem
  para mandar ao Daniel. Confira transcrevendo só cada trecho inserido.
- **Anúncio de personagem sem B-roll** (clipes de IA): zoom 1,18× em quem fala em toda troca de cena, punch-in seco nas
  falas curtas, P&B na dor — receita em `docs/regras-de-edicao.md`.

## Outras skills deste pacote
- `motion-vox` (motion graphics editorial sobre clipe já cortado): roda com `$PYC`.
- `criar-template` (vem com o Atlas): estuda um vídeo de referência e cria um estilo novo em `estilos/`.

## Entrega
Um arquivo por anúncio em `~/Downloads/<lote>/`, com o nome do roteiro. Resposta curta: o que foi feito, o que foi
conferido (pausas, texto, quadros, volume) e os avisos (nome trocado, fala não gravada, clipe que não existia limpo).
