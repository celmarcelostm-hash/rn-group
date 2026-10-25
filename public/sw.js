// Service worker do RN Group: notificações push e funcionamento offline básico.
const CACHE = 'rng-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// páginas: tenta a rede e cai no cache; arquivos do app: cache primeiro
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase e fontes vão direto
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })));
  }
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'RN Group', body: e.data?.text() || '' }; }
  const actions = data.itemId ? [{ action: 'adiar', title: 'Lembrar em 10 min' }, { action: 'abrir', title: 'Abrir' }] : [];
  e.waitUntil(self.registration.showNotification(data.title || 'RN Group', {
    body: data.body || '',
    tag: data.tag,
    renotify: !!data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/', itemId: data.itemId },
    actions,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = e.notification.data?.url || '/';
  if (e.action === 'adiar' && e.notification.data?.itemId) url = `/?item=${e.notification.data.itemId}&acao=adiar`;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === location.origin);
    if (open) { await open.focus(); open.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
