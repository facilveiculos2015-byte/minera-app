let feedCache = [];
let filtroTipo = '';
let filtroStatus = '';
let cotacaoTimer = null;
let ultimoUsdBrl = null;

function tempoRelativo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!t) return '';
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' h';
    const d = Math.floor(h / 24);
    return d + ' d';
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgPlaceholder(tipo) {
    const t = (tipo || '').toLowerCase();
    let emoji = '⛏️';
    if (t === 'ouro') emoji = '🥇';
    else if (t === 'ferro') emoji = '⚙️';
    else if (t === 'cobre') emoji = '🔶';
    return '<div class="lote-img placeholder" aria-hidden="true"><span>' + emoji + '</span></div>';
}

function fmtUsd(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function fmtBrl(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

async function carregarDolar() {
    const data = await fetchJson('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    const bid = parseFloat(data.USDBRL && data.USDBRL.bid);
    if (!bid) throw new Error('sem bid');
    ultimoUsdBrl = bid;
    document.getElementById('cot-dolar').textContent = fmtBrl(bid);
    const pct = data.USDBRL.pctChange;
    document.getElementById('cot-dolar-sub').textContent =
        'AwesomeAPI' + (pct != null ? ' · var ' + pct + '%' : '');
    return bid;
}

async function carregarOuro() {
    // mintedmetal prices.json — gold USD/oz
    try {
        const data = await fetchJson('https://mintedmetal.com/api/prices.json');
        let usd = null;
        if (data && typeof data === 'object') {
            if (data.gold != null) usd = parseFloat(data.gold);
            else if (data.Gold != null) usd = parseFloat(data.Gold);
            else if (data.prices && data.prices.gold != null) usd = parseFloat(data.prices.gold);
            else if (data.XAU != null) usd = parseFloat(data.XAU);
            else {
                // tenta achar primeiro número razoável em gold*
                for (const k of Object.keys(data)) {
                    if (/gold|xau/i.test(k) && typeof data[k] === 'number') {
                        usd = data[k];
                        break;
                    }
                    if (/gold|xau/i.test(k) && data[k] && data[k].price != null) {
                        usd = parseFloat(data[k].price);
                        break;
                    }
                }
            }
        }
        if (usd == null || isNaN(usd)) throw new Error('parse gold');
        const brl = ultimoUsdBrl ? usd * ultimoUsdBrl : null;
        document.getElementById('cot-ouro').textContent = fmtUsd(usd);
        document.getElementById('cot-ouro-sub').textContent =
            'USD/oz spot (mintedmetal)' + (brl ? ' · ' + fmtBrl(brl) : '');
        return usd;
    } catch (e) {
        document.getElementById('cot-ouro').textContent = '—';
        document.getElementById('cot-ouro-sub').textContent = 'CORS/API indisponível · veja LBMA';
        throw e;
    }
}

async function carregarCobre() {
    try {
        const data = await fetchJson('https://metalmetric.com/api/gpt?action=spot_prices');
        let usd = null;
        const tryObj = (obj) => {
            if (!obj || typeof obj !== 'object') return null;
            if (obj.copper != null) return parseFloat(obj.copper);
            if (obj.Copper != null) return parseFloat(obj.Copper);
            if (obj.HG != null) return parseFloat(obj.HG);
            if (obj.CU != null) return parseFloat(obj.CU);
            for (const k of Object.keys(obj)) {
                if (/copper|cobre|hg/i.test(k)) {
                    const v = obj[k];
                    if (typeof v === 'number') return v;
                    if (v && v.price != null) return parseFloat(v.price);
                    if (v && v.usd != null) return parseFloat(v.usd);
                }
            }
            return null;
        };
        usd = tryObj(data) || tryObj(data && data.prices) || tryObj(data && data.spot_prices) || tryObj(data && data.data);
        if (usd == null || isNaN(usd)) throw new Error('parse copper');
        const brl = ultimoUsdBrl ? usd * ultimoUsdBrl : null;
        document.getElementById('cot-cobre').textContent = fmtUsd(usd);
        document.getElementById('cot-cobre-sub').textContent =
            'USD spot (metalmetric)' + (brl ? ' · ' + fmtBrl(brl) : '');
        return usd;
    } catch (e) {
        document.getElementById('cot-cobre').textContent = '—';
        document.getElementById('cot-cobre-sub').textContent = 'CORS/API indisponível · veja LME Copper';
        throw e;
    }
}

async function atualizarCotacoes() {
    const stamp = document.getElementById('cotacoes-atualizado');
    try {
        await carregarDolar();
    } catch (e) {
        document.getElementById('cot-dolar').textContent = '—';
        document.getElementById('cot-dolar-sub').textContent = 'Falha AwesomeAPI';
    }
    try { await carregarOuro(); } catch (e) { /* already set */ }
    try { await carregarCobre(); } catch (e) { /* already set */ }
    if (stamp) {
        stamp.textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR') +
            ' · fontes spot/COMEX/LBMA approx (não LME oficial)';
    }
}

function renderFeed(lista) {
    const box = document.getElementById('feed');
    if (!lista.length) {
        box.innerHTML = '<p>Nenhum lote com esses filtros. Veja <a href="' + APP_ROOT + 'lotes.html">Meus Lotes</a>.</p>';
        return;
    }
    box.innerHTML = '<div class="lote-cards">' + lista.map(lote => {
        const codigo = lote.codigo_lote || '';
        const quando = tempoRelativo(lote.data_entrada);
        const preco = formatPreco(lote.preco);
        let img;
        if (lote.imagem_url) {
            img = '<div class="lote-img"><img src="' + esc(lote.imagem_url) + '" alt="" loading="lazy" onerror="this.onerror=null;this.parentNode.className=\'lote-img placeholder\';this.parentNode.innerHTML=\'<span>⛏️</span>\';"></div>';
        } else {
            img = imgPlaceholder(lote.tipo_minerio);
        }
        return `<article class="lote-card">
            ${img}
            <div class="lote-card-body">
                <div class="lote-card-top">
                    <span class="lote-tipo">${esc(lote.tipo_minerio || 'Minério')}</span>
                    <span class="${statusBadgeClass(lote.status)}">${esc(statusAmigavel(lote.status))}</span>
                </div>
                <h3 class="lote-codigo">${esc(codigo)}</h3>
                <p class="lote-meta">📍 ${esc(lote.origem || '—')} · ⚖️ ${esc(formatPeso(lote.peso_bruto_kg))}</p>
                ${preco ? '<p class="lote-preco">' + esc(preco) + '</p>' : ''}
                <p class="lote-who">${esc(lote.criado_por || 'Usuário')}${quando ? ' · ' + quando : ''}</p>
                <a class="btn-card" href="${APP_ROOT}chat.html?lote=${encodeURIComponent(codigo)}">Negociar / Ver Detalhes</a>
            </div>
        </article>`;
    }).join('') + '</div>';
}

function aplicarFiltros() {
    let lista = feedCache.slice();
    if (filtroTipo) lista = lista.filter(l => (l.tipo_minerio || '') === filtroTipo);
    if (filtroStatus) {
        lista = lista.filter(l => {
            const s = (l.status || '').toLowerCase();
            if (filtroStatus === 'pendente') return s === 'pendente';
            if (filtroStatus === 'em_processo') return s === 'em_processo' || s === 'processado';
            if (filtroStatus === 'expedido') return s === 'expedido';
            return s === filtroStatus;
        });
    }
    renderFeed(lista);
}

function bindChipGroup(containerId, attr, setter) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.addEventListener('click', (e) => {
        const btn = e.target.closest('.fchip');
        if (!btn) return;
        box.querySelectorAll('.fchip').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        setter(btn.getAttribute(attr) || '');
        aplicarFiltros();
    });
}

async function carregarFeed() {
    const box = document.getElementById('feed');
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false })
            .limit(50);
        if (error) throw error;
        feedCache = data || [];
        if (!feedCache.length) {
            box.innerHTML = '<p>Ninguém postou ainda. Seja o primeiro em <a href="' + APP_ROOT + 'lotes.html">Meus Lotes</a>.</p>';
            return;
        }
        aplicarFiltros();
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Não deu pra carregar o feed. Tente sair e entrar de novo.</p>';
    }
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    const perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('inicio', perfil);
    bindChipGroup('filtro-tipo-chips', 'data-tipo', v => { filtroTipo = v; });
    bindChipGroup('filtro-status-chips', 'data-status', v => { filtroStatus = v; });
    const notif = document.getElementById('btn-notif');
    if (notif) notif.addEventListener('click', () => toastMsg('Sem notificações'));
    atualizarCotacoes();
    cotacaoTimer = setInterval(atualizarCotacoes, 60000);
    carregarFeed();
})();

window.addEventListener('beforeunload', () => {
    if (cotacaoTimer) clearInterval(cotacaoTimer);
});
