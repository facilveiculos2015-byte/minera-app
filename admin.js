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
                    : '<button type="button" class="btn-sm btn-danger" data-act="bloquear" data-id="' + u.id + '">Bloquear login</button>';
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
        box.querySelectorAll('[data-act="bloquear"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                const motivo = prompt('Motivo do bloqueio de login (visível ao usuário):', 'Conta bloqueada pela administração.');
                if (motivo === null) return;
                const { error } = await supabaseClient.from('usuarios').update({
                    bloqueado: true,
                    bloqueado_motivo: String(motivo || 'Conta bloqueada pela administração.').slice(0, 500),
                    bloqueado_em: new Date().toISOString()
                }).eq('id', id);
                if (error) return toastMsg('Erro: ' + error.message + ' (SQL 13?)');
                toastMsg('Login bloqueado');
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

function bindAdminAccordion(root) {
    if (!root) return;
    root.querySelectorAll('[data-act="toggle-user"]').forEach(btn => {
        if (btn._boundAcc) return;
        btn._boundAcc = true;
        btn.addEventListener('click', () => {
            const i = btn.getAttribute('data-i');
            const body = root.querySelector('#chat-user-' + i) ||
                document.getElementById('chat-user-' + i);
            if (!body) return;
            const open = body.classList.toggle('oculto') === false;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            const chev = btn.querySelector('.admin-acc-chevron');
            if (chev) chev.textContent = open ? '▾' : '▸';
        });
    });
}

function syncAdminBulkBar(root, scope) {
    const bar = root.querySelector('.admin-bulk-bar[data-scope="' + scope + '"]');
    if (!bar) return;
    const cbs = Array.from(root.querySelectorAll('.admin-sel-cb[data-scope="' + scope + '"]:not(.admin-sel-thread)'));
    const selected = cbs.filter(c => c.checked);
    const countEl = bar.querySelector('[data-bulk-count]');
    if (countEl) countEl.textContent = selected.length + ' selecionado' + (selected.length === 1 ? '' : 's');
    if (selected.length) bar.classList.remove('oculto');
    else bar.classList.add('oculto');
}

function selectedAdminIds(root, scope) {
    return Array.from(root.querySelectorAll('.admin-sel-cb[data-scope="' + scope + '"]:not(.admin-sel-thread):checked'))
        .map(c => parseInt(c.value, 10))
        .filter(n => !isNaN(n));
}

function bindAdminBulkSelection(root, opts) {
    const scope = opts.scope;
    root.querySelectorAll('.admin-sel-cb[data-scope="' + scope + '"]').forEach(cb => {
        if (cb._boundBulk) return;
        cb._boundBulk = true;
        cb.addEventListener('change', () => syncAdminBulkBar(root, scope));
    });
    // Clique na linha (exceto no input) também alterna
    root.querySelectorAll('.admin-sel-row').forEach(row => {
        if (row._boundRow) return;
        row._boundRow = true;
        row.addEventListener('click', (e) => {
            if (e.target && e.target.closest && e.target.closest('a,button,input,form')) return;
            const cb = row.querySelector('.admin-sel-cb');
            if (!cb) return;
            // label already toggles checkbox; only sync
            syncAdminBulkBar(root, scope);
        });
    });
    const bar = root.querySelector('.admin-bulk-bar[data-scope="' + scope + '"]');
    if (!bar || bar._boundActions) return;
    bar._boundActions = true;
    bar.addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-bulk]') : null;
        if (!btn) return;
        const act = btn.getAttribute('data-bulk');
        const cbs = Array.from(root.querySelectorAll('.admin-sel-cb[data-scope="' + scope + '"]:not(.admin-sel-thread)'));
        if (act === 'marcar-todos') {
            cbs.forEach(c => { c.checked = true; });
            root.querySelectorAll('.admin-sel-thread[data-scope="' + scope + '"]').forEach(c => { c.checked = true; });
            syncAdminBulkBar(root, scope);
            return;
        }
        if (act === 'desmarcar') {
            cbs.forEach(c => { c.checked = false; });
            root.querySelectorAll('.admin-sel-thread[data-scope="' + scope + '"]').forEach(c => { c.checked = false; });
            syncAdminBulkBar(root, scope);
            return;
        }
        const ids = selectedAdminIds(root, scope);
        if (!ids.length) return toastMsg('Selecione ao menos um item');
        if (act === 'apagar' && opts.onApagar) return opts.onApagar(ids);
        if (act === 'flag' && opts.onFlag) return opts.onFlag(ids);
        if (act === 'arquivar' && opts.onArquivar) return opts.onArquivar(ids);
        if (act === 'atendido' && opts.onAtendido) return opts.onAtendido(ids);
    });
}

