/* Minera Pará — PWA register + soft install (1×/semana) + notif ask once + welcome strip + Baixar app */
(function () {
  'use strict';

  var canRegister =
    'serviceWorker' in navigator &&
    (location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1');

  var ASSET_V = '20260924a';
  var RELOAD_FLAG = 'minera_reloaded_' + ASSET_V;

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
        var u = new URL(location.href);
        u.searchParams.set('_hv', ASSET_V);
        location.replace(u.toString());
      }).catch(function () {
        try { location.reload(true); } catch (e3) { location.reload(); }
      });
    } catch (e) {
      try { location.reload(); } catch (e2) {}
    }
  }

  // Hard reset imediato quando o build muda (pedido permanente do Jhon)
  try { forceAssetRefreshOnce(); } catch (e) {}

  if (canRegister) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('./sw.js?v=' + ASSET_V)
        .then(function (reg) {
          try {
            if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            if (reg && reg.update) reg.update();
          } catch (e) {}
        })
        .catch(function () {});
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

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (typeof navigator.standalone === 'boolean' && navigator.standalone) return true;
      if (document.referrer && document.referrer.indexOf('android-app://') === 0) return true;
    } catch (e) {}
    return false;
  }

  function isIos() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
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
      '#minera-welcome-strip .w-close{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:18px;padding:4px 6px}' +
      '#minera-install-sheet-bg{position:fixed;inset:0;z-index:10050;background:rgba(2,6,23,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box}' +
      '@media (min-width:640px){#minera-install-sheet-bg{align-items:center}}' +
      '#minera-install-sheet{width:100%;max-width:420px;border-radius:18px 18px 14px 14px;padding:18px 16px 16px;' +
      'background:linear-gradient(160deg,rgba(30,41,59,.96),rgba(15,23,42,.98));border:1px solid rgba(245,166,35,.35);' +
      'box-shadow:0 20px 50px rgba(0,0,0,.45);color:#e2e8f0;font:14px/1.45 system-ui,sans-serif}' +
      '#minera-install-sheet h3{margin:0 0 6px;font-size:1.15rem;color:#f8fafc}' +
      '#minera-install-sheet .mis-sub{margin:0 0 14px;color:#94a3b8;font-size:13px}' +
      '#minera-install-sheet ol{margin:0 0 14px;padding-left:1.25rem;color:#cbd5e1}' +
      '#minera-install-sheet li{margin:6px 0}' +
      '#minera-install-sheet .mis-actions{display:flex;flex-wrap:wrap;gap:8px}' +
      '#minera-install-sheet .mis-go{flex:1;min-width:120px;border:0;border-radius:12px;padding:14px 16px;font-weight:700;font-size:16px;' +
      '#minera-install-sheet .mis-steps{display:flex;flex-direction:column;gap:10px;margin:0 0 14px}' +
      '#minera-install-sheet .mis-step{display:flex;align-items:center;gap:12px;padding:14px 12px;border-radius:14px;background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.35)}' +
      '#minera-install-sheet .mis-n{flex-shrink:0;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;background:#F5A623;color:#0f172a;font-size:16px}' +
      '#minera-install-sheet .mis-step strong{font-size:16px;color:#f8fafc}' +
      '#minera-install-sheet .mis-hint{font-size:13px;color:#94a3b8}' +
      '#minera-install-sheet .mis-one{margin:0 0 14px;padding:14px;border-radius:14px;background:rgba(30,41,59,.8);border:1px solid #334155;font-size:15px;line-height:1.4}' +
      'background:#F5A623;color:#0f172a;cursor:pointer}' +
      '#minera-install-sheet .mis-close{border:1px solid #475569;border-radius:12px;padding:12px 14px;background:transparent;color:#94a3b8;cursor:pointer;font-weight:600}' +
      '#minera-install-sheet .mis-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.02em;color:#F5A623;' +
      'background:rgba(245,166,35,.12);border:1px solid rgba(245,166,35,.35);border-radius:999px;padding:3px 10px;margin-bottom:10px}' +
      '.minera-install-banner{display:flex;align-items:center;gap:10px;margin:8px 0 12px;padding:12px 14px;border-radius:14px;' +
      'background:linear-gradient(135deg,rgba(245,166,35,.16),rgba(15,23,42,.55));border:1px solid rgba(245,166,35,.4);' +
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}' +
      '.minera-install-banner.oculto,.card-baixar-app.oculto,#btn-baixar-app-login.oculto{display:none!important}' +
      '.minera-install-banner .mib-ico{font-size:1.5rem;flex-shrink:0;line-height:1}' +
      '.minera-install-banner .mib-txt{flex:1;min-width:0;font-size:13px;color:#e2e8f0;line-height:1.35}' +
      '.minera-install-banner .mib-txt strong{display:block;color:#f8fafc;font-size:14px;margin-bottom:2px}' +
      '.minera-install-banner .mib-btn{flex-shrink:0;border:0;border-radius:999px;padding:9px 14px;font-weight:700;font-size:12px;' +
      'background:#F5A623;color:#0f172a;cursor:pointer}' +
      '.card-baixar-app .btn-baixar-app{width:100%;margin-top:4px}' +
      '.auth-baixar-app{display:block;width:100%;margin:12px 0 0;border:1px solid rgba(245,166,35,.45);border-radius:12px;' +
      'padding:11px 14px;background:rgba(245,166,35,.12);color:#F5A623;font-weight:700;font-size:14px;cursor:pointer;text-align:center}' +
      'html[data-theme="light"] .minera-install-banner{background:linear-gradient(135deg,rgba(245,166,35,.2),#fff);border-color:rgba(245,166,35,.5)}' +
      'html[data-theme="light"] .minera-install-banner .mib-txt,html[data-theme="light"] .minera-install-banner .mib-txt strong{color:#0f172a}' +
      'html[data-theme="light"] #minera-install-sheet{background:#fff;color:#0f172a;border-color:#F5A623}' +
      'html[data-theme="light"] #minera-install-sheet h3{color:#0f172a}' +
      'html[data-theme="light"] #minera-install-sheet .mis-sub,html[data-theme="light"] #minera-install-sheet ol{color:#475569}';
    document.head.appendChild(s);
  }

  function showInstallBar() {
    if (document.getElementById('minera-pwa-install') || dismissedRecently()) return;
    if (!deferredPrompt) return;
    if (isStandalone()) return;
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
        refreshInstallUi();
      });
    });
  }

  function closeInstallSheet() {
    var bg = document.getElementById('minera-install-sheet-bg');
    if (bg) bg.remove();
  }

  /** Fallback curto — só quando o prompt nativo ainda não chegou. */
  function installHelpContent() {
    if (isIos()) {
      return {
        badge: 'iPhone · Safari',
        title: 'Instalar Minera Pará',
        sub: 'Dois toques e o app fica na sua tela.',
        body:
          '<div class="mis-steps">' +
          '<div class="mis-step"><span class="mis-n">1</span><div><strong>Compartilhar</strong><br><span class="mis-hint">□↑ embaixo no Safari</span></div></div>' +
          '<div class="mis-step"><span class="mis-n">2</span><div><strong>Adicionar à Tela de Início</strong><br><span class="mis-hint">Depois toque em Adicionar</span></div></div>' +
          '</div>'
      };
    }
    if (isAndroid()) {
      return {
        badge: 'Android · Chrome',
        title: 'Instalar no celular',
        sub: 'Abra neste Chrome e toque de novo em Baixar app — o sistema instala sozinho.',
        body: '<p class="mis-one">Menu <strong>⋮</strong> → <strong>Instalar app</strong> (se o botão ainda não instalou).</p>'
      };
    }
    return {
      badge: 'Navegador',
      title: 'Instalar Minera Pará',
      sub: 'No Chrome/Edge, use o ícone ⊕ Instalar na barra de endereço.',
      body: ''
    };
  }

  function showInstallSheet(opts) {
    opts = opts || {};
    if (isStandalone() && !opts.force) {
      if (typeof toastMsg === 'function') toastMsg('App já instalado neste aparelho.');
      return;
    }
    // Se o prompt nativo chegou enquanto a UI abria, preferir um toque do sistema
    if (deferredPrompt && !opts.forceHelp) {
      promptNativeInstall().finally(refreshInstallUi);
      return;
    }
    ensureStyles();
    closeInstallSheet();
    var info = installHelpContent();
    var bg = document.createElement('div');
    bg.id = 'minera-install-sheet-bg';
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');
    bg.setAttribute('aria-label', 'Instalar Minera Pará');
    bg.innerHTML =
      '<div id="minera-install-sheet">' +
      '<span class="mis-badge">' + info.badge + '</span>' +
      '<h3>' + info.title + '</h3>' +
      '<p class="mis-sub">' + info.sub + '</p>' +
      (info.body || '') +
      '<div class="mis-actions">' +
      '<button type="button" class="mis-go" id="mis-ok">Pronto</button>' +
      '</div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (ev) {
      if (ev.target === bg) closeInstallSheet();
    });
    var btnOk = document.getElementById('mis-ok');
    if (btnOk) btnOk.addEventListener('click', closeInstallSheet);
  }

  function promptNativeInstall() {
    if (!deferredPrompt) return Promise.resolve({ outcome: 'unavailable' });
    var dp = deferredPrompt;
    deferredPrompt = null;
    dp.prompt();
    return dp.userChoice.finally(function () {
      markDismissed();
      var el = document.getElementById('minera-pwa-install');
      if (el) el.remove();
    });
  }

  /** Um toque: prompt nativo do Chrome/Android; senão sheet mínimo (iOS curto). */
  function baixarApp() {
    if (isStandalone()) {
      if (typeof toastMsg === 'function') toastMsg('Você já está no app instalado.');
      else alert('Você já está no app instalado.');
      return Promise.resolve({ outcome: 'already-installed' });
    }
    // Caminho principal: instalação do sistema (beforeinstallprompt)
    if (deferredPrompt) {
      return promptNativeInstall().then(function (choice) {
        refreshInstallUi();
        return choice || { outcome: 'prompted' };
      });
    }
    // Sem prompt ainda: iOS (sempre) ou Android aguardando critério do Chrome
    showInstallSheet();
    return Promise.resolve({ outcome: 'help-shown' });
  }

  function refreshInstallUi() {
    var installed = isStandalone();
    var nodes = document.querySelectorAll(
      '[data-minera-install-host], #card-baixar-app, #minera-install-banner, #btn-baixar-app-login, .minera-install-banner'
    );
    for (var i = 0; i < nodes.length; i++) {
      if (installed) nodes[i].classList.add('oculto');
      else nodes[i].classList.remove('oculto');
    }
    if (installed) {
      var bar = document.getElementById('minera-pwa-install');
      if (bar) bar.remove();
      closeInstallSheet();
    }
  }

  function bindDownloadButtons() {
    ensureStyles();
    refreshInstallUi();
    var candidates = document.querySelectorAll(
      '[data-minera-install], #btn-baixar-app, #btn-instalar-app, #btn-baixar-app-login'
    );
    for (var i = 0; i < candidates.length; i++) {
      var btn = candidates[i];
      if (btn._mineraInstallBound) continue;
      btn._mineraInstallBound = true;
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        baixarApp();
      });
    }
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!dismissedRecently()) showInstallBar();
    refreshInstallUi();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    markDismissed();
    var el = document.getElementById('minera-pwa-install');
    if (el) el.remove();
    closeInstallSheet();
    refreshInstallUi();
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
    bindDownloadButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootGrowth);
  } else {
    setTimeout(bootGrowth, 0);
  }

  window.MineraPwa = {
    showInstallBar: showInstallBar,
    askNotificationOnce: maybeAskNotificationOnce,
    showWelcomeStrip: showWelcomeStrip,
    baixarApp: baixarApp,
    promptInstall: baixarApp,
    showInstallHelp: showInstallSheet,
    isStandalone: isStandalone,
    bindDownloadButtons: bindDownloadButtons,
    assetV: ASSET_V
  };
})();
