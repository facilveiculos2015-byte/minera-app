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
    await carregarPixUsuario();
    await carregarComissoesPendentes();
    if (location.hash === '#pix' || location.hash === '#comissoes') {
        const el = document.getElementById(location.hash === '#comissoes' ? 'card-comissoes' : 'card-pix-user');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
})();

function isPixAtivoFlag(v) {
    return v === true || v === 'true' || v === 't' || v === 1 || v === '1';
}

async function buscarPixAtivo() {
    // Prefer explicit ativo=true; fall back to latest row with chave (boolean quirks / legacy null)
    let { data, error } = await supabaseClient
        .from('pix_admin')
        .select('*')
        .eq('ativo', true)
        .order('id', { ascending: false })
        .limit(1);
    if (error) throw error;
    if (data && data[0] && data[0].chave_pix) return data[0];

    // Retry without boolean filter (some PostgREST/boolean edge cases)
    ({ data, error } = await supabaseClient
        .from('pix_admin')
        .select('*')
        .order('id', { ascending: false })
        .limit(5));
    if (error) throw error;
    const rows = data || [];
    const active = rows.find(p => isPixAtivoFlag(p.ativo) && p.chave_pix);
    if (active) return active;
    const any = rows.find(p => p.chave_pix);
    return any || null;
}

async function carregarPixUsuario() {
    const info = document.getElementById('pix-user-info');
    const form = document.getElementById('form-pix-comprovante');
    if (!info) return;
    try {
        const pix = await buscarPixAtivo();
        if (!pix || !pix.chave_pix) {
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
        if (form) form.classList.add('oculto');
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


function fmtBRL(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function carregarComissoesPendentes() {
    const box = document.getElementById('comissoes-pendentes');
    if (!box || !perfilAtual) return;
    try {
        let q = supabaseClient
            .from('comissoes')
            .select('*')
            .eq('status', 'pendente')
            .order('criado_em', { ascending: false })
            .limit(30);
        if (perfilAtual.auth_id) q = q.eq('vendedor_auth_id', perfilAtual.auth_id);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhuma comissão pendente.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Lote</th><th>Venda</th><th>Comissão 1%</th><th>Vencimento</th><th></th></tr></thead><tbody>' +
            data.map(c => {
                const venc = c.vencimento ? new Date(c.vencimento).toLocaleDateString('pt-BR') : '—';
                return `<tr data-id="${c.id}">
                    <td>#${c.lote_id != null ? c.lote_id : '—'}</td>
                    <td>${fmtBRL(c.valor_venda)}</td>
                    <td><strong>${fmtBRL(c.valor_comissao)}</strong></td>
                    <td>${venc}</td>
                    <td><button type="button" class="btn-sm btn-ok" data-act="pagar-comissao"
                        data-valor="${c.valor_comissao}" data-id="${c.id}">Pagar via Pix</button></td>
                </tr>`;
            }).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">Comissões indisponíveis (rode SQL 12): ' +
            String(e.message || e).replace(/</g, '&lt;') + '</p>';
    }
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="pagar-comissao"]');
    if (!btn) return;
    const valor = btn.getAttribute('data-valor');
    const card = document.getElementById('card-pix-user');
    const input = document.getElementById('pix-valor');
    if (input && valor != null) {
        const n = Number(valor);
        input.value = Number.isFinite(n) ? n.toFixed(2) : valor;
    }
    if (card) {
        card.scrollIntoView({ behavior: 'smooth' });
        const form = document.getElementById('form-pix-comprovante');
        if (form) form.classList.remove('oculto');
    }
    toastMsg('Valor da comissão preenchido no Pix — envie o comprovante');
});

// Hook after init: load pix when perfil ready
(async function pixInitHook() {
    // wait a tick for main init
    for (let i = 0; i < 40; i++) {
        if (perfilAtual) break;
        await new Promise(r => setTimeout(r, 50));
    }
    if (perfilAtual) {
        await carregarPixUsuario();
        await carregarComissoesPendentes();
        if (location.hash === '#pix' || location.hash === '#comissoes') {
            const el = document.getElementById(location.hash === '#comissoes' ? 'card-comissoes' : 'card-pix-user');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    }
})();
