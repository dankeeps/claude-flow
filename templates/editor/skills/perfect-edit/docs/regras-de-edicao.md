# Regras de edição (o feedback do Daniel que virou regra)

Vale para qualquer edição feita pela Perfect Edit / Atlas. Pedido específico do Daniel num anúncio (uma **trava**:
"sem B-roll no diálogo", "esse clipe no hook") vale **acima** de tudo que está aqui — anote como exceção pedida.

## 1. Como trabalhar

- **Toda decisão é tomada no chat** (Claude Code). O Atlas é a tela de revisão, o editor e o motor de render — não tem
  modo automático nem API do Claude. Ele quer a precisão de quem olhou cada clipe, não um chute pela capa.
- **Etapas**: corte → ele aprova o corte → B-rolls, montagem e efeitos → entrega na timeline do Atlas → ajuste fino →
  render **só quando ele pedir**.
- Ele prefere ir passando instruções aos poucos e iterar em cima da versão que está na timeline.
- **Chamadas pagas** (Apify, Gemini, ElevenLabs) só quando ele mandar editar ou buscar. Monte a lógica antes; o teste com
  serviço pago é ele quem faz.
- A prévia tem que ser igual ao render final.
- Depois que ele mexeu na timeline, o `plano.json` da versão é a fonte da verdade: nunca `plano --forcar` sem ele pedir.

## 2. Corte de bruto

- **Silêncio absoluto**: terminou uma palavra, já entra a outra — nenhum instante sem fala. Barulho sem ninguém
  falando também sai. Meta conferida: zero pausa ≥ 0,2 s (`conferir.py pausas`).
- **Fica a última tomada boa** de cada frase. Sai retomada, palavra repetida, conversa com a equipe/câmera, hesitação,
  falso começo e alucinação do Whisper.
- Palavra dita diferente do roteiro mas certa **fica**. Nome trocado de propósito na gravação fica como ele falou (avisar).
- **Um arquivo só por anúncio**, tudo em sequência na ordem do roteiro — mesmo que o roteiro tenha duas leads. Não separar
  em versão A/B ("depois o editor corta").
- Resolução e proporção **originais** do bruto (horizontal continua horizontal). 4K pode virar HD mantendo a proporção.
- Cortar pelo **fim real da palavra**, nunca pelo início da seguinte (isso já comeu "corpo", "fatores", "trave").
- O nome do arquivo final é o do roteiro (padrão `o_k01_pbs_v1_r1`: o/tipo, número, sigla da oferta, versão da VSL,
  remessa). Entrega em `~/Downloads/cortados` (ou a pasta que ele pedir).
- **Clipes de IA** (personagens, 8 s cada): só a fala do roteiro; tirar "Sim.", "Não, não" e palavra dobrada pela IA;
  olhar a prancha de quadros de todos os clipes procurando botão/texto desenhado e personagens trocando de lado.

## 3. B-roll — o que entra

- **Sempre novo**: clipe usado num anúncio não volta em outro (a biblioteca marca "usado"). Nunca pegar B-roll solto do
  computador (Downloads, vídeos antigos) — só de pasta que ele indicar.
