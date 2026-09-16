let perfilAtual = null;
let pollTimer = null;
let contactsPollTimer = null;
let meuAuthId = null;
let loteCtx = null;
let anexoPendente = null;
let gravando = false;
let mediaRecorder = null;
let audioChunks = [];
let agendarAtivo = false;

/** Contato ativo: { auth_id, nome, email, papeis, tipo, apelido } */
let contatoAtivo = null;
let contatosCache = []; // enriched list
let diretorioCache = [];
let lastThreadMsgIds = new Set();

const ROLE_GROUPS = [
    { id: 'minerador', title: 'Mineradores/Vendedores', match: ['minerador'] },
    { id: 'comprador', title: 'Compradores', match: ['comprador'] },
    { id: 'transportador', title: 'Transportadores', match: ['transportador', 'transportador_mina_britador', 'transportador_britador_porto'] },
    { id: 'carregamento', title: 'Carregadores', match: ['carregamento'] },
    { id: 'dono_britador', title: 'Donos de Britador', match: ['dono_britador'] },
    { id: 'outros', title: 'Outros', match: null }
];

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lerLoteQuery() {
    try {
        const u = new URL(window.location.href);
        return (u.searchParams.get('lote') || '').trim();
    } catch (e) { return ''; }
}

function lerParaQuery() {
    try {
        const u = new URL(window.location.href);
        return (u.searchParams.get('para') || u.searchParams.get('dm') || '').trim();
    } catch (e) { return ''; }
}

function setAnexoInfo(txt) {
    const el = document.getElementById('chat-anexo-info');
    if (!el) return;
    if (!txt) {
        el.classList.add('oculto');
        el.textContent = '';
        return;
    }
    el.textContent = txt;
    el.classList.remove('oculto');
}

function lsKeyLeituras() {
    return 'minera_chat_leituras_' + (meuAuthId || 'anon');
}

function lerLeiturasLocal() {
    try {
        return JSON.parse(localStorage.getItem(lsKeyLeituras()) || '{}') || {};
    } catch (e) { return {}; }
}

function salvarLeituraLocal(comAuthId, msgId) {
    if (!comAuthId || !msgId) return;
    const map = lerLeiturasLocal();
    const prev = Number(map[comAuthId] || 0);
    if (Number(msgId) > prev) {
        map[comAuthId] = Number(msgId);
        try { localStorage.setItem(lsKeyLeituras(), JSON.stringify(map)); } catch (e) { /* ignore */ }
    }
}

function getLeituraLocal(comAuthId) {
    return Number(lerLeiturasLocal()[comAuthId] || 0);
}

async function marcarLido(comAuthId, ultimaId) {
    if (!comAuthId || !ultimaId) return;
    salvarLeituraLocal(comAuthId, ultimaId);
    try {
        await supabaseClient.from('chat_leituras').upsert([{
            auth_id: meuAuthId,
            com_auth_id: comAuthId,
            ultima_lida_id: ultimaId,
            lido_em: new Date().toISOString()
        }], { onConflict: 'auth_id,com_auth_id' });
    } catch (e) {
        console.warn('chat_leituras', e);
    }
}

function rotuloGrupoPapel(papeis, tipo) {
    const arr = (Array.isArray(papeis) ? papeis : [])
        .map(p => String(p).toLowerCase());
    if (!arr.length && tipo) arr.push(String(tipo).toLowerCase());
    for (const g of ROLE_GROUPS) {
        if (!g.match) continue;
        if (g.match.some(m => arr.includes(m))) return g.id;
    }
    return 'outros';
}

function labelPapelCurto(papeis, tipo) {
    const labels = {
        minerador: 'Minerador',
        comprador: 'Comprador',
        transportador: 'Transportador',
        transportador_mina_britador: 'Transportador (Mina–Britador)',
        transportador_britador_porto: 'Transportador (Britador–Porto)',
        dono_britador: 'Dono de Britador',
        carregamento: 'Carregador',
        admin: 'Admin'
    };
    const arr = (Array.isArray(papeis) ? papeis : []).map(p => String(p).toLowerCase());
    if (!arr.length && tipo) return labels[String(tipo).toLowerCase()] || tipo;
    return arr.map(p => labels[p] || p).join(', ') || 'Outros';
}

