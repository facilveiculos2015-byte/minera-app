/** Mapa — Google Maps JavaScript API (ruas, satélite, marcador, rota, enviar no chat). */

let perfilAtual = null;
let sessionAtual = null;
let map = null;
let pinMarker = null;
let userMarker = null;
let directionsService = null;
let directionsRenderer = null;
let geocoder = null;
let marcarAtivo = true;
let pinLatLng = null;
let pinAddress = '';
let userLatLng = null;
let mapsReady = false;

const DEFAULT_CENTER = { lat: -14.235, lng: -51.9253 }; // Brasil
const DEFAULT_ZOOM = 5;
const PARA_CENTER = { lat: -6.0, lng: -50.0 };
const PARA_ZOOM = 7;

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

function showKeyPanel(show) {
    const panel = document.getElementById('mapa-key-panel');
    const canvas = document.getElementById('mapa');
    const actions = document.getElementById('mapa-actions');
    const legend = document.getElementById('mapa-legend');
    if (panel) panel.classList.toggle('oculto', !show);
    if (canvas) canvas.classList.toggle('oculto', !!show);
    if (actions) actions.classList.toggle('oculto', !!show);
    if (legend && show) legend.textContent = 'Chave Google Maps não configurada';
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

function updatePinInfo() {
    const btnSend = document.getElementById('btn-enviar-chat');
    if (!pinLatLng) {
        setInfo('');
        if (btnSend) btnSend.disabled = true;
        return;
    }
    const lat = pinLatLng.lat().toFixed(6);
    const lng = pinLatLng.lng().toFixed(6);
    const addr = pinAddress
        ? '<br><strong>Endereço:</strong> ' + esc(pinAddress)
        : '<br><span class="sub">Buscando endereço…</span>';
    setInfo(
        '<strong>Ponto marcado</strong><br>' +
        'Lat: ' + lat + ' · Lng: ' + lng + addr +
        '<div class="mapa-rota-row">' +
        '<input type="text" id="rota-origem" placeholder="Origem (vazio = minha localização)" autocomplete="off">' +
        '<input type="text" id="rota-destino" placeholder="Destino (vazio = marcador)" autocomplete="off">' +
        '<button type="button" class="btn-mapa" id="btn-tracar-rota">Traçar rota</button>' +
        '</div>'
    );
    if (btnSend) btnSend.disabled = false;
    const btnTracar = document.getElementById('btn-tracar-rota');
    if (btnTracar) btnTracar.addEventListener('click', tracarRotaManual);
}

function mapsLink(lat, lng) {
    return 'https://maps.google.com/?q=' + encodeURIComponent(lat + ',' + lng);
}

function placePin(latLng, opts) {
    if (!map || !latLng) return;
    pinLatLng = latLng;
    pinAddress = '';
    if (!pinMarker) {
        pinMarker = new google.maps.Marker({
            map: map,
            draggable: true,
            animation: google.maps.Animation.DROP,
            title: 'Ponto marcado'
        });
        pinMarker.addListener('dragend', () => {
            pinLatLng = pinMarker.getPosition();
            pinAddress = '';
            updatePinInfo();
            reverseGeocode(pinLatLng);
        });
    }
    pinMarker.setPosition(latLng);
    pinMarker.setMap(map);
    if (!opts || opts.pan !== false) {
        map.panTo(latLng);
        if (map.getZoom() < 12) map.setZoom(14);
    }
    updatePinInfo();
    reverseGeocode(latLng);
}

function reverseGeocode(latLng) {
    if (!geocoder || !latLng) return;
    geocoder.geocode({ location: latLng }, (results, status) => {
        if (status === 'OK' && results && results[0]) {
            pinAddress = results[0].formatted_address || '';
        } else {
            pinAddress = '';
        }
        updatePinInfo();
    });
}

function setMapType(tipo) {
    if (!map) return;
    const t = tipo || 'roadmap';
    map.setMapTypeId(t);
    const legend = document.getElementById('mapa-legend');
    if (!legend) return;
    if (t === 'hybrid' || t === 'satellite') {
        legend.textContent = 'Google Satélite · toque para marcar';
    } else if (t === 'terrain') {
        legend.textContent = 'Google Relevo · toque para marcar';
    } else {
        legend.textContent = 'Google Mapa (ruas) · toque para marcar';
    }
}

function resizeMap() {
    if (!map) return;
    try {
        google.maps.event.trigger(map, 'resize');
    } catch (e) {}
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocalização não disponível neste dispositivo.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
            }),
            err => reject(err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
        );
    });
}

