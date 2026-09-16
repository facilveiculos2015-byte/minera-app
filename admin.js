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
            .select('id, nome, email, tipo, papeis, bloqueado, bloqueado_motivo, auth_id')
            .order('id', { ascending: false })
            .limit(100);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum usuário.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Nome</th><th>E-mail</th><th>Papéis</th><th>Status</th><th></th></tr></thead><tbody>' +
            data.map(u => {
                const papeis = Array.isArray(u.papeis) ? u.papeis.join(', ') : (u.tipo || '');
                const bloq = !!(u.bloqueado === true || u.bloqueado === 'true' || u.bloqueado === 't');
                const st = bloq
                    ? '<span class="badge badge-atrasado">Bloqueado</span>'
                    : '<span class="badge badge-pago">OK</span>';
                const btn = bloq
                    ? '<button type="button" class="btn-sm btn-ok" data-act="desbloquear" data-id="' + u.id + '">Desbloquear</button>'
                    : '';
                return `<tr data-id="${u.id}">
                    <td>${esc(u.nome || '—')}</td>
                    <td>${esc(u.email || '—')}</td>
                    <td>${esc(papeis)}</td>
                    <td>${st}${bloq && u.bloqueado_motivo ? '<br><span class="sub">' + esc(u.bloqueado_motivo) + '</span>' : ''}</td>
                    <td class="card-actions">${btn}</td>
                </tr>`;
            }).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-act="desbloquear"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                const { error } = await supabaseClient.from('usuarios').update({
                    bloqueado: false,
                    bloqueado_motivo: null,
                    bloqueado_em: null
                }).eq('id', id);
                if (error) return toastMsg('Erro: ' + error.message + ' (SQL 13?)');
                toastMsg('Usuário desbloqueado');
                carregarUsuarios();
            });
        });
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
            const prev = document.getElementById('pix-admin-preview');
            if (prev) prev.classList.add('oculto');
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
        atualizarPixAdminPreview(ativo);
    } catch (e) {
        box.classList.remove('oculto');
        box.innerHTML = '<p class="erro">Pix indisponível: ' + esc(e.message) + ' (SQL 10)</p>';
        const prev = document.getElementById('pix-admin-preview');
        if (prev) prev.classList.add('oculto');
    }
}

/** Preview QR + Copia e Cola for sample R$ 1,00 (or key-only if no amount desired). */
function atualizarPixAdminPreview(pix) {
    const panel = document.getElementById('pix-admin-preview');
    const ta = document.getElementById('pix-admin-copia');
    const qrEl = document.getElementById('pix-admin-qr');
    if (!panel || !ta || !qrEl) return;
    const chaveEl = document.getElementById('pix-chave');
    const chave = (pix && pix.chave_pix) || (chaveEl && chaveEl.value.trim()) || '';
    if (!chave || typeof gerarPixCopiaCola !== 'function') {
        panel.classList.add('oculto');
        return;
    }
    const nome = (pix && pix.titular) ||
        (document.getElementById('pix-titular') && document.getElementById('pix-titular').value.trim()) ||
        (window.PixBrCode && PixBrCode.FALLBACK_NOME) ||
        'JeL empreendimentos';
    const cidade = (window.PixBrCode && PixBrCode.FALLBACK_CIDADE) || 'BELEM';
    try {
        const payload = gerarPixCopiaCola({
            chave,
            nome,
            cidade,
            valor: 1.0,
            txid: 'TESTE1'
        });
        ta.value = payload;
        panel.classList.remove('oculto');
        if (window.PixBrCode && typeof PixBrCode.renderQr === 'function') {
            PixBrCode.renderQr(qrEl, payload, 180);
        }
    } catch (e) {
        console.warn('admin pix preview', e);
        panel.classList.add('oculto');
    }
}

