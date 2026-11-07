# Busca e biblioteca de B-roll

## Onde fica

```
~/Octo Edição/B-rolls/<workspace>/                     workspace padrão: Principal
    biblioteca/biblioteca.json                         o índice (ficha de cada clipe, estado, usos)
    biblioteca/capas/                                  capa de cada clipe
    <Expert>/<Oferta>/<Categoria>/B0123.mp4             os clipes (categoria = nome da busca)
    <Expert>/<Oferta>/.descartados/                    o que não serviu
```
Cada clipe tem um ID (`B0123`) e um estado: **disponível**, **usado** (já entrou num anúncio renderizado ou foi reservado
na escolha), **descartado** ou **excluído** (texto o vídeo todo: o arquivo sai, o registro fica para a busca não baixar
nem pagar o estudo de novo). A aba **Arquivos** do Atlas navega Expert › Oferta › Categoria.

Nunca deixe clipe solto fora das pastas, e ao mover um arquivo de B-roll atualize o `plano.json`/`acervo.json` dos
projetos que apontam para ele (clipe movido sai **preto** na cena, sem erro nenhum).

## A ordem fixa

1. **Ver os que já temos — só disponíveis e JÁ ESTUDADOS** (`puro_dr.py biblioteca "<projeto>"` → `fichas.txt`).
   Ordem: ★ etiqueta do anúncio → match com a fala → maior nota. Clipe sem ficha é ignorado; estudar os antigos
   (`--estudar`) só se o Daniel pedir.
2. **Plano de B-roll**: ler a fala inteira (o `rascunho` põe a fala com tempo no `edicao.py`) e listar cada momento que
   pede imagem e que nenhuma ficha cobre. Uma busca por tipo de imagem. Confira a pasta clipe a clipe, não por categoria.
3. **Buscar só o que falta** (TikTok ou Shorts do YouTube), o Gemini estuda só os novos.
4. **Encaixar pela ficha** (linha do tempo, melhor momento, trechos limpos, texto, formatos, o que ilustra) e, na dúvida,
   olhar os quadros.
5. **Revisão**: buraco > 6 s ou falta → outro clipe ainda não usado, mais uma busca específica, ou deixar a expert.
6. **Reservar na escolha** (`puro_dr.py reservar`) — não no render.

Quantos: 9 a 13 por minuto + 2 ou 3 de folga. Mínimo antigo: 5 por anúncio, diferentes entre anúncios. Não peça o
dobro "por segurança": clipe demais encarece o estudo e polui a pasta.

## TikTok (Apify)

```
$PYA $L/tiktok.py buscar "<projeto>" "<rótulo curto>" "termo em inglês" "outro termo" --n 15 --regiao US [--dur 3-45]
$PYA $L/tiktok.py quadros "<projeto>" <busca> 3,7,11       # 5 quadros de cada candidato, com o segundo
```
- Ator `clockworks/tiktok-scraper` (ID `GdWCkxBtKWOsKjdch`), região EUA. Cobra por resultado: ~US$ 0,0037 + add-ons
  ~US$ 0,0013 (240 resultados ≈ US$ 0,96). O token fica no ⚙ do Atlas (ou na variável `APIFY_API_TOKEN`).
- A busca baixa os candidatos para a pasta Expert › Oferta › `<rótulo>` e o Gemini estuda cada um.
- **Rendimento**: termos simples (ex.: "woman barbell squat glutes") deram 5 limpos de 88; com modificadores, 14 de 100.
  **Comece já com eles**: `raw`, `aesthetic`, `cinematic`, `no text`, `no talking`. Eles orientam, não garantem.
- Uma busca grande por vez (duas juntas estouram os 900 s da Apify). Rode em segundo plano.
- Mandar os termos de várias categorias numa corrida e separar pelo `searchQuery` sai mais barato que uma corrida por
  categoria.
- O que quase nunca vem limpo: academia com celular, seringa/canetinha (Ozempic), ator famoso, anatomia 3D (vem com texto).