async function carregarChatMonitor() {
    const box = document.getElementById('admin-chat');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('chat_mensagens')
            .select('id, de_auth_id, de_nome, para_auth_id, texto, midia_url, status, moderacao, deleted_at, criado_em')
            .is('deleted_at', null)
            .order('criado_em', { ascending: false })
            .limit(200);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Sem mensagens ativas.</p>';
            return;
        }

        const authIds = new Set();
        data.forEach(m => {
            if (m.de_auth_id) authIds.add(m.de_auth_id);
            if (m.para_auth_id) authIds.add(m.para_auth_id);
        });
        const nomeByAuth = {};
        data.forEach(m => {
            if (m.de_auth_id && m.de_nome) nomeByAuth[m.de_auth_id] = m.de_nome;
        });
        if (authIds.size) {
            try {
                const { data: users } = await supabaseClient
                    .from('usuarios')
                    .select('auth_id, nome, apelido')
                    .in('auth_id', Array.from(authIds));
                (users || []).forEach(u => {
                    if (u.auth_id) {
                        nomeByAuth[u.auth_id] = u.apelido || u.nome || nomeByAuth[u.auth_id] || u.auth_id.slice(0, 8);
                    }
                });
            } catch (_) { /* nomes do próprio chat bastam */ }
        }
        const nomeDe = (aid) => (aid && nomeByAuth[aid]) || (aid ? aid.slice(0, 8) : '—');

        // Agrupa por remetente (usuário) → threads por destinatário
        const byUser = new Map();
        data.forEach(m => {
            const uid = m.de_auth_id || 'desconhecido';
            if (!byUser.has(uid)) {
                byUser.set(uid, {
                    uid,
                    nome: nomeDe(uid) !== '—' ? nomeDe(uid) : (m.de_nome || 'Desconhecido'),
                    msgs: [],
                    threads: new Map()
                });
            }
            const u = byUser.get(uid);
            if (m.de_nome && u.nome === (uid.slice ? uid.slice(0, 8) : u.nome)) u.nome = m.de_nome;
            u.msgs.push(m);
            const peer = m.para_auth_id || '_broadcast';
            if (!u.threads.has(peer)) u.threads.set(peer, []);
            u.threads.get(peer).push(m);
        });

        const users = Array.from(byUser.values());
        users.sort((a, b) => {
            const ta = a.msgs[0] && a.msgs[0].criado_em ? new Date(a.msgs[0].criado_em) : 0;
            const tb = b.msgs[0] && b.msgs[0].criado_em ? new Date(b.msgs[0].criado_em) : 0;
            return tb - ta;
        });

        const toolbar = `<div class="admin-bulk-bar oculto" id="chat-bulk-bar" data-scope="chat">
            <span class="admin-bulk-count" data-bulk-count>0 selecionados</span>
            <button type="button" class="btn-sm btn-ghost" data-bulk="marcar-todos">Marcar todos</button>
            <button type="button" class="btn-sm btn-ghost" data-bulk="desmarcar">Limpar</button>
            <button type="button" class="btn-sm" data-bulk="flag">🚩 Sinalizar</button>
            <button type="button" class="btn-sm btn-danger" data-bulk="apagar">Apagar</button>
        </div>`;

        const sections = users.map((u, ui) => {
            const unread = u.msgs.length;
            const badge = unread
                ? `<span class="admin-unread-badge">${unread > 99 ? '99+' : unread}</span>`
                : '';
            const threadBlocks = Array.from(u.threads.entries()).map(([peer, msgs]) => {
                const peerLabel = peer === '_broadcast' ? 'Geral' : ('Com ' + nomeDe(peer));
                const rows = msgs.map(m => {
                    const when = m.criado_em ? new Date(m.criado_em).toLocaleString('pt-BR') : '';
                    const preview = esc((m.texto || '').slice(0, 120)) + (m.midia_url ? ' 📎' : '');
                    const mod = m.moderacao && m.moderacao !== '—'
                        ? `<span class="badge">${esc(m.moderacao)}</span>` : '';
                    return `<label class="admin-sel-row" data-id="${m.id}">
                        <span class="admin-bolinha">
                            <input type="checkbox" class="admin-sel-cb" data-scope="chat" value="${m.id}">
                            <span class="bolinha" aria-hidden="true"></span>
                        </span>
                        <span class="admin-sel-body">
                            <span class="admin-sel-meta">${esc(when)} · ${esc(m.status || 'enviada')} ${mod}</span>
                            <span class="admin-sel-text">${preview}</span>
                        </span>
                    </label>`;
                }).join('');
                return `<div class="admin-thread-block">
                    <div class="admin-thread-peer">${esc(peerLabel)} <span class="sub">(${msgs.length})</span></div>
                    ${rows}
                </div>`;
            }).join('');

            return `<div class="admin-user-acc" data-uid="${esc(u.uid)}">
                <button type="button" class="admin-user-acc-head" data-act="toggle-user" data-i="${ui}" aria-expanded="false">
                    <span class="admin-acc-chevron">▸</span>
                    <strong>${esc(u.nome)}</strong>
                    ${badge}
                    <span class="sub admin-acc-hint">${unread} msg${unread === 1 ? '' : 's'}</span>
                </button>
                <div class="admin-user-acc-body oculto" id="chat-user-${ui}">
                    ${threadBlocks}
                </div>
            </div>`;
        }).join('');

        box.innerHTML = toolbar + '<div class="admin-user-list" id="chat-user-list">' + sections + '</div>';
        bindAdminAccordion(box);
        bindAdminBulkSelection(box, {
            scope: 'chat',
            onApagar: async (ids) => {
                if (!ids.length) return;
                if (!confirm('Apagar (soft-delete) ' + ids.length + ' mensagem(ns) selecionada(s)?')) return;
                const now = new Date().toISOString();
                const { error: err } = await supabaseClient.from('chat_mensagens')
                    .update({ deleted_at: now, moderacao: 'removida' })
                    .in('id', ids);
                if (err) return toastMsg('Erro: ' + err.message);
                toastMsg(ids.length + ' mensagem(ns) apagada(s)');
                carregarChatMonitor();
            },
            onFlag: async (ids) => {
                if (!ids.length) return;
                const { error: err } = await supabaseClient.from('chat_mensagens')
                    .update({ moderacao: 'sinalizada' })
                    .in('id', ids);
                if (err) return toastMsg('Erro: ' + err.message);
                toastMsg(ids.length + ' sinalizada(s)');
                carregarChatMonitor();
            }
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' — rode SQL 10/28.</p>';
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
        promos: 'promos',
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
        let q = supabaseClient
            .from('suporte_mensagens')
            .select('id, de_auth_id, de_nome, texto, origem, thread_auth_id, criado_em, lido_admin, deleted_at, arquivado, atendido_em')
            .order('criado_em', { ascending: false })
            .limit(300);
        let { data, error } = await q;
        if (error && /deleted_at|arquivado|atendido_em|column/i.test(error.message || '')) {
            const fb = await supabaseClient
                .from('suporte_mensagens')
                .select('id, de_auth_id, de_nome, texto, origem, thread_auth_id, criado_em, lido_admin')
                .order('criado_em', { ascending: false })
                .limit(300);
            data = fb.data;
            error = fb.error;
        }
        if (error) throw error;
        const raw = (data || []).filter(m => !m.deleted_at);
        const ativos = raw.filter(m => !m.arquivado);
        if (!ativos.length) {
            box.innerHTML = '<p class="sub">Nenhuma mensagem de suporte ativa.</p>';
            return;
        }

        const threads = new Map();
        ativos.forEach(m => {
            const tid = m.thread_auth_id || m.de_auth_id || '—';
            if (!threads.has(tid)) threads.set(tid, []);
            threads.get(tid).push(m);
        });
        const list = [];
        threads.forEach((msgs, tid) => {
            msgs.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
            const last = msgs[msgs.length - 1];
            const userMsg = msgs.find(x => x.origem === 'user' && x.de_nome);
            const nome = (userMsg && userMsg.de_nome) || last.de_nome || String(tid).slice(0, 8);
            const pendenteHumano = msgs.some(x => x.origem === 'user' && /falar com humano|aguardando atendimento/i.test(x.texto || ''));
            const unread = msgs.filter(x => x.origem === 'user' && !x.lido_admin).length;
            const ids = msgs.map(m => m.id);
            list.push({ tid, nome, msgs, last, pendenteHumano, unread, ids });
        });
        list.sort((a, b) => {
            if (a.pendenteHumano !== b.pendenteHumano) return a.pendenteHumano ? -1 : 1;
            return new Date(b.last.criado_em) - new Date(a.last.criado_em);
        });

        const toolbar = `<div class="admin-bulk-bar oculto" id="suporte-bulk-bar" data-scope="suporte">
            <span class="admin-bulk-count" data-bulk-count>0 selecionados</span>
            <button type="button" class="btn-sm btn-ghost" data-bulk="marcar-todos">Marcar todos</button>
            <button type="button" class="btn-sm btn-ghost" data-bulk="desmarcar">Limpar</button>
            <button type="button" class="btn-sm btn-ok" data-bulk="atendido">Marcar atendido</button>
            <button type="button" class="btn-sm" data-bulk="arquivar">Salvar / Arquivar</button>
            <button type="button" class="btn-sm btn-danger" data-bulk="apagar">Apagar</button>
        </div>`;

        const sections = list.map((t, i) => {
            const preview = esc((t.last.texto || '').slice(0, 80));
            const when = t.last.criado_em ? new Date(t.last.criado_em).toLocaleString('pt-BR') : '';
            const badgeHumano = t.pendenteHumano ? '<span class="badge badge-atrasado">Humano</span>' : '';
            const badgeUnread = t.unread
                ? `<span class="admin-unread-badge">${t.unread > 99 ? '99+' : t.unread}</span>`
                : '';
            const msgRows = t.msgs.map(m => {
                const cls = m.origem === 'user' ? 'user' : (m.origem === 'admin' ? 'admin' : 'bot');
                const who = m.origem === 'admin' ? (m.de_nome || 'Admin')
                    : (m.origem === 'bot' ? 'Robô' : (m.de_nome || 'User'));
                const mw = m.criado_em ? new Date(m.criado_em).toLocaleString('pt-BR') : '';
                return `<label class="admin-sel-row suporte-sel-msg" data-id="${m.id}">
                    <span class="admin-bolinha">
                        <input type="checkbox" class="admin-sel-cb" data-scope="suporte" value="${m.id}">
                        <span class="bolinha" aria-hidden="true"></span>
                    </span>
                    <span class="admin-sel-body suporte-bubble ${cls}">
                        <span class="suporte-meta">${esc(who)} · ${esc(mw)}</span>
                        <span>${esc(m.texto)}</span>
                    </span>
                </label>`;
            }).join('');

            return `<div class="suporte-thread admin-user-acc" data-tid="${esc(t.tid)}" data-ids="${t.ids.join(',')}">
                <div class="suporte-thread-head-row">
                    <label class="admin-bolinha admin-bolinha-thread" title="Selecionar thread">
                        <input type="checkbox" class="admin-sel-cb admin-sel-thread" data-scope="suporte" data-thread-ids="${t.ids.join(',')}">
                        <span class="bolinha" aria-hidden="true"></span>
                    </label>
                    <button type="button" class="suporte-thread-head admin-user-acc-head" data-act="toggle-thread" data-i="${i}" aria-expanded="false">
                        <span class="admin-acc-chevron">▸</span>
                        <strong>${esc(t.nome)}</strong>
                        ${badgeHumano}${badgeUnread}
                        <span class="sub">${esc(when)} · ${preview}</span>
                    </button>
                </div>
                <div class="suporte-thread-body admin-user-acc-body oculto" id="suporte-thread-${i}">
                    <div class="suporte-msgs admin-suporte-msgs">${msgRows}</div>
                    <form class="suporte-admin-reply" data-tid="${esc(t.tid)}">
                        <input type="text" name="reply" placeholder="Responder como admin…" required maxlength="2000">
                        <button type="submit" class="btn-ok btn-sm">Enviar</button>
                    </form>
                </div>
            </div>`;
        }).join('');

        box.innerHTML = toolbar + '<div class="admin-user-list" id="suporte-user-list">' + sections + '</div>';

        box.querySelectorAll('[data-act="toggle-thread"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = btn.getAttribute('data-i');
                const body = document.getElementById('suporte-thread-' + i);
                if (!body) return;
                const open = body.classList.toggle('oculto') === false;
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                const chev = btn.querySelector('.admin-acc-chevron');
                if (chev) chev.textContent = open ? '▾' : '▸';
            });
        });

        // Thread checkbox → marca todas as msgs da thread
        box.querySelectorAll('.admin-sel-thread').forEach(cb => {
            cb.addEventListener('change', () => {
                const ids = (cb.getAttribute('data-thread-ids') || '').split(',').filter(Boolean);
                ids.forEach(id => {
                    const msgCb = box.querySelector('.admin-sel-cb[data-scope="suporte"][value="' + id + '"]:not(.admin-sel-thread)');
                    if (msgCb) msgCb.checked = cb.checked;
                });
                syncAdminBulkBar(box, 'suporte');
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

        bindAdminBulkSelection(box, {
            scope: 'suporte',
            onApagar: async (ids) => {
                if (!ids.length) return;
                if (!confirm('Apagar (soft-delete) ' + ids.length + ' mensagem(ns) de suporte?')) return;
                const now = new Date().toISOString();
                const { error: err } = await supabaseClient.from('suporte_mensagens')
                    .update({ deleted_at: now })
                    .in('id', ids);
                if (err) return toastMsg('Erro: ' + err.message + ' (SQL 31?)');
                toastMsg(ids.length + ' apagada(s)');
                carregarSuporteAdmin();
            },
            onArquivar: async (ids) => {
                if (!ids.length) return;
                const { error: err } = await supabaseClient.from('suporte_mensagens')
                    .update({ arquivado: true, lido_admin: true })
                    .in('id', ids);
                if (err) return toastMsg('Erro: ' + err.message + ' (SQL 31?)');
                toastMsg(ids.length + ' arquivada(s)');
                carregarSuporteAdmin();
            },
            onAtendido: async (ids) => {
                if (!ids.length) return;
                const now = new Date().toISOString();
                const { error: err } = await supabaseClient.from('suporte_mensagens')
                    .update({ lido_admin: true, atendido_em: now })
                    .in('id', ids);
                if (err) return toastMsg('Erro: ' + err.message + ' (SQL 31?)');
                toastMsg(ids.length + ' marcada(s) como atendida(s)');
                carregarSuporteAdmin();
            }
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 16/31)</p>';
    }
}




/* ===== Banners / Bank flag / Grok / Lotes oculto (SQL 35) ===== */
const GROK_LS_KEY = 'minera_admin_grok_history';

function setPromoMsg(texto, ok) {
    const el = document.getElementById('promo-msg');
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (texto ? (ok ? ' ok' : ' erro') : '');
}
function setBankFlagMsg(texto, ok) {
    const el = document.getElementById('bank-flag-msg');
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (texto ? (ok ? ' ok' : ' erro') : '');
}

function limparFormPromo() {
    const id = document.getElementById('promo-id');
    if (id) id.value = '';
    const tipo = document.getElementById('promo-tipo');
    if (tipo) tipo.value = 'banner';
    ['promo-titulo','promo-texto','promo-imagem','promo-link'].forEach(i => {
        const el = document.getElementById(i);
        if (el) el.value = '';
    });
    const ord = document.getElementById('promo-ordem');
    if (ord) ord.value = '0';
    const at = document.getElementById('promo-ativo');
    if (at) at.checked = true;
}

async function carregarPromosAdmin() {
    const box = document.getElementById('admin-promos');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('app_promos')
            .select('*')
            .order('ordem', { ascending: true });
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhum banner/oferta. Crie acima (tabela app_promos — SQL 35).</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Tipo</th><th>Título</th><th>Ativo</th><th>Ordem</th><th></th></tr></thead><tbody>' +
            data.map(p => `<tr data-id="${esc(p.id)}">
                <td>${esc(p.tipo)}</td>
                <td>${esc(p.titulo || '—')}<br><span class="sub">${esc((p.texto || '').slice(0, 80))}</span></td>
                <td>${p.ativo ? '<span class="badge badge-pago">Sim</span>' : '<span class="badge">Não</span>'}</td>
                <td>${esc(p.ordem)}</td>
                <td class="card-actions">
                    <button type="button" class="btn-sm" data-act="promo-edit" data-id="${esc(p.id)}">Editar</button>
                    <button type="button" class="btn-sm btn-danger" data-act="promo-del" data-id="${esc(p.id)}">Apagar</button>
                </td>
            </tr>`).join('') + '</tbody></table></div>';

        box.querySelectorAll('[data-act="promo-edit"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = data.find(x => x.id === btn.getAttribute('data-id'));
                if (!row) return;
                document.getElementById('promo-id').value = row.id;
                document.getElementById('promo-tipo').value = row.tipo || 'banner';
                document.getElementById('promo-titulo').value = row.titulo || '';
                document.getElementById('promo-texto').value = row.texto || '';
                document.getElementById('promo-imagem').value = row.imagem_url || '';
                document.getElementById('promo-link').value = row.link || '';
                document.getElementById('promo-ordem').value = row.ordem != null ? row.ordem : 0;
                document.getElementById('promo-ativo').checked = !!row.ativo;
                setPromoMsg('Editando…', true);
            });
        });
        box.querySelectorAll('[data-act="promo-del"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Apagar este banner/oferta?')) return;
                const { error } = await supabaseClient.from('app_promos').delete().eq('id', btn.getAttribute('data-id'));
                if (error) return setPromoMsg(error.message + ' (SQL 35?)', false);
                setPromoMsg('Removido.', true);
                carregarPromosAdmin();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' — aplique sql/35-admin-promos-bank-flag.sql</p>';
    }
}




