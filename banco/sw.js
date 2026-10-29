/* Antigo app instalável em /banco/ foi retirado: limpa caches e se desregistra. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const ks = await caches.keys();
  await Promise.all(ks.filter(k => k.startsWith('mbanco-')).map(k => caches.delete(k)));
  await self.registration.unregister();
  const cs = await self.clients.matchAll({ type: 'window' });
  cs.forEach(c => { try { c.navigate(new URL('../parceiro.html', self.registration.scope).href); } catch (_) {} });
})()));
