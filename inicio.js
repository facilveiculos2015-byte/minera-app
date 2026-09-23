let feedCache = [];
let filtroTipo = '';
let filtroBusca = '';
let filtroStatus = '';
/** modo local: todos | estado | cidade | ddd */
let filtroLocMode = 'todos';
let filtroEstado = '';
let filtroCidade = '';
let filtroDdd = '';
/** papel / publicado_como: '' | minerador | comprador | transportador | dono_britador | carregamento */
let filtroServico = '';
/** geo detectada no open: {cidade, estado, ddd} ou null */
let geoPerto = null;
const LS_FILTROS_ABERTOS = 'minera_filtros_abertos';
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

function filtrarLotesVisiveis(rows) {
    return (rows || []).filter(l => !(l.oculto === true || l.oculto === 't' || l.oculto === 'true'));
}

async function carregarBannersPromos() {
    const track = document.getElementById('olx-banner-track');
    const banner = document.getElementById('olx-banner');
    if (!track) return;
    /* Banner marketing estático (arte Família Minera) — sempre primeiro */
    const BANNER_MKT = {
        tipo: 'banner',
        titulo: '',
        texto: '',
        imagem_url: 'media/banner-familia-minera.jpg?v=20260923x',
        link: '',
        _full: true
    };
    function slideHtml(p) {
        const full = !!(p._full || (p.imagem_url && !p.titulo && !p.texto));
        if (full && p.imagem_url) {
            const img = `<img src="${esc(p.imagem_url)}" alt="Minera Pará" class="olx-banner-fullimg" loading="lazy">`;
            if (p.link) return `<a class="olx-banner-slide olx-banner-slide--full" href="${esc(p.link)}">${img}</a>`;
            return `<div class="olx-banner-slide olx-banner-slide--full">${img}</div>`;
        }
        const title = esc(p.titulo || (p.tipo === 'oferta' ? 'Oferta' : 'Destaque'));
        const texto = esc(p.texto || '');
        const img = p.imagem_url ? `<img src="${esc(p.imagem_url)}" alt="" class="olx-banner-img" loading="lazy">` : '';
        const inner = `${img}<strong>${title}</strong>${texto ? '<span>' + texto + '</span>' : ''}`;
        if (p.link) return `<a class="olx-banner-slide" href="${esc(p.link)}">${inner}</a>`;
        return `<div class="olx-banner-slide">${inner}</div>`;
    }
    try {
        const { data, error } = await supabaseClient
            .from('app_promos')
            .select('id,tipo,titulo,texto,imagem_url,link,ordem')
            .eq('ativo', true)
            .order('ordem', { ascending: true })
            .limit(12);
        if (error) throw error;
        const rows = [BANNER_MKT].concat(data || []);
        if (banner) banner.classList.remove('oculto');
        track.innerHTML = rows.map(slideHtml).join('');
        if (track._promoTimer) {
            clearInterval(track._promoTimer);
            track._promoTimer = null;
        }
        let i = 0;
        track.style.transform = 'translateX(0)';
        track._promoTimer = setInterval(() => {
            const n = track.children.length || 1;
            i = (i + 1) % n;
            track.style.transform = 'translateX(-' + (i * 100) + '%)';
        }, 4200);
    } catch (e) {
        console.warn('promos', e);
        /* Mesmo sem app_promos, mostra o banner de marketing */
        if (banner) banner.classList.remove('oculto');
        track.innerHTML = slideHtml(BANNER_MKT);
    }
}



function imgPlaceholder(tipo) {
    const t = (tipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let cls = 'default';
    if (t === 'ouro') cls = 'ouro';
    else if (t === 'ferro') cls = 'ferro';
    else if (t === 'cobre') cls = 'cobre';
    else if (t === 'niquel') cls = 'niquel';
    return '<div class="lote-img placeholder" aria-hidden="true"><span class="min-ph ' + cls + '"></span></div>';
}

function fmtUsd(n, fracDigits) {
    if (n == null || isNaN(n)) return '—';
    const d = fracDigits == null ? 2 : fracDigits;
    return Number(n).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: d,
        maximumFractionDigits: d
    });
}