async function uploadMidia(file, pasta) {
    if (!file) return null;
    const path = (pasta || 'geral') + '/' + Date.now() + '_' + (file.name || 'arquivo').replace(/[^\w.\-]/g, '_');
    try {
        const { data, error } = await supabaseClient.storage
            .from('chat-midia')
            .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (!error && data) {
            const { data: pub } = supabaseClient.storage.from('chat-midia').getPublicUrl(data.path || path);
            if (pub && pub.publicUrl) return pub.publicUrl;
        }
        console.warn('Storage upload falhou:', error && error.message);
    } catch (e) {
        console.warn('Storage indisponível:', e);
    }
    if (file.type && file.type.startsWith('image/') && file.size <= 400000) {
        return await fileToDataUrl(file);
    }
    return null;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

async function promoverAgendadas(lista) {
    const agora = Date.now();
    const pend = (lista || []).filter(m =>
        (m.status || '') === 'agendada' &&
        m.agendado_para &&
        new Date(m.agendado_para).getTime() <= agora &&
        !m.deleted_at
    );
    for (const m of pend) {
        try {
            await supabaseClient.from('chat_mensagens')
                .update({ status: 'enviada' })
                .eq('id', m.id);
            m.status = 'enviada';
        } catch (e) {
            console.warn('promover agendada', e);
        }
    }
}

function renderMedia(m) {
    const url = m.midia_url;
    if (!url) return '';
    const tipo = (m.tipo || 'text').toLowerCase();
    if (tipo === 'imagem' || url.startsWith('data:image')) {
        return '<div class="bubble-media"><img src="' + esc(url) + '" alt="imagem" loading="lazy"></div>';
    }
    if (tipo === 'video') {
        return '<div class="bubble-media"><video src="' + esc(url) + '" controls playsinline></video></div>';
    }
    if (tipo === 'audio') {
        return '<div class="bubble-media"><audio src="' + esc(url) + '" controls></audio></div>';
    }
    return '<div class="bubble-media"><a href="' + esc(url) + '" target="_blank" rel="noopener">Abrir mídia</a></div>';
}

async function rpcDiretorio(busca) {
    try {
        const { data, error } = await supabaseClient.rpc('chat_diretorio', { p_busca: busca || null });
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.warn('chat_diretorio', e);
        return [];
    }
}

async function rpcPerfis(ids) {
    if (!ids || !ids.length) return [];
    try {
        const { data, error } = await supabaseClient.rpc('chat_perfis_publicos', { p_ids: ids });
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.warn('chat_perfis_publicos', e);
        return [];
    }
}

async function rpcBuscarEmail(email) {
    try {
        const { data, error } = await supabaseClient.rpc('chat_buscar_email', { p_email: email });
        if (error) throw error;
        return (data && data[0]) || null;
    } catch (e) {
        console.warn('chat_buscar_email', e);
        return null;
    }
}

async function carregarContatos() {
    const box = document.getElementById('chat-contatos-list');
    const busca = ((document.getElementById('chat-busca-contatos') || {}).value || '').trim().toLowerCase();
    try {
        const { data: rowsRaw, error } = await supabaseClient
            .from('chat_contatos')
            .select('*')
            .eq('auth_id', meuAuthId)
            .order('criado_em', { ascending: false });
        if (error) throw error;
        const rows = (rowsRaw || []).slice();

        const ids = rows.map(r => r.contato_auth_id).filter(Boolean);
        const perfis = await rpcPerfis(ids);
        const byId = {};
        perfis.forEach(p => { byId[p.auth_id] = p; });

        // Previews: last message per contact (participant filter via RLS)
        const { data: msgs } = await supabaseClient
            .from('chat_mensagens')
            .select('id,de_auth_id,para_auth_id,texto,tipo,criado_em,status,deleted_at')
            .or('de_auth_id.eq.' + meuAuthId + ',para_auth_id.eq.' + meuAuthId)
            .is('deleted_at', null)
            .order('criado_em', { ascending: false })
            .limit(400);

        const lastByPeer = {};
        (msgs || []).forEach(m => {
            if ((m.status || '') === 'agendada' && m.de_auth_id === meuAuthId) {
                // still show as preview for me
            }
            const peer = m.de_auth_id === meuAuthId ? m.para_auth_id : m.de_auth_id;
            if (!peer || lastByPeer[peer]) return;
            lastByPeer[peer] = m;
        });

        // Auto-include peers we messaged but haven't saved as contact
        const known = new Set(ids);
        Object.keys(lastByPeer).forEach(peer => {
            if (!known.has(peer)) {
                rows.push({
                    auth_id: meuAuthId,
                    contato_auth_id: peer,
                    apelido: null,
                    criado_em: lastByPeer[peer].criado_em,
                    _virtual: true
                });
                known.add(peer);
            }
        });
        const missing = Object.keys(lastByPeer).filter(p => !byId[p]);
        if (missing.length) {
            const extra = await rpcPerfis(missing);
            extra.forEach(p => { byId[p.auth_id] = p; });
        }

        contatosCache = (rows || []).map(r => {
            const p = byId[r.contato_auth_id] || {};
            const last = lastByPeer[r.contato_auth_id];
            const nome = r.apelido || p.nome || (last && last.de_auth_id !== meuAuthId ? last.de_nome : null) || 'Contato';
            return {
                auth_id: r.contato_auth_id,
                nome,
                email: p.email || '',
                papeis: p.papeis || [],
                tipo: p.tipo || '',
                apelido: r.apelido || null,
                last,
                unread: last && last.para_auth_id === meuAuthId && last.de_auth_id === r.contato_auth_id
                    ? (Number(last.id) > getLeituraLocal(r.contato_auth_id) ? 1 : 0)
                    : 0
            };
        });

        // Sort by last message time
        contatosCache.sort((a, b) => {
            const ta = a.last && a.last.criado_em ? new Date(a.last.criado_em).getTime() : 0;
            const tb = b.last && b.last.criado_em ? new Date(b.last.criado_em).getTime() : 0;
            return tb - ta;
        });

        const filtered = contatosCache.filter(c => {
            if (!busca) return true;
            return (c.nome || '').toLowerCase().includes(busca) ||
                (c.email || '').toLowerCase().includes(busca) ||
                labelPapelCurto(c.papeis, c.tipo).toLowerCase().includes(busca);
        });

        if (!filtered.length) {
            box.innerHTML = '<div class="chat-contacts-empty">' +
                '<p><strong>Nenhuma conversa ainda</strong></p>' +
                '<p class="sub">Toque em <strong>＋ Adicionar contato</strong> para achar mineradores, compradores, transportadores…</p>' +
                '</div>';
            return;
        }

        const grouped = {};
        ROLE_GROUPS.forEach(g => { grouped[g.id] = []; });
        filtered.forEach(c => {
            const gid = rotuloGrupoPapel(c.papeis, c.tipo);
            (grouped[gid] || grouped.outros).push(c);
        });

        let html = '';
        ROLE_GROUPS.forEach(g => {
            const list = grouped[g.id] || [];
            if (!list.length) return;
            html += '<div class="chat-group"><div class="chat-group-title">' + esc(g.title) + '</div>';
            list.forEach(c => {
                const preview = c.last
                    ? ((c.last.de_auth_id === meuAuthId ? 'Você: ' : '') +
                        (c.last.texto || (c.last.tipo && c.last.tipo !== 'text' ? '[' + c.last.tipo + ']' : ''))).slice(0, 48)
                    : 'Sem mensagens';
                const on = contatoAtivo && contatoAtivo.auth_id === c.auth_id ? ' on' : '';
                const badge = c.unread ? '<span class="contact-unread">' + c.unread + '</span>' : '';
                html += '<button type="button" class="chat-contact-item' + on + '" data-auth="' + esc(c.auth_id) + '">' +
                    '<div class="contact-avatar">' + esc((c.nome || '?').slice(0, 1).toUpperCase()) + '</div>' +
                    '<div class="contact-body">' +
                    '<div class="contact-name">' + esc(c.nome) + badge + '</div>' +
                    '<div class="contact-preview">' + esc(preview) + '</div>' +
                    '<div class="contact-role">' + esc(labelPapelCurto(c.papeis, c.tipo)) + '</div>' +
                    '</div></button>';
            });
            html += '</div>';
        });
        box.innerHTML = html;
        box.querySelectorAll('.chat-contact-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-auth');
                const c = contatosCache.find(x => x.auth_id === id);
                if (c) abrirThread(c);
            });
        });
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Contatos indisponíveis: ' + esc(err.message) +
            '. Rode o SQL 18-chat-contatos-dms.sql no Supabase.</p>';
    }
}

