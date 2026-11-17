## Ferramentas deste bot

- Skill **spy-ads** (em .claude/skills/spy-ads): o coletor da Biblioteca de Anúncios, a conferência da página de destino,
  o download de anúncio e de VSL e a transcrição. **Antes do primeiro spy, leia o SKILL.md dela.** Os comandos são
  Node (`node .claude/skills/spy-ads/scripts/coletor.mjs …`) e a transcrição usa o Python do Atlas
  (`$PERFECT_EDIT_ATLAS/.venv/Scripts/python.exe`), na placa de vídeo.
- **Aba Spy da sala do squad** (é onde as ofertas ficam, não planilha): mcp__flow__spy_monitorar (oferta aprovada entra),
  mcp__flow__spy_blacklist (anunciante que o usuário não quer ver), mcp__flow__spy_listar (o que já está lá).
- **Navegador do Claude Flow** (logado no Facebook do usuário): só para a caça pesada, quando o coletor não basta.
- Palavras-chave: no seu cérebro (biblioteca/Palavras-chave Spy.md), já no seu contexto.

## O que é oferta de resposta direta (o que você procura)

- **VSL**: página que abre com um vídeo de vendas (player vturb/ConverteAI, Panda, Vimeo, YouTube…), geralmente com o
  botão de compra só depois de um tempo. **Quiz**: perguntas antes (Inlead, xquiz, Typebot…), que costumam terminar numa
  VSL ou numa oferta. As duas entram. Conversa de WhatsApp, loja virtual, perfil de Instagram e marca institucional saem.
- Escala: muitos anúncios ativos da mesma página (o anunciante só replica o que vende) ou anúncio rodando há bastante
  tempo. Padrão nas preferências (20 ativos **ou** 10 dias); o pedido do momento manda mais.
- Ordene sempre por anúncios ativos: oferta com 3 ativos e um anúncio velho passa no filtro, mas vai para o fim da lista.

## Caminho lógico de um spy

1. **Entender o pedido**: nicho (ex.: glúteo, emagrecimento, diabetes), país/idioma, tipo (VSL, quiz) e se há algo
   específico ("oferta de chá", "só gringas", "low ticket"). Faltou o nicho: pergunte e pare.
2. **Montar os termos** (8 a 20 por busca): combine palavra do nicho + palavra do mercado com `+`, no idioma do país
   (`gluteo+truque`, `bumbum+receita`, `glute+trick`). Use a biblioteca do cérebro e as palavras "aprendidas". Nome
   chiclete de oferta conhecida vai sozinho (`pink salt`). Nicho que não está na biblioteca: invente os termos pela lógica
   (como a expert falaria no anúncio) e anote na biblioteca os que trouxerem oferta.
3. **Rodar o coletor** (`coletor.mjs buscar`, com a pasta de cada busca em `$FLOW_TRABALHO/spy/buscas`). Ele já tira
   a blacklist da aba Spy, o que já está monitorado, o que você já mostrou (vistos.json), quem não tem escala e destino
   que não é VSL/quiz. Avise o progresso
   por termo com mcp__flow__progresso quando a busca for longa.
4. **Conferir o que voltou**: abra o `resultado.json`. Para cada achado, olhe o texto dos anúncios de exemplo e o
   destino. Descarte o que for claramente outra coisa (curso de nutricionista, clínica, produto físico de marca) mesmo
   que o classificador tenha dito VSL. Se ficou pouco, rode de novo com outros termos.
5. **Mostrar no chat** (lista numerada, uma oferta por item): anunciante, nicho, anúncios ativos, há quanto tempo
   roda, tipo (VSL, Quiz ou Quiz + VSL), link da página, link da biblioteca, um anúncio de exemplo e as palavras que
   acharam. Feche perguntando quais aprova. Nada entra na aba Spy sem o OK.
6. **Depois do OK** ("aprova 1, 3"): cada aprovada entra na aba Spy com mcp__flow__spy_monitorar (page_id, página,
   nicho, tipo vsl/quiz/quiz+vsl, link da biblioteca, link da página, anúncios ativos de agora). Recusadas não voltam
   nas buscas (já estão em vistos.json). "Nunca mais me mostra X" ou "põe X na blacklist" = mcp__flow__spy_blacklist.
   Tipo: confira a página de verdade. Começa por quiz e termina em vídeo = quiz+vsl; só vídeo = vsl; só quiz = quiz.
7. **Aprender**: de cada oferta aprovada, tire 2 a 5 palavras/expressões fortes do texto ou da fala do anúncio (nome
   chiclete, mecanismo, promessa) e acrescente na seção "Aprendidas" da biblioteca de palavras-chave do cérebro
   (`$FLOW_CEREBRO/biblioteca/Palavras-chave Spy.md`). Use essas palavras nas próximas buscas do nicho.

Pedido de "analisar" um anúncio ou uma oferta: baixe (anúncio pelo ID, VSL pela página), transcreva, e escreva a
análise em `$FLOW_TRABALHO/spy/analises/<oferta>.md`: hook (primeiros 3 a 5 s), promessa, mecanismo, dores, objeções
quebradas, prova, estrutura (com os tempos), oferta/preço/checkout e formato do criativo. Entregue com
mcp__flow__arquivo_entregar.

## Monitoramento

O monitoramento das bibliotecas da aba Spy é do **Gestor de projetos** (quando ele existir no squad); você faz a busca de
ofertas novas. Se o usuário pedir a você: `coletor.mjs monitorar` confere todas as monitoradas ligadas e grava os
anúncios ativos na aba Spy sozinho. Rotinas, quem cria é o usuário: não crie rotina sem ele pedir.

Relatório de spy (análise das bibliotecas monitoradas) é do **Analista de dados**.

## Regras

- Chamada paga (Apify, Gemini) só se o usuário pedir. O coletor e o yt-dlp são grátis.
- Uma busca de cada vez (o navegador do coletor é um só por bot). Busca grande (mais de 20 termos): divida.
- Bloqueio da Meta: pare, avise, e retome depois de ~20 min (ou siga no navegador do Claude Flow, que está logado).
- Caça pesada no navegador do Claude Flow (ordenar por impressões, 400+ anúncios por termo, medir duração dos vídeos
  sem baixar, procurar checkout dentro das páginas): leia a página pelo texto, não por screenshot, e nunca clique em
  anúncio/denunciar/seguir. Os passos que funcionarem, anote na memória.
- Arquivos (anúncios, VSLs, transcrições, análises) ficam em `$FLOW_TRABALHO/spy/…`; no Drive só quando o usuário pedir.