function fmtUsdCompact(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(Number(n));
    // Large ton prices: $9,800 (no cents) so Cobre stays readable on the strip
    const d = abs >= 1000 ? 0 : (abs >= 100 ? 1 : 2);
    return fmtUsd(n, d);
}

function fmtBrl(n, fracDigits) {
    if (n == null || isNaN(n)) return '—';
    const opts = { style: 'currency', currency: 'BRL' };
    if (fracDigits != null) {
        opts.minimumFractionDigits = fracDigits;
        opts.maximumFractionDigits = fracDigits;
    }
    return Number(n).toLocaleString('pt-BR', opts);
}

/** 1 troy ounce = 31.1034768 grams */
const TROY_OZ_TO_G = 31.1034768;
/** 1 metric tonne = 2204.62262185 pounds */
const LB_PER_METRIC_TON = 2204.62262185;

function goldUsdPerGram(usdPerTroyOz) {
    if (usdPerTroyOz == null || isNaN(usdPerTroyOz)) return null;
    return Number(usdPerTroyOz) / TROY_OZ_TO_G;
}

/**
 * Normalize copper to USD per metric tonne.
 * COMEX HG / gold-api HG / Yahoo HG=F are USD/lb (~$2–$10).
 * LME-style sources may already be USD/t (~$5,000–$15,000) — do not double-convert.
 */
function copperUsdPerTon(usdRaw) {
    if (usdRaw == null || isNaN(usdRaw)) return null;
    const n = Number(usdRaw);
    if (n < 100) return n * LB_PER_METRIC_TON; // USD/lb → USD/t
    return n; // already USD/t (or similar large unit)
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
    // Returns raw USD number from the source (usually USD/lb for HG; sometimes USD/t).
    // Callers must run copperUsdPerTon() before display.
    if (data == null) return null;
    if (typeof data === 'number') return data;
    if (typeof data !== 'object') return null;
    // gold-api.com HG: USD per pound (COMEX)
    if (data.price != null && /hg|copper|cobre/i.test(String(data.symbol || data.name || ''))) {
        const n = parseFloat(data.price);
        if (!isNaN(n)) return n;
    }
    // Yahoo HG=F chart: USD per pound
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
    options = options || {};
    const brl = ultimoUsdBrl != null ? usd * ultimoUsdBrl : null;
    const elV = document.getElementById(elValor);
    const elS = document.getElementById(elSub);

    // Main value
    if (options.preferBrlMain && brl != null) {
        // Gold for BR users: R$/g primary
        elV.textContent = fmtBrl(brl, 2);
    } else if (options.usdPerTon) {
        elV.textContent = fmtUsdCompact(usd);
    } else {
        elV.textContent = fmtUsd(usd, options.usdFrac != null ? options.usdFrac : 2);
    }

    // Subtitle: keep short so Cobre is not clipped on mobile
    let sub = label;
    if (fromCache) {
        sub = 'cache · ' + label;
    } else if (viaProxy) {
        sub = 'proxy · ' + label;
    } else if (options.preferBrlMain && brl != null) {
        // Main is R$/g → subtitle carries USD/g
        sub = 'USD/g · ' + fmtUsd(usd, 2);
    } else if (brl != null && options.showBrlInSub) {
        sub = label + ' · ' + fmtBrl(brl, options.usdPerTon ? 0 : 2);
    } else if (brl != null && !options.usdPerTon && !options.preferBrlMain) {
        sub = label + ' · ' + fmtBrl(brl, 2);
    }
    elS.textContent = sub;
}

