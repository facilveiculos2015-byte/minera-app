let feedCache = [];
let filtroTipo = '';
let filtroStatus = '';

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
                    <span class="${statusBadgeClass(lote.status)}">${esc(statusAmigavel(lote.status))}</span>
                </div>
                <h3 class="lote-codigo">${esc(codigo)}</h3>
                <p class="lote-meta">📍 ${esc(lote.origem || '—')} · ⚖️ ${esc(formatPeso(lote.peso_bruto_kg))}</p>
                ${preco ? '<p class="lote-preco">' + esc(preco) + '</p>' : ''}
                <p class="lote-who">${esc(lote.criado_por || 'Usuário')}${quando ? ' · ' + quando : ''}</p>
                <a class="btn-card" href="${APP_ROOT}chat.html?lote=${encodeURIComponent(codigo)}">Negociar / Ver Detalhes</a>
            </div>
        </article>`;
    }).join('') + '</div>';
}

function aplicarFiltros() {
    let lista = feedCache.slice();
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
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false })
            .limit(50);
        if (error) throw error;
        feedCache = data || [];
        if (!feedCache.length) {
            box.innerHTML = '<p>Ninguém postou ainda. Seja o primeiro em <a href="' + APP_ROOT + 'lotes.html">Meus Lotes</a>.</p>';
            return;
        }
        aplicarFiltros();
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Não deu pra carregar o feed. Tente sair e entrar de novo.</p>';
    }
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    const perfil = await getPerfil(session);
    aplicarUserLabel(perfil);
    montarNav('inicio', perfil);
    bindChipGroup('filtro-tipo-chips', 'data-tipo', v => { filtroTipo = v; });
    bindChipGroup('filtro-status-chips', 'data-status', v => { filtroStatus = v; });
    const notif = document.getElementById('btn-notif');
    if (notif) notif.addEventListener('click', () => toastMsg('Sem notificações'));
    carregarFeed();
})();
