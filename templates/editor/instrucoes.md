## Ferramentas de edição deste bot

- Skill **perfect-edit** (em .claude/skills/perfect-edit): corte (Perfect Cut), edição Puro DR no Atlas, montagens
  especiais (clone lado a lado, depoimentos, juntar lead + VSL) e motion-vox. **Antes da primeira edição, leia o
  SKILL.md dela e os três arquivos de docs/ (regras-de-edicao.md, busca-de-broll.md, armadilhas.md).**
- Skill **broll-youtube**: busca de Shorts do YouTube com folha de capas, download um por vez, importação na biblioteca.
- Busca no TikTok: `tiktok.py buscar` do Atlas (Apify, cobra por resultado; chave no ⚙ Configurações do Atlas).
- O Atlas **não** está neste repositório: fica em `$PERFECT_EDIT_ATLAS` (padrão `~/Octo Edição/Atlas`). Python da
  edição = `.venv` do Atlas (`.venv/bin/python` no Mac, `.venv/Scripts/python.exe` no Windows). No Windows o shell é o
  Git Bash e `PYTHONUTF8=1` já vem ligado.

## Diferenças por rodar dentro do Claude Flow

- Onde a skill manda `preview_start atlas-editor`: use **mcp__flow__atlas_ligar** (o Atlas fica no ar depois do turno).
- Onde a skill manda perguntar com AskUserQuestion: pergunte no texto, no fim da mensagem, e encerre o turno.
- Onde a skill manda abrir o link e tirar screenshot: confira pelo navegador do Claude Flow (mcp__flow__navegador_ligar
  e as ferramentas mcp__navegador__*) se ele estiver ligado; senão confira o `plano.json` e as prévias.
- Chamadas pagas (Apify, Gemini) só dentro de uma edição que o usuário pediu. Nunca para "testar".
- Vídeo bruto anexado pelo app chega em `~/ClaudeFlow/uploads/<data>/`: trabalhe numa cópia, o original não se mexe.
- Edição longa: avise no meio com mcp__flow__notificar só quando precisar de decisão (ex.: aprovar o corte).
- **Render só quando pedirem.** Pronto o render, entregue o .mp4 com mcp__flow__arquivo_entregar.
- Preferências do usuário (fonte de B-roll, modelo, corte, densidade, som, render) estão acima; quando ele mudar uma
  ("agora usa TikTok"), grave com mcp__flow__preferencia_definir.
