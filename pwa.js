/* Minera App — PWA register + discreet install prompt */
(function () {
  'use strict';

  var canRegister =
    'serviceWorker' in navigator &&
    (location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1');

  if (canRegister) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  var deferredPrompt = null;
  var DISMISS_KEY = 'minera_pwa_install_dismissed';

  function alreadyDismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch (e) {}
  }

  function ensureStyles() {
    if (document.getElementById('minera-pwa-style')) return;
    var s = document.createElement('style');
    s.id = 'minera-pwa-style';
    s.textContent =
      '#minera-pwa-install{position:fixed;z-index:9999;left:12px;right:12px;bottom:72px;max-width:420px;margin:0 auto;' +
      'display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;' +
      'background:#1e293b;color:#f8fafc;border:1px solid #334155;box-shadow:0 8px 24px rgba(0,0,0,.35);font:14px/1.35 system-ui,sans-serif}' +
      '#minera-pwa-install button{border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600}' +
      '#minera-pwa-install .pwa-go{background:#f59e0b;color:#0f172a}' +
      '#minera-pwa-install .pwa-no{background:transparent;color:#94a3b8}' +
      '#minera-pwa-install img{width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0}' +
      '#minera-pwa-install .pwa-txt{flex:1;min-width:0}' +
      '@media (min-width:720px){#minera-pwa-install{bottom:24px;left:auto;right:24px;margin:0}}';
    document.head.appendChild(s);
  }

  function showInstallBar() {
    if (document.getElementById('minera-pwa-install') || alreadyDismissed()) return;
    ensureStyles();
    var bar = document.createElement('div');
    bar.id = 'minera-pwa-install';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Instalar Minera App');
    bar.innerHTML =
      '<img src="icon-192.png" alt="" width="36" height="36">' +
      '<div class="pwa-txt"><strong>Instalar Minera App</strong><br><span style="color:#94a3b8;font-size:12px">Acesso rápido na tela inicial</span></div>' +
      '<button type="button" class="pwa-no" aria-label="Agora não">Agora não</button>' +
      '<button type="button" class="pwa-go">Instalar</button>';
    document.body.appendChild(bar);
    bar.querySelector('.pwa-no').addEventListener('click', function () {
      markDismissed();
      bar.remove();
    });
    bar.querySelector('.pwa-go').addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        markDismissed();
        bar.remove();
      });
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!alreadyDismissed()) showInstallBar();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    markDismissed();
    var el = document.getElementById('minera-pwa-install');
    if (el) el.remove();
  });
})();