/* Moldura Início = 16:6. Upload letterbox (contain): NUNCA corta; preenche a proporção com fundo da marca. */
const BANNER_SLOT_W = 1600;
const BANNER_SLOT_H = 600; /* 16:6 exato */
const BANNER_PAD_RGB = '#0b1220';

function redimensionarBannerImagem(file) {
    return new Promise((resolve, reject) => {
        if (!file || !(file.type || '').startsWith('image/')) {
            reject(new Error('Selecione uma imagem (image/*).'));
            return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                URL.revokeObjectURL(url);
                const sw = img.naturalWidth || img.width;
                const sh = img.naturalHeight || img.height;
                if (!sw || !sh) throw new Error('Imagem inválida');
                /* contain → escala uniforme pra caber inteira; laterais/topo recebem pad (sem crop) */
                const scale = Math.min(BANNER_SLOT_W / sw, BANNER_SLOT_H / sh);
                const dw = Math.max(1, Math.round(sw * scale));
                const dh = Math.max(1, Math.round(sh * scale));
                const ox = Math.floor((BANNER_SLOT_W - dw) / 2);
                const oy = Math.floor((BANNER_SLOT_H - dh) / 2);
                const canvas = document.createElement('canvas');
                canvas.width = BANNER_SLOT_W;
                canvas.height = BANNER_SLOT_H;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = BANNER_PAD_RGB;
                ctx.fillRect(0, 0, BANNER_SLOT_W, BANNER_SLOT_H);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, sw, sh, ox, oy, dw, dh);
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Falha ao redimensionar'));
                        return;
                    }
                    const base = String(file.name || 'banner').replace(/\.[^.]+$/, '') || 'banner';
                    resolve(new File([blob], base + '-banner.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
                }, 'image/jpeg', 0.92);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Não foi possível ler a imagem'));
        };
        img.src = url;
    });
}

