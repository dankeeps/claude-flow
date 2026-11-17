## Ferramentas

- **HeyGen** (mcp__claude_ai_HeyGen__*, conta do Daniel, plano com créditos premium): upload de arquivo, tradução de vídeo
  e consulta. Gasta créditos do plano dele.
- **mcp__flow__arquivo_entregar**: entrega o vídeo traduzido no chat (com player).
- **mcp__flow__progresso**: avisa etapa concluída ("Vídeo enviado ao HeyGen", "Tradução em andamento").
- **ffprobe / curl** no bash.

## Idioma

As preferências trazem o **Idioma de destino** no formato `Nome em português · Nome do HeyGen`. Use o que vem depois do
"·" em `outputLanguages` (ex.: `Spanish (Latin America)`). Se a mensagem pedir outro idioma, use o da mensagem (confira o
nome exato com `list_video_translation_languages`, usando um que esteja em `available_on_current_plan`). Vários idiomas:
todos no mesmo `outputLanguages`.

## Passo a passo

1. **O vídeo.** Anexo ou caminho local: confira com `ffprobe` (duração, se tem áudio). Link público direto (https que
   baixa o arquivo): pode passar como `{type: "url", url}` e pular o passo 2. Link do Google Drive/Dropbox que abre
   página: baixe primeiro para `trabalho/entrada/`. Sem áudio ou sem fala: avise e não gaste crédito.
2. **Subir para o HeyGen.**
   - `create_asset_upload_batch` com `files: [{ filename, content_type: "video/mp4", size_bytes: <tamanho exato em bytes>,
     checksum_sha256: <sha256 em hex> }]` (`stat -c %s` e `sha256sum` no bash).
   - Envie o arquivo com curl usando o `upload_url` e **todos** os `upload_headers` devolvidos:
     `curl -s -o /dev/null -w "%{http_code}" -X PUT -T "<arquivo>" -H "content-type: video/mp4" -H "x-amz-checksum-sha256: <valor>" -H "x-amz-server-side-encryption: AES256" "<upload_url>"` (tem que dar 200).
   - `complete_asset_batch` e depois `get_asset_batch` a cada ~10 s até o item ficar `completed`; o `video_id` do item é o
     `asset_id`.
3. **Traduzir.** `create_video_translation` com `video: {type: "asset_id", asset_id}`, `outputLanguages: [idioma]`,
   `mode`: "speed" (preferência rápida) ou "precision" (preferência precisa), `disableMusicTrack`: true só se a
   preferência for tirar a música, `title`: "<nome do arquivo> · <idioma>". Avise com mcp__flow__progresso.
   Aqui não existe player do HeyGen: **não** chame `show_video`.
4. **Esperar.** `get_video_translation` a cada 30–60 s (`sleep 45` no bash entre as consultas) até ficar pronto. Leva
   mais ou menos de 1 a 3 vezes a duração do vídeo. Falhou: diga o motivo que o HeyGen deu e não tente de novo sozinho.
   Vários idiomas: use `bulk_video_translation_statuses` com todos os ids.
5. **Baixar e conferir.** Baixe o `video_url` com curl para
   `trabalho/entregas/traducoes/<nome-original>-<idioma-curto>.mp4` (ex.: `video-13-es.mp4`; nunca sobrescreva: se
   existir, use `-2`). Confira com ffprobe: tem áudio e a duração está perto da original.
6. **Entregar.** `mcp__flow__arquivo_entregar` com o vídeo e uma frase curta: idioma, duração, e os créditos premium que
   restam (`get_current_user`).

## Regras

- Gasta créditos do HeyGen do Daniel: traduza só o que ele pediu, uma vez. Refazer só se ele pedir.
- Nunca apague nada (nem no HeyGen, nem o vídeo original, nem traduções antigas).
- Não mude a fala: a tradução é fiel ao que a pessoa diz. Se ele quiser adaptar o texto (ex.: trocar uma gíria), avise que
  dá para passar um glossário (`brandGlossaryId`) ou uma legenda .srt revisada.
