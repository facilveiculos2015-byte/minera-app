let perfilAtual = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function countTable(table) {
    try {
        const { count, error } = await supabaseClient
            .from(table)
            .select('*', { count: 'exact', head: true });
        if (error) throw error;
        return count != null ? count : 0;
    } catch (e) {
        console.warn(table, e);
        return '—';
    }
}

async function carregarKpis() {
    document.getElementById('kpi-usuarios').textContent = await countTable('usuarios');
    document.getElementById('kpi-lotes').textContent = await countTable('lotes');
    document.getElementById('kpi-fretes').textContent = await countTable('fretes');
    document.getElementById('kpi-msgs').textContent = await countTable('chat_mensagens');
}

async function carregarUsuarios() {
    const box = document.getElementById('admin-usuarios');
    try {
        const { data, error } = await supabaseClient
            .from('usuarios')
            .select('id, nome, email, tipo, papeis')
            .order('id', { ascending: false })
            .limit(100);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum usuário.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Nome</th><th>E-mail</th><th>Papéis</th></tr></thead><tbody>' +
            data.map(u => {
                const papeis = Array.isArray(u.papeis) ? u.papeis.join(', ') : (u.tipo || '');
                return `<tr><td>${esc(u.nome || '—')}</td><td>${esc(u.email || '—')}</td><td>${esc(papeis)}</td></tr>`;
            }).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + '</p>';
    }
}

async function carregarLotes() {
    const box = document.getElementById('admin-lotes');
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('id, codigo_lote, tipo_minerio, status, criado_por, peso_bruto_kg, preco')
            .order('id', { ascending: false })
            .limit(30);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum lote.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Código</th><th>Tipo</th><th>Status</th><th>Por</th><th>Peso</th></tr></thead><tbody>' +
            data.map(l => `<tr>
                <td>${esc(l.codigo_lote)}</td>
                <td>${esc(l.tipo_minerio || '—')}</td>
                <td><span class="${statusBadgeClass(l.status)}">${esc(statusAmigavel(l.status))}</span></td>
                <td>${esc(l.criado_por || '—')}</td>
                <td>${esc(formatPeso(l.peso_bruto_kg))}</td>
            </tr>`).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + '</p>';
    }
}

async function carregarChatMonitor() {
    const box = document.getElementById('admin-chat');
    try {
        const { data, error } = await supabaseClient
            .from('chat_mensagens')
            .select('*')
            .order('criado_em', { ascending: false })
            .limit(80);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Sem mensagens.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>De</th><th>Texto</th><th>Status</th><th>Mod</th><th></th></tr></thead><tbody>' +
            data.map(m => {
                const when = m.criado_em ? new Date(m.criado_em).toLocaleString('pt-BR') : '';
                const del = m.deleted_at ? ' (removida)' : '';
                return `<tr data-id="${m.id}">
                    <td>${esc(when)}</td>
                    <td>${esc(m.de_nome || '—')}</td>
                    <td>${esc((m.texto || '').slice(0, 80))}${m.midia_url ? ' 📎' : ''}${del}</td>
                    <td>${esc(m.status || 'enviada')}</td>
                    <td>${esc(m.moderacao || '—')}</td>
                    <td class="card-actions">
                        <button type="button" class="btn-sm" data-act="flag">🚩</button>
                        <button type="button" class="btn-sm btn-danger" data-act="del">🗑</button>
                    </td>
                </tr>`;
            }).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tr = btn.closest('tr');
                const id = parseInt(tr.getAttribute('data-id'), 10);
                const act = btn.getAttribute('data-act');
                if (act === 'flag') {
                    const { error } = await supabaseClient.from('chat_mensagens')
                        .update({ moderacao: 'sinalizada' }).eq('id', id);
                    if (error) return toastMsg('Erro: ' + error.message);
                    toastMsg('Mensagem sinalizada');
                } else if (act === 'del') {
                    const { error } = await supabaseClient.from('chat_mensagens')
                        .update({
                            deleted_at: new Date().toISOString(),
                            moderacao: 'removida'
                        }).eq('id', id);
                    if (error) return toastMsg('Erro: ' + error.message);
                    toastMsg('Mensagem removida (soft)');
                }
                carregarChatMonitor();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' — rode SQL 10.</p>';
    }
}

