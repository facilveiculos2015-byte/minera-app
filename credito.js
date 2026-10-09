/* Minera Pará — crédito do desenvolvedor (discreto), em todas as telas.
 * ÚNICO lugar do texto: troque CREDITO abaixo. Carregado pelo pwa.js (app, Chat Minera, Gestor, entrar, admin)
 * e direto pelo index.html (site). Fica no FIM do conteúdo (fluxo normal da página): nunca por cima da
 * barra de baixo, do campo de mensagem ou da tela de ligação. Na conversa aberta do chat não aparece;
 * no chat ele fica no fim da lista de Conversas. */
(function () {
    'use strict';
    var CREDITO = 'Sistema desenvolvido por J&L Empreendimentos';
    var TERMOS_URL = 'termos.html';
    window.MINERA_CREDITO = CREDITO;
    if (window.__mineraCredito) return; window.__mineraCredito = true;

    var css = '.mp-credito{display:block;margin:28px auto 10px;padding:0 16px;max-width:520px;text-align:center;' +
        'font-size:11px;line-height:1.45;font-weight:400;letter-spacing:.2px;color:inherit;opacity:.42;' +
        '-webkit-user-select:none;user-select:none;pointer-events:none;background:none;border:0;box-shadow:none}' +
        '.mp-credito .mp-credito-sep{margin:0 6px}.mp-credito a{color:inherit;text-decoration:underline;pointer-events:auto;padding:6px 2px}' +
        '.chat-contacts-pane .mp-credito{margin:18px auto 12px}' +
        'body.chat-thread-open .mp-credito,#chamada-tela .mp-credito{display:none!important}' +
        '.lp-foot .mp-credito{margin:14px auto 0;opacity:.55}';

    function alvo() {
        var b = document.body; if (!b) return null;
        var pre = document.querySelector('[data-mp-credito]');            // lugar marcado no HTML (ex.: rodapé do site)
        if (pre) return { el: pre, dentro: true };
        if (b.classList.contains('pagina-chat')) {                       // chat: fim da lista de Conversas
            var pane = document.getElementById('chat-contacts-pane');
            return pane ? { el: pane } : null;
        }
        var cs = [].filter.call(b.children, function (e) { return e.classList && e.classList.contains('container'); });
        if (cs.length) return { el: cs[cs.length - 1] };
        return null;
    }
    function preencher(p) {
        p.textContent = '';
        var t = document.createElement('span'); t.className = 'mp-credito-txt'; t.textContent = CREDITO; p.appendChild(t);
        if (!/termos\.html$/.test(location.pathname)) {
            var sep = document.createElement('span'); sep.className = 'mp-credito-sep'; sep.textContent = '·'; sep.setAttribute('aria-hidden', 'true');
            var l = document.createElement('a'); l.href = TERMOS_URL; l.textContent = 'Termos de Uso';
            p.appendChild(sep); p.appendChild(l);
        }
    }
    function montar() {
        if (document.querySelector('.mp-credito')) return;
        var a = alvo(); if (!a) return;
        if (!document.getElementById('mp-credito-css')) { var s = document.createElement('style'); s.id = 'mp-credito-css'; s.textContent = css; document.head.appendChild(s); }
        var p;
        if (a.dentro) { p = a.el; p.classList.add('mp-credito'); preencher(p); return; }
        p = document.createElement('p'); p.className = 'mp-credito'; preencher(p);
        a.el.appendChild(p);
        // conteúdo carregado depois (listas, cards) → o crédito continua sendo o ÚLTIMO
        try {
            new MutationObserver(function () { if (p.parentNode === a.el && a.el.lastElementChild !== p) a.el.appendChild(p); })
                .observe(a.el, { childList: true });
        } catch (e) { /* ignore */ }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
