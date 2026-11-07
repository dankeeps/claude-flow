// Service worker do Claude Flow: guarda a casca do app para abrir rápido (a API é sempre da rede) e mostra as
// notificações push ("Bot Editor terminou", "pede permissão"…). Clicar na notificação abre o bot.
const CACHE = 'claude-flow-v3';
const CASCA = ['/', '/index.html', '/style.css', '/app.js', '/avatar.js', '/icones.js', '/manifest.webmanifest', '/icones/icone-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // rede primeiro (o app muda junto com o servidor); sem rede, a cópia guardada
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { titulo: 'Claude Flow', texto: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Claude Flow', {
    body: d.texto || '',
    tag: d.tag || 'claude-flow',
    renotify: true,
    icon: '/icones/icone-192.png',
    badge: '/icones/icone-192.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) {
      if (new URL(c.url).origin === location.origin) {
        c.postMessage({ tipo: 'abrir', url: alvo });
        return c.focus();
      }
    }
    return self.clients.openWindow(alvo);
  }));
});
