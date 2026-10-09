/* Minera Pará — Chat (interface).
 * Dados/fila/cache: chat-store.js · Tempo real: chat-realtime.js · Mídia: chat-midia.js
 * Regras: conversa abre com as 40 mais recentes (antigas ao rolar p/ cima),
 * envio otimista com client_id + fila offline, ticks ⏱ ✓ ✓✓ ✓✓azul,
 * DOM incremental (nunca redesenha a conversa inteira por causa de 1 mensagem).
 */

let perfilAtual = null;
let meuAuthId = null;
let loteCtx = null;
/** Contato ativo: { auth_id, nome, papeis, tipo, apelido } — sem email. Global (nav.js/chat.html usam). */
let contatoAtivo = null;
let filtroListaChat = 'todas'; // todas | nao_lidas
let contatosCache = [];
let diretorioCache = [];
/** Mensagem sendo respondida: { id, texto, de_nome, tipo } | null */
let replyToMsg = null;
let agendarAtivo = false;
/** Áudio gravado em modo "toque" aguardando o botão Enviar */
let anexoPendente = null;

/* Estado da conversa aberta */
const T = {
    peer: null,
    gen: 0,                 // muda a cada troca de conversa (descarta respostas atrasadas)
    msgs: new Map(),        // id → mensagem do servidor
    minId: null,
    maxId: 0,
    temMais: false,
    carregandoAntigas: false,
    peerLida: 0,
    peerEntregue: 0,
    pertoDoFim: true,
    novasAbaixo: 0,
    ultimoSync: 0,
    lidoPend: null,
    online: false
};
/* Mensagens ainda não confirmadas pelo servidor (todas as conversas): client_id → item */
const pendentes = new Map();
let ultimoInboxPoll = 0;

const ROLE_GROUPS = [
    { id: 'minerador', title: 'Mineradores/Vendedores', match: ['minerador'] },
    { id: 'comprador', title: 'Compradores', match: ['comprador'] },
    { id: 'transportador', title: 'Transportadores', match: ['transportador', 'transportador_mina_britador', 'transportador_britador_porto'] },
    { id: 'carregamento', title: 'Carregadores', match: ['carregamento'] },
    { id: 'dono_britador', title: 'Donos de Britador', match: ['dono_britador'] },
    { id: 'outros', title: 'Outros', match: null }
];

window.__chatPerf = window.__chatPerf || {};

