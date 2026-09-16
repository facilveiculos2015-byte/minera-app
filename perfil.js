const PAPEIS_EDIT = [
    'minerador',
    'comprador',
    'transportador_mina_britador',
    'transportador_britador_porto',
    'dono_britador',
    'carregamento',
    'admin'
];
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
    // Legado transportador → marca ambas pernas
    const temTranspLegado = papeis.includes('transportador');
    PAPEIS_EDIT.forEach(id => {
        const el = document.getElementById('perfil-papel-' + id);
        if (!el) return;
        if (id === 'transportador_mina_britador' || id === 'transportador_britador_porto') {
            el.checked = papeis.includes(id) || temTranspLegado;
        } else {
            el.checked = papeis.includes(id);
        }
    });
    const rowAdmin = document.getElementById('row-admin');
    if (rowAdmin) {
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

async function carregarPixUsuario() {
    const info = document.getElementById('pix-user-info');
    const form = document.getElementById('form-pix-comprovante');
    if (!info) return;
    try {
        const { data, error } = await supabaseClient
            .from('pix_admin')
            .select('*')
            .eq('ativo', true)
            .order('id', { ascending: false })
            .limit(1);
        if (error) throw error;
        const pix = data && data[0];
        if (!pix) {
            info.innerHTML = '<p class="sub">Nenhuma chave Pix ativa no momento.</p>';
            if (form) form.classList.add('oculto');
            return;
        }
        info.innerHTML = '<div class="pix-box"><strong>Chave Pix</strong>' +
            '<div class="pix-chave">' + String(pix.chave_pix).replace(/</g,'&lt;') + '</div>' +
            '<p class="sub">' + (pix.tipo_chave || '') +
            (pix.titular ? ' · ' + String(pix.titular).replace(/</g,'&lt;') : '') + '</p>' +
            (pix.instrucoes ? '<p>' + String(pix.instrucoes).replace(/</g,'&lt;') + '</p>' : '') +
            '</div>';
        if (form) form.classList.remove('oculto');
    } catch (e) {
        info.innerHTML = '<p class="erro">Pix indisponível (rode SQL 10): ' + (e.message || e) + '</p>';
    }
    await carregarMeusPix();
}

async function carregarMeusPix() {
    const box = document.getElementById('pix-user-hist');
    if (!box || !perfilAtual) return;
    try {
        let q = supabaseClient.from('pix_pagamentos').select('*').order('criado_em', { ascending: false }).limit(10);
        if (perfilAtual.auth_id) q = q.eq('usuario_auth_id', perfilAtual.auth_id);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || !data.length) {
            box.textContent = '';
            return;
        }
        box.innerHTML = '<p><strong>Seus envios:</strong></p><ul>' + data.map(p => {
            const when = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '';
            return '<li>' + when + ' · R$ ' + (p.valor != null ? p.valor : '—') +
                ' · <span class="badge">' + (p.status || 'pendente') + '</span></li>';
        }).join('') + '</ul>';
    } catch (e) {
        box.textContent = '';
    }
}

const formPix = document.getElementById('form-pix-comprovante');
if (formPix) {
    formPix.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('pix-user-msg');
        if (!perfilAtual) return;
        const valorRaw = document.getElementById('pix-valor').value;
        const row = {
            usuario_id: perfilAtual.id || null,
            usuario_auth_id: perfilAtual.auth_id,
            usuario_nome: perfilAtual.nome || perfilAtual.email,
            valor: valorRaw === '' ? null : parseFloat(valorRaw),
            comprovante_url: document.getElementById('pix-comprovante').value.trim(),
            status: 'pendente'
        };
        const { error } = await supabaseClient.from('pix_pagamentos').insert([row]);
        if (error) {
            msgEl.textContent = 'Erro: ' + error.message + ' (SQL 10?)';
            msgEl.className = 'msg erro';
            return;
        }
        msgEl.textContent = 'Comprovante enviado! Aguarde confirmação.';
        msgEl.className = 'msg ok';
        formPix.reset();
        carregarMeusPix();
    });
}

// Hook after init: load pix when perfil ready
(async function pixInitHook() {
    // wait a tick for main init
    for (let i = 0; i < 40; i++) {
        if (perfilAtual) break;
        await new Promise(r => setTimeout(r, 50));
    }
    if (perfilAtual) {
        await carregarPixUsuario();
        if (location.hash === '#pix') {
            const el = document.getElementById('card-pix-user');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    }
})();
