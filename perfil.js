const PAPEIS_EDIT = ['minerador', 'comprador', 'transportador', 'dono_britador', 'carregamento', 'admin'];
let perfilAtual = null;

function lerPapeisForm() {
    return PAPEIS_EDIT.filter(id => {
        const el = document.getElementById('perfil-papel-' + id);
        return el && el.checked;
    });
}

function preencherForm(perfil) {
    document.getElementById('perfil-nome').value = perfil.nome || '';
    document.getElementById('perfil-email').value = perfil.email || '';
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis.map(p => String(p).toLowerCase()) : [];
    PAPEIS_EDIT.forEach(id => {
        const el = document.getElementById('perfil-papel-' + id);
        if (el) el.checked = papeis.includes(id);
    });
    const rowAdmin = document.getElementById('row-admin');
    if (rowAdmin) {
        // Mostra checkbox admin só se já for admin (não auto-promove)
        if (ehAdmin(perfil) || papeis.includes('admin')) {
            rowAdmin.classList.remove('oculto');
        } else {
            rowAdmin.classList.add('oculto');
        }
    }
}

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('perfil-msg');
    const nome = document.getElementById('perfil-nome').value.trim();
    const papeis = lerPapeisForm();
    if (!perfilAtual || !perfilAtual.id) {
        msgEl.textContent = 'Perfil ainda não vinculado na tabela usuarios. Faça logout/login e tente de novo.';
        msgEl.className = 'msg erro';
        return;
    }
    const tipo = papeis.includes('admin') ? 'admin' : 'operador';
    const { error } = await supabaseClient
        .from('usuarios')
        .update({ nome, papeis, tipo })
        .eq('id', perfilAtual.id);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    perfilAtual.nome = nome;
    perfilAtual.papeis = papeis;
    perfilAtual.tipo = tipo;
    aplicarUserLabel(perfilAtual);
    montarNav('perfil', perfilAtual);
    msgEl.textContent = 'Perfil salvo!';
    msgEl.className = 'msg ok';
    await registrarLog('perfil_atualizar', { papeis }, perfilAtual);
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('perfil', perfilAtual);
    preencherForm(perfilAtual);
})();
