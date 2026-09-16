let perfilAtual = null;
let pollTimer = null;
let meuAuthId = null;
let loteCtx = null;
let anexoPendente = null; // { tipo, midia_url, nome }
let gravando = false;
let mediaRecorder = null;
let audioChunks = [];
let agendarAtivo = false;

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

async function uploadMidia(file, pasta) {
    if (!file) return null;
    // Tenta Storage; fallback data URL para imagens pequenas
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

async function carregarChat() {
    const box = document.getElementById('chat-msgs');
    try {
        let q = supabaseClient
            .from('chat_mensagens')
            .select('*')
            .order('criado_em', { ascending: true })
            .limit(250);
        const { data, error } = await q;
        if (error) throw error;
        let lista = (data || []).filter(m => !m.deleted_at && (m.moderacao || '') !== 'removida');
        await promoverAgendadas(lista);
        // Re-filter after promote (status may have changed in memory)
        if (!lista.length) {
            box.innerHTML = '<p class="sub">Nenhuma mensagem ainda. Diga oi!</p>';
            return;
        }
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
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Chat indisponível: ' + esc(err.message) +
            '. Rode o SQL 10-chat-pix-admin.sql no Supabase.</p>';
    }
}

async function enviarMensagem(opts) {
    opts = opts || {};
    const msgEl = document.getElementById('chat-msg');
    const input = document.getElementById('chat-texto');
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
        // URL mídia manual: bloquear links de contato externos (wa.me etc.) — data: ok
        if (urlManual && !urlManual.startsWith('data:')) {
            const chkU = AntiGolpe.validarTexto(urlManual);
            if (!chkU.ok || AntiGolpe.contemBloqueio(urlManual)) {
                // allow pure image CDN urls unless social/phone/email
                if (/wa\.me|t\.me|instagram|whatsapp|@|tel:/i.test(urlManual) ||
                    /@/.test(urlManual)) {
                    msgEl.textContent = AntiGolpe.MSG_BLOQUEIO;
                    msgEl.className = 'msg erro';
                    toastMsg(AntiGolpe.MSG_BLOQUEIO);
                    return;
                }
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
        para_auth_id: null,
        status,
        agendado_para
    };

    const { error } = await supabaseClient.from('chat_mensagens').insert([row]);
    if (error) {
        // Fallback se colunas novas ainda não existem
        if (/column|schema|tipo|midia/i.test(error.message || '')) {
            const { error: e2 } = await supabaseClient.from('chat_mensagens').insert([{
                de_auth_id: meuAuthId,
                de_nome: row.de_nome,
                texto: texto || (midia_url ? '[mídia] ' + midia_url : '')
            }]);
            if (e2) {
                msgEl.textContent = 'Erro: ' + e2.message + ' (rode SQL 10)';
                msgEl.className = 'msg erro';
                return;
            }
        } else {
            msgEl.textContent = 'Erro: ' + error.message;
            msgEl.className = 'msg erro';
            return;
        }
    }

    msgEl.textContent = status === 'agendada' ? 'Mensagem agendada!' : '';
    msgEl.className = status === 'agendada' ? 'msg ok' : 'msg';
    input.value = '';
    document.getElementById('chat-url-midia').value = '';
    anexoPendente = null;
    setAnexoInfo('');
    await carregarChat();
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
        // tenta data URL se pequeno
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
    await carregarChat();
    pollTimer = setInterval(carregarChat, 4000);
})();

window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
});
