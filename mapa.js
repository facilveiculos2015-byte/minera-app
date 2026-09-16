/** Mapa de Satélite — Leaflet + Sentinel-2 cloudless (EOX), in-app. */

let perfilAtual = null;
let sessionAtual = null;
let map = null;
let layerSentinel = null;
let layerLabels = null;
let markersLayer = null;

const DEFAULT_CENTER = [-6.0, -50.0]; // Pará / Carajás
const DEFAULT_ZOOM = 7;

/** EOX Sentinel-2 cloudless 2024 — GoogleMapsCompatible XYZ (z/y/x), sem API key */
const SENTINEL_URL =
    'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
const SENTINEL_ATTR =
    '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> / ' +
    '<a href="https://eox.at" target="_blank" rel="noopener">EOX</a> ' +
    '(Contains modified Copernicus Sentinel data 2024)';

const LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';
const LABELS_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initMap() {
    const el = document.getElementById('mapa');
    if (!el || typeof L === 'undefined') return;

    map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: false
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    layerSentinel = L.tileLayer(SENTINEL_URL, {
        attribution: SENTINEL_ATTR,
        maxZoom: 16,
        maxNativeZoom: 14,
        tileSize: 256,
        crossOrigin: true
    }).addTo(map);

    layerLabels = L.tileLayer(LABELS_URL, {
        attribution: LABELS_ATTR,
        maxZoom: 18,
        opacity: 0.9,
        pane: 'overlayPane'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    const toggle = document.getElementById('toggle-rotulos');
    if (toggle) {
        toggle.addEventListener('change', () => {
            if (toggle.checked) {
                if (!map.hasLayer(layerLabels)) layerLabels.addTo(map);
            } else if (map.hasLayer(layerLabels)) {
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