/* ============================ utilitários ============================ */
function $(id) { return document.getElementById(id); }
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function looksLikeEmail(s) { return /@/.test(String(s || '')); }
function stripEmailFields(u) {
    if (!u || typeof u !== 'object') return u;
    const out = Object.assign({}, u);
    delete out.email; delete out.Email; delete out.e_mail;
    if (looksLikeEmail(out.nome)) out.nome = '';
    if (looksLikeEmail(out.apelido)) out.apelido = '';
    return out;
}
function displayNome(u) {
    if (!u) return 'Contato';
    const ap = String(u.apelido || '').trim();
    const no = String(u.nome || '').trim();
    if (ap && !looksLikeEmail(ap)) return ap;
    if (no && !looksLikeEmail(no)) return no;
    return 'Contato';
}
function meuNomePublico() { return displayNome(perfilAtual) || 'Usuário'; }
function nomePublicoTexto(valor, fallback) {
    const s = String(valor || '').trim();
    return s && !looksLikeEmail(s) ? s : (fallback || 'Contato');
}
function toast(t) { if (typeof toastMsg === 'function') toastMsg(t); }
function msgErro(t) { const el = $('chat-msg'); if (el) { el.textContent = t || ''; el.className = t ? 'msg erro' : 'msg'; } }
function rotuloGrupoPapel(papeis, tipo) {
    const arr = (Array.isArray(papeis) ? papeis : []).map(p => String(p).toLowerCase());
    if (!arr.length && tipo) arr.push(String(tipo).toLowerCase());
    for (const g of ROLE_GROUPS) { if (g.match && g.match.some(m => arr.includes(m))) return g.id; }
    return 'outros';
}
function labelPapelCurto(papeis, tipo) {
    const labels = {
        minerador: 'Minerador', comprador: 'Comprador', transportador: 'Transportador',
        transportador_mina_britador: 'Transportador (Mina–Britador)', transportador_britador_porto: 'Transportador (Britador–Porto)',
        dono_britador: 'Dono de Britador', carregamento: 'Carregador', admin: 'Admin'
    };
    const arr = (Array.isArray(papeis) ? papeis : []).map(p => String(p).toLowerCase());
    if (!arr.length && tipo) return labels[String(tipo).toLowerCase()] || tipo;
    return arr.map(p => labels[p] || p).join(', ') || 'Outros';
}
function iniciais(n) {
    const parts = String(n || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function lerQuery(nome) { try { return (new URL(location.href).searchParams.get(nome) || '').trim(); } catch (e) { return ''; } }
function lerParaQuery() { return lerQuery('com') || lerQuery('para') || lerQuery('dm'); }
function ehAdminEu() { return typeof ehAdmin === 'function' && ehAdmin(perfilAtual); }
function visivel() { return document.visibilityState !== 'hidden'; }

function lerLocalizacaoQuery() {
    try {
        const u = new URL(location.href);
        const lat = parseFloat(u.searchParams.get('lat'));
        const lng = parseFloat(u.searchParams.get('lng'));
        const label = (u.searchParams.get('label') || '').trim();
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            try {
                const raw = sessionStorage.getItem('minera_share_loc');
                if (!raw) return null;
                const o = JSON.parse(raw);
                if (!o || !Number.isFinite(Number(o.lat)) || !Number.isFinite(Number(o.lng))) return null;
                if (o.ts && Date.now() - o.ts > 30 * 60 * 1000) return null;
                return { lat: Number(o.lat), lng: Number(o.lng), label: String(o.label || '').trim(), texto: String(o.texto || '').trim(), link: String(o.link || '') };
            } catch (e2) { return null; }
        }
        const link = 'https://maps.google.com/?q=' + encodeURIComponent(lat + ',' + lng);
        const texto = '📍 ' + (label || ('Local ' + lat.toFixed(5) + ', ' + lng.toFixed(5))) + '\n' +
            'Coords: ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '\n' + link;
        return { lat, lng, label, texto, link };
    } catch (e) { return null; }
}
function preencherLocalizacaoNoComposer(loc) {
    if (!loc) return;
    const input = $('chat-texto');
    if (input) {
        const texto = loc.texto || ('📍 ' + (loc.label || 'Localização') + '\n' + 'Coords: ' + Number(loc.lat).toFixed(6) + ', ' +
            Number(loc.lng).toFixed(6) + '\n' + (loc.link || ('https://maps.google.com/?q=' + loc.lat + ',' + loc.lng)));
        if (!input.value.trim()) input.value = texto;
        else if (input.value.indexOf('maps.google.com') === -1) input.value = input.value.trim() + '\n\n' + texto;
        autoCrescer();
    }
    const ctxEl = $('chat-lote-ctx');
    if (ctxEl && !loteCtx) {
        ctxEl.textContent = 'Localização pronta para enviar — escolha um contato se ainda não houver conversa.';
        ctxEl.classList.remove('oculto');
    }
    try { sessionStorage.removeItem('minera_share_loc'); } catch (e) { /* ignore */ }
}
function setAnexoInfo(txt) {
    const el = $('chat-anexo-info');
    if (!el) return;
    el.textContent = txt || '';
    el.classList.toggle('oculto', !txt);
}

/* ============================ bolhas ============================ */
function dayKey(iso) { if (!iso) return ''; const d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
function dayLabel(iso) {
    if (!iso) return '';
    const now = new Date();
    if (dayKey(iso) === dayKey(now.toISOString())) return 'Hoje';
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (dayKey(iso) === dayKey(y.toISOString())) return 'Ontem';
    return new Date(iso).toLocaleDateString('pt-BR');
}
function divDiaHtml(iso) { return '<div class="wa-day-div" data-dia="' + dayKey(iso) + '"><span>' + esc(dayLabel(iso)) + '</span></div>'; }
function snippetMsg(m) {
    if (!m) return '';
    if (m.deleted_at) return 'Mensagem apagada';
    const raw = (m.texto || '').trim();
    if (raw && m.tipo !== 'documento') return raw.slice(0, 120);
    if (m.tipo === 'audio') return '🎙️ Áudio';
    if (m.tipo === 'imagem') return '📷 Foto';
    if (m.tipo === 'video') return '🎬 Vídeo';
    if (m.tipo === 'documento') return '📄 ' + (raw || 'Documento');
    if (m.tipo && m.tipo !== 'text' && m.tipo !== 'agendada') return '[' + m.tipo + ']';
    return raw || '(sem texto)';
}
function ehGrupoPeer(p) { return /^g:/.test(String(p || '')); }
function peerDaRow(row) {
    if (!row) return null;
    if (row.grupo_id) return 'g:' + row.grupo_id;
    return row.de_auth_id === meuAuthId ? row.para_auth_id : row.de_auth_id;
}
function ehMinha(m) { return !!(m && m.de_auth_id && meuAuthId && String(m.de_auth_id) === String(meuAuthId)); }
function chaveMsg(m) { return m.id != null ? 'm' + m.id : 'c' + m.client_id; }

function urlSegura(u) { return typeof mineraSafeUrl === 'function' ? mineraSafeUrl(u) : (/^(https?:|blob:|data:image\/)/i.test(String(u || '')) ? String(u) : '#'); }
function renderMedia(m) {
    const tipo = String(m.tipo || 'text').toLowerCase();
    const local = m._localUrl || '';
    const pend = m.id == null;
    if (pend && local) {
        const ov = m._estado === 'falhou' ? '' : '<div class="media-upload-overlay">Enviando…</div>';
        if (tipo === 'imagem') return '<div class="bubble-media bubble-media-loading"><img src="' + esc(local) + '" alt="enviando">' + ov + '</div>';
        if (tipo === 'video') return '<div class="bubble-media bubble-media-loading"><video src="' + esc(local) + '" muted playsinline></video>' + ov + '</div>';
        if (tipo === 'audio') return '<div class="bubble-media bubble-audio bubble-media-loading">' + ChatAudio.playerHtml(local + (m.midia_frag || '')) + '</div>';
    }
    const url = m.midia_url ? urlSegura(m.midia_url) : m.midia_url;
    if (!url || url === '#') {
        if (pend && tipo === 'documento') return '<div class="bubble-media bubble-doc"><div class="bubble-doc-ico">📄</div><div class="bubble-doc-body"><strong>' + esc((m.texto || 'Documento').slice(0, 40)) + '</strong><span class="sub">enviando…</span></div></div>';
        return '';
    }
    if (tipo === 'imagem' || url.startsWith('data:image')) {
        return '<div class="bubble-media"><img src="' + esc(url) + '" alt="imagem" loading="lazy" decoding="async"></div>';
    }
    if (tipo === 'video') {
        const vsrc = /^blob:|#/.test(url) ? url : url + '#t=0.1'; // iOS: 1º quadro como miniatura (não fica preto)
        return '<div class="bubble-media"><video src="' + esc(vsrc) + '" controls playsinline webkit-playsinline preload="metadata"></video></div>';
    }
    if (tipo === 'audio') {
        const amime = ChatMidia.mimeFromMediaUrl(url);
        // WebM antigo no iPhone: o player converte na hora (audio-compat.js); "Baixar áudio" só aparece se falhar
        return '<div class="bubble-media bubble-audio">' + ChatAudio.playerHtml(url, { mime: amime }) + '</div>';
    }
    if (tipo === 'documento' || tipo === 'doc' || tipo === 'pdf' || /\.pdf($|\?)/i.test(url)) {
        const name = (m.texto || 'Documento.pdf').slice(0, 40);
        return '<div class="bubble-media bubble-doc"><div class="bubble-doc-ico">📄</div><div class="bubble-doc-body"><strong>' + esc(name) +
            '</strong><span class="sub">Documento · toque para abrir</span></div><a class="btn-sm" href="' + esc(urlSegura(url)) + '" target="_blank" rel="noopener">Abrir</a></div>';
    }
    return '<div class="bubble-media"><a href="' + esc(urlSegura(url)) + '" target="_blank" rel="noopener">Abrir mídia</a></div>';
}

/** Tick (só nas minhas): ⏱ pendente · ✓ enviada · ✓✓ entregue · ✓✓ azul lida · ⚠ falhou */
function tickHtml(m) {
    if (!ehMinha(m)) return '';
    if (m._estado === 'falhou') return '<span class="tk tk-falhou" aria-label="Não enviada">⚠</span>';
    if (m.id == null) return '<span class="tk tk-pend" aria-label="Enviando">⏱</span>';
    if ((m.status || '') === 'agendada') return '<span class="tk tk-ag" aria-label="Agendada">🗓</span>';
    if (m.deleted_at) return '';
    if (String(m.tipo || '') === 'sistema') return '';
    if (T.peerLida && Number(m.id) <= T.peerLida) return '<span class="tk tk-lida" aria-label="Lida">✓✓</span>';
    if (T.peerEntregue && Number(m.id) <= T.peerEntregue) return '<span class="tk tk-entregue" aria-label="Entregue">✓✓</span>';
    return '<span class="tk tk-env" aria-label="Enviada">✓</span>';
}

/** Registro de ligação de voz (SQL 63, tipo 'chamada'): pílula no meio; tocar = ligar de volta. */
function chamadaRotulo(m) {
    let t = String(m.texto || '').replace(/^\s*📞\s*/, '');
    if (ehMinha(m) && /perdida/.test(t)) t = t.replace('perdida', 'não atendida'); // quem ligou vê "não atendida"
    return t || 'Chamada de voz';
}
function bubbleChamadaHtml(m) {
    const iso = m.criado_em || m._criadoLocal;
    const hora = iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const perdida = /perdida|recusada/.test(String(m.texto || ''));
    const seta = ehMinha(m) ? '↗' : '↙';
    return '<div class="bubble bubble-chamada' + (perdida ? ' perdida' : '') + '" data-key="' + chaveMsg(m) + '" data-dia="' + dayKey(iso) + '"' +
        (m.id != null ? ' data-msg-id="' + m.id + '"' : '') + ' data-ligar="1" role="button" title="Ligar de volta">' +
        '<span class="bc-ic" aria-hidden="true">📞' + seta + '</span><span class="bc-t">' + esc(chamadaRotulo(m)) + '</span><span class="bc-h">' + esc(hora) + '</span></div>';
}
function ligarParaContato() {
    if (!contatoAtivo || !contatoAtivo.auth_id || ehGrupoPeer(contatoAtivo.auth_id)) return;
    if (document.body.classList.contains('chat-bloqueado')) { toast('Não é possível ligar nesta conversa.'); return; }
    if (!window.MineraChamada) return; // desligada neste ambiente (trava em chamada.js)
    window.MineraChamada.ligar({ auth_id: contatoAtivo.auth_id, nome: displayNome(contatoAtivo) });
}
function bubbleHtml(m) {
    if (String(m.tipo || '') === 'chamada' && !m.deleted_at) return bubbleChamadaHtml(m);
    if (String(m.tipo || '') === 'sistema') {
        const isoS = m.criado_em || m._criadoLocal;
        return '<div class="bubble bubble-sys" data-key="' + chaveMsg(m) + '" data-dia="' + dayKey(isoS) + '"' +
            (m.id != null ? ' data-msg-id="' + m.id + '"' : '') + '><span>' + esc(m.texto || '') + '</span></div>';
    }
    const mine = ehMinha(m);
    const deleted = !!m.deleted_at;
    const sched = (m.status || '') === 'agendada';
    const iso = m.criado_em || m._criadoLocal;
    const hora = iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    let quote = '';
    if (!deleted && m.resposta_a_id) {
        const o = T.msgs.get(Number(m.resposta_a_id));
        quote = '<div class="bubble-quote"><span class="bubble-quote-name">' + esc(o ? (ehMinha(o) ? 'Você' : nomePublicoTexto(o.de_nome, 'Mensagem')) : 'Mensagem') +
            '</span><span class="bubble-quote-text">' + esc(o ? snippetMsg(o) : 'Mensagem anterior') + '</span></div>';
    }
    const txtVisivel = m.texto && String(m.tipo) !== 'documento';
    const body = deleted
        ? '<div class="bubble-text bubble-deleted">🚫 Mensagem apagada</div>'
        : ((txtVisivel ? '<div class="bubble-text">' + esc((typeof AntiGolpe !== 'undefined' && !(AntiGolpe.contatosLiberados && AntiGolpe.contatosLiberados())) ? AntiGolpe.mascarar(m.texto) : m.texto) + '</div>' : '') + renderMedia(m));
    let extra = '';
    if (sched && m.agendado_para) extra += ' · agendada p/ ' + new Date(m.agendado_para).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (m.editado_em && !deleted) extra += ' · editada';
    if (m.moderacao && ehAdminEu()) extra += ' · 🚩 ' + esc(m.moderacao);
    if (ehAdminEu() && m.id != null) extra += ' · #' + m.id;
    const falhou = m._estado === 'falhou';
    const tipoB = String(m.tipo || '').toLowerCase();
    const soImg = !deleted && !txtVisivel && !quote && (tipoB === 'imagem' || String(m.midia_url || '').startsWith('data:image'));
    const soVid = !deleted && !txtVisivel && !quote && tipoB === 'video';
    const cls = 'bubble ' + (mine ? 'mine sent' : 'theirs') + (sched ? ' scheduled' : '') + (deleted ? ' deleted' : '') +
        (soImg ? ' bubble-img' : '') + (soVid ? ' bubble-vid' : '') + (!deleted && tipoB === 'audio' ? ' bubble-au' : '') +
        (m.id == null ? ' pending' : '') + (falhou ? ' bubble-failed' : '');
    const attrs = ' data-key="' + chaveMsg(m) + '" data-dia="' + dayKey(iso) + '"' +
        (m.id != null ? ' data-msg-id="' + m.id + '"' : ' data-cid="' + esc(m.client_id) + '"') +
        (m.de_auth_id ? ' data-de-auth="' + esc(m.de_auth_id) + '"' : '');
    return '<div class="' + cls + '"' + attrs + '>' +
        (mine ? '' : '<div class="bubble-meta">' + esc(nomePublicoTexto(m.de_nome, 'Alguém')) + '</div>') +
        quote + body +
        (falhou ? '<button type="button" class="bubble-retry" data-retry="' + esc(m.client_id) + '">↻ Não enviada — toque para reenviar</button>' : '') +
        '<div class="bubble-status"><span class="bubble-clock">' + hora + extra + '</span>' + tickHtml(m) + '</div></div>';
}
function elDeHtml(html) { const w = document.createElement('div'); w.innerHTML = html; return w.firstElementChild; }
function boxMsgs() { return $('chat-msgs'); }
function isNearBottom(box, th) { if (!box) return true; return (box.scrollHeight - box.scrollTop - box.clientHeight) <= (th == null ? 120 : th); }
function rolarFim(suave) {
    const box = boxMsgs(); if (!box) return;
    if (suave && box.scrollTo) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    else box.scrollTop = box.scrollHeight;
    T.pertoDoFim = true; T.novasAbaixo = 0; atualizarBotaoFim();
}
function ultimaBolha(box) { const l = box.querySelectorAll('.bubble'); return l.length ? l[l.length - 1] : null; }

/* ============================ conversa: render ============================ */
function renderConversaCompleta(lista, opts) {
    opts = opts || {};
    const box = boxMsgs(); if (!box) return;
    let html = '<div class="chat-topo" id="chat-topo">' + (T.temMais ? '<span class="chat-topo-load">Carregando anteriores…</span>' : '<span class="chat-topo-ini">🔒 Início da conversa</span>') + '</div>';
    let ultimo = null;
    const primeiroNaoLido = opts.primeiroNaoLido || null;
    lista.forEach(m => {
        const k = dayKey(m.criado_em);
        if (k && k !== ultimo) { ultimo = k; html += divDiaHtml(m.criado_em); }
        if (primeiroNaoLido && Number(m.id) === Number(primeiroNaoLido)) {
            html += '<div class="chat-naolidas-div" id="chat-naolidas-div"><span>' + opts.qtdNaoLidas + (opts.qtdNaoLidas === 1 ? ' mensagem não lida' : ' mensagens não lidas') + '</span></div>';
        }
        html += bubbleHtml(m);
    });
    // pendentes desta conversa (fila offline / enviando)
    let temPend = false;
    pendentes.forEach(it => { if (it.para === T.peer) { html += bubbleHtml(it); temPend = true; } });
    if (!lista.length && !temPend) html += '<p class="sub chat-vazio">Nenhuma mensagem ainda. Diga oi! 👋</p>';
    box.innerHTML = html;
}
function removerVazio(box) { const v = box.querySelector('.chat-vazio'); if (v) v.remove(); }

/** Acrescenta no fim (ou na posição certa, se for mais antiga que a última). */
function inserirBolha(m) {
    const box = boxMsgs(); if (!box) return null;
    removerVazio(box);
    const el = elDeHtml(bubbleHtml(m));
    const iso = m.criado_em || m._criadoLocal;
    if (m.id != null && Number(m.id) < T.maxId) {
        // chegou fora de ordem (ex.: agendada promovida) → antes da 1ª bolha com id maior
        const depois = Array.from(box.querySelectorAll('.bubble[data-msg-id]')).find(b => Number(b.getAttribute('data-msg-id')) > Number(m.id));
        if (depois) { box.insertBefore(el, depois); return el; }
    }
    const ult = ultimaBolha(box);
    const dia = dayKey(iso);
    if (dia && (!ult || ult.getAttribute('data-dia') !== dia)) box.appendChild(elDeHtml(divDiaHtml(iso)));
    box.appendChild(el);
    return el;
}
function trocarBolha(chave, m) {
    const box = boxMsgs(); if (!box) return null;
    const atual = box.querySelector('[data-key="' + chave + '"]');
    if (!atual) return null;
    const novo = elDeHtml(bubbleHtml(m));
    atual.replaceWith(novo);
    return novo;
}
function removerBolha(chave) {
    const box = boxMsgs(); if (!box) return;
    const el = box.querySelector('[data-key="' + chave + '"]');
    if (!el) return;
    const ant = el.previousElementSibling, prox = el.nextElementSibling;
    el.remove();
    if (ant && ant.classList.contains('wa-day-div') && (!prox || !prox.classList.contains('bubble'))) ant.remove(); // divisor órfão
}
function assinatura(m) {
    return [m.id, m.texto || '', m.tipo || '', m.midia_url || '', m.status || '', m.agendado_para || '', m.moderacao || '', m.deleted_at || '', m.editado_em || ''].join('|');
}
/** Só troca o tick das minhas bolhas (sem mexer no resto). */
function atualizarTicks() {
    const box = boxMsgs(); if (!box) return;
    box.querySelectorAll('.bubble.mine[data-msg-id]').forEach(b => {
        const m = T.msgs.get(Number(b.getAttribute('data-msg-id')));
        if (!m) return;
        const st = b.querySelector('.bubble-status');
        if (!st) return;
        const velho = st.querySelector('.tk');
        const novoHtml = tickHtml(m);
        if (velho && velho.outerHTML === novoHtml) return;
        if (velho) velho.remove();
        if (novoHtml) st.insertAdjacentHTML('beforeend', novoHtml);
    });
}

/* ============================ conversa: dados ============================ */
function registrarMsgs(lista) {
    lista.forEach(m => {
        T.msgs.set(Number(m.id), m);
        if (T.minId == null || Number(m.id) < T.minId) T.minId = Number(m.id);
        if (Number(m.id) > T.maxId) T.maxId = Number(m.id);
    });
}
function msgsOrdenadas() { return Array.from(T.msgs.values()).sort((a, b) => a.id - b.id); }
function salvarCacheConversa() { if (T.peer) ChatStore.cacheThreadGravar(T.peer, msgsOrdenadas()); }
let cacheConvT = null;
function salvarCacheConversaDepois() { clearTimeout(cacheConvT); cacheConvT = setTimeout(salvarCacheConversa, 800); }

function showThreadUI(show) {
    const empty = $('chat-thread-empty'), active = $('chat-thread-active'), pane = $('chat-wa');
    if (empty) empty.classList.toggle('oculto', show);
    if (active) active.classList.toggle('oculto', !show);
    if (pane) pane.classList.toggle('thread-open', !!show);
    document.body.classList.toggle('chat-thread-open', !!show);
}
function calcNaoLidas(lista, lidaAntes, naoLidasLista) {
    const recebidas = lista.filter(m => !ehMinha(m) && Number(m.id) > lidaAntes && !m.deleted_at && String(m.tipo || '') !== 'sistema');
    if (!recebidas.length || !(naoLidasLista > 0 || lidaAntes > 0)) return {};
    return { primeiroNaoLido: recebidas[0].id, qtdNaoLidas: recebidas.length };
}
function posicionarAoAbrir() {
    const box = boxMsgs(); if (!box) return;
    const div = $('chat-naolidas-div');
    if (div) box.scrollTop = Math.max(0, div.offsetTop - 60);
    else box.scrollTop = box.scrollHeight;
    T.pertoDoFim = isNearBottom(box);
    atualizarBotaoFim();
}
function atualizarTopo() {
    const topo = $('chat-topo'); if (!topo) return;
    topo.innerHTML = T.temMais ? '<span class="chat-topo-load">Carregando anteriores…</span>' : '<span class="chat-topo-ini">🔒 Início da conversa</span>';
}

async function abrirThread(contato, opts) {
    opts = opts || {};
    if (!contato || !contato.auth_id) return;
    const t0 = performance.now();
    const trocou = T.peer !== contato.auth_id;
    contatoAtivo = contato;
    T.gen++;
    const gen = T.gen;
    T.peer = contato.auth_id;
    T.msgs = new Map(); T.minId = null; T.maxId = 0; T.temMais = false; T.carregandoAntigas = false;
    T.peerLida = Number(contato.peerLida || 0); T.peerEntregue = Number(contato.peerEntregue || 0);
    T.novasAbaixo = 0; T.pertoDoFim = true; T.online = false;
    const ehG = ehGrupoPeer(contato.auth_id);
    T.grupoLinha = ehG ? (contato.membros ? contato.membros + ' participantes' : 'Grupo') : '';
    T.grupoMembros = null;
    setReplyTo(null);
    fecharChatHeadMenu();
    mostrarEstadoOutro(null);
    aplicarBloqueioUI(ehG ? null : Bloq.get(contato.auth_id));
    const pBloq = ehG ? Promise.resolve(null) : carregarBloqueio(contato.auth_id);
    document.body.classList.toggle('chat-grupo-aberto', ehG);
    showThreadUI(true);
    $('chat-com-nome').textContent = displayNome(contato);
    const avTopo = $('chat-com-av');
    if (ehG && avTopo) {
        avTopo.removeAttribute('data-av-id'); avTopo.removeAttribute('data-av-nome'); avTopo.classList.remove('mav-on', 'mav-empresa');
        avTopo.classList.add('wa-av-grupo');
        setTimeout(() => { if (T.peer === contato.auth_id) { avTopo.textContent = '👥'; avTopo._avChave = 'grupo'; } }, 0);
    } else if (avTopo) {
        avTopo.classList.remove('wa-av-grupo');
        if (window.MineraAvatar) MineraAvatar.marcar(avTopo, contato.auth_id, displayNome(contato));
    }
    // Voltar do Android/navegador fecha a conversa (volta p/ lista sem sair do chat)
    try {
        if (history.state && history.state.chatPeer) { if (trocou) history.replaceState({ chatPeer: contato.auth_id }, '', location.href); }
        else history.pushState({ chatPeer: contato.auth_id }, '', location.href);
    } catch (e) { /* ignore */ }
    marcarLinhaAtiva();

    const lidaAntes = ChatStore.leituraLocal(T.peer);
    const naoLidasLista = Number(contato.unread || 0);

    // 1) cache → pinta na hora
    const cache = ChatStore.cacheThreadLer(T.peer);
    if (cache && cache.m && cache.m.length) {
        const lista = ChatStore.filtrarVisiveis(cache.m);
        registrarMsgs(lista);
        T.temMais = true;
        renderConversaCompleta(lista, calcNaoLidas(lista, lidaAntes, naoLidasLista));
        posicionarAoAbrir();
        window.__chatPerf.threadCacheMs = Math.round(performance.now() - t0);
    } else {
        boxMsgs().innerHTML = '<div class="chat-topo"><span class="chat-topo-load">Carregando…</span></div>';
    }
    if (window.MineraRT && !ehG) MineraRT.joinDm(T.peer, mostrarEstadoOutro, (on) => { if (gen !== T.gen) return; T.online = !!on; mostrarEstadoOutro(null); }); // digitando/gravando/online
    else if (window.MineraRT) MineraRT.leaveDm();

    // 2) rede
    try {
        const [pg, leit] = await Promise.all([ChatStore.pagina(T.peer, null), ChatStore.leituraDoOutro(T.peer)]);
        if (gen !== T.gen) return;
        T.peerLida = Math.max(T.peerLida, leit.lida); T.peerEntregue = Math.max(T.peerEntregue, leit.entregue, leit.lida);
        if (ehG && leit.membros) aplicarMembrosGrupo(leit.membros);
        let mesmo = false;
        if (T.msgs.size && pg.msgs.length) {
            const ini = Number(pg.msgs[0].id);
            const janela = Array.from(T.msgs.keys()).filter(id => id >= ini);
            mesmo = janela.length === pg.msgs.length && pg.msgs.every(m => { const c = T.msgs.get(Number(m.id)); return c && assinatura(c) === assinatura(m); });
        }
        if (mesmo) {
            registrarMsgs(pg.msgs);
            T.temMais = pg.temMais;
            atualizarTopo();
            atualizarTicks();
        } else {
            T.msgs = new Map(); T.minId = null; T.maxId = 0;
            registrarMsgs(pg.msgs);
            T.temMais = pg.temMais;
            renderConversaCompleta(pg.msgs, calcNaoLidas(pg.msgs, lidaAntes, naoLidasLista));
            posicionarAoAbrir();
        }
        window.__chatPerf.threadRedeMs = Math.round(performance.now() - t0);
        T.ultimoSync = Date.now();
        salvarCacheConversa();
        marcarLidoSeVisivel();
        promoverMinhasAgendadas();
    } catch (err) {
        console.warn('abrir conversa', err);
        if (gen !== T.gen) return;
        if (!T.msgs.size) boxMsgs().innerHTML = '<p class="sub chat-vazio">Sem conexão. As mensagens aparecem quando a internet voltar.</p>';
    }
    try {
        const eB = await pBloq;
        if (gen === T.gen && eB) { aplicarBloqueioUI(eB); aplicarCorte(eB); }
    } catch (e) { /* ignore */ }
    // conversa reexibida (se estava "apagada para mim"). Amigo agora é escolha explícita (menu ⋮ → Adicionar amigo).
    if (!ehG) { try { await supabaseClient.rpc('chat_desocultar_conversa', { p_outro: contato.auth_id }); } catch (e) { /* SQL 28 opcional */ } }
    if (!contatosCache.some(c => c.auth_id === contato.auth_id)) agendarInbox(300);
}

/** Rolou até perto do topo → busca as 40 anteriores e mantém a posição (âncora). */
async function carregarAntigas() {
    if (!T.peer || !T.temMais || T.carregandoAntigas || T.minId == null) return;
    T.carregandoAntigas = true;
    const gen = T.gen;
    try {
        const pg = await ChatStore.pagina(T.peer, T.minId);
        if (gen !== T.gen) return;
        const box = boxMsgs();
        const novas = pg.msgs.filter(m => !T.msgs.has(Number(m.id)));
        registrarMsgs(novas);
        T.temMais = pg.temMais;
        if (novas.length) {
            const antesAltura = box.scrollHeight, antesTopo = box.scrollTop;
            let html = '', ultimo = null;
            novas.forEach(m => { const k = dayKey(m.criado_em); if (k !== ultimo) { ultimo = k; html += divDiaHtml(m.criado_em); } html += bubbleHtml(m); });
            const topo = $('chat-topo');
            const tmp = document.createElement('div'); tmp.innerHTML = html;
            const ref = topo ? topo.nextSibling : box.firstChild;
            Array.from(tmp.childNodes).forEach(n => box.insertBefore(n, ref));
            if (ref && ref.classList && ref.classList.contains('wa-day-div') && ref.getAttribute('data-dia') === ultimo) ref.remove(); // divisor duplicado na emenda
            box.scrollTop = antesTopo + (box.scrollHeight - antesAltura);
        }
        atualizarTopo();
    } catch (e) {
        console.warn('antigas', e);
    } finally {
        T.carregandoAntigas = false;
    }
}

/** Mensagem nova/alterada (tempo real, poll ou resposta do insert). */
function receberRow(row) {
    if (!row || row.id == null) return;
    const peer = peerDaRow(row);
    // confirma bolha otimista (mesmo client_id) — pode chegar pelo tempo real antes da resposta do insert
    if (row.client_id && pendentes.has(row.client_id)) confirmarPendente(pendentes.get(row.client_id), row);
    patchInboxComMsg(row, peer);
    if (row.grupo_id && String(row.tipo || '') === 'sistema') agendarInbox(300); // renomeou / entrou / saiu → nome e participantes
    if (!T.peer || peer !== T.peer) return;
    const visiveis = ChatStore.filtrarVisiveis([row]);
    const box = boxMsgs();
    const id = Number(row.id);
    if (!visiveis.length) {
        if (T.msgs.has(id)) { T.msgs.delete(id); removerBolha('m' + id); salvarCacheConversaDepois(); }
        return;
    }
    const velho = T.msgs.get(id);
    if (velho) {
        if (assinatura(velho) !== assinatura(row)) { T.msgs.set(id, row); trocarBolha('m' + id, row); salvarCacheConversaDepois(); }
        return;
    }
    if (T.minId != null && id < T.minId && T.temMais) return; // mais antiga que o carregado: vem ao rolar
    const estavaNoFim = isNearBottom(box);
    registrarMsgs([row]);
    inserirBolha(row);
    if (ehMinha(row) || estavaNoFim) rolarFim(false);
    else { T.novasAbaixo++; atualizarBotaoFim(); }
    if (!ehMinha(row)) { mostrarEstadoOutro(null); marcarLidoSeVisivel(); }
    salvarCacheConversaDepois();
}

/** Lido só quando a conversa está visível e chegou algo novo (o store ignora repetição). */
function marcarLidoSeVisivel() {
    if (!T.peer || !visivel() || !document.body.classList.contains('chat-thread-open')) return;
    let maxIn = 0;
    T.msgs.forEach(m => { if (!ehMinha(m) && Number(m.id) > maxIn) maxIn = Number(m.id); });
    if (!maxIn) return;
    clearTimeout(T.lidoPend);
    const peer = T.peer;
    T.lidoPend = setTimeout(() => {
        ChatStore.marcarLido(peer, maxIn);
        const c = contatosCache.find(x => x.auth_id === peer);
        if (c && c.unread) { c.unread = 0; renderLista(); }
    }, 250);
}

/** Reserva (sem tempo real) e ressincronização: busca as 40 mais recentes e aplica só a diferença. */
let syncando = false;
async function sincronizarConversa() {
    if (!T.peer || syncando) return;
    syncando = true;
    const gen = T.gen;
    try {
        const [pg, leit] = await Promise.all([ChatStore.pagina(T.peer, null), ChatStore.leituraDoOutro(T.peer)]);
        if (gen !== T.gen) return;
        T.ultimoSync = Date.now();
        const ids = new Set(pg.msgs.map(m => Number(m.id)));
        const menor = pg.msgs.length ? Number(pg.msgs[0].id) : Infinity;
        Array.from(T.msgs.keys()).forEach(id => { if (id >= menor && !ids.has(id)) { T.msgs.delete(id); removerBolha('m' + id); } }); // sumiram (apagada p/ mim / moderada)
        pg.msgs.forEach(m => receberRow(m));
        if (leit.membros && ehGrupoPeer(T.peer)) aplicarMembrosGrupo(leit.membros);
        if (leit.lida > T.peerLida || leit.entregue > T.peerEntregue) {
            T.peerLida = Math.max(T.peerLida, leit.lida); T.peerEntregue = Math.max(T.peerEntregue, leit.entregue, leit.lida);
            atualizarTicks();
        }
        promoverMinhasAgendadas();
    } catch (e) { /* offline: tenta no próximo ciclo */ } finally { syncando = false; }
}

/** Botão ↻ do topo: recarrega as mensagens da conversa aberta sem sair da tela (build 20261009u). */
let atualizandoManual = false, atualizarOkT = null;
async function atualizarConversaManual() {
    const btn = $('btn-chat-atualizar');
    if (!T.peer || atualizandoManual) return;
    atualizandoManual = true;
    clearTimeout(atualizarOkT);
    const rotulo = btn && btn.querySelector('.gk-refresh-ok');
    if (btn) { btn.classList.remove('ok', 'erro'); btn.classList.add('girando'); btn.setAttribute('aria-busy', 'true'); }
    const t0 = Date.now(), gen = T.gen, peer = T.peer;
    let ok = false;
    try { if (window.MineraRT && MineraRT.reconectar) MineraRT.reconectar(); } catch (e) { /* ignore */ }
    try {
        const [pg, leit] = await Promise.all([ChatStore.pagina(peer, null), ChatStore.leituraDoOutro(peer)]);
        if (gen !== T.gen) return;
        T.peerLida = Math.max(T.peerLida, leit.lida); T.peerEntregue = Math.max(T.peerEntregue, leit.entregue, leit.lida);
        if (leit.membros && ehGrupoPeer(peer)) aplicarMembrosGrupo(leit.membros);
        const box = boxMsgs();
        if (isNearBottom(box)) {
            // no fim da conversa (caso comum): redesenha tudo a partir do servidor
            T.msgs = new Map(); T.minId = null; T.maxId = 0;
            registrarMsgs(pg.msgs);
            T.temMais = pg.temMais;
            renderConversaCompleta(pg.msgs);
            rolarFim(false);
        } else {
            // lendo mensagens antigas: aplica só a diferença para não perder a posição
            const ids = new Set(pg.msgs.map(m => Number(m.id)));
            const menor = pg.msgs.length ? Number(pg.msgs[0].id) : Infinity;
            Array.from(T.msgs.keys()).forEach(id => { if (id >= menor && !ids.has(id)) { T.msgs.delete(id); removerBolha('m' + id); } });
            pg.msgs.forEach(m => receberRow(m));
            atualizarTicks();
        }
        T.ultimoSync = Date.now();
        salvarCacheConversa();
        marcarLidoSeVisivel();
        promoverMinhasAgendadas();
        ok = true;
    } catch (e) {
        console.warn('atualizar conversa', e);
    } finally {
        reenviarFila(); agendarInbox(200);
        const espera = Math.max(0, 600 - (Date.now() - t0)); // giro visível mesmo com rede rápida
        setTimeout(() => {
            atualizandoManual = false;
            if (!btn) return;
            btn.classList.remove('girando'); btn.removeAttribute('aria-busy');
            if (gen !== T.gen) return;
            if (rotulo) rotulo.textContent = ok ? 'Atualizado' : 'Sem conexão';
            btn.classList.add(ok ? 'ok' : 'erro');
            if (!ok) toast('Sem conexão. Tente de novo quando a internet voltar.');
            atualizarOkT = setTimeout(() => btn.classList.remove('ok', 'erro'), 1600);
        }, espera);
    }
}

/* Agendadas: quem enviou promove quando vence (comportamento existente) */
let agendaT = null;
async function promoverMinhasAgendadas() {
    clearTimeout(agendaT);
    const agora = Date.now();
    let proxima = Infinity;
    const vencidas = [];
    T.msgs.forEach(m => {
        if (!ehMinha(m) || (m.status || '') !== 'agendada' || m.deleted_at || !m.agendado_para) return;
        const t = new Date(m.agendado_para).getTime();
        if (t <= agora) vencidas.push(m); else proxima = Math.min(proxima, t);
    });
    for (const m of vencidas) {
        try {
            const { error } = await supabaseClient.from('chat_mensagens').update({ status: 'enviada' }).eq('id', m.id);
            if (!error) { const n = Object.assign({}, m, { status: 'enviada' }); T.msgs.set(Number(m.id), n); trocarBolha('m' + m.id, n); }
        } catch (e) { /* ignore */ }
    }
    if (proxima < Infinity) agendaT = setTimeout(promoverMinhasAgendadas, Math.min(proxima - agora + 500, 2147483000));
}

/* ============================ digitando / gravando ============================ */
let estadoOutroT = null;
function mostrarEstadoOutro(p) {
    const el = $('chat-com-status');
    clearTimeout(estadoOutroT);
    const txt = p && p.estado === 'digitando' ? 'digitando…' : (p && p.estado === 'gravando' ? 'gravando áudio…' : '');
    const linha = txt || (ehGrupoPeer(T.peer) ? (T.grupoLinha || '') : (T.online ? 'online' : ''));
    if (el) { el.textContent = linha; el.hidden = !linha; el.classList.toggle('ativo', !!txt); }
    const dot = $('chat-com-online'); if (dot) dot.classList.toggle('oculto', !T.online);
    const row = T.peer && document.querySelector('#chat-contatos-list .wa-row[data-auth="' + CSS.escape(T.peer) + '"] .wa-row-prev');
    if (row) row.classList.toggle('digitando', !!txt);
    if (txt) estadoOutroT = setTimeout(() => mostrarEstadoOutro(null), 6000);
}
let digitandoEnviadoEm = 0, digitandoParouT = null;
function avisarDigitando() {
    if (!window.MineraRT || !T.peer) return;
    const v = ($('chat-texto') || {}).value || '';
    clearTimeout(digitandoParouT);
    if (!v.trim()) { pararDigitando(); return; }
    if (Date.now() - digitandoEnviadoEm > 3000) { if (MineraRT.sendEstado('digitando')) digitandoEnviadoEm = Date.now(); }
    digitandoParouT = setTimeout(pararDigitando, 4000);
}
function pararDigitando() {
    clearTimeout(digitandoParouT);
    if (digitandoEnviadoEm && window.MineraRT) MineraRT.sendEstado('parou');
    digitandoEnviadoEm = 0;
}

/* ============================ envio (otimista + fila) ============================ */
function novoItem(campos) {
    return Object.assign({
        client_id: ChatStore.uuid(),
        para: T.peer,
        de_auth_id: meuAuthId,
        de_nome: meuNomePublico(),
        texto: '',
        tipo: 'text',
        midia_url: null,
        status: 'enviada',
        agendado_para: null,
        resposta_a_id: replyToMsg && replyToMsg.id ? Number(replyToMsg.id) : null,
        _criadoLocal: null,
        _estado: 'pendente',
        tentativas: 0
    }, campos || {});
}
function novoItemFinal(it) { it._criadoLocal = it.criado_local = new Date().toISOString(); return it; }
/** Mostra a bolha na hora (antes de qualquer rede) e dispara o envio em 2º plano. */
function enfileirar(item) {
    if (!item._criadoLocal) novoItemFinal(item);
    pendentes.set(item.client_id, item);
    if (!item._file) ChatStore.outboxPut(item); // mídia só entra na fila persistida depois do upload
    if (item.para === T.peer) {
        inserirBolha(item);
        const div = $('chat-naolidas-div'); if (div) div.remove();
        rolarFim(false);
    }
    patchInboxComMsg(Object.assign({}, item, { id: null, criado_em: item._criadoLocal }), item.para);
    processarItem(item);
}
function atualizarBolhaPendente(item) {
    if (item.para !== T.peer) return;
    if (!trocarBolha('c' + item.client_id, item)) inserirBolha(item);
}
function confirmarPendente(item, row) {
    pendentes.delete(item.client_id);
    ChatStore.outboxDel(item.client_id);
    if (item._localUrl && /^blob:/.test(item._localUrl)) setTimeout(() => { try { URL.revokeObjectURL(item._localUrl); } catch (e) { /* ignore */ } }, 20000);
    if (item.para !== T.peer) return;
    const id = Number(row.id);
    const jaTem = T.msgs.has(id);
    registrarMsgs([row]);
    if (jaTem) removerBolha('c' + item.client_id); // o poll já tinha trazido
    else if (!trocarBolha('c' + item.client_id, row)) inserirBolha(row);
    salvarCacheConversaDepois();
}

async function processarItem(item) {
    if (item._enviando) return;
    item._enviando = true;
    try {
        if (item._file && !item.midia_url) {
            try {
                let f = item._file;
                if (item.tipo === 'audio' && window.AudioCompat) {
                    // WebM/Opus (Android/Chrome) → MP3: toca no iPhone também. Falhou → original.
                    const dm = /[#&]d=([\d.]+)/.exec(item.midia_frag || '');
                    f = await AudioCompat.paraUniversal(f, dm ? Number(dm[1]) : 0);
                }
                if (item.tipo === 'imagem') {
                    const c = await ChatMidia.comprimirImagem(f, 1600, 0.8);
                    f = c.file;
                    window.__chatPerf.ultimaCompressao = { antes: c.antes, depois: c.depois, w: c.w, h: c.h };
                }
                item.midia_url = (await ChatMidia.upload(f, ChatMidia.pastaPara(item.tipo), meuAuthId)) + (item.midia_frag || '');
                item._file = null;
                ChatStore.outboxPut(item);
            } catch (e) {
                const rede = !navigator.onLine || ChatStore.ehErroRede(e) || /fetch|network/i.test(String(e && e.message));
                item._estado = rede ? 'pendente' : 'falhou';
                item.erro = (e && e.message) || 'Falha no upload';
                if (rede) agendarRetry();
                else { atualizarBolhaPendente(item); toast('Não foi possível enviar a mídia. Toque em ↻ para tentar de novo.'); }
                return;
            }
        }
        item.tentativas = (item.tentativas || 0) + 1;
        const r = await ChatStore.inserir(item);
        if (r.ok) {
            item._estado = 'ok';
            confirmarPendente(item, r.row);
            receberRow(r.row);
            if (item.tentativas === 1 && !ehGrupoPeer(item.para)) { try { supabaseClient.rpc('chat_desocultar_conversa', { p_outro: item.para }).then(() => {}, () => {}); } catch (e) { /* ignore */ } }
        } else if (r.rede) {
            item._estado = 'pendente';
            ChatStore.outboxPut(item);
            agendarRetry();
        } else if (ehErroBloqueio(r.erro)) {
            item._estado = 'falhou';
            item.erro = 'bloqueado';
            ChatStore.outboxDel(item.client_id);
            atualizarBolhaPendente(item);
            const eu = /desbloqueie/i.test((r.erro && r.erro.message) || '') || /eu_bloqueei/.test((r.erro && r.erro.hint) || '');
            toast(eu ? 'Você bloqueou este usuário. Desbloqueie para enviar.' : 'Não é possível enviar mensagens para este usuário.');
            if (item.para === T.peer) aplicarBloqueioUI(Object.assign({}, Bloq.get(T.peer) || {}, eu ? { eu_bloqueei: true } : { me_bloqueou: true }));
        } else {
            item._estado = 'falhou';
            item.erro = (r.erro && r.erro.message) || 'Erro';
            ChatStore.outboxPut(item);
            atualizarBolhaPendente(item);
            toast('Mensagem não enviada: ' + item.erro);
        }
    } finally {
        item._enviando = false;
    }
}
let retryT = null, retryN = 0, processando = false;
function agendarRetry() {
    if (retryT) return;
    const ms = Math.min(30000, 2000 * Math.pow(2, Math.min(retryN, 4)));
    retryN++;
    retryT = setTimeout(() => { retryT = null; reenviarFila(); }, ms);
}
/** Reenvia o que está pendente (online / foco / tempo real reconectou / backoff). */
async function reenviarFila() {
    if (processando || !meuAuthId) return;
    processando = true;
    try {
        ChatStore.outboxLer().forEach(o => { // itens de sessões anteriores
            if (!pendentes.has(o.client_id)) {
                const it = Object.assign({}, o);
                it._estado = 'pendente'; it._enviando = false;
                it._criadoLocal = o.criado_local || new Date().toISOString();
                pendentes.set(it.client_id, it);
                if (it.para === T.peer) inserirBolha(it);
            }
        });
        const fila = Array.from(pendentes.values()).filter(it => it._estado === 'pendente')
            .sort((a, b) => String(a._criadoLocal).localeCompare(String(b._criadoLocal)));
        for (const it of fila) {
            if (!navigator.onLine) { agendarRetry(); break; }
            await processarItem(it);
        }
        if (!Array.from(pendentes.values()).some(it => it._estado === 'pendente')) retryN = 0;
    } finally { processando = false; }
}
function reenviarUm(cid) {
    const it = pendentes.get(cid);
    if (!it) return;
    it._estado = 'pendente';
    atualizarBolhaPendente(it);
    processarItem(it);
}

async function enviarMensagem(opts) {
    opts = opts || {};
    const input = $('chat-texto');
    if (!contatoAtivo || !contatoAtivo.auth_id) { msgErro('Selecione um contato primeiro.'); return false; }
    let texto = String(opts.texto != null ? opts.texto : (input ? input.value : '')).replace(/\s+$/, '').replace(/^\s*\n/, '');
    if (!texto.trim()) return false; // toque duplo / vazio: ignora em silêncio
    if (loteCtx && !texto.includes(loteCtx)) texto = '[Lote ' + loteCtx + '] ' + texto;
    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Chat')) { msgErro('Conta bloqueada — pague a comissão no Perfil.'); return false; }
    if (typeof AntiGolpe !== 'undefined') {
        // Flag do admin: contatos de fora liberados (lançamento) ou trancados
        if (AntiGolpe.carregarFlagContatos) await AntiGolpe.carregarFlagContatos(false); // cache 20 s (não atrasa o envio)
        if (!(AntiGolpe.contatosLiberados && AntiGolpe.contatosLiberados())) {
            const chk = AntiGolpe.validarTexto(texto);
            if (!chk.ok) { const m = AntiGolpe.MSG_TRANCADO || chk.motivo; msgErro(m); toast(m); return false; }
        }
    }
    let status = 'enviada', agendado_para = null, tipo = 'text';
    if (agendarAtivo) {
        const dt = ($('chat-agendar-em') || {}).value;
        if (!dt) { msgErro('Escolha data/hora para agendar.'); return false; }
        const quando = new Date(dt);
        if (quando.getTime() > Date.now()) { status = 'agendada'; agendado_para = quando.toISOString(); tipo = 'agendada'; }
    }
    const t0 = performance.now();
    if (input && opts.texto == null) { input.value = ''; autoCrescer(); } // limpa JÁ: 2º toque encontra o campo vazio
    msgErro('');
    const item = novoItem({ texto, tipo, status, agendado_para });
    setReplyTo(null, true);
    pararDigitando();
    if (agendarAtivo && status === 'agendada') { toggleAgendar(false); toast('Mensagem agendada!'); }
    enfileirar(item);
    window.__chatPerf.envioBolhaMs = Math.round((performance.now() - t0) * 10) / 10;
    return true;
}

/** Foto / vídeo / áudio / documento: bolha com prévia local na hora; comprime + sobe em 2º plano. */
function enviarMidia(tipo, file) {
    if (!contatoAtivo || !contatoAtivo.auth_id) { toast('Abra uma conversa primeiro.'); return; }
    if (!file) return;
    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Chat')) return;
    const max = tipo === 'video' ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > max) { toast('Arquivo grande demais (máx. ' + Math.round(max / 1048576) + ' MB).'); return; }
    let localUrl = null;
    try { if (tipo !== 'documento') localUrl = URL.createObjectURL(file); } catch (e) { /* ignore */ }
    const item = novoItem({ tipo, texto: tipo === 'documento' ? String(file.name || 'Documento').slice(0, 80) : '', _file: file, _localUrl: localUrl });
    setReplyTo(null, true);
    enfileirar(item);
}

/* ============================ lista de conversas ============================ */
function timeRight(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function previewLinha(c) {
    if (!c.last) return { txt: 'Toque para conversar', tick: '' };
    const l = c.last;
    const minha = l.de_auth_id === meuAuthId;
    const txt = l.deleted_at ? '🚫 Mensagem apagada' : snippetMsg(l);
    let tick = '';
    if (minha && !l.deleted_at) {
        if (l.id == null) tick = '<span class="tk tk-pend">⏱</span>';
        else if (c.peerLida && l.id <= c.peerLida) tick = '<span class="tk tk-lida">✓✓</span>';
        else if (c.peerEntregue && l.id <= c.peerEntregue) tick = '<span class="tk tk-entregue">✓✓</span>';
        else tick = '<span class="tk tk-env">✓</span>';
    }
    let quem = minha ? 'Você: ' : '';
    if (!minha && c.ehGrupo && l.de_nome && String(l.tipo || '') !== 'sistema') quem = nomePublicoTexto(l.de_nome, 'Alguém') + ': ';
    if (String(l.tipo || '') === 'sistema') { quem = ''; tick = ''; }
    return { txt: quem + txt, tick };
}
function linhaHtml(c) {
    const p = previewLinha(c);
    const badge = c.unread ? '<span class="wa-unread">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '';
    const av = c.ehGrupo ? '<div class="wa-av wa-av-grupo" aria-hidden="true">👥</div>'
        : '<div class="wa-av mav" data-av-id="' + esc(c.auth_id) + '" data-av-nome="' + esc(c.nome) + '">' + esc(iniciais(c.nome)) + '</div>';
    return av +
        '<div class="wa-row-mid"><div class="wa-row-name">' + esc(c.nome) + '</div>' +
        '<div class="wa-row-prev">' + p.tick + '<span class="wa-row-prev-txt">' + esc(p.txt.slice(0, 80)) + '</span><span class="wa-row-typing">digitando…</span></div></div>' +
        '<div class="wa-row-right"><span class="wa-row-time' + (c.unread ? ' on' : '') + '">' + esc(timeRight(c.last && c.last.criado_em)) + '</span>' + badge + '</div>';
}
function filtrarLista() {
    const busca = (($('chat-busca-contatos') || {}).value || '').trim().toLowerCase();
    return contatosCache.filter(c => {
        if (filtroListaChat === 'nao_lidas' && !(c.unread > 0)) return false;
        if (!busca) return true;
        return (c.nome || '').toLowerCase().includes(busca) || (c.apelido || '').toLowerCase().includes(busca) ||
            (c.nomeReal || '').toLowerCase().includes(busca) || labelPapelCurto(c.papeis, c.tipo).toLowerCase().includes(busca);
    });
}
/** Reconciliação por linha (não recria a lista toda). Ordem = recência (nunca agrupa por papel). */
function renderLista() {
    atualizarBackUnread();
    const box = $('chat-contatos-list'); if (!box) return;
    const lista = filtrarLista();
    if (!lista.length) {
        box.innerHTML = '<div class="chat-contacts-empty"><p><strong>' + (contatosCache.length ? 'Nada encontrado' : 'Nenhuma conversa ainda') + '</strong></p>' +
            '<p class="sub">Toque em <strong>＋</strong> para achar alguém por nome ou apelido.</p></div>';
        return;
    }
    Array.from(box.children).forEach(el => { if (!el.classList.contains('wa-row')) el.remove(); });
    const existentes = new Map();
    box.querySelectorAll('.wa-row[data-auth]').forEach(el => existentes.set(el.getAttribute('data-auth'), el));
    const manter = new Set();
    let anterior = null;
    lista.forEach(c => {
        manter.add(c.auth_id);
        const html = linhaHtml(c);
        let el = existentes.get(c.auth_id);
        if (!el) {
            el = document.createElement('button');
            el.type = 'button';
            el.className = 'wa-row chat-contact-item';
            el.setAttribute('data-auth', c.auth_id);
            el.innerHTML = html; el._sig = html;
        } else if (el._sig !== html) { el.innerHTML = html; el._sig = html; }
        el.classList.toggle('on', !!(contatoAtivo && contatoAtivo.auth_id === c.auth_id));
        const alvo = anterior ? anterior.nextSibling : box.firstChild;
        if (alvo !== el) box.insertBefore(el, alvo);
        anterior = el;
    });
    existentes.forEach((el, id) => { if (!manter.has(id)) el.remove(); });
}
function marcarLinhaAtiva() {
    document.querySelectorAll('#chat-contatos-list .wa-row').forEach(el => el.classList.toggle('on', !!(contatoAtivo && el.getAttribute('data-auth') === contatoAtivo.auth_id)));
}
let inboxT = null, inboxEmCurso = false, inboxDeNovo = false, gruposAssinados = null;
function agendarInbox(ms) { clearTimeout(inboxT); inboxT = setTimeout(atualizarInbox, ms == null ? 400 : ms); }
async function atualizarInbox() {
    if (!meuAuthId) return;
    if (inboxEmCurso) { inboxDeNovo = true; return; }
    inboxEmCurso = true;
    ultimoInboxPoll = Date.now();
    try {
        const t0 = performance.now();
        const lista = await ChatStore.inbox();
        const abertaVisivel = visivel() && document.body.classList.contains('chat-thread-open');
        lista.forEach(c => { if (T.peer === c.auth_id && abertaVisivel) c.unread = 0; });
        // preserva prévia otimista (mensagem ainda na fila)
        pendentes.forEach(it => {
            const c = lista.find(x => x.auth_id === it.para);
            if (c && (!c.last || String(c.last.criado_em) < it._criadoLocal)) c.last = { id: null, de_auth_id: meuAuthId, texto: it.texto, tipo: it.tipo, criado_em: it._criadoLocal };
        });
        contatosCache = lista;
        ChatStore.cacheInboxGravar(lista);
        renderLista();
        // entrou/saiu de grupo (ex.: alguém me adicionou) → reassina o tempo real dos grupos
        const gk = lista.filter(c => c.ehGrupo).map(c => c.auth_id).sort().join(',');
        if (gk !== gruposAssinados) { const antes = gruposAssinados; gruposAssinados = gk; if (antes !== null && window.MineraRT && MineraRT.atualizarGrupos) MineraRT.atualizarGrupos(); }
        if (!window.__chatPerf.inboxRedeMs) window.__chatPerf.inboxRedeMs = Math.round(performance.now() - t0);
        window.__chatPerf.inboxModo = ChatStore.temV44() ? 'rpc' : 'legado';
        const ativo = T.peer && lista.find(c => c.auth_id === T.peer);
        if (ativo && ativo.ehGrupo && contatoAtivo && contatoAtivo.auth_id === T.peer) {
            if (ativo.nome !== contatoAtivo.nome) { contatoAtivo.nome = ativo.nome; const hn = $('chat-com-nome'); if (hn) hn.textContent = ativo.nome; }
            if (ativo.membros && Array.isArray(T.grupoMembros) && ativo.membros !== T.grupoMembros.length) ChatStore.grupoMembros(T.peer).then(aplicarMembrosGrupo, () => {});
        }
        if (ativo && (ativo.peerLida > T.peerLida || ativo.peerEntregue > T.peerEntregue)) {
            T.peerLida = Math.max(T.peerLida, ativo.peerLida || 0); T.peerEntregue = Math.max(T.peerEntregue, ativo.peerEntregue || 0);
            atualizarTicks();
        }
    } catch (err) {
        console.warn('lista de conversas', err);
        const box = $('chat-contatos-list');
        if (!contatosCache.length && box && !box.querySelector('.wa-row')) {
            box.innerHTML = '<div class="chat-contacts-empty"><p><strong>Sem conexão</strong></p><p class="sub">A lista aparece quando a internet voltar.</p></div>';
        }
    } finally {
        inboxEmCurso = false;
        if (inboxDeNovo) { inboxDeNovo = false; agendarInbox(300); }
    }
}
/** Atualiza a linha do contato na hora (tempo real/envio) e sobe para o topo. */
function patchInboxComMsg(row, peer) {
    if (!peer) return;
    const c = contatosCache.find(x => x.auth_id === peer);
    if (!c) { agendarInbox(500); return; }
    const visiveis = row.id == null ? [row] : ChatStore.filtrarVisiveis([row]);
    if (!visiveis.length) { agendarInbox(800); return; }
    const novo = !c.last || row.id == null || c.last.id == null || Number(row.id) >= Number(c.last.id);
    if (!novo) return;
    const eraNova = row.id != null && (!c.last || c.last.id == null || Number(row.id) > Number(c.last.id));
    c.last = { id: row.id, de_auth_id: row.de_auth_id, de_nome: row.de_nome, texto: row.deleted_at ? '' : row.texto, tipo: row.tipo, criado_em: row.criado_em || row._criadoLocal, deleted_at: row.deleted_at };
    const abertaVisivel = T.peer === peer && visivel() && document.body.classList.contains('chat-thread-open');
    if (eraNova && row.de_auth_id !== meuAuthId && !abertaVisivel && (row.status || '') !== 'agendada' && String(row.tipo || '') !== 'sistema') c.unread = (c.unread || 0) + 1;
    contatosCache = [c].concat(contatosCache.filter(x => x !== c));
    renderLista();
    ChatStore.cacheInboxGravar(contatosCache);
}
function aplicarFiltroListaChat(filtro) {
    filtroListaChat = filtro === 'nao_lidas' ? 'nao_lidas' : 'todas';
    renderLista();
}
window.aplicarFiltroListaChat = aplicarFiltroListaChat;
function carregarContatos() { return atualizarInbox(); } // compat

/* ============================ composer ============================ */
function autoCrescer() {
    const t = $('chat-texto'); if (!t || t.tagName !== 'TEXTAREA') return;
    const f = $('form-chat'); if (f) f.classList.toggle('tem-texto', !!t.value.trim()); // mic ↔ enviar
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}
function tecladoMobile() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }

/* ============================ áudio estilo WhatsApp ============================ */
// Segurar = grava enquanto segura (solta envia; deslize ← ou "Cancelar" descarta).
// Segurar e arrastar ↑ = trava (barra com Cancelar e ➤ enviar). Nunca trava sozinho.
// 20261009u: o microfone fica aberto SÓ durante a gravação e é solto na hora (enviar, cancelar,
// erro, sair da conversa/tela) — sem indicador laranja do iPhone depois do envio.
// Onda ao vivo pelo nível do microfone (ChatAudio.visualizar); os níveis viram os picos da mensagem.
let gravando = false, mediaRecorder = null, audioChunks = [], audioTimerInterval = null, audioSeconds = 0;
let iniciandoGravacao = false;
let audioCancelado = false, audioHoldMode = false, audioPointerId = null, audioAutoSend = false, audioRecStartedAt = 0;
let audioVis = null, audioPicos = null, audioStream = null;
function formatAudioTimer(sec) { const s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function showRecBar(show) {
    const bar = $('chat-rec-bar'); if (!bar) return;
    bar.classList.toggle('oculto', !show);
    bar.classList.toggle('travado', !!show && !audioHoldMode);
    document.body.classList.toggle('chat-gravando', !!show);
}
function updateRecTimer() { const t = $('chat-rec-timer'); if (t) t.textContent = formatAudioTimer(audioSeconds); }
function startAudioTimer() {
    audioSeconds = 0; updateRecTimer(); clearInterval(audioTimerInterval);
    const ini = Date.now();
    audioTimerInterval = setInterval(() => {
        const s2 = Math.floor((Date.now() - ini) / 1000);
        if (s2 !== audioSeconds) { audioSeconds = s2; updateRecTimer(); if (window.MineraRT && audioSeconds % 3 === 0) MineraRT.sendEstado('gravando'); }
        if (audioSeconds >= 600) stopRecording(false, true); // 10 min
    }, 250);
}
function stopAudioTimer() { clearInterval(audioTimerInterval); audioTimerInterval = null; }
function resetAudioBtn() {
    const btn = $('btn-audio'); if (!btn) return;
    btn.removeAttribute('data-recording');
    btn.classList.remove('btn-danger', 'recording', 'btn-ok'); btn.title = 'Segure para gravar';
}
function showMediaPreview(opts) {
    const box = $('chat-media-preview'); if (!box) return;
    if (!opts) { box.classList.add('oculto'); box.innerHTML = ''; return; }
}
function enviarAnexoPendente() {
    if (!anexoPendente) return;
    const p = anexoPendente; anexoPendente = null;
    showMediaPreview(null); setAnexoInfo(''); resetAudioBtn();
    enviarAudioGravado(p.file, p.picos, p.dur);
}
function enviarAudioGravado(file, picos, dur) {
    if (!contatoAtivo || !contatoAtivo.auth_id) { toast('Abra uma conversa primeiro.'); return; }
    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Chat')) return;
    let localUrl = null;
    try { localUrl = URL.createObjectURL(file); } catch (e) { /* ignore */ }
    const item = novoItem({ tipo: 'audio', texto: '', _file: file, _localUrl: localUrl, midia_frag: ChatAudio.fragmento(picos, dur) });
    setReplyTo(null, true);
    enfileirar(item);
}
function onRecordingReady(blob) {
    const mime = ChatMidia.baseMime(blob.type) || 'audio/webm';
    const file = new File([blob], 'audio_' + Date.now() + '.' + ChatMidia.extForMime(mime, 'webm'), { type: mime });
    audioAutoSend = false;
    resetAudioBtn(); setAnexoInfo('');
    const dur = audioRecDur || audioSeconds;
    enviarAudioGravado(file, audioPicos, dur);
}
let audioRecDur = 0;
// Antes (20261009u) o stream ficava aberto entre gravações com a trilha "desligada" (enabled=false)
// para não pedir permissão de novo: no iPhone isso mantinha o indicador laranja do mic aceso até
// sair do chat, e um stream aberto quando o app é suspenso faz o iOS perguntar a permissão de novo.
// Agora: nenhum stream fica guardado. A permissão continua sendo reaproveitada pelo próprio WebKit
// enquanto a tela não recarrega/navega: getUserMedia é chamado DENTRO do toque (pointerdown, sem
// await antes) e sempre com as mesmas opções — o iOS não pergunta de novo nessa sessão da tela.
let micStream = null;
let micGeracao = 0; // muda quando a gravação é abandonada (sair da tela/conversa) enquanto o mic abre
const AUDIO_OPCOES = { audio: { echoCancellation: true, noiseSuppression: true } };
function pegarMic() { return navigator.mediaDevices.getUserMedia(AUDIO_OPCOES); } // no gesto do usuário
/** Solta o microfone por completo: para TODAS as trilhas, fecha a onda (AudioContext) e esquece o stream. */
function soltarMic() {
    const st = micStream; micStream = null; audioStream = null;
    if (audioVis) { const v = audioVis; audioVis = null; try { const pc = v.parar(); if (!audioPicos) audioPicos = pc; } catch (e) { /* ignore */ } }
    if (st) { try { st.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ } }
}
/** App saiu da tela / página fechando / conversa fechada: encerra a gravação e solta o mic. */
function abandonarGravacao(enviar) {
    micGeracao++;
    audioPendingIntent = null;
    if (gravando || (mediaRecorder && mediaRecorder.state !== 'inactive')) {
        if (enviar) stopRecording(false, true);
        else { if (mediaRecorder) mediaRecorder._silencioso = true; stopRecording(true); }
    }
    soltarMic();
}
// app foi para o fundo (iOS corta o mic de qualquer jeito): envia o que já foi gravado
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') abandonarGravacao(true); });
window.addEventListener('pagehide', () => abandonarGravacao(false));
function toastAudio(msg) { msgErro(msg); toast(msg); setAnexoInfo(msg); }
async function startRecording(fromHold) {
    if (!contatoAtivo || !contatoAtivo.auth_id) { toastAudio('Selecione um contato primeiro.'); return; }
    if (bloqueioAtivo()) { toast('Conversa bloqueada.'); return; }
    if (!window.isSecureContext) { toastAudio('Microfone exige HTTPS.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toastAudio('Gravação não suportada neste navegador. Use ＋ → Documento.'); return; }
    // 20261003j: uma gravação por vez. Antes, uma 2ª gravação podia começar enquanto a 1ª ainda
    // finalizava (stop() é assíncrono) e as duas escreviam no MESMO array global de pedaços:
    // a 1ª saía curtinha (0:01) e a 2ª sem o cabeçalho WebM (não tocava em lugar nenhum).
    if (gravando || iniciandoGravacao || (mediaRecorder && mediaRecorder.state !== 'inactive')) return;
    iniciandoGravacao = true;
    audioCancelado = false; audioPicos = null; audioRecDur = 0;
    audioHoldMode = !!fromHold;
    try {
        const tAbrir = Date.now();
        const geracao = micGeracao;
        const stream = await pegarMic();
        micStream = stream; audioStream = stream;
        audioPediuPermissao = (Date.now() - tAbrir) > 700; // provavelmente apareceu o aviso do navegador
        // saiu da tela / fechou a conversa enquanto o mic abria: solta na hora
        if (geracao !== micGeracao || document.visibilityState === 'hidden' || !contatoAtivo) {
            iniciandoGravacao = false; soltarMic(); resetAudioBtn(); showLockHint(false); return;
        }
        const chunks = [];          // pedaços DESTA gravação (nunca compartilhados)
        audioChunks = chunks;
        const mime = ChatMidia.pickRecorderMime();
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mediaRecorder = rec; rec._stream = stream;
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
        rec.onstop = () => {
            clearTimeout(rec._soltarT);
            const atual = mediaRecorder === rec;
            if (atual) {
                if (audioVis) { audioPicos = audioVis.parar(); audioVis = null; }
                soltarMic(); // solta o microfone (indicador do iPhone apaga)
                stopAudioTimer(); showRecBar(false); gravando = false;
                if (window.MineraRT) MineraRT.sendEstado('parou');
            }
            try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ } // garante: este stream nunca fica vivo
            const startedAt = rec._startedAt || 0;
            if (rec._cancelado) { if (atual) { audioRecStartedAt = 0; resetAudioBtn(); setAnexoInfo(''); } return; }
            const blob = new Blob(chunks, { type: ChatMidia.baseMime(rec.mimeType) || ChatMidia.baseMime(mime) || 'audio/webm' });
            const elapsed = startedAt ? (Date.now() - startedAt) : 0;
            audioRecDur = elapsed / 1000;
            if (atual) audioRecStartedAt = 0;
            if (!blob.size || blob.size < 500 || elapsed < 500) { audioAutoSend = false; if (atual) resetAudioBtn(); return; }
            onRecordingReady(blob);
        };
        try { rec.start(250); } catch (eStart) { rec.start(); }
        rec._startedAt = Date.now();
        iniciandoGravacao = false;
        gravando = true;
        audioRecStartedAt = rec._startedAt;
        showRecBar(true);
        audioVis = ChatAudio.visualizar(stream, $('chat-rec-canvas'));
        startAudioTimer();
        if (window.MineraRT) MineraRT.sendEstado('gravando');
        const btn = $('btn-audio');
        if (btn) { btn.setAttribute('data-recording', '1'); btn.classList.add('recording'); }
        setAnexoInfo('');
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { /* ignore */ }
    } catch (err) {
        console.warn(err);
        iniciandoGravacao = false;
        if (mediaRecorder && mediaRecorder.state === 'inactive') mediaRecorder = null;
        soltarMic(); // erro depois de abrir o mic (ex.: MediaRecorder): não deixa o stream aceso
        gravando = false; resetAudioBtn(); showRecBar(false);
        const name = (err && err.name) || '';
        let msg = 'Não foi possível acessar o microfone.';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') msg = 'Permissão do microfone negada. Libere o mic nas configurações do navegador.';
        else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') msg = 'Nenhum microfone encontrado.';
        else if (name === 'NotReadableError' || name === 'TrackStartError') msg = 'Microfone em uso por outro app.';
        toastAudio(msg);
    }
}
function stopRecording(cancel, enviar) {
    if (cancel) { audioCancelado = true; audioAutoSend = false; } else audioAutoSend = true;
    gravando = false; stopAudioTimer();
    if (mediaRecorder) mediaRecorder._cancelado = !!cancel;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const rec = mediaRecorder;
        try { if (typeof rec.requestData === 'function') { try { rec.requestData(); } catch (e) { /* ignore */ } } rec.stop(); } catch (e) { /* ignore */ }
        // onstop solta o mic; se o navegador não disparar onstop, solta mesmo assim
        clearTimeout(rec._soltarT);
        rec._soltarT = setTimeout(() => {
            const st = rec._stream; if (!st) return;
            if (micStream === st) soltarMic();
            else { try { st.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ } }
        }, 1500);
    } else { showRecBar(false); soltarMic(); if (cancel) resetAudioBtn(); }
}
function travarGravacao() {
    audioHoldMode = false;
    audioPendingIntent = null;
    const bar = $('chat-rec-bar'); if (bar) bar.classList.add('travado');
    showLockHint(false);
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
}
function showLockHint(show, progress) {
    const wrap = $('chat-rec-lock-wrap');
    const pad = $('chat-rec-lock-pad');
    if (!wrap) return;
    wrap.classList.toggle('on', !!show);
    wrap.setAttribute('aria-hidden', show ? 'false' : 'true');
    const p = Math.max(0, Math.min(1, progress == null ? 0 : progress));
    wrap.style.setProperty('--lock-p', String(p));
    wrap.classList.toggle('lock-ready', p >= 0.98);
    if (pad) pad.style.transform = 'translateY(' + (-Math.round(p * 28)) + 'px)';
}
/** Intenção enquanto getUserMedia / MediaRecorder ainda está abrindo (permissão no 1º uso). */
let audioPendingIntent = null; // 'send' | 'cancel' | 'lock' | 'discard_tap' | null
let audioPediuPermissao = false;
function aplicarIntentAoIniciar() {
    const intent = audioPendingIntent; audioPendingIntent = null;
    if (!gravando) return;
    if (intent === 'cancel') { stopRecording(true); toast('Gravação cancelada'); return; }
    if (intent === 'discard_tap') {
        if (mediaRecorder) mediaRecorder._silencioso = true;
        stopRecording(true);
        if (audioPediuPermissao) toast('🎤 Microfone liberado');
        return;
    }
    if (intent === 'lock') { travarGravacao(); return; }
    if (intent === 'send') { stopRecording(false, true); return; }
    // ainda segurando: continua em hold
}
function bindAudioButton() {
    const btn = $('btn-audio');
    if (!btn || btn._audioBound) return;
    btn._audioBound = true;
    const LOCK_PX = 56, CANCEL_PX = 72, TAP_MS = 280;
    let pointerDown = false, suppressClick = false, downAt = 0, downX = 0, downY = 0;
    let slidCancel = false, slidLock = false;
    const slide = () => $('chat-rec-slide');
    const limparSlide = () => { const sl = slide(); if (sl) sl.style.transform = ''; };
    const emHold = () => !!(gravando && audioHoldMode);
    const abrindo = () => !!iniciandoGravacao;

    // iOS: evita callout / seleção / menu de contexto no mic
    btn.style.touchAction = 'none';
    btn.style.webkitUserSelect = 'none';
    btn.style.userSelect = 'none';
    btn.style.webkitTouchCallout = 'none';
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    btn.addEventListener('selectstart', (e) => { e.preventDefault(); });

    btn.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (gravando || abrindo()) return;
        pointerDown = true; slidCancel = false; slidLock = false;
        downAt = Date.now(); downX = e.clientX; downY = e.clientY;
        audioPointerId = e.pointerId; audioPendingIntent = null;
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        try { e.preventDefault(); } catch (err) { /* ignore */ }
        showLockHint(true, 0);
        startRecording(true).then(() => {
            // permissão / mic pode demorar: aplica o que o dedo fez nesse meio tempo
            if (gravando) aplicarIntentAoIniciar();
            else showLockHint(false);
        });
    });
    btn.addEventListener('pointermove', (e) => {
        if (!pointerDown || (audioPointerId != null && e.pointerId !== audioPointerId)) return;
        if (slidCancel || slidLock) return;
        // depois de travar, o dedo pode soltar — move não importa
        if (gravando && !audioHoldMode) return;
        const dx = downX - e.clientX; // >0 = esquerda
        const dy = downY - e.clientY; // >0 = cima
        const sl = slide();
        if (emHold() || abrindo()) {
            if (sl) sl.style.transform = 'translateX(' + (-Math.max(0, Math.min(90, dx))) + 'px)';
            showLockHint(true, Math.max(0, Math.min(1, dy / LOCK_PX)));
        }
        // prioridade: o eixo dominante
        if (dy >= LOCK_PX && dy >= dx) {
            slidLock = true; limparSlide();
            if (emHold()) travarGravacao();
            else if (abrindo()) audioPendingIntent = 'lock';
            else showLockHint(false);
            return;
        }
        if (dx >= CANCEL_PX && dx > dy) {
            slidCancel = true; limparSlide(); showLockHint(false);
            if (emHold()) { stopRecording(true); toast('Gravação cancelada'); }
            else if (abrindo()) audioPendingIntent = 'cancel';
            pointerDown = false; suppressClick = true; audioPointerId = null;
            try { btn.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
    });
    btn.addEventListener('pointerup', (e) => {
        if (audioPointerId != null && e.pointerId !== audioPointerId) return;
        const wasDown = pointerDown; pointerDown = false; audioPointerId = null;
        limparSlide();
        try { e.preventDefault(); } catch (err) { /* ignore */ }
        if (!wasDown || slidCancel) { slidCancel = false; showLockHint(false); return; }
        suppressClick = true;
        // já travou: soltar o dedo não envia nem cancela
        if (slidLock || (gravando && !audioHoldMode)) { slidLock = false; showLockHint(false); return; }
        const held = Date.now() - downAt;
        if (emHold()) {
            showLockHint(false);
            if (held < TAP_MS) {
                if (mediaRecorder) mediaRecorder._silencioso = true;
                stopRecording(true);
            } else if (soltouNoCancelar(e)) {
                stopRecording(true); toast('Gravação cancelada');
            } else {
                stopRecording(false, true); // soltou = envia
            }
            return;
        }
        if (abrindo()) {
            // ainda pedindo permissão / abrindo o mic: guarda a intenção
            if (audioPendingIntent !== 'cancel') audioPendingIntent = held < TAP_MS ? 'discard_tap' : 'send';
            showLockHint(false);
            return;
        }
        // não chegou a gravar (erro de permissão, ou já cancelado pelo botão Cancelar)
        showLockHint(false);
    });
    btn.addEventListener('pointercancel', (e) => {
        if (audioPointerId != null && e.pointerId !== audioPointerId) return;
        const wasDown = pointerDown; pointerDown = false; audioPointerId = null;
        limparSlide();
        if (!wasDown || slidCancel) { showLockHint(false); return; }
        // sistema roubou o toque (aviso de permissão, chamada etc.): NUNCA trava sozinho —
        // descarta sem enviar (só trava quem arrasta para cima)
        if (emHold()) { if (mediaRecorder) mediaRecorder._silencioso = true; stopRecording(true); showLockHint(false); return; }
        if (abrindo() && !audioPendingIntent) audioPendingIntent = 'discard_tap';
        showLockHint(false);
    });
    // toque sem pointer (fallback raro): só a dica — nunca inicia gravação contínua
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (suppressClick) { suppressClick = false; return; }
    });
    const env = $('btn-rec-enviar'); if (env) env.addEventListener('click', () => { if (gravando) stopRecording(false, true); });
    // Cancelar enquanto segura: outro dedo toca em "Cancelar" (o dedo do 🎤 continua capturado)
    const canc = $('btn-cancel-rec');
    if (canc && !canc._holdBound) {
        canc._holdBound = true;
        canc.addEventListener('pointerdown', (e) => {
            if (!gravando && !abrindo()) return;
            try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
            canc._cancelouAgora = Date.now();
            if (abrindo()) { audioPendingIntent = 'cancel'; return; }
            pointerDown = false; audioPointerId = null; slidLock = false; limparSlide(); showLockHint(false);
            stopRecording(true); toast('Gravação cancelada');
        });
    }
    function soltouNoCancelar(e) {
        const c = $('btn-cancel-rec'); if (!c || e.clientX == null) return false;
        const r = c.getBoundingClientRect();
        return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
}

/* ============================ adicionar contato (diretório) ============================ */
async function rpcDiretorio(busca) {
    try {
        const termo = String(busca || '').trim();
        if (looksLikeEmail(termo)) return []; // nunca busca por e-mail no cliente
        if (termo.length >= 1) {
            const { data, error } = await supabaseClient.rpc('chat_buscar_nome', { p_nome: termo });
            if (!error && data) return data.map(stripEmailFields);
        }
        const { data, error } = await supabaseClient.rpc('chat_diretorio');
        if (error) throw error;
        const list = (data || []).map(stripEmailFields);
        if (!termo) return list;
        const t = termo.toLowerCase();
        return list.filter(u => String(u.nome || '').toLowerCase().includes(t) || String(u.apelido || '').toLowerCase().includes(t));
    } catch (e) { console.warn('chat_diretorio/buscar_nome', e); return []; }
}
/* Nova conversa (tela cheia): busca, chips por tipo de trabalho, "Criar grupo" e lista de pessoas. Voltar/Android fecha. */
const NC_CHIP_ROTULO = { minerador: 'Minerador', comprador: 'Comprador', transportador: 'Transportador', carregamento: 'Carregador', dono_britador: 'Britador' };
let ncRole = '', ncGrupoModo = false, ncSel = new Set();
function ncAberto() { const m = $('modal-add-contato'); return !!(m && !m.classList.contains('oculto')); }
function abrirModalAdd() {
    const m = $('modal-add-contato'); if (!m) return;
    ncRole = ''; ncGrupoModo = false; ncSel = new Set();
    m.classList.remove('oculto');
    document.body.classList.add('nc-aberta');
    const b = $('add-busca'); if (b) b.value = '';
    const msg = $('add-contato-msg'); if (msg) { msg.textContent = ''; msg.className = 'msg nc-msg'; }
    ncAtualizarTopo();
    renderRoleFilters();
    carregarDiretorioAdd('');
    const sc = $('nc-scroll'); if (sc) sc.scrollTop = 0;
    try { if (!(history.state && history.state.chatNova)) history.pushState({ chatNova: 1 }, '', location.href); } catch (e) { /* ignore */ }
}
/** porHistorico = já veio do Voltar do Android/navegador. semHistorico = vai abrir conversa (troca a entrada do histórico). */
function fecharModalAdd(porHistorico, semHistorico) {
    const m = $('modal-add-contato'); if (!m || m.classList.contains('oculto')) return;
    m.classList.add('oculto');
    document.body.classList.remove('nc-aberta');
    if (porHistorico === true) return;
    try {
        if (history.state && history.state.chatNova) {
            if (semHistorico === true) history.replaceState({}, '', location.href);
            else history.back();
        }
    } catch (e) { /* ignore */ }
}
function ncAtualizarTopo() {
    const t = $('modal-add-titulo'), sub = $('nc-sub'), foot = $('nc-foot'), bt = $('nc-criar-grupo');
    if (t) t.textContent = ncGrupoModo ? 'Novo grupo' : 'Nova conversa';
    if (sub) sub.textContent = ncGrupoModo ? (ncSel.size ? ncSel.size + (ncSel.size === 1 ? ' pessoa escolhida' : ' pessoas escolhidas') : 'Escolha as pessoas') : '';
    if (foot) foot.classList.toggle('oculto', !ncGrupoModo);
    if (bt) { bt.disabled = !ncSel.size; bt.textContent = ncSel.size ? 'Criar grupo (' + ncSel.size + ')' : 'Criar grupo'; }
    const ac = $('nc-acoes');
    if (ac) ac.innerHTML = (!ncGrupoModo && ChatStore.temGrupos())
        ? '<button type="button" class="nc-row nc-acao" id="nc-btn-grupo"><span class="nc-av nc-av-acao" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M18 8v6M15 11h6"/></g></svg></span><span class="nc-txt"><strong>Criar grupo</strong><span class="nc-sub2">Converse com várias pessoas juntas</span></span></button>'
        : '';
}
function renderRoleFilters() {
    const el = $('add-role-filters'); if (!el) return;
    el.innerHTML = '<button type="button" class="nc-chip on" data-role="">Todos</button>' +
        ROLE_GROUPS.filter(g => g.id !== 'outros').map(g => '<button type="button" class="nc-chip" data-role="' + g.id + '">' + esc(NC_CHIP_ROTULO[g.id] || g.title.split('/')[0]) + '</button>').join('');
    el.querySelectorAll('.nc-chip').forEach(btn => btn.addEventListener('click', () => {
        el.querySelectorAll('.nc-chip').forEach(c => c.classList.remove('on'));
        btn.classList.add('on');
        ncRole = btn.getAttribute('data-role') || '';
        try { btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
        renderDiretorioList(diretorioCache, ncRole);
    }));
}
async function carregarDiretorioAdd(busca) {
    const box = $('add-diretorio'); if (!box) return;
    box.innerHTML = '<p class="nc-vazio">Carregando…</p>';
    const pedido = String(busca || '');
    const lista = await rpcDiretorio(busca);
    if (((($('add-busca') || {}).value || '').trim()) !== pedido.trim()) return; // chegou resposta velha
    diretorioCache = lista;
    renderDiretorioList(diretorioCache, ncRole);
}
function ncLinha(u, ja) {
    const nome = displayNome(u);
    const outroNome = u.apelido && u.nome && u.apelido !== u.nome ? u.nome : '';
    const sel = ncSel.has(u.auth_id);
    return '<button type="button" class="nc-row' + (sel ? ' sel' : '') + '" data-auth="' + esc(u.auth_id) + '"' + (ncGrupoModo ? ' aria-pressed="' + sel + '"' : '') + '>' +
        '<span class="nc-av-wrap"><span class="wa-av mav nc-av" data-av-id="' + esc(u.auth_id) + '" data-av-nome="' + esc(nome) + '">' + esc(iniciais(nome)) + '</span>' + (ncGrupoModo ? '<span class="nc-check" aria-hidden="true">✓</span>' : '') + '</span>' +
        '<span class="nc-txt"><strong>' + esc(nome) + '</strong>' + (outroNome ? '<span class="nc-sub2">' + esc(outroNome) + '</span>' : '') +
        '<span class="nc-papel">' + esc(labelPapelCurto(u.papeis, u.tipo)) + '</span></span></button>';
}
function renderDiretorioList(lista, roleFilter) {
    const box = $('add-diretorio'); if (!box) return;
    const ja = new Set(contatosCache.filter(c => !c.ehGrupo).map(c => c.auth_id));
    let items = (lista || []).filter(u => u && u.auth_id && u.auth_id !== meuAuthId);
    if (roleFilter) {
        const g = ROLE_GROUPS.find(x => x.id === roleFilter);
        if (g && g.match) items = items.filter(u => { const ps = (u.papeis || []).map(p => String(p).toLowerCase()); return g.match.some(m => ps.includes(m) || String(u.tipo || '').toLowerCase() === m); });
    }
    if (!items.length) { box.innerHTML = '<p class="nc-vazio">Ninguém encontrado. Tente outro nome ou outro filtro.</p>'; return; }
    const cmp = (x, y) => displayNome(x).localeCompare(displayNome(y), 'pt-BR', { sensitivity: 'base' });
    const meus = items.filter(u => ja.has(u.auth_id)).sort(cmp), outros = items.filter(u => !ja.has(u.auth_id)).sort(cmp);
    box.innerHTML = (meus.length ? '<div class="nc-sec">Seus contatos</div>' + meus.map(u => ncLinha(u, true)).join('') : '') +
        (outros.length ? '<div class="nc-sec">Pessoas no Minera Pará</div>' + outros.map(u => ncLinha(u, false)).join('') : '');
}
async function ncCriarGrupo() {
    const ids = Array.from(ncSel); if (!ids.length) return;
    const nomes = ids.map(id => { const u = diretorioCache.find(x => x.auth_id === id) || contatosCache.find(x => x.auth_id === id); return u ? displayNome(u) : ''; });
    const nome = nomeGrupoPadrao(nomes.concat([meuNomePublico()]));
    if (!(await cxConfirm('Criar grupo?', 'Você e ' + nomeGrupoPadrao(nomes) + ' vão conversar juntos num grupo novo.', 'Criar grupo'))) return;
    const bt = $('nc-criar-grupo'); if (bt) bt.disabled = true;
    const r = await supabaseClient.rpc('chat_grupo_criar', { p_nome: nome, p_membros: ids });
    if (r.error || !r.data) {
        const msg = $('add-contato-msg'); if (msg) { msg.textContent = 'Não foi possível criar o grupo: ' + ((r.error && r.error.message) || ''); msg.className = 'msg erro nc-msg'; }
        if (bt) bt.disabled = false; return;
    }
    if (window.MineraRT && MineraRT.atualizarGrupos) MineraRT.atualizarGrupos();
    toast('Grupo criado');
    fecharModalAdd(false, true);
    await abrirGrupoPorId(r.data, nome);
}
function bindNovaConversa() {
    const m = $('modal-add-contato'); if (!m) return;
    m.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.closest && t.closest('#nc-btn-grupo')) { ncGrupoModo = true; ncSel = new Set(); ncAtualizarTopo(); renderDiretorioList(diretorioCache, ncRole); return; }
        if (t.closest && t.closest('#nc-criar-grupo')) { ncCriarGrupo(); return; }
        const row = t.closest && t.closest('.nc-row[data-auth]');
        if (!row) return;
        const id = row.getAttribute('data-auth');
        if (ncGrupoModo) {
            if (ncSel.has(id)) ncSel.delete(id); else ncSel.add(id);
            row.classList.toggle('sel', ncSel.has(id)); row.setAttribute('aria-pressed', String(ncSel.has(id)));
            ncAtualizarTopo(); return;
        }
        const u = diretorioCache.find(x => x.auth_id === id);
        if (u) await adicionarContato(u);
    });
    window.addEventListener('popstate', () => {
        if (ncAberto() && !(history.state && history.state.chatNova)) fecharModalAdd(true);
    });
}
async function adicionarContato(user) {
    const msg = $('add-contato-msg');
    if (!user || !user.auth_id) return;
    if (user.auth_id === meuAuthId) { if (msg) { msg.textContent = 'Não pode adicionar a si mesmo.'; msg.className = 'msg erro'; } return; }
    if (!contatosCache.some(c => c.auth_id === user.auth_id)) {
        const { error } = await supabaseClient.from('chat_contatos').upsert([{ auth_id: meuAuthId, contato_auth_id: user.auth_id, apelido: displayNome(user) }], { onConflict: 'auth_id,contato_auth_id' });
        if (error) { if (msg) { msg.textContent = 'Erro: ' + error.message; msg.className = 'msg erro'; } return; }
        contatosCache.push({ auth_id: user.auth_id, nome: displayNome(user), apelido: user.apelido || null, nomeReal: user.nome || '', papeis: user.papeis || [], tipo: user.tipo || '', last: null, unread: 0, peerLida: 0, peerEntregue: 0 });
        renderLista();
        agendarInbox(500);
    }
    fecharModalAdd(false, true);
    const c = contatosCache.find(x => x.auth_id === user.auth_id);
    abrirThread(c || { auth_id: user.auth_id, nome: displayNome(user), papeis: user.papeis || [], tipo: user.tipo || '', apelido: displayNome(user) });
}