function showThreadUI(show) {
    const empty = document.getElementById('chat-thread-empty');
    const active = document.getElementById('chat-thread-active');
    const pane = document.getElementById('chat-wa');
    if (empty) empty.classList.toggle('oculto', show);
    if (active) active.classList.toggle('oculto', !show);
    if (pane) pane.classList.toggle('thread-open', !!show);
}

async function abrirThread(contato) {
    contatoAtivo = contato;
    showThreadUI(true);
    document.getElementById('chat-com-nome').textContent = contato.nome || 'Contato';
    document.getElementById('chat-com-papel').textContent = labelPapelCurto(contato.papeis, contato.tipo);
    lastThreadMsgIds = new Set();
    await carregarThread();
    await carregarContatos();
    // Ensure saved in chat_contatos
    try {
        await supabaseClient.from('chat_contatos').upsert([{
            auth_id: meuAuthId,
            contato_auth_id: contato.auth_id,
            apelido: contato.apelido || contato.nome || null
        }], { onConflict: 'auth_id,contato_auth_id' });
    } catch (e) { /* table may not exist yet */ }
}

async function carregarThread() {
    const box = document.getElementById('chat-msgs');
    if (!contatoAtivo || !contatoAtivo.auth_id) {
        showThreadUI(false);
        return;
    }
    const them = contatoAtivo.auth_id;
    try {
        // Fetch both directions — filter client-side for exact DM pair
        const { data, error } = await supabaseClient
            .from('chat_mensagens')
            .select('*')
            .or('de_auth_id.eq.' + meuAuthId + ',para_auth_id.eq.' + meuAuthId)
            .order('criado_em', { ascending: true })
            .limit(400);
        if (error) throw error;

        let lista = (data || []).filter(m =>
            !m.deleted_at &&
            (m.moderacao || '') !== 'removida' &&
            ((m.de_auth_id === meuAuthId && m.para_auth_id === them) ||
             (m.de_auth_id === them && m.para_auth_id === meuAuthId)) &&
            // Destinatário não vê agendada até promover
            !((m.status || '') === 'agendada' && m.de_auth_id !== meuAuthId)
        );
        await promoverAgendadas(lista);

        // Detect new incoming for toast (within this thread poll)
        const incoming = lista.filter(m =>
            m.para_auth_id === meuAuthId &&
            m.de_auth_id === them &&
            !lastThreadMsgIds.has(m.id) &&
            lastThreadMsgIds.size > 0
        );
        lista.forEach(m => lastThreadMsgIds.add(m.id));

        if (!lista.length) {
            box.innerHTML = '<p class="sub">Nenhuma mensagem ainda. Diga oi!</p>';
        } else {
            const isAdmin = typeof ehAdmin === 'function' && ehAdmin(perfilAtual);
            box.innerHTML = lista.map(m => {
                const mine = m.de_auth_id && m.de_auth_id === meuAuthId;
                const when = m.criado_em ? new Date(m.criado_em).toLocaleString('pt-BR') : '';
                const st = (m.status || 'enviada');
                const sched = st === 'agendada';
                const agLabel = sched && m.agendado_para
                    ? ' · agendada p/ ' + new Date(m.agendado_para).toLocaleString('pt-BR')
                    : '';
                const flag = m.moderacao ? ' · 🚩 ' + esc(m.moderacao) : '';
                return `<div class="bubble ${mine ? 'mine' : 'theirs'}${sched ? ' scheduled' : ''}">
                    <div class="bubble-meta">${esc(m.de_nome || 'Alguém')} · ${when}${agLabel}${flag}</div>
                    ${m.texto ? '<div class="bubble-text">' + esc((typeof AntiGolpe !== 'undefined' ? AntiGolpe.mascarar(m.texto) : m.texto)) + '</div>' : ''}
                    ${renderMedia(m)}
                    <div class="bubble-status">${esc(st)}${isAdmin && m.id ? ' · #' + m.id : ''}</div>
                </div>`;
            }).join('');
            box.scrollTop = box.scrollHeight;

            const maxIn = lista.filter(m => m.para_auth_id === meuAuthId).reduce((mx, m) => Math.max(mx, Number(m.id) || 0), 0);
            if (maxIn) await marcarLido(them, maxIn);
        }

        incoming.forEach(m => {
            if (typeof toastMsg === 'function') {
                toastMsg('Nova mensagem de ' + (m.de_nome || contatoAtivo.nome || 'alguém'));
            }
        });
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Chat indisponível: ' + esc(err.message) +
            '. Rode o SQL 18-chat-contatos-dms.sql no Supabase.</p>';
    }
}