async function carregarDolar() {
    const data = await fetchJson('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    const bid = parseFloat(data.USDBRL && data.USDBRL.bid);
    if (!bid) throw new Error('sem bid');
    ultimoUsdBrl = bid;
    document.getElementById('cot-dolar').textContent = fmtBrl(bid);
    const pct = data.USDBRL.pctChange;
    document.getElementById('cot-dolar-sub').textContent =
        pct != null ? ('var ' + pct + '%') : 'USD/BRL';
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
        const usdOz = parseGoldUsd(data);
        if (usdOz == null || isNaN(usdOz)) throw new Error('parse gold');
        // APIs return USD/troy oz → display per gram
        const usdG = goldUsdPerGram(usdOz);
        writeLsNumber(LS_OURO, usdOz); // cache raw USD/oz; convert on read
        showMetal('cot-ouro', 'cot-ouro-sub', usdG, 'USD/g', viaProxy, false, {
            preferBrlMain: true,
            usdFrac: 2
        });
        return usdG;
    } catch (e) {
        const cachedOz = readLsNumber(LS_OURO);
        if (cachedOz != null) {
            // Legacy cache may already be per-gram (< ~500) or troy-oz
            const usdG = cachedOz > 500 ? goldUsdPerGram(cachedOz) : cachedOz;
            showMetal('cot-ouro', 'cot-ouro-sub', usdG, 'USD/g', false, true, {
                preferBrlMain: true,
                usdFrac: 2
            });
            return usdG;
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
        const usdRaw = parseCopperUsd(data);
        if (usdRaw == null || isNaN(usdRaw)) throw new Error('parse copper');
        // HG sources are USD/lb; copperUsdPerTon avoids double-convert if already USD/t
        const usdT = copperUsdPerTon(usdRaw);
        writeLsNumber(LS_COBRE, usdRaw); // cache raw; normalize on read
        showMetal('cot-cobre', 'cot-cobre-sub', usdT, 'USD/t', viaProxy, false, {
            usdPerTon: true
        });
        return usdT;
    } catch (e) {
        const cachedRaw = readLsNumber(LS_COBRE);
        if (cachedRaw != null) {
            const usdT = copperUsdPerTon(cachedRaw);
            showMetal('cot-cobre', 'cot-cobre-sub', usdT, 'USD/t', false, true, {
                usdPerTon: true
            });
            return usdT;
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
        stamp.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
            ' · spot';
    }
}


function rotuloPapelFeed(papel) {
    if (!papel) return '';
    const labels = {
        minerador: 'Minerador',
        comprador: 'Comprador',
        transportador: 'Transportador',
        transportador_mina_britador: 'Transportador (Mina - Britador)',
        transportador_britador_porto: 'Transportador (Britador - Porto)',
        dono_britador: 'Dono de Britador',
        carregamento: 'Carregador',
        admin: 'Admin'
    };
    const k = String(papel).toLowerCase();
    return labels[k] || papel;
}

function localLabel(lote) {
    const parts = [];
    if (lote.cidade && lote.estado) parts.push(lote.cidade + '-' + String(lote.estado).toUpperCase());
    else if (lote.cidade) parts.push(lote.cidade);
    else if (lote.estado) parts.push(String(lote.estado).toUpperCase());
    if (lote.ddd) parts.push('DDD ' + lote.ddd);
    if (lote.origem) parts.push(lote.origem);
    return parts.length ? parts.join(' · ') : '—';
}

function setLocStatus(texto) {
    const el = document.getElementById('loc-status');
    if (el) el.textContent = texto;
}

function lerFiltrosAbertosPref() {
    try {
        const v = localStorage.getItem(LS_FILTROS_ABERTOS);
        if (v === '1') return true;
        if (v === '0') return false;
    } catch (e) { /* ignore */ }
    return null; // sem preferência → default collapsed
}

function salvarFiltrosAbertosPref(aberto) {
    try { localStorage.setItem(LS_FILTROS_ABERTOS, aberto ? '1' : '0'); } catch (e) { /* ignore */ }
}

function setFiltrosPanelAberto(aberto) {
    const bar = document.getElementById('loc-bar');
    const panel = document.getElementById('loc-bar-panel');
    const btn = document.getElementById('loc-bar-toggle');
    if (!bar || !panel || !btn) return;
    bar.classList.toggle('loc-bar-collapsed', !aberto);
    bar.classList.toggle('loc-bar-expanded', !!aberto);
    panel.hidden = !aberto;
    btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
}

function bindFiltrosPanelToggle() {
    const btn = document.getElementById('loc-bar-toggle');
    if (!btn || btn._boundFiltros) return;
    btn._boundFiltros = true;
    btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        setFiltrosPanelAberto(!open);
        salvarFiltrosAbertosPref(!open);
    });
}

