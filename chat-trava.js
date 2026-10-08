/* Minera Pará — "Pedir senha ao abrir o Chat Minera" (só no PWA /chat/ instalado).
 * Padrão: DESLIGADO → abre na lista/conversa enquanto a sessão Supabase estiver válida, igual ao WhatsApp.
 * Ligado: pede a senha da conta (reautenticação Supabase; a senha NÃO fica gravada). Preferência por uid no localStorage.
 * No app completo e no /chat/ aberto no navegador o interruptor só aparece/grava; o bloqueio só vale em standalone. */
(function () {
    'use strict';
    var K = 'minera_chat_trava_';             // minera_chat_trava_<uid> = '1' → pedir senha
    var K_SESS = 'minera_chat_unlock_sess_';  // sessão do aparelho (sessionStorage) já desbloqueada

    function ls(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ }
        return null;
    }
    function ss(k, v) {
        try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* ignore */ }
        return null;
    }
    function standalone() {
        try {
            return (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
        } catch (e) { return false; }
    }
    function chatApp() { return window.MINERA_CHAT_APP === true; }
    function chave(uid) { return K + uid; }
    /** Para o service worker do /chat/: com "pedir senha" ligado, a notificação não mostra remetente nem texto. */
    function gravarPrevia(oculta) {
        try {
            var rq = indexedDB.open('minera-chat', 1);
            rq.onupgradeneeded = function () { try { rq.result.createObjectStore('prefs'); } catch (e) { /* ignore */ } };
            rq.onsuccess = function () {
                try { var db = rq.result; var tx = db.transaction('prefs', 'readwrite'); tx.objectStore('prefs').put(!!oculta, 'ocultarPrevia'); tx.oncomplete = function () { db.close(); }; } catch (e) { /* ignore */ }
            };
        } catch (e) { /* ignore */ }
    }
    function pedindo(uid) { return !!(uid && ls(chave(uid)) === '1'); }
    function setPedindo(uid, on) { if (uid) { ls(chave(uid), on ? '1' : '0'); gravarPrevia(on); } }
    function desbloquear(uid) { if (uid) ss(K_SESS + uid, '1'); }
    function jaDesbloqueado(uid) { return !!(uid && ss(K_SESS + uid) === '1'); }

    async function uidAtual() {
        try {
            if (typeof supabaseClient === 'undefined') return null;
            var r = await supabaseClient.auth.getSession();
            return r && r.data && r.data.session && r.data.session.user ? r.data.session.user.id : null;
        } catch (e) { return null; }
    }
    async function emailAtual() {
        try {
            var r = await supabaseClient.auth.getSession();
            return r && r.data && r.data.session && r.data.session.user ? r.data.session.user.email : '';
        } catch (e) { return ''; }
    }

    function montarToggle(host, uid) {
        if (!host) return;
        host.classList.add('notif-perm-row');
        host.innerHTML =
            '<div class="npr-txt"><strong>🔒 Pedir senha ao abrir o Chat Minera</strong><span class="npr-st"></span></div>' +
            '<button type="button" class="npr-btn npr-trava" role="switch"></button>' +
            '<p class="npr-help sub">' + (chatApp()
                ? 'Desligado: o Chat Minera abre direto, sem senha, igual ao WhatsApp, enquanto você estiver conectado.'
                : 'Vale para o Chat Minera instalado na tela inicial deste aparelho. No iPhone, ligue pelo menu ⋮ dentro do próprio Chat Minera.') + '</p>';
        var btn = host.querySelector('.npr-btn');
        var st = host.querySelector('.npr-st');
        function render() {
            var on = pedindo(uid);
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            btn.textContent = on ? 'Ligado' : 'Desligado';
            btn.classList.toggle('som-off', !on);
            btn.classList.toggle('on', on);
            st.textContent = on ? 'Pede a senha da conta ao abrir o Chat Minera' : 'Abre direto, sem pedir senha';
        }
        btn.addEventListener('click', function () {
            if (!uid) return;
            setPedindo(uid, !pedindo(uid));
            if (!pedindo(uid)) desbloquear(uid);
            render();
            if (typeof toastMsg === 'function') toastMsg(pedindo(uid) ? 'Agora o Chat Minera pede senha ao abrir' : 'Chat Minera abre sem pedir senha');
        });
        render();
    }

    var overlay = null;
    var falhas = 0, esperaAte = 0;
    function liberarCedo() { document.documentElement.classList.remove('ct-cedo'); }
    function fecharOverlay() {
        liberarCedo();
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        document.body.classList.remove('ct-bloqueado');
    }
    function mostrarBloqueio(uid, email) {
        if (overlay || document.getElementById('chat-trava')) return;
        var el = document.createElement('div');
        el.id = 'chat-trava';
        el.className = 'ct-modal';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'ct-tit');
        el.innerHTML =
            '<div class="ct-card">' +
            '<img class="ct-ico" src="' + (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'chat/icon-192.png' + ((window.MineraPwa && MineraPwa.assetV) ? '?v=' + MineraPwa.assetV : '') + '" alt="" width="56" height="56">' +
            '<h2 class="ct-tit" id="ct-tit">Digite sua senha</h2>' +
            '<p class="ct-sub">Você pediu senha ao abrir o Chat Minera. Digite a senha da conta' + (email ? ' <b>' + String(email).replace(/</g, '') + '</b>' : '') + '.</p>' +
            '<label class="ct-lbl" for="ct-senha">Senha</label>' +
            '<input type="password" id="ct-senha" class="ct-senha" autocomplete="current-password" enterkeyhint="go">' +
            '<p class="ct-err oculto" id="ct-err" role="alert"></p>' +
            '<button type="button" class="ct-ok" id="ct-ok">Desbloquear</button>' +
            '<button type="button" class="ct-sair" id="ct-sair">Sair da conta</button>' +
            '</div>';
        document.body.appendChild(el);
        document.body.classList.add('ct-bloqueado');
        liberarCedo();
        overlay = el;
        var inp = el.querySelector('#ct-senha');
        var err = el.querySelector('#ct-err');
        var btn = el.querySelector('#ct-ok');
        async function tentar() {
            var senha = (inp.value || '').trim();
            err.classList.add('oculto'); err.textContent = '';
            if (!senha) { err.textContent = 'Digite a senha.'; err.classList.remove('oculto'); return; }
            if (Date.now() < esperaAte) { err.textContent = 'Muitas tentativas. Espere ' + Math.ceil((esperaAte - Date.now()) / 1000) + ' s.'; err.classList.remove('oculto'); return; }
            btn.disabled = true; btn.textContent = 'Verificando…';
            try {
                var em = email || (await emailAtual());
                var r = await supabaseClient.auth.signInWithPassword({ email: em, password: senha });
                if (r.error) {
                    falhas++;
                    if (falhas >= 5) { esperaAte = Date.now() + 30000; falhas = 0; }
                    err.textContent = /Invalid login credentials|invalid_credentials/i.test(String(r.error.message || '')) ? 'Senha incorreta.' : (r.error.message || 'Não deu para desbloquear.');
                    err.classList.remove('oculto');
                    btn.disabled = false; btn.textContent = 'Desbloquear';
                    return;
                }
                desbloquear(uid);
                fecharOverlay();
            } catch (e) {
                err.textContent = 'Falha: ' + (e && e.message ? e.message : e);
                err.classList.remove('oculto');
                btn.disabled = false; btn.textContent = 'Desbloquear';
            }
        }
        btn.addEventListener('click', tentar);
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') tentar(); });
        el.querySelector('#ct-sair').addEventListener('click', function () {
            if (typeof sairApp === 'function') sairApp();
            else irPara('entrar.html');
        });
        try { inp.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    async function talvezBloquear() {
        try {
            if (!chatApp()) return;
            var uid = await uidAtual();
            if (uid) gravarPrevia(pedindo(uid)); // mantém o service worker em dia com a conta deste aparelho
            if (!standalone()) return;
            if (!uid || !pedindo(uid) || jaDesbloqueado(uid)) return;
            mostrarBloqueio(uid, await emailAtual());
        } catch (e) { /* nunca trava o chat sem o overlay */ } finally { if (!overlay) liberarCedo(); }
    }

    // Voltou ao Chat Minera depois de 1 min ou mais em segundo plano: pede a senha de novo (se ligado)
    var escondidoEm = 0;
    document.addEventListener('visibilitychange', function () {
        if (!chatApp() || !standalone()) return;
        if (document.visibilityState === 'hidden') { escondidoEm = Date.now(); return; }
        if (escondidoEm && Date.now() - escondidoEm >= 60000) {
            uidAtual().then(function (uid) {
                if (uid && pedindo(uid)) { ss(K_SESS + uid, null); talvezBloquear(); }
            });
        }
        escondidoEm = 0;
    });

    /* Chat Minera: o ⋮ da lista abre "Configurações" (avisos, som e pedir senha). No app completo o ⋮ fica como está. */
    function abrirConfig() {
        if (document.getElementById('chat-config')) return;
        uidAtual().then(function (uid) {
            var el = document.createElement('div');
            el.id = 'chat-config';
            el.className = 'cc-modal';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-modal', 'true');
            el.setAttribute('aria-labelledby', 'cc-tit');
            el.innerHTML = '<div class="cc-backdrop"></div><div class="cc-card">' +
                '<div class="cc-head"><h2 id="cc-tit">⚙️ Configurações</h2><button type="button" class="cc-x" id="cc-x" aria-label="Fechar">✕</button></div>' +
                '<div id="notif-perm-toggle"></div><p class="cc-push-dica sub oculto" id="cc-push-dica"></p>' +
                '<div id="cc-som"></div><div id="cc-trava"></div>' +
                '<a class="cc-link" href="inicio.html" target="_blank" rel="noopener">Abrir Minera Pará completo ↗</a>' +
                '</div>';
            document.body.appendChild(el);
            if (window.MineraNotifPerm) MineraNotifPerm.montarToggle(el.querySelector('#notif-perm-toggle'));
            if (window.MineraSom) MineraSom.montarToggle(el.querySelector('#cc-som'));
            montarToggle(el.querySelector('#cc-trava'), uid);
            var dica = window.MineraPush && MineraPush.dicaIOS ? MineraPush.dicaIOS() : '';
            if (dica) { var d = el.querySelector('#cc-push-dica'); d.textContent = dica; d.classList.remove('oculto'); }
            function fechar() { document.removeEventListener('keydown', onKey, true); el.remove(); }
            function onKey(e) { if (e.key === 'Escape') fechar(); }
            document.addEventListener('keydown', onKey, true);
            el.querySelector('#cc-x').addEventListener('click', fechar);
            el.querySelector('.cc-backdrop').addEventListener('click', fechar);
        });
    }
    function ligarMenu() {
        if (!chatApp()) return;
        var b = document.getElementById('btn-chat-menu-list');
        if (!b || b._cc) return;
        b._cc = true;
        b.setAttribute('aria-label', 'Configurações');
        b.addEventListener('click', abrirConfig);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarMenu); else ligarMenu();

    window.MineraChatTrava = {
        pedindo: pedindo, setPedindo: setPedindo, montarToggle: montarToggle,
        talvezBloquear: talvezBloquear, desbloquear: desbloquear, standalone: standalone, abrirConfig: abrirConfig
    };

    if (document.readyState === 'complete') setTimeout(talvezBloquear, 200);
    else window.addEventListener('load', function () { setTimeout(talvezBloquear, 200); });
})();
