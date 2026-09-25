/* Minera Pará — card de anúncio compartilhado (Início + Lotes).
 * window.MineraAnuncioCard.html(lote, { meus: false, root: APP_ROOT })
 * window.MineraAnuncioCard.lista(lotes, opts) → '<div class="lote-cards">…</div>'
 * Mesmo markup nos dois lugares para nunca divergirem. Favorito (♡) em localStorage.
 */
(function () {
    'use strict';

    var PAPEIS_LABELS = {
        minerador: 'Minerador',
        comprador: 'Comprador',
        transportador: 'Transportador',
        transportador_mina_britador: 'Transportador (Mina - Britador)',
        transportador_britador_porto: 'Transportador (Britador - Porto)',
        dono_britador: 'Dono de Britador',
        carregamento: 'Carregador',
        admin: 'Admin'
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function ehMaquinario(tipo) { return String(tipo || '').trim() === 'Maquinário'; }
    function statusAmigavel(st) {
        var s = (st || 'pendente').toLowerCase();
        if (s === 'pendente') return 'Disponível';
        if (s === 'em_processo') return 'Em trânsito';
        if (s === 'expedido') return 'Vendido';
        if (s === 'processado') return 'Processado';
        if (s === 'atrasado') return 'Atrasado';
        if (s === 'pago') return 'Pago';
        return s;
    }
    function statusBadgeClass(st) { return 'badge badge-' + (st || 'pendente').toLowerCase(); }
    function formatPeso(kg) {
        var n = Number(kg) || 0;
        if (n >= 1000) return n + ' kg (' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 2) + ' t)';
        return n + ' kg';
    }
    function formatPreco(p) {
        if (p == null || p === '' || isNaN(Number(p))) return null;
        return Number(p).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    function rotuloPapel(papel) {
        if (!papel) return '';
        return PAPEIS_LABELS[String(papel).toLowerCase()] || papel;
    }
    function badgePublicadoComo(papel) {
        if (!papel) return '';
        return '<span class="lote-papel-badge">' + esc(rotuloPapel(papel)) + '</span>';
    }
    function loteLocalMeta(l) {
        var bits = [];
        if (l.cidade && l.estado) bits.push(l.cidade + '-' + String(l.estado).toUpperCase());
        else if (l.cidade) bits.push(l.cidade);
        else if (l.estado) bits.push(String(l.estado).toUpperCase());
        if (l.ddd) bits.push('DDD ' + l.ddd);
        if (l.origem) bits.push(l.origem);
        return bits.length ? bits.join(' · ') : '—';
    }
    /** Marketplace: pendente/disponível/em trânsito — não expedido (vendido). */
    function disponivelMkt(l) {
        return String(l && l.status != null ? l.status : '').toLowerCase() !== 'expedido';
    }
    function precoOuTeor(l) {
        if (l.teor != null && l.teor !== '') {
            return 'Teor: ' + String(l.teor) + (String(l.tipo_minerio || '').toLowerCase() === 'cobre' && l.cobre_tipo
                ? ' (' + (l.cobre_tipo === 'soluvel' ? 'solúvel' : 'total') + ')' : '');
        }
        return formatPreco(l.preco);
    }

    /* Favoritos (antes só no card do Início) */
    function favKey(codigo) { return 'minera_fav_' + String(codigo || ''); }
    function isFav(codigo) {
        try { return localStorage.getItem(favKey(codigo)) === '1'; } catch (e) { return false; }
    }
    function toggleFav(codigo, btn) {
        var on = !isFav(codigo);
        try {
            if (on) localStorage.setItem(favKey(codigo), '1');
            else localStorage.removeItem(favKey(codigo));
        } catch (e) { /* ignore */ }
        if (btn) {
            btn.classList.toggle('on', on);
            btn.textContent = on ? '♥' : '♡';
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function html(l, opts) {
        opts = opts || {};
        var meus = !!opts.meus;
        var root = opts.root != null ? opts.root : (typeof APP_ROOT === 'string' ? APP_ROOT : '');
        var codigo = l.codigo_lote || '';
        var det = root + 'lote-detalhe.html?codigo=' + encodeURIComponent(codigo);
        var preco = precoOuTeor(l);
        var fav = !meus && opts.fav !== false;
        var favOn = fav && isFav(codigo);
        var heart = fav
            ? '<button type="button" class="olx-heart lote-heart' + (favOn ? ' on' : '') + '" data-fav="' + esc(codigo) + '" aria-label="Favorito" aria-pressed="' + (favOn ? 'true' : 'false') + '">' + (favOn ? '♥' : '♡') + '</button>'
            : '';
        var img = l.imagem_url
            ? '<a class="lote-img" href="' + det + '" aria-label="Ver anúncio ' + esc(codigo) + '"><img src="' + esc(l.imagem_url) + '" alt="" loading="lazy" onerror="this.remove()">' + heart + '</a>'
            : '<a class="lote-img placeholder" href="' + det + '" aria-label="Ver anúncio ' + esc(codigo) + '"><span>' + (ehMaquinario(l.tipo_minerio) ? '🧰' : '⛏️') + '</span>' + heart + '</a>';
        var actions;
        if (meus) {
            actions = '<div class="card-actions">' +
                '<button type="button" class="btn-sm" data-act="edit" data-id="' + esc(l.id) + '">Editar</button>' +
                '<button type="button" class="btn-sm btn-danger" data-act="del" data-id="' + esc(l.id) + '">Excluir</button>' +
                '<button type="button" class="btn-sm btn-ok" data-act="vendido" data-id="' + esc(l.id) + '">Marcar como Vendido</button>' +
                '</div>';
        } else {
            var nego = root + 'chat.html?' +
                (l.criado_por_id ? ('com=' + encodeURIComponent(l.criado_por_id) + '&') : '') +
                'lote=' + encodeURIComponent(codigo);
            actions = '<div class="card-actions">' +
                '<a class="btn-sm" href="' + det + '">Ver anúncio</a>' +
                '<a class="btn-sm btn-ok" href="' + nego + '">Negociar</a>' +
                '</div>';
        }
        var anunciante = !meus && l.criado_por ? '<p class="lote-meta">Anunciante: ' + esc(l.criado_por) + '</p>' : '';
        return '<article class="lote-card" data-id="' + esc(l.id) + '" data-codigo="' + esc(codigo) + '">' +
            img +
            '<div class="lote-card-body">' +
            '<div class="lote-card-top">' +
            '<span class="lote-tipo">' + esc(l.tipo_minerio || 'Minério') + '</span>' +
            badgePublicadoComo(l.publicado_como) +
            '<span class="' + statusBadgeClass(l.status) + '">' + esc(statusAmigavel(l.status)) + '</span>' +
            '</div>' +
            '<h3 class="lote-codigo"><a href="' + det + '">' + esc(codigo) + '</a></h3>' +
            '<p class="lote-meta">📍 ' + esc(loteLocalMeta(l)) + (ehMaquinario(l.tipo_minerio) ? '' : (' · ⚖️ ' + esc(formatPeso(l.peso_bruto_kg)))) + '</p>' +
            anunciante +
            (preco ? '<p class="lote-preco">' + esc(preco) + '</p>' : '') +
            actions +
            '</div>' +
            '</article>';
    }

    function lista(lotes, opts) {
        return '<div class="lote-cards">' + (lotes || []).map(function (l) { return html(l, opts); }).join('') + '</div>';
    }

    // Favorito: delegado (funciona em qualquer página que use o card)
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest && e.target.closest('.lote-card [data-fav]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        toggleFav(btn.getAttribute('data-fav'), btn);
    }, true);

    window.MineraAnuncioCard = {
        html: html,
        lista: lista,
        disponivelMkt: disponivelMkt,
        precoOuTeor: precoOuTeor,
        isFav: isFav,
        toggleFav: toggleFav,
        helpers: {
            esc: esc, ehMaquinario: ehMaquinario, statusAmigavel: statusAmigavel, statusBadgeClass: statusBadgeClass,
            formatPeso: formatPeso, formatPreco: formatPreco, badgePublicadoComo: badgePublicadoComo,
            loteLocalMeta: loteLocalMeta, rotuloPapel: rotuloPapel
        }
    };
})();
