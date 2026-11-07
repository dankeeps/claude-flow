# Conectores

Catálogo em `conectores/catalogo.json`. Cada bot liga só os que usa (Ajustes do bot › Conectores): cada conector a mais
são ferramentas a mais no contexto de todo turno.

## Pela conta claude.ai (sem configurar nada)

Gmail, Google Drive, Google Docs, Google Sheets, Google Agenda, Notion, Meta Ads (aparece como "Facebook") e
Higgsfield. São os conectores que você já autorizou em **claude.ai › Configurações › Conectores**; o Claude Code logado
nessa conta recebe todos sozinho. O Claude Flow bloqueia, por bot, os que estão desligados
(`--disallowedTools mcp__claude_ai_Gmail`, por exemplo).

Para acrescentar outro conector da conta: conecte em claude.ai e adicione uma entrada `"tipo": "claudeai"` no catálogo
com o `servidor` igual ao nome que aparece no CLI (`claude.ai <Nome>`).

Observação: esses conectores terminam de conectar alguns segundos depois do início do turno. Se o bot não enxergar as
ferramentas, ele usa `ToolSearch` (já está nas regras dele), que espera a conexão.

## Do próprio Claude Flow

- **Navegador** — o Chrome do Claude Flow pelo Playwright MCP. Veja [navegador.md](navegador.md).
- **Atlas** — só status e o botão "Ligar". O Bot Editor liga o Atlas com `mcp__flow__atlas_ligar`.

## Com chave (Conectores › campo da chave)

| conector | chave | onde pegar |
|---|---|---|
| Apify | `APIFY_TOKEN` | console.apify.com › Settings › API & Integrations |
| GitHub | `GITHUB_TOKEN` | github.com/settings/tokens (fine-grained) |
| Supabase | `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| ElevenLabs | `ELEVENLABS_API_KEY` | elevenlabs.io › Profile › API Keys (precisa do `uv`) |

As chaves ficam em `~/ClaudeFlow/segredos.env` (permissão só do seu usuário) e nunca voltam para o app. Para usar
um arquivo de chaves que você já tem (ex.: `~/octopus.env`), ponha o caminho em `segredosExtras` no
`~/ClaudeFlow/config.json`.

## Com login (OAuth)

**Vercel** usa login pelo navegador, que o modo automático do CLI não consegue abrir. Faça uma vez:

```bash
cd ~/ClaudeFlow/squads/<squad>/bots/<bot>
claude --mcp-config .flow/mcp.json
```

Dentro do Claude Code, `/mcp` › vercel › Authenticate. O login fica guardado e os turnos seguintes usam.

## Acrescentar um conector

Entrada nova em `conectores/catalogo.json`:

```json
{ "id": "meu-mcp", "nome": "Meu MCP", "grupo": "Outros", "tipo": "stdio",
  "comando": "npx", "args": ["-y", "pacote-do-mcp"], "env": { "CHAVE": "${MINHA_CHAVE}" },
  "segredos": [{ "nome": "MINHA_CHAVE", "rotulo": "Chave do Meu MCP" }], "descricao": "o que faz" }
```

`tipo` pode ser `stdio` (programa local; no Windows o `npx`/`uvx` ganha `cmd /c` sozinho) ou `http` (`url` e
`headers`). `${NOME}` é trocado pela chave salva.
