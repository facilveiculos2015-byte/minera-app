const APP_BASE = new URL('.', window.location.href);
function irPara(pagina) { window.location.replace(new URL(pagina, APP_BASE).href); }

async function exigirLogin() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        irPara('index.html');
        return null;
    }
    const email = session.user.email || '';
    const nome = (session.user.user_metadata && session.user.user_metadata.nome) || email;
    document.getElementById('user-label').textContent = 'Olá, ' + nome;
    return session;
}

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
            box.innerHTML = '<p>Ninguém postou ainda. Seja o primeiro em <a href="lotes.html">Meus lotes / cadastrar</a>.</p>';
            return;
        }
        box.innerHTML = '<ul class="feed-list">' + data.map(lote => {
            const quem = lote.criado_por || 'Usuário';
            const quando = tempoRelativo(lote.data_entrada);
            return `<li class="feed-item">
                <div class="feed-top"><b>${quem}</b> postou um lote${quando ? ' · ' + quando : ''}</div>
                <div class="feed-body"><b>${lote.codigo_lote}</b> — ${lote.origem || '—'} · ${lote.peso_bruto_kg} kg</div>
                <div class="feed-meta">Status: ${lote.status || 'pendente'}</div>
            </li>`;
        }).join('') + '</ul>';
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Não deu pra carregar o feed. Tente sair e entrar de novo.</p>';
    }
}

document.getElementById('btn-sair').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    irPara('index.html');
});

(async function init() {
    const session = await exigirLogin();
    if (!session) return;
    carregarFeed();
})();