async function uploadPromoImagem(file) {
    if (!file || !(file.type || '').startsWith('image/')) {
        throw new Error('Selecione uma imagem (image/*).');
    }
    let uid = (perfilAtual && perfilAtual.auth_id) || null;
    if (!uid) {
        try {
            const { data: u } = await supabaseClient.auth.getUser();
            uid = u && u.user && u.user.id;
        } catch (_) { /* ignore */ }
    }
    if (!uid) throw new Error('Faça login de admin para enviar imagem.');
    /* Redimensiona automaticamente p/ encaixe na moldura (sem cortar) (slot Início) */
    const resized = await redimensionarBannerImagem(file);
    const path = uid + '/banners/' + Date.now() + '_banner.jpg';
    const { data, error } = await supabaseClient.storage
        .from('chat-midia')
        .upload(path, resized, {
            upsert: false,
            contentType: 'image/jpeg',
            cacheControl: '3600'
        });
    if (error) throw error;
    const { data: pub } = supabaseClient.storage.from('chat-midia').getPublicUrl((data && data.path) || path);
    if (!pub || !pub.publicUrl) throw new Error('URL pública indisponível');
    return pub.publicUrl;
}

function bindPromoForm() {
    const form = document.getElementById('form-promo');
    if (!form || form._bound) return;
    form._bound = true;
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const id = (document.getElementById('promo-id') || {}).value || '';
        const payload = {
            tipo: document.getElementById('promo-tipo').value || 'banner',
            titulo: document.getElementById('promo-titulo').value.trim() || null,
            texto: document.getElementById('promo-texto').value.trim() || null,
            imagem_url: document.getElementById('promo-imagem').value.trim() || null,
            link: document.getElementById('promo-link').value.trim() || null,
            ordem: parseInt(document.getElementById('promo-ordem').value, 10) || 0,
            ativo: !!(document.getElementById('promo-ativo') || {}).checked,
            updated_at: new Date().toISOString(),
            updated_by: (perfilAtual && perfilAtual.auth_id) || null
        };
        try {
            let error;
            if (id) {
                ({ error } = await supabaseClient.from('app_promos').update(payload).eq('id', id));
            } else {
                ({ error } = await supabaseClient.from('app_promos').insert([payload]));
            }
            if (error) throw error;
            setPromoMsg('Salvo.', true);
            limparFormPromo();
            carregarPromosAdmin();
        } catch (e) {
            setPromoMsg((e.message || String(e)) + ' (SQL 35 / is_admin?)', false);
        }
    });
    const limpar = document.getElementById('btn-promo-limpar');
    if (limpar) limpar.addEventListener('click', () => {
        limparFormPromo();
        const f = document.getElementById('promo-imagem-file');
        if (f) f.value = '';
        const st = document.getElementById('promo-upload-status');
        if (st) st.textContent = '';
        setPromoMsg('', true);
    });
    const fileIn = document.getElementById('promo-imagem-file');
    if (fileIn && !fileIn._bound) {
        fileIn._bound = true;
        fileIn.addEventListener('change', async () => {
            const file = (fileIn.files && fileIn.files[0]) || null;
            const st = document.getElementById('promo-upload-status');
            if (!file) return;
            if (st) st.textContent = 'Redimensionando e enviando…';
            try {
                const url = await uploadPromoImagem(file);
                const inp = document.getElementById('promo-imagem');
                if (inp) inp.value = url;
                if (st) st.textContent = 'Imagem redimensionada (encaixe na moldura (sem cortar)) e enviada. Clique Salvar.';
                setPromoMsg('Imagem pronta. Salve o banner.', true);
            } catch (e) {
                if (st) st.textContent = '';
                setPromoMsg((e && e.message) || String(e), false);
            } finally {
                fileIn.value = '';
            }
        });
    }
}


