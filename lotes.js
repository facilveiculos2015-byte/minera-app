async function exigirLogin() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return null;
    }
    const email = session.user.email || '';
    const nome = (session.user.user_metadata && session.user.user_metadata.nome) || email;
    document.getElementById('user-label').textContent = 'Olá, ' + nome;
    return session;
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
        let html = '<ul>';
        data.forEach(lote => {
            html += `<li><b>${lote.codigo_lote}</b> - ${lote.origem} (${lote.peso_bruto_kg} kg) [Status: ${lote.status}]</li>`;
        });
        html += '</ul>';
        listaDiv.innerHTML = html;
    } catch (err) {
        console.error(err);
        listaDiv.innerHTML = '<p class="erro">Erro ao carregar dados. Faça login de novo.</p>';
    }
}

document.getElementById('form-lote').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo_lote = document.getElementById('codigo_lote').value.trim();
    const origem = document.getElementById('origem').value.trim();
    const peso_bruto_kg = parseFloat(document.getElementById('peso_bruto').value);
    const { data: { session } } = await supabaseClient.auth.getSession();
    const email = session && session.user ? (session.user.email || '') : '';
    const nome = (session && session.user && session.user.user_metadata && session.user.user_metadata.nome) || email;
    const { error } = await supabaseClient
        .from('lotes')
        .insert([{
            codigo_lote,
            origem,
            peso_bruto_kg,
            status: 'pendente',
            criado_por: nome || email || 'Usuário',
            criado_por_id: session && session.user ? session.user.id : null
        }]);
    if (error) {
        alert('Erro ao cadastrar lote: ' + error.message);
        return;
    }
    alert('Lote cadastrado com sucesso!');
    document.getElementById('form-lote').reset();
    carregarLotes();
});

document.getElementById('btn-sair').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
});

(async function init() {
    const session = await exigirLogin();
    if (!session) return;
    carregarLotes();
})();
