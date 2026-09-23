let perfilAtual = null;
let pollTimer = null;
let contactsPollTimer = null;
let meuAuthId = null;
let loteCtx = null;
let anexoPendente = null;
let gravando = false;
let mediaRecorder = null;
let audioChunks = [];
let audioTimerInterval = null;
let audioSeconds = 0;
let agendarAtivo = false;

/** Contato ativo: { auth_id, nome, papeis, tipo, apelido } — sem email */
let contatoAtivo = null;
let contatosCache = [];
let diretorioCache = [];
let lastThreadMsgIds = new Set();
let lastContactsSig = '';
let renderedMsgOrder = []; // ids currently in DOM (stable order)
let renderedMsgSigs = new Map();
let threadInitialized = false;
/** Mensagem sendo respondida: { id, texto, de_nome, tipo } | null */
let replyToMsg = null;
/** Cache id → mensagem da thread ativa (p/ quotes e menu) */
let threadMsgsById = new Map();

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

function looksLikeEmail(s) {
    return /@/.test(String(s || ''));
}

/** Nunca exponha e-mail de terceiros no chat/diretório (anti-golpe). */
function stripEmailFields(u) {
    if (!u || typeof u !== 'object') return u;
    const out = Object.assign({}, u);
    delete out.email;
    delete out.Email;
    delete out.e_mail;
    // Se nome/apelido forem literalmente um e-mail, não mostre
    if (looksLikeEmail(out.nome)) out.nome = '';
    if (looksLikeEmail(out.apelido)) out.apelido = '';
    return out;
}

function sanitizeDirList(rows) {
    return (rows || []).map(stripEmailFields);
}

function displayNome(u) {
    if (!u) return 'Contato';
    const ap = String(u.apelido || '').trim();
    const no = String(u.nome || '').trim();
    if (ap && !looksLikeEmail(ap)) return ap;
    if (no && !looksLikeEmail(no)) return no;
    return 'Contato';
}

function meuNomePublico() {
    return displayNome(perfilAtual) || 'Usuário';
}

function nomePublicoTexto(valor, fallback) {
    const s = String(valor || '').trim();
    return s && !looksLikeEmail(s) ? s : (fallback || 'Contato');
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
        // com= = vendedor (Negociar); para=/dm= aliases
        return (u.searchParams.get('com') || u.searchParams.get('para') || u.searchParams.get('dm') || '').trim();
    } catch (e) { return ''; }
}


function lerLocalizacaoQuery() {
    try {
        const u = new URL(window.location.href);
        const lat = parseFloat(u.searchParams.get('lat'));
        const lng = parseFloat(u.searchParams.get('lng'));
        const label = (u.searchParams.get('label') || '').trim();
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            // fallback sessionStorage (mapa → chat)
            try {
                const raw = sessionStorage.getItem('minera_share_loc');
                if (!raw) return null;
                const o = JSON.parse(raw);
                if (!o || !Number.isFinite(Number(o.lat)) || !Number.isFinite(Number(o.lng))) return null;
                if (o.ts && Date.now() - o.ts > 30 * 60 * 1000) return null;
                return {
                    lat: Number(o.lat),
                    lng: Number(o.lng),
                    label: String(o.label || '').trim(),
                    texto: String(o.texto || '').trim(),
                    link: String(o.link || '')
                };
            } catch (e2) { return null; }
        }
        const link = 'https://maps.google.com/?q=' + encodeURIComponent(lat + ',' + lng);
        const texto =
            '📍 ' + (label || ('Local ' + lat.toFixed(5) + ', ' + lng.toFixed(5))) + '\n' +
            'Coords: ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '\n' +
            link;
        return { lat: lat, lng: lng, label: label, texto: texto, link: link };
    } catch (e) { return null; }
}

function preencherLocalizacaoNoComposer(loc) {
    if (!loc) return;
    const input = document.getElementById('chat-texto');
    if (input) {
        const texto = loc.texto || (
            '📍 ' + (loc.label || 'Localização') + '\n' +
            'Coords: ' + Number(loc.lat).toFixed(6) + ', ' + Number(loc.lng).toFixed(6) + '\n' +
            (loc.link || ('https://maps.google.com/?q=' + loc.lat + ',' + loc.lng))
        );
        if (!input.value.trim()) input.value = texto;
        else if (input.value.indexOf('maps.google.com') === -1) input.value = input.value.trim() + '\n\n' + texto;
        try { input.focus(); } catch (e) {}
    }
    const ctxEl = document.getElementById('chat-lote-ctx');
    if (ctxEl && !loteCtx) {
        ctxEl.textContent = 'Localização pronta para enviar — escolha um contato se ainda não houver conversa.';
        ctxEl.classList.remove('oculto');
    }
    try { sessionStorage.removeItem('minera_share_loc'); } catch (e) {}
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

/** Base MIME without codecs (Storage rejects some ";codecs=..." types). */
function baseMime(t) {
    const s = String(t || '').split(';')[0].trim().toLowerCase();
    return s || '';
}

function extForMime(mime, fallback) {
    const m = baseMime(mime);
    if (m === 'audio/webm' || m === 'video/webm') return 'webm';
    if (m === 'audio/ogg' || m === 'video/ogg') return 'ogg';
    if (m === 'audio/mp4' || m === 'audio/aac' || m === 'audio/x-m4a') return 'm4a';
    if (m === 'audio/mpeg' || m === 'audio/mp3') return 'mp3';
    if (m === 'audio/wav' || m === 'audio/wave') return 'wav';
    if (m === 'image/jpeg') return 'jpg';
    if (m === 'image/png') return 'png';
    if (m === 'image/gif') return 'gif';
    if (m === 'image/webp') return 'webp';
    if (m === 'video/mp4') return 'mp4';
    return fallback || 'bin';
}

function pickRecorderMime() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
    }
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
        'audio/aac'
    ];
    for (let i = 0; i < candidates.length; i++) {
        try {
            if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        } catch (e) { /* ignore */ }
    }
    return '';
}

let lastUploadError = '';