function setShareFlagsMsg(t, ok) {
    const el = document.getElementById('share-flags-msg');
    if (!el) return;
    el.textContent = t || '';
    el.className = 'msg' + (ok === false ? ' erro' : (ok ? ' ok' : ''));
}

async function carregarShareFlagsAdmin() {
    const frase = document.getElementById('share-frase-padrao');
    const url = document.getElementById('share-og-image-url');
    if (!frase && !url) return;
    const defFrase = (typeof SHARE_FRASE_PADRAO_DEFAULT === 'string' && SHARE_FRASE_PADRAO_DEFAULT)
        || 'Cadastre-se no Minera Pará para negociar com mais segurança — cada um vê só a própria conta. Sem misturar perfis: o que é seu fica na sua área.';
    const defUrl = (typeof SHARE_OG_IMAGE_DEFAULT === 'string' && SHARE_OG_IMAGE_DEFAULT)
        || 'https://facilveiculos2015-byte.github.io/minera-app/og-familia.png?v=20260923ae';
    try {
        const { data, error } = await supabaseClient
            .from('app_flags')
            .select('key,value_text')
            .in('key', ['share_frase_padrao', 'share_og_image_url']);
        if (error) throw error;
        const map = {};
        (data || []).forEach(r => { map[r.key] = r; });
        if (frase) frase.value = (map.share_frase_padrao && map.share_frase_padrao.value_text) || defFrase;
        if (url) url.value = (map.share_og_image_url && map.share_og_image_url.value_text) || defUrl;
    } catch (e) {
        if (frase && !frase.value) frase.value = defFrase;
        if (url && !url.value) url.value = defUrl;
        setShareFlagsMsg((e.message || String(e)) + ' — usando padrão local (SQL 35?)', false);
    }
}

