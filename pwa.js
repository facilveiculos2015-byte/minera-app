/* Minera Pará — PWA register + soft install (1×/semana) + notif ask once + welcome strip */
(function () {
  'use strict';

  var canRegister =
    'serviceWorker' in navigator &&
    (location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1');

  var ASSET_V = '20260923n';
  var RELOAD_FLAG = 'minera_reloaded_k';

  function forceAssetRefreshOnce() {
    try {
      if (localStorage.getItem('minera_asset_v') === ASSET_V) return;
      if (sessionStorage.getItem(RELOAD_FLAG) === '1') {
        try { localStorage.setItem('minera_asset_v', ASSET_V); } catch (e) {}
        return;
      }
      sessionStorage.setItem(RELOAD_FLAG, '1');
      localStorage.setItem('minera_asset_v', ASSET_V);
      var wipe = Promise.resolve();
      if (typeof caches !== 'undefined' && caches.keys) {
        wipe = caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }).catch(function () {});
      }
      var unreg = Promise.resolve();
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        unreg = navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        }).catch(function () {});
      }
      Promise.all([wipe, unreg]).then(function () {
        location.reload();
      }).catch(function () {
        location.reload();
      });
    } catch (e) {
      try { location.reload(); } catch (e2) {}
    }
  }

  if (canRegister) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('./sw.js?v=' + ASSET_V)
        .then(function () {
          forceAssetRefreshOnce();
        })
        .catch(function () {
          forceAssetRefreshOnce();
        });
    });
  } else {
    // Still bump asset marker offline / non-SW contexts once
    window.addEventListener('load', function () {
      try {
        if (localStorage.getItem('minera_asset_v') !== ASSET_V) forceAssetRefreshOnce();
      } catch (e) {}
    });
  }

  var deferredPrompt = null;
  var DISMISS_KEY = 'minera_pwa_install_dismissed_at';
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var NOTIF_ASK_KEY = 'minera_notif_asked';
  var WELCOME_KEY = 'minera_welcome_strip_seen';

  function dismissedRecently() {
    try {
      var ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (!ts) return false;
      return Date.now() - ts < WEEK_MS;
    } catch (e) {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
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
      '@media (min-width:720px){#minera-pwa-install{bottom:24px;left:auto;right:24px;margin:0}}' +
      '#minera-welcome-strip{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 14px;padding:12px 14px;' +
      'border-radius:14px;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155}' +
      '#minera-welcome-strip .w-txt{flex:1;min-width:140px;font-size:13px;color:#e2e8f0}' +
      '#minera-welcome-strip .w-txt strong{display:block;font-size:14px;color:#f8fafc;margin-bottom:2px}' +
      '#minera-welcome-strip .w-actions{display:flex;flex-wrap:wrap;gap:6px}' +
      '#minera-welcome-strip a{display:inline-flex;align-items:center;gap:4px;padding:7px 12px;border-radius:999px;' +
      'background:#f59e0b;color:#0f172a;font-weight:700;font-size:12px;text-decoration:none}' +
      '#minera-welcome-strip a.ghost{background:transparent;color:#94a3b8;border:1px solid #475569}' +
      '#minera-welcome-strip .w-close{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:18px;padding:4px 6px}';
    document.head.appendChild(s);
  }

  function showInstallBar() {
    if (document.getElementById('minera-pwa-install') || dismissedRecently()) return;
    if (!deferredPrompt) return;
    ensureStyles();
    var bar = document.createElement('div');
    bar.id = 'minera-pwa-install';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Instalar Minera Pará');
    bar.innerHTML =
      '<img src="icon-192.png" alt="" width="36" height="36">' +
      '<div class="pwa-txt"><strong>Instalar Minera Pará</strong><br><span style="color:#94a3b8;font-size:12px">Acesso rápido na tela inicial · pode fechar e ver de novo em 7 dias</span></div>' +
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
    if (!dismissedRecently()) showInstallBar();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    markDismissed();
    var el = document.getElementById('minera-pwa-install');
    if (el) el.remove();
  });

  /** Pedido de notificação uma vez (não bloqueia UI). */
  function maybeAskNotificationOnce() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'default') return;
      if (localStorage.getItem(NOTIF_ASK_KEY) === '1') return;
      localStorage.setItem(NOTIF_ASK_KEY, '1');
      setTimeout(function () {
        try { Notification.requestPermission(); } catch (e) {}
      }, 2500);
    } catch (e) {}
  }

  /** Faixa de boas-vindas pós-login: Marketplace / Serviços / Bank. */
  function showWelcomeStrip() {
    try {
      var path = location.pathname || '';
      if (!/inicio\.html$/i.test(path)) return;
      if (localStorage.getItem(WELCOME_KEY) === '1') return;
      var host = document.querySelector('.container.wide') || document.querySelector('.container');
      if (!host || document.getElementById('minera-welcome-strip')) return;
      ensureStyles();
      var root = typeof APP_ROOT === 'string' ? APP_ROOT : '/minera-app/';
      var strip = document.createElement('div');
      strip.id = 'minera-welcome-strip';
      strip.setAttribute('role', 'region');
      strip.setAttribute('aria-label', 'Atalhos de boas-vindas');
      strip.innerHTML =
        '<div class="w-txt"><strong>Bem-vindo ao Minera</strong>Escolha por onde começar — tudo no mesmo app.</div>' +
        '<div class="w-actions">' +
        '<a href="' + root + 'inicio.html">Marketplace</a>' +
        '<a href="#" id="welcome-svc" class="ghost">Serviços</a>' +
        '<a href="' + root + 'financeiro.html">Bank</a>' +
        '</div>' +
        '<button type="button" class="w-close" aria-label="Fechar">×</button>';
      var nav = document.getElementById('app-nav');
      if (nav && nav.parentNode) nav.parentNode.insertBefore(strip, nav.nextSibling);
      else host.insertBefore(strip, host.firstChild);
      strip.querySelector('.w-close').addEventListener('click', function () {
        try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
        strip.remove();
      });
      var svc = document.getElementById('welcome-svc');
      if (svc) {
        svc.addEventListener('click', function (ev) {
          ev.preventDefault();
          try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
          strip.remove();
          if (typeof abrirServicosPanel === 'function') abrirServicosPanel();
          else if (typeof toggleServicosPanel === 'function') toggleServicosPanel();
        });
      }
    } catch (e) {}
  }

  function bootGrowth() {
    showWelcomeStrip();
    maybeAskNotificationOnce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootGrowth);
  } else {
    setTimeout(bootGrowth, 0);
  }

  window.MineraPwa = {
    showInstallBar: showInstallBar,
    askNotificationOnce: maybeAskNotificationOnce,
    showWelcomeStrip: showWelcomeStrip
  };
})();