async function uploadMidia(file, pasta) {
    if (!file) return null;
    lastUploadError = '';
    const mime = baseMime(file.type) || (pasta === 'audios' ? 'audio/webm' : 'application/octet-stream');
    const ext = extForMime(mime, (file.name || '').split('.').pop() || 'bin');
    const safeName = String(file.name || ('arquivo.' + ext)).replace(/[^\w.\-]/g, '_');
    const stem = safeName.replace(/\.[^.]+$/, '') || 'arquivo';
    const uid = (typeof meuAuthId !== 'undefined' && meuAuthId) ? String(meuAuthId) : 'anon';
    const path = uid + '/' + (pasta || 'geral') + '/' + Date.now() + '_' + stem + '.' + ext;
    // Re-wrap so Content-Type never carries ";codecs=..." (Storage/CDN often rejects it)
    let payload = file;
    try {
        if (baseMime(file.type) !== mime || /;/.test(String(file.type || ''))) {
            payload = new File([file], stem + '.' + ext, { type: mime });
        }
    } catch (eWrap) {
        payload = file;
    }
    try {
        const { data, error } = await supabaseClient.storage
            .from('chat-midia')
            .upload(path, payload, {
                upsert: false,
                contentType: mime,
                cacheControl: '3600'
            });
        if (!error && data) {
            const { data: pub } = supabaseClient.storage.from('chat-midia').getPublicUrl(data.path || path);
            if (pub && pub.publicUrl) return pub.publicUrl;
            lastUploadError = 'Upload ok mas sem URL pública — rode SQL 27 (bucket público).';
        } else {
            lastUploadError = (error && error.message) || 'Falha no upload Storage';
            console.warn('Storage upload falhou:', lastUploadError);
        }
    } catch (e) {
        lastUploadError = (e && e.message) || 'Storage indisponível';
        console.warn('Storage indisponível:', e);
    }
    // Fallbacks: data-URL for short voice (~3–5MB) so sender still hears it if bucket missing
    const maxImg = 400000;
    const maxAudio = 4500000; // ~4.5MB — short voice notes when Storage fails
    if (mime && mime.startsWith('image/') && file.size <= maxImg) {
        try { return await fileToDataUrl(file); } catch (e2) { console.warn(e2); }
    }
    if ((mime && mime.startsWith('audio/')) || pasta === 'audios') {
        if (file.size <= maxAudio) {
            try { return await fileToDataUrl(file); } catch (e2) { console.warn(e2); }
        } else {
            lastUploadError = lastUploadError || ('Áudio grande demais para fallback (' + Math.round(file.size / 1000) + ' KB).');
        }
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

function mimeFromMediaUrl(url) {
    const s = String(url || '');
    if (s.startsWith('data:audio/')) {
        return baseMime(s.slice(5).split(',')[0]);
    }
    const u = s.split('?')[0].toLowerCase();
    if (/\.webm$/i.test(u)) return 'audio/webm';
    if (/\.ogg$/i.test(u)) return 'audio/ogg';
    if (/\.m4a$/i.test(u) || /\.mp4$/i.test(u)) return 'audio/mp4';
    if (/\.mp3$/i.test(u) || /\.mpeg$/i.test(u)) return 'audio/mpeg';
    if (/\.wav$/i.test(u)) return 'audio/wav';
    return '';
}

function renderMedia(m) {
    const url = m.midia_url;
    const loading = !!m._loading;
    const localPreview = m._localPreview || '';
    const tipo = (m.tipo || 'text').toLowerCase();

    if (loading && localPreview) {
        if (tipo === 'imagem' || localPreview.startsWith('data:image') || localPreview.startsWith('blob:')) {
            return '<div class="bubble-media bubble-media-loading">' +
                '<img src="' + esc(localPreview) + '" alt="enviando">' +
                '<div class="media-upload-overlay">Enviando…</div></div>';
        }
        if (tipo === 'video') {
            return '<div class="bubble-media bubble-media-loading">' +
                '<video src="' + esc(localPreview) + '" muted playsinline></video>' +
                '<div class="media-upload-overlay">Enviando…</div></div>';
        }
        if (tipo === 'audio') {
            return '<div class="bubble-media bubble-media-loading">' +
                '<audio src="' + esc(localPreview) + '" controls playsinline webkit-playsinline></audio>' +
                '<div class="media-upload-overlay">Enviando…</div></div>';
        }
    }

    if (!url) return '';
    if (tipo === 'imagem' || url.startsWith('data:image')) {
        return '<div class="bubble-media"><img src="' + esc(url) + '" alt="imagem" loading="lazy"></div>';
    }
    if (tipo === 'video') {
        return '<div class="bubble-media"><video src="' + esc(url) + '" controls playsinline></video></div>';
    }
    if (tipo === 'audio') {
        const amime = mimeFromMediaUrl(url);
        const typeAttr = amime ? ' type="' + esc(amime) + '"' : '';
        return '<div class="bubble-media bubble-audio">' +
            '<div class="wa-wave" aria-hidden="true">▁▂▃▅▃▂▅▆▄▂▃▅▂▁</div>' +
            '<audio controls preload="metadata" playsinline webkit-playsinline>' +
            '<source src="' + esc(url) + '"' + typeAttr + '>' +
            '</audio></div>';
    }
    if (tipo === 'documento' || tipo === 'doc' || tipo === 'pdf' || /\.pdf($|\?)/i.test(url) || String(url).indexOf('application/pdf') >= 0) {
        const name = (m.texto || 'Documento.pdf').slice(0, 40);
        return '<div class="bubble-media bubble-doc">' +
            '<div class="bubble-doc-ico">📄</div>' +
            '<div class="bubble-doc-body"><strong>' + esc(name) + '</strong>' +
            '<span class="sub">PDF · toque para abrir</span></div>' +
            '<a class="btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener">Abrir</a></div>';
    }
    return '<div class="bubble-media"><a href="' + esc(url) + '" target="_blank" rel="noopener">Abrir mídia</a></div>';
}

function messageSignature(m) {
    return JSON.stringify([
        m.id, m.texto || '', m.tipo || '', m.midia_url || '', m.status || '',
        m.agendado_para || '', m.moderacao || '', m.deleted_at || '',
        m.resposta_a_id || '', (m.apagada_para || []).join(',')
    ]);
}

function snippetMsg(m) {
    if (!m) return '';
    if (m.deleted_at) return 'Mensagem apagada';
    const raw = (m.texto || '').trim();
    if (raw) return raw.slice(0, 120);
    if (m.tipo === 'audio') return '🎙️ Áudio';
    if (m.tipo === 'imagem') return '📷 Foto';
    if (m.tipo === 'video') return '🎬 Vídeo';
    if (m.tipo && m.tipo !== 'text') return '[' + m.tipo + ']';
    return '(sem texto)';
}


function dayKey(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}
function dayLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    if (dayKey(iso) === dayKey(now.toISOString())) return 'Hoje';
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (dayKey(iso) === dayKey(y.toISOString())) return 'Ontem';
    return d.toLocaleDateString('pt-BR');
}
function bubblesWithDayDividers(lista) {
    let last = null;
    let html = '';
    (lista || []).forEach(m => {
        const k = dayKey(m.criado_em);
        if (k && k !== last) {
            last = k;
            html += '<div class="wa-day-div"><span>' + dayLabel(m.criado_em) + '</span></div>';
        }
        html += bubbleHtml(m);
    });
    return html;
}

function bubbleHtml(m) {
    const mine = !!(m.de_auth_id && meuAuthId && String(m.de_auth_id) === String(meuAuthId));
    const when = m.criado_em
        ? new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : (m._pending ? 'agora' : '');
    const st = (m.status || 'enviada');
    const sched = st === 'agendada';
    const agLabel = sched && m.agendado_para
        ? ' · agendada p/ ' + new Date(m.agendado_para).toLocaleString('pt-BR')
        : '';
    const flag = m.moderacao ? ' · 🚩 ' + esc(m.moderacao) : '';
    const isAdmin = typeof ehAdmin === 'function' && ehAdmin(perfilAtual);
    const pendingCls = m._pending || m._loading ? ' pending' : '';
    const deleted = !!m.deleted_at;
    const idAttr = m.id != null ? ' data-msg-id="' + esc(String(m.id)) + '"' : (m._tempId ? ' data-temp-id="' + esc(m._tempId) + '"' : '');
    const deAttr = m.de_auth_id ? ' data-de-auth="' + esc(String(m.de_auth_id)) + '"' : '';
    let quoteHtml = '';
    if (!deleted && m.resposta_a_id) {
        const orig = threadMsgsById.get(Number(m.resposta_a_id)) || threadMsgsById.get(String(m.resposta_a_id));
        const qNome = orig ? nomePublicoTexto(orig.de_nome, 'Mensagem') : 'Mensagem';
        const qTxt = orig ? snippetMsg(orig) : ('#' + m.resposta_a_id);
        quoteHtml = '<div class="bubble-quote"><span class="bubble-quote-name">' + esc(qNome) +
            '</span><span class="bubble-quote-text">' + esc(qTxt) + '</span></div>';
    }
    const body = deleted
        ? '<div class="bubble-text bubble-deleted">Mensagem apagada</div>'
        : ((m.texto ? '<div class="bubble-text">' + esc((typeof AntiGolpe !== 'undefined' ? AntiGolpe.mascarar(m.texto) : m.texto)) + '</div>' : '') +
            renderMedia(m));
    return `<div class="bubble ${mine ? 'mine sent' : 'theirs'}${sched ? ' scheduled' : ''}${deleted ? ' deleted' : ''}${pendingCls}"${idAttr}${deAttr}>
        ${mine ? '' : `<div class="bubble-meta">${esc(nomePublicoTexto(m.de_nome, 'Alguém'))}</div>`}
        ${quoteHtml}
        ${body}
        <div class="bubble-status"><span class="bubble-clock">${when}</span> ${esc(deleted ? 'apagada' : (m._loading ? 'enviando' : st))}${isAdmin && m.id ? ' · #' + m.id : ''}</div>
    </div>`;
}

function isNearBottom(box, threshold) {
    if (!box) return true;
    const t = threshold == null ? 80 : threshold;
    return (box.scrollHeight - box.scrollTop - box.clientHeight) <= t;
}

async function rpcDiretorio(busca) {
    try {
        const termo = String(busca || '').trim();
        // Nunca busque por e-mail no cliente
        if (looksLikeEmail(termo)) return [];
        if (termo.length >= 1) {
            const { data, error } = await supabaseClient.rpc('chat_buscar_nome', { p_nome: termo });
            if (!error && data) return sanitizeDirList(data);
        }
        const { data, error } = await supabaseClient.rpc('chat_diretorio');
        if (error) throw error;
        const list = sanitizeDirList(data);
        if (!termo) return list;
        const t = termo.toLowerCase();
        return list.filter(u =>
            String(u.nome || '').toLowerCase().includes(t) ||
            String(u.apelido || '').toLowerCase().includes(t)
        );
    } catch (e) {
        console.warn('chat_diretorio/buscar_nome', e);
        return [];
    }
}

async function rpcPerfis(ids) {
    if (!ids || !ids.length) return [];
    try {
        const { data, error } = await supabaseClient.rpc('chat_perfis_publicos', { p_ids: ids });
        if (error) throw error;
        return sanitizeDirList(data);
    } catch (e) {
        console.warn('chat_perfis_publicos', e);
        return [];
    }
}

function contactsSignature(list) {
    return (list || []).map(c =>
        [c.auth_id, c.nome, c.unread || 0,
            c.last && c.last.id, c.last && (c.last.texto || '').slice(0, 40), c.last && c.last.tipo].join(':')
    ).join('|') + '|' + (contatoAtivo && contatoAtivo.auth_id || '');
}

function renderContatosList(filtered) {
    const box = document.getElementById('chat-contatos-list');
    if (!filtered.length) {
        box.innerHTML = '<div class="chat-contacts-empty">' +
            '<p><strong>Nenhuma conversa ainda</strong></p>' +
            '<p class="sub">Toque em <strong>＋ Adicionar por nome</strong> para achar por nome ou apelido.</p>' +
            '</div>';
        return;
    }

    const grouped = {};
    ROLE_GROUPS.forEach(g => { grouped[g.id] = []; });
    filtered.forEach(c => {
        const gid = rotuloGrupoPapel(c.papeis, c.tipo);
        (grouped[gid] || grouped.outros).push(c);
    });

    function initials(n) {
        const parts = String(n || '?').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    function timeRight(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        const same = d.toDateString() === now.toDateString();
        if (same) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
    let html = '';
    // Flat WhatsApp-style list (keep group order but no heavy headers)
    ROLE_GROUPS.forEach(g => {
        const list = grouped[g.id] || [];
        list.forEach(c => {
            const preview = c.last
                ? ((c.last.de_auth_id === meuAuthId ? 'Você: ' : '') +
                    (c.last.texto || (c.last.tipo && c.last.tipo !== 'text' ? '[' + c.last.tipo + ']' : ''))).slice(0, 56)
                : 'Sem mensagens';
            const on = contatoAtivo && contatoAtivo.auth_id === c.auth_id ? ' on' : '';
            const badge = c.unread ? '<span class="wa-unread">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '';
            const t = timeRight(c.last && c.last.criado_em);
            html += '<button type="button" class="wa-row chat-contact-item' + on + '" data-auth="' + esc(c.auth_id) + '">' +
                '<div class="wa-av">' + esc(initials(c.nome)) + '</div>' +
                '<div class="wa-row-mid">' +
                '<div class="wa-row-name">' + esc(c.nome) + '</div>' +
                '<div class="wa-row-prev">' + esc(preview) + '</div>' +
                '</div><div class="wa-row-right"><span class="wa-row-time">' + esc(t) + '</span>' + badge + '</div></button>';
        });
    });
    box.innerHTML = html || '<div class="chat-contacts-empty"><p><strong>Nenhuma conversa ainda</strong></p></div>';
    box.querySelectorAll('.chat-contact-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-auth');
            const c = contatosCache.find(x => x.auth_id === id);
            if (c) abrirThread(c);
        });
    });
}