Termos que renderam:
- Científicos: "hormone molecules 3d", "cells 3d animation", "dna glowing particles", "neurons firing cinematic",
  "human body hologram", "endocrine system 3d", "thyroid 3d animation", "blood vessels 3d animation".
- Glúteo/treino feminino: "woman resistance band workout at home raw", "woman glute activation resistance band workout
  raw", "woman glute workout gym cinematic", "woman home workout aesthetic no talking", "gym woman glutes physique posing
  raw", "busy woman morning routine work aesthetic".

## YouTube (grátis, yt-dlp)

```
$PYA $L/youtube.py buscar "<termos>" [--n 12]
$PYA $L/youtube.py quadros <id> <pasta>                      # folha de quadros com o segundo, sem baixar o vídeo
$PYA $L/youtube.py baixar <pasta do projeto> <id> <início> <duração> <nome> "<descrição>"
```
- Para coisa **nomeável** (pessoa famosa, filme, notícia, lugar, produto). Vídeo normal é horizontal → **só tela dividida**.
- Para tela cheia e canto, só **Shorts** (verticais): filtro de tipo do YouTube `sp=EgIQCQ%253D%253D` na URL de busca
  (`https://www.youtube.com/results?search_query=<termos>&sp=EgIQCQ%253D%253D` com o yt-dlp).
- **Um download por vez**: em paralelo o YouTube bloqueia ("verificação de acesso").
- A origem de cada corte fica em `<projeto>/assets/youtube.json`.

Clipe que o Daniel manda por link (TikTok/YouTube): `yt-dlp` para `~/Downloads/Vamos editar/B-rolls indicados/<anúncio>/`,
ficha pelo `$PYA $L/gemini.py estudar "<arquivo>"`, `$E acervo "<projeto>" --pasta "<pasta>"`. Entra mesmo com texto
(trava dele) — avisar.

## Estudo pelo Gemini (OpenRouter)

- Sempre pela **OpenRouter** (a API direta do Google não funcionou). Chave no ⚙ Configurações do Atlas → Testar.
- ~US$ 0,01 por clipe; cada clipe é estudado **uma vez** e a ficha fica no `biblioteca.json` (`itens[ID].estudo`).
- A ficha erra: "limpo" às vezes fala da ação e não do texto (B0046 tinha "CHOOSE HARD" pintado na parede o vídeo todo).
  Respeite a janela limpa inteira (o `ini` **e** o fim), e olhe os quadros antes de pôr no anúncio.
- `puro_dr.py assistir "<projeto>"`: o Gemini assiste o último render inteiro e aponta problemas (~US$ 0,02), só se ele pedir.

## Triagem fora do Atlas (lote de B-roll para entregar)

Quando o pedido é só "me traz B-roll" (sem edição): copy → temas visuais → keywords em inglês/EUA → busca → separar por
categoria pelo ID (nenhum ID em duas categorias) → triagem por imagem → sem áudio, vertical 720×1280. Na entrega, diga o
nível: triagem por imagem **não garante** ausência de texto em todo quadro; só a conferência quadro a quadro (a cada
1–2 s, arquivo completo) garante. Arquivos do ator às vezes são prévias de ~3 MB truncadas.

## Levar a biblioteca para outro computador

A biblioteca é grande (vídeos) e **não vai pelo GitHub**. Para levar: copie a pasta `Octo Edição/B-rolls` inteira (HD
externo ou Drive) para o mesmo lugar na máquina nova e troque o começo dos caminhos gravados nos .json:
```
$PYC $ED/migrar_biblioteca.py --de "/Users/danieldias/Octo Edição/B-rolls" --para "C:/Users/<você>/Octo Edição/B-rolls" --teste "C:/Users/<você>/Octo Edição/B-rolls"
```
(sem `--teste` grava, guardando `<arquivo>.antes-da-migracao`). Os projetos (`~/Edições`) da mesma forma, com
`--de "/Users/danieldias/Edições"`. Sem copiar, a biblioteca do Windows começa vazia e enche com as buscas.
