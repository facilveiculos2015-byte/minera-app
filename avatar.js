/* Minera Pará — foto de perfil (window.MineraAvatar)
 * Tipos: 'iniciais' | 'avatar' (desenho pronto, avatar_url = 'preset:<id>') | 'foto' | 'empresa' (bucket 'avatares').
 * Em qualquer lugar: <span class="mav" data-av-id="<auth_id>" data-av-nome="Nome">AB</span>
 * → hidratado sozinho (MutationObserver) com a foto/desenho; erro de imagem ou SQL 47 ausente = iniciais.
 */
(function () {
    'use strict';
    if (window.MineraAvatar) return;

    var LS = 'minera_avatares_v1';
    var TTL = 10 * 60 * 1000;          // revalida a cada 10 min
    var cache = {};                     // auth_id → { u: url|null, t: tipo, ts }
    var semSql = false;                 // SQL 47 ausente → só iniciais
    try { cache = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { cache = {}; }
    // Lembra por 15 min que o SQL 47 não existe (evita um 404 por página).
    try { var _ss = Number(localStorage.getItem('minera_av_sem_sql') || 0); semSql = _ss > 0 && (Date.now() - _ss) < 15 * 60 * 1000; } catch (e) { /* ignore */ }

    /* ---------- desenhos prontos (cores do app) ---------- */
    var O = '#F5A623', N = '#0b1220', C = '#1e293b', B = '#f8fafc';
    function svg(bg, inner) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="' + bg + '"/>' + inner + '</svg>';
    }
    var PRESETS = [
        { id: 'picareta', nome: 'Picareta', s: svg(N, '<path d="M14 22c10-9 26-9 36 0-9-4-27-4-36 0z" fill="' + O + '"/><rect x="29" y="19" width="6" height="32" rx="3" transform="rotate(-8 32 35)" fill="' + B + '"/>') },
        { id: 'escavadeira', nome: 'Escavadeira', s: svg(C, '<rect x="12" y="38" width="26" height="8" rx="4" fill="' + B + '"/><rect x="16" y="28" width="16" height="11" rx="2" fill="' + O + '"/><path d="M31 30l12-10 7 4-10 9z" fill="' + O + '"/><path d="M47 22l6 10h-9z" fill="' + B + '"/><circle cx="17" cy="42" r="2" fill="' + N + '"/><circle cx="33" cy="42" r="2" fill="' + N + '"/>') },
        { id: 'caminhao', nome: 'Caminhão', s: svg(O, '<rect x="10" y="24" width="28" height="16" rx="2" fill="' + N + '"/><path d="M38 28h8l6 7v5H38z" fill="' + N + '"/><circle cx="18" cy="43" r="4" fill="' + B + '"/><circle cx="44" cy="43" r="4" fill="' + B + '"/><path d="M12 24l6-6h14l6 6z" fill="#b45309"/>') },
        { id: 'minerio', nome: 'Minério', s: svg(N, '<path d="M32 12l14 10-4 18-10 10-10-10-4-18z" fill="' + O + '"/><path d="M32 12l-4 28 4 10 4-10z" fill="#fcd34d" opacity=".7"/><path d="M18 22l14 6 14-6" stroke="' + N + '" stroke-width="1.5" fill="none" opacity=".5"/>') },
        { id: 'pepita', nome: 'Pepita', s: svg(C, '<path d="M18 38c-2-8 5-16 14-16 9-1 16 6 14 14-1 7-10 10-17 9-6 0-10-2-11-7z" fill="' + O + '"/><circle cx="27" cy="31" r="3" fill="#fde68a"/><circle cx="37" cy="36" r="2" fill="#fde68a"/>') },
        { id: 'serra', nome: 'Serra', s: svg('#0f172a', '<path d="M6 48l16-22 9 12 7-9 20 19z" fill="' + O + '"/><path d="M22 26l5 7-5-2-4 4z" fill="' + B + '"/><circle cx="46" cy="18" r="5" fill="#fde68a"/>') },
        { id: 'capacete', nome: 'Capacete', s: svg(O, '<path d="M14 40c0-11 8-20 18-20s18 9 18 20z" fill="' + N + '"/><rect x="10" y="40" width="44" height="6" rx="3" fill="' + N + '"/><rect x="29" y="16" width="6" height="12" rx="2" fill="' + N + '"/><rect x="26" y="32" width="12" height="6" rx="2" fill="' + O + '"/>') },
        { id: 'aperto', nome: 'Negócio', s: svg(C, '<path d="M10 32l10-8 8 4 8-4 8 2 10 6-12 10-6-4-6 4-8-4z" fill="' + O + '"/><path d="M28 28l8 8M32 26l8 8" stroke="' + N + '" stroke-width="2"/>') },
        { id: 'grafico', nome: 'Lucro', s: svg(N, '<rect x="14" y="36" width="8" height="12" rx="1" fill="' + B + '"/><rect x="28" y="28" width="8" height="20" rx="1" fill="' + B + '"/><rect x="42" y="18" width="8" height="30" rx="1" fill="' + O + '"/><path d="M14 30l14-8 8 4 14-12" stroke="' + O + '" stroke-width="3" fill="none" stroke-linecap="round"/>') },
        { id: 'britador', nome: 'Britador', s: svg('#334155', '<path d="M16 18h32l-8 14H24z" fill="' + O + '"/><rect x="24" y="32" width="16" height="6" fill="' + B + '"/><circle cx="20" cy="46" r="3" fill="' + O + '"/><circle cx="30" cy="48" r="2.5" fill="' + O + '"/><circle cx="40" cy="46" r="3.5" fill="' + O + '"/>') },
        { id: 'floresta', nome: 'Pará', s: svg('#14532d', '<path d="M20 46l8-22 8 22z" fill="#4ade80"/><path d="M34 46l8-18 8 18z" fill="#22c55e"/><rect x="27" y="46" width="2" height="6" fill="' + O + '"/><rect x="41" y="46" width="2" height="6" fill="' + O + '"/><path d="M8 52h48" stroke="' + O + '" stroke-width="3"/>') },
        { id: 'navio', nome: 'Porto', s: svg('#0c4a6e', '<path d="M12 38h40l-6 10H18z" fill="' + B + '"/><rect x="20" y="28" width="10" height="10" fill="' + O + '"/><rect x="32" y="24" width="10" height="14" fill="#fb923c"/><path d="M8 52c6-3 10 3 16 0s10 3 16 0 10 3 16 0" stroke="#7dd3fc" stroke-width="2" fill="none"/>') }
    ];
    var PRESET_MAP = {};
    PRESETS.forEach(function (p) { PRESET_MAP[p.id] = p; p.data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p.s); });

    function iniciais(n) {
        var parts = String(n || '?').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    /** URL exibível (preset → data-URL; foto → URL pública; nada externo) */
    function srcDe(url) {
        if (!url) return '';
        var m = /^preset:([a-z0-9_-]+)$/.exec(url);
        if (m) return PRESET_MAP[m[1]] ? PRESET_MAP[m[1]].data : '';
        if (/^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/avatares\//.test(url)) return url;
        return '';
    }
    function salvarCache() { try { localStorage.setItem(LS, JSON.stringify(cache)); } catch (e) { /* cota */ } }
    function registrar(id, url, tipo) {
        if (!id) return;
        cache[id] = { u: url || null, t: tipo || (url ? 'foto' : 'iniciais'), ts: Date.now() };
        salvarCache();
    }
    /** Aplica no elemento: <img> redondo ou iniciais */
    function pintar(el) {
        if (!el || !el.getAttribute) return;
        var id = el.getAttribute('data-av-id');
        var nome = el.getAttribute('data-av-nome') || el.textContent || '?';
        var c = id ? cache[id] : null;
        var src = c ? srcDe(c.u) : '';
        var chave = src || ('i:' + nome);
        if (el._avChave === chave) return;
        el._avChave = chave;
        if (src) {
            el.classList.add('mav-on');
            el.classList.toggle('mav-empresa', c.t === 'empresa');
            el.innerHTML = '<img class="mav-img" alt="" decoding="async" src="' + esc(src) + '">';
        } else {
            el.classList.remove('mav-on', 'mav-empresa');
            el.textContent = iniciais(nome);
        }
    }
    // imagem quebrada → iniciais (e esquece a URL)
    document.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.classList.contains('mav-img')) return;
        var el = img.parentNode; if (!el) return;
        var id = el.getAttribute('data-av-id');
        if (id && cache[id]) { cache[id].u = null; cache[id].t = 'iniciais'; salvarCache(); }
        el._avChave = null; pintar(el);
    }, true);

    /* ---------- busca em lote (RPC SQL 47) ---------- */
    var pedidos = {}, timer = null, emVoo = false;
    function pedir(id) {
        if (!id || semSql) return;
        var c = cache[id];
        if (c && Date.now() - c.ts < TTL) return;
        pedidos[id] = 1;
        if (!timer) timer = setTimeout(buscar, 60);
    }
    async function buscar() {
        timer = null;
        if (emVoo || typeof supabaseClient === 'undefined') { if (!timer) timer = setTimeout(buscar, 400); return; }
        var ids = Object.keys(pedidos).filter(function (x) { return /^[0-9a-f-]{36}$/i.test(x); }).slice(0, 300);
        pedidos = {};
        if (!ids.length) return;
        emVoo = true;
        try {
            var r = await supabaseClient.rpc('avatares_publicos', { p_ids: ids });
            if (r.error) {
                if (String(r.error.code) === 'PGRST202' || /avatares_publicos/.test(r.error.message || '')) {
                    semSql = true; try { localStorage.setItem('minera_av_sem_sql', String(Date.now())); } catch (e) { /* ignore */ }
                }
                return;
            }
            var vistos = {};
            (r.data || []).forEach(function (x) { vistos[x.auth_id] = 1; registrar(x.auth_id, x.avatar_url, x.avatar_tipo); });
            ids.forEach(function (id) { if (!vistos[id]) registrar(id, null, 'iniciais'); });
            hidratar(document);
        } catch (e) { /* offline: tenta depois */ } finally {
            emVoo = false;
            if (Object.keys(pedidos).length && !timer) timer = setTimeout(buscar, 60);
        }
    }
    function hidratar(root) {
        var lista = (root && root.querySelectorAll) ? root.querySelectorAll('[data-av-id]') : [];
        for (var i = 0; i < lista.length; i++) { pintar(lista[i]); pedir(lista[i].getAttribute('data-av-id')); }
        if (root && root.getAttribute && root.getAttribute('data-av-id')) { pintar(root); pedir(root.getAttribute('data-av-id')); }
    }
    function html(id, nome, cls) {
        var c = id ? cache[id] : null;
        var src = c ? srcDe(c.u) : '';
        var inner = src ? '<img class="mav-img" alt="" decoding="async" src="' + esc(src) + '">' : esc(iniciais(nome));
        return '<span class="mav' + (src ? ' mav-on' : '') + (src && c.t === 'empresa' ? ' mav-empresa' : '') + (cls ? ' ' + cls : '') +
            '" data-av-id="' + esc(id || '') + '" data-av-nome="' + esc(nome || '') + '" aria-hidden="true">' + inner + '</span>';
    }
    /** Marca um elemento existente (ex.: .wa-av, .bn-avatar) como avatar do usuário id */
    function marcar(el, id, nome) {
        if (!el) return;
        el.classList.add('mav');
        if (id) el.setAttribute('data-av-id', id); else el.removeAttribute('data-av-id');
        el.setAttribute('data-av-nome', nome || '');
        el._avChave = null;
        pintar(el); pedir(id);
    }
    function iniciarObserver() {
        if (!document.body || typeof MutationObserver === 'undefined') return;
        hidratar(document);
        new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.type === 'attributes') { m.target._avChave = null; pintar(m.target); pedir(m.target.getAttribute('data-av-id')); continue; }
                for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1) hidratar(n); }
            }
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-av-id', 'data-av-nome'] });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarObserver); else iniciarObserver();

    window.MineraAvatar = {
        PRESETS: PRESETS, srcDe: srcDe, iniciais: iniciais, html: html, marcar: marcar, pintar: pintar,
        hidratar: hidratar, registrar: registrar, semSql: function () { return semSql; },
        info: function (id) { return cache[id] || null; },
        /** perfil próprio (getPerfil) já traz avatar_* quando o SQL 47 existe */
        doPerfil: function (p) {
            if (!p || !p.auth_id) return;
            if (p.avatar_sql === false) { // coluna ausente → SQL 47 não aplicado; não chama a RPC (evita 404)
                semSql = true; try { localStorage.setItem('minera_av_sem_sql', String(Date.now())); } catch (e) { /* ignore */ }
                return;
            }
            if (p.avatar_tipo !== undefined || p.avatar_url !== undefined) { if (semSql) { semSql = false; try { localStorage.removeItem('minera_av_sem_sql'); } catch (e) { /* ignore */ } } registrar(p.auth_id, p.avatar_url || null, p.avatar_tipo || 'iniciais'); hidratar(document); }
        },
        esquecerSemSql: function () { semSql = false; try { localStorage.removeItem('minera_av_sem_sql'); } catch (e) { /* ignore */ } }
    };
})();
