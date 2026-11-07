# Squads e bots

- **Bot** = o que antes era uma sessão do Claude Code, só que permanente: tem nome, função, memória, preferências,
  conectores, skills, modelo, navegador e pasta. Você conversa com ele pelo app (computador ou celular).
- **Squad** = um time de bots. Todo bot está num squad. Bots do mesmo squad se veem e conversam; **um squad não
  enxerga o outro** (nem pelo nome, nem pelo histórico, nem pelo quadro).

## Como os bots conversam

Ferramentas do servidor `flow` que cada bot recebe:

| ferramenta | o que faz |
|---|---|
| `squad_bots` | lista os colegas do squad, status e função |
| `bot_enviar(para, mensagem, aguardar)` | manda a mensagem para a fila do outro bot. `aguardar=true`: espera a resposta final dele (até 30 min) e recebe como resultado da ferramenta. `aguardar=false`: só entrega |
| `squad_quadro_ler` / `squad_quadro_escrever` | quadro compartilhado do squad (objetivo, combinados, status) |

Proteções:
- **Ciclo**: A esperando B e B tentando esperar A é recusado (B é orientado a mandar sem esperar).
- **Loop**: no máximo 8 mensagens seguidas entre bots sem você falar (`squad.maxCadeia`); passou disso, para e manda
  notificação.
- Tudo que um bot recebe de outro aparece no chat dele (com "↘ de @Fulano") e na **sala do squad** (💬).

Exemplo: no squad Kellen, você pede ao Bot Roteirista "escreve o K40 e manda para o @Bot Editor editar quando eu
gravar". O roteirista escreve, grava no quadro e, quando você manda o bruto ao editor, ele já sabe de onde veio o
roteiro.

## Templates

Pasta `templates/<id>/`:

| arquivo | para quê |
|---|---|
| `template.json` | nome, ícone, descrição, modelo, autonomia, conectores ligados, navegador, pastas extras, variáveis de ambiente e as **preferências** (campos que aparecem no ⚙︎ do bot) |
| `funcao.md` | função inicial (`{{nome}}` vira o nome do bot) |
| `instrucoes.md` | instruções técnicas que entram em toda sessão |
| `memoria.md` | fatos de partida |
| `CLAUDE.md`, `settings.json` | opcionais: vão para a pasta do bot |
| `skills/` | skills do template; cada bot recebe um atalho (não uma cópia) |

Para criar um template novo, copie `templates/em-branco`, mude o `template.json` e reinicie o servidor.
