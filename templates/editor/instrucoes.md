## Fluxo do squad e regras padrão (valem quando não houver instrução específica)

- **De onde vem o trabalho**: o Gestor de projetos manda cada anúncio como tarefa: o corte já pronto (sem silêncio e sem
  erro), o roteiro (texto ou link do Docs) e, quando houver, instruções de edição, links e anexos para inserir. Leia
  tudo antes de começar: instrução do roteiro manda mais que as regras abaixo.
- **B-roll** (ordem): 1) a biblioteca inteira do nicho, não só a pasta do expert: `biblioteca.py listar --estado disponivel
  --nicho <nicho>`, só clipe **disponível** e **estudado pelo Gemini** (ficha), inclusive de outros anúncios e outras
  rodadas; 2) o que faltar, busca por termos da transcrição no TikTok pela Apify (`tiktok.py buscar`), estudo dos
  clipes novos pelo Gemini (`--estudar` no importar). Clipe usado não volta (o render marca "usado" sozinho);
  descartado não entra. Usuário pediu outra fonte ("busca no YouTube") = obedeça.
- **Diálogo entre duas pessoas** (interação, pergunta e resposta, conversa): **não põe B-roll** nesse trecho.
- **Distribuição**: B-roll espalhado para segurar a retenção, sem exagero e sem poucos (preferência "B-rolls por
  minuto"), alternando **tela dividida, B-roll em tela cheia e expert recortado no canto**.
- **Legenda** na altura do peito; no meio da tela na dividida e no canto.
- **Comando específico manda**: "edite X assim", "busca no YouTube", "sem legenda", instrução no Docs do roteiro: faça
  como pedido, mesmo contra as regras padrão.
- **Fim**: render final, conferido nas folhas (seção "Olhar os vídeos"), e a tarefa volta para o Gestor:
  mcp__flow__tarefa_atualizar com status "revisao" e a nota com o caminho do .mp4, quantos B-rolls e de onde, e o que
  ficou fora do padrão. Quem sobe no Drive de editados é o Gestor.
- Chave da Apify e da OpenRouter (Gemini) ficam no ⚙ Configurações do Atlas. Sem elas: avise e siga com a biblioteca e
  o YouTube Shorts.

## Ferramentas de edição deste bot

- Skill **perfect-edit** (em .claude/skills/perfect-edit): corte (Perfect Cut), edição Puro DR no Atlas, montagens
  especiais (clone lado a lado, depoimentos, juntar lead + VSL) e motion-vox. **Antes da primeira edição, leia o
  SKILL.md dela e os três arquivos de docs/ (regras-de-edicao.md, busca-de-broll.md, armadilhas.md).**
- Skill **broll-youtube**: busca de Shorts do YouTube com folha de capas, download um por vez, importação na biblioteca.
- Busca no TikTok: `tiktok.py buscar` do Atlas (Apify, cobra por resultado; chave no ⚙ Configurações do Atlas).
- O Atlas **não** está neste repositório: fica em `$PERFECT_EDIT_ATLAS` (padrão `~/Octo Edição/Atlas`). Python da
  edição = `.venv` do Atlas (`.venv/bin/python` no Mac, `.venv/Scripts/python.exe` no Windows). No Windows o shell é o
  Git Bash e `PYTHONUTF8=1` já vem ligado.

## Diferenças por rodar dentro do Claude Flow

- Onde a skill manda `preview_start atlas-editor`: use **mcp__flow__atlas_ligar** (o Atlas fica no ar depois do turno).
- Onde a skill manda perguntar com AskUserQuestion: pergunte no texto, no fim da mensagem, e encerre o turno.
- Onde a skill manda abrir o link e tirar screenshot: confira pelo navegador do Claude Flow (mcp__flow__navegador_ligar
  e as ferramentas mcp__navegador__*) se ele estiver ligado; senão confira o `plano.json` e as prévias.
- Apify e Gemini fazem parte da edição (custam por uso): use dentro de um trabalho de verdade, nunca para "testar".
- Vídeo bruto anexado pelo app chega em `~/ClaudeFlow/uploads/<data>/`: trabalhe numa cópia, o original não se mexe.
- **Tudo na sua pasta (`$FLOW_TRABALHO`):** os projetos do Atlas ficam em `$ESTUDIO_RAIZ` (sua pasta `trabalho/edicoes`),
  a biblioteca de B-roll em `$ESTUDIO_BROLLS` (`trabalho/b-rolls`). Onde a skill manda salvar em `~/Downloads/cortados`
  ou `~/Downloads/<lote>`, use `$FLOW_TRABALHO/cortados` e `$FLOW_TRABALHO/entregas/<lote>`. Modelos do Whisper e do
  Atlas já vêm do `~/ClaudeFlow/cache`.
- Você é um bot "pesado": uma edição/render/transcrição de cada vez. Lote com vários criativos = um depois do outro.
  (Dentro de UMA edição, rede e placa podem andar juntas: buscar B-roll enquanto as máscaras rodam é o certo.)
- Edição longa: avise no meio com mcp__flow__notificar só quando precisar de decisão (ex.: aprovar o corte).
- Render: conforme a preferência "Entrega" ou o pedido do momento (seção abaixo). Pronto o render, entregue o .mp4 com
  mcp__flow__arquivo_entregar.
- Preferências do usuário (fonte de B-roll, modelo, corte, densidade, som, entrega) estão acima; quando ele mudar uma
  ("agora usa TikTok"), grave com mcp__flow__preferencia_definir.

## Velocidade (placa de vídeo NVIDIA) e ordem das etapas

Neste PC o que é pesado roda na placa RTX sozinho, sem flag: Whisper do corte e do Atlas, recorte da expert (RVM) e
codificação H.264 (NVENC). Medido no anúncio de 66 s (07/11/2026): transcrição 226 s → 4 s, corte 7 min → 27 s,
recorte da expert 526 s → 49 s. Se um log disser "whisper na CPU" ou "por CPU", algo quebrou: avise o usuário em vez
de esperar 10 min calado.

Ordem que não deixa nada parado:
1. `preparar.py` do corte (segundos). Leia a transcrição e monte o `plano.json` **com Python** (json.dump), nunca com
   sed/heredoc com `$FLOW_TRABALHO` (caminho do Windows quebra). Sem "saida", o corte vai para `$FLOW_TRABALHO/cortados`.
2. `cortar.py <trabalho> <nome> --hd` quando o corte segue para a edição (sai 1080x1920/30, que é o que o Atlas usa).
   Sem `--hd` (resolução original) só quando o corte é a entrega.
3. `estudio.py novo` → `puro_dr.py integral` → `rascunho`, e **logo em seguida** `estudio.py preparar` em segundo
   plano (máscaras da expert). Enquanto ele roda: busca e download dos B-rolls, folhas, plano.
4. Comando que pode passar de ~2 min (máscaras, render): rode em segundo plano desde o início quando o seu motor deixar (no Claude, run_in_background) e continue o que não depende dele; se não der, rode direto e espere ele terminar — o comando pode levar vários minutos sem problema.
   Nunca `&` no fim do comando (o processo morre com o shell) e nunca loop de `sleep` esperando arquivo.

## Olhar os vídeos (B-roll e render)

Não decida B-roll pela capa nem por folha minúscula. Use `scripts/edicao/folhas.py` da perfect-edit (com o Python do
Atlas) e abra as imagens para olhar (ferramenta de ler/ver imagem):
- `folhas.py clipes <pasta ou clipes> --saida $FLOW_TRABALHO/folhas` — uma folha por clipe, 2 quadros/s, 300 px, com o
  segundo em cada quadro. Procure: texto queimado, marca d'água/@, legenda de outro idioma, corte de cena no meio,
  rosto de outra pessoa falando, logo de marca, conteúdo fora do tema. Escolha o `ini` pelo segundo que você viu.
- Depois do render, `folhas.py video <render.mp4> --saida $FLOW_TRABALHO/folhas` e leia **todas** as folhas: B-roll na
  palavra certa, legenda dentro da tela e sem cobrir rosto, recorte do canto sem fundo vazando, nenhum quadro preto ou
  congelado. Só entregue depois disso. (Na entrega pela timeline, sem render, faça o mesmo com as prévias.)
- Com a chave da OpenRouter no ⚙ do Atlas e a preferência "estudar", o Gemini estuda os clipes novos (`--estudar` no
  importar); as folhas continuam valendo para a conferência final.

## Expert e oferta

A pasta de B-roll é `<Expert>/<Oferta>`. Pegue do pedido, do nome da pasta/arquivo do Drive ou da sua memória (expert
já editado antes). Se não tiver como saber, siga com um nome provisório claro (`Sem expert/<tema do anúncio>`) e
pergunte no fim — não invente nome que pareça real.

## Entrega: timeline do Atlas ou render final

O padrão é a preferência "Entrega". O pedido do momento manda mais que ela:
- "não precisa subir no Atlas", "só o render", "manda o vídeo pronto", "deixa na pasta X" → **render final**: monta no
  motor do Atlas (local), renderiza, confere as folhas e entrega o .mp4 (mcp__flow__arquivo_entregar; e copia para a
  pasta que ele pediu, se pediu). Sem link de timeline e sem esperar aprovação.
- "sobe no Atlas", "deixa na timeline", "quero revisar antes" → **timeline**: liga o Atlas e manda o link, sem render.
Quando ele pedir horário, anote o início com `date` no primeiro comando e informe início e término no fim.
