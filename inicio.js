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

const COT_LINKS = [
    { id: 'link-lme-copper', href: 'https://www.lme.com/en/Metals/Non-ferrous/LME-Copper', label: 'LME Copper' },
    { id: 'link-lme-home', href: 'https://www.lme.com/', label: 'LME Home' },
    { id: 'link-gold-lbma', href: 'https://www.lbma.org.uk/prices-and-data/precious-metal-prices', label: 'Gold LBMA' }
];
const LS_OURO = 'minera_cot_ouro_usd';
const LS_COBRE = 'minera_cot_cobre_usd';


const URL_GOLD_API_XAU = 'https://api.gold-api.com/price/XAU';
const URL_GOLD_API_HG = 'https://api.gold-api.com/price/HG';
const URL_MINTED = 'https://mintedmetal.com/api/prices.json';
const URL_METALMETRIC = 'https://metalmetric.com/api/gpt?action=spot_prices';
const URL_COINBASE_XAU = 'https://api.coinbase.com/v2/prices/XAU-USD/spot';
const URL_YAHOO_HG = 'https://query1.finance.yahoo.com/v8/finance/chart/HG=F?interval=1d&range=5d';

function garantirLinksCotacoes() {
    const box = document.querySelector('.cotacoes-links');
    if (!box) return;
    COT_LINKS.forEach(spec => {
        let a = document.getElementById(spec.id);
        if (!a) {
            a = Array.from(box.querySelectorAll('a')).find(el =>
                (el.textContent || '').trim() === spec.label
            );
        }
        if (!a) {
            a = document.createElement('a');
            a.id = spec.id;
            a.textContent = spec.label;
            box.appendChild(a);
        }
        a.href = spec.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('href', spec.href);
    });
}