const btnAdminCopiar = document.getElementById('btn-admin-copiar-pix');
if (btnAdminCopiar) {
    btnAdminCopiar.addEventListener('click', async () => {
        const ta = document.getElementById('pix-admin-copia');
        const payload = ta && ta.value;
        if (!payload) return toastMsg('Nada para copiar');
        try {
            if (window.PixBrCode && PixBrCode.copiarTexto) await PixBrCode.copiarTexto(payload);
            else await navigator.clipboard.writeText(payload);
            toastMsg('Pix Copia e Cola copiado!');
        } catch (e) {
            if (ta) { ta.focus(); ta.select(); }
            toastMsg('Selecione e copie manualmente (Ctrl+C)');
        }
    });
}

// Live preview when editing chave/titular
['pix-chave', 'pix-titular'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        atualizarPixAdminPreview({
            chave_pix: document.getElementById('pix-chave').value.trim(),
            titular: document.getElementById('pix-titular').value.trim()
        });
    });
});

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


async function carregarComissoes() {
    const box = document.getElementById('admin-comissoes');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('comissoes')
            .select('*')
            .order('criado_em', { ascending: false })
            .limit(50);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhuma comissão.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Lote</th><th>Vendedor</th><th>Venda</th><th>1%</th><th>Status</th><th>Venc.</th><th></th></tr></thead><tbody>' +
            data.map(c => {
                const when = c.criado_em ? new Date(c.criado_em).toLocaleString('pt-BR') : '';
                const venc = c.vencimento ? new Date(c.vencimento).toLocaleDateString('pt-BR') : '—';
                const venda = c.valor_venda != null
                    ? Number(c.valor_venda).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—';
                const com = c.valor_comissao != null
                    ? Number(c.valor_comissao).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—';
                let st = c.status || 'pendente';
                if (st === 'pendente' && c.vencimento && new Date(c.vencimento).getTime() < Date.now()) {
                    st = 'atrasado';
                    // fire-and-forget mark
                    supabaseClient.from('comissoes').update({ status: 'atrasado' }).eq('id', c.id).then(() => {});
                }
                const btnPago = st === 'pago'
                    ? ''
                    : '<button type="button" class="btn-sm btn-ok" data-act="comissao-pago">Marcar pago</button>';
                return `<tr data-id="${c.id}">
                    <td>${esc(when)}</td>
                    <td>#${c.lote_id != null ? c.lote_id : '—'}</td>
                    <td>${esc(c.vendedor_nome || c.vendedor_auth_id || '—')}</td>
                    <td>${esc(venda)}</td>
                    <td>${esc(com)}</td>
                    <td><span class="badge">${esc(st)}</span></td>
                    <td>${esc(venc)}</td>
                    <td class="card-actions">${btnPago}</td>
                </tr>`;
            }).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-act="comissao-pago"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tr = btn.closest('tr');
                const id = parseInt(tr.getAttribute('data-id'), 10);
                const row = (data || []).find(c => c.id === id);
                const { error } = await supabaseClient.from('comissoes')
                    .update({ status: 'pago' })
                    .eq('id', id);
                if (error) return toastMsg('Erro: ' + error.message);
                // Limpa bloqueio do vendedor se não restar atraso
                if (row && row.vendedor_auth_id) {
                    try {
                        const { data: rest } = await supabaseClient
                            .from('comissoes')
                            .select('id,status,vencimento')
                            .eq('vendedor_auth_id', row.vendedor_auth_id)
                            .in('status', ['pendente', 'atrasado'])
                            .limit(20);
                        const agora = Date.now();
                        const aindaAtraso = (rest || []).some(c => {
                            if (c.id === id) return false;
                            if (c.status === 'atrasado') return true;
                            const v = c.vencimento ? new Date(c.vencimento).getTime() : 0;
                            return c.status === 'pendente' && v && v < agora;
                        });
                        if (!aindaAtraso) {
                            await supabaseClient.from('usuarios').update({
                                bloqueado: false,
                                bloqueado_motivo: null,
                                bloqueado_em: null
                            }).eq('auth_id', row.vendedor_auth_id);
                        }
                    } catch (e) { console.warn('clear block', e); }
                }
                toastMsg('Comissão marcada como paga');
                carregarComissoes();
                carregarUsuarios();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 12)</p>';
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
        carregarPixPagamentos(),
        carregarComissoes()
    ]);
})();