function bindShareFlagsAdmin() {
    const btn = document.getElementById('btn-salvar-share-flags');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', async () => {
        const frase = ((document.getElementById('share-frase-padrao') || {}).value || '').trim();
        const imageUrl = ((document.getElementById('share-og-image-url') || {}).value || '').trim();
        const uid = (perfilAtual && perfilAtual.auth_id) || null;
        const now = new Date().toISOString();
        try {
            const ups = [
                { key: 'share_frase_padrao', value_bool: null, value_text: frase || null, updated_by: uid, updated_at: now },
                { key: 'share_og_image_url', value_bool: null, value_text: imageUrl || null, updated_by: uid, updated_at: now }
            ];
            const { error } = await supabaseClient.from('app_flags').upsert(ups, { onConflict: 'key' });
            if (error) throw error;
            setShareFlagsMsg('Share flags salvas.', true);
        } catch (e) {
            setShareFlagsMsg((e.message || String(e)) + ' (SQL 35 app_flags?)', false);
        }
    });
}

async function carregarBankFlagAdmin() {
    const chk = document.getElementById('flag-bank-enabled');
    const motivo = document.getElementById('flag-bank-motivo');
    const logs = document.getElementById('admin-bank-logs');
    try {
        const { data, error } = await supabaseClient.from('app_flags').select('key,value_bool,value_text').in('key', ['minera_bank_enabled', 'minera_bank_block_motivo']);
        if (error) throw error;
        const map = {};
        (data || []).forEach(r => { map[r.key] = r; });
        if (chk) chk.checked = map.minera_bank_enabled ? map.minera_bank_enabled.value_bool !== false : true;
        if (motivo) motivo.value = (map.minera_bank_block_motivo && map.minera_bank_block_motivo.value_text) || '';
    } catch (e) {
        setBankFlagMsg((e.message || String(e)) + ' — SQL 35?', false);
    }
    if (logs) {
        try {
            const { data, error } = await supabaseClient
                .from('app_bank_block_logs')
                .select('enabled,motivo,created_at')
                .order('created_at', { ascending: false })
                .limit(8);
            if (error) throw error;
            if (!data || !data.length) logs.innerHTML = '<p class="sub">Sem logs ainda.</p>';
            else logs.innerHTML = '<ul class="admin-log-list">' + data.map(l =>
                `<li>${l.enabled ? 'ON' : 'OFF'} · ${esc(l.motivo || '—')} · <span class="sub">${esc(l.created_at || '')}</span></li>`
            ).join('') + '</ul>';
        } catch (e) {
            logs.innerHTML = '<p class="sub">Logs indisponíveis (SQL 35).</p>';
        }
    }
}