/* ============================ ações de mensagem ============================ */
let sheetMsg = null, longPressTimer = null, longPressStart = null;
const LONG_PRESS_MS = 400;
function setReplyTo(m, semFoco) {
    replyToMsg = m || null;
    const bar = $('chat-reply-bar'), snip = $('chat-reply-snippet');
    if (!bar) return;
    if (!replyToMsg) { bar.classList.add('oculto'); if (snip) snip.textContent = ''; return; }
    if (snip) snip.textContent = (ehMinha(replyToMsg) ? 'Você' : nomePublicoTexto(replyToMsg.de_nome, 'Mensagem')) + ': ' + snippetMsg(replyToMsg);
    bar.classList.remove('oculto');
    if (!semFoco) { const input = $('chat-texto'); if (input) input.focus(); }
}
function fecharChatHeadMenu() { const menu = $('chat-head-menu'); if (menu) menu.classList.add('oculto'); }
function toggleChatHeadMenu() {
    const menu = $('chat-head-menu'); if (!menu) return;
    const abrir = menu.classList.contains('oculto');
    if (abrir) prepararMenuConversa();
    menu.classList.toggle('oculto', !abrir);
}
function fecharMsgSheet() { const s = $('chat-msg-sheet'); if (s) s.classList.add('oculto'); sheetMsg = null; }
function abrirMsgSheet(m) {
    if (!m || !m.id || String(m.tipo || '') === 'sistema') return;
    sheetMsg = m;
    const prev = $('chat-msg-sheet-preview'), btnTodos = $('sheet-apagar-todos');
    if (prev) prev.textContent = snippetMsg(m);
    if (btnTodos) btnTodos.classList.toggle('oculto', !ehMinha(m));
    const bCop = $('sheet-copiar'); if (bCop) bCop.classList.toggle('oculto', !textoCopiavel(m));
    const s = $('chat-msg-sheet'); if (s) s.classList.remove('oculto');
}
/** Texto da mensagem para "Copiar" (só texto; mídia/documento não). */
function textoCopiavel(m) {
    if (!m || m.deleted_at || String(m.tipo || 'text') === 'documento') return '';
    return String(m.texto || '').trim() ? String(m.texto) : '';
}
async function copiarTexto(txt) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(txt); return true; } } catch (e) { /* fallback */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length);
        const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
}
function msgFromBubbleEl(el) {
    const b = el && el.closest ? el.closest('.bubble[data-msg-id]') : null;
    if (!b) return null;
    const id = Number(b.getAttribute('data-msg-id'));
    return id ? (T.msgs.get(id) || null) : null;
}
async function apagarMsgParaMim(m) {
    if (!m || !m.id) return;
    fecharMsgSheet();
    const { error } = await supabaseClient.rpc('chat_apagar_para_mim', { p_msg_id: Number(m.id) });
    if (error) { toast('Erro ao apagar: ' + error.message); return; }
    T.msgs.delete(Number(m.id)); removerBolha('m' + m.id); salvarCacheConversa();
    agendarInbox(200);
}
async function apagarMsgParaTodos(m) {
    if (!m || !m.id || !ehMinha(m)) return;
    if (!confirm('Apagar esta mensagem para todos?')) return;
    fecharMsgSheet();
    const { error } = await supabaseClient.rpc('chat_apagar_para_todos', { p_msg_id: Number(m.id) });
    if (error) { toast('Erro: ' + error.message); return; }
    const n = Object.assign({}, m, { deleted_at: new Date().toISOString() });
    T.msgs.set(Number(m.id), n); trocarBolha('m' + m.id, n); salvarCacheConversa();
    patchInboxComMsg(n, T.peer);
}
async function apagarConversaParaMim() {
    if (!contatoAtivo || !contatoAtivo.auth_id) return;
    return apagarConversa(contatoAtivo.auth_id);
}
async function apagarConversaParaMimLegado() {
    if (!contatoAtivo || !contatoAtivo.auth_id) return;
    fecharChatHeadMenu();
    if (!confirm('Apagar conversa para mim? As mensagens somem só do seu lado.')) return;
    const peer = contatoAtivo.auth_id;
    const { error } = await supabaseClient.rpc('chat_ocultar_conversa', { p_outro: peer });
    if (error) { toast('Erro: ' + error.message); return; }
    ChatStore.cacheThreadGravar(peer, []);
    contatosCache = contatosCache.filter(c => c.auth_id !== peer); renderLista();
    fecharConversa();
    agendarInbox(300);
}
async function apagarHistoricoParaTodos() {
    if (!contatoAtivo || !contatoAtivo.auth_id) return;
    fecharChatHeadMenu();
    if (!confirm('Isso remove o histórico para os dois lados. Continuar?')) return;
    const peer = contatoAtivo.auth_id;
    const { error } = await supabaseClient.rpc('chat_apagar_historico_para_todos', { p_outro: peer });
    if (error) { toast('Erro: ' + error.message); return; }
    ChatStore.cacheThreadGravar(peer, []);
    fecharConversa();
    agendarInbox(300);
}
/* ============================ bloqueio / apagar conversa (SQL 49) ============================ */
const SEM49_KEY = 'minera_chat_sem49';
function sem49() { try { const t = Number(localStorage.getItem(SEM49_KEY) || 0); return !!t && Date.now() - t < 15 * 60e3; } catch (e) { return false; } }
function marcarSem49(v) { try { if (v) localStorage.setItem(SEM49_KEY, String(Date.now())); else localStorage.removeItem(SEM49_KEY); } catch (e) { /* ignore */ } }
function ehFuncaoAusente49(err) {
    const c = (err && err.code) || '', m = (err && err.message) || '';
    return c === 'PGRST202' || c === '42883' || /Could not find the function|does not exist/i.test(m);
}
function ehErroBloqueio(err) { return !!err && /chat_bloqueado/i.test(((err.message || '') + ' ' + (err.details || ''))); }
const Bloq = { m: new Map(), get(p) { return this.m.get(p) || null; }, set(p, v) { this.m.set(p, v); } };
const amigosSet = new Set();
async function carregarBloqueio(peer) {
    if (!peer || sem49()) return null;
    try {
        const r = await supabaseClient.rpc('chat_bloqueio_estado', { p_outro: peer });
        if (r.error) { if (ehFuncaoAusente49(r.error)) marcarSem49(true); return null; }
        marcarSem49(false);
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        const e = { eu_bloqueei: !!(d && d.eu_bloqueei), me_bloqueou: !!(d && d.me_bloqueou), limpo_ate_id: Number((d && d.limpo_ate_id) || 0) };
        Bloq.set(peer, e);
        return e;
    } catch (e) { return null; }
}
function bloqueioAtivo() { const e = T.peer && Bloq.get(T.peer); return !!(e && (e.eu_bloqueei || e.me_bloqueou)); }
function aplicarBloqueioUI(e) {
    if (T.peer && e) Bloq.set(T.peer, e);
    const bar = $('chat-bloqueio-bar'), txt = $('chat-bloqueio-txt'), btn = $('btn-bloq-desbloquear');
    const ativo = !!(T.peer && e && (e.eu_bloqueei || e.me_bloqueou));
    document.body.classList.toggle('chat-bloqueado', ativo);
    if (bar) bar.classList.toggle('oculto', !ativo);
    if (!ativo) return;
    if (e.eu_bloqueei) { if (txt) txt.textContent = 'Você bloqueou ' + displayNome(contatoAtivo) + '.'; if (btn) btn.classList.remove('oculto'); }
    else { if (txt) txt.textContent = 'Você não pode enviar mensagens nesta conversa.'; if (btn) btn.classList.add('oculto'); }
    if (gravando) stopRecording(true);
    const inp = $('chat-texto'); if (inp && document.activeElement === inp) inp.blur();
}
/** Corta no cliente o que estiver ≤ limpo_ate_id (cache antigo de outro aparelho). */
function aplicarCorte(e) {
    const corte = Number(e && e.limpo_ate_id || 0);
    if (!corte || !T.msgs.size) return;
    const ids = Array.from(T.msgs.keys()).filter(id => id <= corte);
    if (!ids.length) return;
    const resto = Array.from(T.msgs.values()).filter(m => Number(m.id) > corte);
    T.msgs = new Map(); T.minId = null; T.maxId = 0;
    registrarMsgs(resto);
    renderConversaCompleta(resto, 0);
    posicionarAoAbrir();
    salvarCacheConversa();
}
async function ehAmigo(peer) {
    if (amigosSet.has(peer)) return true;
    try {
        const r = await supabaseClient.from('chat_contatos').select('contato_auth_id').eq('auth_id', meuAuthId).eq('contato_auth_id', peer).maybeSingle();
        const ok = !r.error && !!r.data;
        if (ok) amigosSet.add(peer);
        return ok;
    } catch (e) { return false; }
}
async function adicionarAmigoAtual() {
    fecharChatHeadMenu();
    const c = contatoAtivo; if (!c || !c.auth_id) return;
    const { error } = await supabaseClient.from('chat_contatos').upsert([{ auth_id: meuAuthId, contato_auth_id: c.auth_id, apelido: displayNome(c) }], { onConflict: 'auth_id,contato_auth_id' });
    if (error) { toast('Erro ao adicionar: ' + error.message); return; }
    amigosSet.add(c.auth_id);
    toast(displayNome(c) + ' adicionado aos amigos');
    agendarInbox(200);
}
function prepararMenuConversa() {
    const peer = T.peer; if (!peer) return;
    const ehG = ehGrupoPeer(peer);
    ['btn-op-amigo', 'btn-op-bloquear', 'btn-apagar-hist-mim', 'btn-apagar-hist-todos'].forEach(id => { const b = $(id); if (b) b.classList.toggle('oculto-grupo', ehG); });
    ['btn-grp-membros', 'btn-grp-renomear', 'btn-grp-sair'].forEach(id => { const b = $(id); if (b) b.classList.toggle('oculto', !ehG); });
    const bAdd = $('btn-op-add-pessoa'); if (bAdd) bAdd.classList.toggle('oculto', !ehG && !ChatStore.temGrupos());
    if (ehG) return;
    const bA = $('btn-op-amigo'), bB = $('btn-op-bloquear'), tB = $('btn-op-bloquear-txt');
    const e = Bloq.get(peer);
    if (bB) bB.classList.toggle('oculto', sem49());
    if (tB) tB.textContent = e && e.eu_bloqueei ? 'Desbloquear' : 'Bloquear usuário';
    if (bA) {
        bA.classList.toggle('oculto', amigosSet.has(peer));
        ehAmigo(peer).then(ok => { if (peer === T.peer) bA.classList.toggle('oculto', ok); });
    }
}
function cxConfirm(tit, txt, sim) {
    return new Promise(res => {
        const d = $('cx-confirm');
        if (!d) { res(confirm(txt)); return; }
        $('cx-confirm-tit').textContent = tit;
        $('cx-confirm-txt').textContent = txt;
        const bs = $('cx-confirm-sim'); bs.textContent = sim || 'Confirmar';
        d.classList.remove('oculto');
        requestAnimationFrame(() => d.classList.add('aberto'));
        const fim = (v) => { d.classList.remove('aberto'); d.classList.add('oculto'); d.removeEventListener('click', onC); res(v); };
        const onC = (ev) => {
            if (ev.target.closest('#cx-confirm-sim')) fim(true);
            else if (ev.target.closest('[data-cx-nao]')) fim(false);
        };
        d.addEventListener('click', onC);
    });
}
let undoT = null, undoT2 = null;
function esconderUndo() {
    const el = $('cx-undo'); if (!el) return;
    clearTimeout(undoT); el.classList.remove('aberto');
    clearTimeout(undoT2); undoT2 = setTimeout(() => el.classList.add('oculto'), 220);
}
function mostrarUndo(txt, fn) {
    const el = $('cx-undo'), t = $('cx-undo-txt'), b = $('cx-undo-btn'); if (!el) return;
    clearTimeout(undoT2);
    t.textContent = txt;
    b.classList.toggle('oculto', !fn);
    el.classList.remove('oculto');
    requestAnimationFrame(() => el.classList.add('aberto'));
    b.onclick = async () => { esconderUndo(); try { if (fn) await fn(); } catch (e) { console.warn(e); } };
    clearTimeout(undoT); undoT = setTimeout(esconderUndo, 6500);
}
function nomeDoPeer(peer) {
    if (contatoAtivo && contatoAtivo.auth_id === peer) return displayNome(contatoAtivo);
    const c = contatosCache.find(x => x.auth_id === peer);
    return c ? displayNome(c) : 'este usuário';
}
async function apagarConversa(peer) {
    if (!peer) return;
    fecharChatHeadMenu(); fecharRowSheet();
    const nome = nomeDoPeer(peer);
    if (!(await cxConfirm('Apagar conversa?', 'As mensagens com ' + nome + ' somem só para você. ' + nome + ' continua vendo a conversa.', 'Apagar'))) return;
    let v2 = false, anterior = 0;
    if (!sem49()) {
        const r = await supabaseClient.rpc('chat_apagar_conversa_v2', { p_outro: peer });
        if (!r.error) { v2 = true; anterior = Number(r.data || 0); }
        else if (ehFuncaoAusente49(r.error)) marcarSem49(true);
        else { toast('Erro: ' + r.error.message); return; }
    }
    if (!v2) {
        const { error } = await supabaseClient.rpc('chat_ocultar_conversa', { p_outro: peer });
        if (error) { toast('Erro: ' + error.message); return; }
    }
    const cache = ChatStore.cacheThreadLer(peer);
    ChatStore.cacheThreadGravar(peer, []);
    Bloq.m.delete(peer);
    contatosCache = contatosCache.filter(c => c.auth_id !== peer); renderLista();
    if (T.peer === peer) fecharConversa();
    agendarInbox(300);
    mostrarUndo('Conversa apagada', async () => {
        if (v2) {
            const r = await supabaseClient.rpc('chat_desfazer_apagar_conversa', { p_outro: peer, p_anterior: anterior });
            if (r.error) { toast('Não deu para desfazer: ' + r.error.message); return; }
        } else {
            try { await supabaseClient.rpc('chat_desocultar_conversa', { p_outro: peer }); } catch (e) { /* ignore */ }
        }
        if (cache && cache.m && cache.m.length) ChatStore.cacheThreadGravar(peer, cache.m);
        Bloq.m.delete(peer);
        agendarInbox(50);
        toast('Conversa restaurada');
    });
}
async function alternarBloqueio(peer) {
    if (!peer) return;
    fecharChatHeadMenu(); fecharRowSheet();
    const nome = nomeDoPeer(peer);
    const e = Bloq.get(peer) || await carregarBloqueio(peer) || {};
    if (sem49()) { toast('Bloqueio indisponível no momento.'); return; }
    if (!e.eu_bloqueei) {
        if (!(await cxConfirm('Bloquear ' + nome + '?', nome + ' não poderá mais enviar mensagens para você, e você também não envia para ' + nome + '. Ninguém é avisado.', 'Bloquear'))) return;
        const r = await supabaseClient.rpc('chat_bloquear', { p_outro: peer });
        if (r.error) { toast(ehFuncaoAusente49(r.error) ? 'Bloqueio indisponível no momento.' : 'Erro: ' + r.error.message); return; }
        mostrarUndo(nome + ' bloqueado', null);
    } else {
        const r = await supabaseClient.rpc('chat_desbloquear', { p_outro: peer });
        if (r.error) { toast('Erro: ' + r.error.message); return; }
        mostrarUndo(nome + ' desbloqueado', null);
    }
    Bloq.m.delete(peer);
    const n = await carregarBloqueio(peer);
    if (peer === T.peer) aplicarBloqueioUI(n || { eu_bloqueei: !e.eu_bloqueei, me_bloqueou: !!e.me_bloqueou });
}
let rowSheetPeer = null;
function fecharRowSheet() { const s = $('chat-row-sheet'); if (s) s.classList.add('oculto'); rowSheetPeer = null; }
async function abrirRowSheet(peer) {
    const c = contatosCache.find(x => x.auth_id === peer); if (!c) return;
    if (c.ehGrupo) { abrirGrupoSheet(c); return; }
    rowSheetPeer = peer;
    const nm = $('chat-row-sheet-nome'); if (nm) nm.textContent = displayNome(c);
    const bB = $('row-bloquear');
    if (bB) { bB.classList.toggle('oculto', sem49()); bB.textContent = 'Bloquear usuário'; }
    const s = $('chat-row-sheet'); if (s) s.classList.remove('oculto');
    const e = Bloq.get(peer) || await carregarBloqueio(peer);
    if (rowSheetPeer === peer && bB) { bB.classList.toggle('oculto', sem49()); if (e) bB.textContent = e.eu_bloqueei ? 'Desbloquear' : 'Bloquear usuário'; }
}
function bindLongPressLista(lista) {
    let t = null, sx = 0, sy = 0, suprimir = false;
    const cancelar = () => { clearTimeout(t); t = null; };
    lista.addEventListener('pointerdown', (e) => {
        suprimir = false;
        if (e.button != null && e.button !== 0) return;
        const row = e.target.closest && e.target.closest('.wa-row[data-auth]'); if (!row) return;
        sx = e.clientX; sy = e.clientY; cancelar();
        t = setTimeout(() => {
            t = null; suprimir = true;
            try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) { /* ignore */ }
            abrirRowSheet(row.getAttribute('data-auth'));
        }, 450);
    });
    lista.addEventListener('pointermove', (e) => { if (t && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancelar(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => lista.addEventListener(ev, cancelar));
    lista.addEventListener('contextmenu', (e) => {
        const row = e.target.closest && e.target.closest('.wa-row[data-auth]'); if (!row) return;
        e.preventDefault(); cancelar();
        if (!rowSheetPeer) abrirRowSheet(row.getAttribute('data-auth'));
        suprimir = true;
    });
    lista.addEventListener('click', (e) => { if (suprimir) { suprimir = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

function fecharConversa(viaPopstate) {
    document.body.classList.remove('chat-grupo-aberto');
    pararDigitando();
    if (window.MineraRT) MineraRT.leaveDm();
    salvarCacheConversa();
    contatoAtivo = null; T.peer = null; T.gen++;
    abandonarGravacao(false); // fecha a conversa: descarta a gravação e solta o microfone
    if (window.ChatAudio) ChatAudio.pararTodos();
    aplicarBloqueioUI(null);
    showThreadUI(false);
    marcarLinhaAtiva();
    if (!viaPopstate && history.state && history.state.chatPeer) { try { history.back(); } catch (e) { /* ignore */ } }
    agendarInbox(100);
}

/* ============================ botão "ir para o fim" ============================ */
function atualizarBotaoFim() {
    const btn = $('chat-jump'); if (!btn) return;
    const box = boxMsgs();
    const longe = box && !isNearBottom(box, 240);
    btn.classList.toggle('oculto', !longe && !T.novasAbaixo);
    const n = btn.querySelector('.chat-jump-n');
    if (n) { n.textContent = T.novasAbaixo > 99 ? '99+' : String(T.novasAbaixo || ''); n.classList.toggle('oculto', !T.novasAbaixo); }
}

/* ============================ agendar / anexar ============================ */
function toggleAgendar(forcar) {
    agendarAtivo = typeof forcar === 'boolean' ? forcar : !agendarAtivo;
    const box = $('chat-agendar-box'), btn = $('btn-toggle-agendar');
    if (box) box.classList.toggle('oculto', !agendarAtivo);
    if (btn) { btn.classList.toggle('btn-ok', agendarAtivo); btn.textContent = agendarAtivo ? '🗓️ Agendar msg (ativo)' : '🗓️ Agendar msg'; }
}
function fecharAnexar() { if (window.waAnexarMenu) window.waAnexarMenu(false); else { const s = $('wa-attach-sheet'); if (s) s.classList.add('oculto'); } }
function atualizarBackUnread() {
    const el = $('chat-back-unread'); if (!el) return;
    const n = contatosCache.reduce((s, c) => s + (c.auth_id !== T.peer ? (c.unread || 0) : 0), 0);
    el.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
    el.classList.toggle('oculto', !n);
}

/* ============================ painel Amigos (botão do topo da conversa) ============================ */
let amigosBuscaT = null, amigosDir = [];
/** Amigos aberto de dentro de uma conversa = "adicionar pessoa": DM → cria grupo (2 + nova pessoa); grupo → adiciona. */
function modoAddConversa() { return !!(T.peer && ChatStore.temGrupos()); }
function abrirAmigos() {
    const s = $('chat-amigos-sheet'); if (!s) return;
    fecharChatHeadMenu();
    const tit = $('amigos-titulo');
    if (tit) tit.textContent = modoAddConversa() ? (ehGrupoPeer(T.peer) ? 'Adicionar ao grupo' : 'Adicionar pessoa à conversa') : 'Amigos';
    s.classList.remove('oculto');
    const b = $('amigos-busca'); if (b) b.value = '';
    renderAmigos('');
}
function fecharAmigos() { const s = $('chat-amigos-sheet'); if (s) s.classList.add('oculto'); }
function amigoLinha(u, ja) {
    const nome = displayNome(u);
    const add = modoAddConversa();
    const membro = add && ehGrupoPeer(T.peer) && Array.isArray(T.grupoMembros) && T.grupoMembros.some(x => x.auth_id === u.auth_id);
    const naConversa = add && !ehGrupoPeer(T.peer) && u.auth_id === T.peer;
    let botoes;
    if (!add) botoes = '<button type="button" class="btn-sm" data-amigo="' + esc(u.auth_id) + '">' + (ja ? 'Conversar' : 'Adicionar') + '</button>';
    else if (membro || naConversa) botoes = '<span class="sub gk-amigo-ja">' + (membro ? 'no grupo' : 'nesta conversa') + '</span>';
    else botoes = '<button type="button" class="btn-sm btn-ghost-sm" data-amigo="' + esc(u.auth_id) + '">Conversar</button>' +
        '<button type="button" class="btn-sm" data-add-conv="' + esc(u.auth_id) + '">＋ Adicionar</button>';
    return '<div class="gk-amigo" data-auth="' + esc(u.auth_id) + '"><span class="wa-av mav" data-av-id="' + esc(u.auth_id) + '" data-av-nome="' + esc(nome) + '">' + esc(iniciais(nome)) + '</span>' +
        '<span class="gk-amigo-txt"><strong>' + esc(nome) + '</strong><span class="sub">' + esc(labelPapelCurto(u.papeis, u.tipo)) + '</span></span>' +
        '<span class="gk-amigo-bts">' + botoes + '</span></div>';
}
async function renderAmigos(termo) {
    const box = $('amigos-lista'); if (!box) return;
    const t = String(termo || '').trim().toLowerCase();
    const meus = contatosCache.filter(c => !c.ehGrupo).filter(c => !t || (c.nome || '').toLowerCase().includes(t) || (c.apelido || '').toLowerCase().includes(t) || (c.nomeReal || '').toLowerCase().includes(t));
    let html = meus.length ? '<div class="chat-group-title">Seus contatos</div>' + meus.map(c => amigoLinha(c, true)).join('') : '';
    box.innerHTML = html + (t ? '<p class="sub">Buscando…</p>' : (meus.length ? '' : '<p class="sub">Nenhum contato ainda. Busque por nome ou apelido.</p>'));
    if (!t) return;
    const pedido = t;
    amigosDir = await rpcDiretorio(t);
    if ((($('amigos-busca') || {}).value || '').trim().toLowerCase() !== pedido) return;
    const ja = new Set(contatosCache.filter(c => !c.ehGrupo).map(c => c.auth_id));
    const novos = amigosDir.filter(u => u.auth_id !== meuAuthId && !ja.has(u.auth_id));
    box.innerHTML = html + (novos.length ? '<div class="chat-group-title">Outras pessoas no Minera Pará</div>' + novos.map(u => amigoLinha(u, false)).join('')
        : (meus.length ? '' : '<p class="sub">Ninguém encontrado com esse nome.</p>'));
}
function bindAmigos() {
    const btn = $('btn-chat-amigos'); if (btn) btn.addEventListener('click', abrirAmigos);
    const s = $('chat-amigos-sheet');
    if (s) s.addEventListener('click', async (e) => {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-amigos')) { fecharAmigos(); return; }
        const bAdd = e.target.closest && e.target.closest('[data-add-conv]');
        if (bAdd) {
            const idA = bAdd.getAttribute('data-add-conv');
            const uA = contatosCache.find(x => x.auth_id === idA) || amigosDir.find(x => x.auth_id === idA);
            if (uA) { fecharAmigos(); await adicionarPessoaNaConversa(uA); }
            return;
        }
        const b = e.target.closest && e.target.closest('[data-amigo]');
        if (!b) return;
        const id = b.getAttribute('data-amigo');
        const c = contatosCache.find(x => x.auth_id === id);
        fecharAmigos();
        if (c) { abrirThread(c); return; }
        const u = amigosDir.find(x => x.auth_id === id);
        if (u) await adicionarContato(u);
    });
    const busca = $('amigos-busca');
    if (busca) busca.addEventListener('input', () => { clearTimeout(amigosBuscaT); amigosBuscaT = setTimeout(() => renderAmigos(busca.value), 250); });
    const add = $('btn-amigos-add'); if (add) add.addEventListener('click', () => { fecharAmigos(); abrirModalAdd(); });
}

/* ============================ grupos (SQL 55) ============================ */
function aplicarMembrosGrupo(ms) {
    if (!Array.isArray(ms) || !ehGrupoPeer(T.peer)) return;
    T.grupoMembros = ms;
    const nomes = ms.map(u => u.auth_id === meuAuthId ? 'Você' : displayNome(u));
    const eu = nomes.indexOf('Você'); if (eu > 0) { nomes.splice(eu, 1); nomes.push('Você'); }
    T.grupoLinha = nomes.join(', ');
    if (contatoAtivo) contatoAtivo.membros = ms.length;
    mostrarEstadoOutro(null);
    const sh = $('chat-grupo-sheet');
    if (sh && !sh.classList.contains('oculto')) renderGrupoSheet();
}
function nomeGrupoPadrao(nomes) {
    let n = nomes.filter(Boolean).join(', ');
    const i = n.lastIndexOf(', '); if (i > 0) n = n.slice(0, i) + ' e ' + n.slice(i + 2);
    return n.length > 60 ? n.slice(0, 57) + '…' : n;
}
async function abrirGrupoPorId(gid, nomeHint) {
    const key = 'g:' + gid;
    let c = contatosCache.find(x => x.auth_id === key);
    if (!c) { await atualizarInbox(); c = contatosCache.find(x => x.auth_id === key); }
    if (!c) c = { auth_id: key, grupo_id: gid, ehGrupo: true, nome: nomeHint || 'Grupo', papeis: [], tipo: '', last: null, unread: 0, peerLida: 0, peerEntregue: 0 };
    abrirThread(c);
}
async function adicionarPessoaNaConversa(u) {
    if (!u || !u.auth_id || !T.peer) return;
    const novo = displayNome(u);
    if (ehGrupoPeer(T.peer)) {
        const gNome = displayNome(contatoAtivo);
        if (!(await cxConfirm('Adicionar ' + novo + '?', novo + ' vai entrar no grupo "' + gNome + '" e ver as mensagens a partir de agora.', 'Adicionar'))) return;
        const r = await supabaseClient.rpc('chat_grupo_adicionar', { p_grupo: ChatStore.gid(T.peer), p_membros: [u.auth_id] });
        if (r.error) { toast('Erro: ' + r.error.message); return; }
        toast(Number(r.data || 0) ? novo + ' adicionado ao grupo' : novo + ' já está no grupo');
        sincronizarConversa(); agendarInbox(300);
        return;
    }
    const outro = contatoAtivo ? displayNome(contatoAtivo) : 'contato';
    if (!(await cxConfirm('Criar grupo?', 'Você, ' + outro + ' e ' + novo + ' vão conversar juntos num grupo novo. A conversa particular com ' + outro + ' continua separada.', 'Criar grupo'))) return;
    const nome = nomeGrupoPadrao([outro, novo, meuNomePublico()]);
    const r = await supabaseClient.rpc('chat_grupo_criar', { p_nome: nome, p_membros: [T.peer, u.auth_id] });
    if (r.error || !r.data) { toast('Não foi possível criar o grupo: ' + ((r.error && r.error.message) || '')); return; }
    if (window.MineraRT && MineraRT.atualizarGrupos) MineraRT.atualizarGrupos();
    toast('Grupo criado');
    await abrirGrupoPorId(r.data, nome);
}
function fecharGrupoSheet() { const s = $('chat-grupo-sheet'); if (s) s.classList.add('oculto'); }
function renderGrupoSheet() {
    const c = contatoAtivo && ehGrupoPeer(contatoAtivo.auth_id) ? contatoAtivo : null;
    const t = $('grp-sheet-nome'), sub = $('grp-sheet-sub'), box = $('grp-sheet-lista');
    if (t) t.textContent = c ? displayNome(c) : 'Grupo';
    const ms = T.grupoMembros;
    if (sub) sub.textContent = Array.isArray(ms) ? ms.length + ' participantes' : 'Carregando…';
    if (!box) return;
    if (!Array.isArray(ms)) { box.innerHTML = '<p class="sub">Carregando…</p>'; return; }
    box.innerHTML = ms.map(u => {
        const nome = u.auth_id === meuAuthId ? 'Você' : displayNome(u);
        return '<div class="gk-amigo"><span class="wa-av mav" data-av-id="' + esc(u.auth_id) + '" data-av-nome="' + esc(nome) + '">' + esc(iniciais(nome)) + '</span>' +
            '<span class="gk-amigo-txt"><strong>' + esc(nome) + '</strong><span class="sub">' + esc(labelPapelCurto(u.papeis, u.tipo)) + '</span></span></div>';
    }).join('');
}
async function abrirGrupoSheet(c) {
    fecharChatHeadMenu(); fecharRowSheet();
    if (c && (!contatoAtivo || contatoAtivo.auth_id !== c.auth_id)) await abrirThread(c);
    const s = $('chat-grupo-sheet'); if (!s) return;
    renderGrupoSheet();
    s.classList.remove('oculto');
    try { aplicarMembrosGrupo(await ChatStore.grupoMembros(T.peer)); } catch (e) { /* offline */ }
}
async function renomearGrupo() {
    if (!ehGrupoPeer(T.peer)) return;
    fecharChatHeadMenu();
    const atual = displayNome(contatoAtivo);
    const novo = (window.prompt('Nome do grupo', atual) || '').trim();
    if (!novo || novo === atual) return;
    const r = await supabaseClient.rpc('chat_grupo_renomear', { p_grupo: ChatStore.gid(T.peer), p_nome: novo.slice(0, 60) });
    if (r.error) { toast('Erro: ' + r.error.message); return; }
    contatoAtivo.nome = novo.slice(0, 60);
    $('chat-com-nome').textContent = contatoAtivo.nome;
    const c = contatosCache.find(x => x.auth_id === T.peer); if (c) c.nome = contatoAtivo.nome;
    renderLista(); renderGrupoSheet(); sincronizarConversa();
}
async function sairDoGrupo() {
    if (!ehGrupoPeer(T.peer)) return;
    fecharChatHeadMenu(); fecharGrupoSheet();
    const peer = T.peer, nome = displayNome(contatoAtivo);
    if (!(await cxConfirm('Sair do grupo?', 'Você sai de "' + nome + '" e não recebe mais as mensagens. Alguém do grupo pode adicionar você de novo.', 'Sair'))) return;
    const r = await supabaseClient.rpc('chat_grupo_sair', { p_grupo: ChatStore.gid(peer) });
    if (r.error) { toast('Erro: ' + r.error.message); return; }
    ChatStore.cacheThreadGravar(peer, []);
    contatosCache = contatosCache.filter(c => c.auth_id !== peer); renderLista();
    if (T.peer === peer) fecharConversa();
    if (window.MineraRT && MineraRT.atualizarGrupos) MineraRT.atualizarGrupos();
    toast('Você saiu do grupo');
    agendarInbox(300);
}
function bindGrupos() {
    const s = $('chat-grupo-sheet');
    if (s) s.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('[data-close-grupo]')) fecharGrupoSheet(); });
    const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    on('btn-grp-membros', () => abrirGrupoSheet(null));
    on('btn-grp-renomear', renomearGrupo);
    on('btn-grp-sair', sairDoGrupo);
    on('btn-op-add-pessoa', () => { fecharChatHeadMenu(); abrirAmigos(); });
    on('grp-sheet-add', () => { fecharGrupoSheet(); abrirAmigos(); });
    on('grp-sheet-renomear', () => { fecharGrupoSheet(); renomearGrupo(); });
    on('grp-sheet-sair', sairDoGrupo);
    const pill = $('btn-chat-menu');
    if (pill) pill.addEventListener('click', (e) => { if (ehGrupoPeer(T.peer)) { e.stopImmediatePropagation(); abrirGrupoSheet(null); } }, true);
}

/* ============================ eventos da tela ============================ */
function bindTela() {
    bindAmigos();
    bindGrupos();
    const form = $('form-chat');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); enviarMensagem(); });
    const input = $('chat-texto');
    if (input) {
        input.addEventListener('input', () => { autoCrescer(); avisarDigitando(); });
        input.addEventListener('keydown', (e) => {
            // Enter envia só com teclado físico; no celular Enter = nova linha (botão ➤ envia)
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !tecladoMobile()) { e.preventDefault(); enviarMensagem(); }
        });
        input.addEventListener('blur', () => setTimeout(pararDigitando, 300));
    }
    const send = $('btn-chat-enviar');
    // não tira o foco do campo (teclado continua aberto no celular)
    if (send) send.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
    if (send) send.addEventListener('mousedown', (e) => e.preventDefault());

    const arquivo = (id, fn) => {
        const el = $(id); if (!el) return;
        el.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            fecharAnexar();
            if (f) fn(f);
        });
    };
    arquivo('chat-foto', f => enviarMidia('imagem', f));
    arquivo('chat-foto-gal', f => enviarMidia('imagem', f));
    arquivo('chat-video', f => enviarMidia('video', f));
    arquivo('chat-audio-file', f => enviarMidia('audio', f));
    arquivo('chat-doc', f => enviarMidia(/^image\//.test(f.type) ? 'imagem' : 'documento', f));

    bindAudioButton();
    const btnCancelRec = $('btn-cancel-rec');
    if (btnCancelRec) btnCancelRec.addEventListener('click', () => stopRecording(true));
    const tog = $('btn-toggle-agendar'); if (tog) tog.addEventListener('click', () => toggleAgendar());
    const ag = $('btn-attach-agendar'); if (ag) ag.addEventListener('click', () => { fecharAnexar(); toggleAgendar(true); });

    const add = $('btn-add-contato'); if (add) add.addEventListener('click', abrirModalAdd);
    const fAdd = $('btn-fechar-add'); if (fAdd) fAdd.addEventListener('click', () => {
        if (ncGrupoModo) { ncGrupoModo = false; ncSel = new Set(); ncAtualizarTopo(); renderDiretorioList(diretorioCache, ncRole); return; } // seta sai do "Novo grupo" primeiro
        fecharModalAdd();
    });
    bindNovaConversa();
    let buscaT = null;
    const busca = $('chat-busca-contatos'); if (busca) busca.addEventListener('input', () => { clearTimeout(buscaT); buscaT = setTimeout(renderLista, 120); });
    let addBuscaT = null;
    const addBusca = $('add-busca'); if (addBusca) addBusca.addEventListener('input', () => { clearTimeout(addBuscaT); addBuscaT = setTimeout(() => carregarDiretorioAdd(addBusca.value.trim()), 300); });

    const back = $('btn-chat-back'); if (back) back.addEventListener('click', () => fecharConversa(false));
    window.addEventListener('popstate', () => {
        if (T.peer && !(history.state && history.state.chatPeer)) fecharConversa(true);
    });

    const lista = $('chat-contatos-list');
    if (lista) bindLongPressLista(lista);
    if (lista) lista.addEventListener('click', (e) => {
        const row = e.target.closest && e.target.closest('.wa-row[data-auth]');
        if (!row) return;
        const c = contatosCache.find(x => x.auth_id === row.getAttribute('data-auth'));
        if (c) abrirThread(c);
    });
    document.querySelectorAll('#wa-filter-chips .wa-chip').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('#wa-filter-chips .wa-chip').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        aplicarFiltroListaChat(btn.getAttribute('data-wa') || 'todas');
    }));

    const box = boxMsgs();
    if (box && window.ChatAudio) {
        ChatAudio.ligar(box);
        let obsT = 0;
        new MutationObserver(() => { if (obsT) return; obsT = setTimeout(() => { obsT = 0; ChatAudio.observar(box); }, 60); }).observe(box, { childList: true, subtree: true });
    }
    if (box) {
        let rafScroll = 0;
        box.addEventListener('scroll', () => {
            if (rafScroll) return;
            rafScroll = requestAnimationFrame(() => {
                rafScroll = 0;
                if (box.scrollTop < 400) carregarAntigas();
                T.pertoDoFim = isNearBottom(box);
                if (T.pertoDoFim && T.novasAbaixo) T.novasAbaixo = 0;
                atualizarBotaoFim();
            });
        }, { passive: true });
        box.addEventListener('click', (e) => {
            const r = e.target.closest && e.target.closest('[data-retry]');
            if (r) { reenviarUm(r.getAttribute('data-retry')); return; }
            if (e.target.closest && e.target.closest('[data-ligar]')) { ligarParaContato(); return; }
            const img = e.target.closest && e.target.closest('.bubble-media img');
            if (img && !img.closest('.bubble-media-loading') && window.MineraLightbox) {
                const imgs = Array.from(box.querySelectorAll('.bubble-media img')).filter(x => !x.closest('.bubble-media-loading') && x.getAttribute('src'));
                window.MineraLightbox.open(imgs.map(x => x.getAttribute('src')), Math.max(0, imgs.indexOf(img)));
            }
        });
        // mídia carregando depois do posicionamento aumenta a altura → mantém no fim se o usuário estava no fim
        const manterFim = (e) => {
            const t = e.target;
            if (!t || !/^(IMG|VIDEO|AUDIO)$/.test(t.tagName)) return;
            if (T.pertoDoFim && !T.carregandoAntigas) box.scrollTop = box.scrollHeight;
        };
        box.addEventListener('load', manterFim, true);
        box.addEventListener('loadedmetadata', manterFim, true);
        const clearLp = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } longPressStart = null; };
        box.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const m = msgFromBubbleEl(e.target);
            if (!m || m.deleted_at) return;
            if (e.target.closest && e.target.closest('audio, video, a, button, input, .au-wave')) return;
            longPressStart = { x: e.clientX, y: e.clientY, m };
            longPressTimer = setTimeout(() => { if (longPressStart) abrirMsgSheet(longPressStart.m); clearLp(); }, LONG_PRESS_MS);
        });
        box.addEventListener('pointermove', (e) => {
            if (!longPressStart) return;
            if (Math.abs(e.clientX - longPressStart.x) > 12 || Math.abs(e.clientY - longPressStart.y) > 12) clearLp();
        });
        box.addEventListener('pointerup', clearLp);
        box.addEventListener('pointercancel', clearLp);
        box.addEventListener('contextmenu', (e) => {
            const m = msgFromBubbleEl(e.target);
            if (!m || m.deleted_at) return;
            if (e.target.closest && e.target.closest('audio, video, a')) return;
            e.preventDefault(); abrirMsgSheet(m);
        });
        box.addEventListener('error', (e) => {
            const el = e.target;
            if (!el || el.tagName !== 'AUDIO' && el.tagName !== 'SOURCE') return;
            if (window.AudioCompat) return; // chat-audio.js tenta converter e só então avisa
            const wrap = el.closest && el.closest('.bubble-audio');
            if (!wrap || wrap.querySelector('.audio-err')) return;
            const d = document.createElement('div'); d.className = 'audio-err hint'; d.textContent = 'Não foi possível tocar este áudio.';
            wrap.appendChild(d);
        }, true);
    }
    const jump = $('chat-jump'); if (jump) jump.addEventListener('click', () => rolarFim(true));

    const sheet = $('chat-msg-sheet');
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-sheet')) fecharMsgSheet(); });
    const bResp = $('sheet-responder'); if (bResp) bResp.addEventListener('click', () => { const m = sheetMsg; fecharMsgSheet(); if (m) setReplyTo(m); });
    const bCop = $('sheet-copiar'); if (bCop) bCop.addEventListener('click', async () => { const t = textoCopiavel(sheetMsg); fecharMsgSheet(); if (t) toast((await copiarTexto(t)) ? 'Mensagem copiada' : 'Não foi possível copiar'); });
    const bMim = $('sheet-apagar-mim'); if (bMim) bMim.addEventListener('click', () => apagarMsgParaMim(sheetMsg));
    const bTodos = $('sheet-apagar-todos'); if (bTodos) bTodos.addEventListener('click', () => apagarMsgParaTodos(sheetMsg));
    const bCR = $('btn-cancel-reply'); if (bCR) bCR.addEventListener('click', () => setReplyTo(null, true));
    const bMenu = $('btn-chat-menu'); if (bMenu) bMenu.addEventListener('click', (e) => { e.stopPropagation(); toggleChatHeadMenu(); });
    const bOp = $('btn-chat-opcoes'); if (bOp) bOp.addEventListener('click', (e) => { e.stopPropagation(); toggleChatHeadMenu(); });
    const bLig = $('btn-chat-ligar'); if (bLig) bLig.addEventListener('click', (e) => { e.stopPropagation(); fecharChatHeadMenu(); ligarParaContato(); });
    const bAtu = $('btn-chat-atualizar'); if (bAtu) bAtu.addEventListener('click', (e) => { e.stopPropagation(); fecharChatHeadMenu(); atualizarConversaManual(); });
    const bAm = $('btn-op-amigo'); if (bAm) bAm.addEventListener('click', adicionarAmigoAtual);
    const bBl = $('btn-op-bloquear'); if (bBl) bBl.addEventListener('click', () => alternarBloqueio(T.peer));
    const bDes = $('btn-bloq-desbloquear'); if (bDes) bDes.addEventListener('click', () => alternarBloqueio(T.peer));
    const rs = $('chat-row-sheet');
    if (rs) rs.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('[data-close-row]')) fecharRowSheet(); });
    const rA = $('row-apagar'); if (rA) rA.addEventListener('click', () => apagarConversa(rowSheetPeer));
    const rB = $('row-bloquear'); if (rB) rB.addEventListener('click', () => alternarBloqueio(rowSheetPeer));
    const bHM = $('btn-apagar-hist-mim'); if (bHM) bHM.addEventListener('click', apagarConversaParaMim);
    const bHT = $('btn-apagar-hist-todos'); if (bHT) bHT.addEventListener('click', apagarHistoricoParaTodos);
    document.addEventListener('click', (e) => {
        const menu = $('chat-head-menu');
        if (!menu || menu.classList.contains('oculto')) return;
        if (e.target.closest && (e.target.closest('#chat-head-menu') || e.target.closest('#btn-chat-menu') || e.target.closest('#btn-chat-opcoes'))) return;
        fecharChatHeadMenu();
    });
    document.addEventListener('visibilitychange', () => { if (visivel()) marcarLidoSeVisivel(); });
}