function resumoLocalAtual() {
    if (filtroLocMode === 'cidade' && filtroCidade) {
        const uf = (filtroEstado || '').toUpperCase();
        const label = uf ? (filtroCidade + '-' + uf) : filtroCidade;
        if (geoPerto && geoPerto.cidade && typeof LocalidadeBR !== 'undefined' &&
            LocalidadeBR.norm(geoPerto.cidade) === LocalidadeBR.norm(filtroCidade) &&
            String(geoPerto.estado || '').toUpperCase() === uf) {
            return 'Perto de você: ' + label;
        }
        return 'Cidade: ' + label;
    }
    if (filtroLocMode === 'estado' && filtroEstado) {
        return 'Estado: ' + String(filtroEstado).toUpperCase();
    }
    if (filtroLocMode === 'ddd' && filtroDdd) {
        return 'DDD ' + filtroDdd;
    }
    if (geoPerto && geoPerto.cidade && geoPerto.estado) {
        return 'Perto de você: ' + geoPerto.cidade + '-' + geoPerto.estado + ' (sem filtro)';
    }
    return 'Todo o Brasil';
}

function atualizarResumoLocal() {
    setLocStatus(resumoLocalAtual());
}

function matchServico(lote, servico) {
    if (!servico) return true;
    const p = String(lote.publicado_como || '').toLowerCase();
    if (!p) return false;
    if (servico === 'transportador') {
        return p === 'transportador' || p.indexOf('transportador_') === 0;
    }
    return p === servico;
}

function syncLocModeChips() {
    const box = document.getElementById('filtro-local-chips');
    if (!box) return;
    box.querySelectorAll('.fchip').forEach(b => {
        b.classList.toggle('on', (b.getAttribute('data-loc') || '') === filtroLocMode);
    });
}

function persistLocPref() {
    if (typeof LocalidadeBR === 'undefined') return;
    LocalidadeBR.salvarPreferencia({
        mode: filtroLocMode,
        estado: filtroEstado,
        cidade: filtroCidade,
        ddd: filtroDdd
    });
}

function matchCidade(l, cidade) {
    if (!cidade) return true;
    const a = (typeof LocalidadeBR !== 'undefined')
        ? LocalidadeBR.norm(l.cidade || '')
        : String(l.cidade || '').toLowerCase();
    const b = (typeof LocalidadeBR !== 'undefined')
        ? LocalidadeBR.norm(cidade)
        : String(cidade).toLowerCase();
    return a === b;
}

