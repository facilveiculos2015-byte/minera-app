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

function badgeStatus(st) {
    const s = (st || 'pendente').toLowerCase();
    return '<span class="badge badge-' + s + '">' + s + '</span>';
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
        if (!data.length) {
            box.innerHTML = '<p>Ninguém postou ainda. Seja o primeiro em <a href="' + APP_ROOT + 'lotes.html">Lotes</a>.</p>';
            return;
        }
        box.innerHTML = '<ul class="feed-list">' + data.map(lote => {
            const quem = lote.criado_por || 'Usuário';
            const quando = tempoRelativo(lote.data_entrada);
            return `<li class="feed-item">
                <div class="feed-top"><b>${esc(quem)}</b> postou um lote${quando ? ' · ' + quando : ''}</div>
                <div class="feed-body"><b>${esc(lote.codigo_lote)}</b> — ${esc(lote.origem || '—')} · ${lote.peso_bruto_kg} kg</div>
                <div class="feed-meta">Status: ${badgeStatus(lote.status)}</div>
            </li>`;
        }).join('') + '</ul>';
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Não deu pra carregar o feed. Tente sair e entrar de novo.</p>';
    }
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    const perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('inicio');
    carregarFeed();
})();