async function irMinhaLocalizacao() {
    const btn = document.getElementById('btn-minha-loc');
    if (btn) btn.disabled = true;
    try {
        const coords = await getCurrentPosition();
        userLatLng = new google.maps.LatLng(coords.lat, coords.lng);
        if (!userMarker) {
            userMarker = new google.maps.Marker({
                map: map,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: '#3b82f6',
                    fillOpacity: 1,
                    strokeColor: '#fff',
                    strokeWeight: 2
                },
                title: 'Minha localização',
                zIndex: 999
            });
        }
        userMarker.setPosition(userLatLng);
        userMarker.setMap(map);
        map.panTo(userLatLng);
        if (map.getZoom() < 14) map.setZoom(15);
        if (!pinLatLng) placePin(userLatLng, { pan: false });
    } catch (err) {
        alert('Não foi possível obter sua localização. Verifique a permissão do navegador.');
        console.warn(err);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function ensureDirections() {
    if (!directionsService) directionsService = new google.maps.DirectionsService();
    if (!directionsRenderer) {
        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: false,
            polylineOptions: {
                strokeColor: '#f59e0b',
                strokeOpacity: 0.9,
                strokeWeight: 5
            }
        });
    }
}

function limparRota() {
    if (directionsRenderer) directionsRenderer.set('directions', null);
}

async function rotaAteMarcador() {
    if (!pinLatLng) {
        alert('Marque um ponto no mapa primeiro.');
        return;
    }
    try {
        if (!userLatLng) {
            const coords = await getCurrentPosition();
            userLatLng = new google.maps.LatLng(coords.lat, coords.lng);
        }
    } catch (e) {
        alert('Ative a localização ou preencha a origem na barra de rota.');
        return;
    }
    tracarRota(userLatLng, pinLatLng);
}

function tracarRotaManual() {
    const origEl = document.getElementById('rota-origem');
    const destEl = document.getElementById('rota-destino');
    const origTxt = (origEl && origEl.value || '').trim();
    const destTxt = (destEl && destEl.value || '').trim();

    const origin = origTxt || userLatLng || null;
    const destination = destTxt || pinLatLng || null;

    if (!origin) {
        alert('Informe a origem ou use “Minha localização”.');
        return;
    }
    if (!destination) {
        alert('Informe o destino ou marque um ponto no mapa.');
        return;
    }
    tracarRota(origin, destination);
}

function tracarRota(origin, destination) {
    ensureDirections();
    directionsService.route(
        {
            origin: origin,
            destination: destination,
            travelMode: google.maps.TravelMode.DRIVING
        },
        (result, status) => {
            if (status === 'OK' && result) {
                directionsRenderer.setDirections(result);
                const leg = result.routes[0] && result.routes[0].legs[0];
                if (leg) {
                    const extra =
                        '<br><strong>Rota:</strong> ' +
                        esc(leg.distance && leg.distance.text) +
                        ' · ' +
                        esc(leg.duration && leg.duration.text);
                    const el = document.getElementById('mapa-info');
                    if (el && !el.classList.contains('oculto')) {
                        // append once
                        if (!/Rota:/.test(el.innerHTML)) el.innerHTML += extra;
                    }
                }
            } else {
                alert('Não foi possível traçar a rota (' + status + '). Verifique se Directions API está ativa na chave.');
            }
        }
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
    const lat = pinLatLng.lat();
    const lng = pinLatLng.lng();
    const label = pinAddress || ('Local ' + lat.toFixed(5) + ', ' + lng.toFixed(5));
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

function wireUi() {
    const selBase = document.getElementById('mapa-base');
    if (selBase) {
        selBase.addEventListener('change', () => setMapType(selBase.value));
    }

    const btnLoc = document.getElementById('btn-minha-loc');
    if (btnLoc) btnLoc.addEventListener('click', irMinhaLocalizacao);

    const btnMarcar = document.getElementById('btn-marcar');
    if (btnMarcar) {
        btnMarcar.classList.add('on');
        btnMarcar.addEventListener('click', () => {
            marcarAtivo = !marcarAtivo;
            btnMarcar.classList.toggle('on', marcarAtivo);
            btnMarcar.textContent = marcarAtivo ? '📌 Marcar ponto (on)' : '📌 Marcar ponto';
        });
        btnMarcar.textContent = '📌 Marcar ponto (on)';
    }

    const btnRota = document.getElementById('btn-rota-marcador');
    if (btnRota) btnRota.addEventListener('click', rotaAteMarcador);

    const btnSend = document.getElementById('btn-enviar-chat');
    if (btnSend) btnSend.addEventListener('click', enviarNoChat);

    const btnLimpar = document.getElementById('btn-limpar-rota');
    if (btnLimpar) btnLimpar.addEventListener('click', limparRota);

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
}

function initGoogleMap() {
    const el = document.getElementById('mapa');
    if (!el || typeof google === 'undefined' || !google.maps) return;

    map = new google.maps.Map(el, {
        center: PARA_CENTER,
        zoom: PARA_ZOOM,
        mapTypeId: 'roadmap',
        fullscreenControl: false,
        streetViewControl: false,
        mapTypeControl: false,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false
    });

    geocoder = new google.maps.Geocoder();
    ensureDirections();

    map.addListener('click', (e) => {
        if (!marcarAtivo || !e.latLng) return;
        placePin(e.latLng);
    });

    mapsReady = true;
    setMapType((document.getElementById('mapa-base') || {}).value || 'roadmap');
    setTimeout(resizeMap, 100);
    setTimeout(resizeMap, 400);

    // Geolocalização silenciosa (se permitida)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                userLatLng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
                if (!userMarker) {
                    userMarker = new google.maps.Marker({
                        map: map,
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#3b82f6',
                            fillOpacity: 1,
                            strokeColor: '#fff',
                            strokeWeight: 2
                        },
                        title: 'Minha localização',
                        zIndex: 999
                    });
                }
                userMarker.setPosition(userLatLng);
                map.panTo(userLatLng);
                map.setZoom(14);
            },
            () => {
                // mantém centro Pará / Brasil
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
    }

    carregarMarcadoresLotes();
}