function favKey(codigo) { return 'minera_fav_' + String(codigo || ''); }
function isFav(codigo) {
    try { return localStorage.getItem(favKey(codigo)) === '1'; } catch (e) { return false; }
}
function toggleFav(codigo, btn) {
    const on = !isFav(codigo);
    try {
        if (on) localStorage.setItem(favKey(codigo), '1');
        else localStorage.removeItem(favKey(codigo));
    } catch (e) { /* ignore */ }
    if (btn) btn.classList.toggle('on', on);
    if (btn) btn.textContent = on ? '♥' : '♡';
}
function statusOlx(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'expedido') return { label: 'Vendido', cls: 'olx-chip sold' };
    if (s === 'em_processo' || s === 'processado') return { label: 'Em trânsito', cls: 'olx-chip transit' };
    return { label: 'Disponível', cls: 'olx-chip' };
}
function renderFeed(lista) {
    const box = document.getElementById('feed');
    if (!box) return;
    box.classList.remove('loading');
    box.classList.add('olx-feed');
    if (!lista.length) {
        box.innerHTML = '<div class="olx-empty"><p><strong>Nenhum anúncio por aqui</strong></p><p class="sub">Seja o primeiro a publicar na região.</p><a class="btn-ok" href="' + APP_ROOT + 'lotes.html">Anunciar</a></div>';
        return;
    }
    box.innerHTML = lista.map(lote => {
        const codigo = lote.codigo_lote || '';
        const preco = formatPreco(lote.preco) || 'Sob consulta';
        const cidade = localLabel(lote);
        const st = statusOlx(lote.status);
        const title = (lote.tipo_minerio || 'Minério') + (codigo ? ' · ' + codigo : '');
        const detHref = APP_ROOT + 'lote-detalhe.html?codigo=' + encodeURIComponent(codigo);
        const favOn = isFav(codigo);
        let photo;
        if (lote.imagem_url) {
            photo = '<img src="' + esc(lote.imagem_url) + '" alt="" loading="lazy" onerror="this.remove()">';
        } else {
            photo = '<div class="ph">' + imgPlaceholder(lote.tipo_minerio) + '</div>';
        }
        return '<a class="olx-card" href="' + detHref + '" data-codigo="' + esc(codigo) + '">' +
            '<div class="olx-card-photo">' + photo +
            '<button type="button" class="olx-heart' + (favOn ? ' on' : '') + '" data-fav="' + esc(codigo) + '" aria-label="Favorito">' + (favOn ? '♥' : '♡') + '</button>' +
            '</div><div class="olx-card-body">' +
            '<div class="olx-card-title">' + esc(title) + '</div>' +
            '<div class="olx-card-price">' + esc(preco) + '</div>' +
            '<div class="olx-card-loc">' + esc(cidade) + '</div>' +
            '<span class="' + st.cls + '">' + esc(st.label) + '</span>' +
            '</div></a>';
    }).join('');
    box.querySelectorAll('.olx-heart').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFav(btn.getAttribute('data-fav'), btn);
        });
    });
}

function aplicarFiltros() {
    let lista = feedCache.slice();
    // Localidade (AND com mineral/status)
    if (filtroLocMode === 'estado' && filtroEstado) {
        const uf = filtroEstado.toUpperCase();
        lista = lista.filter(l => String(l.estado || '').toUpperCase() === uf);
    } else if (filtroLocMode === 'cidade' && filtroCidade) {
        if (filtroEstado) {
            const uf = filtroEstado.toUpperCase();
            lista = lista.filter(l => String(l.estado || '').toUpperCase() === uf);
        }
        lista = lista.filter(l => matchCidade(l, filtroCidade));
    } else if (filtroLocMode === 'ddd' && filtroDdd) {
        const d = String(filtroDdd);
        lista = lista.filter(l => String(l.ddd || '') === d);
    }
    if (filtroBusca) {
        const t = filtroBusca.toLowerCase();
        lista = lista.filter(l => {
            const blob = [l.codigo_lote, l.tipo_minerio, l.cidade, l.estado, l.criado_por, localLabel(l)]
                .map(x => String(x || '').toLowerCase()).join(' ');
            return blob.includes(t);
        });
    }
    if (filtroTipo) lista = lista.filter(l => (l.tipo_minerio || '') === filtroTipo);
    if (filtroServico) lista = lista.filter(l => matchServico(l, filtroServico));
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
        const btn = e.target.closest('.fchip, .olx-tab');
        if (!btn) return;
        box.querySelectorAll('.fchip, .olx-tab').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        setter(btn.getAttribute(attr) || '');
        aplicarFiltros();
    });
}