async function carregarContatos(force) {
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

        const { data: msgs } = await supabaseClient
            .from('chat_mensagens')
            .select('id,de_auth_id,para_auth_id,texto,tipo,criado_em,status,deleted_at,de_nome,apagada_para')
            .or('de_auth_id.eq.' + meuAuthId + ',para_auth_id.eq.' + meuAuthId)
            .order('criado_em', { ascending: false })
            .limit(400);

        let ocultasMap = {};
        try {
            const { data: oc } = await supabaseClient
                .from('chat_conversas_ocultas')
                .select('outro_auth_id,oculto_em')
                .eq('auth_id', meuAuthId);
            (oc || []).forEach(r => { ocultasMap[r.outro_auth_id] = r.oculto_em; });
        } catch (e) { /* SQL 28 */ }

        const lastByPeer = {};
        (msgs || []).forEach(m => {
            if (m.deleted_at) return;
            const ap = m.apagada_para || [];
            if (Array.isArray(ap) && ap.indexOf(meuAuthId) >= 0) return;
            const peer = m.de_auth_id === meuAuthId ? m.para_auth_id : m.de_auth_id;
            if (!peer || lastByPeer[peer]) return;
            lastByPeer[peer] = m;
        });

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

        const unreadByPeer = {};
        (msgs || []).forEach(m => {
            if (m.deleted_at) return;
            if (m.para_auth_id !== meuAuthId) return;
            if ((m.status || '') === 'agendada') return;
            const ap = m.apagada_para || [];
            if (Array.isArray(ap) && ap.indexOf(meuAuthId) >= 0) return;
            const peer = m.de_auth_id;
            if (!peer) return;
            const lastRead = getLeituraLocal(peer);
            if (Number(m.id) > lastRead) {
                unreadByPeer[peer] = (unreadByPeer[peer] || 0) + 1;
            }
        });

        contatosCache = (rows || []).map(r => {
            const p = byId[r.contato_auth_id] || {};
            const last = lastByPeer[r.contato_auth_id];
            const nome = nomePublicoTexto(r.apelido, displayNome(p));
            return {
                auth_id: r.contato_auth_id,
                nome,
                papeis: p.papeis || [],
                tipo: p.tipo || '',
                apelido: nomePublicoTexto(r.apelido || p.apelido, '') || null,
                last,
                unread: unreadByPeer[r.contato_auth_id] || 0
            };
        });

        contatosCache.sort((a, b) => {
            const ta = a.last && a.last.criado_em ? new Date(a.last.criado_em).getTime() : 0;
            const tb = b.last && b.last.criado_em ? new Date(b.last.criado_em).getTime() : 0;
            return tb - ta;
        });

        const filtered = contatosCache.filter(c => {
            const ocEm = ocultasMap[c.auth_id];
            if (ocEm) {
                const lastT = c.last && c.last.criado_em ? new Date(c.last.criado_em).getTime() : 0;
                if (lastT <= new Date(ocEm).getTime()) return false;
            }
            if (!busca) return true;
            return (c.nome || '').toLowerCase().includes(busca) ||
                (c.apelido || '').toLowerCase().includes(busca) ||
                labelPapelCurto(c.papeis, c.tipo).toLowerCase().includes(busca);
        });

        const sig = contactsSignature(filtered);
        if (!force && sig === lastContactsSig && box.children.length) {
            return; // same data — do not rebuild (no flicker)
        }
        lastContactsSig = sig;
        renderContatosList(filtered);
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Contatos indisponíveis: ' + esc(err.message) +
            '. Rode o SQL 18 + 22 no Supabase.</p>';
        lastContactsSig = '';
    }
}

function showThreadUI(show) {
    const empty = document.getElementById('chat-thread-empty');
    const active = document.getElementById('chat-thread-active');
    const pane = document.getElementById('chat-wa');
    if (empty) empty.classList.toggle('oculto', show);
    if (active) active.classList.toggle('oculto', !show);
    if (pane) pane.classList.toggle('thread-open', !!show);
    // WA mobile: hide bottom nav while inside a thread (CSS: body.chat-thread-open)
    if (document.body) document.body.classList.toggle('chat-thread-open', !!show);
}