function bindBankFlagAdmin() {
    const btn = document.getElementById('btn-salvar-bank-flag');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', async () => {
        const enabled = !!(document.getElementById('flag-bank-enabled') || {}).checked;
        const motivo = ((document.getElementById('flag-bank-motivo') || {}).value || '').trim();
        const uid = (perfilAtual && perfilAtual.auth_id) || null;
        const now = new Date().toISOString();
        try {
            const ups = [
                { key: 'minera_bank_enabled', value_bool: enabled, value_text: null, updated_by: uid, updated_at: now },
                { key: 'minera_bank_block_motivo', value_bool: null, value_text: motivo || null, updated_by: uid, updated_at: now }
            ];
            const { error } = await supabaseClient.from('app_flags').upsert(ups, { onConflict: 'key' });
            if (error) throw error;
            const { error: e2 } = await supabaseClient.from('app_bank_block_logs').insert([{
                enabled,
                motivo: motivo || null,
                by_auth_id: uid
            }]);
            if (e2) console.warn('bank log', e2);
            setBankFlagMsg(enabled ? 'Minera Bank liberado.' : 'Minera Bank pausado para usuários.', true);
            carregarBankFlagAdmin();
        } catch (e) {
            setBankFlagMsg((e.message || String(e)) + ' (SQL 35?)', false);
        }
    });
}

