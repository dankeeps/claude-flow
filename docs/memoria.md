# Memória dos bots

Objetivo: o bot lembra do que importa por meses, sem a sessão ficar pesada e sem encher o disco.
A ideia veio do Hermes Agent (memória curta, curada pelo próprio agente, mais busca no histórico) e foi adaptada ao
Claude Code CLI.

## As camadas

| camada | onde | quem escreve | entra em toda sessão? |
|---|---|---|---|
| **Função** | `funcao.md` | você ("sua função é…") ou o bot (`funcao_atualizar`) | sim |
| **Preferências** | `bot.json` (as do template) + `preferencias.md` | você no ⚙︎ ou o bot (`preferencia_definir`) | sim |
| **Memória** | `memoria.md`, até 6.000 caracteres | o bot, na hora (`memoria_adicionar/substituir/remover`) | sim |
| **Sobre você** | `~/ClaudeFlow/usuario.md`, até 3.000, todos os bots | você ou qualquer bot (`usuario_atualizar`) | sim |
| **Quadro do squad** | `squads/<squad>/quadro.md` | você ou os bots do squad | sim |
| **Resumos** | `resumos/*.md`, um por sessão encerrada | o bot, na compactação (`sessao_resumir`) | os 3 últimos |
| **Histórico** | `flow.db` (SQLite + FTS5) | automático: toda mensagem | não; o bot busca com `historico_buscar` |
| **Sessão do CLI** | `~/.claude/projects/...jsonl` | o Claude Code | é a conversa em andamento |

A memória tem limite de propósito: quando enche, a ferramenta recusa e pede para o bot consolidar (juntar fatos
parecidos, tirar o que não vale mais). É isso que mantém a memória útil em vez de virar um depósito.

## Compactação

Uma sessão do CLI cresce a cada turno. Ela é encerrada e trocada por uma nova quando:
- passa de **60%** da janela de contexto (ajustável), ou
- tem mais de **7 dias** e o bot está parado há 1 hora (a agenda confere a cada 30 min), ou
- você aperta **🗜 Compactar agora** (⚙︎ do bot › Sessão).

O que acontece:
1. O bot recebe um turno especial: guardar na memória o que vale, atualizar o perfil do usuário se for o caso e
   escrever o resumo da sessão (feito, pendente, arquivos, próximo passo).
2. A transcrição bruta da sessão sai de `~/.claude/projects/` e vira `arquivo/<sessão>.jsonl.gz` (~10x menor).
3. A próxima mensagem abre uma sessão nova, que já começa com função + memória + resumos.

Nada se perde: o texto de todas as conversas continua pesquisável no banco.

## Espaço em disco

- Transcrições `.gz` são apagadas depois de 30 dias (`memoria.manterTranscricoesDias`).
- Mensagens no banco ficam 180 dias (`memoria.manterMensagensDias`); o banco é otimizado aos domingos.
- O próprio Claude Code apaga transcrições antigas sozinho (`cleanupPeriodDays`, padrão 30 dias).
- Bot parado não tem processo: não ocupa memória RAM.

Todos esses números ficam em `~/ClaudeFlow/config.json` (e os principais em Ajustes).