async function abrirThread(contato) {
    contatoAtivo = contato;
    setReplyTo(null);
    fecharChatHeadMenu();
    showThreadUI(true);
    document.getElementById('chat-com-nome').textContent = displayNome(contato);
    const papelEl = document.getElementById('chat-com-papel');
    if (papelEl) { papelEl.textContent = ''; papelEl.hidden = true; }
    lastThreadMsgIds = new Set();
    renderedMsgOrder = [];
    renderedMsgSigs = new Map();
    threadMsgsById = new Map();
    threadInitialized = false;
    const box = document.getElementById('chat-msgs');
    if (box) box.innerHTML = '';
    try {
        await supabaseClient.rpc('chat_desocultar_conversa', { p_outro: contato.auth_id });
    } catch (e) { /* SQL 28 opcional */ }
    await carregarThread(true);
    await carregarContatos(true);
    try {
        await supabaseClient.from('chat_contatos').upsert([{
            auth_id: meuAuthId,
            contato_auth_id: contato.auth_id,
            apelido: displayNome(contato)
        }], { onConflict: 'auth_id,contato_auth_id' });
    } catch (e) { /* table may not exist yet */ }
}

function appendOptimisticBubble(m) {
    const box = document.getElementById('chat-msgs');
    if (!box) return null;
    const emptyHint = box.querySelector(':scope > .sub, :scope > .erro');
    if (emptyHint) emptyHint.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = bubbleHtml(m);
    const el = wrap.firstElementChild;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
}