async function enviarMensagem(opts) {
    opts = opts || {};
    const msgEl = document.getElementById('chat-msg');
    const input = document.getElementById('chat-texto');
    if (!contatoAtivo || !contatoAtivo.auth_id) {
        msgEl.textContent = 'Selecione um contato primeiro.';
        msgEl.className = 'msg erro';
        return;
    }
    let texto = (opts.texto != null ? opts.texto : input.value).trim();
    const urlManual = (document.getElementById('chat-url-midia').value || '').trim();
    let tipo = opts.tipo || 'text';
    let midia_url = opts.midia_url || null;

    if (anexoPendente) {
        tipo = anexoPendente.tipo;
        midia_url = anexoPendente.midia_url;
    } else if (urlManual) {
        midia_url = urlManual;
        if (tipo === 'text') {
            if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(urlManual) || urlManual.startsWith('data:image')) tipo = 'imagem';
            else if (/\.(mp4|webm|mov)(\?|$)/i.test(urlManual)) tipo = 'video';
            else if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(urlManual)) tipo = 'audio';
            else tipo = 'imagem';
        }
    }

    if (loteCtx && texto && !texto.includes(loteCtx)) {
        texto = '[Lote ' + loteCtx + '] ' + texto;
    }

    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Chat')) {
        msgEl.textContent = 'Conta bloqueada — pague a comissão no Perfil.';
        msgEl.className = 'msg erro';
        return;
    }

    if (typeof AntiGolpe !== 'undefined') {
        const chk = AntiGolpe.validarTexto(texto);
        if (!chk.ok) {
            msgEl.textContent = chk.motivo;
            msgEl.className = 'msg erro';
            if (typeof toastMsg === 'function') toastMsg(chk.motivo);
            return;
        }
        if (urlManual && !urlManual.startsWith('data:')) {
            if (/wa\.me|t\.me|instagram|whatsapp|@|tel:/i.test(urlManual) || /@/.test(urlManual)) {
                msgEl.textContent = AntiGolpe.MSG_BLOQUEIO;
                msgEl.className = 'msg erro';
                toastMsg(AntiGolpe.MSG_BLOQUEIO);
                return;
            }
        }
    }

    if (!texto && !midia_url) {
        msgEl.textContent = 'Escreva algo ou anexe mídia.';
        msgEl.className = 'msg erro';
        return;
    }

    let status = 'enviada';
    let agendado_para = null;
    if (agendarAtivo) {
        const dt = document.getElementById('chat-agendar-em').value;
        if (!dt) {
            msgEl.textContent = 'Escolha data/hora para agendar.';
            msgEl.className = 'msg erro';
            return;
        }
        agendado_para = new Date(dt).toISOString();
        if (new Date(agendado_para).getTime() <= Date.now()) {
            status = 'enviada';
            agendado_para = null;
        } else {
            status = 'agendada';
            tipo = tipo === 'text' ? 'agendada' : tipo;
        }
    }

    const row = {
        de_auth_id: meuAuthId,
        de_nome: (perfilAtual && perfilAtual.nome) || 'Usuário',
        texto: texto || '',
        tipo,
        midia_url,
        para_auth_id: contatoAtivo.auth_id,
        status,
        agendado_para
    };

    const { error } = await supabaseClient.from('chat_mensagens').insert([row]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message + (/policy|RLS|row-level/i.test(error.message || '') ? ' (rode SQL 18)' : '');
        msgEl.className = 'msg erro';
        return;
    }

    msgEl.textContent = status === 'agendada' ? 'Mensagem agendada!' : '';
    msgEl.className = status === 'agendada' ? 'msg ok' : 'msg';
    input.value = '';
    document.getElementById('chat-url-midia').value = '';
    anexoPendente = null;
    setAnexoInfo('');
    await carregarThread();
    await carregarContatos();
}

