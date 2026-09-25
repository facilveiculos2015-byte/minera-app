function openNativeMaps(query) {
    const q = encodeURIComponent(query || 'Parauapebas, PA');
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    let primary;
    if (isAndroid) primary = 'geo:0,0?q=' + q;
    else if (isIOS) primary = 'maps:0,0?q=' + q;
    else primary = 'https://www.google.com/maps/search/?api=1&query=' + q;
    const fallback = 'https://www.google.com/maps/search/?api=1&query=' + q;
    try {
        const a = document.createElement('a');
        a.href = primary;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        window.location.href = fallback;
        return;
    }
    // Desktop / failed intent → web fallback
    if (!isAndroid && !isIOS) {
        window.open(fallback, '_blank', 'noopener');
        return;
    }
    setTimeout(() => {
        // If still visible, soft-fallback (user can ignore)
        try { window.open(fallback, '_blank', 'noopener'); } catch (e2) { /* ignore */ }
    }, 1200);
}

function mapaGeoStatus(msg) {
    const el = document.getElementById('mapa-geo-status');
    if (el) el.textContent = msg || '';
}

/** Localização só via MineraGeo (geo.js): pede permissão apenas no toque do botão. */
function bindMinhaLocalizacaoMapa() {
    const b = document.getElementById('btn-mapa-minha-loc');
    if (!b || !window.MineraGeo) { if (b) b.hidden = true; return; }
    let ultima = null;
    // Carregamento: silencioso (só usa se já permitido ou em cache) — nunca abre o pedido.
    window.MineraGeo.obterLocalizacao({ motivo: 'mapa-load', interativo: false }).then((p) => {
        if (p) { ultima = p; mapaGeoStatus('Localização pronta.'); }
    });
    b.addEventListener('click', async () => {
        b.disabled = true;
        mapaGeoStatus('Buscando sua localização…');
        const p = ultima || await window.MineraGeo.obterLocalizacao({ motivo: 'mapa-botao', interativo: true, highAccuracy: true });
        b.disabled = false;
        if (!p) {
            const e = window.MineraGeo.ultimoErro;
            mapaGeoStatus(e === 'denied'
                ? 'Localização bloqueada. Libere nas configurações do celular para usar este botão.'
                : 'Não foi possível obter sua localização agora. Tente de novo.');
            return;
        }
        ultima = p;
        mapaGeoStatus('');
        openNativeMaps(p.lat.toFixed(6) + ',' + p.lng.toFixed(6));
    });
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    const perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('mapa', perfil);
    const btn = document.getElementById('btn-abrir-mapa-nativo');
    if (btn) btn.addEventListener('click', () => openNativeMaps('Parauapebas, PA'));
    bindMinhaLocalizacaoMapa();
    // Auto-offer once
    const params = new URLSearchParams(location.search);
    if (params.get('auto') === '1') openNativeMaps(params.get('q') || 'Parauapebas, PA');
})();