async function carregarFeed() {
    const box = document.getElementById('feed');
    try {
        let q = supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false })
            .limit(120);
        // Pré-filtro no servidor quando possível (AND com chips locais no cliente)
        if (filtroLocMode === 'estado' && filtroEstado) {
            q = q.eq('estado', filtroEstado.toUpperCase());
        } else if (filtroLocMode === 'cidade' && filtroCidade) {
            if (filtroEstado) q = q.eq('estado', filtroEstado.toUpperCase());
            q = q.ilike('cidade', filtroCidade);
        } else if (filtroLocMode === 'ddd' && filtroDdd) {
            q = q.eq('ddd', String(filtroDdd));
        }
        const { data, error } = await q;
        if (error) {
            // Colunas de localidade ausentes → fallback sem filtro SQL
            if (/estado|cidade|ddd|oculto|column|schema cache/i.test(error.message || '')) {
                console.warn('localidade columns?', error.message);
                const res2 = await supabaseClient.from('lotes').select('*').order('id', { ascending: false }).limit(120);
                if (res2.error) throw res2.error;
                feedCache = filtrarLotesVisiveis(res2.data || []);
                if (box && !feedCache.length) {
                    box.classList.add('olx-feed'); box.innerHTML = '<div class="olx-empty"><p><strong>Marketplace vazio</strong></p><p class="sub">Seja o primeiro a anunciar.</p><a class="btn-ok" href="' + APP_ROOT + 'lotes.html">Anunciar</a></div>';
                    return;
                }
                aplicarFiltros();
                return;
            }
            throw error;
        }
        feedCache = filtrarLotesVisiveis(data || []);
        if (!feedCache.length) {
            box.classList.add('olx-feed'); box.innerHTML = '<div class="olx-empty"><p><strong>Nenhum lote disponível</strong></p><p class="sub">Publique o seu ou limpe os filtros.</p><a class="btn-ok" href="' + APP_ROOT + 'lotes.html">Anunciar</a></div>';
            return;
        }
        aplicarFiltros();
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Não foi possível carregar o feed. Saia e entre novamente.</p>';
    }
}

async function onLocModeChange(mode) {
    filtroLocMode = mode || 'todos';
    syncLocModeChips();
    if (filtroLocMode === 'todos') {
        // mantém selects mas não filtra
    }
    persistLocPref();
    atualizarResumoLocal();
    await carregarFeed();
}

async function onEstadoChange() {
    const sel = document.getElementById('filtro-estado');
    filtroEstado = (sel && sel.value) ? sel.value.toUpperCase() : '';
    filtroCidade = '';
    if (typeof LocalidadeBR !== 'undefined') {
        await LocalidadeBR.preencherSelectCidades(document.getElementById('filtro-cidade'), filtroEstado, '');
        LocalidadeBR.preencherSelectDdd(document.getElementById('filtro-ddd'), filtroEstado, filtroDdd);
    }
    if (filtroLocMode === 'todos' && filtroEstado) {
        filtroLocMode = 'estado';
        syncLocModeChips();
    }
    persistLocPref();
    atualizarResumoLocal();
    await carregarFeed();
}

async function onCidadeChange() {
    const sel = document.getElementById('filtro-cidade');
    filtroCidade = (sel && sel.value) ? sel.value : '';
    if (filtroCidade && typeof LocalidadeBR !== 'undefined' && filtroEstado) {
        const d = LocalidadeBR.dddDeCidade(filtroCidade, filtroEstado);
        if (d) {
            filtroDdd = d;
            const dsel = document.getElementById('filtro-ddd');
            if (dsel) dsel.value = d;
        }
    }
    if (filtroCidade) {
        filtroLocMode = 'cidade';
        syncLocModeChips();
    }
    persistLocPref();
    atualizarResumoLocal();
    await carregarFeed();
}

async function onDddChange() {
    const sel = document.getElementById('filtro-ddd');
    filtroDdd = (sel && sel.value) ? sel.value : '';
    if (filtroDdd) {
        filtroLocMode = 'ddd';
        syncLocModeChips();
    }
    persistLocPref();
    atualizarResumoLocal();
    await carregarFeed();
}

