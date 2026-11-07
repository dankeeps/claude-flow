# Claude Flow

Bots persistentes do **Claude Code CLI** rodando no seu computador, organizados em **squads**, com memória que dura,
conectores (Gmail, Drive, Meta Ads…), **navegador próprio** e app de celular (**PWA com notificações**).

A ideia é a de um agente que "faz tudo" sozinho, só que sem computador alugado na nuvem e sem pagar token por fora:
cada bot é o próprio Claude Code, logado na **sua assinatura**, rodando na sua máquina. Processo só existe enquanto o
bot está trabalhando; parado, ele não gasta nada.

```
 celular (PWA) ─┐                       ┌─ Squad "Principal" ─────────────────────┐
 computador  ───┼─► Claude Flow ───────►│  🎬 Bot Editor   ✨ Bot Roteirista …    │──► Atlas (timeline)
 notificações ◄─┘   (servidor local)    │   conversam entre si; outro squad não   │──► Chrome do Claude Flow
                                         └─────────────────────────────────────────┘──► Gmail, Drive, Meta…
```

## O que tem

| | |
|---|---|
| **Bots em vez de sessões** | Cada bot tem nome, **função** ("inteligência matriz"), preferências, skills, conectores, modelo e pasta própria. "Sua função é…" / "atualize sua função" no chat → ele grava e vale para sempre. |
| **Squads** | Um squad é um time de bots que conversam entre si (`bot_enviar`, com ou sem esperar a resposta) e dividem um **quadro**. Um squad não enxerga o outro. Trava contra bots conversando em loop. |
| **Memória que dura** | Ideia do Hermes Agent: memória curta e curada pelo próprio bot (com limite de tamanho) + resumo de cada sessão + **busca no histórico inteiro** (SQLite FTS5). A sessão é **compactada** sozinha a cada 7 dias ou quando passa de 60% da janela; a transcrição bruta vira `.gz` e some depois de 30 dias. Detalhes em [docs/memoria.md](docs/memoria.md). |
| **Templates** | Na hora de criar um bot você escolhe o template e o nome. Já vem o **Bot Editor** (e o "Em branco"). |
| **Bot Editor** | Transcreve → corta → busca B-roll (YouTube Shorts / TikTok / biblioteca) → monta no modelo do Atlas → **sobe na timeline do Atlas sem renderizar**, com B-roll, legenda e efeitos sonoros em camadas. Render só quando você pedir. Vem com o Perfect Edit inteiro dentro. [docs/bot-editor.md](docs/bot-editor.md) |
| **Conectores** | Barra de conectores com Gmail, Google Drive, Docs, Sheets, Agenda, Notion, Meta Ads e Higgsfield (todos pela sua conta claude.ai, sem configurar), mais Navegador, Atlas, Apify, GitHub, Supabase, Vercel e ElevenLabs. Cada bot liga só os que usa. [docs/conectores.md](docs/conectores.md) |
| **Navegador próprio** | Um Chrome separado do seu, que abre no computador. Você entra nas contas (TikTok, YouTube, Meta…) uma vez e os bots usam. [docs/navegador.md](docs/navegador.md) |
| **PWA + notificações** | Instala no celular; avisa quando um bot termina, pede permissão, para com erro ou manda um aviso. Acesso de fora pelo **Tailscale**, sem expor o computador. [docs/pwa-e-celular.md](docs/pwa-e-celular.md) |
| **Autonomia** | "Total" (faz sem pedir) ou "Perguntar" (cada permissão vira um pedido no app/celular, com Permitir/Negar). |

## Instalar

**Windows** (o computador "de trabalho"):

```powershell
gh repo clone dankeeps/claude-flow; cd claude-flow
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

O instalador confere Node, Git, ffmpeg, yt-dlp, gh e o Claude Code (e diz o comando `winget` de cada um que faltar),
roda `npm install`, instala as ferramentas do Bot Editor (Perfect Edit + clone do Atlas), cria o atalho **Claude Flow**
na Área de Trabalho e, se você quiser, liga junto com o Windows.

**Mac/Linux:** `bash install.sh` (mesmos passos; o "ligar junto" vira um LaunchAgent).

Antes: rode `claude` uma vez no terminal e entre com a conta da assinatura. É essa conta que os bots usam.

Depois: `npm start` (ou o atalho) e abra **http://localhost:4400**. Diagnóstico a qualquer hora: `npm run check`.

## Usar

1. Na primeira vez já existe o squad **Principal** com o **Bot Editor**.
2. **+ Bot** → escolha o squad, o template e o nome. Em branco: diga a função no chat ("Sua função é…").
3. Anexe arquivos pelo **＋** do chat (vídeo bruto, roteiro). Eles vão para `~/ClaudeFlow/uploads/`.
4. ⚙︎ do bot: função, memória, preferências (fonte de B-roll, modelo do Atlas, render…), conectores, skills e sessão.
5. 💬 do squad: quadro do squad e a conversa entre os bots.
6. **Ajustes → Ativar notificações** em cada aparelho.

## Onde fica cada coisa

| caminho | o quê |
|---|---|
| `server/` | servidor Node (sem framework): API, tempo real (SSE), executor do CLI, memória, squads, push |
| `server/mcp/flow-mcp.js` | servidor MCP que cada bot recebe: squad, memória, função, quadro, histórico, notificar, entregar arquivo, navegador, Atlas |
| `web/` | o app (PWA): HTML/CSS/JS puros, service worker, manifest, ícones |
| `templates/editor/` | Bot Editor: função, instruções, memória inicial, preferências e as skills `perfect-edit` (cópia do repositório dankeeps/perfect-edit) e `broll-youtube` |
| `templates/em-branco/` | bot sem função |
| `conectores/catalogo.json` | catálogo de conectores (dá para acrescentar outros) |
| `scripts/` | diagnóstico, instalador do editor, ligar junto com o Windows/Mac |
| `~/ClaudeFlow/` | **seus dados** (fora do repositório): `config.json`, `segredos.env`, `usuario.md`, `flow.db`, `squads/<squad>/bots/<bot>/`, `navegador/`, `uploads/`, `lixeira/` |

O **Atlas** (Octo Edição) não está aqui: ele já fica em `~/Octo Edição/Atlas` (repositório dankeeps/Atlas-interno) e o
Claude Flow só liga o servidor dele e entrega os links da timeline (`localhost:4123/editor?p=<projeto>&v=A`).

Arquitetura completa (como um turno roda, arquivos de cada bot, API): [docs/arquitetura.md](docs/arquitetura.md).

## O que ainda não tem / falta conferir

- **Login**: não tem (combinado para depois). O servidor só escuta em `127.0.0.1`, recusa chamada de outro site
  aberto no navegador e só aceita hosts conhecidos; de fora, só pelo Tailscale (a sua rede privada).
- **Testado no Mac** (este repositório nasceu nele): bots, função, memória, compactação, conversa entre bots com espera,
  navegador próprio com Playwright, app no tamanho de computador e de celular. **Não testado ainda no Windows de
  verdade**, nem o push chegando num celular, nem uma edição completa do Bot Editor ponta a ponta pelo Claude Flow.
- Modo "Perguntar" (aprovação pelo app) usa a opção `--permission-prompt-tool` do CLI, que não aparece no `--help`:
  conferir no primeiro uso. O modo padrão "Total" não depende dela.
- Conectores Vercel (login OAuth) e os que pedem chave não foram testados.
- O Perfect Edit dentro de `templates/editor/skills/perfect-edit` é uma cópia: quando o repositório perfect-edit mudar,
  copie de novo (ver [docs/bot-editor.md](docs/bot-editor.md)).
