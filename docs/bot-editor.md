# Bot Editor

Template `templates/editor/`. Edita anúncio e VSL vertical e entrega **na timeline do Atlas**, sem renderizar.

## Fluxo

1. **Material** — expert/oferta (pasta de B-roll), roteiro (Drive/Docs) e o feedback do anúncio. Faltou? Ele pergunta
   no texto e espera.
2. **Transcrever e cortar** — Whisper local em blocos, conferindo com o roteiro: erros, tomadas repetidas e todo
   silêncio. Pela preferência **Corte do bruto**: proposta na timeline de corte do Atlas para você aprovar (padrão),
   corte direto, ou pular (vídeo já cortado).
3. **B-roll** — biblioteca primeiro (só disponíveis e estudados, da pasta do expert/oferta; usado não volta), depois a
   **Fonte de B-roll** da preferência:
   - **YouTube Shorts** (padrão): skill `broll-youtube` — busca com filtro Shorts, folha de capas, download um por vez,
     importação na biblioteca do Atlas.
   - **TikTok**: `tiktok.py buscar` do Atlas pela Apify (cobra por resultado).
   - Estudo dos clipes novos pelo Gemini (OpenRouter) conforme a preferência.
4. **Montar** — modelo do Atlas da preferência (padrão **Puro DR**): tela cheia, dividida e canto, legenda abaixo do
   pescoço, som sutil na entrada do B-roll; regras, densidade e prévias conferidas olhando os quadros.
5. **Entregar** — liga o Atlas (`mcp__flow__atlas_ligar`) e manda `http://localhost:4123/editor?p=<projeto>&v=A`, com
   B-roll, legenda e efeitos sonoros em camadas na timeline. **Não renderiza.**
6. **Ajustes e render** — pelo chat ("troca o B-roll 3", "renderiza"). O vídeo renderizado chega no app como arquivo
   (abre e baixa no celular).

## Preferências (Ajustes do bot › Preferências)

Fonte de B-roll · Modelo de edição no Atlas · Corte do bruto · B-rolls por minuto · Efeitos sonoros · Legenda ·
Renderizar · Estudo dos B-rolls novos pelo Gemini. Também mudam pelo chat ("a partir de agora usa TikTok").

## O que vem dentro

| caminho | o quê |
|---|---|
| `skills/perfect-edit/` | cópia do repositório **dankeeps/perfect-edit**: SKILL.md, `scripts/corte` (preparar, cortar, conferir, repetições, propor_atlas, vad), `scripts/edicao` (puro_dr, legenda_por_take, trilha, clone lado a lado, depoimentos, migrar biblioteca), `docs/` com **todas as regras de edição**, `skills/motion-vox`, instaladores Windows/Mac |
| `skills/broll-youtube/` | busca/download/importação de Shorts (versão geral das ferramentas de `~/Edições/_ferramentas-broll`) |
| `funcao.md` | o fluxo acima |
| `instrucoes.md` | o que muda por rodar dentro do Claude Flow (Atlas pelo `atlas_ligar`, perguntas no texto, entrega de arquivo) |
| `memoria.md` | regras de partida (B-roll sem texto, vertical na cheia/canto, legenda, VSL sem música…) |

## O que fica fora (já está no computador)

- **Atlas** (`~/Octo Edição/Atlas`, repositório dankeeps/Atlas-interno): timeline, motor, estilos, efeitos sonoros,
  `tiktok.py`, `gemini.py`, biblioteca. `npm run editor:instalar` clona se não existir.
- **Biblioteca de B-roll** (`~/Octo Edição/B-rolls`) e projetos (`~/Edições`): vídeos grandes demais para o GitHub.
- **Chaves** da Apify e da OpenRouter: Configurações do Atlas (`~/.config/estudio-edicao/chaves.json`).

## Instalar

```bash
npm run editor:instalar
```

Roda o instalador do Perfect Edit (Windows: `install.ps1`; Mac: `install.sh`): `.venv` do corte, clone do Atlas com a
`.venv` dele, modelos, atalhos das skills. Depois `npm run check`.

## Atualizar a cópia do Perfect Edit

Quando o repositório perfect-edit mudar, no Mac:

```bash
rsync -a --delete --exclude .git --exclude .venv --exclude __pycache__ ~/perfect-edit/ templates/editor/skills/perfect-edit/
```
