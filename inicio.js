let feedCache = [];
let filtroTipo = '';
let filtroStatus = '';
/** modo local: todos | estado | cidade | ddd */
let filtroLocMode = 'todos';
let filtroEstado = '';
let filtroCidade = '';
let filtroDdd = '';
/** geo detectada no open: {cidade, estado, ddd} ou null */
let geoPerto = null;
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
                    ${lote.publicado_como ? '<span class="lote-papel-badge">' + esc(rotuloPapelFeed(lote.publicado_como)) + '</span>' : ''}
                    <span class="${statusBadgeClass(lote.status)}">${esc(statusAmigavel(lote.status))}</span>
                </div>
                <h3 class="lote-codigo">${esc(codigo)}</h3>
                <p class="lote-meta">📍 ${esc(localLabel(lote))} · ⚖️ ${esc(formatPeso(lote.peso_bruto_kg))}</p>
                ${preco ? '<p class="lote-preco">' + esc(preco) + '</p>' : ''}
                <p class="lote-who">${esc(lote.criado_por || 'Usuário')}${quando ? ' · ' + quando : ''}</p>
                <a class="btn-card" href="${APP_ROOT}chat.html?${lote.criado_por_id ? ('com=' + encodeURIComponent(lote.criado_por_id) + '&') : ''}lote=${encodeURIComponent(codigo)}">Negociar / Ver Detalhes</a>
            </div>
        </article>`;
    }).join('') + '</div>';
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
            if (/estado|cidade|ddd|column|schema cache/i.test(error.message || '')) {
                console.warn('localidade columns?', error.message);
                const res2 = await supabaseClient.from('lotes').select('*').order('id', { ascending: false }).limit(120);
                if (res2.error) throw res2.error;
                feedCache = res2.data || [];
                if (box && !feedCache.length) {
                    box.innerHTML = '<p>Ninguém postou ainda. Seja o primeiro em <a href="' + APP_ROOT + 'lotes.html">Meus Lotes</a>.</p>';
                    return;
                }
                aplicarFiltros();
                return;
            }
            throw error;
        }
        feedCache = data || [];
        if (!feedCache.length) {
            box.innerHTML = '<p>Nenhum lote com esses filtros de local. Amplie para <b>Todos</b> ou publique em <a href="' + APP_ROOT + 'lotes.html">Meus Lotes</a>.</p>';
            return;
        }
        aplicarFiltros();
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Não deu pra carregar o feed. Tente sair e entrar de novo.</p>';
    }
}

async function onLocModeChange(mode) {
    filtroLocMode = mode || 'todos';
    syncLocModeChips();
    if (filtroLocMode === 'todos') {
        // mantém selects mas não filtra
    }
    persistLocPref();
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
