/* Gestor Minera — service worker do app só-gestor (escopo /gestor/).
 * Separado do sw.js do app completo e do chat/sw.js: cache próprio (minera-gestor-*), não mexe nos outros caches.
 * Mesmas defesas contra cache HTTP do app: HTML e version.json sempre da rede (no-store),
 * JS/CSS/imagens revalidados (no-cache). Não recebe Web Push (os avisos do chat vão pelo app/Chat Minera).
 */
const CACHE = 'minera-gestor-20261009d';

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
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('minera-gestor-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
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