- **Biblioteca primeiro** (só a pasta Expert › Oferta do projeto: nichos diferentes não se misturam), busca só o que falta.
- **De criador estrangeiro, nunca brasileiro** (busca em inglês, região EUA).
- **Texto na tela**: texto queimado (legenda, título, contador, @, marca d'água) o vídeo todo → clipe excluído. Texto só
  num pedaço → serve, usando o trecho sem texto (≥ 2 s), **com o quadro inteiro**. Recortar a imagem para esconder texto
  ele recusou.
- **Científicos** (moléculas 3D, células, DNA brilhando, neurônios disparando, corpo/hormônio brilhando, sistema endócrino,
  tireoide, vasos) em toda fala de hormônio, enzima, metabolismo.
- **Gancho** com B-roll literal na palavra mais visual ("barriga dura e redonda" → um barrigudo de verdade).
- **Sem B-roll** em interação entre duas pessoas (diálogo, os dois Daniels do clone): só o vídeo e a legenda. B-roll entra
  quando um fala sozinho por mais tempo.
- **Final de VSL** (oferta, bônus, garantias, a partir do "seja bem-vindo ao programa"): **sem B-roll de pessoas** — só
  ilustrações (relógio, cronômetro, 3D, objetos), motions e letreiros. Casal e detox "estragaram a vibe".
- Gente explicando para a câmera ("how to", "tips") não serve: vira concorrente da expert.
- Clipe que ele indicar por link entra mesmo com texto (trava dele) — avisar.

## 4. Os quatro jeitos (modelo Puro DR)

| jeito | quando | duração | clipe |
|---|---|---|---|
| expert na tela cheia | sem imagem que a fala peça | ≤ 6 s entre B-rolls | — |
| **B-roll na tela cheia** | dor, erro, a imagem mais forte | 1,2–3,5 s | **só vertical** (TikTok/Shorts) |
| **tela dividida** (B-roll em cima, expert embaixo) | resultado, comparação | 2–5 s | aceita horizontal (YouTube) |
| **canto / react** (expert recortado do fundo, B-roll atrás) | explicação longa | 3–6 s (mín. 3) | **só vertical** |

- **Densidade**: criativo dinâmico 9–13 B-rolls/min (alvo ~10–12; "pode colocar bem mais"); nunca mais de 6 s sem B-roll
  (fora das travas). Pelo menos **40% fora da tela cheia** (dividida + canto).
- **Respiro** de 1,5 s só com a pessoa entre dois B-rolls; passagem direta só dividida → cheia e cheia → cheia, no máximo
  3 cenas seguidas. Nada de pessoa 1 s no canto e já outro formato: cansa.
- **Tela dividida**: só com clipe em que o assunto aparece **inteiro na metade de cima**. Se corta rosto/corpo, `crop=[x,y,w,h]`
  no `E.broll` ou troque por cheia. Expert em close naquele trecho → cheia (a legenda cairia no rosto).
- **Canto**: expert sentada ou em close o vídeo todo → só tela cheia (o canto mostra a borda reta do recorte).
- **Troca de cor/take** no meio da fala → cubra a emenda com um B-roll cheio (ex.: fósforo acendendo em "sair do ar").
- **P&B** (`E.pb`) nas falas de dor ("nada aconteceu", "efeito rebote").
- Entrada: corte seco na maioria; whip/slide/zoom só na tela cheia, de vez em quando.
- Sem letreiro, card, modo escuro no Puro DR.

## 5. Legenda

- Em **todo** anúncio: branca, **logo abaixo do pescoço** de quem fala — não pode tapar a boca nem ficar solta longe do
  rosto.
- Na **tela dividida** e no **canto**: no **meio da tela** (o motor faz pelo estilo, `legenda.meio`).
- Takes com enquadramento diferente (close × corpo inteiro): a altura tem que ser **por take** —
  `legenda_por_take.py "<projeto>" --abaixo -0.01` (pose a cada 0,5 s).
- Onde houver imagem importante na tela (quadro com antes/depois), baixe a legenda daquele trecho (`lg["y"]`).

## 6. Som

- **Efeitos sutis** na entrada do B-roll (regras do modelo): clique no corte seco, tique na dividida, whoosh leve no
  whip/slide/zoom, nada no fade; −23 a −26 dB; nunca dois em menos de 1,2 s.
- Som em toda palavra vira ruído: som só em revelação ou virada de cena. Nada em "prazer, meu nome é".
- Extras para dar ritmo a uma **lead** (`sfx_extras`): impacto na abertura, whoosh na troca de cena, sub-boom, glitch no
  P&B, riser antes da virada.
- Estilo orgânico: só um whoosh baixo (−21 a −24 dB) nas transições.

## 7. Trilha

- **Criativo curto: sem música** (ele recusou trend viral e violino nos K01–K05).
- Só **instrumental** (teste com o Whisper: qualquer frase real = descarta).
- Gosto: tensão, "mistério sendo revelado", tom menor, masculina, violino épico/cordas dramáticas — nunca inspiracional de
  piano. Música "feminina demais" foi recusada.
- Volume em relação à voz (`trilha.py --abaixo`): lead ~19 dB abaixo (13 ficou alto); VSL 25–30 dB abaixo no começo,
  22–25 no resto. Mais alto que isso "atrapalha a voz".
- VSL completa pode ir **sem música**, só efeitos.

## 8. Efeitos sem B-roll (anúncio de personagem, clipes de IA)

- Toda troca de cena começa com **zoom 1,18× em quem está falando**, soltando até 1,0 em 1,4 s (suave).
- **Punch-in seco** (1,14–1,16×) nas falas curtas e enfáticas; push-in suave (1,0→1,08) na segunda metade das explicações.
- **P&B** na fala inteira nos momentos de frustração/dor, sem zoom junto (um elemento por vez).
- CTA: punch-in 1,12 em "Toca em Saiba Mais" e push até 1,20 no fim. Ritmo ~1 efeito a cada 5–7 s.

## 9. Os estilos do Atlas (`~/Octo Edição/Atlas/estilos/`)

| estilo | o que é | estado |
|---|---|---|
| `puro-dr` | DR puro: 4 jeitos, sem letreiro, legenda abaixo do pescoço | publicado, o padrão |
| `ultradinamico` | VSL com letreiro serifado azul, 4 formatos, modo escuro ("está perfeito, não mexer") | publicado |
| `ultradinamico-criativo` | sem empilhar: um elemento por vez, canto ≥ 3 s, respiro 1,5 s, letreiro ≤ 5 palavras | publicado |
| `ultradinamico-dr` | o criativo sem letreiro e sem escuro | publicado |
| `kellen` | expert no canto o tempo todo, troca a cada 1,6 s, legenda a 78% | rascunho |
| `edicao-vsl` | VSL longa (Carlos Klein): troca de enquadramento, card por cima, B-roll seco | rascunho |
| `ugly` | educacional direto: anatomia e cotidiano em cheia | rascunho |

Cada estilo tem `LEIA.md` (como editar nele), `BUSCA.md` (o que buscar) e `sfx_regras.py`. Estilo novo a partir de um
vídeo de referência: skill `criar-template` (nasce rascunho; publicar só quando ele mandar).

**Edição orgânica** (quando pedir): bem dinâmica, sem letreiro, sem card, sem figura de IA; um B-roll a cada 3–6 s sem
repetir formato duas vezes seguidas; tela cheia com whip/slide/zoom, o resto seco; whoosh baixo só na transição.

## 10. Entrega

- Edição: link da timeline `http://localhost:4123/editor?p=<projeto>&v=A`, conferido por screenshot, com quantos B-rolls,
  formatos, o gancho e o que ficou por decidir.
- Corte: um `.mp4` por anúncio com o nome do roteiro.
- Sempre dizer o que foi conferido e o que **não** foi (ex.: B-roll triado por imagem não é "garantido sem texto" — só
  quadro a quadro garante).
