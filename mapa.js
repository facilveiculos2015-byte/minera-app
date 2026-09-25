/** Mapa — Leaflet + OpenStreetMap (padrão) + Esri satélite (grátis).
 *  Busca de cidade via Nominatim. Google Maps opcional se houver chave. */

let perfilAtual = null;
let sessionAtual = null;
let map = null;
let layerOsm = null;
let layerEsri = null;
let markersLayer = null;
let pinMarker = null;
let userMarker = null;
let cityMarker = null;
let routeLine = null;
let baseAtual = 'osm';
let marcarAtivo = true;
let pinLatLng = null; // { lat, lng }
let pinLabel = '';
let userLatLng = null; // { lat, lng }
let mapsReady = false;

const DEFAULT_CENTER = [-6.0, -50.0]; // Pará / Carajás
const DEFAULT_ZOOM = 7;

const TILE_PERF = {
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 1,
    maxZoom: 18,
    tileSize: 256,
    crossOrigin: true
};

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const ESRI_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR =
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — ' +
    'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const NOMINATIM_UA = 'MineraApp/1.0 (https://github.com/facilveiculos2015-byte/minera-app)';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getMapsApiKey() {
    try {
        if (typeof window.MINERA_GOOGLE_MAPS_KEY === 'string' && window.MINERA_GOOGLE_MAPS_KEY.trim()) {
            return window.MINERA_GOOGLE_MAPS_KEY.trim();
        }
        if (typeof GOOGLE_MAPS_API_KEY === 'string' && GOOGLE_MAPS_API_KEY.trim()) {
            return GOOGLE_MAPS_API_KEY.trim();
        }
    } catch (e) {}
    return '';
}

function setInfo(html) {
    const el = document.getElementById('mapa-info');
    if (!el) return;
    if (!html) {
        el.classList.add('oculto');
        el.innerHTML = '';
        return;
    }
    el.innerHTML = html;
    el.classList.remove('oculto');
}

function mapsLink(lat, lng) {
    return 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(lat) +
        '&mlon=' + encodeURIComponent(lng) + '#map=15/' + lat + '/' + lng;
}

function latLngObj(lat, lng) {
    return { lat: Number(lat), lng: Number(lng) };
}

