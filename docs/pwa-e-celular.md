# App no celular e notificações

O app é um PWA: abre no navegador e instala como aplicativo. Notificação push precisa de **HTTPS**, e o servidor do
Claude Flow só escuta em `127.0.0.1` (o computador não fica exposto no Wi-Fi). O jeito de juntar as duas coisas é o
**Tailscale**: uma rede privada só entre os seus aparelhos, que já dá um endereço HTTPS.

## Uma vez só

1. Instale o Tailscale no computador do Claude Flow e no celular (mesma conta): tailscale.com/download.
2. No computador, deixe o Claude Flow disponível só na sua rede Tailscale:

   ```bash
   tailscale serve --bg 4400
   ```

   Ele mostra o endereço, algo como `https://meu-pc.tail1234.ts.net`. (Na primeira vez o Tailscale pede para ligar o
   HTTPS na conta: siga o link que ele mostrar.)
3. No app, **Ajustes › Endereço do Claude Flow fora do computador**: cole esse endereço (é o link que vai nas
   notificações).
4. Para abrir o **Atlas** pelo celular também:

   ```bash
   tailscale serve --bg --https=8443 4123
   ```

   e cole `https://meu-pc.tail1234.ts.net:8443` em **Ajustes › Endereço do Atlas fora do computador**. Os links
   `localhost:4123` que o Bot Editor manda passam a abrir pelo celular.

`tailscale serve` (com **serve**, não **funnel**) só responde para aparelhos da sua conta Tailscale. Nada fica aberto
na internet.

## Instalar no celular

- **iPhone**: abra o endereço no **Safari** › Compartilhar › **Adicionar à Tela de Início**. Abra pelo ícone (a
  notificação só funciona no app instalado, iOS 16.4+). Depois **Ajustes › Ativar notificações**.
- **Android**: abra no Chrome › menu › **Instalar app** (ou o botão "Instalar o app" em Ajustes) › **Ativar
  notificações**.

## Quando chega notificação

- ✅ **terminou**: o turno durou mais de 20 s, veio de outro bot/da agenda, ou ninguém está com aquele bot aberto na tela.
- ⚠️ **parou com erro**.
- 🔐 **pede permissão** (bot no modo "Perguntar"): toque, veja o pedido e Permitir/Negar.
- ⏸ **conversa entre bots pausada** (passaram de 8 mensagens seguidas sem você).
- Avisos que o próprio bot manda no meio de um trabalho longo (`mcp__flow__notificar`).

Se você está olhando o chat daquele bot na tela, a notificação não vem (você já está vendo).

## Login

Ainda não tem: quem está na sua rede Tailscale abre o app. Quando fizer o login, ele entra no `server/index.js`
(antes das rotas `/api/`).