async function fetchJson(url, opts) {
    const res = await fetch(url, Object.assign({ cache: 'no-store' }, opts || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    // jina/proxy may wrap JSON in markdown
    let raw = text.trim();
    if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    const mdIdx = raw.indexOf('Markdown Content:');
    if (mdIdx >= 0) raw = raw.slice(mdIdx + 'Markdown Content:'.length).trim();
    try {
        return JSON.parse(raw);
    } catch (e) {
        // try extract first {...}
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
        if (ct.includes('json')) throw e;
        throw new Error('not json');
    }
}

function viaProxyUrl(target) {
    return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(target);
}

async function fetchJsonMulti(urls) {
    let lastErr = null;
    for (const item of urls) {
        const url = typeof item === 'string' ? item : item.url;
        const viaProxy = !!(item && item.viaProxy);
        try {
            const data = await fetchJson(url);
            return { data, viaProxy, url };
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('all endpoints failed');
}

function parseGoldUsd(data) {
    if (data == null) return null;
    if (typeof data === 'number') return data;
    if (typeof data !== 'object') return null;
    // gold-api.com: { price, name, symbol }
    if (data.price != null && /xau|gold/i.test(String(data.symbol || data.name || ''))) {
        const n = parseFloat(data.price);
        if (!isNaN(n)) return n;
    }
    // Coinbase
    if (data.data && data.data.amount != null && /xau/i.test(String(data.data.base || 'XAU'))) {
        const n = parseFloat(data.data.amount);
        if (!isNaN(n)) return n;
    }
    // mintedmetal: metals.gold.price
    if (data.metals && data.metals.gold) {
        const g = data.metals.gold;
        if (typeof g === 'number') return g;
        if (g && g.price != null) return parseFloat(g.price);
    }
    if (data.gold != null) {
        if (typeof data.gold === 'number') return data.gold;
        if (data.gold.price != null) return parseFloat(data.gold.price);
        const n = parseFloat(data.gold);
        if (!isNaN(n)) return n;
    }
    if (data.Gold != null) return parseFloat(data.Gold);
    if (data.prices && data.prices.gold != null) {
        const g = data.prices.gold;
        return typeof g === 'object' ? parseFloat(g.price) : parseFloat(g);
    }
    if (data.XAU != null) {
        const x = data.XAU;
        return typeof x === 'object' ? parseFloat(x.price || x.usd) : parseFloat(x);
    }
    for (const k of Object.keys(data)) {
        if (!/gold|xau/i.test(k)) continue;
        const v = data[k];
        if (typeof v === 'number') return v;
        if (v && typeof v === 'object') {
            if (v.price != null) return parseFloat(v.price);
            if (v.usd != null) return parseFloat(v.usd);
            if (v.amount != null) return parseFloat(v.amount);
        }
    }
    return null;
}

function parseCopperUsd(data) {
    if (data == null) return null;
    if (typeof data === 'number') return data;
    if (typeof data !== 'object') return null;
    // gold-api.com: { price, name, symbol }
    if (data.price != null && /hg|copper|cobre/i.test(String(data.symbol || data.name || ''))) {
        const n = parseFloat(data.price);
        if (!isNaN(n)) return n;
    }
    // Yahoo chart
    try {
        const meta = data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
        if (meta && meta.regularMarketPrice != null) {
            const n = parseFloat(meta.regularMarketPrice);
            if (!isNaN(n)) return n;
        }
    } catch (e) { /* ignore */ }
    const tryObj = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.copper != null) {
            const v = obj.copper;
            return typeof v === 'object' ? parseFloat(v.price || v.usd) : parseFloat(v);
        }
        if (obj.Copper != null) return parseFloat(obj.Copper);
        if (obj.HG != null) return parseFloat(obj.HG);
        if (obj.CU != null) return parseFloat(obj.CU);
        for (const k of Object.keys(obj)) {
            if (/copper|cobre|\bhg\b|xcu/i.test(k)) {
                const v = obj[k];
                if (typeof v === 'number') return v;
                if (v && v.price != null) return parseFloat(v.price);
                if (v && v.usd != null) return parseFloat(v.usd);
            }
        }
        return null;
    };
    return tryObj(data) || tryObj(data.prices) || tryObj(data.spot_prices) || tryObj(data.data) || tryObj(data.metals);
}

function readLsNumber(key) {
    try {
        const v = parseFloat(localStorage.getItem(key));
        return isNaN(v) ? null : v;
    } catch (e) { return null; }
}

function writeLsNumber(key, n) {
    try { localStorage.setItem(key, String(n)); } catch (e) { /* ignore */ }
}

function showMetal(elValor, elSub, usd, label, viaProxy, fromCache, options) {
    const brl = ultimoUsdBrl != null ? usd * ultimoUsdBrl : null;
    document.getElementById(elValor).textContent = fmtUsd(usd);
    let sub = label;
    if (viaProxy) sub += ' · via proxy';
    if (fromCache) sub += ' · última conhecida';
    if (brl != null) sub += ' · ' + fmtBrl(brl);
    if (options && options.usdPerTon) sub += ' · aprox. ' + fmtUsd(usd * 2204.62) + '/t';
    document.getElementById(elSub).textContent = sub;
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
    garantirLinksCotacoes();
    const endpoints = [
        { url: URL_GOLD_API_XAU, viaProxy: false },
        { url: URL_MINTED, viaProxy: false },
        { url: URL_COINBASE_XAU, viaProxy: false },
        { url: viaProxyUrl(URL_MINTED), viaProxy: true },
        { url: viaProxyUrl(URL_COINBASE_XAU), viaProxy: true }
    ];
    try {
        const { data, viaProxy } = await fetchJsonMulti(endpoints);
        const usd = parseGoldUsd(data);
        if (usd == null || isNaN(usd)) throw new Error('parse gold');
        writeLsNumber(LS_OURO, usd);
        showMetal('cot-ouro', 'cot-ouro-sub', usd, 'USD/oz spot', viaProxy, false);
        return usd;
    } catch (e) {
        const cached = readLsNumber(LS_OURO);
        if (cached != null) {
            showMetal('cot-ouro', 'cot-ouro-sub', cached, 'USD/oz spot', false, true);
            return cached;
        }
        document.getElementById('cot-ouro').textContent = '—';
        document.getElementById('cot-ouro-sub').textContent = 'CORS/API indisponível · veja LBMA';
        throw e;
    }
}

async function carregarCobre() {
    garantirLinksCotacoes();
    const endpoints = [
        { url: URL_GOLD_API_HG, viaProxy: false },
        { url: URL_METALMETRIC, viaProxy: false },
        { url: URL_YAHOO_HG, viaProxy: false },
        { url: viaProxyUrl(URL_METALMETRIC), viaProxy: true },
        { url: viaProxyUrl(URL_YAHOO_HG), viaProxy: true }
    ];
    try {
        const { data, viaProxy } = await fetchJsonMulti(endpoints);
        const usd = parseCopperUsd(data);
        if (usd == null || isNaN(usd)) throw new Error('parse copper');
        writeLsNumber(LS_COBRE, usd);
        showMetal('cot-cobre', 'cot-cobre-sub', usd, 'USD/lb COMEX', viaProxy, false, { usdPerTon: true });
        return usd;
    } catch (e) {
        const cached = readLsNumber(LS_COBRE);
        if (cached != null) {
            showMetal('cot-cobre', 'cot-cobre-sub', cached, 'USD/lb COMEX', false, true, { usdPerTon: true });
            return cached;
        }
        document.getElementById('cot-cobre').textContent = '—';
        document.getElementById('cot-cobre-sub').textContent = 'CORS/API indisponível · veja LME Copper';
        throw e;
    }
}

async function atualizarCotacoes() {
    garantirLinksCotacoes();
    const stamp = document.getElementById('cotacoes-atualizado');
    let dolar = null, ouro = null, cobre = null;
    try {
        dolar = await carregarDolar();
    } catch (e) {
        document.getElementById('cot-dolar').textContent = '—';
        document.getElementById('cot-dolar-sub').textContent = 'Falha AwesomeAPI';
    }
    try { ouro = await carregarOuro(); } catch (e) { /* already set */ }
    try { cobre = await carregarCobre(); } catch (e) { /* already set */ }
    garantirLinksCotacoes();
    if (stamp) {
        stamp.textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR') +
            ' · spot approx';
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
    let perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('inicio', perfil);
    if (typeof montarCardFamilia === 'function') {
        perfil = await montarCardFamilia(document.querySelector('.container'), perfil, 'inicio') || perfil;
    }
    if (typeof checarTutorialPrimeiroAcesso === 'function') checarTutorialPrimeiroAcesso();
    if (typeof aplicarTema === 'function') aplicarTema(typeof lerTema === 'function' ? lerTema() : 'dark');
    bindChipGroup('filtro-tipo-chips', 'data-tipo', v => { filtroTipo = v; });
    bindChipGroup('filtro-status-chips', 'data-status', v => { filtroStatus = v; });
    // Notificações: MineraNotif (nav.js) liga o sino / badge de DMs
    atualizarCotacoes();
    cotacaoTimer = setInterval(atualizarCotacoes, 60000);
    carregarFeed();
})();

window.addEventListener('beforeunload', () => {
    if (cotacaoTimer) clearInterval(cotacaoTimer);
});