/* ============================ tempo real + reserva ============================ */
function ligarTempoReal() {
    if (!window.MineraRT) return;
    MineraRT.start(meuAuthId);
    MineraRT.on('msg', (ev) => receberRow(ev.row));
    MineraRT.on('leitura', (r) => {
        const peer = r.auth_id;
        const lida = Number(r.ultima_lida_id || 0), ent = Math.max(Number(r.ultima_entregue_id || 0), lida);
        const c = contatosCache.find(x => x.auth_id === peer);
        if (c && (lida > (c.peerLida || 0) || ent > (c.peerEntregue || 0))) {
            c.peerLida = Math.max(c.peerLida || 0, lida); c.peerEntregue = Math.max(c.peerEntregue || 0, ent);
            renderLista();
        }
        if (peer === T.peer && (lida > T.peerLida || ent > T.peerEntregue)) {
            T.peerLida = Math.max(T.peerLida, lida); T.peerEntregue = Math.max(T.peerEntregue, ent);
            atualizarTicks();
        }
    });
    const ressync = () => { if (T.peer) sincronizarConversa(); agendarInbox(200); reenviarFila(); };
    MineraRT.on('resync', ressync);
    MineraRT.on('visivel', ressync);
    MineraRT.on('online', ressync);
}
function loopReserva() {
    setInterval(() => {
        if (!visivel() || !meuAuthId) return;
        const live = !!(window.MineraRT && MineraRT.isLive());
        const agora = Date.now();
        if (T.peer && agora - T.ultimoSync > (live ? 45000 : 4000)) sincronizarConversa();
        if (agora - ultimoInboxPoll > (live ? 90000 : 12000)) atualizarInbox();
    }, 2000);
    window.addEventListener('online', () => reenviarFila());
}

