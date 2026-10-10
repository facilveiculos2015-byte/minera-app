/* Chat Minera — service worker do app só-chat (escopo /chat/).
 * Separado do sw.js do app completo: cache próprio (minera-chat-*), não mexe no cache "minera-shell-*".
 * Mesmas defesas contra cache HTTP do app: HTML e version.json sempre da rede (no-store),
 * JS/CSS/imagens revalidados (no-cache). Também recebe Web Push e abre a conversa dentro do /chat/.
 */
const CACHE = 'minera-chat-20261009ze';
const BASE = new URL('../', self.registration.scope).href; // raiz do site (https://minerapara.com.br/)

function isHtmlRequest(req) {
  if (req.mode === 'navigate' || req.destination === 'document') return true;
  try {
    const u = new URL(req.url);
    return /\.html(?:$|\?)/i.test(u.pathname) || u.pathname.endsWith('/');
  } catch (e) {
    return false;
  }
}

function semConexao() {
  return new Response('Sem conexão. Tente de novo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(['./manifest.webmanifest', './icon-192.png', './icon-512.png'].map((u) =>
        cache.add(new Request(u, { cache: 'reload' })).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('minera-chat-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\.(apk|aab|mp4|webm|mov)$/i.test(url.pathname)) return;

  if (/\/version\.json$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
        .catch(() => new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  if (isHtmlRequest(req)) {
    event.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin', redirect: 'follow' })
        .then((res) => (res.redirected && req.mode === 'navigate') ? Response.redirect(res.url, 302) : res)
        .catch(() => semConexao())
    );
    return;
  }

  let netReq;
  try { netReq = new Request(req, { cache: 'no-cache' }); } catch (e) { netReq = req; }
  event.respondWith(
    fetch(netReq)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || semConexao()))
  );
});

self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** URL da conversa dentro do Chat Minera: chat.html?para=… vira chat/?para=… */
function urlNoChat(u) {
  let alvo = self.registration.scope;
  try {
    if (u) {
      const abs = new URL(u, BASE);
      if (abs.origin === self.location.origin) {
        if (/\/chat\.html$/i.test(abs.pathname)) alvo = self.registration.scope + abs.search;
        else if (abs.href.indexOf(self.registration.scope) === 0) alvo = abs.href;
      }
    }
  } catch (e) { /* usa o /chat/ */ }
  return alvo;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = urlNoChat(event.notification.data && event.notification.data.url);
  const scope = self.registration.scope;
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

/* Web Push (Chat Minera fechado): mesmo payload do app ({ title, body, url, tag }).
 * Se alguma janela do Minera (chat ou app completo) estiver na tela, ela mesma avisa. */
// iPhone/iPad/Safari: TODO push precisa virar notificação (senão o iOS cancela a inscrição depois de 3)
const PUSH_SEMPRE_MOSTRA = /iPhone|iPad|iPod|Macintosh/.test((self.navigator && self.navigator.userAgent) || '') && !/Chrome|CriOS|Android/.test((self.navigator && self.navigator.userAgent) || '');
/* "Pedir senha ao abrir o Chat Minera" ligado (chat-trava.js grava no IndexedDB): a notificação não mostra quem mandou nem o texto. */
function ocultarPrevia() {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open('minera-chat', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('prefs'); } catch (e) { /* ignore */ } };
      rq.onerror = () => res(false);
      rq.onsuccess = () => {
        try {
          const db = rq.result;
          const g = db.transaction('prefs', 'readonly').objectStore('prefs').get('ocultarPrevia');
          g.onsuccess = () => { res(g.result === true); db.close(); };
          g.onerror = () => { res(false); db.close(); };
        } catch (e) { res(false); }
      };
    } catch (e) { res(false); }
  });
}
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  if (!d || typeof d !== 'object') d = {};
  const mostrar = (oculta) => self.registration.showNotification(oculta ? (d.chamada ? 'Chat Minera — ligação' : 'Chat Minera') : (d.title || 'Chat Minera'), {
    body: oculta ? (d.chamada ? 'Ligação de voz — toque para atender' : 'Nova mensagem') : (d.body || 'Nova mensagem'),
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'minera',
    renotify: true,
    silent: false,
    // ligação de voz (SQL 63): fica na tela até tocar/arrastar e vibra como chamada
    requireInteraction: !!d.chamada,
    vibrate: d.chamada ? [500, 250, 500, 250, 500, 250, 500] : [80, 40, 80],
    data: { url: urlNoChat(d.url) }
  });
  event.waitUntil(
    Promise.all([self.clients.matchAll({ type: 'window', includeUncontrolled: true }), ocultarPrevia()]).then(([list, oculta]) => {
      if (!PUSH_SEMPRE_MOSTRA && list.some((c) => c.visibilityState === 'visible' && c.focused !== false && !/\/gestor\//.test(c.url || ''))) return;
      return mostrar(oculta);
    }).catch(() => mostrar(true))
  );
});