async function carregarLotesOcultoAdmin() {
    const box = document.getElementById('admin-lotes-oculto');
    if (!box) return;
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('id, codigo_lote, tipo_minerio, status, oculto, criado_por')
            .order('id', { ascending: false })
            .limit(40);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhum lote.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Código</th><th>Tipo</th><th>Status</th><th>Oculto</th><th></th></tr></thead><tbody>' +
            data.map(l => {
                const oc = !!(l.oculto === true || l.oculto === 't' || l.oculto === 'true');
                const btn = oc
                    ? '<button type="button" class="btn-sm btn-ok" data-act="lote-show" data-id="' + l.id + '">Mostrar</button>'
                    : '<button type="button" class="btn-sm btn-danger" data-act="lote-hide" data-id="' + l.id + '">Ocultar</button>';
                return `<tr>
                    <td>${esc(l.codigo_lote)}</td>
                    <td>${esc(l.tipo_minerio || '—')}</td>
                    <td>${esc(l.status || '—')}</td>
                    <td>${oc ? 'Sim' : 'Não'}</td>
                    <td class="card-actions">${btn}</td>
                </tr>`;
            }).join('') + '</tbody></table></div>';
        box.querySelectorAll('[data-act="lote-hide"],[data-act="lote-show"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                const hide = btn.getAttribute('data-act') === 'lote-hide';
                const { error } = await supabaseClient.from('lotes').update({ oculto: hide }).eq('id', id);
                if (error) return toastMsg('Erro: ' + error.message + ' (SQL 35 oculto?)');
                toastMsg(hide ? 'Lote oculto no marketplace' : 'Lote visível no marketplace');
                carregarLotesOcultoAdmin();
            });
        });
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' — coluna oculto? Aplique SQL 35.</p>';
    }
}

function loadGrokHistory() {
    try {
        const raw = localStorage.getItem(GROK_LS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}
function saveGrokHistory(arr) {
    try { localStorage.setItem(GROK_LS_KEY, JSON.stringify(arr.slice(-40))); } catch (e) { /* ignore */ }
}
function renderGrokHistory() {
    const box = document.getElementById('grok-history');
    if (!box) return;
    const arr = loadGrokHistory();
    if (!arr.length) {
        box.innerHTML = '<p class="sub">Sem notas nesta sessão do navegador.</p>';
        return;
    }
    box.innerHTML = arr.slice().reverse().map(it =>
        `<div class="grok-hist-item"><span class="sub">${esc(it.ts || '')}</span><pre>${esc(it.text || '')}</pre></div>`
    ).join('');
}
function buildGrokSystemContext() {
    const bankChk = document.getElementById('flag-bank-enabled');
    const bankOn = bankChk ? !!bankChk.checked : true;
    const email = (perfilAtual && perfilAtual.email) || '';
    const screen = (location.hash || '#visao').replace('#', '') || 'visao';
    return [
        'Contexto Minera Pará (admin)',
        'App: Minera Pará',
        'Tela admin atual: ' + screen,
        'Minera Bank flag: ' + (bankOn ? 'ON' : 'OFF'),
        'Admin e-mail: ' + email,
        'Instrução do admin:',
        ((document.getElementById('grok-input') || {}).value || '').trim() || '(vazio)'
    ].join('\n');
}
function bindGrokDrawer() {
    const openBtn = document.getElementById('btn-chamar-grok');
    const drawer = document.getElementById('grok-drawer');
    const closeBtn = document.getElementById('btn-grok-fechar');
    const copyBtn = document.getElementById('btn-grok-copy-ctx');
    const saveBtn = document.getElementById('btn-grok-salvar');
    const msg = document.getElementById('grok-msg');
    if (!openBtn || !drawer) return;
    if (openBtn._bound) return;
    openBtn._bound = true;
    const setMsg = (t, ok) => {
        if (!msg) return;
        msg.textContent = t || '';
        msg.className = 'msg' + (t ? (ok ? ' ok' : ' erro') : '');
    };
    openBtn.addEventListener('click', () => {
        drawer.classList.remove('oculto');
        renderGrokHistory();
    });
    if (closeBtn) closeBtn.addEventListener('click', () => drawer.classList.add('oculto'));
    drawer.addEventListener('click', (e) => {
        if (e.target === drawer) drawer.classList.add('oculto');
    });
    if (copyBtn) copyBtn.addEventListener('click', async () => {
        const ctx = buildGrokSystemContext();
        try {
            if (navigator.clipboard) await navigator.clipboard.writeText(ctx);
            else {
                const ta = document.createElement('textarea');
                ta.value = ctx; document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); ta.remove();
            }
            setMsg('Contexto copiado. Cole no Grok Bot e traga a resposta para o campo de notas.', true);
        } catch (e) {
            setMsg('Não foi possível copiar.', false);
        }
    });
    if (saveBtn) saveBtn.addEventListener('click', () => {
        const text = ((document.getElementById('grok-input') || {}).value || '').trim();
        if (!text) return setMsg('Escreva algo para salvar.', false);
        const arr = loadGrokHistory();
        arr.push({ ts: new Date().toLocaleString('pt-BR'), text });
        saveGrokHistory(arr);
        setMsg('Salvo no histórico local da sessão admin.', true);
        renderGrokHistory();
    });
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
    bindPromoForm();
    bindBankFlagAdmin();
    bindShareFlagsAdmin();
    bindGrokDrawer();
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
        carregarAlertasAdmin(),
        carregarPromosAdmin(),
        carregarBankFlagAdmin(),
        carregarShareFlagsAdmin(),
        carregarLotesOcultoAdmin()
    ]);
    setInterval(() => {
        try { carregarEmprestimosAdmin(); } catch (e) { /* ignore */ }
        try { carregarAlertasAdmin(); } catch (e) { /* ignore */ }
    }, 45000);
})();