function applyThreadDiff(box, lista, forceFull) {
    const stickBottom = isNearBottom(box);
    const prevScroll = box.scrollTop;

    if (forceFull || !threadInitialized) {
        if (!lista.length) {
            box.innerHTML = '<p class="sub">Nenhuma mensagem ainda. Diga oi!</p>';
            renderedMsgOrder = [];
            renderedMsgSigs = new Map();
            threadInitialized = true;
            return;
        }
        // Preserve pending optimistic bubbles (temp)
        const pendings = Array.from(box.querySelectorAll('[data-temp-id]'));
        box.innerHTML = bubblesWithDayDividers(lista);
        pendings.forEach(p => box.appendChild(p));
        renderedMsgOrder = lista.map(m => String(m.id));
        renderedMsgSigs = new Map(lista.map(m => [String(m.id), messageSignature(m)]));
        threadInitialized = true;
        box.scrollTop = box.scrollHeight;
        return;
    }

    const incomingIds = lista.map(m => String(m.id));
    const sameSet = incomingIds.length === renderedMsgOrder.length &&
        incomingIds.every((id, i) => id === renderedMsgOrder[i]);

    if (sameSet) {
        // Identical data: do absolutely nothing. If one bubble changed, patch only it.
        lista.forEach(m => {
            const id = String(m.id);
            const sig = messageSignature(m);
            if (renderedMsgSigs.get(id) === sig) return;
            const current = box.querySelector('[data-msg-id="' + CSS.escape(id) + '"]');
            if (current) {
                const wrap = document.createElement('div');
                wrap.innerHTML = bubbleHtml(m);
                current.replaceWith(wrap.firstElementChild);
            }
            renderedMsgSigs.set(id, sig);
        });
        return;
    }

    // If order diverged a lot (deletes), full rebuild once
    const onlyAppend = incomingIds.length >= renderedMsgOrder.length &&
        renderedMsgOrder.every((id, i) => incomingIds[i] === id);

    if (!onlyAppend) {
        const pendings = Array.from(box.querySelectorAll('[data-temp-id]'));
        box.innerHTML = bubblesWithDayDividers(lista);
        pendings.forEach(p => box.appendChild(p));
        renderedMsgOrder = incomingIds;
        renderedMsgSigs = new Map(lista.map(m => [String(m.id), messageSignature(m)]));
        if (stickBottom) box.scrollTop = box.scrollHeight;
        else box.scrollTop = prevScroll;
        return;
    }

    // Diff-append new messages only
    const emptyHint = box.querySelector(':scope > .sub');
    if (emptyHint) emptyHint.remove();
    const newOnes = lista.slice(renderedMsgOrder.length);
    newOnes.forEach(m => {
        const wrap = document.createElement('div');
        wrap.innerHTML = bubbleHtml(m);
        box.appendChild(wrap.firstElementChild);
        renderedMsgOrder.push(String(m.id));
        renderedMsgSigs.set(String(m.id), messageSignature(m));
        // Drop matching optimistic temp if present
        const temp = box.querySelector('[data-temp-id]');
        if (temp && m.de_auth_id === meuAuthId) temp.remove();
    });
    if (stickBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = prevScroll;
}

async function carregarThread(forceFull) {
    const box = document.getElementById('chat-msgs');
    if (!contatoAtivo || !contatoAtivo.auth_id) {
        showThreadUI(false);
        return;
    }
    const them = contatoAtivo.auth_id;
    try {
        const { data, error } = await supabaseClient
            .from('chat_mensagens')
            .select('*')
            .or('de_auth_id.eq.' + meuAuthId + ',para_auth_id.eq.' + meuAuthId)
            .order('criado_em', { ascending: true })
            .limit(400);
        if (error) throw error;

        let lista = (data || []).filter(m => {
            const ap = m.apagada_para || [];
            if (Array.isArray(ap) && ap.indexOf(meuAuthId) >= 0) return false;
            if ((m.moderacao || '') === 'removida' && !m.deleted_at) return false;
            const inDm = (m.de_auth_id === meuAuthId && m.para_auth_id === them) ||
                (m.de_auth_id === them && m.para_auth_id === meuAuthId);
            if (!inDm) return false;
            if ((m.status || '') === 'agendada' && m.de_auth_id !== meuAuthId) return false;
            return true;
        });
        threadMsgsById = new Map(lista.map(m => [Number(m.id), m]));
        await promoverAgendadas(lista.filter(m => !m.deleted_at));

        const incoming = lista.filter(m =>
            m.para_auth_id === meuAuthId &&
            m.de_auth_id === them &&
            !lastThreadMsgIds.has(m.id) &&
            lastThreadMsgIds.size > 0
        );
        lista.forEach(m => lastThreadMsgIds.add(m.id));

        applyThreadDiff(box, lista, !!forceFull);

        const maxIn = lista.filter(m => m.para_auth_id === meuAuthId).reduce((mx, m) => Math.max(mx, Number(m.id) || 0), 0);
        if (maxIn) await marcarLido(them, maxIn);

        incoming.forEach(m => {
            if (typeof toastMsg === 'function') {
                toastMsg('Nova mensagem de ' + (nomePublicoTexto(m.de_nome, displayNome(contatoAtivo))));
            }
        });
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Chat indisponível: ' + esc(err.message) +
            '. Rode o SQL 18 + 22 no Supabase.</p>';
        renderedMsgOrder = [];
        renderedMsgSigs = new Map();
        threadInitialized = false;
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

    if (anexoPendente && !opts.midia_url) {
        tipo = anexoPendente.tipo;
        midia_url = anexoPendente.midia_url;
    } else if (urlManual && !midia_url) {
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
    if (agendarAtivo && !opts.skipAgendar) {
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
        de_nome: meuNomePublico(),
        texto: texto || '',
        tipo,
        midia_url,
        para_auth_id: contatoAtivo.auth_id,
        status,
        agendado_para
    };
    if (replyToMsg && replyToMsg.id) {
        row.resposta_a_id = Number(replyToMsg.id);
    }

    const { error } = await supabaseClient.from('chat_mensagens').insert([row]);
    if (error) {
        const hint = /resposta_a_id|column/i.test(error.message || '')
            ? ' (rode SQL 28)'
            : (/policy|RLS|row-level/i.test(error.message || '') ? ' (rode SQL 18)' : '');
        msgEl.textContent = 'Erro: ' + error.message + hint;
        msgEl.className = 'msg erro';
        return false;
    }

    msgEl.textContent = status === 'agendada' ? 'Mensagem agendada!' : '';
    msgEl.className = status === 'agendada' ? 'msg ok' : 'msg';
    if (!opts.keepInput) input.value = '';
    document.getElementById('chat-url-midia').value = '';
    anexoPendente = null;
    setAnexoInfo('');
    setReplyTo(null);
    if (typeof showMediaPreview === 'function') showMediaPreview(null);
    resetAudioBtn();
    try {
        await supabaseClient.rpc('chat_desocultar_conversa', { p_outro: contatoAtivo.auth_id });
    } catch (e) { /* ok */ }
    await carregarThread();
    await carregarContatos(true);
    return true;
}

/** Preview strip (composer) + optimistic bubble for image/video/audio */
function showMediaPreview(opts) {
    const box = document.getElementById('chat-media-preview');
    if (!box) return;
    if (!opts) {
        box.classList.add('oculto');
        box.innerHTML = '';
        return;
    }
    const uploading = opts.uploading
        ? '<span class="media-uploading-spin" aria-hidden="true"></span> Enviando…'
        : '';
    let body = '';
    if ((opts.tipo === 'imagem' || opts.tipo === 'video') && opts.localUrl) {
        const tag = opts.tipo === 'video' ? 'video' : 'img';
        const extra = opts.tipo === 'video' ? ' muted playsinline' : ' alt="prévia"';
        body = '<' + tag + ' class="media-preview-thumb" src="' + esc(opts.localUrl) + '"' + extra + '></' + tag + '>';
    } else if (opts.tipo === 'audio') {
        body = '<div class="media-preview-audio">🎙️ Áudio ' + esc(opts.duracao || '') + '</div>' +
            (opts.localUrl ? '<audio src="' + esc(opts.localUrl) + '" controls playsinline webkit-playsinline style="max-width:180px"></audio>' : '');
    } else {
        body = '<div class="media-preview-audio">' + esc(opts.nome || 'Mídia') + '</div>';
    }
    const sendBtn = opts.readyToSend
        ? '<button type="button" class="btn-sm btn-ok" id="btn-send-anexo">Enviar</button>'
        : '';
    box.innerHTML = body +
        (uploading ? '<div class="media-preview-status">' + uploading + '</div>' : '') +
        sendBtn +
        '<button type="button" class="btn-sm btn-danger" id="btn-cancel-anexo">Cancelar</button>';
    box.classList.remove('oculto');
    const cancel = document.getElementById('btn-cancel-anexo');
    if (cancel) cancel.onclick = () => {
        if (opts.localUrl && String(opts.localUrl).startsWith('blob:')) {
            try { URL.revokeObjectURL(opts.localUrl); } catch (e) { /* ignore */ }
        }
        anexoPendente = null;
        showMediaPreview(null);
        setAnexoInfo('');
        resetAudioBtn();
    };
    const send = document.getElementById('btn-send-anexo');
    if (send) send.onclick = () => enviarAnexoPendente();
}

async function enviarAnexoPendente() {
    if (!anexoPendente) return;
    const pend = anexoPendente;
    const localUrl = pend.localUrl || null;
    const tempId = 'tmp_' + Date.now();
    appendOptimisticBubble({
        _tempId: tempId,
        _pending: true,
        _loading: true,
        _localPreview: localUrl,
        de_auth_id: meuAuthId,
        de_nome: meuNomePublico(),
        texto: '',
        tipo: pend.tipo,
        status: 'enviando',
        criado_em: new Date().toISOString()
    });
    showMediaPreview({
        tipo: pend.tipo,
        localUrl: localUrl,
        uploading: true,
        duracao: pend.duracao,
        nome: pend.nome
    });
    setAnexoInfo('Enviando…');

    let url = pend.midia_url || null;
    if (!url && pend.file) {
        const pasta = pend.tipo === 'imagem' ? 'imagens' : (pend.tipo === 'video' ? 'videos' : 'audios');
        url = await uploadMidia(pend.file, pasta);
        if (!url) {
            try { url = await fileToDataUrl(pend.file); } catch (e) { /* ignore */ }
        }
    }
    const tempEl = document.querySelector('[data-temp-id="' + tempId + '"]');
    if (!url) {
        if (tempEl) {
            const st = tempEl.querySelector('.bubble-status');
            if (st) st.textContent = 'falha no envio';
            tempEl.classList.add('bubble-failed');
        }
        showMediaPreview(null);
        const detail = lastUploadError ? (' ' + lastUploadError) : '';
        setAnexoInfo('Falha no upload de mídia. Aplique SQL 27 (bucket chat-midia público) ou tente de novo.');
        const msgEl = document.getElementById('chat-msg');
        if (msgEl) {
            msgEl.textContent = 'Não foi possível enviar a mídia.' + detail;
            msgEl.className = 'msg erro';
        }
        if (typeof toastMsg === 'function') toastMsg('Falha ao enviar mídia. Rode SQL 27 se o erro continuar.');
        // Keep anexoPendente so user can retry Enviar
        resetAudioBtn();
        if (pend.tipo === 'audio' && pend.file) {
            const btn = document.getElementById('btn-audio');
            if (btn) {
                btn.textContent = '➤ Enviar';
                btn.classList.add('btn-ok');
            }
        }
        return;
    }
    anexoPendente = null;
    showMediaPreview(null);
    setAnexoInfo('');
    resetAudioBtn();
    const ok = await enviarMensagem({ tipo: pend.tipo, midia_url: url, texto: '', keepInput: true });
    if (tempEl) tempEl.remove();
    if (!ok && localUrl) {
        // Insert failed — restore pending so user can retry
        anexoPendente = pend;
        setAnexoInfo('Envio falhou — toque Enviar para tentar de novo.');
    }
    // Delay revoke so optimistic/local playback isn't killed mid-transition
    if (localUrl && String(localUrl).startsWith('blob:')) {
        setTimeout(() => {
            try { URL.revokeObjectURL(localUrl); } catch (e) { /* ignore */ }
        }, 15000);
    }
}

/** Image/video: thumbnail preview + spinner until storage/url ready, then bubble */
async function pickMidiaArquivo(file, tipo) {
    if (!contatoAtivo || !contatoAtivo.auth_id) {
        const msgEl = document.getElementById('chat-msg');
        if (msgEl) {
            msgEl.textContent = 'Selecione um contato primeiro.';
            msgEl.className = 'msg erro';
        }
        return;
    }
    const localUrl = URL.createObjectURL(file);
    const token = localUrl;
    anexoPendente = { tipo, file, localUrl, nome: file.name, midia_url: null };
    showMediaPreview({ tipo, localUrl, uploading: true, nome: file.name });

    const pasta = tipo === 'imagem' ? 'imagens' : (tipo === 'video' ? 'videos' : 'audios');
    let url = await uploadMidia(file, pasta);
    if (!url) {
        try { url = await fileToDataUrl(file); } catch (e) { /* ignore */ }
    }
    if (!anexoPendente || anexoPendente.localUrl !== token) {
        try { URL.revokeObjectURL(localUrl); } catch (e) { /* ignore */ }
        return;
    }
    if (!url) {
        showMediaPreview({ tipo, localUrl, uploading: false, nome: file.name });
        setAnexoInfo('Upload falhou. Tente novamente ou cole uma URL.');
        return;
    }
    anexoPendente.midia_url = url;
    await enviarAnexoPendente();
}

/* ---- Audio: press-and-hold OR tap → recording bar → Enviar ---- */
let audioCancelado = false;
let audioHoldMode = false;
let audioPointerId = null;
let audioAutoSend = false;

function formatAudioTimer(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
}

function showRecBar(show) {
    const bar = document.getElementById('chat-rec-bar');
    if (bar) bar.classList.toggle('oculto', !show);
}

function updateRecTimer() {
    const t = document.getElementById('chat-rec-timer');
    const btn = document.getElementById('btn-audio');
    const label = formatAudioTimer(audioSeconds);
    if (t) t.textContent = label;
    if (btn && gravando) {
        btn.textContent = '⏹️ ' + label;
        btn.classList.add('recording', 'btn-danger');
    }
}

function startAudioTimer() {
    audioSeconds = 0;
    updateRecTimer();
    clearInterval(audioTimerInterval);
    audioTimerInterval = setInterval(() => {
        audioSeconds += 1;
        updateRecTimer();
    }, 1000);
}

function stopAudioTimer() {
    clearInterval(audioTimerInterval);
    audioTimerInterval = null;
}

function resetAudioBtn() {
    const btn = document.getElementById('btn-audio');
    if (!btn) return;
    btn.textContent = '🎤';
    btn.classList.remove('btn-danger', 'recording', 'btn-ok');
    btn.title = 'Segure para gravar';
}

function onRecordingReady(blob) {
    const mime = baseMime(blob.type) || 'audio/webm';
    const ext = extForMime(mime, 'webm');
    const file = new File([blob], 'audio_' + Date.now() + '.' + ext, { type: mime });
    const localUrl = URL.createObjectURL(blob);
    const doSend = audioAutoSend;
    audioAutoSend = false;
    anexoPendente = {
        tipo: 'audio',
        file,
        blob,
        localUrl,
        nome: file.name,
        midia_url: null,
        duracao: formatAudioTimer(audioSeconds)
    };
    showMediaPreview({
        tipo: 'audio',
        localUrl,
        uploading: !!doSend,
        readyToSend: !doSend,
        duracao: formatAudioTimer(audioSeconds)
    });
    if (doSend) {
        setAnexoInfo('Enviando áudio…');
        enviarAnexoPendente();
        return;
    }
    const btn = document.getElementById('btn-audio');
    if (btn) {
        btn.textContent = '➤ Enviar';
        btn.classList.remove('btn-danger', 'recording');
        btn.classList.add('btn-ok');
        btn.title = 'Enviar áudio';
    }
    setAnexoInfo('Áudio pronto — toque Enviar');
}

function toastAudio(msg) {
    const msgEl = document.getElementById('chat-msg');
    if (msgEl) {
        msgEl.textContent = msg;
        msgEl.className = 'msg erro';
    }
    if (typeof toastMsg === 'function') toastMsg(msg);
    setAnexoInfo(msg);
}

async function startRecording(fromHold) {
    if (!contatoAtivo || !contatoAtivo.auth_id) {
        toastAudio('Selecione um contato primeiro.');
        return;
    }
    if (!window.isSecureContext) {
        toastAudio('Microfone exige HTTPS. Use “Anexo” ou abra o site seguro.');
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        toastAudio('Gravação não suportada neste navegador. Use “Anexo”.');
        return;
    }
    if (gravando) return;
    audioCancelado = false;
    audioHoldMode = !!fromHold;
    try {
        // getUserMedia deve rodar no gesto do usuário (pointerdown), sem setTimeout
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        const mime = pickRecorderMime();
        mediaRecorder = mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size) audioChunks.push(ev.data);
        };
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            stopAudioTimer();
            showRecBar(false);
            gravando = false;
            if (audioCancelado) {
                audioChunks = [];
                resetAudioBtn();
                setAnexoInfo('');
                return;
            }
            const blobType = baseMime(mediaRecorder.mimeType) || baseMime(mime) || 'audio/webm';
            const blob = new Blob(audioChunks, { type: blobType });
            if (!blob.size) {
                resetAudioBtn();
                setAnexoInfo('Áudio vazio — tente de novo.');
                return;
            }
            onRecordingReady(blob);
        };
        // timeslice garante chunks em browsers que só emitem no stop com atraso
        try { mediaRecorder.start(250); } catch (eStart) { mediaRecorder.start(); }
        gravando = true;
        startAudioTimer();
        showRecBar(true);
        const btn = document.getElementById('btn-audio');
        if (btn) {
            btn.textContent = '⏹️ 0:00';
            btn.classList.add('btn-danger', 'recording');
        }
        setAnexoInfo(fromHold ? 'Gravando… solte p/ enviar · ← deslize p/ cancelar' : 'Gravando… toque de novo para parar');
        showMediaPreview(null);
    } catch (err) {
        console.warn(err);
        gravando = false;
        resetAudioBtn();
        const name = (err && err.name) || '';
        let msg = 'Não foi possível acessar o microfone.';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            msg = 'Permissão do microfone negada. Libere o mic nas configurações do navegador ou use “Anexo”.';
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            msg = 'Nenhum microfone encontrado. Use “Anexo”.';
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
            msg = 'Microfone em uso por outro app. Feche-o ou use “Anexo”.';
        } else if (err && err.message) {
            msg = 'Microfone: ' + err.message;
        }
        toastAudio(msg);
    }
}

