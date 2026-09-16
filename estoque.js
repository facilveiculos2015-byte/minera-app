let perfilAtual = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function carregarEstoque() {
    const box = document.getElementById('estoque-lista');
    try {
        const { data, error } = await supabaseClient
            .from('estoque')
            .select('*')
            .order('id', { ascending: false });
        if (error) throw error;
        if (!data.length) {
            box.innerHTML = '<p>Estoque vazio.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Material</th><th>Peso (kg)</th><th>Local</th><th>Atualizado</th></tr></thead><tbody>' +
            data.map(e => `<tr>
                <td><b>${esc(e.tipo_material)}</b></td>
                <td>${e.peso_atual_kg}</td>
                <td>${esc(e.localizacao || '—')}</td>
                <td>${e.ultima_atualizacao ? new Date(e.ultima_atualizacao).toLocaleString('pt-BR') : '—'}</td>
            </tr>`).join('') + '</tbody></table></div>';
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Erro: ' + esc(err.message) + '</p>';
    }
}

document.getElementById('form-estoque').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('estoque-msg');
    const row = {
        tipo_material: document.getElementById('tipo_material').value.trim(),
        peso_atual_kg: parseFloat(document.getElementById('peso_atual_kg').value),
        localizacao: document.getElementById('localizacao').value.trim() || null,
        ultima_atualizacao: new Date().toISOString()
    };
    const { error } = await supabaseClient.from('estoque').insert([row]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    await registrarLog('estoque_criar', row, perfilAtual);
    msgEl.textContent = 'Material adicionado!';
    msgEl.className = 'msg ok';
    document.getElementById('form-estoque').reset();
    carregarEstoque();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('estoque');
    carregarEstoque();
})();
