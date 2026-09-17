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


async function creditarCaixaEmprestimo(emp) {
    const uid = emp.auth_id;
    const valor = Number(emp.valor) || 0;
    if (!uid || !(valor > 0)) return;
    let { data: row } = await supabaseClient
        .from('caixa_saldos')
        .select('*')
        .eq('auth_id', uid)
        .maybeSingle();
    if (!row) {
        const ins = await supabaseClient.from('caixa_saldos')
            .insert([{ auth_id: uid, saldo: 0, taxa_mensal: 5, taxa_yield_max: 5 }])
            .select('*').maybeSingle();
        if (ins.error) throw ins.error;
        row = ins.data;
    }
    const saldo = row && row.saldo != null ? Number(row.saldo) : 0;
    const novo = saldo + valor;
    const { error: movErr } = await supabaseClient.from('caixa_movimentos').insert([{
        auth_id: uid,
        tipo: 'emprestimo',
        valor: valor,
        saldo_apos: novo,
        observacao: 'Empréstimo #' + emp.id + ' aprovado'
    }]);
    if (movErr) throw movErr;
    const { error: upErr } = await supabaseClient.from('caixa_saldos').update({
        saldo: novo,
        atualizado_em: new Date().toISOString()
    }).eq('auth_id', uid);
    if (upErr) throw upErr;
}


async function creditarCaixaValor(uid, valor, tipo, obs) {
    if (!uid || !(Number(valor) > 0)) return;
    let { data: row } = await supabaseClient
        .from('caixa_saldos').select('*').eq('auth_id', uid).maybeSingle();
    if (!row) {
        const ins = await supabaseClient.from('caixa_saldos')
            .insert([{ auth_id: uid, saldo: 0, taxa_mensal: 5, taxa_yield_max: 5 }])
            .select('*').maybeSingle();
        if (ins.error) throw ins.error;
        row = ins.data;
    }
    const saldo = row && row.saldo != null ? Number(row.saldo) : 0;
    const novo = saldo + Number(valor);
    const { error: movErr } = await supabaseClient.from('caixa_movimentos').insert([{
        auth_id: uid, tipo: tipo || 'deposito', valor: Number(valor),
        saldo_apos: novo, observacao: obs || null
    }]);
    if (movErr) throw movErr;
    const { error: upErr } = await supabaseClient.from('caixa_saldos').update({
        saldo: novo, atualizado_em: new Date().toISOString()
    }).eq('auth_id', uid);
    if (upErr) throw upErr;
}

async function debitarCaixaValor(uid, valor, obs) {
    if (!uid || !(Number(valor) > 0)) throw new Error('Valor inválido');
    let { data: row } = await supabaseClient
        .from('caixa_saldos').select('*').eq('auth_id', uid).maybeSingle();
    if (!row) throw new Error('Usuário sem saldo no Caixa');
    const saldo = row.saldo != null ? Number(row.saldo) : 0;
    if (Number(valor) > saldo + 1e-9) throw new Error('Saldo insuficiente (' + saldo + ')');
    const novo = saldo - Number(valor);
    const { error: movErr } = await supabaseClient.from('caixa_movimentos').insert([{
        auth_id: uid, tipo: 'saque', valor: Number(valor),
        saldo_apos: novo, observacao: obs || null
    }]);
    if (movErr) throw movErr;
    const { error: upErr } = await supabaseClient.from('caixa_saldos').update({
        saldo: novo, atualizado_em: new Date().toISOString()
    }).eq('auth_id', uid);
    if (upErr) throw upErr;
}

