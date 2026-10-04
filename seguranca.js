/* Minera Pará — segurança no navegador (carregar logo depois do config.js).
 *
 * 1) mineraSafeUrl(url): só deixa passar links seguros (https/http, blob:, data:image|audio|video,
 *    mailto:, tel:, caminhos do próprio app). Qualquer outra coisa (javascript:, vbscript:, data:text/html…)
 *    vira '#'. Use em todo href/src montado com dado do usuário.
 *
 * 2) Mídia privada do Storage "chat-midia": o link público antigo
 *    (…/storage/v1/object/public/chat-midia/<pasta>) é trocado na hora por um link ASSINADO
 *    (createSignedUrls, válido por algumas horas). Vale para fotos/áudios/vídeos/documentos do chat
 *    (mensagens novas e antigas), fotos/vídeo de anúncio e banners do Início — sem mudar o que está
 *    gravado no banco. Funciona com o bucket público (antes do SQL 58) e privado (depois).
 *    Se não conseguir assinar, mantém o link original.
 */
(function () {
    'use strict';

    /* ---------------- 1) URLs seguras ---------------- */
    function mineraSafeUrl(u) {
        var s = String(u == null ? '' : u).trim();
        if (!s) return '';
        var semCtrl = s.replace(/[\u0000-\u0020\u007f]+/g, '');
        if (/^(https?:|blob:|mailto:|tel:)/i.test(semCtrl)) return s;
        if (/^data:(image|audio|video)\//i.test(semCtrl)) return s;
        if (/^[a-z][a-z0-9+.-]*:/i.test(semCtrl)) return '#';   // javascript:, vbscript:, data:text/html, file:…
        return s;                                                 // relativo (página do app, #âncora, ?query)
    }
    window.mineraSafeUrl = mineraSafeUrl;

    /* ---------------- 2) Mídia privada (links assinados) ---------------- */
    var BUCKET = 'chat-midia';
    var TTL_S = 6 * 3600;                 // validade do link assinado
    var MARGEM_MS = 20 * 60 * 1000;       // renova 20 min antes de vencer
    var LS = 'minera_midia_assinada_v1';
    var ATTRS = ['src', 'href', 'poster', 'data-src', 'data-lightbox-src'];
    var PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

    function baseUrl() {
        try { return String(SUPABASE_URL || '').replace(/\/+$/, ''); } catch (e) { return ''; }
    }
    function marcaPub() { return baseUrl() + '/storage/v1/object/public/' + BUCKET + '/'; }
    function pathDe(url) {
        var s = String(url || ''), m = marcaPub();
        if (!baseUrl() || s.indexOf(m) !== 0) return null;
        var p = s.slice(m.length).split('#')[0].split('?')[0];
        try { p = decodeURIComponent(p); } catch (e) { /* ignore */ }
        return p || null;
    }
    function fragDe(url) { var s = String(url || ''), i = s.indexOf('#'); return i >= 0 ? s.slice(i) : ''; }

    var cache = {};
    try { cache = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { cache = {}; }
    var falhou = {};                      // path -> até quando não tentar de novo
    function gravarCache() {
        try {
            var agora = Date.now(), ks = Object.keys(cache);
            ks.forEach(function (k) { if (!cache[k] || cache[k].exp < agora + MARGEM_MS) delete cache[k]; });
            ks = Object.keys(cache);
            if (ks.length > 500) ks.sort(function (a, b) { return cache[a].exp - cache[b].exp; }).slice(0, ks.length - 500).forEach(function (k) { delete cache[k]; });
            localStorage.setItem(LS, JSON.stringify(cache));
        } catch (e) { /* ignore */ }
    }
    function assinadaSync(url) {
        var p = pathDe(url);
        if (!p) return null;
        var c = cache[p];
        if (c && c.exp > Date.now() + MARGEM_MS) return c.u + fragDe(url);
        return null;
    }

    var fila = {};                        // path -> [resolve...]
    var timer = null;
    function agendar() { if (!timer) timer = setTimeout(descarregar, 0); }
    async function descarregar() {
        timer = null;
        var paths = Object.keys(fila);
        if (!paths.length) return;
        var esperando = fila; fila = {};
        var res = {};
        try {
            if (typeof supabaseClient === 'undefined' || !supabaseClient.storage) throw new Error('sem cliente');
            for (var i = 0; i < paths.length; i += 100) {
                var lote = paths.slice(i, i + 100);
                var r = await supabaseClient.storage.from(BUCKET).createSignedUrls(lote, TTL_S);
                (r && r.data || []).forEach(function (x) {
                    if (x && x.path && x.signedUrl && !x.error) res[x.path] = x.signedUrl;
                });
            }
        } catch (e) { /* mantém link original */ }
        var exp = Date.now() + TTL_S * 1000;
        paths.forEach(function (p) {
            if (res[p]) cache[p] = { u: res[p], exp: exp };
            else falhou[p] = Date.now() + 60 * 1000;
            (esperando[p] || []).forEach(function (fn) { try { fn(res[p] || null); } catch (e) { /* ignore */ } });
        });
        gravarCache();
    }
    function assinar(url) {
        var p = pathDe(url);
        if (!p) return Promise.resolve(url);
        var s = assinadaSync(url);
        if (s) return Promise.resolve(s);
        if (falhou[p] && falhou[p] > Date.now()) return Promise.resolve(url);
        return new Promise(function (resolve) {
            (fila[p] = fila[p] || []).push(function (u) { resolve(u ? u + fragDe(url) : url); });
            agendar();
        });
    }

    /* Troca o atributo de um elemento por link assinado */
    function tratar(el, attr) {
        var v = el.getAttribute(attr);
        if (!v || !pathDe(v)) return;
        var s = assinadaSync(v);
        if (s) { el.setAttribute(attr, s); recarregar(el, attr); return; }
        var p = pathDe(v);
        if (falhou[p] && falhou[p] > Date.now()) return;     // fica com o original
        var tag = el.tagName;
        var orig = v;
        if (attr === 'src') {
            if (tag === 'IMG') el.setAttribute('src', PLACEHOLDER);
            else if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'SOURCE') el.removeAttribute('src');
        }
        el.setAttribute('data-mm-' + attr, orig);
        assinar(orig).then(function (u) {
            if (el.getAttribute('data-mm-' + attr) !== orig) return;   // já trocaram o atributo
            el.removeAttribute('data-mm-' + attr);
            el.setAttribute(attr, u || orig);
            recarregar(el, attr);
        });
    }
    // <source> trocado depois de inserido não é relido pelo <audio>/<video>: precisa de load()
    // (com preload="none" o load() não baixa nada; só refaz a escolha da fonte).
    function recarregar(el, attr) {
        if (attr !== 'src' || el.tagName !== 'SOURCE') return;
        var m = el.parentNode;
        if (!m || typeof m.load !== 'function' || !m.paused) return;
        try { m.load(); } catch (e) { /* ignore */ }
    }
    var SELETOR = ATTRS.map(function (a) { return '[' + a + '*="/object/public/' + BUCKET + '/"]'; }).join(',');
    function varrer(raiz) {
        if (!raiz || raiz.nodeType !== 1) return;
        if (raiz.matches && raiz.matches(SELETOR)) ATTRS.forEach(function (a) { if (raiz.hasAttribute(a)) tratar(raiz, a); });
        if (raiz.querySelectorAll) {
            var l = raiz.querySelectorAll(SELETOR);
            for (var i = 0; i < l.length; i++) for (var j = 0; j < ATTRS.length; j++) if (l[i].hasAttribute(ATTRS[j])) tratar(l[i], ATTRS[j]);
        }
    }
    function iniciarObservador() {
        if (typeof MutationObserver === 'undefined' || !document.documentElement) return;
        var mo = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.type === 'attributes') { if (m.target.nodeType === 1) tratar(m.target, m.attributeName); }
                else for (var k = 0; k < m.addedNodes.length; k++) varrer(m.addedNodes[k]);
            }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS });
        varrer(document.documentElement);
    }
    iniciarObservador();
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient.auth && supabaseClient.auth.onAuthStateChange) {
            supabaseClient.auth.onAuthStateChange(function (ev) {
                if (ev === 'SIGNED_OUT') { cache = {}; try { localStorage.removeItem(LS); } catch (e) { /* ignore */ } }
            });
        }
    } catch (e) { /* ignore */ }

    window.MineraMidia = {
        ehPrivada: function (u) { return !!pathDe(u); },
        assinadaSync: assinadaSync,
        /** Promise com o link assinado (ou o original se não precisar/não der). */
        assinar: assinar,
        /** Para fetch()/download: assina se for do chat-midia. */
        urlLegivel: function (u) { return assinar(u); }
    };
})();