function haversineKm(a, b) {
    if (!a || !b) return null;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function openMapaSheet(open) {
    const sheet = document.getElementById('mapa-sheet');
    if (!sheet) return;
    sheet.classList.toggle('open', !!open);
}

function updatePinInfo(extraHtml) {
    const btnSend = document.getElementById('btn-enviar-chat');
    const summary = document.getElementById('mapa-sheet-summary');
    if (!pinLatLng) {
        setInfo(extraHtml || '');
        if (btnSend) btnSend.disabled = true;
        if (summary) summary.textContent = 'Toque no mapa para marcar um ponto';
        openMapaSheet(!!extraHtml);
        return;
    }
    const lat = pinLatLng.lat.toFixed(6);
    const lng = pinLatLng.lng.toFixed(6);
    const label = pinLabel
        ? '<br><strong>Local:</strong> ' + esc(pinLabel)
        : '';
    let html =
        '<strong>Ponto marcado</strong><br>' +
        'Lat: ' + lat + ' · Lng: ' + lng + label;
    if (extraHtml) html += extraHtml;
    setInfo(html);
    if (summary) {
        summary.innerHTML = '<strong>Ponto</strong> · ' + lat + ', ' + lng +
            (pinLabel ? ' · ' + esc(pinLabel) : '');
    }
    if (btnSend) btnSend.disabled = false;
    openMapaSheet(true);
}

function criarOsm() {
    return L.tileLayer(OSM_URL, Object.assign({}, TILE_PERF, {
        attribution: OSM_ATTR,
        maxNativeZoom: 19,
        subdomains: 'abc'
    }));
}

function criarEsri() {
    return L.tileLayer(ESRI_URL, Object.assign({}, TILE_PERF, {
        attribution: ESRI_ATTR,
        maxNativeZoom: 18
    }));
}

function setBase(tipo) {
    if (!map) return;
    const next = tipo === 'esri' ? 'esri' : 'osm';
    if (next === baseAtual && (
        (next === 'osm' && layerOsm && map.hasLayer(layerOsm)) ||
        (next === 'esri' && layerEsri && map.hasLayer(layerEsri))
    )) {
        atualizarLegenda(next);
        return;
    }
    if (layerOsm && map.hasLayer(layerOsm)) map.removeLayer(layerOsm);
    if (layerEsri && map.hasLayer(layerEsri)) map.removeLayer(layerEsri);
    if (next === 'esri') {
        if (!layerEsri) layerEsri = criarEsri();
        layerEsri.addTo(map);
    } else {
        if (!layerOsm) layerOsm = criarOsm();
        layerOsm.addTo(map);
    }
    baseAtual = next;
    atualizarLegenda(next);
}

function atualizarLegenda(tipo) {
    const el = document.getElementById('mapa-legend');
    if (!el) return;
    if (tipo === 'esri') {
        el.textContent = 'Satélite Esri (gratuito) · busca por cidade · sem chave de API';
    } else {
        el.textContent = 'OpenStreetMap (gratuito) · busca por cidade · sem chave de API';
    }
}

function resizeMap() {
    if (!map) return;
    try { map.invalidateSize(true); } catch (e) {}
}

function placePin(lat, lng, opts) {
    if (!map) return;
    const o = opts || {};
    pinLatLng = latLngObj(lat, lng);
    if (o.label != null) pinLabel = String(o.label);
    else if (!o.keepLabel) pinLabel = '';

    if (!pinMarker) {
        pinMarker = L.marker([pinLatLng.lat, pinLatLng.lng], {
            draggable: true,
            title: 'Ponto marcado'
        }).addTo(map);
        pinMarker.on('dragend', () => {
            const p = pinMarker.getLatLng();
            pinLatLng = latLngObj(p.lat, p.lng);
            pinLabel = '';
            updatePinInfo();
            reverseGeocodeQuiet(pinLatLng.lat, pinLatLng.lng).then((name) => {
                if (name) {
                    pinLabel = name;
                    updatePinInfo();
                }
            });
        });
    } else {
        pinMarker.setLatLng([pinLatLng.lat, pinLatLng.lng]);
        if (!map.hasLayer(pinMarker)) pinMarker.addTo(map);
    }

    if (o.pan !== false) {
        map.panTo([pinLatLng.lat, pinLatLng.lng]);
        if (map.getZoom() < 12) map.setZoom(14);
    }
    updatePinInfo(o.extraHtml || '');
    if (!o.skipReverse && !pinLabel) {
        reverseGeocodeQuiet(pinLatLng.lat, pinLatLng.lng).then((name) => {
            if (name) {
                pinLabel = name;
                updatePinInfo(o.extraHtml || '');
            }
        });
    }
}

/** Toque do usuário (Minha localização / rota): pode pedir permissão via MineraGeo. */
async function getCurrentPosition() {
    if (typeof MineraGeo === 'undefined') throw new Error('geo.js ausente');
    const p = await MineraGeo.obterLocalizacao({ motivo: 'mapa-botao', interativo: true, highAccuracy: true, timeout: 15000, fresco: true });
    if (!p) throw new Error(MineraGeo.ultimoErro || 'sem localização');
    return latLngObj(p.lat, p.lng);
}

function ensureUserMarker(coords) {
    userLatLng = coords;
    if (!userMarker) {
        userMarker = L.circleMarker([coords.lat, coords.lng], {
            radius: 8,
            color: '#fff',
            weight: 2,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            title: 'Minha localização'
        }).addTo(map);
        userMarker.bindTooltip('Minha localização', { direction: 'top' });
    } else {
        userMarker.setLatLng([coords.lat, coords.lng]);
        if (!map.hasLayer(userMarker)) userMarker.addTo(map);
    }
}

async function irMinhaLocalizacao() {
    const btn = document.getElementById('btn-minha-loc');
    if (btn) btn.disabled = true;
    try {
        const coords = await getCurrentPosition();
        ensureUserMarker(coords);
        map.panTo([coords.lat, coords.lng]);
        if (map.getZoom() < 14) map.setZoom(15);
        if (!pinLatLng) placePin(coords.lat, coords.lng, { pan: false, label: 'Minha localização' });
    } catch (err) {
        alert('Não foi possível obter sua localização. Verifique a permissão do navegador.');
        console.warn(err);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function limparRota() {
    if (routeLine && map) {
        try { map.removeLayer(routeLine); } catch (e) {}
    }
    routeLine = null;
    if (pinLatLng) updatePinInfo();
    else setInfo('');
}

async function rotaSimples() {
    if (!pinLatLng) {
        alert('Marque um ponto no mapa (ou busque uma cidade) primeiro.');
        return;
    }
    try {
        if (!userLatLng) {
            const coords = await getCurrentPosition();
            ensureUserMarker(coords);
        }
    } catch (e) {
        alert('Ative a localização para traçar a rota simples até o marcador.');
        return;
    }
    if (routeLine && map) {
        try { map.removeLayer(routeLine); } catch (e) {}
    }
    const a = [userLatLng.lat, userLatLng.lng];
    const b = [pinLatLng.lat, pinLatLng.lng];
    routeLine = L.polyline([a, b], {
        color: '#f59e0b',
        weight: 4,
        opacity: 0.9,
        dashArray: '8 6'
    }).addTo(map);
    try {
        map.fitBounds(routeLine.getBounds(), { padding: [48, 48], maxZoom: 14 });
    } catch (e) {}
    const km = haversineKm(userLatLng, pinLatLng);
    const distTxt = km != null ? (km < 1 ? (km * 1000).toFixed(0) + ' m' : km.toFixed(1) + ' km') : '—';
    updatePinInfo(
        '<br><strong>Rota simples (sem Google):</strong> linha reta · ' +
        esc(distTxt) +
        ' (aprox.)'
    );
}

function lerComQuery() {
    try {
        const u = new URL(window.location.href);
        return (u.searchParams.get('com') || u.searchParams.get('para') || u.searchParams.get('dm') || '').trim();
    } catch (e) { return ''; }
}

function enviarNoChat() {
    if (!pinLatLng) {
        alert('Marque um ponto no mapa primeiro.');
        return;
    }
    const lat = pinLatLng.lat;
    const lng = pinLatLng.lng;
    const label = pinLabel || ('Local ' + lat.toFixed(5) + ', ' + lng.toFixed(5));
    const link = mapsLink(lat, lng);
    const texto =
        '📍 ' + label + '\n' +
        'Coords: ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '\n' +
        link;

    try {
        sessionStorage.setItem('minera_share_loc', JSON.stringify({
            lat: lat,
            lng: lng,
            label: label,
            link: link,
            texto: texto,
            ts: Date.now()
        }));
    } catch (e) {}

    const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '/minera-app/');
    const params = new URLSearchParams();
    params.set('lat', String(lat));
    params.set('lng', String(lng));
    params.set('label', label);
    const com = lerComQuery();
    if (com) params.set('com', com);

    window.location.href = root + 'chat.html?' + params.toString();
}

/* ---------- Nominatim (cidade) ---------- */

async function fetchJsonCors(url) {
    // 1) tentativa direta
    try {
        const r = await fetch(url, {
            headers: { Accept: 'application/json' },
            mode: 'cors'
        });
        if (r.ok) return await r.json();
    } catch (e) {
        /* CORS comum no Nominatim */
    }
    // 2) proxy CORS-friendly
    const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
    const r2 = await fetch(proxied, { headers: { Accept: 'application/json' } });
    if (!r2.ok) throw new Error('Falha na busca (' + r2.status + ')');
    const text = await r2.text();
    return JSON.parse(text);
}

async function buscarCidadesNominatim(q) {
    const query = String(q || '').trim();
    if (query.length < 2) return [];
    const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=br&q=' +
        encodeURIComponent(query);
    // Nota: User-Agent não pode ser setado no browser; documentamos no NOMINATIM_UA / docs.
    // Proxy allorigins encaminha o pedido do servidor deles.
    void NOMINATIM_UA;
    const data = await fetchJsonCors(url);
    if (!Array.isArray(data)) return [];
    return data.map((row) => {
        const lat = parseFloat(row.lat);
        const lon = parseFloat(row.lon);
        const bb = Array.isArray(row.boundingbox) ? row.boundingbox.map(Number) : null;
        const addr = row.address || {};
        const cidade =
            addr.city || addr.town || addr.village || addr.municipality ||
            addr.county || addr.state_district || '';
        const uf = addr.state || '';
        const display = row.display_name || [cidade, uf].filter(Boolean).join(', ') || query;
        return {
            lat: lat,
            lng: lon,
            display: display,
            short: [cidade, uf].filter(Boolean).join(', ') || display.split(',').slice(0, 2).join(','),
            boundingbox: bb // [south, north, west, east] no Nominatim
        };
    }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

async function reverseGeocodeQuiet(lat, lng) {
    try {
        const url =
            'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' +
            encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng) +
            '&zoom=14&addressdetails=1';
        const data = await fetchJsonCors(url);
        if (!data) return '';
        const addr = data.address || {};
        const cidade =
            addr.city || addr.town || addr.village || addr.municipality || '';
        const uf = addr.state || '';
        if (cidade && uf) return cidade + ', ' + uf;
        if (cidade) return cidade;
        return String(data.display_name || '').split(',').slice(0, 2).join(',').trim();
    } catch (e) {
        return '';
    }
}

function hideBuscaResults() {
    const box = document.getElementById('busca-cidade-results');
    if (box) {
        box.classList.add('oculto');
        box.innerHTML = '';
    }
}

function showBuscaResults(items) {
    const box = document.getElementById('busca-cidade-results');
    if (!box) return;
    if (!items.length) {
        box.innerHTML = '<button type="button" disabled>Nenhuma cidade encontrada</button>';
        box.classList.remove('oculto');
        return;
    }
    box.innerHTML = items.map((it, i) =>
        '<button type="button" role="option" data-idx="' + i + '">' +
        esc(it.short) +
        '<span class="sub">' + esc(it.display) + '</span>' +
        '</button>'
    ).join('');
    box.classList.remove('oculto');
    box.querySelectorAll('button[data-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-idx'));
            const it = items[idx];
            if (it) aplicarCidade(it);
        });
    });
}

