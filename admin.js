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

async function carregarEmprestimosAdmin() {
    const box = document.getElementById('admin-emprestimos');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('emprestimos')
            .select('*')
            .order('criado_em', { ascending: false })
            .limit(80);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum empréstimo.</p>';
            return;
        }
        const lab = { analise: 'Em análise', aprovado: 'Aprovado', rejeitado: 'Rejeitado', pago: 'Pago' };
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Nome</th><th>Valor</th><th>Total</th><th>Prazo</th><th>Status</th><th></th></tr></thead><tbody>' +
            data.map(e => {
                const when = e.criado_em ? new Date(e.criado_em).toLocaleString('pt-BR') : '—';
                const st = String(e.status || 'analise');
                let btns = '';
                if (st === 'analise') {
                    btns = '<button type="button" class="btn-sm btn-ok" data-act="aprovar">Aprovar</button> ' +
                        '<button type="button" class="btn-sm btn-danger" data-act="rejeitar">Rejeitar</button>';
                } else if (st === 'aprovado') {
                    btns = '<button type="button" class="btn-sm btn-ok" data-act="pago">Marcar pago</button>';
                }
                return `<tr data-id="${e.id}">
                    <td>${esc(when)}</td>
                    <td>${esc(e.nome || '—')}<br><span class="sub">${esc(e.finalidade || '')}</span></td>
                    <td>${esc(Number(e.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</td>
                    <td>${esc(Number(e.total_previsto != null ? e.total_previsto : (Number(e.valor)||0) * (1 + 0.15 * ((Number(e.prazo_dias)||30)/30))).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</td>
                    <td>${esc(e.prazo_dias)} d</td>
                    <td><span class="badge">${esc(lab[st] || st)}</span></td>
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
                    if (act === 'aprovar') {
                        const { error } = await supabaseClient.from('emprestimos').update({
                            status: 'aprovado',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        if (row) await creditarCaixaEmprestimo(row);
                        toastMsg('Empréstimo aprovado e creditado no Caixa');
                    } else if (act === 'rejeitar') {
                        const { error } = await supabaseClient.from('emprestimos').update({
                            status: 'rejeitado',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        toastMsg('Empréstimo rejeitado');
                    } else if (act === 'pago') {
                        const { error } = await supabaseClient.from('emprestimos').update({
                            status: 'pago',
                            atualizado_em: new Date().toISOString()
                        }).eq('id', id);
                        if (error) throw error;
                        toastMsg('Empréstimo marcado como pago');
                    }
                    carregarEmprestimosAdmin();
                } catch (e) {
                    toastMsg('Erro: ' + (e.message || e) + ' (SQL 14?)');
                }
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 14)</p>';
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
    montarNav('admin', perfilAtual);
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
        carregarSuporteAdmin()
    ]);
})();
