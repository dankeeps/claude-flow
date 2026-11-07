# Arquitetura

## Peças

```
web/ (PWA)  ──HTTP + SSE──►  server/index.js ──► runner.js ──spawn──► claude -p (um processo por turno)
                                  │                                        │
                                  │◄──── /api/interno (token do bot) ◄──── server/mcp/flow-mcp.js (MCP stdio)
                                  │                                        ├── Playwright MCP ──CDP──► Chrome do Claude Flow
                                  │                                        └── conectores (claude.ai, stdio, http)
                                  ├── db.js (SQLite: mensagens + FTS5, turnos, push)
                                  ├── memoria.js (função, memória, resumos, compactação)
                                  ├── eventos.js (SSE, presença, web push)
                                  ├── agenda.js (compactação semanal, limpeza)
                                  └── atlas.js / navegador.js
```

Sem build e sem framework: Node 22.13+ (usa o SQLite embutido do Node), três dependências (`web-push`,
`cross-spawn`, `@playwright/mcp`).

## Um turno, do começo ao fim

1. Mensagem chega (`POST /api/bots/:id/mensagens`, de outro bot pelo `bot_enviar`, ou da agenda) e entra na **fila do
   bot**. Um turno por bot de cada vez; bots diferentes rodam em paralelo.
2. `runner.js` monta o turno:
   - **Sessão**: se o bot não tem sessão, cria um UUID (`--session-id`); se tem, `--resume <id>`.
   - **Começo de sessão** (`prompt.js` → `<bot>/.flow/sistema.md`, passado com `--append-system-prompt-file`): função,
     preferências, memória, perfil do usuário, squad e colegas, quadro, resumos das últimas sessões, conectores ligados
     e as regras do Claude Flow. É montado **uma vez por sessão** (foto congelada, para o cache do prompt continuar
     valendo); só remonta se você mexer em função/memória/conectores pelo app.
   - **MCP** (`conectores.js` → `<bot>/.flow/mcp.json`, `--mcp-config`): servidor `flow`, navegador e os conectores
     stdio/http ligados. Conectores claude.ai desligados viram `--disallowedTools mcp__claude_ai_<Nome>`.
   - **Permissão**: autonomia total = `--permission-mode bypassPermissions`; perguntar = `--permission-prompt-tool
     mcp__flow__aprovar` (cada pedido vira cartão no app e notificação).
   - `--model`, `--effort`, `--add-dir` (pastas de trabalho), `--include-partial-messages` (texto ao vivo).
3. O texto da mensagem vai pelo **stdin** (sem limite de tamanho de linha de comando no Windows).
4. A saída `stream-json` é lida linha a linha: texto ao vivo (`delta`), cada texto e cada ferramenta viram mensagem no
   banco e no app; `rate_limit_event` mostra o limite da assinatura na barra; o `result` fecha o turno (custo
   estimado, contexto ocupado).
5. Fim do turno: notificação "terminou" (se demorou mais de 20 s, veio de outro bot ou ninguém está olhando aquele
   bot), resposta para quem estava esperando (`bot_enviar` com `aguardar`) e, se passou do limite, **compactação**.

Bot parado não tem processo nenhum. O botão de parar mata o processo e os filhos dele (scripts Python que o bot abriu).

## Arquivos de cada bot

```
~/ClaudeFlow/squads/<squad>/
  squad.json               nome, descrição
  quadro.md                quadro do squad
  bots/<bot>/
    bot.json               modelo, autonomia, conectores, navegador, pastas, preferências, sessão atual, token
    funcao.md              função ("inteligência matriz")
    memoria.md             fatos duráveis (limite em caracteres)
    preferencias.md        preferências livres
    CLAUDE.md              lido pelo CLI (a pasta é o cwd do bot)
    .claude/settings.json  configurações do CLI só deste bot
    .claude/skills/        atalhos para as skills do template (a .venv fica num lugar só)
    .flow/                 sistema.md e mcp.json do turno (gerados)
    resumos/               um resumo por sessão compactada
    arquivo/               transcrições antigas do CLI em .gz
    trabalho/              arquivos de trabalho (screenshots do navegador etc.)
```

## Segurança (sem login, por enquanto)

- Servidor só em `127.0.0.1`. Acesso de fora: Tailscale (`tailscale serve`), que já entrega HTTPS e só para os seus
  aparelhos.
- Toda chamada que muda algo exige o cabeçalho `x-claude-flow: 1` (outro site aberto no navegador não consegue mandar,
  por causa do CORS) e a origem tem que ser a mesma; hosts aceitos: localhost, 127.0.0.1, `*.ts.net` e os do config.
- As ferramentas dos bots (`/api/interno`) exigem o token do bot; cada bot só enxerga o próprio squad.
- Chaves de API ficam em `~/ClaudeFlow/segredos.env` (permissão 600) e nunca voltam para o app.

## API (resumo)

`GET /api/estado` · `GET /api/eventos` (SSE) · squads `POST/PATCH/DELETE /api/squads[/:id]`, `GET /api/squads/:id/sala`,
`PUT /api/squads/:id/quadro` · bots `POST/PATCH/DELETE /api/bots[/:id]`, `GET|POST /api/bots/:id/mensagens`,
`POST /api/bots/:id/{parar,compactar,nova-sessao}`, `GET /api/bots/:id/arquivos`, `PUT /api/bots/:id/arquivos/:nome`,
`POST|DELETE /api/bots/:id/skills` · `PUT /api/upload?nome=` (corpo cru) · `GET /api/arquivo/:token` (com Range) ·
`GET /api/busca?q=` · `GET|PUT /api/usuario` · `PATCH /api/config` · `GET /api/custos` · `GET /api/conectores`,
`PUT /api/segredos` · `GET /api/navegador`, `POST /api/navegador/:perfil/{abrir,fechar}` · `POST /api/atlas/ligar` ·
`POST /api/aprovacoes/:id` · `GET /api/push/chave`, `POST /api/push/{inscrever,teste}` · `POST /api/presenca`.