/* ---- Adicionar contato modal ---- */
function abrirModalAdd() {
    const m = document.getElementById('modal-add-contato');
    if (m) m.classList.remove('oculto');
    renderRoleFilters();
    carregarDiretorioAdd('');
}

function fecharModalAdd() {
    const m = document.getElementById('modal-add-contato');
    if (m) m.classList.add('oculto');
}

function renderRoleFilters() {
    const el = document.getElementById('add-role-filters');
    if (!el) return;
    el.innerHTML = '<button type="button" class="chip on" data-role="">Todos</button>' +
        ROLE_GROUPS.filter(g => g.id !== 'outros').map(g =>
            '<button type="button" class="chip" data-role="' + g.id + '">' + esc(g.title.split('/')[0]) + '</button>'
        ).join('');
    el.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
            el.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
            btn.classList.add('on');
            renderDiretorioList(diretorioCache, btn.getAttribute('data-role') || '');
        });
    });
}

async function carregarDiretorioAdd(busca) {
    const box = document.getElementById('add-diretorio');
    box.innerHTML = '<p class="sub">Carregando...</p>';
    diretorioCache = await rpcDiretorio(busca);
    const roleBtn = document.querySelector('#add-role-filters .chip.on');
    const role = roleBtn ? (roleBtn.getAttribute('data-role') || '') : '';
    renderDiretorioList(diretorioCache, role);
}

