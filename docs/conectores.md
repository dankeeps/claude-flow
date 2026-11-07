# Conectores

Catálogo em `conectores/catalogo.json`. A tela **Conectores** mostra a situação real de cada um (a conta claude.ai é
conferida com `claude mcp list` ao ligar e de 10 em 10 minutos, ou no botão "Verificar de novo") e, ao clicar, como
conectar, em quais squads usar e as outras contas.

**Quem escolhe é o squad:** todos os bots de um squad usam os mesmos conectores (Squad › Conectores do squad, ou no
painel do conector › Usado nos squads). Ligue só o que o squad usa: cada conector a mais são ferramentas a mais no
contexto de todo turno. Criar um bot de um template liga no squad o que o template precisa.

## Mais de uma conta do mesmo serviço

Conectores com `"multiContas": true` (Apify, GitHub, Supabase, ElevenLabs, Conta Google extra) aceitam outras contas:
painel do conector › Contas › Adicionar. Cada conta vira um conector próprio (`apify-2`, `google-conta-2`…), com
chave própria (salva como `APIFY_TOKEN__APIFY_2` em `segredos.env`) e ferramentas próprias (`mcp__apify-2__*`). As
contas ficam em `~/ClaudeFlow/contas.json`. Os bots recebem o nome de cada conta e escolhem a certa (ou perguntam).

Os conectores da conta claude.ai (Gmail, Drive…) são **uma conta por serviço**: é o claude.ai que conecta. Para outra
conta Google, use a **Conta Google extra** (abaixo).

### Conta Google extra (em teste)

Usa o servidor [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (Gmail, Drive, Docs, Sheets e
Agenda) rodando no computador, um por conta, cada um com o login salvo em `~/ClaudeFlow/contas/<conta>/`. Uma vez só:

1. Instale o uv: `winget install --id astral-sh.uv -e` (feche e abra o terminal).
2. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto (ex.: "Claude Flow").
3. Ative as APIs: Gmail, Google Drive, Google Calendar, Google Docs e Google Sheets (APIs e serviços › Biblioteca).
4. Tela de consentimento OAuth (Google Auth Platform): tipo **Externo**, status **Em teste**, e adicione como
   **usuários de teste** os e-mails das contas que vai usar.
5. Clientes › Criar cliente › tipo **App para computador** (Desktop). Copie o Client ID e o Client secret.
6. No Claude Flow: Conectores › Conta Google extra › cole o Client ID, o secret (valem para todas as contas Google
   extras) e o e-mail da conta › Salvar. Para mais contas: Contas › Adicionar, e só o e-mail.
7. Ligue a conta num squad. No primeiro uso o Google pede para entrar nessa conta pelo navegador; o aviso "app não
   verificado" é esperado (é o seu próprio projeto): Avançado › Ir para o app.

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
