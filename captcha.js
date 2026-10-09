/* ===================== CAPTCHA (Cloudflare Turnstile) nas telas de conta =====================
 * O Supabase Auth, com "CAPTCHA protection" ligado no painel, recusa sem token:
 *   signUp, signInWithPassword, resetPasswordForEmail, signInWithOtp e resend.
 * Cada tela que faz uma dessas chamadas cria um quadrinho "Não sou um robô" (widget) perto do botão:
 *   const cap = MineraCaptcha.criar(divDoWidget, { botoes: [btn1, btn2] });
 *   const t = cap.pegar();            // null = ainda sem token (botões ficam desligados até chegar)
 *   await supabaseClient.auth.signInWithPassword({ email, password, options: MineraCaptcha.opcoes({}, t) });
 *   cap.liberar();                    // token só vale 1 vez: sempre renova depois de cada tentativa
 * SEM chave (TURNSTILE_SITEKEY vazia no config.js) = desligado: nada é carregado, nenhum botão é travado e as
 * chamadas saem exatamente como antes (sem captchaToken).
 */
(function () {
    'use strict';
    var API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=mineraTurnstilePronto';
    var MSG_FALHA = 'Não conseguimos confirmar que você não é um robô. Tente de novo.';
    var chave = '';
    try { chave = (typeof TURNSTILE_SITEKEY === 'string' ? TURNSTILE_SITEKEY : '').trim(); } catch (e) { chave = ''; }
    var ativo = !!chave;

    var carregando = null;
    function carregarApi() {
        if (window.turnstile && typeof window.turnstile.render === 'function') return Promise.resolve(window.turnstile);
        if (carregando) return carregando;
        carregando = new Promise(function (ok, falha) {
            var tempo = setTimeout(function () { carregando = null; falha(new Error('turnstile timeout')); }, 20000);
            window.mineraTurnstilePronto = function () { clearTimeout(tempo); ok(window.turnstile); };
            var s = document.createElement('script');
            s.src = API;
            s.onerror = function () { clearTimeout(tempo); carregando = null; try { s.remove(); } catch (e) { /* ignore */ } falha(new Error('turnstile load')); };
            document.head.appendChild(s);
        });
        return carregando;
    }

    function temaAtual() {
        try { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; }
    }

    var todos = [];
    // Tema mudou (Claro/Escuro): redesenha os quadrinhos com o tema novo
    if (ativo) {
        try {
            new MutationObserver(function () {
                var t = temaAtual();
                todos.forEach(function (c) { if (c._tema && c._tema !== t) c._redesenhar(); });
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        } catch (e) { /* ignore */ }
    }

    /** Erro do Supabase por causa do captcha (sem token, token usado/vencido, recusado). */
    function ehErroCaptcha(err) {
        if (!err) return false;
        var t = String(err.code || '') + ' ' + String(err.error_code || '') + ' ' + String(err.message || err.msg || err);
        return /captcha/i.test(t);
    }

    /** Junta o token nas options de uma chamada do supabase.auth (sem token = options intactas). */
    function opcoes(base, token) {
        var o = {};
        if (base) for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) o[k] = base[k];
        if (ativo && token) o.captchaToken = token;
        return o;
    }

    function criar(host, cfg) {
        cfg = cfg || {};
        var botoesFn = typeof cfg.botoes === 'function' ? cfg.botoes : function () { return cfg.botoes || []; };
        var ctl = {
            ativo: ativo,
            _token: '', _id: null, _tema: '', _ocupado: false, _ts: null,
            token: function () { return ativo ? ctl._token : ''; },
            pronto: function () { return !ativo || (!!ctl._token && !ctl._ocupado); },
            /** Token para UMA chamada. '' = captcha desligado; null = ainda não confirmou (não chame o Supabase). */
            pegar: function () {
                if (!ativo) return '';
                if (!ctl._token) { ctl._erro(cfg.msgAguarde || 'Espere a verificação “Não sou um robô” terminar e tente de novo.'); return null; }
                var t = ctl._token;
                ctl._token = '';
                ctl._ocupado = true;
                ctl.sincronizar();
                return t;
            },
            /** Depois de cada tentativa (deu certo ou não): token novo, porque o anterior já foi gasto. */
            liberar: function () {
                if (!ativo) return;
                ctl._ocupado = false;
                ctl._token = '';
                try { if (ctl._ts && ctl._id != null) ctl._ts.reset(ctl._id); } catch (e) { ctl._redesenhar(); }
                ctl.sincronizar();
            },
            /** Liga/desliga os botões que dependem do captcha (respeita outras travas: btn._mcapTrava()). */
            sincronizar: function () {
                if (!ativo) return;
                var ok = ctl.pronto();
                botoesFn().forEach(function (b) {
                    if (!b) return;
                    var outra = typeof b._mcapTrava === 'function' && b._mcapTrava();
                    b.disabled = !ok || !!outra;
                    if (!ok) b.setAttribute('data-captcha-espera', '1'); else b.removeAttribute('data-captcha-espera');
                });
                if (typeof cfg.aoMudar === 'function') { try { cfg.aoMudar(ok); } catch (e) { /* ignore */ } }
            },
            _erro: function (t) {
                if (!ctl._msg) return;
                ctl._msg.textContent = t || '';
                ctl._msg.classList.toggle('oculto', !t);
            },
            _redesenhar: function () {
                try { if (ctl._ts && ctl._id != null) ctl._ts.remove(ctl._id); } catch (e) { /* ignore */ }
                ctl._id = null; ctl._token = '';
                ctl.sincronizar();
                desenhar();
            }
        };
        if (!ativo || !host) return ctl;
        todos.push(ctl);

        host.classList.add('mcap');
        host.setAttribute('aria-label', 'Verificação de segurança: não sou um robô');
        var caixa = document.createElement('div');
        caixa.className = 'mcap-widget';
        var aviso = document.createElement('p');
        aviso.className = 'mcap-msg msg erro oculto';
        aviso.setAttribute('role', 'alert');
        host.appendChild(caixa);
        host.appendChild(aviso);
        ctl._msg = aviso;
        ctl.sincronizar();

        function desenhar() {
            carregarApi().then(function (ts) {
                ctl._ts = ts;
                if (ctl._id != null) return;
                ctl._tema = temaAtual();
                caixa.innerHTML = '';
                // só para conferência (teste/suporte): tema e idioma com que o quadrinho foi desenhado
                host.setAttribute('data-mcap-tema', ctl._tema);
                host.setAttribute('data-mcap-idioma', 'pt-br');
                ctl._id = ts.render(caixa, {
                    sitekey: chave,
                    theme: ctl._tema,
                    language: 'pt-br',
                    size: 'flexible',
                    action: cfg.acao || 'auth',
                    'response-field': false,
                    'refresh-expired': 'auto',
                    retry: 'auto',
                    callback: function (t) { ctl._token = String(t || ''); ctl._erro(''); ctl.sincronizar(); },
                    'expired-callback': function () { ctl._token = ''; ctl.sincronizar(); },
                    'timeout-callback': function () { ctl._token = ''; ctl.sincronizar(); },
                    'error-callback': function () { ctl._token = ''; ctl.sincronizar(); ctl._erro(MSG_FALHA); return true; }
                });
            }).catch(function () {
                ctl._erro(MSG_FALHA);
                var b = document.createElement('button');
                b.type = 'button'; b.className = 'btn-link mcap-retry'; b.textContent = 'Tentar de novo';
                b.addEventListener('click', function () { try { b.remove(); } catch (e) { /* ignore */ } ctl._erro(''); desenhar(); });
                caixa.innerHTML = ''; caixa.appendChild(b);
            });
        }
        // Só desenha quando a área aparece na tela (abas/cartões escondidos não gastam verificação)
        if ('IntersectionObserver' in window) {
            var io = new IntersectionObserver(function (ents) {
                if (ents.some(function (e) { return e.isIntersecting; })) { io.disconnect(); desenhar(); }
            }, { rootMargin: '1500px 0px' });
            io.observe(host);
        } else {
            desenhar();
        }
        return ctl;
    }

    window.MineraCaptcha = { ativo: ativo, criar: criar, opcoes: opcoes, ehErro: ehErroCaptcha, MSG: MSG_FALHA };
})();
