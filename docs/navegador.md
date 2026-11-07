# Navegador do Claude Flow

Um Chrome (ou Edge/Chromium) **separado do seu navegador pessoal**, com perfil próprio em `~/ClaudeFlow/navegador/`,
aberto com a porta de controle (CDP) só em `127.0.0.1`. A janela aparece no computador: você vê o bot navegando.

## Conectar contas

1. App › 🌐 **Navegador** › **Abrir** (perfil Principal). Abre a janela no computador.
2. Entre nas contas que os bots vão usar: TikTok, YouTube, Instagram, Biblioteca de Anúncios, o que for.
3. Pode fechar. O login fica guardado no perfil; da próxima vez que um bot abrir, já está logado.

## Como o bot usa

- O bot precisa do conector **Navegador** ligado (o Bot Editor já vem com ele).
- No turno, o bot chama `mcp__flow__navegador_ligar` (abre a janela se estiver fechada) e usa as ferramentas
  `mcp__navegador__*` do Playwright MCP (navegar, clicar, digitar, ler a página, screenshot), conectado à mesma janela.
- Screenshots e arquivos do navegador vão para `<bot>/trabalho/navegador/`.

## Perfis

- **Principal**: compartilhado pelos bots que estão com navegador "Principal".
- **Próprio**: ⚙︎ do bot › Preferências › Navegador › Próprio. Perfil e porta só daquele bot (contas separadas e
  trabalho em paralelo sem um bot mexer na aba do outro).

## Configuração

- Navegador usado: o primeiro encontrado entre Chrome, Edge, Chromium e Brave. Para escolher:
  `"navegador": { "chrome": "C:\\caminho\\chrome.exe" }` no `~/ClaudeFlow/config.json`.
- Portas: 9330 (Principal) e 9331+ (próprios), sempre em 127.0.0.1.
- Regras dos bots: nunca sair das contas nem trocar senha; o Claude Flow não digita senha por eles. Login é sempre
  você quem faz, na janela.