function aplicarCidade(it) {
    hideBuscaResults();
    const input = document.getElementById('busca-cidade');
    if (input) input.value = it.short || it.display;

    if (cityMarker && map) {
        try { map.removeLayer(cityMarker); } catch (e) {}
    }
    cityMarker = L.marker([it.lat, it.lng], {
        title: it.short || it.display,
        opacity: 0.95
    }).addTo(map);
    cityMarker.bindPopup('<strong>' + esc(it.short || it.display) + '</strong>').openPopup();

    const bb = it.boundingbox;
    if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
        // Nominatim: south, north, west, east
        try {
            map.flyToBounds([[bb[0], bb[2]], [bb[1], bb[3]]], {
                padding: [36, 36],
                maxZoom: 14,
                duration: 1.1
            });
        } catch (e) {
            map.flyTo([it.lat, it.lng], 13, { duration: 1.1 });
        }
    } else {
        map.flyTo([it.lat, it.lng], 13, { duration: 1.1 });
    }

    placePin(it.lat, it.lng, {
        label: it.short || it.display,
        pan: false,
        skipReverse: true,
        extraHtml: '<br><strong>Cidade:</strong> ' + esc(it.short || it.display)
    });
    setTimeout(resizeMap, 120);
}

async function onBuscarCidade() {
    const input = document.getElementById('busca-cidade');
    const btn = document.getElementById('btn-buscar-cidade');
    const q = (input && input.value || '').trim();
    if (q.length < 2) {
        alert('Digite o nome da cidade (mín. 2 caracteres).');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Buscando…';
    }
    try {
        const items = await buscarCidadesNominatim(q);
        if (!items.length) {
            showBuscaResults([]);
            return;
        }
        if (items.length === 1) {
            aplicarCidade(items[0]);
            return;
        }
        showBuscaResults(items);
        // também centra no primeiro
        // (usuário pode escolher outro na lista)
    } catch (err) {
        console.warn(err);
        alert('Não foi possível buscar a cidade. Tente de novo em instantes.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Buscar';
        }
    }
}

