let perfilAtual = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function carregarLotes() {
    const listaDiv = document.getElementById('lotes-lista');
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false });
        if (error) throw error;
        if (!data.length) {
            listaDiv.innerHTML = '<p>Nenhum lote cadastrado.</p>';
            return;
        }
        listaDiv.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Código</th><th>Tipo</th><th>Origem</th><th>Peso (kg)</th><th>Status</th><th>Por</th></tr></thead><tbody>' +
            data.map(l => `<tr>
                <td><b>${esc(l.codigo_lote)}</b></td>
                <td>${esc(l.tipo_minerio || '—')}</td>
                <td>${esc(l.origem || '—')}</td>
                <td>${l.peso_bruto_kg}</td>
                <td><span class="badge badge-${esc(l.status || 'pendente')}">${esc(l.status || 'pendente')}</span></td>
                <td>${esc(l.criado_por || '—')}</td>
            </tr>`).join('') +
            '</tbody></table></div>';
    } catch (err) {
        console.error(err);
        listaDiv.innerHTML = '<p class="erro">Erro ao carregar dados. Faça login de novo.</p>';
    }
}

document.getElementById('form-lote').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('lote-msg');
    const codigo_lote = document.getElementById('codigo_lote').value.trim();
    const origem = document.getElementById('origem').value.trim();
    const tipo_minerio = document.getElementById('tipo_minerio').value;
    const peso_bruto_kg = parseFloat(document.getElementById('peso_bruto').value);
    const { data: { session } } = await supabaseClient.auth.getSession();
    const nome = (perfilAtual && perfilAtual.nome) ||
        (session && session.user && session.user.user_metadata && session.user.user_metadata.nome) ||
        (session && session.user && session.user.email) || 'Usuário';
    const { error } = await supabaseClient
        .from('lotes')
        .insert([{
            codigo_lote,
            origem,
            tipo_minerio,
            peso_bruto_kg,
            status: 'pendente',
            criado_por: nome,
            criado_por_id: session && session.user ? session.user.id : null
        }]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    msgEl.textContent = 'Lote cadastrado!';
    msgEl.className = 'msg ok';
    await registrarLog('lote_criar', { codigo_lote, peso_bruto_kg, tipo_minerio }, perfilAtual);
    document.getElementById('form-lote').reset();
    carregarLotes();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('lotes', perfilAtual);
    carregarLotes();
})();
