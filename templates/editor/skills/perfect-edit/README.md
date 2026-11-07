# Perfect Edit

Tudo o que a gente usa para levar o **bruto até o anúncio pronto**, empacotado para instalar em qualquer computador
(feito para o **Windows**; funciona também no Mac):

1. **Corte (Perfect Cut)** — confere com o roteiro, tira erros, tomadas repetidas, conversa com a equipe e **todo**
   silêncio ("terminou uma palavra, já entra a outra"). Renderiza direto ou propõe os cortes na timeline do Atlas.
2. **Edição dinâmica (Atlas / Octo Edição, modelo Puro DR)** — busca de B-roll (biblioteca, TikTok, Shorts do YouTube,
   estudo pelo Gemini), B-roll na palavra certa em **tela cheia**, **tela dividida** e **expert recortado no canto**,
   legenda branca abaixo do pescoço, P&B, efeitos sonoros e trilha no volume certo, entregue na timeline do Atlas.
3. **Montagens especiais** — clone lado a lado, espelhar trecho, juntar lead + VSL, colocar depoimentos de outra versão.
4. **Extras** — motion graphics editorial (`motion-vox`) e criação de estilo novo a partir de um vídeo de referência
   (`criar-template`, que vem com o Atlas).

Quem executa é o **Claude Code**: você pede no chat ("corta esses brutos", "edita no Puro DR") e ele segue o
[SKILL.md](SKILL.md) com as regras de [docs/](docs). O Atlas é a tela onde você revisa, mexe à mão e renderiza.

---

## Sumário