function wireUi() {
    const selBase = document.getElementById('mapa-base');
    if (selBase) {
        selBase.addEventListener('change', () => setBase(selBase.value));
    }

    const btnLoc = document.getElementById('btn-minha-loc');
    if (btnLoc) btnLoc.addEventListener('click', irMinhaLocalizacao);

    const btnMarcar = document.getElementById('btn-marcar');
    if (btnMarcar) {
        btnMarcar.classList.add('on');
        btnMarcar.addEventListener('click', () => {
            marcarAtivo = !marcarAtivo;
            btnMarcar.classList.toggle('on', marcarAtivo);
            btnMarcar.setAttribute('aria-pressed', marcarAtivo ? 'true' : 'false');
            btnMarcar.title = marcarAtivo ? 'Marcar ponto (ativo)' : 'Marcar ponto';
        });
    }

    const fabCamada = document.getElementById('fab-camada');
    if (fabCamada) {
        fabCamada.addEventListener('click', () => {
            const sel = document.getElementById('mapa-base');
            if (!sel) return;
            sel.value = sel.value === 'esri' ? 'osm' : 'esri';
            sel.dispatchEvent(new Event('change'));
            fabCamada.classList.toggle('on', sel.value === 'esri');
            fabCamada.title = sel.value === 'esri' ? 'Camada: satélite' : 'Camada: ruas';
        });
    }

    const btnRota = document.getElementById('btn-rota-simples');
    if (btnRota) btnRota.addEventListener('click', rotaSimples);

    const btnSend = document.getElementById('btn-enviar-chat');
    if (btnSend) btnSend.addEventListener('click', enviarNoChat);

    const btnLimpar = document.getElementById('btn-limpar-rota');
    if (btnLimpar) btnLimpar.addEventListener('click', limparRota);

    const btnBusca = document.getElementById('btn-buscar-cidade');
    if (btnBusca) btnBusca.addEventListener('click', onBuscarCidade);

    const inputBusca = document.getElementById('busca-cidade');
    if (inputBusca) {
        inputBusca.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                onBuscarCidade();
            }
        });
        inputBusca.addEventListener('input', () => {
            if (!(inputBusca.value || '').trim()) hideBuscaResults();
        });
    }

    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('mapa-busca');
        if (wrap && !wrap.contains(e.target)) hideBuscaResults();
    });

    const btnFs = document.getElementById('btn-mapa-fs');
    function ensureFsExit() {
        let exit = document.getElementById('btn-mapa-fs-exit');
        if (!exit) {
            exit = document.createElement('button');
            exit.type = 'button';
            exit.id = 'btn-mapa-fs-exit';
            exit.className = 'btn-mapa-fs-exit';
            exit.textContent = '✕ Sair tela cheia';
            exit.addEventListener('click', () => {
                document.body.classList.remove('mapa-fs');
                exit.classList.add('oculto');
                setTimeout(resizeMap, 80);
            });
            document.body.appendChild(exit);
        }
        return exit;
    }
    if (btnFs) {
        btnFs.addEventListener('click', () => {
            document.body.classList.toggle('mapa-fs');
            const exit = ensureFsExit();
            if (document.body.classList.contains('mapa-fs')) exit.classList.remove('oculto');
            else exit.classList.add('oculto');
            setTimeout(resizeMap, 80);
        });
    }

    window.addEventListener('resize', () => setTimeout(resizeMap, 50));
    window.addEventListener('orientationchange', () => setTimeout(resizeMap, 200));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(resizeMap, 100);
    });
}

