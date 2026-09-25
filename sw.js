/* Minera Pará service worker — shell cache + atualização garantida.
 * GitHub Pages manda cache-control: max-age=600. fetch() comum respeita esse
 * cache HTTP, então HTML/JS velhos podiam ficar até 10 min. Por isso:
 *  - navegações / HTML: fetch com cache 'no-store' (sempre rede)
 *  - JS/CSS/demais: cache 'no-cache' (revalida com ETag → atualiza na hora)
 *  - version.json: nunca cacheado (checagem de build do pwa.js)
 */
const CACHE = 'minera-shell-20260925c';
const PRECACHE = [
  './style.css?v=20260925c',
  './nav.js?v=20260925c',
  './config.js?v=20260925c',
  './pwa.js?v=20260925c',
  './lightbox.js?v=20260925c',
  './logo-escavadeira.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './og-familia.png',
  './manifest.webmanifest'
];

function isHtmlRequest(req) {
  if (req.mode === 'navigate') return true;
  if (req.destination === 'document') return true;
  try {
    const u = new URL(req.url);
    return /\.html(?:$|\?)/i.test(u.pathname) || u.pathname.endsWith('/');
  } catch (e) {
    return false;
  }
}

function offlineFallback(req) {
  return caches.match(req, { ignoreSearch: true })
    .then((cached) => cached || caches.match('./index.html'))
    .then((r) => r || new Response('Sem conexão. Tente de novo.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // version.json: sempre rede, nunca cache (HTTP nem SW)
  if (/\/version\.json$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
        .catch(() => new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // HTML / navegações: rede SEM cache HTTP; nunca grava no cache do SW.
  // Request de navigate não pode ser reconstruído com mode 'navigate' → usa a URL.
  if (isHtmlRequest(req)) {
    event.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin', redirect: 'follow' })
        .then((res) => {
          // Navegação tem redirect mode 'manual': resposta "redirected" quebraria
          // (ex.: /minera-app → /minera-app/). Devolve um redirect explícito.
          if (res.redirected && req.mode === 'navigate') return Response.redirect(res.url, 302);
          return res;
        })
        .catch(() => offlineFallback(req))
    );
    return;
  }

  // JS/CSS/imagens: revalida sempre (ETag/304 é barato), depois atualiza o cache do SW
  let netReq;
  try {
    netReq = new Request(req, { cache: 'no-cache' });
  } catch (e) {
    netReq = req;
  }
  event.respondWith(
    fetch(netReq)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => offlineFallback(req))
  );
});

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ---------- Notificações ----------
 * Toque na notificação (DM): foca uma aba aberta do app e navega para a conversa,
 * ou abre uma nova janela. data.url vem de MineraNotif.showBrowserNotif (nav.js).
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope; // ex.: https://…/minera-app/
  let target = scope + 'chat.html';
  try {
    const u = event.notification.data && event.notification.data.url;
    if (u) {
      const abs = new URL(u, scope);
      if (abs.origin === self.location.origin) target = abs.href;
    }
  } catch (e) { /* usa chat.html */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const same = list.filter((c) => c.url && c.url.indexOf(scope) === 0);
      const cli = same.find((c) => c.focused) || same[0];
      if (cli) {
        const nav = ('navigate' in cli) ? cli.navigate(target).catch(() => cli) : Promise.resolve(cli);
        return nav.then((c) => (c || cli).focus());
      }
      return self.clients.openWindow(target);
    })
  );
});

/* Web Push (app FECHADO) — ainda não ativo: exige chaves VAPID, salvar a PushSubscription
 * de cada usuário no Supabase e um envio no servidor (Edge Function / trigger em
 * chat_mensagens). Quando existir, o payload JSON { title, body, url, tag } chega aqui. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  if (!d || (!d.title && !d.body)) return;
  event.waitUntil(self.registration.showNotification(d.title || 'Minera Pará', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'minera',
    data: { url: d.url || './chat.html' }
  }));
});
