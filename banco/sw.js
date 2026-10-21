const C = 'mbanco-v10';
const ASSETS = ['./', './index.html', './login.html', './css/app.css', './js/app.js', './js/login.js', './js/api.js', './js/mercado.js', './js/openfinance.js', './js/ui.js', './js/config.js', './manifest.webmanifest', './icons/icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mbanco-') && k !== C).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /^\/(me|auth|oauth|payments|webhooks|health|bridge)/.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(C).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