function renderDiretorioList(lista, roleFilter) {
    const box = document.getElementById('add-diretorio');
    const ja = new Set(contatosCache.map(c => c.auth_id));
    let items = lista || [];
    if (roleFilter) {
        const g = ROLE_GROUPS.find(x => x.id === roleFilter);
        if (g && g.match) {
            items = items.filter(u => {
                const papeis = (u.papeis || []).map(p => String(p).toLowerCase());
                return g.match.some(m => papeis.includes(m) || String(u.tipo || '').toLowerCase() === m);
            });
        }
    }
    if (!items.length) {
        box.innerHTML = '<p class="sub">Nenhum usuário encontrado. Tente e-mail exato abaixo.</p>';
        return;
    }
    box.innerHTML = items.map(u => {
        const done = ja.has(u.auth_id);
        return '<div class="chat-dir-item">' +
            '<div><strong>' + esc(u.nome || u.email) + '</strong>' +
            '<div class="contact-role">' + esc(labelPapelCurto(u.papeis, u.tipo)) + '</div>' +
            '<div class="hint">' + esc(u.email || '') + '</div></div>' +
            (done
                ? '<span class="badge">Já adicionado</span>'
                : '<button type="button" class="btn-sm btn-add-dir" data-auth="' + esc(u.auth_id) + '">Adicionar</button>') +
            '</div>';
    }).join('');
    box.querySelectorAll('.btn-add-dir').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-auth');
            const u = diretorioCache.find(x => x.auth_id === id);
            if (u) await adicionarContato(u);
        });
    });
}

