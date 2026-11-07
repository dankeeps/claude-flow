# Armadilhas (o que já custou retrabalho)

## Corte
- **Whisper numa passada só engole tomada repetida** (estica uma palavra por cima de 2–4 s). Por isso o `preparar`
  transcreve em blocos. Em fala corrida sem pausa (VSL), use também o `repeticoes.py` (janela de 4 s).
- **O prompt do Whisper vira alucinação** em trecho de ruído ("Tchau, tchau", "Obrigado", a lista de termos). Nunca deixe
  uma dentro de uma faixa do `keep`.
- **Palavra esticada `⟨≥1s⟩`** pode esconder retomada: ouça o trecho do bruto (`conferir.py fonte`).
- **`insert` de frase inteira** no `conferir texto` = retomada escondida que o plano não listou → `fora`.
- VAD sozinho guarda respiro de 0,3–0,4 s como fala; o passe de energia do `cortar.py` é que tira (≥ 120 ms abaixo do
  limiar). Bruto com ruído de fundo (piso > −50 dB) protege o miolo das palavras, senão "acostumar" vira "atumar".
  Não mexa nesses números sem motivo — foram calibrados na remessa R01.
- **Abertura**: o Whisper marca a 1ª palavra cedo demais → 40–80 ms de silêncio no começo. Confira os primeiros 60 ms da
  saída e, se precisar, `fora [0, início_real]` subindo de quadro em quadro.
- Clipe de IA pode terminar com a palavra no meio: não tem conserto, só avisar.
- Câmera Canon (0N3A…) grava 3840×2160 com rotação 90°: é vertical (o `preparar` já mostra girado).
- Juntar câmeras diferentes (4K/60 do iPhone + 1080/30) → `"formato"` no plano para escalar e igualar o fps.
- Bruto longo é renderizado em lotes de 40 trechos (uma expressão só estoura o ffmpeg).

## Montagem no Atlas
- **As âncoras do `edicao.py` só andam para a frente.** Âncora que aparece antes da anterior pula para a próxima
  ocorrência lá na frente, em silêncio. Escreva na ordem da fala; vídeo longo, âncora por tempo `T(s)`.
- Contar ocorrência ("a 3ª vez de 'treino'") pega a errada sem avisar: use 2–3 palavras.
- O Whisper grafa errado a âncora ("bumu" por "bumbum"): `CORRECOES = {"bumu": "bumbum"}` no `edicao.py`.
- **`plano --forcar` zera `sfx_extras` e a posição da legenda** (e tudo que o Daniel mexeu na timeline). Guarde antes,
  recoloque depois e rode de novo o `legenda_por_take.py`/`pescoco`.
- **Confira se os arquivos dos B-rolls existem** antes do plano: clipe movido/apagado sai preto, sem erro.
- Clipe horizontal não serve para cheia/canto (perde quase toda a imagem no recorte).
- `emoji` é o 4º argumento do `L()` (letreiro), não parâmetro do `letreiro()`; `card` só é desenhado com a pessoa
  sozinha, nunca sobre canto/cheia/dividida.
- Depois do `cortes --aplicar`, o `nb_frames` do `jc.mov` tem que bater com a duração: transcode que morre no meio passa
  despercebido e só aparece quando as máscaras acabam antes do fim.
- No Bash, lista de IDs numa variável vai como **um** argumento: escreva os IDs soltos (`B0001 B0002`).

## Render e disco
- **Um render por vez**: dois juntos derrubam o render.
- O render precisa de ~3× o tamanho do vídeo livre no disco (pedaços + concat + mux). Projeto de teste: não copie
  `jc.mov`/`masks`, use o render de rascunho (`render.py <versão> --rascunho`, não marca usados).
- Confira a saída: duração, LUFS (−14) e quadros.

## Montagens
- **Clone**: quem não fala tem que estar fazendo a ação desde o 1º quadro; tempos das duas câmeras trocados = parte
  muda. Meça o volume de cada parte (o script imprime) e olhe um quadro.
- **Depoimentos**: em janela longa o Whisper "pula" o depoimento inserido; confira transcrevendo só o trecho.
- **Elemento desenhado pela IA** (botão "INSCRIME" com cursor): tirar copiando o fundo limpo de um quadro vizinho; o clipe
  remendado vai para `patch/` e o bruto fica intacto.
- **Personagens trocando de lado** num clipe de IA: `hflip=enable='gte(t,1.0)'` num clipe em `patch/`.
- **Foto que já veio sem fundo** (PNG/WebP com transparência): a prévia do chat mostra fundo branco, mas o arquivo já está
  recortado — confira o alpha antes de recortar de novo (recortar um recorte serrilha a borda):
  `python -c "from PIL import Image; im=Image.open('foto.png'); print(im.mode, im.getpixel((0,0)))"` (alpha 0 no canto =
  já está sem fundo).

## Windows
- **`PYTHONUTF8=1`** tem que estar ligado (o `install.ps1` liga para o usuário): sem ele o Python grava os .json em
  cp1252 e quebra com emoji/acentos, e o ffmpeg não acha arquivo com acento na lista do `concat`.
- Modelos de IA (Whisper, recorte, pose) numa pasta **sem acento** (`ESTUDIO_MODELOS=%USERPROFILE%\.cache\atlas-modelos`):
  algumas bibliotecas não abrem modelo em caminho com "ç" no Windows. Se o nome do usuário do Windows tiver acento, mude
  `ESTUDIO_MODELOS` e `PERFECT_CUT_MODELOS` para algo como `C:\modelos`.
- O OpenCV (`cv2.imread`) não abre arquivo com acento no caminho no Windows: no motion-vox, deixe o projeto numa pasta
  sem acento.
- O Bash do Claude Code no Windows é o Git Bash: o Python da .venv é `.venv/Scripts/python.exe` (não `bin/python`).
- Fechar a janela do "Abrir Atlas.cmd" desliga o Atlas.
