/* Minera Pará — botãozinho "Colocar na tela inicial" do Chat Minera (/chat/) e do Gestor Minera (/gestor/).
 * Marcação: <a data-app-atalho="chat|gestor" href="chat/instalar.html" hidden>…</a> (começa escondido).
 * Só SOME quando aberto pelo ícone (display-mode standalone do próprio /chat/ ou /gestor/). Fora disso fica sempre
 * visível: grande se não está instalado, PEQUENO (classe app-atalho-mini) se parece instalado ("Já coloquei", Instalar
 * aceito, ícone detectado) — assim, se a pessoa apagar o ícone, o botãozinho continua para abrir o guia de novo.
 * Como sabe se parece instalado:
 *  - beforeinstallprompt na página do próprio app = não instalado → mostra;
 *  - Chrome Android: navigator.getInstalledRelatedApps() (manifest + .well-known/assetlinks.json) decide;
 *  - sem essa API (iPhone, computador): marca local com validade (instalou / abriu pelo ícone / "Já coloquei").
 *    No iPhone o Safari não enxerga o app da tela inicial (armazenamento separado): depois da validade o botão volta.
 * Também guarda em sessionStorage qual app é esta janela instalada (instalador usa: "abra no navegador"). */
(function () {
    'use strict';
    var DIAS = 15; // validade da marca local (iPhone/computador, onde não dá para perguntar ao sistema)
    var APPS = {
        chat: { flag: 'MINERA_CHAT_APP', dir: 'chat/' },
        gestor: { flag: 'MINERA_GESTOR_APP', dir: 'gestor/' },
        main: { flag: '', dir: '' } // app principal (só a marca "Já coloquei" do iPhone, guia-tela.js)
    };
    var K_JANELA = 'minera_janela_app';
    function kMarca(app) { return 'minera_atalho_' + app; }
    function ls(k, v) {
        try {
            if (v === undefined) return localStorage.getItem(k);
            if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        } catch (e) { /* ignore */ }
        return null;
    }
    function ss(k, v) {
        try {
            if (v === undefined) return sessionStorage.getItem(k);
            sessionStorage.setItem(k, v);
        } catch (e) { /* ignore */ }
        return null;
    }
    function standalone() {
        try {
            var mm = window.matchMedia;
            if (mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches || mm('(display-mode: minimal-ui)').matches)) return true;
            if (navigator.standalone === true) return true;
            if (window.MineraPwa && MineraPwa.isTwa && MineraPwa.isTwa()) return true;
        } catch (e) { /* ignore */ }
        return false;
    }
    function ehIOS() {
        var ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }
    function ehAndroid() { return /Android/i.test(navigator.userAgent || ''); }
    /** Qual app só-X é esta página ('chat' em /chat/, 'gestor' em /gestor/, '' no app completo). */
    function subApp() {
        if (window.MINERA_CHAT_APP === true) return 'chat';
        if (window.MINERA_GESTOR_APP === true) return 'gestor';
        return '';
    }
    function marcar(app) { if (APPS[app]) ls(kMarca(app), String(Date.now())); }
    function limpar(app) { if (APPS[app]) ls(kMarca(app), null); }
    // 1× por aparelho: zera marcas do build 20261009w (podiam ter vindo de marca antiga ou de janela errada)
    if (ls('minera_atalho_v2') !== '1') {
        Object.keys(APPS).forEach(function (a) { ls(kMarca(a), null); ls(kMarca(a) + '_mig', null); });
        ls('minera_atalho_v2', '1');
    }
    /** Marca local: SÓ gravada por instalação de verdade (aberto pelo ícone, Instalar aceito/appinstalled,
     * "Já coloquei" no iPhone). Fechar aviso, tocar fora ou "Agora não" NUNCA gravam. */
    function marcaValida(app) {
        var ts = Number(ls(kMarca(app)) || 0);
        return !!ts && (Date.now() - ts) < DIAS * 864e5;
    }

    // Esta janela é um app instalado? (o instalador diferencia "já está aqui" de "dentro do app completo")
    // (vale a 1ª página da janela: o app completo que abre o instalador do /chat/ continua sendo 'main')
    // Nos instaladores (chat/instalar.html, gestor/instalar.html) não vale: eles abrem dentro de qualquer janela.
    var instalador = window.MINERA_INSTALADOR === true;
    if (!instalador && standalone() && !ss(K_JANELA)) ss(K_JANELA, subApp() || 'main');
    /** Esta janela é o próprio app instalado (aberta pelo ícone dele), e não o /gestor/ ou /chat/ aberto
     * dentro de outra janela (app Minera Pará instalado, app Android, navegador). */
    function ehOProprioApp(app) { return !instalador && !!app && subApp() === app && standalone() && ss(K_JANELA) === app; }
    if (ehOProprioApp(subApp())) {
        marcar(subApp());
        ls('minera_' + subApp() + '_app_usado', '1');
    }

    var semPrompt = {}; // beforeinstallprompt nesta página: o app desta página NÃO está instalado
    window.addEventListener('beforeinstallprompt', function () {
        var a = subApp();
        if (!a) return;
        semPrompt[a] = true;
        limpar(a);
        ls('minera_' + a + '_instalado', null); // como o instalador: o Chrome confirmou que não está instalado
        atualizar();
    });
    window.addEventListener('appinstalled', function () {
        var a = subApp();
        if (!a) return;
        delete semPrompt[a];
        marcar(a);
        atualizar();
    });

    var relacionados = null; // cache da consulta por rodada
    function consultarRelacionados() {
        if (!navigator.getInstalledRelatedApps) return Promise.resolve(null);
        if (!relacionados) {
            relacionados = navigator.getInstalledRelatedApps().catch(function () { return null; });
            setTimeout(function () { relacionados = null; }, 1500);
        }
        return relacionados;
    }
    function urlManifest(app) { return '/' + APPS[app].dir + 'manifest.webmanifest'; }

    /** true = já está na tela inicial deste aparelho (até onde dá para saber). */
    function instalado(app) {
        if (!APPS[app]) return Promise.resolve(false);
        if (ehOProprioApp(app)) { marcar(app); return Promise.resolve(true); }
        if (semPrompt[app]) return Promise.resolve(false);
        return consultarRelacionados().then(function (lista) {
            if (lista) {
                var achou = lista.some(function (x) {
                    return x && x.platform === 'webapp' && String(x.url || x.id || '').indexOf(urlManifest(app)) >= 0;
                });
                if (achou) { marcar(app); return true; }
                // Chrome Android responde pelo sistema (no próprio /chat/ ou /gestor/, e no app completo via assetlinks):
                // não achou = não está (ou a pessoa tirou o ícone)
                if (ehAndroid()) { limpar(app); return false; }
            }
            return marcaValida(app);
        });
    }

    function botoes() { return Array.prototype.slice.call(document.querySelectorAll('[data-app-atalho]')); }
    var rodando = false, denovo = false;
    function atualizar() {
        if (rodando) { denovo = true; return; }
        var els = botoes();
        if (!els.length) return;
        rodando = true;
        var apps = {};
        els.forEach(function (el) { apps[el.getAttribute('data-app-atalho')] = true; });
        var nomes = Object.keys(apps);
        Promise.all(nomes.map(function (a) { return instalado(a).catch(function () { return false; }); }))
            .then(function (res) {
                var est = {};
                nomes.forEach(function (a, i) { est[a] = res[i]; });
                els.forEach(function (el) {
                    var a = el.getAttribute('data-app-atalho');
                    // Só some quando esta janela É o app instalado (aberto pelo ícone dele). "Já coloquei", Instalar
                    // aceito ou ícone detectado só ENCOLHEM o botão (fica pequeno): se a pessoa apagar o ícone depois,
                    // o botãozinho continua aqui para abrir o guia de novo.
                    var proprio = ehOProprioApp(a);
                    var mini = !proprio && !!est[a];
                    el.hidden = proprio;
                    el.classList.toggle('app-atalho-mini', mini);
                    el.setAttribute('data-estado', proprio ? 'instalado' : (mini ? 'mini' : 'mostrar'));
                });
            })
            .then(function () { rodando = false; if (denovo) { denovo = false; atualizar(); } });
    }

    /* Dentro de OUTRO app instalado (ex.: Minera Pará na tela inicial) o instalador do /chat/ ou /gestor/
     * não consegue colocar o ícone: no iPhone o "Adicionar à Tela de Início" só existe no Safari.
     * Toque no botão → abre o instalador direto no Safari (iOS 17+: x-safari-https://) ou no Chrome (Android).
     * Se não saiu do app em ~2,5 s (iOS antigo, sem Chrome), segue para o instalador aqui dentro,
     * que mostra "Copiar endereço". */
    function urlNavegador(abs) {
        if (ehIOS()) return 'x-safari-' + abs;
        if (ehAndroid()) return 'intent://' + abs.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(abs) + ';end';
        return '';
    }
    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('a[data-app-atalho]') : null;
        if (!el) return;
        var app = el.getAttribute('data-app-atalho');
        if (!standalone() || instalador || ehOProprioApp(app)) return;
        var abs; try { abs = new URL(el.getAttribute('href'), document.baseURI).href; } catch (e2) { return; }
        var alvo = urlNavegador(abs);
        if (!alvo) return;
        e.preventDefault();
        var saiu = false;
        function marcarSaida() { saiu = true; }
        document.addEventListener('visibilitychange', function v() { if (document.visibilityState === 'hidden') { marcarSaida(); document.removeEventListener('visibilitychange', v); } });
        window.addEventListener('pagehide', marcarSaida, { once: true });
        setTimeout(function () { if (!saiu) location.href = abs; }, 2500);
        window.__mineraAtalhoAbriu = alvo;
        location.href = alvo;
    }, true);

    window.MineraAtalho = {
        instalado: instalado, atualizar: atualizar, marcar: marcar, limpar: limpar,
        standalone: standalone, ehIOS: ehIOS, ehAndroid: ehAndroid, subApp: subApp, urlNavegador: urlNavegador,
        janela: function () { return ss(K_JANELA) || ''; }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', atualizar);
    else atualizar();
    // voltou para o app (ex.: tirou o ícone da tela inicial e voltou): confere de novo
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') atualizar(); });
    window.addEventListener('pageshow', function (e) { if (e && e.persisted) atualizar(); });
})();