async function adicionarContato(user) {
    const msg = document.getElementById('add-contato-msg');
    if (!user || !user.auth_id) return;
    if (user.auth_id === meuAuthId) {
        msg.textContent = 'Não pode adicionar a si mesmo.';
        msg.className = 'msg erro';
        return;
    }
    const { error } = await supabaseClient.from('chat_contatos').upsert([{
        auth_id: meuAuthId,
        contato_auth_id: user.auth_id,
        apelido: user.nome || null
    }], { onConflict: 'auth_id,contato_auth_id' });
    if (error) {
        msg.textContent = 'Erro: ' + error.message + ' (SQL 18?)';
        msg.className = 'msg erro';
        return;
    }
    msg.textContent = 'Contato adicionado!';
    msg.className = 'msg ok';
    await carregarContatos();
    await abrirThread({
        auth_id: user.auth_id,
        nome: user.nome || user.email,
        email: user.email,
        papeis: user.papeis || [],
        tipo: user.tipo || '',
        apelido: user.nome || null
    });
    fecharModalAdd();
}

document.getElementById('form-chat').addEventListener('submit', async (e) => {
    e.preventDefault();
    await enviarMensagem();
});

document.getElementById('chat-foto').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAnexoInfo('Enviando foto...');
    const url = await uploadMidia(file, 'imagens');
    if (!url) {
        setAnexoInfo('Falha no upload. Cole uma URL ou use imagem <400KB.');
        return;
    }
    anexoPendente = { tipo: 'imagem', midia_url: url, nome: file.name };
    setAnexoInfo('Foto pronta: ' + (file.name || 'imagem') + ' — envie a mensagem.');
});

document.getElementById('chat-video').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAnexoInfo('Enviando vídeo...');
    const url = await uploadMidia(file, 'videos');
    if (!url) {
        setAnexoInfo('Vídeo: use Storage chat-midia ou cole URL pública.');
        return;
    }
    anexoPendente = { tipo: 'video', midia_url: url, nome: file.name };
    setAnexoInfo('Vídeo pronto — envie a mensagem.');
});

document.getElementById('chat-audio-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAnexoInfo('Enviando áudio...');
    const url = await uploadMidia(file, 'audios');
    if (!url) {
        if (file.size <= 500000) {
            try {
                const dataUrl = await fileToDataUrl(file);
                anexoPendente = { tipo: 'audio', midia_url: dataUrl, nome: file.name };
                setAnexoInfo('Áudio pronto (data URL) — envie.');
                return;
            } catch (err) { /* fall */ }
        }
        setAnexoInfo('Áudio: configure bucket chat-midia ou cole URL.');
        return;
    }
    anexoPendente = { tipo: 'audio', midia_url: url, nome: file.name };
    setAnexoInfo('Áudio pronto — envie a mensagem.');
});

