---
name: vturb
description: Métricas das VSLs na VTurb pela Analytics API (só leitura) — lista os players e tira, de um player num período, views, plays, play rate, engajamento, retenção no primeiro minuto, retenção no pitch, cliques, conversões, taxa de conversão e faturamento, no total ou dia a dia. Use para relatório de criativo/VSL, "como está a retenção da VSL X", "conversão da página", cruzar com o Meta Ads.
---

# vturb

Chave: `VTURB_API_KEY` (o usuário cola em Conectores → VTurb; chega sozinha no ambiente). Fuso: America/Sao_Paulo.

```bash
V=.claude/skills/vturb/scripts/vturb.mjs
node $V players --nome "kellen"                                  # acha o player (id, duração, pitch)
node $V relatorio --player "<id ou nome>" --de 2026-11-01 --ate 2026-11-03
node $V dias --player "<id>" --de 2026-11-01 --ate 2026-11-07    # dia a dia (não some taxas entre dias)
node $V cota                                                     # uso da cota da API
```

`relatorio` devolve: `views` (aparelhos únicos que carregaram o player), `plays`, `play_rate` (%), `engajamento_medio`
(% do vídeo assistido em média), `retencao_1min` (% que passou do segundo 60, pela curva), `retencao_pitch` (% que
chegou no pitch; usa o pitch configurado no player ou `--pitch <segundos>`), `cliques_cta`, `conversoes`, `conversao`
(conversões ÷ plays, %) e `faturamento_brl`. `avisos` explica o que faltou (ex.: player sem pitch).

- Taxas já vêm em %; não some taxas de dias diferentes: para um período, rode `relatorio` com o período inteiro.
- Erro 401 = chave errada, assinatura inativa ou plano sem API; 429 = cota (o script espera e tenta de novo); 504 = período longo demais.
- Venda conta no dia do clique que levou a ela.