function stopRecording(cancel) {
    if (cancel) {
        audioCancelado = true;
        audioAutoSend = false;
    } else {
        // Hold-to-send / stop → upload automático (evita bolha quebrada sem Enviar)
        audioAutoSend = true;
    }
    gravando = false;
    showRecBar(false);
    stopAudioTimer();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    } else if (cancel) {
        resetAudioBtn();
    }
}

/* ---- Adicionar contato modal ---- */
function abrirModalAdd() {
    const m = document.getElementById('modal-add-contato');
    if (m) m.classList.remove('oculto');
    const titulo = document.getElementById('modal-add-titulo');
    if (titulo) titulo.textContent = 'Adicionar por nome';
    const msg = document.getElementById('add-contato-msg');
    if (msg) { msg.textContent = ''; msg.className = 'msg'; }
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
    // Group by role for display
    if (!items.length) {
        box.innerHTML = '<p class="sub">Nenhum usuário encontrado. Busque por nome ou apelido.</p>';
        return;
    }

    const grouped = {};
    ROLE_GROUPS.forEach(g => { grouped[g.id] = []; });
    items.forEach(u => {
        const gid = rotuloGrupoPapel(u.papeis, u.tipo);
        (grouped[gid] || grouped.outros).push(u);
    });

    let html = '';
    ROLE_GROUPS.forEach(g => {
        const list = grouped[g.id] || [];
        if (!list.length) return;
        html += '<div class="chat-group"><div class="chat-group-title">' + esc(g.title) + '</div>';
        list.forEach(u => {
            const done = ja.has(u.auth_id);
            const nome = displayNome(u);
            html += '<div class="chat-dir-item">' +
                '<div><strong>' + esc(nome) + '</strong>' +
                (u.apelido && u.nome && u.apelido !== u.nome
                    ? '<div class="hint">' + esc(u.nome) + '</div>' : '') +
                '<div class="contact-role">' + esc(labelPapelCurto(u.papeis, u.tipo)) + '</div></div>' +
                (done
                    ? '<span class="badge">Já adicionado</span>'
                    : '<button type="button" class="btn-sm btn-add-dir" data-auth="' + esc(u.auth_id) + '">Adicionar</button>') +
                '</div>';
        });
        html += '</div>';
    });
    box.innerHTML = html;
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
        apelido: displayNome(user)
    }], { onConflict: 'auth_id,contato_auth_id' });
    if (error) {
        msg.textContent = 'Erro: ' + error.message + ' (SQL 18/22?)';
        msg.className = 'msg erro';
        return;
    }
    msg.textContent = 'Contato adicionado!';
    msg.className = 'msg ok';
    await carregarContatos(true);
    await abrirThread({
        auth_id: user.auth_id,
        nome: displayNome(user),
        papeis: user.papeis || [],
        tipo: user.tipo || '',
        apelido: displayNome(user)
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
    await pickMidiaArquivo(file, 'imagem');
});

document.getElementById('chat-video').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await pickMidiaArquivo(file, 'video');
});

document.getElementById('chat-audio-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await pickMidiaArquivo(file, 'audio');
});

