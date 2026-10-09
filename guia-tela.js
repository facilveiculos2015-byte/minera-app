/* Minera Pará — guia fácil "Colocar na tela inicial" (faixa + folha com os passos).
 * Onde: Chat Minera (/chat/) e Gestor Minera (/gestor/) abertos no NAVEGADOR, e no Início do app principal (iPhone).
 * iPhone/iPad: não existe API de instalação → só o guia visual (ícone Compartilhar piscando + 3 passos) e "Já coloquei".
 * Android: beforeinstallprompt normal (botão Instalar); sem o aviso do Chrome = já instalado/sem suporte → não mostra.
 * "Agora não" só esconde a FAIXA por 3 dias. O botãozinho "Colocar na tela inicial" (app-atalho.js no Chat/Gestor,
 * #gt-mini no Início) NUNCA some fora do modo app instalado (standalone): "Já coloquei"/instalação só o deixam PEQUENO,
 * para a pessoa reabrir o guia se apagar o ícone depois. Aberto pelo ícone (standalone) → some.
 * Arquivo isolado: para desligar, é só tirar o <script src="guia-tela.js"> (ou reverter o commit). */
(function () {
    'use strict';
    var At = window.MineraAtalho;
    if (!At || window.MINERA_INSTALADOR === true || window.MINERA_GUIA_OFF === true) return;
    var app = At.subApp() || (/\/inicio\.html$/i.test(location.pathname || '') ? 'main' : '');
    if (!app) return;
    var NOME = { chat: 'Chat Minera', gestor: 'Gestor Minera', main: 'Minera Pará' }[app];
    var ICONE = { chat: 'chat/icon-192.png', gestor: 'gestor/icon-192.png', main: 'icon-192.png' }[app];
    var K_ADIA = 'minera_guia_adiado_' + app;
    var ADIA_MS = 3 * 864e5;
    var ios = At.ehIOS(), android = At.ehAndroid();
    if (app === 'main' && !ios) return; // app principal no Android: segue o fluxo do APK / instalar que já existe (pwa.js)
    var prompt = null, faixa = null, folha = null;

    function ls(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ }
        return null;
    }
    function raiz() { return typeof APP_ROOT === 'string' ? APP_ROOT : ''; }
    function adiado() { var t = Number(ls(K_ADIA) || 0); return !!t && Date.now() - t < ADIA_MS; }
    var SVG_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
    var SVG_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
    var SVG_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var SVG_MENU = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

    function estilos() {
        if (document.getElementById('guia-tela-css')) return;
        var st = document.createElement('style');
        st.id = 'guia-tela-css';
        st.textContent =
            '.gt-faixa{position:fixed;z-index:9990;left:10px;right:10px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:460px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px;border-radius:16px;background:#111a2e;color:#e2e8f0;border:1px solid rgba(245,166,35,.55);box-shadow:0 12px 32px rgba(0,0,0,.45);box-sizing:border-box;animation:gtSobe .3s ease-out}' +
            'body.has-bottom-nav .gt-faixa{bottom:calc(80px + env(safe-area-inset-bottom,0px))}' +
            'body.chat-thread-open .gt-faixa,body.cn-aberto .gt-faixa,body.gt-folha-aberta .gt-faixa{display:none}' +
            '.gt-faixa .gt-ico{width:42px;height:42px;border-radius:11px;flex:0 0 42px}' +
            '.gt-faixa .gt-txt{flex:1 1 150px;min-width:0;font-size:.86rem;line-height:1.3}' +
            '.gt-faixa .gt-txt strong{display:block;font-size:.95rem;color:#f8fafc}' +
            '.gt-faixa .gt-acoes{display:flex;gap:8px;width:100%}' +
            '.gt-faixa button{flex:1;min-height:42px;border-radius:11px;font-weight:800;font-size:.92rem;cursor:pointer;border:0}' +
            '.gt-sim{background:linear-gradient(145deg,#fcd34d,#F5A623 45%,#d97706);color:#0b1220}' +
            '.gt-nao{background:transparent;color:#94a3b8;border:1px solid #334155 !important}' +
            '.gt-modal{position:fixed;inset:0;z-index:10050;display:flex;align-items:flex-end;justify-content:center}' +
            '.gt-backdrop{position:absolute;inset:0;background:rgba(2,6,23,.72)}' +
            '.gt-sheet{position:relative;width:100%;max-width:480px;max-height:calc(100dvh - 40px);overflow-y:auto;box-sizing:border-box;margin-bottom:calc(64px + env(safe-area-inset-bottom,0px));padding:18px 16px 14px;border-radius:20px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;box-shadow:0 -10px 40px rgba(0,0,0,.5);animation:gtSobe .25s ease-out}' +
            '.gt-sheet h2{margin:0 34px 12px 0;font-size:1.12rem;line-height:1.25;color:#f8fafc}' +
            '.gt-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:0;background:#1e293b;color:#cbd5e1;font-size:1rem;cursor:pointer}' +
            '.gt-passos{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-direction:column;gap:8px}' +
            '.gt-passos li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:13px;background:#111c33;border:1px solid #243049;font-size:.97rem;line-height:1.3}' +
            '.gt-passos small{display:block;color:#94a3b8;font-size:.8rem;margin-top:2px}' +
            '.gt-n{flex:0 0 26px;height:26px;border-radius:50%;background:#F5A623;color:#0b1220;font-weight:800;display:flex;align-items:center;justify-content:center}' +
            '.gt-ic{flex:0 0 34px;height:34px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;background:rgba(10,132,255,.16);color:#0a84ff}' +
            '.gt-ic svg{width:22px;height:22px}' +
            '.gt-pisca{animation:gtPisca 1.1s ease-in-out infinite}' +
            '.gt-ja,.gt-fechar{display:block;width:100%;min-height:48px;border-radius:13px;font-weight:800;font-size:1rem;cursor:pointer;border:0;margin-top:8px}' +
            '.gt-ja{background:linear-gradient(145deg,#fcd34d,#F5A623 45%,#d97706);color:#0b1220}' +
            '.gt-fechar{background:transparent;color:#cbd5e1;border:1px solid #334155}' +
            '.gt-seta{position:absolute;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;color:#0a84ff;pointer-events:none}' +
            '.gt-seta .gt-ic{background:#fff;box-shadow:0 0 0 4px rgba(10,132,255,.35)}' +
            '.gt-seta b{font-size:1.4rem;line-height:1;animation:gtDesce 1s ease-in-out infinite;color:#fff}' +
            '@keyframes gtPisca{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(10,132,255,.6)}50%{transform:scale(1.12);box-shadow:0 0 0 8px rgba(10,132,255,0)}}' +
            '@keyframes gtDesce{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}' +
            '@keyframes gtSobe{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}' +
            'html[data-theme="light"] .gt-faixa,html[data-theme="light"] .gt-sheet{background:#fff;color:#0f172a;border-color:#e2e8f0}' +
            'html[data-theme="light"] .gt-faixa .gt-txt strong,html[data-theme="light"] .gt-sheet h2{color:#0f172a}' +
            'html[data-theme="light"] .gt-passos li{background:#f8fafc;border-color:#e2e8f0}' +
            'html[data-theme="light"] .gt-x{background:#f1f5f9;color:#334155}' +
            'html[data-theme="light"] .gt-fechar,html[data-theme="light"] .gt-nao{color:#475569}' +
            '@media (prefers-reduced-motion: reduce){.gt-pisca,.gt-seta b,.gt-faixa,.gt-sheet{animation:none}}';
        document.head.appendChild(st);
    }

    function fecharFaixa() { if (faixa) { faixa.remove(); faixa = null; } }
    function fecharFolha() {
        if (!folha) return;
        document.removeEventListener('keydown', folha._onKey, true);
        folha.remove(); folha = null;
        document.body.classList.remove('gt-folha-aberta');
    }
    function instalado() { // "Já coloquei" / Instalar aceito: some a faixa grande; o botão fica PEQUENO (não some)
        At.marcar(app);
        fecharFolha(); fecharFaixa();
        At.atualizar();
        botaoMini();
    }
    /** Início (app principal no iPhone): botãozinho compacto "Colocar na tela inicial" quando a faixa grande não está
     * aberta (depois de "Já coloquei" ou "Agora não"). Some só no modo app instalado (standalone). Toque → passos. */
    function botaoMini() {
        if (app !== 'main') return; // Chat/Gestor já têm o botão [data-app-atalho] (app-atalho.js)
        var b = document.getElementById('gt-mini');
        if (At.standalone() || faixa) { if (b) b.remove(); return; }
        if (b) return;
        estilos();
        b = document.createElement('button');
        b.type = 'button';
        b.id = 'gt-mini';
        b.className = 'app-atalho-btn app-atalho-mini gt-mini';
        b.setAttribute('data-estado', 'mini');
        b.setAttribute('aria-label', 'Colocar o Minera Pará na tela inicial: mostrar como fazer');
        b.textContent = '📲 Colocar na tela inicial';
        b.addEventListener('click', abrirFolha);
        var ref = document.querySelector('.olx-quick');
        if (ref && ref.parentNode) ref.parentNode.insertBefore(b, ref.nextSibling);
        else (document.querySelector('.container') || document.body).appendChild(b);
    }

    function abrirFolha() {
        if (folha) return;
        estilos();
        folha = document.createElement('div');
        folha.id = 'guia-tela-folha';
        folha.className = 'gt-modal';
        var passos = ios
            ? '<li><span class="gt-n">1</span><span class="gt-ic gt-pisca">' + SVG_SHARE + '</span><span>Toque em <strong>Compartilhar</strong><small>Na barra do Safari. Se não aparecer, toque em ⋯ e depois em Compartilhar.</small></span></li>' +
              '<li><span class="gt-n">2</span><span class="gt-ic">' + SVG_ADD + '</span><span>Toque em <strong>Adicionar à Tela de Início</strong></span></li>' +
              '<li><span class="gt-n">3</span><span class="gt-ic">' + SVG_OK + '</span><span>Toque em <strong>Adicionar</strong></span></li>'
            : '<li><span class="gt-n">1</span><span class="gt-ic gt-pisca">' + SVG_MENU + '</span><span>Toque em <strong>⋮</strong><small>O menu do Chrome, no canto de cima.</small></span></li>' +
              '<li><span class="gt-n">2</span><span class="gt-ic">' + SVG_ADD + '</span><span>Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong></span></li>' +
              '<li><span class="gt-n">3</span><span class="gt-ic">' + SVG_OK + '</span><span>Toque em <strong>Instalar</strong></span></li>';
        folha.innerHTML =
            '<div class="gt-backdrop"></div>' +
            '<div class="gt-sheet" role="dialog" aria-modal="true" aria-labelledby="gt-tit">' +
            '<button type="button" class="gt-x" id="gt-x" aria-label="Fechar">✕</button>' +
            '<h2 id="gt-tit">Colocar o ' + NOME + ' na tela inicial</h2>' +
            '<ol class="gt-passos">' + passos + '</ol>' +
            (ios ? '<button type="button" class="gt-ja" id="gt-ja">Já coloquei na tela inicial ✓</button>' : '') +
            '<button type="button" class="gt-fechar" id="gt-fechar">Fechar</button>' +
            '</div>' +
            (ios ? '<div class="gt-seta" aria-hidden="true"><span class="gt-ic gt-pisca">' + SVG_SHARE + '</span><b>↓</b></div>' : '');
        document.body.appendChild(folha);
        document.body.classList.add('gt-folha-aberta');
        // Fechar / X / toque fora / Esc: só fecham a folha (a faixa e o botãozinho continuam)
        folha.querySelector('.gt-backdrop').addEventListener('click', fecharFolha);
        folha.querySelector('#gt-x').addEventListener('click', fecharFolha);
        folha.querySelector('#gt-fechar').addEventListener('click', fecharFolha);
        var ja = folha.querySelector('#gt-ja');
        if (ja) ja.addEventListener('click', instalado);
        folha._onKey = function (e) { if (e.key === 'Escape' || e.key === 'Esc') fecharFolha(); };
        document.addEventListener('keydown', folha._onKey, true);
    }

    function montarFaixa() {
        if (faixa || document.getElementById('guia-tela')) return;
        estilos();
        faixa = document.createElement('div');
        faixa.id = 'guia-tela';
        faixa.className = 'gt-faixa';
        faixa.setAttribute('role', 'region');
        faixa.setAttribute('aria-label', 'Colocar na tela inicial');
        faixa.innerHTML =
            '<img class="gt-ico" src="' + raiz() + ICONE + '" alt="" width="42" height="42">' +
            '<div class="gt-txt"><strong>Coloque o ' + NOME + ' na tela inicial</strong>Abre num toque, igual a um aplicativo.</div>' +
            '<div class="gt-acoes"><button type="button" class="gt-sim" id="gt-sim"></button><button type="button" class="gt-nao" id="gt-nao">Agora não</button></div>';
        document.body.appendChild(faixa);
        var mini = document.getElementById('gt-mini'); if (mini) mini.remove();
        botaoPrincipal();
        faixa.querySelector('#gt-sim').addEventListener('click', function () {
            if (prompt) {
                var p = prompt; prompt = null;
                p.prompt();
                p.userChoice.then(function (r) {
                    if (r && r.outcome === 'accepted') instalado();
                    else botaoPrincipal(); // tocou fora: nada some; o botão passa a mostrar os passos
                }).catch(botaoPrincipal);
                return;
            }
            abrirFolha();
        });
        // "Agora não": esconde só esta faixa por 3 dias (o botãozinho continua)
        faixa.querySelector('#gt-nao').addEventListener('click', function () { ls(K_ADIA, String(Date.now())); fecharFaixa(); botaoMini(); });
    }
    function botaoPrincipal() {
        var b = faixa && faixa.querySelector('#gt-sim');
        if (b) b.textContent = prompt ? 'Instalar' : 'Mostrar como fazer';
    }

    function talvezMostrar() {
        if (faixa || At.standalone()) return;
        if (adiado()) { botaoMini(); return; }
        if (android && !prompt) return; // Android: só com o aviso do Chrome (prova que não está instalado)
        if (!ios && !android) return;
        At.instalado(app).then(function (ja) {
            if (At.standalone()) return;
            if (!ja && !adiado()) montarFaixa(); else botaoMini();
        });
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        if (app === 'main') return;
        prompt = e;
        if (faixa) botaoPrincipal(); else talvezMostrar();
    });
    window.addEventListener('appinstalled', function () { if (app !== 'main') instalado(); });

    window.MineraGuiaTela = { mostrar: function () { ls(K_ADIA, null); talvezMostrar(); }, abrirPassos: abrirFolha, app: app };
    if (document.readyState === 'complete') setTimeout(talvezMostrar, 2500);
    else window.addEventListener('load', function () { setTimeout(talvezMostrar, 2500); });
})();
