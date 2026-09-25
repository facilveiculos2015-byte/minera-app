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
    const session = await requireSession();
    if (!session) return;
    const perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('lote-detalhe', perfil);

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
        let fotos = [];
        if (Array.isArray(data.fotos)) fotos = data.fotos.filter(Boolean);
        else if (typeof data.fotos === 'string') {
            try { fotos = JSON.parse(data.fotos) || []; } catch (e) { fotos = []; }
        }
        if (!fotos.length && data.imagem_url) fotos = [data.imagem_url];
        const destaque = (data.teor != null && data.teor !== '')
            ? ('Teor: ' + String(data.teor) + (String(data.tipo_minerio || '').toLowerCase() === 'cobre' && data.cobre_tipo
                ? ' (' + (data.cobre_tipo === 'soluvel' ? 'solúvel' : 'total') + ')'
                : ''))
            : (data.preco != null ? fmtBRL(data.preco) : 'Sob consulta');
        const locParts = [];
        if (data.cidade && data.estado) locParts.push(data.cidade + '-' + String(data.estado).toUpperCase());
        else if (data.cidade) locParts.push(data.cidade);
        else if (data.estado) locParts.push(String(data.estado).toUpperCase());
        const loc = locParts.join(' · ') || 'Parauapebas, PA';
        const gallery = fotos.length
            ? '<div class="lote-detalhe-gallery" data-lightbox-gallery="lote" style="display:flex;gap:8px;overflow-x:auto;margin-bottom:14px">' +
              fotos.map(function (u, i) {
                  // Toque na foto → MineraLightbox (lightbox.js) em tela cheia, começando nesta foto
                  return '<img src="' + esc(u) + '" alt="Foto ' + (i + 1) + '" data-lightbox="lote" tabindex="0" role="button" aria-label="Ampliar foto ' + (i + 1) + (fotos.length > 1 ? ' de ' + fotos.length : '') + '" style="cursor:zoom-in;width:100%;min-width:' + (fotos.length > 1 ? '85%' : '100%') + ';border-radius:14px;aspect-ratio:16/9;object-fit:cover">';
              }).join('') + '</div>'
            : '';
        const video = data.video_url
            ? '<video controls playsinline src="' + esc(data.video_url) + '" style="width:100%;border-radius:14px;margin-bottom:14px;background:#000"></video>'
            : '';
        const nego = APP_ROOT + 'chat.html?' +
            (data.criado_por_id ? ('com=' + encodeURIComponent(data.criado_por_id) + '&') : '') +
            'lote=' + encodeURIComponent(codigo);
        box.classList.remove('loading');
        box.innerHTML =
            gallery + video +
            '<p class="sub">' + esc(statusLabel(data.status)) + '</p>' +
            '<h2 style="border:0;margin:4px 0 8px">' + esc(data.tipo_minerio || 'Minério') + ' · ' + esc(codigo) + '</h2>' +
            '<p style="font-size:1.4rem;font-weight:800;color:#F5A623;margin-bottom:8px">' + esc(destaque) + '</p>' +
            '<p class="sub" style="margin-bottom:12px">' + esc(loc) +
            (data.peso_bruto_kg != null ? ' · ' + esc(String(data.peso_bruto_kg)) + ' kg' : '') + '</p>' +
            '<p style="margin-bottom:16px">Anunciante: <strong>' + esc(data.criado_por || 'Usuário') + '</strong></p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            '<a class="btn-ok" href="' + nego + '">Negociar no chat</a>' +
            '</div>';
    } catch (e) {
        console.error(e);
        box.innerHTML = '<p class="erro">Falha ao carregar anúncio.</p>';
    }
})();