1. [O que tem neste repositório](#1-o-que-tem-neste-repositório)
2. [Como as peças se encaixam](#2-como-as-peças-se-encaixam)
3. [Instalar no Windows, passo a passo](#3-instalar-no-windows-passo-a-passo)
4. [Usar no dia a dia: o que pedir ao Claude](#4-usar-no-dia-a-dia-o-que-pedir-ao-claude)
5. [Parte 1 — Corte de silêncio e erros](#5-parte-1--corte-de-silêncio-e-erros)
6. [Corte na timeline do Atlas (aprovação)](#6-corte-na-timeline-do-atlas-aprovação)
7. [Parte 2 — Edição dinâmica no Atlas](#7-parte-2--edição-dinâmica-no-atlas)
8. [Parte 3 — Montagens especiais](#8-parte-3--montagens-especiais)
9. [Outras skills e plugins](#9-outras-skills-e-plugins)
10. [O que é só do Mac e o que usar no Windows](#10-o-que-é-só-do-mac-e-o-que-usar-no-windows)
11. [Levar os dados do Mac (B-rolls, projetos, chaves)](#11-levar-os-dados-do-mac-b-rolls-projetos-chaves)
12. [Problemas comuns](#12-problemas-comuns)
13. [Referência rápida de comandos](#13-referência-rápida-de-comandos)

---

## 1. O que tem neste repositório

| caminho | o que é |
|---|---|
| [SKILL.md](SKILL.md) | a skill `perfect-edit` que o Claude Code segue: corte, edição Puro DR, montagens |
| [docs/regras-de-edicao.md](docs/regras-de-edicao.md) | **todas as regras de edição** (B-roll, formatos, legenda, som, trilha, estilos, entrega) |
| [docs/busca-de-broll.md](docs/busca-de-broll.md) | biblioteca de B-roll, busca no TikTok/YouTube, estudo pelo Gemini, termos que funcionam |
| [docs/armadilhas.md](docs/armadilhas.md) | o que já deu errado e como evitar (corte, montagem, render, Windows) |
| `scripts/corte/` | o corte: `preparar.py`, `cortar.py`, `conferir.py`, `repeticoes.py`, `propor_atlas.py`, `vad.py`, `base.py` |
| `scripts/edicao/` | a edição: `puro_dr.py`, `legenda_por_take.py`, `trilha.py`, `clone_lado_a_lado.py`, `inserir_depoimentos.py`, `migrar_biblioteca.py`, `atlas.py` |
| `skills/motion-vox/` | skill de motion graphics editorial (estilo Vox) com as fontes |
| [plano.exemplo.json](plano.exemplo.json) | exemplo de plano de corte |
| `install.ps1` | instalador do **Windows** |
| `Abrir Atlas.cmd` + `abrir-atlas.ps1` | atalho de dois cliques que liga o Atlas e abre o navegador (Windows) |
| `install.sh` | instalador do Mac/Linux |

**O que não está aqui (e por quê):**
- **O Atlas** (o editor com timeline e o motor de render) fica no repositório privado
  [dankeeps/Atlas-interno](https://github.com/dankeeps/Atlas-interno). O instalador clona sozinho. Ele já traz os estilos
  (`estilos/`), os efeitos sonoros (`sfx/`), as fontes e a skill `criar-template`.
- **Vídeos** (biblioteca de B-roll, projetos, brutos, trilhas): são grandes demais para o GitHub. Veja a
  [seção 11](#11-levar-os-dados-do-mac-b-rolls-projetos-chaves).
- **Chaves** (Apify, OpenRouter): nunca vão para o GitHub. Você digita de novo no ⚙ Configurações do Atlas.

---

## 2. Como as peças se encaixam

```
 bruto(s) + roteiro
        │
        ▼
 ┌─────────────────────────┐   preparar.py → transcrição em blocos (Whisper + VAD)
 │ PARTE 1 · CORTE          │   o Claude lê contra o roteiro → plano.json (o que fica)
 │ (Perfect Cut)            │   cortar.py → ~/Downloads/cortados/<nome>.mp4   (entrega só do corte)
 └───────────┬─────────────┘   ou propor_atlas.py → timeline de corte do Atlas (você aprova)
             ▼
 ┌─────────────────────────┐   projeto no Atlas (~/Edições/<nome>)
 │ PARTE 2 · EDIÇÃO         │   B-roll: biblioteca → TikTok (Apify) / Shorts (YouTube) → Gemini estuda
 │ (Atlas, modelo Puro DR)  │   edicao.py: tela cheia, dividida, canto · legenda · P&B · sons · trilha
 └───────────┬─────────────┘   entrega: http://localhost:4123/editor?p=<nome>&v=A
             ▼
   você revisa / mexe na timeline / pede ajustes no chat
             ▼
   render (só quando você pedir) → versoes/A/renders/<nome> revN.mp4
```

Pastas na máquina (Windows: `C:\Users\<você>\...`; Mac: `/Users/<você>/...`):

| pasta | o quê |
|---|---|
| `~/perfect-edit` | este repositório (o instalador liga em `~/.claude/skills/perfect-edit`) |
| `~/Octo Edição/Atlas` | o Atlas |
| `~/Octo Edição/B-rolls/Principal/<Expert>/<Oferta>/<Categoria>/` | a biblioteca de B-roll |
| `~/Edições/<projeto>` | os projetos do Atlas |
| `~/Perfect Cut/trabalho/<pasta dos brutos>` | o trabalho do corte (transcrição, plano.json) |
| `~/Downloads/cortados` | saída do corte |
| `~/.config/estudio-edicao/chaves.json` | as chaves (gravadas pelo ⚙ do Atlas) |
| `~/.cache/atlas-modelos`, `~/.cache/perfect-cut` | modelos de IA baixados (Whisper, recorte, pose) |

---

## 3. Instalar no Windows, passo a passo

### 3.1 Programas

Abra o **PowerShell** (menu Iniciar → "PowerShell") e instale o que faltar:

```powershell
winget install --id Git.Git -e
winget install --id Python.Python.3.12 -e
winget install --id Gyan.FFmpeg -e
```

- **Python tem que ser o 3.12** (é o que o Atlas usa). Se tiver outro, pode deixar: o instalador chama o 3.12 pelo `py -3.12`.
- **Claude Code**: o app do Claude para Windows (aba Code) ou o Claude Code no terminal. No Windows ele precisa do Git
  (o Git Bash é o terminal que ele usa por dentro).
- Depois de instalar, **feche e abra o PowerShell** (para ele enxergar os programas novos). Teste:
  `git --version`, `py -3.12 --version`, `ffmpeg -version`.

### 3.2 Baixar e instalar

Os dois repositórios são privados: na primeira vez o Git abre o navegador para você entrar na conta **dankeeps** do GitHub.

```powershell
git clone https://github.com/dankeeps/perfect-edit.git "$HOME\perfect-edit"
cd "$HOME\perfect-edit"
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Demora alguns minutos (baixa as bibliotecas de Python e dois modelos pequenos). Se faltar algum programa, ele mostra o
comando `winget` e para; instale, abra um PowerShell novo e rode de novo.

### 3.3 O que o instalador faz

1. Confere Git, FFmpeg e Python 3.12.
2. Liga duas variáveis do seu usuário:
   - `PYTHONUTF8=1` — **essencial no Windows**: sem ela, acento e emoji quebram os arquivos .json.
   - `ESTUDIO_MODELOS=%USERPROFILE%\.cache\atlas-modelos` — modelos numa pasta sem acento.
3. Cria a `.venv` da Perfect Edit (`faster-whisper`, `numpy`, `Pillow`, `opencv-python`).
4. Clona o Atlas em `~/Octo Edição/Atlas`, cria a `.venv` dele e instala o `requirements.txt`.
5. Baixa os modelos de **recorte da expert** (RobustVideoMatting) e de **pose** (para a legenda abaixo do pescoço).
   O Whisper (~1,5 GB) baixa sozinho na primeira transcrição.
6. Cria `~/Edições` e `~/Octo Edição/B-rolls/Principal`.
7. Liga as skills em `~/.claude/skills` (junções, não precisa de administrador): `perfect-edit`, `motion-vox`,
   `criar-template`.
8. Grava o servidor `atlas-editor` (porta 4123) no `~/.claude/launch.json`, que é o que o Claude usa para abrir o Atlas.

### 3.4 Chaves

1. Dê dois cliques em **`Abrir Atlas.cmd`** (na pasta `perfect-edit`). Abre uma janela preta (deixe aberta: fechar
   desliga o Atlas) e o navegador em `http://localhost:4123`.
2. No Atlas, ⚙ **Configurações**: cole a chave da **Apify** (busca no TikTok) e a da **OpenRouter** (o Gemini que estuda os
   B-rolls) e clique em **Testar**. Elas ficam em `~/.config/estudio-edicao/chaves.json`, só neste computador.

### 3.5 Conferir que deu certo

```powershell
& "$HOME\perfect-edit\.venv\Scripts\python.exe" -c "import faster_whisper, numpy, cv2; print('corte ok')"
& "$HOME\Octo Edição\Atlas\.venv\Scripts\python.exe" -c "import faster_whisper, onnxruntime, PIL; print('atlas ok')"
echo $env:PYTHONUTF8        # tem que mostrar 1 (num PowerShell aberto depois da instalação)
dir "$HOME\.claude\skills"   # perfect-edit, motion-vox, criar-template
```
Depois **feche e abra o Claude Code** (para ele ver as variáveis novas), abra na sua pasta de usuário
(`C:\Users\<você>`) e digite `/perfect-edit` — ele tem que reconhecer a skill.

### 3.6 Atualizar

```powershell
git -C "$HOME\perfect-edit" pull
git -C "$HOME\Octo Edição\Atlas" pull
powershell -ExecutionPolicy Bypass -File "$HOME\perfect-edit\install.ps1"   # atualiza as dependências
```

---

## 4. Usar no dia a dia: o que pedir ao Claude

| você pede | o que acontece |
|---|---|
| "Corta esses brutos: `<pasta>`, roteiro: `<link do Drive>`" | Parte 1: transcreve, lê contra o roteiro, corta, confere, entrega em `Downloads/cortados` com o nome do roteiro |
| "Sobe no Atlas para eu aprovar o corte" | corte proposto na timeline de corte; você ajusta e aprova |
| "Edita no Puro DR, expert X, oferta Y" | Parte 2: busca B-roll, monta, confere e manda o link da timeline |
| "Troca o B-roll 3" / "coloca esse vídeo no hook" / "sem B-roll nesse trecho" / "mais B-roll no meio" | ajuste no projeto, link de novo |
| "Pode renderizar" | render da versão, um de cada vez |
| "Junta a lead com a VSL" / "coloca os depoimentos da V0" / "monta o clone" | Parte 3 |
| "Coloca uns motions nesse corte" | skill `motion-vox` |
| "Aprende o estilo desse vídeo e cria um template" | skill `criar-template` |

O Claude **sempre pergunta de que expert/oferta é** o anúncio (é a pasta de B-roll) e trata qualquer pedido seu
específico ("sem B-roll no diálogo") como trava, acima das regras.

---

## 5. Parte 1 — Corte de silêncio e erros

O padrão aprovado ("impecável"): **nenhum instante sem fala**, de cada frase fica **a última tomada boa**, **um arquivo
por anúncio**, na ordem do roteiro, na resolução original, com o nome do roteiro.

**Passo a passo** (o Claude faz; os comandos são para você entender e conferir):

1. **Juntar o material.** Roteiro (link do Drive ou colado no chat) e brutos. Se os brutos estão no Google Drive para
   desktop, eles são **copiados** para o trabalho antes. O Claude confirma pela fala que cada bruto é daquele anúncio
   (nome de pasta e `IMG_xxxx` costumam enganar). Os brutos originais nunca são mexidos.
2. **Transcrever em blocos** (~50 s por bruto):
   ```
   .venv\Scripts\python.exe scripts\corte\preparar.py "<pasta dos brutos>" --prompt "termos da oferta"
   ```
   Cada trecho de fala é transcrito sozinho — numa passada só o Whisper "engole" a tomada repetida.
3. **Ler a transcrição contra o roteiro** e decidir o que fica: última tomada; sai conversa com a equipe, falso começo,
   alucinação do Whisper; fica palavra diferente mas certa ("pro" por "para o"). Palavra esticada `⟨≥1s⟩` é ouvida
   (`conferir.py <trab> fonte CHAVE:ini:fim`).
4. **Plano e render** (`plano.json` no trabalho — veja [plano.exemplo.json](plano.exemplo.json)):
   - `keep`: faixas de índices de palavras (`[12,28]`) ou de tempo (`{"t":[126.8,130.4]}`);
   - `fora`: trechos por tempo que saem mesmo dentro de um keep; `manter`: trecho que o corte de energia não pode picar;
   - `"formato"`: juntar câmeras diferentes (4K/60 + 1080/30) ou baixar 4K → HD mantendo a proporção.
   ```
   .venv\Scripts\python.exe scripts\corte\cortar.py "<trabalho>" o_k01_tsn_v1_r1
   ```
   O `cortar.py` tira toda pausa ≥ 150 ms (VAD + palavras) e todo trecho abaixo do limiar de energia por ≥ 120 ms
   (respiro), corta no grade de quadros, fade de 4 ms em cada emenda, H.264 CRF 16, AAC 192k.
5. **Três rodadas de conferência, sempre:**
   - `conferir.py <trab> pausas` → meta **zero pausa ≥ 0,2 s** e áudio/vídeo com no máximo 1–2 quadros de diferença;
   - `conferir.py <trab> texto` → re-transcreve a saída e compara com o que devia ficar;
   - cada `delete`, `insert` de mais de uma palavra ou palavra deformada é ouvido com `conferir.py <trab> janela NOME:ini:fim`.
     **Insert de frase inteira = retomada escondida** → sai e renderiza de novo.
6. **Caçar repetição sem pausa** (VSL, fala corrida): `repeticoes.py arquivo.mp4` (janela de 4 s). Precisa do whisper.cpp
   — veja a [seção 10](#10-o-que-é-só-do-mac-e-o-que-usar-no-windows).
7. **Entrega**: `Downloads\cortados\<nome>.mp4` e uma resposta curta com o que foi conferido e os avisos (anúncio sem bruto,
   fala do roteiro não gravada, arquivos juntados, nome trocado na gravação).

Clipes de IA (personagens de 8 s) têm armadilhas próprias: fala repetida dentro do clipe, botão/texto desenhado pela IA,
personagens trocando de lado — veja [docs/armadilhas.md](docs/armadilhas.md).

---

## 6. Corte na timeline do Atlas (aprovação)

Quando o vídeo vai ser editado no Atlas, em vez de renderizar o corte, o Claude manda a **proposta** para a timeline de
corte e você aprova:

1. Projeto criado a partir do **bruto original** (um bruto por anúncio).
2. `propor_atlas.py` grava os trechos que ficam (o mesmo cálculo do `cortar.py`) no projeto.
3. Você abre `http://localhost:4123/cortes?p=<nome>&v=A`:
   - cada corte é um **bloco azul**; o **olhinho** abre o trecho na prévia (fechado = a prévia pula, como cortado);
   - arraste as **bordas** do bloco; ✕ devolve o trecho;
   - **arraste a tesourinha** até um ponto (ou clique nela) para criar um corte novo;
   - **Salvar cortes** refaz o vídeo; **Aprovar corte** libera a edição (cortar de novo desfaz a aprovação).
4. Só depois da aprovação entram os B-rolls, no mesmo projeto.

---

## 7. Parte 2 — Edição dinâmica no Atlas

Modelo padrão: **Puro DR** — o expert falando e o B-roll em quatro jeitos, sem letreiro. Regras completas em
[docs/regras-de-edicao.md](docs/regras-de-edicao.md); o guia do estilo vem com o Atlas em
`estilos/puro-dr/LEIA.md` e `estilos/puro-dr/BUSCA.md`.

### 7.1 Projeto

```
estudio.py novo --nome "<nome>" --video "<cortado.mp4>" --estilo puro-dr --expert "<Expert>" --oferta "<Oferta>"
puro_dr.py integral "<nome>"        # vídeo que já veio cortado: versão A inteira
estudio.py rascunho "<nome>"        # cria o edicao.py com a fala e os tempos
estudio.py preparar "<nome>"        # recorte da expert (para o canto e a dividida), em segundo plano
```

### 7.2 Buscar B-roll

Ordem fixa (detalhes, custos e termos em [docs/busca-de-broll.md](docs/busca-de-broll.md)):

1. **Biblioteca primeiro**, só da pasta Expert › Oferta do projeto e só clipes **disponíveis e já estudados**
   (`puro_dr.py biblioteca`). **Clipe usado num anúncio não volta em outro.** Nada de B-roll solto do computador — só de
   pasta que você indicar.
2. **O que faltar, busca nova:**
   - **TikTok pela Apify** (`tiktok.py buscar`): termos em **inglês**, região **EUA** (nada de criador brasileiro), com
     `raw / aesthetic / cinematic / no text / no talking` — sem isso ~95% vem com texto. Cobra por resultado
     (~US$ 1 a cada 240). Uma busca grande por vez.
   - **Shorts do YouTube** (`youtube.py`, grátis): verticais, servem para cheia e canto. Vídeo normal (horizontal) só na
     tela dividida. Um download por vez.
3. **O Gemini (pela OpenRouter) estuda só os clipes novos** (~US$ 0,01 cada) e escreve a **ficha**: o que mostra, trechos
   limpos, onde tem texto, formatos em que serve. Clipe com texto o vídeo todo é excluído sozinho; com texto só num
   pedaço, serve o trecho limpo (≥ 2 s) com o quadro inteiro.
4. O Claude **olha os quadros** antes de usar (a ficha erra) e **reserva** os escolhidos.

### 7.3 Os quatro jeitos: tela cheia, tela dividida, recorte no canto

| jeito | quando usar | duração | clipe |
|---|---|---|---|
| **expert na tela cheia** | a fala não pede imagem | no máximo 6 s entre B-rolls | — |
| **B-roll na tela cheia** | dor, erro, a imagem mais forte, o gancho | 1,2–3,5 s | **só vertical** |
| **tela dividida** — B-roll em cima, expert embaixo | resultado, comparação | 2–5 s | aceita horizontal |
| **canto / react** — expert **recortado do fundo** na frente do B-roll | explicação longa | 3–6 s | **só vertical** |

- **Densidade**: 9–13 B-rolls por minuto no criativo dinâmico, nunca mais de 6 s sem B-roll, pelo menos **40% fora da
  tela cheia**. Respiro de 1,5 s com a pessoa entre dois B-rolls (direto só dividida → cheia e cheia → cheia).
- **Tela dividida**: o assunto tem que aparecer **inteiro na metade de cima**; se cortar rosto/corpo, recorta-se o clipe
  (`crop=[x,y,w,h]`) ou vira tela cheia. Expert em close naquele trecho → tela cheia.
- **Recorte (canto)**: a expert é separada do fundo pelo `preparar` (modelo RVM) e o enquadramento da cabeça é calculado
  pelo `motor.py <versão> cabecas`. Expert sentada/em close o vídeo todo → só tela cheia (o recorte mostra a borda reta).
- **Científicos** (moléculas, células, DNA, neurônios, corpo brilhando) em toda fala de hormônio/enzima/metabolismo;
  **gancho** com imagem literal; **sem B-roll** em diálogo de duas pessoas; **final de VSL** (oferta, bônus, garantia)
  sem B-roll de pessoas; **P&B** nas falas de dor; troca de cor/take coberta por um B-roll cheio.
- No `edicao.py`: `E.broll("cheia"|"dividida"|"canto", "<âncora>", ate="<âncora>", broll="B0123", ini=2.5, crop=[...])`;
  depois `estudio.py plano "<nome>"` até não sobrar nenhuma linha `regra:`.

### 7.4 Legenda

- Branca, **logo abaixo do pescoço** de quem fala, em todo anúncio (`legenda_por_take.py "<nome>" --abaixo -0.01` mede
  os ombros a cada 0,5 s, então funciona com takes de enquadramento diferente).
- Na **tela dividida** e no **canto** ela vai para o **meio da tela** (automático pelo estilo).
- Onde houver imagem importante na tela (quadro com antes/depois), a legenda daquele trecho desce.

### 7.5 Som e trilha

- **Efeitos sutis** na entrada do B-roll, pelas regras do modelo (clique, tique, whoosh leve; −23 a −26 dB; nunca dois em
  menos de 1,2 s). Na lead, extras para dar ritmo: impacto na abertura, whoosh na troca de cena, glitch no P&B, riser
  antes da virada.
- **Trilha** (`trilha.py`): **criativo curto sem música**; só instrumental (testada com o Whisper); de tensão/violino
  épico, nunca inspiracional; **lead ~19 dB abaixo da voz**, **VSL 25–30 dB abaixo no começo e 22–25 no resto**.

### 7.6 Conferir, entregar, renderizar

- `puro_dr.py densidade` (9–13/min, buraco ≤ 6 s) e prévias em ~15 pontos (`motor.py <versão> preview t1 t2 …`), olhando
  cada quadro: texto queimado, cabeça cortada, legenda na boca, clipe que não bate.
- Entrega: o Claude liga o Atlas (`preview_start atlas-editor`), abre
  `http://localhost:4123/editor?p=<projeto>&v=A`, confere por screenshot e manda o link.
- Você mexe na timeline (trocar B-roll, arrastar, mudar som) ou pede no chat. Depois que você mexeu, o `plano.json` é a
  fonte da verdade (o Claude nunca refaz o plano por cima).
- **Render só quando você pedir** (`estudio.py render "<nome>"`), **um por vez**, com espaço livre de ~3× o tamanho do
  vídeo. Confere duração, volume (−14 LUFS) e quadros. Os B-rolls viram "usados".

---

## 8. Parte 3 — Montagens especiais

| montagem | como |
|---|---|
| **Clone lado a lado** (a mesma pessoa em dois papéis, no tripé) | `clone_lado_a_lado.py plano_clone.json` — metade de cada tomada; quem não fala já está fazendo a ação desde o 1º quadro; o script imprime o volume de cada parte (parte muda = tempos trocados) |
| **Espelhar um trecho** (quadro escrito ao contrário, antes/depois invertido) | ffmpeg com `hflip` só entre T0 e T1 (comando no [SKILL.md](SKILL.md)) e recriar o projeto — as âncoras mantêm a edição |
| **Juntar lead + VSL** | mesmo formato → `ffmpeg -f concat -safe 0 -i lista.txt -c copy -movflags +faststart saida.mp4` |
| **Depoimentos de outra versão** (V0) | `inserir_depoimentos.py plano_dep.json` — depoimento com áudio entra depois da frase-gancho e empurra o vídeo; foto de antes/depois entra por cima da fala; imprime a minutagem |
| **Anúncio de personagem sem B-roll** | zoom 1,18× em quem fala em toda troca de cena, punch-in seco nas falas curtas, P&B na dor ([regras, seção 8](docs/regras-de-edicao.md)) |

---

## 9. Outras skills e plugins

**Já vêm com a instalação:**
- **`motion-vox`** — motion graphics editorial (estilo Vox) e legenda queimada sobre um clipe vertical já cortado. Kit
  com as fontes e o motor; roda com o Python da `.venv` da Perfect Edit. Os 16 assets de objeto do kit original não estão
  neste pacote (não estavam no Mac): gere os que precisar. No Windows, deixe o projeto numa pasta **sem acento** (o
  OpenCV não abre caminho com acento).
- **`criar-template`** (vem com o Atlas) — estuda um anúncio de referência (ritmo medido por ffmpeg, quadros, legenda,
  som) e cria um estilo novo em `estilos/`. Nasce rascunho; publicar só quando você mandar.

**Plugins de terceiros (instalar separado, se quiser):**
- **get-brolls** (Bruno Moreira, MIT) — coleta B-roll do YouTube/Instagram/stock com revisão em Storyboard e registro de
  origem; não busca no TikTok por palavra-chave. Tem instalador do Windows:
  ```powershell
  git clone https://github.com/engenheirodevideo/get-brolls.git "$HOME\.claude\skills\get-brolls"
  cd "$HOME\.claude\skills\get-brolls"
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
  ```
- **HyperFrames** (HeyGen) — vídeo a partir de HTML (intros, letreiros animados, legendas cinematográficas, SFX). No
  Claude Code: `/plugin marketplace add heygen-com/hyperframes` e `/plugin install hyperframes@hyperframes`. Precisa do
  Node.js (`winget install OpenJS.NodeJS.LTS`) e do Google Chrome.

---

## 10. O que é só do Mac e o que usar no Windows

| no Mac | no Windows | observação |
|---|---|---|
| Homebrew (`brew install ffmpeg`) | `winget install Gyan.FFmpeg` | abra um terminal novo depois, para o PATH atualizar |
| `install.sh`, atalhos com `ln -s` | `install.ps1`, junções (`New-Item -ItemType Junction`) | o instalador faz |
| `.venv/bin/python` | `.venv\Scripts\python.exe` (no Bash do Claude: `.venv/Scripts/python.exe`) | o SKILL.md tem os dois |
| `~/Edições/Abrir Estúdio.command` | **`Abrir Atlas.cmd`** | dois cliques |
| **whisper.cpp com Metal** (GPU do Mac) no `repeticoes.py` | baixe o whisper.cpp do Windows em [github.com/ggml-org/whisper.cpp/releases](https://github.com/ggml-org/whisper.cpp/releases) (`whisper-bin-x64.zip`; com placa NVIDIA, o `whisper-cublas-…`), ponha a pasta no PATH e o modelo [`ggml-large-v3-turbo.bin`](https://huggingface.co/ggerganov/whisper.cpp/tree/main) em `%USERPROFILE%\whisper-models\` | **opcional**. Sem placa de vídeo fica bem mais lento (minutos por anúncio). Sem ele, o corte funciona; só perde a caça extra de repetição em VSL |
| `mlx_whisper` (transcrição rápida no Apple Silicon) | não precisa: tudo usa **faster-whisper**, que roda no Windows | com placa **NVIDIA**, o corte pode usar a GPU: instale CUDA 12 + cuDNN 9 e `setx PERFECT_CUT_DEVICE cuda` |
| Recorte de pessoa pelo **Vision da Apple** (`osascript`) — usado só no começo, no estilo Lotz | não precisa: o Atlas recorta com o **RVM (onnxruntime)**, que roda no Windows | — |
| `sips -g hasAlpha` (ver se a foto já está sem fundo) | `python -c "from PIL import Image; im=Image.open('foto.png'); print(im.mode, im.getpixel((0,0)))"` | alpha 0 no canto = já está recortada |
| Fontes do sistema (Avenir Next, **Apple Color Emoji**) | a Avenir Next Bold vem no Atlas (`fontes/`); emoji sai na **Segoe UI Emoji** (desenho do Windows) | para emoji parecido com o do celular: baixe o `NotoColorEmoji.ttf` e `setx ESTUDIO_FONTE_EMOJI "C:\caminho\NotoColorEmoji.ttf"` |
| Token da Apify no `~/.zshrc` | no ⚙ do Atlas (ou `setx APIFY_API_TOKEN ...`) | — |
| **DaVinci Resolve** (API testada em 2026-10-24) | **não incluído** | foi descartado: o sistema é o Atlas |
| Skills `corte-bruto`, `edicao-puro-dr`, `octo-edicao` (Mac) | já estão **dentro** da `perfect-edit` | no Windows não instale separado |
| Skill `edicao-dinamica` (Mac, desatualizada) | **`criar-template`** do Atlas | faz o mesmo, atualizada |
| Atalhos `~/Editor Atlas` e `~/B-rolls` | não precisa | os scripts acham `~/Octo Edição/Atlas` sozinhos (ou `PERFECT_EDIT_ATLAS`) |

---

## 11. Levar os dados do Mac (B-rolls, projetos, chaves)

Nada disso vai pelo GitHub. Escolha o que levar:

- **Biblioteca de B-roll** (para manter os clipes estudados e as marcas de "usado"): copie a pasta
  `Octo Edição/B-rolls` do Mac (HD externo ou Google Drive) para `C:\Users\<você>\Octo Edição\B-rolls` e corrija os
  caminhos gravados no índice:
  ```powershell
  cd "$HOME\perfect-edit"
  .venv\Scripts\python.exe scripts\edicao\migrar_biblioteca.py --de "/Users/danieldias/Octo Edição/B-rolls" --para "$HOME/Octo Edição/B-rolls" --teste "$HOME\Octo Edição\B-rolls"
  ```
  O `--teste` só conta; tire-o para gravar (fica um `.antes-da-migracao` de cada arquivo). Sem copiar, a biblioteca do
  Windows começa vazia e vai enchendo com as buscas.
- **Projetos** (`~/Edições`): só se for continuar um projeto do Mac. Copie a pasta e rode o mesmo script com
  `--de "/Users/danieldias/Edições" --para "$HOME/Edições"`.
- **Chaves**: digite de novo no ⚙ do Atlas (não copie arquivo de chave por e-mail/Drive).
- **Trilhas e SFX próprios**: os efeitos do Atlas já vêm no repositório (`sfx/`). Músicas que você baixou ficam na pasta
  de B-roll da oferta (ex.: `.../Calistenia Hormonal/musica trend/`) — vão junto se copiar a biblioteca.

---

## 12. Problemas comuns

| sintoma | causa / solução |
|---|---|
| `UnicodeEncodeError`, `'charmap' codec`, acentos estranhos nos .json | `PYTHONUTF8` não está ligado: rode o `install.ps1` de novo e **abra um terminal/Claude Code novo** |
| `py -3.12` não encontrado | `winget install --id Python.Python.3.12 -e` e abra um PowerShell novo |
| `ffmpeg` não reconhecido | `winget install --id Gyan.FFmpeg -e` e abra um PowerShell novo (o PATH só atualiza em janela nova) |
| `running scripts is disabled on this system` | rode com `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
| O clone do Atlas pede senha / dá 404 | os repositórios são privados: entre na conta **dankeeps** quando o Git abrir o navegador (ou `winget install GitHub.cli` e `gh auth login`) |
| Erro ao abrir modelo do Whisper/recorte | nome de usuário do Windows com acento: `setx ESTUDIO_MODELOS C:\modelos\atlas` e `setx PERFECT_CUT_MODELOS C:\modelos\perfect-cut` |
| Porta 4123 em uso | o Atlas já está aberto (outra janela do `Abrir Atlas.cmd` ou o Claude abriu): use `http://localhost:4123` |
| B-roll aparece **preto** na cena | o arquivo do clipe foi movido/apagado: confira o caminho no índice (`migrar_biblioteca.py`) |
| Render cai no meio | dois renders ao mesmo tempo ou disco cheio (precisa de ~3× o tamanho do vídeo livre) |
| Busca no TikTok trava/estoura | duas buscas grandes juntas (a Apify corta em 900 s): uma por vez |
| YouTube pede "verificação de acesso" | downloads em paralelo: um por vez, e espere alguns minutos |
| `whisper-cli não encontrado` | só o `repeticoes.py` usa — instale o whisper.cpp ([seção 10](#10-o-que-é-só-do-mac-e-o-que-usar-no-windows)) ou ignore |

---

## 13. Referência rápida de comandos

No **PowerShell** (o Claude usa as mesmas coisas pelo Git Bash, com `/` no lugar de `\`):

```powershell
$PYC = "$HOME\perfect-edit\.venv\Scripts\python.exe"           # corte, montagens, motion-vox
$PYA = "$HOME\Octo Edição\Atlas\.venv\Scripts\python.exe"      # Atlas
$SC  = "$HOME\perfect-edit\scripts\corte"; $ED = "$HOME\perfect-edit\scripts\edicao"; $L = "$HOME\Octo Edição\Atlas\lib"

# corte
& $PYC "$SC\preparar.py" "<pasta dos brutos>" --prompt "termos"
& $PYC "$SC\cortar.py"   "<trabalho>" [NOME]
& $PYC "$SC\conferir.py" "<trabalho>" pausas | texto | janela NOME:ini:fim | fonte CHAVE:ini:fim | quadro CHAVE:t
& $PYC "$SC\repeticoes.py" arquivo.mp4
& $PYC "$SC\propor_atlas.py" "<trabalho>" NOME "$HOME\Edições\<projeto>"

# Atlas
& $PYA "$L\estudio.py" novo --nome "X" --video V.mp4 --estilo puro-dr --expert E --oferta O
& $PYA "$L\estudio.py" cortes | preparar | rascunho | plano | conferir | render | status "<projeto>"
& $PYA "$L\estudio.py" acervo "<projeto>" --biblioteca B0012 B0015
& $PYA "$L\estudio.py" broll "<projeto>" A 3 --id B0099 [--ini 2.0] [--tipo canto]
& $PYA "$L\tiktok.py"  buscar "<projeto>" "<rótulo>" "term one" "term two" --n 15 --regiao US
& $PYA "$L\youtube.py" buscar "<termos>"
& $PYA "$L\motor.py"   "$HOME\Edições\<projeto>\versoes\A" preview 3 7 12 | cabecas

# edição (Perfect Edit, rodam com o Python do Atlas)
& $PYA "$ED\puro_dr.py" integral | biblioteca | reservar | pescoco | densidade | assistir "<projeto>"
& $PYA "$ED\legenda_por_take.py" "<projeto>" --abaixo -0.01
& $PYA "$ED\trilha.py" musica.wav "<projeto>" --abaixo 19 --nome trilha.wav

# montagens (Python da Perfect Edit)
& $PYC "$ED\clone_lado_a_lado.py" plano_clone.json
& $PYC "$ED\inserir_depoimentos.py" plano_dep.json
& $PYC "$ED\migrar_biblioteca.py" --de "<prefixo antigo>" --para "<prefixo novo>" [--teste] <pasta>
```
