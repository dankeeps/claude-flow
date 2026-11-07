---
name: baixar-do-drive
description: Baixa arquivos do Google Drive (vídeos brutos de GB, pastas inteiras) do jeito rápido - curl direto no endereço de download do Google, todos os arquivos ao mesmo tempo. Use sempre que o usuário mandar um link do Drive (pasta ou arquivo) e pedir para baixar, pegar os brutos, puxar os vídeos ou trazer os arquivos. Nunca use o download do conector do Drive para isso (ele devolve base64 e não aguenta vídeo grande).
---

# Baixar do Google Drive (rápido, em paralelo)

O método que o usuário usa e que funciona: nada de programa especial, só `curl`, um por arquivo, todos ao mesmo tempo.

## 1. Pegar o ID de cada arquivo

- **Link de pasta** (`drive.google.com/drive/folders/<ID>`): liste a pasta pelo conector do Google Drive
  (`search_files` com `parentId = '<id da pasta>'`). Ele devolve o nome e o ID de cada arquivo.
- **Link de um arquivo só** (`drive.google.com/file/d/<ID>/view`): o ID é o trecho entre `/d/` e `/view`.

## 2. Baixar direto pelo endereço de download do Google

```bash
curl -sL -o "IMG_3701.MOV" "https://drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t"
```

- `confirm=t` pula o aviso "não foi possível verificar vírus" que o Google mostra em arquivo grande.
- **Não** use o download do próprio conector (`download_file_content`): ele entrega o arquivo em base64 e não
  aguenta vídeo de GB.

## 3. Tudo ao mesmo tempo (o que deixa rápido)

Use o script desta pasta: ele confere o espaço em disco, testa o primeiro arquivo, abre um `curl` por arquivo,
todos em paralelo, espera o último terminar e confere se cada um é mesmo o arquivo (e não uma página de login).

```bash
node "<pasta desta skill>/baixar.mjs" "<pasta de destino>" "<ID1>=<nome1.MOV>" "<ID2>=<nome2.MOV>" ...
```

- A pasta de destino fica dentro da sua pasta de trabalho (`$FLOW_TRABALHO`), ou na pasta da tarefa. Nunca em
  Downloads ou na Área de Trabalho.
- O nome é opcional (`<ID>` sozinho usa o nome que o Google manda).
- A saída diz, para cada arquivo, o tamanho baixado e se deu certo.

Sem o script, faça o mesmo à mão: um `curl` por arquivo em segundo plano (`&`) e `wait` no fim.

## Limitação

Só funciona com link compartilhado como **"qualquer pessoa com o link"**. Se o compartilhamento for restrito, o
Google devolve a página de login no lugar do vídeo (o script avisa: "veio uma página, não o arquivo"). Aí diga ao
usuário que a pessoa precisa abrir o compartilhamento do link (ou mandar o arquivo de outro jeito). Não tente
entrar na conta para contornar.
