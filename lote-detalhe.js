(async function () {
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtBRL(n) {
        const v = Number(n);
        if (!isFinite(v)) return null;
        return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    function statusLabel(st) {
        const s = String(st || '').toLowerCase();
        if (s === 'expedido') return 'Vendido';
        if (s === 'em_processo' || s === 'processado') return 'Em trânsito';
        return 'Disponível';
    }
    function openNativeMap(query) {
        const q = encodeURIComponent(query || 'Parauapebas, PA');
        const ua = navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isAndroid = /Android/i.test(ua);
        let url;
        if (isAndroid) url = 'geo:0,0?q=' + q;
        else if (isIOS) url = 'maps:0,0?q=' + q;
        else url = 'https://www.google.com/maps/search/?api=1&query=' + q;
        window.open(url, '_blank', 'noopener');
        // fallback web after short delay if still here
        setTimeout(() => {
            window.location.href = 'https://www.google.com/maps/search/?api=1&query=' + q;
        }, 900);
    }

    const session = await requireSession();
    if (!session) return;
    const perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('inicio', perfil);

    const params = new URLSearchParams(location.search);
    const codigo = params.get('codigo') || '';
    const box = document.getElementById('detalhe');
    const back = document.getElementById('btn-voltar');
    if (back && typeof APP_ROOT === 'string') back.href = APP_ROOT + 'inicio.html';

    if (!codigo) {
        box.innerHTML = '<p class="erro">Anúncio não informado.</p>';
        return;
    }
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .eq('codigo_lote', codigo)
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            box.innerHTML = '<p class="erro">Anúncio não encontrado.</p>';
            return;
        }
        const preco = data.preco != null ? fmtBRL(data.preco) : 'Sob consulta';
        const locParts = [];
        if (data.cidade && data.estado) locParts.push(data.cidade + '-' + String(data.estado).toUpperCase());
        else if (data.cidade) locParts.push(data.cidade);
        else if (data.estado) locParts.push(String(data.estado).toUpperCase());
        const loc = locParts.join(' · ') || 'Parauapebas, PA';
        const img = data.imagem_url
            ? '<img src="' + esc(data.imagem_url) + '" alt="" style="width:100%;border-radius:14px;aspect-ratio:16/9;object-fit:cover;margin-bottom:14px">'
            : '';
        const nego = APP_ROOT + 'chat.html?' +
            (data.criado_por_id ? ('com=' + encodeURIComponent(data.criado_por_id) + '&') : '') +
            'lote=' + encodeURIComponent(codigo);
        box.classList.remove('loading');
        box.innerHTML =
            img +
            '<p class="sub">' + esc(statusLabel(data.status)) + '</p>' +
            '<h2 style="border:0;margin:4px 0 8px">' + esc(data.tipo_minerio || 'Minério') + ' · ' + esc(codigo) + '</h2>' +
            '<p style="font-size:1.4rem;font-weight:800;color:#F5A623;margin-bottom:8px">' + esc(preco) + '</p>' +
            '<p class="sub" style="margin-bottom:12px">' + esc(loc) +
            (data.peso_bruto_kg != null ? ' · ' + esc(String(data.peso_bruto_kg)) + ' kg' : '') + '</p>' +
            '<p style="margin-bottom:16px">Anunciante: <strong>' + esc(data.criado_por || 'Usuário') + '</strong></p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            '<a class="btn-ok" href="' + nego + '">Negociar no chat</a>' +
            '<button type="button" class="btn-ghost" id="btn-abrir-mapa">Abrir no mapa</button>' +
            '</div>';
        const bm = document.getElementById('btn-abrir-mapa');
        if (bm) bm.addEventListener('click', () => openNativeMap(loc || 'Parauapebas, PA'));
    } catch (e) {
        console.error(e);
        box.innerHTML = '<p class="erro">Falha ao carregar anúncio.</p>';
    }
})();