async function carregarDepositosAdmin() {
    const box = document.getElementById('admin-depositos');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('caixa_deposito_pedidos')
            .select('*')
            .order('criado_em', { ascending: false })
            .limit(80);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum depósito.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Auth</th><th>Valor</th><th>Comprovante</th><th>Status</th><th></th></tr></thead><tbody>' +
            data.map(d => {
                const when = d.criado_em ? new Date(d.criado_em).toLocaleString('pt-BR') : '—';
                const st = String(d.status || 'pendente');
                let btns = '';
                if (st === 'pendente') {
                    btns = '<button type="button" class="btn-sm btn-ok" data-act="dep-ok">Confirmar</button> ' +
                        '<button type="button" class="btn-sm btn-danger" data-act="dep-no">Rejeitar</button>';
                }
                const link = d.comprovante_url
                    ? '<a href="' + esc(d.comprovante_url) + '" target="_blank" rel="noopener">ver</a>'
                    : '—';
                return `<tr data-id="${d.id}">
                    <td>${esc(when)}</td>
                    <td class="sub">${esc(String(d.auth_id || '').slice(0, 8))}…</td>
                    <td>${esc(Number(d.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</td>
                    <td>${link}</td>
                    <td><span class="badge">${esc(st)}</span></td>
                    <td class="card-actions">${btns}</td>
                </tr>`;
            }).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tr = btn.closest('tr');
                const id = parseInt(tr.getAttribute('data-id'), 10);
                const row = (data || []).find(x => x.id === id);
                const act = btn.getAttribute('data-act');
                try {
                    if (act === 'dep-ok') {
                        await creditarCaixaValor(row.auth_id, row.valor, 'deposito', 'Depósito #' + id + ' confirmado');
                        const { error } = await supabaseClient.from('caixa_deposito_pedidos').update({
                            status: 'confirmado',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        toastMsg('Depósito confirmado e creditado');
                    } else if (act === 'dep-no') {
                        const { error } = await supabaseClient.from('caixa_deposito_pedidos').update({
                            status: 'rejeitado',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        toastMsg('Depósito rejeitado');
                    }
                    carregarDepositosAdmin();
                } catch (e) {
                    toastMsg('Erro: ' + (e.message || e) + ' (SQL 15?)');
                }
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 15)</p>';
    }
}

async function carregarSaquesAdmin() {
    const box = document.getElementById('admin-saques');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('caixa_saque_pedidos')
            .select('*')
            .order('criado_em', { ascending: false })
            .limit(80);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum saque.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Auth</th><th>Valor</th><th>Pix destino</th><th>Status</th><th></th></tr></thead><tbody>' +
            data.map(s => {
                const when = s.criado_em ? new Date(s.criado_em).toLocaleString('pt-BR') : '—';
                const st = String(s.status || 'pendente');
                let btns = '';
                if (st === 'pendente') {
                    btns = '<button type="button" class="btn-sm btn-ok" data-act="saq-pago">Marcar pago</button> ' +
                        '<button type="button" class="btn-sm btn-danger" data-act="saq-no">Rejeitar</button>';
                }
                return `<tr data-id="${s.id}">
                    <td>${esc(when)}</td>
                    <td class="sub">${esc(String(s.auth_id || '').slice(0, 8))}…</td>
                    <td>${esc(Number(s.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</td>
                    <td>${esc(s.chave_pix_destino || '—')}</td>
                    <td><span class="badge">${esc(st)}</span></td>
                    <td class="card-actions">${btns}</td>
                </tr>`;
            }).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tr = btn.closest('tr');
                const id = parseInt(tr.getAttribute('data-id'), 10);
                const row = (data || []).find(x => x.id === id);
                const act = btn.getAttribute('data-act');
                try {
                    if (act === 'saq-pago') {
                        await debitarCaixaValor(row.auth_id, row.valor, 'Saque #' + id + ' processado');
                        const { error } = await supabaseClient.from('caixa_saque_pedidos').update({
                            status: 'pago',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        toastMsg('Saque marcado pago e debitado');
                    } else if (act === 'saq-no') {
                        const { error } = await supabaseClient.from('caixa_saque_pedidos').update({
                            status: 'rejeitado',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        toastMsg('Saque rejeitado');
                    }
                    carregarSaquesAdmin();
                } catch (e) {
                    toastMsg('Erro: ' + (e.message || e) + ' (SQL 15?)');
                }
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 15)</p>';
    }
}

function rotuloPapeisEmp(papeis, tipo) {
    const labels = {
        minerador: 'Minerador',
        comprador: 'Comprador',
        transportador: 'Transportador',
        transportador_mina_britador: 'Transportador (Mina–Britador)',
        transportador_britador_porto: 'Transportador (Britador–Porto)',
        dono_britador: 'Dono de Britador',
        carregamento: 'Carregador',
        admin: 'Admin',
        operador: 'Operador'
    };
    const arr = Array.isArray(papeis) ? papeis.map(p => String(p).toLowerCase()) : [];
    if (!arr.length && tipo) return labels[String(tipo).toLowerCase()] || tipo;
    return arr.map(p => labels[p] || p).join(', ') || (tipo || '—');
}

let creditoFilaAtiva = 'analise';
let creditoCacheRows = [];

function fmtBRL(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function atualizarBadgeEmprestimos(n) {
    const kpi = document.getElementById('kpi-emprestimos');
    if (kpi) kpi.textContent = String(n);
    const badge = document.getElementById('badge-emp-pendentes');
    if (badge) {
        if (n > 0) {
            badge.textContent = n > 99 ? '99+' : String(n);
            badge.classList.remove('oculto');
        } else {
            badge.classList.add('oculto');
        }
    }
    try {
        if (typeof MineraNotif !== 'undefined' && MineraNotif.setAdminEmpPendentes) {
            MineraNotif.setAdminEmpPendentes(n);
        }
    } catch (e) { /* ignore */ }
}

function filaDeEmprestimo(e) {
    if (e.fila) return String(e.fila);
    const st = String(e.status || 'analise');
    if (st === 'analise') return 'analise';
    if (st === 'rejeitado') return 'recusados';
    if (st === 'pago') return 'quitados';
    if (st === 'aprovado') {
        if (e.dias_atraso != null && Number(e.dias_atraso) > 0) return 'atraso';
        if (e.vencimento) {
            const venc = new Date(String(e.vencimento).slice(0, 10) + 'T12:00:00');
            const hoje = new Date();
            hoje.setHours(12, 0, 0, 0);
            const diff = Math.round((venc - hoje) / 86400000);
            if (diff < 0) return 'atraso';
            if (diff <= 3) return 'a_vencer';
        }
        if (e.dias_restantes != null && Number(e.dias_restantes) <= 3) return 'a_vencer';
        return 'ativos';
    }
    return st;
}

function checklistDocsHtml(e) {
    const docs = [
        ['Energia', e.doc_energia_url],
        ['Identidade', e.doc_identidade_url],
        ['CPF', e.doc_cpf_url],
        ['Selfie', e.doc_selfie_url],
        ['Extrato', e.doc_extrato_url]
    ];
    return '<ul class="doc-checklist">' + docs.map(([lab, url]) => {
        const ok = !!url;
        return '<li class="' + (ok ? 'doc-ok' : 'doc-falta') + '">' +
            (ok ? '✓' : '✗') + ' ' + lab +
            (ok ? ' <a href="' + esc(url) + '" target="_blank" rel="noopener">ver</a>' : '') +
            '</li>';
    }).join('') + '</ul>';
}

function diasLabel(e) {
    const fila = filaDeEmprestimo(e);
    if (fila === 'atraso') {
        const d = e.dias_atraso != null ? e.dias_atraso : '—';
        return '<span class="badge badge-atrasado">' + esc(d) + ' dia(s) atraso</span>';
    }
    if (fila === 'a_vencer' || fila === 'ativos') {
        const d = e.dias_restantes != null ? e.dias_restantes : '—';
        return '<span class="badge badge-pendente">' + esc(d) + ' dia(s) rest.</span>';
    }
    if (fila === 'quitados' && e.pago_em) {
        return '<span class="sub">Quitado ' + esc(new Date(e.pago_em).toLocaleDateString('pt-BR')) + '</span>';
    }
    return '<span class="sub">—</span>';
}

async function buscarEmprestimosAdminRows() {
    try {
        const { data, error } = await supabaseClient.rpc('admin_listar_emprestimos', { p_limit: 120 });
        if (!error && Array.isArray(data)) return data;
        if (error) console.warn('admin_listar_emprestimos:', error.message);
    } catch (e) {
        console.warn('RPC emprestimos indisponível', e);
    }
    const { data, error } = await supabaseClient
        .from('emprestimos')
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(120);
    if (error) throw error;
    const rows = data || [];
    const ids = [...new Set(rows.map(r => r.auth_id).filter(Boolean))];
    let byAuth = {};
    if (ids.length) {
        const { data: users } = await supabaseClient
            .from('usuarios')
            .select('auth_id, nome, tipo, papeis')
            .in('auth_id', ids);
        (users || []).forEach(u => { byAuth[u.auth_id] = u; });
    }
    const hoje = new Date();
    hoje.setHours(12, 0, 0, 0);
    return rows.map(e => {
        const u = byAuth[e.auth_id] || {};
        let dias_restantes = null, dias_atraso = null;
        if (e.vencimento && String(e.status) === 'aprovado') {
            const venc = new Date(String(e.vencimento).slice(0, 10) + 'T12:00:00');
            const diff = Math.round((venc - hoje) / 86400000);
            if (diff < 0) dias_atraso = -diff;
            else dias_restantes = diff;
        }
        return Object.assign({}, e, {
            usuario_nome: u.nome || null,
            usuario_tipo: u.tipo || null,
            usuario_papeis: u.papeis || [],
            dias_restantes,
            dias_atraso
        });
    });
}

async function carregarCreditoKpis() {
    try {
        const { data, error } = await supabaseClient.rpc('admin_credito_kpis');
        if (!error && data) {
            const row = Array.isArray(data) ? data[0] : data;
            if (row) {
                const set = (id, v, money) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.textContent = money ? fmtBRL(v) : String(v != null ? v : '—');
                };
                set('ckpi-analise', row.em_analise);
                set('ckpi-vencer', row.a_vencer_3d);
                set('ckpi-atraso', row.atrasados);
                set('ckpi-aberto', row.total_em_aberto, true);
                set('ckpi-quitado', row.total_quitado_mes, true);
                return;
            }
        }
    } catch (e) { console.warn('admin_credito_kpis', e); }
    const rows = creditoCacheRows || [];
    let analise = 0, vencer = 0, atraso = 0, aberto = 0, quitado = 0;
    const hoje = new Date();
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    rows.forEach(e => {
        const f = filaDeEmprestimo(e);
        if (f === 'analise') analise++;
        if (f === 'a_vencer') vencer++;
        if (f === 'atraso') atraso++;
        if (String(e.status) === 'aprovado') aberto += Number(e.valor) || 0;
        if (String(e.status) === 'pago') {
            const when = e.pago_em || e.atualizado_em;
            if (when && new Date(when) >= mesIni) quitado += Number(e.valor) || 0;
        }
    });
    const set = (id, v, money) => {
        const el = document.getElementById(id);
        if (el) el.textContent = money ? fmtBRL(v) : String(v);
    };
    set('ckpi-analise', analise);
    set('ckpi-vencer', vencer);
    set('ckpi-atraso', atraso);
    set('ckpi-aberto', aberto, true);
    set('ckpi-quitado', quitado, true);
}

function renderCreditoLista(rows) {
    const box = document.getElementById('admin-emprestimos');
    if (!box) return;
    const filtered = (rows || []).filter(e => filaDeEmprestimo(e) === creditoFilaAtiva);
    if (!filtered.length) {
        box.innerHTML = '<p class="sub">Nenhum empréstimo nesta fila.</p>';
        return;
    }
    const lab = {
        analise: 'Em análise', aprovado: 'Aprovado', rejeitado: 'Recusado', pago: 'Quitado',
        a_vencer: 'A vencer', atraso: 'Em atraso', ativos: 'Ativo', quitados: 'Quitado', recusados: 'Recusado'
    };
    const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
    box.innerHTML = filtered.map(e => {
        const st = String(e.status || 'analise');
        const fila = filaDeEmprestimo(e);
        const nomeShow = e.nome || e.usuario_nome || '—';
        const auth = e.auth_id || '';
        const chatHref = root + 'chat.html?com=' + encodeURIComponent(auth);
        const when = e.criado_em ? new Date(e.criado_em).toLocaleString('pt-BR') : '—';
        const venc = e.vencimento
            ? new Date(String(e.vencimento).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR')
            : '—';
        let btns = '';
        if (st === 'analise') {
            btns = '<button type="button" class="btn-sm btn-ok" data-act="aprovar">Aprovar</button> ' +
                '<button type="button" class="btn-sm btn-danger" data-act="rejeitar">Recusar</button> ';
        } else if (st === 'aprovado') {
            btns = '<button type="button" class="btn-sm btn-ok" data-act="quitado">Marcar quitado</button> ';
        }
        btns += '<a class="btn-sm btn-ghost" href="' + chatHref + '">Abrir chat</a>';
        const kycBits = [
            e.endereco ? ('Endereço: ' + e.endereco) : '',
            e.empresa ? ('Empresa: ' + e.empresa) : '',
            e.anos_empresa != null ? ('Anos na empresa: ' + e.anos_empresa) : '',
            e.comprova_renda != null ? ('Comprova renda: ' + (e.comprova_renda ? 'sim' : 'não')) : '',
            e.finalidade ? ('Finalidade: ' + e.finalidade) : '',
            e.telefone ? ('Tel: ' + e.telefone) : '',
            e.renda_declarada != null ? ('Renda: ' + fmtBRL(e.renda_declarada)) : '',
            e.observacoes ? ('Obs: ' + e.observacoes) : '',
            rotuloPapeisEmp(e.usuario_papeis, e.usuario_tipo)
        ].filter(Boolean).join(' · ') || 'Sem dados KYC';
        return `<article class="credito-card" data-id="${e.id}">
            <div class="credito-card-head">
                <a class="credito-nome" href="${chatHref}" title="Abrir chat"><strong>${esc(nomeShow)}</strong></a>
                <span class="badge ${fila === 'atraso' ? 'badge-atrasado' : (st === 'analise' ? 'badge-pendente' : (st === 'rejeitado' ? 'badge-atrasado' : 'badge-pago'))}">${esc(lab[fila] || lab[st] || st)}</span>
            </div>
            <div class="credito-card-meta">
                <span>${esc(fmtBRL(e.valor))}</span>
                <span>Solicitado: ${esc(when)}</span>
                <span>Vencimento: ${esc(venc)}</span>
                ${diasLabel(e)}
            </div>
            <div class="credito-card-kyc sub">${esc(kycBits)}</div>
            <div class="credito-card-docs">${checklistDocsHtml(e)}</div>
            <div class="card-actions">${btns}</div>
        </article>`;
    }).join('');

    box.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.credito-card');
            const id = parseInt(card.getAttribute('data-id'), 10);
            const row = (creditoCacheRows || []).find(x => x.id === id);
            const act = btn.getAttribute('data-act');
            btn.disabled = true;
            try {
                if (act === 'aprovar') {
                    let dias = Number(row && row.prazo_dias) || 30;
                    const ask = prompt('Prazo até o vencimento (dias):', String(dias));
                    if (ask === null) { btn.disabled = false; return; }
                    dias = parseInt(ask, 10);
                    if (!(dias > 0)) throw new Error('Informe dias válidos');
                    const venc = new Date();
                    venc.setDate(venc.getDate() + dias);
                    const vencStr = venc.toISOString().slice(0, 10);
                    const { error } = await supabaseClient.from('emprestimos').update({
                        status: 'aprovado',
                        vencimento: vencStr,
                        atualizado_em: new Date().toISOString()
                    }).eq('id', id);
                    if (error) throw error;
                    if (row) await creditarCaixaEmprestimo(row);
                    toastMsg('Crédito liberado · vencimento ' + new Date(vencStr + 'T12:00:00').toLocaleDateString('pt-BR'));
                } else if (act === 'rejeitar') {
                    const { error } = await supabaseClient.from('emprestimos').update({
                        status: 'rejeitado',
                        atualizado_em: new Date().toISOString()
                    }).eq('id', id);
                    if (error) throw error;
                    toastMsg('Empréstimo recusado');
                } else if (act === 'quitado' || act === 'pago') {
                    const { error } = await supabaseClient.from('emprestimos').update({
                        status: 'pago',
                        pago_em: new Date().toISOString(),
                        atualizado_em: new Date().toISOString()
                    }).eq('id', id);
                    if (error) throw error;
                    toastMsg('Empréstimo marcado como quitado');
                }
                carregarEmprestimosAdmin();
            } catch (e) {
                btn.disabled = false;
                toastMsg('Erro: ' + (e.message || e) + ' (SQL 23/30?)');
            }
        });
    });
}

function bindCreditoFilas() {
    const wrap = document.getElementById('credito-filas');
    if (!wrap || wrap._bound) return;
    wrap._bound = true;
    wrap.querySelectorAll('[data-fila]').forEach(btn => {
        btn.addEventListener('click', () => {
            creditoFilaAtiva = btn.getAttribute('data-fila') || 'analise';
            wrap.querySelectorAll('[data-fila]').forEach(b => b.classList.toggle('on', b === btn));
            renderCreditoLista(creditoCacheRows);
        });
    });
}

async function carregarEmprestimosAdmin() {
    const box = document.getElementById('admin-emprestimos');
    if (!box) return;
    bindCreditoFilas();
    try {
        const data = await buscarEmprestimosAdminRows();
        creditoCacheRows = data || [];
        const pendentes = creditoCacheRows.filter(e => filaDeEmprestimo(e) === 'analise').length;
        atualizarBadgeEmprestimos(pendentes);
        await carregarCreditoKpis();
        renderCreditoLista(creditoCacheRows);
    } catch (e) {
        atualizarBadgeEmprestimos(0);
        box.innerHTML = '<p class="erro">' + esc(e.message) +
            ' — aplique sql/23-admin-emprestimos.sql e sql/30-admin-credito.sql no Supabase.</p>';
    }
}

function bindAdminTabs() {
    const tabs = document.getElementById('admin-tabs');
    if (!tabs || tabs._bound) return;
    tabs._bound = true;
    const show = (name) => {
        document.querySelectorAll('.admin-tab').forEach(t => {
            const on = t.getAttribute('data-tab') === name;
            t.classList.toggle('on', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.admin-panel').forEach(p => {
            p.classList.toggle('oculto', p.getAttribute('data-panel') !== name);
        });
        try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
    };
    tabs.querySelectorAll('.admin-tab').forEach(btn => {
        btn.addEventListener('click', () => show(btn.getAttribute('data-tab') || 'visao'));
    });
    const hash = (location.hash || '').replace('#', '');
    const map = {
        'sec-admin-emprestimos': 'credito',
        alertas: 'alertas',
        credito: 'credito',
        caixa: 'caixa',
        usuarios: 'usuarios',
        chat: 'chat',
        visao: 'visao'
    };
    show(map[hash] || (hash && document.querySelector('.admin-panel[data-panel="' + hash + '"]') ? hash : 'visao'));
}

async function carregarAlertasAdmin() {
    const box = document.getElementById('admin-alertas');
    if (!box) return;
    try {
        try { await supabaseClient.rpc('admin_gerar_alertas_credito'); } catch (e) { /* optional */ }
        let rows = [];
        try {
            const { data, error } = await supabaseClient.rpc('admin_listar_alertas', { p_limit: 80 });
            if (!error && Array.isArray(data)) rows = data;
            else throw error || new Error('RPC indisponível');
        } catch (e) {
            const { data, error } = await supabaseClient
                .from('admin_alertas')
                .select('*')
                .order('criado_em', { ascending: false })
                .limit(80);
            if (error) throw error;
            rows = data || [];
        }
        const unread = rows.filter(a => !a.lido).length;
        const badge = document.getElementById('badge-admin-alertas');
        if (badge) {
            if (unread > 0) {
                badge.textContent = unread > 99 ? '99+' : String(unread);
                badge.classList.remove('oculto');
            } else badge.classList.add('oculto');
        }
        try {
            if (typeof MineraNotif !== 'undefined' && MineraNotif.setAdminAlertas) {
                MineraNotif.setAdminAlertas(unread);
            }
        } catch (e) { /* ignore */ }

        if (!rows.length) {
            // Fallback: show due/overdue from cache
            const extras = (creditoCacheRows || []).filter(e => {
                const f = filaDeEmprestimo(e);
                return f === 'a_vencer' || f === 'atraso';
            });
            if (!extras.length) {
                box.innerHTML = '<p class="sub">Nenhum alerta no momento.</p>';
                return;
            }
            box.innerHTML = extras.map(e => {
                const f = filaDeEmprestimo(e);
                const chat = e.auth_id
                    ? '<a class="btn-sm btn-ghost" href="' + (typeof APP_ROOT === 'string' ? APP_ROOT : '') +
                      'chat.html?com=' + encodeURIComponent(e.auth_id) + '">Abrir chat</a>'
                    : '';
                return `<div class="alerta-item alerta-novo">
                    <div><strong>${esc(f === 'atraso' ? 'Empréstimo em atraso' : 'Empréstimo a vencer')}</strong></div>
                    <p>${esc((e.nome || e.usuario_nome || 'Cliente') + ' · ' + fmtBRL(e.valor))}</p>
                    <div class="card-actions">${chat}</div>
                </div>`;
            }).join('');
            return;
        }

        const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
        box.innerHTML = rows.map(a => {
            const when = a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR') : '';
            const chat = a.auth_id
                ? ('<a class="btn-sm btn-ghost" href="' + root + 'chat.html?com=' + encodeURIComponent(a.auth_id) + '">Abrir chat</a>')
                : '';
            const mark = !a.lido
                ? ('<button type="button" class="btn-sm" data-act="lido" data-id="' + a.id + '">Marcar lido</button>')
                : '';
            return `<div class="alerta-item ${a.lido ? 'alerta-lido' : 'alerta-novo'}">
                <div><strong>${esc(a.titulo || a.tipo)}</strong>
                <span class="sub">${esc(when)}</span></div>
                <p>${esc(a.corpo || '')}</p>
                <div class="card-actions">${mark} ${chat}</div>
            </div>`;
        }).join('');
        box.querySelectorAll('[data-act="lido"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                try {
                    await supabaseClient.rpc('admin_marcar_alerta_lido', { p_id: Number(id) });
                } catch (e) {
                    await supabaseClient.from('admin_alertas').update({ lido: true }).eq('id', id);
                }
                carregarAlertasAdmin();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' — aplique sql/30-admin-credito.sql</p>';
    }
}

function bindAlertasBtns() {
    const g = document.getElementById('btn-gerar-alertas');
    if (g && !g._bound) {
        g._bound = true;
        g.addEventListener('click', async () => {
            try {
                await supabaseClient.rpc('admin_gerar_alertas_credito');
                toastMsg('Alertas atualizados');
            } catch (e) {
                toastMsg('Falha ao gerar (SQL 30?): ' + (e.message || e));
            }
            carregarAlertasAdmin();
        });
    }
    const m = document.getElementById('btn-marcar-alertas-lidos');
    if (m && !m._bound) {
        m._bound = true;
        m.addEventListener('click', async () => {
            try {
                await supabaseClient.from('admin_alertas').update({ lido: true }).eq('lido', false);
                toastMsg('Alertas marcados como lidos');
            } catch (e) {
                toastMsg('Erro: ' + (e.message || e));
            }
            carregarAlertasAdmin();
        });
    }
}

async function carregarSuporteAdmin() {
    const box = document.getElementById('admin-suporte');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('suporte_mensagens')
            .select('id, de_auth_id, de_nome, texto, origem, thread_auth_id, criado_em, lido_admin')
            .order('criado_em', { ascending: false })
            .limit(200);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhuma mensagem de suporte ainda.</p>';
            return;
        }
        // Agrupa por thread_auth_id
        const threads = new Map();
        data.forEach(m => {
            const tid = m.thread_auth_id || m.de_auth_id || '—';
            if (!threads.has(tid)) threads.set(tid, []);
            threads.get(tid).push(m);
        });
        const list = [];
        threads.forEach((msgs, tid) => {
            msgs.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
            const last = msgs[msgs.length - 1];
            const userMsg = msgs.find(x => x.origem === 'user' && x.de_nome);
            const nome = (userMsg && userMsg.de_nome) || last.de_nome || tid.slice(0, 8);
            const pendenteHumano = msgs.some(x => x.origem === 'user' && /falar com humano|aguardando atendimento/i.test(x.texto || ''));
            list.push({ tid, nome, msgs, last, pendenteHumano });
        });
        list.sort((a, b) => new Date(b.last.criado_em) - new Date(a.last.criado_em));

        box.innerHTML = list.map((t, i) => {
            const preview = esc((t.last.texto || '').slice(0, 80));
            const when = t.last.criado_em ? new Date(t.last.criado_em).toLocaleString('pt-BR') : '';
            const badge = t.pendenteHumano ? '<span class="badge badge-atrasado">Humano</span>' : '';
            return `<div class="suporte-thread" data-tid="${esc(t.tid)}">
                <button type="button" class="suporte-thread-head" data-act="toggle-thread" data-i="${i}">
                    <strong>${esc(t.nome)}</strong> ${badge}
                    <span class="sub">${esc(when)} · ${preview}</span>
                </button>
                <div class="suporte-thread-body oculto" id="suporte-thread-${i}">
                    <div class="suporte-msgs admin-suporte-msgs">
                        ${t.msgs.map(m => {
                            const cls = m.origem === 'user' ? 'user' : (m.origem === 'admin' ? 'admin' : 'bot');
                            const who = m.origem === 'admin' ? (m.de_nome || 'Admin')
                                : (m.origem === 'bot' ? 'Robô' : (m.de_nome || 'User'));
                            return `<div class="suporte-bubble ${cls}"><div class="suporte-meta">${esc(who)}</div><div>${esc(m.texto)}</div></div>`;
                        }).join('')}
                    </div>
                    <form class="suporte-admin-reply" data-tid="${esc(t.tid)}">
                        <input type="text" name="reply" placeholder="Responder como admin…" required maxlength="2000">
                        <button type="submit" class="btn-ok btn-sm">Enviar</button>
                    </form>
                </div>
            </div>`;
        }).join('');

        box.querySelectorAll('[data-act="toggle-thread"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = btn.getAttribute('data-i');
                const body = document.getElementById('suporte-thread-' + i);
                if (body) body.classList.toggle('oculto');
            });
        });
        box.querySelectorAll('form.suporte-admin-reply').forEach(form => {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const tid = form.getAttribute('data-tid');
                const inp = form.querySelector('input[name="reply"]');
                const texto = (inp && inp.value || '').trim();
                if (!texto || !tid) return;
                const { error: err } = await supabaseClient.from('suporte_mensagens').insert([{
                    de_auth_id: perfilAtual && perfilAtual.auth_id,
                    de_nome: (perfilAtual && perfilAtual.nome) || 'Admin',
                    texto,
                    origem: 'admin',
                    thread_auth_id: tid
                }]);
                if (err) {
                    toastMsg('Erro: ' + err.message + ' (SQL 16?)');
                    return;
                }
                inp.value = '';
                toastMsg('Resposta enviada');
                carregarSuporteAdmin();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 16)</p>';
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
    document.body.classList.add('pagina-admin');
    montarNav('admin', perfilAtual);
    bindAdminTabs();
    bindAlertasBtns();
    await Promise.all([
        carregarKpis(),
        carregarUsuarios(),
        carregarLotes(),
        carregarChatMonitor(),
        carregarPixAdmin(),
        carregarPixPagamentos(),
        carregarComissoes(),
        carregarDepositosAdmin(),
        carregarSaquesAdmin(),
        carregarEmprestimosAdmin(),
        carregarSuporteAdmin(),
        carregarAlertasAdmin()
    ]);
    setInterval(() => {
        try { carregarEmprestimosAdmin(); } catch (e) { /* ignore */ }
        try { carregarAlertasAdmin(); } catch (e) { /* ignore */ }
    }, 45000);
})();