(function bindAudioButton() {
    const btn = document.getElementById('btn-audio');
    if (!btn || btn._audioBound) return;
    btn._audioBound = true;
    let holdStarted = false;
    let pointerDown = false;
    let suppressClick = false;
    let downAt = 0;
    let startPromise = null;
    let downX = 0;
    let slidCancel = false;

    btn.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (anexoPendente && anexoPendente.tipo === 'audio' && !gravando) return;
        if (gravando) return;
        holdStarted = true;
        pointerDown = true;
        slidCancel = false;
        downAt = Date.now();
        downX = e.clientX;
        audioPointerId = e.pointerId;
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        // Inicia no gesto do usuário (não em setTimeout) — evita fallback silencioso ao file picker
        startPromise = startRecording(true).then(() => {
            if (!pointerDown && gravando && audioHoldMode) {
                // soltou antes do mic abrir: se foi toque curto, vira modo toggle
                if (Date.now() - downAt < 280) {
                    audioHoldMode = false;
                    setAnexoInfo('Gravando… toque de novo para parar');
                } else {
                    stopRecording(false);
                }
            }
        });
    });

    btn.addEventListener('pointermove', (e) => {
        if (!pointerDown || !holdStarted) return;
        if (audioPointerId != null && e.pointerId !== audioPointerId) return;
        // WA: slide left to cancel
        if (downX - e.clientX > 72) {
            slidCancel = true;
            if (gravando && audioHoldMode) {
                stopRecording(true);
                setAnexoInfo('Gravação cancelada');
            }
            pointerDown = false;
            holdStarted = false;
            suppressClick = true;
            audioPointerId = null;
        }
    });

    const endHold = (e) => {
        if (audioPointerId != null && e.pointerId !== audioPointerId && e.type !== 'pointercancel') return;
        const wasDown = pointerDown;
        pointerDown = false;
        if (!wasDown || !holdStarted || slidCancel) {
            holdStarted = false;
            audioPointerId = null;
            slidCancel = false;
            return;
        }
        const dur = Date.now() - downAt;
        suppressClick = true;
        if (gravando && audioHoldMode) {
            if (dur >= 280) {
                // release = send (WA hold-to-record)
                audioAutoSend = true;
                stopRecording(false);
            } else {
                // Toque curto: continua gravando até segundo toque (estilo toggle)
                audioHoldMode = false;
                setAnexoInfo('Gravando… toque de novo para parar');
            }
        }
        holdStarted = false;
        audioPointerId = null;
        try { e.preventDefault(); } catch (err) { /* ignore */ }
    };

    btn.addEventListener('pointerup', endHold);
    btn.addEventListener('pointercancel', () => {
        pointerDown = false;
        suppressClick = holdStarted;
        if (gravando && audioHoldMode) stopRecording(true);
        holdStarted = false;
        audioPointerId = null;
    });

    btn.addEventListener('click', async (e) => {
        if (suppressClick) {
            e.preventDefault();
            suppressClick = false;
            return;
        }
        if (anexoPendente && anexoPendente.tipo === 'audio' && anexoPendente.file && !gravando) {
            e.preventDefault();
            await enviarAnexoPendente();
            return;
        }
        if (gravando) {
            stopRecording(false);
            return;
        }
        // Clique sem pointerdown (teclado/acessibilidade)
        await startRecording(false);
    });
})();

const btnCancelRec = document.getElementById('btn-cancel-rec');
if (btnCancelRec) btnCancelRec.addEventListener('click', () => stopRecording(true));

document.getElementById('btn-toggle-agendar').addEventListener('click', () => {
    agendarAtivo = !agendarAtivo;
    const box = document.getElementById('chat-agendar-box');
    const btn = document.getElementById('btn-toggle-agendar');
    box.classList.toggle('oculto', !agendarAtivo);
    btn.classList.toggle('btn-ok', agendarAtivo);
    btn.textContent = agendarAtivo ? '🗓️ Agendar msg (ativo)' : '🗓️ Agendar msg';
});

document.getElementById('btn-add-contato').addEventListener('click', abrirModalAdd);
document.getElementById('btn-fechar-add').addEventListener('click', fecharModalAdd);
document.getElementById('modal-add-contato').addEventListener('click', (e) => {
    if (e.target && e.target.getAttribute('data-close-add') === '1') fecharModalAdd();
});

let buscaTimer = null;
document.getElementById('chat-busca-contatos').addEventListener('input', () => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => carregarContatos(true), 200);
});

let addBuscaTimer = null;
document.getElementById('add-busca').addEventListener('input', () => {
    clearTimeout(addBuscaTimer);
    addBuscaTimer = setTimeout(() => {
        carregarDiretorioAdd(document.getElementById('add-busca').value.trim());
    }, 300);
});

document.getElementById('btn-chat-back').addEventListener('click', () => {
    contatoAtivo = null;
    showThreadUI(false);
    carregarContatos(true);
});


(function bindImageEnlarge() {
    document.addEventListener('click', (e) => {
        const img = e.target && e.target.closest && e.target.closest('.bubble-media img');
        if (!img || img.closest('.bubble-media-loading')) return;
        let lb = document.getElementById('chat-lightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'chat-lightbox';
            lb.className = 'chat-lightbox oculto';
            lb.innerHTML = '<button type="button" class="chat-lightbox-close" aria-label="Fechar">×</button><img alt="">';
            document.body.appendChild(lb);
            lb.addEventListener('click', (ev) => {
                if (ev.target === lb || ev.target.classList.contains('chat-lightbox-close')) lb.classList.add('oculto');
            });
        }
        lb.querySelector('img').src = img.getAttribute('src');
        lb.classList.remove('oculto');
    });
})();


(function bindAudioPlaybackErrors() {
    document.addEventListener('error', (e) => {
        const el = e.target;
        if (!el || el.tagName !== 'AUDIO') return;
        const wrap = el.closest && el.closest('.bubble-audio');
        if (!wrap || wrap.querySelector('.audio-err')) return;
        const d = document.createElement('div');
        d.className = 'audio-err hint';
        d.textContent = 'Erro ao tocar áudio (URL privada/rede). Aplique SQL 27.';
        wrap.appendChild(d);
    }, true);
})();


/* ===== Ações de mensagem (responder / apagar / histórico) ===== */
let sheetMsg = null;
let longPressTimer = null;
let longPressStart = null;
const LONG_PRESS_MS = 400;

function setReplyTo(m) {
    replyToMsg = m || null;
    const bar = document.getElementById('chat-reply-bar');
    const snip = document.getElementById('chat-reply-snippet');
    if (!bar) return;
    if (!replyToMsg) {
        bar.classList.add('oculto');
        if (snip) snip.textContent = '';
        return;
    }
    if (snip) {
        const who = nomePublicoTexto(replyToMsg.de_nome, 'Mensagem');
        snip.textContent = who + ': ' + snippetMsg(replyToMsg);
    }
    bar.classList.remove('oculto');
    const input = document.getElementById('chat-texto');
    if (input) input.focus();
}

function fecharChatHeadMenu() {
    const menu = document.getElementById('chat-head-menu');
    if (menu) menu.classList.add('oculto');
}

function toggleChatHeadMenu() {
    const menu = document.getElementById('chat-head-menu');
    if (!menu) return;
    menu.classList.toggle('oculto');
}

function fecharMsgSheet() {
    const sheet = document.getElementById('chat-msg-sheet');
    if (sheet) sheet.classList.add('oculto');
    sheetMsg = null;
}

function abrirMsgSheet(m) {
    if (!m || !m.id || m._pending || m._loading) return;
    sheetMsg = m;
    const sheet = document.getElementById('chat-msg-sheet');
    const prev = document.getElementById('chat-msg-sheet-preview');
    const btnTodos = document.getElementById('sheet-apagar-todos');
    if (prev) prev.textContent = snippetMsg(m);
    if (btnTodos) {
        const souRemetente = m.de_auth_id === meuAuthId;
        btnTodos.classList.toggle('oculto', !souRemetente);
    }
    if (sheet) sheet.classList.remove('oculto');
}

function msgFromBubbleEl(el) {
    const bubble = el && el.closest ? el.closest('.bubble[data-msg-id]') : null;
    if (!bubble) return null;
    const id = Number(bubble.getAttribute('data-msg-id'));
    if (!id) return null;
    return threadMsgsById.get(id) || threadMsgsById.get(String(id)) || { id: id, de_auth_id: bubble.getAttribute('data-de-auth'), texto: (bubble.querySelector('.bubble-text') || {}).textContent || '' };
}

