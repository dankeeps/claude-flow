---
name: hubla
description: Vendas, reembolsos, disputas (contestações) e chargebacks da Hubla pela API pública, só leitura — o check diário (vendas do dia + problemas novos desde o último check + pedidos de reembolso abertos), ou cada lista separada. Use para "teve reembolso?", "alguma disputa ou chargeback?", "quanto vendeu hoje?", conferência financeira diária.
---

# hubla

Token: `HUBLA_API_TOKEN` (o usuário cola em Conectores → Hubla; chega sozinho no ambiente). Só leitura: o script não
mexe em nada na Hubla.

```bash
H=.claude/skills/hubla/scripts/hubla.mjs
node $H resumo              # o check diário (guarda a hora do último resumo e só traz o que é novo)
node $H vendas --horas 24   # vendas pagas no período
node $H problemas --dias 30 # reembolsadas, em disputa e chargeback (pela data do problema)
node $H pedidos             # pedidos de reembolso abertos (created, pending, processing)
```

`resumo` traz: `vendas` (quantidade e total em R$), `novos.reembolsos`, `novos.disputas`, `novos.chargebacks` (cada um
com produto, valor, comprador, datas e campanha da UTM), `pedidos_de_reembolso_abertos`, `em_disputa_agora` e
`alerta` (true quando tem algo para o usuário ver). Valores em reais.

- Disputa na Hubla = status `in_protest` (contestação). Chargeback = `chargeback`.
- Limite da API: 60 req/s e 600 req/min por rota; o script espera sozinho se bater.
- 401 = token errado ou revogado (o usuário cria outro em Integrações → Tokens de API Pública).