function initLeafletMap() {
    const el = document.getElementById('mapa');
    if (!el || typeof L === 'undefined') {
        console.error('Leaflet não carregou');
        return;
    }

    // Garante altura antes de criar o mapa (evita canvas em branco)
    if (el.clientHeight < 80) {
        el.style.minHeight = '320px';
    }

    map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: false
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    layerOsm = criarOsm();
    layerOsm.addTo(map);
    baseAtual = 'osm';

    markersLayer = L.layerGroup().addTo(map);

    map.on('click', (e) => {
        if (!marcarAtivo || !e.latlng) return;
        placePin(e.latlng.lat, e.latlng.lng);
    });

    const selBase = document.getElementById('mapa-base');
    if (selBase) selBase.value = 'osm';
    atualizarLegenda('osm');

    mapsReady = true;
    setTimeout(resizeMap, 50);
    setTimeout(resizeMap, 250);
    setTimeout(resizeMap, 600);

    // Centraliza só se a permissão já foi dada (ou cache) — nunca pede no carregamento
    if (typeof MineraGeo !== 'undefined') {
        MineraGeo.obterLocalizacao({ motivo: 'mapa-load', interativo: false }).then((p) => {
            if (!p) return;
            const coords = latLngObj(p.lat, p.lng);
            ensureUserMarker(coords);
            map.panTo([coords.lat, coords.lng]);
            map.setZoom(14);
            setTimeout(resizeMap, 80);
        });
    }

    carregarMarcadoresLotes();
}