document.getElementById('btn-audio').addEventListener('click', async () => {
    const btn = document.getElementById('btn-audio');
    if (!gravando) {
        if (!navigator.mediaDevices || !window.MediaRecorder) {
            document.getElementById('chat-audio-file').click();
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size) audioChunks.push(ev.data);
            };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                const file = new File([blob], 'audio_' + Date.now() + '.webm', { type: blob.type });
                setAnexoInfo('Processando áudio...');
                let url = await uploadMidia(file, 'audios');
                if (!url && blob.size <= 500000) {
                    url = await fileToDataUrl(file);
                }
                if (!url) {
                    setAnexoInfo('Não foi possível salvar o áudio. Use arquivo ou URL.');
                    return;
                }
                anexoPendente = { tipo: 'audio', midia_url: url, nome: file.name };
                setAnexoInfo('Áudio gravado — envie a mensagem.');
            };
            mediaRecorder.start();
            gravando = true;
            btn.textContent = '⏹️ Parar';
            btn.classList.add('btn-danger');
            setAnexoInfo('Gravando áudio...');
        } catch (err) {
            console.warn(err);
            document.getElementById('chat-audio-file').click();
        }
    } else {
        gravando = false;
        btn.textContent = '🎙️ Áudio';
        btn.classList.remove('btn-danger');
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }
});

document.getElementById('btn-toggle-agendar').addEventListener('click', () => {
    agendarAtivo = !agendarAtivo;
    const box = document.getElementById('chat-agendar-box');
    const btn = document.getElementById('btn-toggle-agendar');
    box.classList.toggle('oculto', !agendarAtivo);
    btn.classList.toggle('btn-ok', agendarAtivo);
    btn.textContent = agendarAtivo ? '🗓️ Agendar (ativo)' : '🗓️ Agendar';
});

document.getElementById('btn-add-contato').addEventListener('click', abrirModalAdd);
document.getElementById('btn-fechar-add').addEventListener('click', fecharModalAdd);
document.getElementById('modal-add-contato').addEventListener('click', (e) => {
    if (e.target && e.target.getAttribute('data-close-add') === '1') fecharModalAdd();
});

let buscaTimer = null;
document.getElementById('chat-busca-contatos').addEventListener('input', () => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => carregarContatos(), 200);
});

let addBuscaTimer = null;
document.getElementById('add-busca').addEventListener('input', () => {
    clearTimeout(addBuscaTimer);
    addBuscaTimer = setTimeout(() => {
        carregarDiretorioAdd(document.getElementById('add-busca').value.trim());
    }, 300);
});

document.getElementById('btn-add-email').addEventListener('click', async () => {
    const email = (document.getElementById('add-email').value || '').trim();
    const msg = document.getElementById('add-contato-msg');
    if (!email) {
        msg.textContent = 'Informe o e-mail.';
        msg.className = 'msg erro';
        return;
    }
    const u = await rpcBuscarEmail(email);
    if (!u) {
        msg.textContent = 'E-mail não encontrado no Minera App.';
        msg.className = 'msg erro';
        return;
    }
    await adicionarContato(u);
});

document.getElementById('btn-chat-back').addEventListener('click', () => {
    contatoAtivo = null;
    showThreadUI(false);
    carregarContatos();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    meuAuthId = session.user.id;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('chat', perfilAtual);
    loteCtx = lerLoteQuery();
    const ctxEl = document.getElementById('chat-lote-ctx');
    if (loteCtx && ctxEl) {
        ctxEl.textContent = 'Negociando lote: ' + loteCtx;
        ctxEl.classList.remove('oculto');
        const input = document.getElementById('chat-texto');
        if (input && !input.value) input.placeholder = 'Mensagem sobre o lote ' + loteCtx + '...';
    }

    await carregarContatos();

    const para = lerParaQuery();
    if (para) {
        const perfis = await rpcPerfis([para]);
        const p = perfis[0] || { auth_id: para, nome: 'Contato', papeis: [], tipo: '' };
        await abrirThread({
            auth_id: p.auth_id || para,
            nome: p.nome || 'Contato',
            email: p.email || '',
            papeis: p.papeis || [],
            tipo: p.tipo || '',
            apelido: null
        });
    }

    pollTimer = setInterval(async () => {
        if (contatoAtivo) await carregarThread();
    }, 4000);
    contactsPollTimer = setInterval(carregarContatos, 12000);

    if (typeof window.MineraNotif !== 'undefined' && MineraNotif.start) {
        MineraNotif.start(meuAuthId);
    }
})();

window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (contactsPollTimer) clearInterval(contactsPollTimer);
});