/* Pinta a lista do cache antes de qualquer rede (último usuário deste aparelho) */
(function pintarDoCache() {
    try {
        const uid = localStorage.getItem('minera_chat_last_uid');
        if (!uid) return;
        meuAuthId = uid;
        ChatStore.setUid(uid);
        const c = ChatStore.cacheInboxLer();
        const l = c && Array.isArray(c.l) ? c.l : null;
        if (l && l.length) {
            contatosCache = l;
            renderLista();
            window.__chatPerf.inboxCacheMs = Math.round(performance.now());
        }
    } catch (e) { /* ignore */ }
})();

async function init() {
    bindTela();
    const session = await requireSession();
    if (!session) return;
    if (meuAuthId && meuAuthId !== session.user.id) { contatosCache = []; renderLista(); }
    meuAuthId = session.user.id;
    ChatStore.setUid(meuAuthId);
    try { localStorage.setItem('minera_chat_last_uid', meuAuthId); } catch (e) { /* ignore */ }
    ligarTempoReal();
    const [perfil] = await Promise.all([getPerfil(session), atualizarInbox(),
        (typeof AntiGolpe !== 'undefined' && AntiGolpe.carregarFlagContatos) ? AntiGolpe.carregarFlagContatos(true) : null]);
    perfilAtual = perfil;
    aplicarUserLabel(perfilAtual);
    montarNav('chat', perfilAtual);
    loteCtx = lerQuery('lote') || null;
    const ctxEl = $('chat-lote-ctx');
    if (loteCtx && ctxEl) {
        ctxEl.textContent = 'Negociando lote: ' + loteCtx;
        ctxEl.classList.remove('oculto');
        const input = $('chat-texto');
        if (input && !input.value) input.placeholder = 'Mensagem sobre o lote ' + loteCtx + '...';
    }
    const grupoQ = lerQuery('grupo');
    const para = grupoQ ? '' : lerParaQuery();
    if (grupoQ && /^[0-9a-f-]{36}$/i.test(grupoQ)) abrirGrupoPorId(grupoQ);
    if (para && para !== meuAuthId) {
        let c = contatosCache.find(x => x.auth_id === para);
        if (!c) {
            const perfis = await ChatStore.perfis([para]);
            const p = perfis[0] || { auth_id: para, nome: 'Contato', papeis: [], tipo: '' };
            c = { auth_id: para, nome: displayNome(p), papeis: p.papeis || [], tipo: p.tipo || '', apelido: p.apelido || null };
        }
        abrirThread(c, { semHistorico: true });
    }
    preencherLocalizacaoNoComposer(lerLocalizacaoQuery());
    reenviarFila();
    ChatStore.promoverAgendadasVencidas();
    if (window.MineraNotif && MineraNotif.start) MineraNotif.start(meuAuthId);
    // Web Push: faixa "Ativar notificações" (só se ainda não decidiu) / dica do iPhone
    if (window.MineraPush) { const lst = $('chat-contatos-list'); if (lst && lst.parentNode) MineraPush.montarFaixaChat(lst.parentNode, lst); }
    loopReserva();
}
init();

