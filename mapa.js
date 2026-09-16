/** Mapa de Satélite — Leaflet + Esri World Imagery (leve), in-app. */

let perfilAtual = null;
let sessionAtual = null;
let map = null;
let layerEsri = null;
let layerOsm = null;
let layerSentinel = null; // lazy: só criado ao selecionar
let layerLabels = null;
let markersLayer = null;
let baseAtual = 'esri';

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

/** Esri World Imagery — leve, sem API key */
const ESRI_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR =
    'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — ' +
    'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/** OSM ruas */
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** EOX Sentinel-2 cloudless 2024 — pesado; só sob demanda */
const SENTINEL_URL =
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
const SENTINEL_ATTR =
    '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> / ' +
    '<a href="https://eox.at" target="_blank" rel="noopener">EOX</a> ' +
    '(Contains modified Copernicus Sentinel data 2024)';

/** Rótulos Esri (transporte + referência) — overlay opcional */
const LABELS_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const LABELS_ATTR =
    'Labels &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function criarEsri() {
    return L.tileLayer(ESRI_URL, Object.assign({}, TILE_PERF, {
        attribution: ESRI_ATTR,
        maxNativeZoom: 18
    }));
}

function criarOsm() {
    return L.tileLayer(OSM_URL, Object.assign({}, TILE_PERF, {
        attribution: OSM_ATTR,
        maxNativeZoom: 19,
        subdomains: 'abc'
    }));
}

function criarSentinel() {
    return L.tileLayer(SENTINEL_URL, Object.assign({}, TILE_PERF, {
        attribution: SENTINEL_ATTR,
        maxZoom: 16,
        maxNativeZoom: 14
    }));
}

function criarLabels() {
    return L.tileLayer(LABELS_URL, Object.assign({}, TILE_PERF, {
        attribution: LABELS_ATTR,
        opacity: 0.75,
        pane: 'overlayPane'
    }));
}

function removerBaseAtual() {
    if (!map) return;
    if (baseAtual === 'esri' && layerEsri && map.hasLayer(layerEsri)) map.removeLayer(layerEsri);
    if (baseAtual === 'osm' && layerOsm && map.hasLayer(layerOsm)) map.removeLayer(layerOsm);
    if (baseAtual === 'sentinel' && layerSentinel && map.hasLayer(layerSentinel)) {
        map.removeLayer(layerSentinel);
    }
}

function setBase(tipo) {
    if (!map || tipo === baseAtual) return;
    removerBaseAtual();
    if (tipo === 'esri') {
        if (!layerEsri) layerEsri = criarEsri();
        layerEsri.addTo(map);
    } else if (tipo === 'osm') {
        if (!layerOsm) layerOsm = criarOsm();
        layerOsm.addTo(map);
    } else if (tipo === 'sentinel') {
        // Lazy: só cria e adiciona quando o usuário escolhe
        if (!layerSentinel) layerSentinel = criarSentinel();
        layerSentinel.addTo(map);
    }
    baseAtual = tipo;
    atualizarLegenda(tipo);
}

function atualizarLegenda(tipo) {
    const el = document.getElementById('mapa-legend');
    if (!el) return;
    if (tipo === 'osm') {
        el.textContent = 'Mapa de ruas (OpenStreetMap) · zoom para frentes';
    } else if (tipo === 'sentinel') {
        el.textContent = 'Sentinel-2 detalhe (EOX) · pode ser mais lento';
    } else {
        el.textContent = 'Satélite leve (Esri) · zoom para frentes';
    }
}

function initMap() {
    const el = document.getElementById('mapa');
    if (!el || typeof L === 'undefined') return;

    map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: false
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    // Default: só Esri (leve). Sentinel NÃO é criado nem adicionado aqui.
    layerEsri = criarEsri();
    layerEsri.addTo(map);
    baseAtual = 'esri';

    // Labels off by default
    layerLabels = criarLabels();

    markersLayer = L.layerGroup().addTo(map);

    const selBase = document.getElementById('mapa-base');
    if (selBase) {
        selBase.value = 'esri';
        selBase.addEventListener('change', () => {
            setBase(selBase.value);
        });
    }

    const toggle = document.getElementById('toggle-rotulos');
    if (toggle) {
        toggle.checked = false;
        toggle.addEventListener('change', () => {
            if (toggle.checked) {
                if (!layerLabels) layerLabels = criarLabels();
                if (!map.hasLayer(layerLabels)) layerLabels.addTo(map);
            } else if (layerLabels && map.hasLayer(layerLabels)) {
                map.removeLayer(layerLabels);
            }
        });
    }

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
                setTimeout(() => { if (map) map.invalidateSize(); }, 80);
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
            setTimeout(() => { if (map) map.invalidateSize(); }, 80);
        });
    }

    atualizarLegenda('esri');
    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
    window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
}

function markerPopup(lote) {
    const codigo = esc(lote.codigo_lote || '#' + lote.id);
    const tipo = esc(lote.tipo_minerio || 'Minério');
    const origem = esc(lote.origem || '—');
    const chatHref = APP_ROOT + 'chat.html?lote=' + encodeURIComponent(lote.codigo_lote || lote.id);
    const loteHref = APP_ROOT + 'lotes.html';
    return '<div class="mapa-popup">' +
        '<strong>' + codigo + '</strong><br>' +
        '<span>' + tipo + '</span><br>' +
        '<span class="mapa-popup-meta">📍 ' + origem + '</span><br>' +
        '<a class="mapa-popup-link" href="' + chatHref + '">Abrir chat</a> · ' +
        '<a class="mapa-popup-link" href="' + loteHref + '">Ver lotes</a>' +
        '</div>';
}

async function carregarMarcadores() {
    if (!markersLayer) return;
    markersLayer.clearLayers();
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('id, codigo_lote, tipo_minerio, origem, status, lat, lng')
            .not('lat', 'is', null)
            .not('lng', 'is', null);
        if (error) {
            // Colunas lat/lng podem ainda não existir — SQL 11
            console.warn('Marcadores lotes:', error.message);
            return;
        }
        const pts = [];
        (data || []).forEach(l => {
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
        if (pts.length === 1) {
            map.setView(pts[0], Math.max(map.getZoom(), 10));
        } else if (pts.length > 1) {
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
    initMap();
    await carregarMarcadores();
})();
