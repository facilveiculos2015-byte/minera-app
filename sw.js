/* Minera Pará service worker — shell cache + atualização garantida.
 * GitHub Pages manda cache-control: max-age=600. fetch() comum respeita esse
 * cache HTTP, então HTML/JS velhos podiam ficar até 10 min. Por isso:
 *  - navegações / HTML: fetch com cache 'no-store' (sempre rede)
 *  - JS/CSS/demais: cache 'no-cache' (revalida com ETag → atualiza na hora)
 *  - version.json: nunca cacheado (checagem de build do pwa.js)
 */
const CACHE = 'minera-shell-20261004b';
const PRECACHE = [
  './style.css?v=20261004b',
  './chat-realtime.js?v=20261004b',
  './avatar.js?v=20261004b',
  './avatar-editor.js?v=20261004b',
  './nav.js?v=20261004b',
  './config.js?v=20261004b',
  './seguranca.js?v=20261004b',
  './pwa.js?v=20261004b',
  './lightbox.js?v=20261004b',
  './gestor.css?v=20261004b',
  './gestor-calc.js?v=20261004b',
  './gestor.js?v=20261004b',
  './logo-escavadeira.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './og-familia.png',
  './manifest.webmanifest'
];

/** Domínio novo: apaga caches e desregistra este SW (origem antiga só redireciona). */
function retireFromOldOrigin() {
  return caches.keys()
    .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .catch(() => {})
    .then(() => self.registration.unregister())
    .catch(() => {});
}

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
    .then((cached) => cached || caches.match('./entrar.html'))
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

  // APK/AAB do app Android: deixa o navegador baixar direto (não passa pelo SW nem ocupa cache)
  if (/\.(apk|aab)$/i.test(url.pathname)) return;
  // Vídeo (site/landing e convites): Range requests direto na rede, sem cache do SW
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return;

  // version.json: sempre rede, nunca cache (HTTP nem SW)
  if (/\/version\.json$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
        .then((res) => {
          try {
            if (res.redirected && new URL(res.url).origin !== self.location.origin) event.waitUntil(retireFromOldOrigin());
          } catch (e) { /* ignora */ }
          return res;
        })
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
          if (res.redirected && req.mode === 'navigate') {
            // Site mudou de origem (github.io/minera-app → minerapara.com.br): este SW ficou órfão
            // na origem antiga — remove a si mesmo e o cache para não servir app velho offline.
            try {
              if (new URL(res.url).origin !== self.location.origin) {
                event.waitUntil(retireFromOldOrigin());
              }
            } catch (e) { /* ignora */ }
            return Response.redirect(res.url, 302);
          }
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
  const scope = self.registration.scope; // ex.: https://minerapara.com.br/ (ou https://…github.io/minera-app/ no host antigo)
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

/* Web Push (app FECHADO / tela travada): enviado pela Edge Function send-push
 * (gatilho do SQL 54 em chat_mensagens). Payload JSON { title, body, url, tag }.
 * silent:false = som padrão de notificação do aparelho ("pim"). */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  if (!d || (!d.title && !d.body)) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // App aberto e na tela: o próprio app já avisa (toast + "pim") → não duplica
      if (list.some((c) => c.visibilityState === 'visible' && c.focused !== false)) return;
      return self.registration.showNotification(d.title || 'Minera Pará', {
        body: d.body || '',
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: d.tag || 'minera',
        renotify: true,
        silent: false,
        vibrate: [80, 40, 80],
        data: { url: d.url || './chat.html' }
      });
    })
  );
});