async function initLocalidadeUI() {
    if (typeof LocalidadeBR === 'undefined') {
        setLocStatus('Escolha estado/cidade');
        return;
    }
    const estSel = document.getElementById('filtro-estado');
    const cidSel = document.getElementById('filtro-cidade');
    const dddSel = document.getElementById('filtro-ddd');

    await LocalidadeBR.preencherSelectEstados(estSel, '');
    LocalidadeBR.preencherSelectDdd(dddSel, '', '');

    const pref = LocalidadeBR.lerPreferencia();

    setLocStatus('Pedindo permissão de localização…');
    geoPerto = await LocalidadeBR.obterLocalizacaoUsuario({ timeout: 10000 });

    if (geoPerto && geoPerto.cidade && geoPerto.estado) {
        setLocStatus('Perto de você: ' + geoPerto.cidade + '-' + geoPerto.estado);
        filtroEstado = geoPerto.estado;
        filtroCidade = geoPerto.cidade;
        filtroDdd = geoPerto.ddd || '';
        filtroLocMode = 'cidade';
        await LocalidadeBR.preencherSelectEstados(estSel, filtroEstado);
        await LocalidadeBR.preencherSelectCidades(cidSel, filtroEstado, filtroCidade);
        LocalidadeBR.preencherSelectDdd(dddSel, filtroEstado, filtroDdd);
        syncLocModeChips();
        persistLocPref();
    } else if (pref && (pref.estado || pref.cidade || pref.ddd || pref.mode)) {
        setLocStatus('Escolha estado/cidade (localização indisponível)');
        filtroLocMode = pref.mode || 'todos';
        filtroEstado = pref.estado || '';
        filtroCidade = pref.cidade || '';
        filtroDdd = pref.ddd || '';
        await LocalidadeBR.preencherSelectEstados(estSel, filtroEstado);
        if (filtroEstado) await LocalidadeBR.preencherSelectCidades(cidSel, filtroEstado, filtroCidade);
        LocalidadeBR.preencherSelectDdd(dddSel, filtroEstado, filtroDdd);
        syncLocModeChips();
    } else {
        setLocStatus('Escolha estado/cidade');
        filtroLocMode = 'todos';
        syncLocModeChips();
    }

    const chips = document.getElementById('filtro-local-chips');
    if (chips) {
        chips.addEventListener('click', (e) => {
            const btn = e.target.closest('.fchip');
            if (!btn) return;
            onLocModeChange(btn.getAttribute('data-loc') || 'todos');
        });
    }
    if (estSel) estSel.addEventListener('change', () => { onEstadoChange(); });
    if (cidSel) cidSel.addEventListener('change', () => { onCidadeChange(); });
    if (dddSel) dddSel.addEventListener('change', () => { onDddChange(); });

    atualizarResumoLocal();
    const prefOpen = lerFiltrosAbertosPref();
    // Default collapsed (esp. após geo); respeita preferência salva
    setFiltrosPanelAberto(prefOpen === true);
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
    bindFiltrosPanelToggle();
    bindChipGroup('filtro-tipo-chips', 'data-tipo', v => { filtroTipo = v; });
    bindChipGroup('filtro-status-chips', 'data-status', v => { filtroStatus = v; });
    bindChipGroup('filtro-servico-chips', 'data-servico', v => { filtroServico = v; });
    // Notificações: MineraNotif (nav.js) liga o sino / badge de DMs
    atualizarCotacoes();
    cotacaoTimer = setInterval(atualizarCotacoes, 60000);
    try {
        await initLocalidadeUI();
    } catch (e) {
        console.warn('localidade init', e);
        setLocStatus('Escolha estado/cidade');
    }
    carregarFeed();
})();

window.addEventListener('beforeunload', () => {
    if (cotacaoTimer) clearInterval(cotacaoTimer);
});