async function carregarPixAdmin() {
    const box = document.getElementById('pix-admin-atual');
    try {
        const { data, error } = await supabaseClient
            .from('pix_admin')
            .select('*')
            .order('id', { ascending: false })
            .limit(5);
        if (error) throw error;
        const isPixAtivo = (v) => v === true || v === 'true' || v === 't' || v === 1 || v === '1';
        const ativo = (data || []).find(p => isPixAtivo(p.ativo)) || (data && data[0]);
        if (!ativo) {
            box.classList.add('oculto');
            return;
        }
        box.classList.remove('oculto');
        box.innerHTML = '<strong>Chave ativa</strong>' +
            '<div class="pix-chave">' + esc(ativo.chave_pix) + '</div>' +
            '<p class="sub">' + esc(ativo.tipo_chave || '') +
            (ativo.titular ? ' · ' + esc(ativo.titular) : '') + '</p>' +
            (ativo.instrucoes ? '<p>' + esc(ativo.instrucoes) + '</p>' : '');
        document.getElementById('pix-chave').value = ativo.chave_pix || '';
        document.getElementById('pix-tipo').value = ativo.tipo_chave || 'aleatoria';
        document.getElementById('pix-titular').value = ativo.titular || '';
        document.getElementById('pix-instrucoes').value = ativo.instrucoes || '';
        // Prefer showing as active if this is the chosen row (even if DB null/legacy)
        document.getElementById('pix-ativo').checked = isPixAtivo(ativo.ativo) || ativo === (data && data[0]);
        box.dataset.id = ativo.id;
    } catch (e) {
        box.classList.remove('oculto');
        box.innerHTML = '<p class="erro">Pix indisponível: ' + esc(e.message) + ' (SQL 10)</p>';
    }
}

document.getElementById('form-pix-admin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('pix-admin-msg');
    // Salvar chave sempre como ativa (checkbox só desativa se usuário desmarcar de propósito,
    // mas default / smoke: ativo=true). Também desativa as demais.
    const wantAtivo = document.getElementById('pix-ativo').checked;
    const row = {
        chave_pix: document.getElementById('pix-chave').value.trim(),
        tipo_chave: document.getElementById('pix-tipo').value,
        titular: document.getElementById('pix-titular').value.trim() || null,
        instrucoes: document.getElementById('pix-instrucoes').value.trim() || null,
        ativo: wantAtivo !== false, // default true even if somehow undefined
        atualizado_em: new Date().toISOString()
    };
    // Force true when saving a non-empty key (Admin "Salvar chave" implies activate)
    if (row.chave_pix) {
        row.ativo = true;
        document.getElementById('pix-ativo').checked = true;
    }
    const box = document.getElementById('pix-admin-atual');
    const existingId = box.dataset.id ? parseInt(box.dataset.id, 10) : null;
    let error;
    // Deactivate other keys first so Perfil .eq('ativo', true) finds this one
    if (row.ativo) {
        try {
            let q = supabaseClient.from('pix_admin').update({ ativo: false, atualizado_em: row.atualizado_em });
            if (existingId) q = q.neq('id', existingId);
            else q = q.gte('id', 1);
            await q;
        } catch (e) { console.warn('pix deactivate others', e); }
    }
    if (existingId) {
        ({ error } = await supabaseClient.from('pix_admin').update(row).eq('id', existingId));
    } else {
        const ins = await supabaseClient.from('pix_admin').insert([row]).select('id').limit(1);
        error = ins.error;
        if (!error && ins.data && ins.data[0]) box.dataset.id = String(ins.data[0].id);
    }
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    msgEl.textContent = 'Chave Pix salva!';
    msgEl.className = 'msg ok';
    await carregarPixAdmin();
});

async function carregarPixPagamentos() {
    const box = document.getElementById('admin-pix-pag');
    try {
        const { data, error } = await supabaseClient
            .from('pix_pagamentos')
            .select('*')
            .order('criado_em', { ascending: false })
            .limit(50);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum comprovante enviado.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Usuário</th><th>Valor</th><th>Comprovante</th><th>Status</th><th></th></tr></thead><tbody>' +
            data.map(p => {
                const when = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '';
                const link = p.comprovante_url
                    ? '<a href="' + esc(p.comprovante_url) + '" target="_blank" rel="noopener">Ver</a>'
                    : '—';
                return `<tr data-id="${p.id}">
                    <td>${esc(when)}</td>
                    <td>${esc(p.usuario_nome || p.usuario_auth_id || '—')}</td>
                    <td>${p.valor != null ? esc(Number(p.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) : '—'}</td>
                    <td>${link}</td>
                    <td>${esc(p.status || 'pendente')}</td>
                    <td class="card-actions">
                        <button type="button" class="btn-sm btn-ok" data-st="confirmado">OK</button>
                        <button type="button" class="btn-sm btn-danger" data-st="recusado">X</button>
                    </td>
                </tr>`;
            }).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-st]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.closest('tr').getAttribute('data-id'), 10);
                const status = btn.getAttribute('data-st');
                const { error } = await supabaseClient.from('pix_pagamentos')
                    .update({ status, atualizado_em: new Date().toISOString() })
                    .eq('id', id);
                if (error) return toastMsg('Erro: ' + error.message);
                toastMsg('Status: ' + status);
                carregarPixPagamentos();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 10)</p>';
    }
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    if (!ehAdmin(perfilAtual)) {
        alert('Acesso restrito a administradores.');
        irPara('inicio.html');
        return;
    }
    montarNav('admin', perfilAtual);
    await Promise.all([
        carregarKpis(),
        carregarUsuarios(),
        carregarLotes(),
        carregarChatMonitor(),
        carregarPixAdmin(),
        carregarPixPagamentos()
    ]);
})();