async function carregarMarcadoresLotes() {
    if (!map || typeof supabaseClient === 'undefined') return;
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
        const bounds = new google.maps.LatLngBounds();
        let count = 0;
        (data || []).forEach(l => {
            const lat = parseFloat(l.lat);
            const lng = parseFloat(l.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
            const pos = { lat: lat, lng: lng };
            const m = new google.maps.Marker({
                map: map,
                position: pos,
                title: String(l.codigo_lote || l.tipo_minerio || 'Lote'),
                opacity: 0.85
            });
            const codigo = esc(l.codigo_lote || '#' + l.id);
            const tipo = esc(l.tipo_minerio || 'Minério');
            const origem = esc(l.origem || '—');
            const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '/minera-app/');
            const chatHref = root + 'chat.html?lote=' + encodeURIComponent(l.codigo_lote || l.id);
            const info = new google.maps.InfoWindow({
                content:
                    '<div class="mapa-popup">' +
                    '<strong>' + codigo + '</strong><br>' +
                    '<span>' + tipo + '</span><br>' +
                    '<span class="mapa-popup-meta">📍 ' + origem + '</span><br>' +
                    '<a class="mapa-popup-link" href="' + chatHref + '">Abrir chat</a>' +
                    '</div>'
            });
            m.addListener('click', () => info.open({ map: map, anchor: m }));
            bounds.extend(pos);
            count++;
        });
        if (count === 1) {
            map.setCenter(bounds.getCenter());
            map.setZoom(Math.max(map.getZoom(), 10));
        } else if (count > 1 && !userLatLng) {
            map.fitBounds(bounds, 48);
        }
    } catch (err) {
        console.warn(err);
    }
}

function loadGoogleMapsScript(key) {
    return new Promise((resolve, reject) => {
        if (typeof google !== 'undefined' && google.maps) {
            resolve();
            return;
        }
        if (window.__mineraGmapsLoading) {
            window.__mineraGmapsLoading.then(resolve, reject);
            return;
        }
        window.__mineraGmapsLoading = new Promise((res, rej) => {
            const cbName = '__mineraGmapsInit_' + Date.now();
            window[cbName] = function () {
                try { delete window[cbName]; } catch (e) {}
                res();
            };
            const s = document.createElement('script');
            s.async = true;
            s.defer = true;
            s.src =
                'https://maps.googleapis.com/maps/api/js?key=' +
                encodeURIComponent(key) +
                '&libraries=places&language=pt-BR&region=BR&callback=' +
                cbName;
            s.onerror = function () {
                rej(new Error('Falha ao carregar Google Maps JS'));
            };
            document.head.appendChild(s);
        });
        window.__mineraGmapsLoading.then(resolve, reject);
    });
}

window.initMineraGoogleMap = function () {
    // callback legado / externo
    if (mapsReady) {
        resizeMap();
        return;
    }
    initGoogleMap();
};

(async function init() {
    sessionAtual = await requireSession();
    if (!sessionAtual) return;
    perfilAtual = await getPerfil(sessionAtual);
    aplicarUserLabel(perfilAtual);
    montarNav('mapa', perfilAtual);
    wireUi();

    const key = getMapsApiKey();
    if (!key) {
        showKeyPanel(true);
        return;
    }
    showKeyPanel(false);

    try {
        await loadGoogleMapsScript(key);
        initGoogleMap();
    } catch (err) {
        console.error(err);
        showKeyPanel(true);
        const panel = document.getElementById('mapa-key-panel');
        if (panel) {
            const p = document.createElement('p');
            p.style.color = '#f87171';
            p.textContent = 'Falha ao carregar o script do Google Maps. Confira a chave, restrições HTTP e se a Maps JavaScript API está ativa.';
            panel.appendChild(p);
        }
    }
})();