window.addEventListener('beforeunload', () => { stopAudioTimer(); salvarCacheConversa(); });

/* ---- Teclado (visualViewport): mantém o composer acima do teclado e só gruda no fim se já estava no fim ---- */
(function bindChatKeyboardSafe() {
    let estavaNoFim = true;
    function measureComposer() {
        const form = $('form-chat');
        if (!form || form.classList.contains('oculto')) return;
        const h = Math.ceil(form.getBoundingClientRect().height) || 58;
        document.documentElement.style.setProperty('--composer-h', h + 'px');
    }
    function syncKbInset() {
        const vv = window.visualViewport;
        const box = boxMsgs();
        const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
        document.documentElement.style.setProperty('--kb-inset', inset + 'px');
        // conversa em tela cheia = exatamente a área visível (teclado aberto ou não)
        document.documentElement.style.setProperty('--vvh', (vv ? Math.round(vv.height) : window.innerHeight) + 'px');
        document.documentElement.style.setProperty('--vvtop', (vv ? Math.round(vv.offsetTop) : 0) + 'px');
        measureComposer();
        if (box && estavaNoFim && document.body.classList.contains('chat-thread-open')) box.scrollTop = box.scrollHeight;
    }
    function lembrar() { const box = boxMsgs(); estavaNoFim = isNearBottom(box, 80); }
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', syncKbInset); window.visualViewport.addEventListener('scroll', () => { const v = window.visualViewport; document.documentElement.style.setProperty('--vvtop', Math.round(v.offsetTop) + 'px'); }); }
    window.addEventListener('resize', syncKbInset);
    window.addEventListener('orientationchange', () => setTimeout(syncKbInset, 120));
    const box = boxMsgs();
    if (box) box.addEventListener('scroll', lembrar, { passive: true });
    document.addEventListener('focusin', (e) => { if (e.target && e.target.id === 'chat-texto') { lembrar(); setTimeout(syncKbInset, 60); setTimeout(syncKbInset, 320); } }, true);
    document.addEventListener('focusout', () => setTimeout(syncKbInset, 60));
    const form = $('form-chat');
    if (form && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => { measureComposer(); if (estavaNoFim) { const b = boxMsgs(); if (b) b.scrollTop = b.scrollHeight; } }).observe(form);
    }
    syncKbInset();
})();
