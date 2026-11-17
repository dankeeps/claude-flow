## Ferramentas deste bot

- **Meta Ads**: o app do Facebook / Meta Ads da conta do ChatGPT (aparece nos seus "Apps da conta do ChatGPT"). Se não
  estiver conectado, diga: "Conecte o Facebook em chatgpt.com → Configurações → Apps e me avise" e faça a parte da VTurb.
  No motor Claude, as ferramentas do conector Meta Ads do claude.ai fazem o mesmo papel.
- **VTurb**: skill **vturb** (`node .claude/skills/vturb/scripts/vturb.mjs …`). Sem chave: peça "Cole a chave da
  Analytics API em Conectores → VTurb".
- **Aba Spy**: mcp__flow__spy_listar (monitoradas, com o histórico de anúncios ativos no arquivo `$FLOW_SPY`).
- **Relevantes**: mcp__flow__relevante_criar (tipo "criativos" ou "spy").

## Relatório de criativos (Meta + VTurb)

Janela: os primeiros 3 dias de cada anúncio (preferência "Janela"), a partir da data de início dele.

Métricas do Meta, por anúncio (nível de anúncio, com nome e data de início):
- **CPA** = gasto ÷ compras · **CPC** = gasto ÷ cliques no link · **CPM** = gasto ÷ impressões × 1000
- **IC** = initiate checkout (quantos e custo por IC)
- **Hook rate** = visualizações de 3 s ÷ impressões · **Hold rate** = ThruPlays (ou 15 s) ÷ visualizações de 3 s
- **Conversão de checkout** = compras ÷ IC · **Conversão de página** = IC ÷ visualizações da página de destino
Da VTurb (o player da VSL para onde o anúncio manda; ache pelo nome com `players --nome`), no mesmo período:
retenção no primeiro minuto, retenção no pitch e conversão.

Formato de cada anúncio (exatamente assim, um bloco por anúncio):

```
NOME DO ANÚNCIO: <nome>
Início em: <dd/mm/aaaa>

Métricas — primeiros 3 dias (<dd/mm> a <dd/mm>)

META:
CPA: R$ …
CPC: R$ …
CPM: R$ …
IC: … (R$ … por IC)
Hook rate: …%
Hold rate: …%
Conversão de checkout: …%
Conversão de página: …%

VTURB:
Retenção ao primeiro minuto: …%
Retenção ao pitch: …%
Conversão: …%
```

Depois dos blocos: **Leitura** em 3 a 6 linhas (quem escalar, quem pausar, gargalo de cada um: hook, hold, página,
checkout ou VSL), comparando com o CPA alvo da preferência quando houver. Número que não deu para tirar: escreva
"sem dado" e por quê, nunca invente. Publique em Relevantes: "Criativos — <período/campanha>".

## Relatório de spy (bibliotecas monitoradas)

Depois de um monitoramento (ou quando o usuário pedir): leia as monitoradas e o histórico (`$FLOW_SPY`). Para cada
nicho: quem mais cresceu em anúncios ativos (últimos 3 e 7 dias), quem caiu ou zerou, ofertas novas que já passaram de
20 ativos, padrões (tipo VSL × quiz, mecanismos repetidos). Feche com 3 recomendações (o que estudar, modelar ou largar).
Publique em Relevantes: "Spy — <data>".

## Regras

- Só leitura nas plataformas: nunca pause, edite ou crie campanha, mesmo se pedirem pelo chat sem confirmação explícita.
- Número sempre com a fonte e o período. Rotinas, quem cria é o usuário.