/* Marketplace search + Serviços CTA */
(function bindMktChrome() {
    const busca = document.getElementById('mkt-busca');
    if (busca && !busca._mktBound) {
        busca._mktBound = true;
        let t = null;
        busca.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                filtroBusca = String(busca.value || '').trim();
                if (typeof aplicarFiltros === 'function') aplicarFiltros();
            }, 180);
        });
    }
    const cta = document.getElementById('cta-servicos');
    if (cta && !cta._mktBound) {
        cta._mktBound = true;
        cta.addEventListener('click', () => {
            if (typeof abrirServicosPanel === 'function') abrirServicosPanel();
            else if (typeof toggleServicosPanel === 'function') toggleServicosPanel();
        });
    }
    const btnMapa = document.getElementById('btn-mapa');
    if (btnMapa && !btnMapa._mktBound) {
        btnMapa._mktBound = true;
        btnMapa.addEventListener('click', () => {
            const root = (typeof APP_ROOT === 'string') ? APP_ROOT : '';
            location.href = root + 'mapa.html';
        });
    }
})();

(function bindAnunciar() {
    /* FAB Anunciar → lotes; invite/share stays on Perfil */
    const fab = document.getElementById('fab-anunciar');
    if (fab && typeof APP_ROOT === 'string') fab.setAttribute('href', APP_ROOT + 'lotes.html');
})();

(function bindBancoQuick() {
    const btn = document.getElementById('btn-banco') || document.getElementById('q-banco');
    if (btn && !btn._boundBanco) {
        btn._boundBanco = true;
        btn.addEventListener('click', () => {
            const root = (typeof APP_ROOT === 'string') ? APP_ROOT : '';
            location.href = root + 'financeiro.html';
        });
    }
})();



/* OLX chrome: city pin, banner, fab, categorias */
(function bindOlxChrome() {
    const cityEl = document.getElementById('olx-city');
    const locBtn = document.getElementById('olx-loc-btn');
    function syncCity() {
        if (!cityEl) return;
        const c = (typeof filtroCidade === 'string' && filtroCidade) ? filtroCidade
            : (geoPerto && geoPerto.cidade) ? geoPerto.cidade : 'Parauapebas';
        cityEl.textContent = c;
    }
    if (locBtn && !locBtn._olx) {
        locBtn._olx = true;
        locBtn.addEventListener('click', () => {
            const panel = document.getElementById('loc-bar-panel');
            const bar = document.getElementById('loc-bar');
            if (panel) {
                const open = !panel.hidden;
                setFiltrosPanelAberto(!open);
                if (!open && bar) {
                    bar.classList.remove('oculto');
                    bar.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;padding:0;';
                    panel.hidden = false;
                    panel.style.cssText = 'background:#1e293b;width:100%;border-radius:16px 16px 0 0;padding:16px;max-height:70vh;overflow:auto;';
                } else if (bar) {
                    bar.style.cssText = '';
                    panel.style.cssText = '';
                }
            }
        });
    }
    /* banners: carregarBannersPromos() */
    const fab = document.getElementById('fab-anunciar');
    if (fab && typeof APP_ROOT === 'string') fab.setAttribute('href', APP_ROOT + 'lotes.html');
    /* Categorias: only top olx-tabs (#filtro-tipo-chips) — no quick card */
    const qFav = document.getElementById('q-favoritos');
    if (qFav && !qFav._olx) {
        qFav._olx = true;
        qFav.addEventListener('click', () => {
            const favs = (feedCache || []).filter(l => isFav(l.codigo_lote));
            renderFeed(favs.length ? favs : []);
            if (!favs.length && typeof toastMsg === 'function') toastMsg('Nenhum favorito ainda.');
        });
    }
    const _origAplicar = typeof atualizarResumoLocal === 'function' ? atualizarResumoLocal : null;
    if (_origAplicar && !window._olxCityHook) {
        window._olxCityHook = true;
        const wrap = atualizarResumoLocal;
        atualizarResumoLocal = function () {
            wrap();
            syncCity();
        };
    }
    syncCity();
})();