function markerPopup(lote) {
    const codigo = esc(lote.codigo_lote || '#' + lote.id);
    const tipo = esc(lote.tipo_minerio || 'Minério');
    const origem = esc(lote.origem || '—');
    const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '/minera-app/');
    const chatHref = root + 'chat.html?lote=' + encodeURIComponent(lote.codigo_lote || lote.id);
    return '<div class="mapa-popup">' +
        '<strong>' + codigo + '</strong><br>' +
        '<span>' + tipo + '</span><br>' +
        '<span class="mapa-popup-meta">📍 ' + origem + '</span><br>' +
        '<a class="mapa-popup-link" href="' + chatHref + '">Abrir chat</a>' +
        '</div>';
}

async function carregarMarcadoresLotes() {
    if (!map || !markersLayer || typeof supabaseClient === 'undefined') return;
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('id, codigo_lote, tipo_minerio, origem, status, lat, lng')
            .not('lat', 'is', null)
            .not('lng', 'is', null);
        if (error) {
            console.warn('Marcadores lotes:', error.message);
            return;
        }
        markersLayer.clearLayers();
        const pts = [];
        (data || []).forEach((l) => {
            const lat = parseFloat(l.lat);
            const lng = parseFloat(l.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
            const m = L.marker([lat, lng]);
            m.bindPopup(markerPopup(l));
            m.bindTooltip(String(l.codigo_lote || l.tipo_minerio || 'Lote'), {
                direction: 'top',
                opacity: 0.9
            });
            markersLayer.addLayer(m);
            pts.push([lat, lng]);
        });
        if (pts.length === 1 && !userLatLng) {
            map.setView(pts[0], Math.max(map.getZoom(), 10));
        } else if (pts.length > 1 && !userLatLng) {
            try {
                map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 });
            } catch (e) {}
        }
    } catch (err) {
        console.warn(err);
    }
}

(async function init() {
    sessionAtual = await requireSession();
    if (!sessionAtual) return;
    perfilAtual = await getPerfil(sessionAtual);
    aplicarUserLabel(perfilAtual);
    montarNav('mapa', perfilAtual);
    wireUi();

    // Sempre mapa gratuito (Leaflet). Chave Google vazia → não bloqueia.
    // Se no futuro houver chave, ainda usamos Leaflet até integração Google opcional.
    const key = getMapsApiKey();
    if (key) {
        console.info('GOOGLE_MAPS_API_KEY presente; mapa gratuito Leaflet permanece ativo (Google opcional).');
    }

    if (typeof L === 'undefined') {
        const panel = document.getElementById('mapa-key-panel');
        if (panel) {
            panel.classList.remove('oculto');
            panel.querySelector('h2').textContent = 'Falha ao carregar Leaflet';
            panel.querySelector('p').textContent =
                'Não foi possível carregar a biblioteca do mapa. Verifique a conexão e recarregue a página.';
        }
        return;
    }

    initLeafletMap();
})();