async function apagarMsgParaMim(m) {
    if (!m || !m.id) return;
    const { error } = await supabaseClient.rpc('chat_apagar_para_mim', { p_msg_id: Number(m.id) });
    if (error) {
        if (typeof toastMsg === 'function') toastMsg('Erro ao apagar: ' + error.message + ' (SQL 28?)');
        return;
    }
    fecharMsgSheet();
    await carregarThread(true);
    await carregarContatos(true);
}

async function apagarMsgParaTodos(m) {
    if (!m || !m.id) return;
    if (m.de_auth_id !== meuAuthId) return;
    if (!confirm('Apagar esta mensagem para todos?')) return;
    const { error } = await supabaseClient.rpc('chat_apagar_para_todos', { p_msg_id: Number(m.id) });
    if (error) {
        if (typeof toastMsg === 'function') toastMsg('Erro: ' + error.message + ' (SQL 28?)');
        return;
    }
    fecharMsgSheet();
    await carregarThread(true);
    await carregarContatos(true);
}

async function apagarConversaParaMim() {
    if (!contatoAtivo || !contatoAtivo.auth_id) return;
    fecharChatHeadMenu();
    if (!confirm('Apagar conversa para mim? As mensagens somem só do seu lado.')) return;
    const { error } = await supabaseClient.rpc('chat_ocultar_conversa', { p_outro: contatoAtivo.auth_id });
    if (error) {
        if (typeof toastMsg === 'function') toastMsg('Erro: ' + error.message + ' (SQL 28?)');
        return;
    }
    contatoAtivo = null;
    showThreadUI(false);
    await carregarContatos(true);
}

async function apagarHistoricoParaTodos() {
    if (!contatoAtivo || !contatoAtivo.auth_id) return;
    fecharChatHeadMenu();
    if (!confirm('Isso remove o histórico para os dois lados. Continuar?')) return;
    const { error } = await supabaseClient.rpc('chat_apagar_historico_para_todos', { p_outro: contatoAtivo.auth_id });
    if (error) {
        if (typeof toastMsg === 'function') toastMsg('Erro: ' + error.message + ' (SQL 28?)');
        return;
    }
    contatoAtivo = null;
    showThreadUI(false);
    await carregarContatos(true);
}

(function bindMsgActions() {
    const box = document.getElementById('chat-msgs');
    if (box) {
        const clearLp = () => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            longPressStart = null;
        };
        box.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const m = msgFromBubbleEl(e.target);
            if (!m || m.deleted_at) return;
            // não atrapalhar áudio/links/botões
            if (e.target.closest && e.target.closest('audio, video, a, button, input')) return;
            longPressStart = { x: e.clientX, y: e.clientY, m: m };
            longPressTimer = setTimeout(() => {
                if (longPressStart) abrirMsgSheet(longPressStart.m);
                clearLp();
            }, LONG_PRESS_MS);
        });
        box.addEventListener('pointermove', (e) => {
            if (!longPressStart) return;
            const dx = Math.abs(e.clientX - longPressStart.x);
            const dy = Math.abs(e.clientY - longPressStart.y);
            if (dx > 12 || dy > 12) clearLp();
        });
        box.addEventListener('pointerup', clearLp);
        box.addEventListener('pointercancel', clearLp);
        box.addEventListener('contextmenu', (e) => {
            const m = msgFromBubbleEl(e.target);
            if (!m || m.deleted_at) return;
            if (e.target.closest && e.target.closest('audio, video, a')) return;
            e.preventDefault();
            abrirMsgSheet(m);
        });
    }

    const sheet = document.getElementById('chat-msg-sheet');
    if (sheet) {
        sheet.addEventListener('click', (e) => {
            if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-sheet')) fecharMsgSheet();
        });
    }
    const btnResp = document.getElementById('sheet-responder');
    if (btnResp) btnResp.addEventListener('click', () => {
        if (sheetMsg) setReplyTo(sheetMsg);
        fecharMsgSheet();
    });
    const btnMim = document.getElementById('sheet-apagar-mim');
    if (btnMim) btnMim.addEventListener('click', () => apagarMsgParaMim(sheetMsg));
    const btnTodos = document.getElementById('sheet-apagar-todos');
    if (btnTodos) btnTodos.addEventListener('click', () => apagarMsgParaTodos(sheetMsg));

    const btnCancelReply = document.getElementById('btn-cancel-reply');
    if (btnCancelReply) btnCancelReply.addEventListener('click', () => setReplyTo(null));

    const btnMenu = document.getElementById('btn-chat-menu');
    if (btnMenu) btnMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChatHeadMenu();
    });
    const btnHistMim = document.getElementById('btn-apagar-hist-mim');
    if (btnHistMim) btnHistMim.addEventListener('click', () => apagarConversaParaMim());
    const btnHistTodos = document.getElementById('btn-apagar-hist-todos');
    if (btnHistTodos) btnHistTodos.addEventListener('click', () => apagarHistoricoParaTodos());

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('chat-head-menu');
        if (!menu || menu.classList.contains('oculto')) return;
        if (e.target.closest && (e.target.closest('#chat-head-menu') || e.target.closest('#btn-chat-menu'))) return;
        fecharChatHeadMenu();
    });
})();

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

    await carregarContatos(true);

    const para = lerParaQuery();
    if (para) {
        const perfis = await rpcPerfis([para]);
        const p = perfis[0] || { auth_id: para, nome: 'Contato', papeis: [], tipo: '' };
        await abrirThread({
            auth_id: p.auth_id || para,
            nome: displayNome(p),
            papeis: p.papeis || [],
            tipo: p.tipo || '',
            apelido: p.apelido || null
        });
    }

    // Prefill localização vinda do mapa (?lat=&lng=&label=)
    preencherLocalizacaoNoComposer(lerLocalizacaoQuery());

    pollTimer = setInterval(async () => {
        if (contatoAtivo) await carregarThread(false);
    }, 4000);
    contactsPollTimer = setInterval(() => carregarContatos(false), 12000);

    if (typeof window.MineraNotif !== 'undefined' && MineraNotif.start) {
        MineraNotif.start(meuAuthId);
    }
})();

window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
    if (contactsPollTimer) clearInterval(contactsPollTimer);
    stopAudioTimer();
});


/* ---- Keyboard-safe composer (visualViewport) — mobile WA feel ---- */
(function bindChatKeyboardSafe() {
    function measureComposer() {
        const form = document.getElementById('form-chat');
        if (!form || form.classList.contains('oculto')) return;
        const h = Math.ceil(form.getBoundingClientRect().height) || 58;
        document.documentElement.style.setProperty('--composer-h', h + 'px');
    }
    function syncKbInset() {
        const vv = window.visualViewport;
        if (!vv) {
            document.documentElement.style.setProperty('--kb-inset', '0px');
            return;
        }
        // Distance from layout bottom to visual viewport bottom (= keyboard overlap)
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        document.documentElement.style.setProperty('--kb-inset', inset + 'px');
        measureComposer();
        // Keep latest messages visible above composer
        const box = document.getElementById('chat-msgs');
        if (box && document.body.classList.contains('chat-thread-open') && inset > 40) {
            try { box.scrollTop = box.scrollHeight; } catch (e) { /* ignore */ }
        }
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncKbInset);
        window.visualViewport.addEventListener('scroll', syncKbInset);
    }
    window.addEventListener('resize', syncKbInset);
    window.addEventListener('orientationchange', () => setTimeout(syncKbInset, 120));
    document.addEventListener('focusin', (e) => {
        if (e.target && (e.target.id === 'chat-texto' || e.target.classList.contains('wa-comp-input'))) {
            setTimeout(syncKbInset, 50);
            setTimeout(syncKbInset, 300);
        }
    });
    document.addEventListener('focusout', () => setTimeout(syncKbInset, 50));
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { syncKbInset(); measureComposer(); });
    } else {
        syncKbInset();
        measureComposer();
    }
})();

