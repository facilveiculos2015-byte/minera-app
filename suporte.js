/**
 * Fale conosco — Robô Minera (FAQ por keywords) + fila para humano.
 * Depende de: config.js, supabaseClient, getPerfil/session helpers.
 */

const SUPORTE_PONTOS_POR_REAL = 10; // 1 ponto = R$ 0,10 → 10 pts = R$ 1
const SUPORTE_REF_PREMIO = 100;    // pontos ao indicar (cadastro via /c/CODIGO ou ?ref=)

const FAQ_INTENTS = [
    {
        id: 'lotes',
        keys: ['lote', 'lotes', 'marketplace', 'vender', 'comprar', 'postar', 'feed', 'anuncio', 'anúncio'],
        reply: '📦 **Lotes** — No Feed você vê o marketplace. Em **Meus Lotes** (chip Novo / Lotes) você cadastra quantidade, tipo de minério, preço e foto. Marque como **Vendido** quando fechar a venda. No Perfil você pode apoiar o app com a **vaquinha Pix voluntária** (qualquer valor, sem obrigação).'
    },
    {
        id: 'mapa',
        keys: ['mapa', 'satelite', 'satélite', 'coordenada', 'gps', 'localizacao', 'localização'],
        reply: '🗺️ **Mapa** — Abra o chip Mapa no topo. Lotes com coordenadas aparecem no mapa. Ao cadastrar/editar o lote, você pode informar lat/lng.'
    },
    {
        id: 'pix',
        keys: ['pix', 'pagamento', 'pagar', 'qr', 'comprovante', 'nubank', 'comissao pix', 'comissão pix'],
        reply: '💠 **Pix** — A chave Pix do app fica no **Perfil** (QR / Copia e Cola). Use para a **vaquinha voluntária** (qualquer valor, sem obrigação) e para depósitos do Minera Bank (o admin confirma o crédito).'
    },
    {
        id: 'comissao',
        keys: ['comissao', 'comissão', '1%', 'um por cento', 'taxa', 'percentual'],
        reply: '💛 **Vaquinha Pix** — No Perfil você pode fazer um Pix de **qualquer valor** para ajudar a desenvolver o Minera Pará e deixar compra e venda cada vez mais seguras. É voluntário, sem obrigação. Pontos da Família Minera continuam valendo nos benefícios do app.'
    },
    {
        id: 'caixa',
        keys: ['caixa', 'depositar', 'deposito', 'depósito', 'sacar', 'saque', 'emprestimo', 'empréstimo', 'saldo', 'yield', 'pin'],
        reply: '🏦 **Minera Bank** — Ícone de banco no header. Você pode **depositar** (Pix + comprovante), **sacar** (informe chave destino) e solicitar **empréstimo** (análise do admin). Há PIN próprio do Caixa e yield configurável até 5% a.m. conforme cotação/config.'
    },
    {
        id: 'chat',
        keys: ['chat', 'golpe', 'anti-golpe', 'mensagem', 'conversa', 'whatsapp', 'fraude'],
        reply: '💬 **Chat anti-golpe** — Negocie pelo Chat do app. O anti-golpe alerta sobre pedidos de pagamento fora da plataforma e dados sensíveis. Prefira Pix oficial do app e nunca compartilhe senha/PIN.'
    },
    {
        id: 'papeis',
        keys: ['papel', 'papeis', 'papéis', 'perfil', 'minerador', 'comprador', 'transportador', 'britador', 'carregamento'],
        reply: '👤 **Papéis** — Em Perfil você marca um ou mais papéis (minerador, comprador, transportador, dono de britador…). Isso libera o que faz sentido pra você (Lotes, Frete, Britagem…).'
    },
    {
        id: 'frete',
        keys: ['frete', 'logistica', 'logística', 'transporte', 'caminhao', 'caminhão', 'rota'],
        reply: '🚛 **Frete** — Em Serviços → Frete você registra fretes (origem, destino, valor, status). Transportadores veem Frete conforme o papel.'
    },
    {
        id: 'britagem',
        keys: ['britagem', 'britador', 'processamento', 'processar', 'moagem'],
        reply: '🪨 **Britagem** — Dono de britador usa Serviços → Britagem para configurar e acompanhar o processamento dos lotes.'
    },
    {
        id: 'tutorial',
        keys: ['tutorial', 'ajuda', 'como usar', 'primeiros passos', 'guia', 'comecar', 'começar'],
        reply: '📖 **Tutorial** — Abra Mais → Tutorial (ou o botão no Perfil) para um guia rápido do Minera Pará: lotes, chat, Pix, Caixa e papéis.'
    },
    {
        id: 'indicacao',
        keys: ['indicacao', 'indicação', 'familia', 'família', 'convidar', 'referral', 'pontos', 'renda extra', 'codigo', 'código'],
        reply: '⛏️ **Família Minera** — Convide colegas com seu link/código. Cada cadastro com seu código rende pontos. **1 ponto = R$ 0,10** de desconto na comissão de 1% (máximo = valor total da comissão). Toque na barra Família Minera no Feed ou Perfil para ver código, pontos e compartilhar o convite (mensagem + card).'
    }
];

function suporteEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function suporteMatchFaq(texto) {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!t.trim()) return { intent: null, confidence: 0, reply: null };
    let best = null;
    let bestScore = 0;
    FAQ_INTENTS.forEach(intent => {
        let score = 0;
        intent.keys.forEach(k => {
            const kn = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (t.indexOf(kn) >= 0) score += kn.length >= 5 ? 2 : 1;
        });
        if (score > bestScore) {
            bestScore = score;
            best = intent;
        }
    });
    if (!best || bestScore < 1) {
        return {
            intent: null,
            confidence: 0,
            reply: 'Não tenho certeza sobre isso 🤔 Posso ajudar com: lotes, mapa, Pix, comissão 1%, Caixa (depositar/sacar/empréstimo), chat anti-golpe, papéis, frete, britagem, tutorial e indicação. Ou toque em **Falar com humano**.'
        };
    }
    const confidence = bestScore >= 2 ? 0.9 : 0.55;
    return { intent: best.id, confidence, reply: best.reply };
}

function suporteFmtMsg(texto) {
    return suporteEsc(texto).replace(/\*\*(.+?)\*\*/g, '<strong>$1<\/strong>').replace(/\n/g, '<br>');
}

async function suporteSalvarMsg({ de_auth_id, de_nome, texto, origem, thread_auth_id }) {
    try {
        const row = {
            de_auth_id: de_auth_id || null,
            de_nome: de_nome || null,
            texto: String(texto || '').slice(0, 4000),
            origem: origem || 'user',
            thread_auth_id: thread_auth_id
        };
        const { error } = await supabaseClient.from('suporte_mensagens').insert([row]);
        if (error) {
            console.warn('suporte insert:', error.message);
            if (/relation|suporte_mensagens|schema cache|does not exist/i.test(error.message || '')) {
                if (typeof toastMsg === 'function') toastMsg('Aplique o SQL 16-suporte-indicacao.sql');
            }
            return false;
        }
        return true;
    } catch (e) {
        console.warn(e);
        return false;
    }
}

function garantirSuporteUi() {
    // Só o modal. O botão "Fale conosco" existe apenas no Perfil (#card-fale-conosco
    // em perfil.html) — nenhuma outra página recebe botão/FAB injetado.
    if (document.getElementById('modal-suporte')) return;

    const modal = document.createElement('div');
    modal.id = 'modal-suporte';
    modal.className = 'modal oculto';
    modal.innerHTML =
        '<div class="modal-backdrop" data-close-suporte="1"></div>' +
        '<div class="modal-panel suporte-panel" role="dialog" aria-label="Fale conosco">' +
        '<div class="modal-head"><h3>💬 Fale conosco</h3>' +
        '<button type="button" class="btn-ghost" id="btn-fechar-suporte" aria-label="Fechar">✕</button></div>' +
        '<p class="sub suporte-intro">Robô Minera responde dúvidas frequentes. Se precisar, fale com um humano.</p>' +
        '<div id="suporte-msgs" class="suporte-msgs" aria-live="polite"></div>' +
        '<div class="suporte-actions">' +
        '<button type="button" class="btn-sm" id="btn-suporte-humano">Falar com humano</button>' +
        '</div>' +
        '<form id="form-suporte" class="suporte-form">' +
        '<input type="text" id="suporte-input" placeholder="Digite sua dúvida…" maxlength="1000" autocomplete="off" required>' +
        '<button type="submit" class="btn-ok">Enviar</button>' +
        '</form>' +
        '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute('data-close-suporte') === '1') fecharSuporte();
    });
    document.getElementById('btn-fechar-suporte').addEventListener('click', fecharSuporte);
    document.getElementById('form-suporte').addEventListener('submit', onSuporteSubmit);
    document.getElementById('btn-suporte-humano').addEventListener('click', onSuporteHumano);
}

let _suportePerfil = null;
let _suportePoll = null;
let _suporteLastId = 0;

function suporteCtx() {
    const authId = (_suportePerfil && _suportePerfil.auth_id)
        || (typeof sessionAtual !== 'undefined' && sessionAtual && sessionAtual.user && sessionAtual.user.id)
        || null;
    const nome = (_suportePerfil && _suportePerfil.nome) || 'Usuário';
    return { authId, nome };
}

async function abrirSuporte(perfil) {
    if (perfil) _suportePerfil = perfil;
    garantirSuporteUi();
    const modal = document.getElementById('modal-suporte');
    if (modal) modal.classList.remove('oculto');
    await carregarSuporteMsgs(true);
    if (_suportePoll) clearInterval(_suportePoll);
    _suportePoll = setInterval(() => carregarSuporteMsgs(false), 8000);
    const inp = document.getElementById('suporte-input');
    if (inp) setTimeout(() => inp.focus(), 100);
}

function fecharSuporte() {
    const modal = document.getElementById('modal-suporte');
    if (modal) modal.classList.add('oculto');
    if (_suportePoll) {
        clearInterval(_suportePoll);
        _suportePoll = null;
    }
}

function renderSuporteMsgs(rows) {
    const box = document.getElementById('suporte-msgs');
    if (!box) return;
    if (!rows || !rows.length) {
        box.innerHTML = '<div class="suporte-bubble bot"><div class="suporte-meta">Robô Minera</div>' +
            '<div>Olá! Sou o <strong>Robô Minera</strong> 🤖 Pergunte sobre lotes, mapa, Pix, comissão, Caixa, chat, papéis, frete, britagem ou tutorial.</div></div>';
        return;
    }
    box.innerHTML = rows.map(m => {
        const cls = m.origem === 'user' ? 'user' : (m.origem === 'admin' ? 'admin' : 'bot');
        const who = m.origem === 'user' ? (m.de_nome || 'Você')
            : (m.origem === 'admin' ? (m.de_nome || 'Suporte') : 'Robô Minera');
        return '<div class="suporte-bubble ' + cls + '"><div class="suporte-meta">' + suporteEsc(who) +
            '</div><div>' + suporteFmtMsg(m.texto) + '</div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
}

async function carregarSuporteMsgs(force) {
    const { authId } = suporteCtx();
    if (!authId) return;
    try {
        let { data, error } = await supabaseClient
            .from('suporte_mensagens')
            .select('id, de_auth_id, de_nome, texto, origem, criado_em, deleted_at, arquivado')
            .eq('thread_auth_id', authId)
            .order('criado_em', { ascending: true })
            .limit(100);
        if (error && /deleted_at|arquivado|column/i.test(error.message || '')) {
            const fb = await supabaseClient
                .from('suporte_mensagens')
                .select('id, de_auth_id, de_nome, texto, origem, criado_em')
                .eq('thread_auth_id', authId)
                .order('criado_em', { ascending: true })
                .limit(100);
            data = fb.data;
            error = fb.error;
        }
        if (error) {
            if (force) renderSuporteMsgs([]);
            return;
        }
        const rows = (data || []).filter(m => !m.deleted_at && !m.arquivado);
        const maxId = rows.reduce((a, r) => Math.max(a, r.id || 0), 0);
        if (force || maxId !== _suporteLastId) {
            _suporteLastId = maxId;
            renderSuporteMsgs(rows);
        }
    } catch (e) {
        console.warn(e);
    }
}

async function onSuporteSubmit(e) {
    e.preventDefault();
    const inp = document.getElementById('suporte-input');
    const texto = (inp && inp.value || '').trim();
    if (!texto) return;
    const { authId, nome } = suporteCtx();
    if (!authId) {
        if (typeof toastMsg === 'function') toastMsg('Faça login para usar o suporte');
        return;
    }
    inp.value = '';
    await suporteSalvarMsg({
        de_auth_id: authId,
        de_nome: nome,
        texto,
        origem: 'user',
        thread_auth_id: authId
    });
    const match = suporteMatchFaq(texto);
    let botText = match.reply;
    if (match.confidence < 0.5) {
        botText += '\n\nDeixei sua mensagem para a equipe. Ou toque em **Falar com humano**.';
    }
    await suporteSalvarMsg({
        de_auth_id: authId,
        de_nome: 'Robô Minera',
        texto: botText,
        origem: 'bot',
        thread_auth_id: authId
    });
    await carregarSuporteMsgs(true);
}

async function onSuporteHumano() {
    const { authId, nome } = suporteCtx();
    if (!authId) return;
    const nota = '📣 Solicitação: falar com humano. Aguardando atendimento.';
    await suporteSalvarMsg({
        de_auth_id: authId,
        de_nome: nome,
        texto: nota,
        origem: 'user',
        thread_auth_id: authId
    });
    await suporteSalvarMsg({
        de_auth_id: authId,
        de_nome: 'Robô Minera',
        texto: 'Certo! Deixei um aviso para o time de suporte. Assim que um humano responder, a mensagem aparece aqui (atualiza sozinho).',
        origem: 'bot',
        thread_auth_id: authId
    });
    await carregarSuporteMsgs(true);
    if (typeof toastMsg === 'function') toastMsg('Mensagem enviada ao suporte');
}

/** Chamado por nav.js. Só ativa no Perfil (usuário comum / modo usuário). */
function garantirFaleConosco(perfil) {
    if (perfil) _suportePerfil = perfil;
    const body = document.body;
    const noPerfil = body && body.classList.contains('pagina-perfil');
    const noAdmin = body && (body.classList.contains('pagina-admin') || body.classList.contains('modo-ui-admin'));
    // Limpa qualquer FAB legado (cache antigo) fora do card do Perfil
    document.querySelectorAll('.btn-fale-float, .header-actions #btn-fale-conosco').forEach((el) => el.remove());
    const card = document.getElementById('card-fale-conosco');
    if (!noPerfil || noAdmin || !card) {
        if (card) card.classList.add('oculto');
        return;
    }
    card.classList.remove('oculto');
    const btn = document.getElementById('btn-fale-conosco');
    if (btn && !btn._faleBound) {
        btn._faleBound = true;
        btn.addEventListener('click', () => abrirSuporte(_suportePerfil));
    }
}

/* —— Família Minera / indicação —— */

function gerarCodigoIndicacao() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'MIN';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

const INDICACAO_BASE = 'https://facilveiculos2015-byte.github.io/minera-app';
const SHARE_OG_IMAGE_DEFAULT = INDICACAO_BASE + '/og-familia.png?v=20260923aq';
const SHARE_VIDEO_DEFAULT = 'media/convite-familia-minera.mp4?v=20260923aq';
const SHARE_FRASE_PADRAO_DEFAULT =
    'Cadastre-se no Minera Pará para negociar com mais segurança — cada um vê só a própria conta. Sem misturar perfis: o que é seu fica na sua área.';
const SHARE_OG_DESC_SEM_NOME =
    'Te chamaram pra negociar com mais segurança no Minera Pará. Cadastre-se — cada um vê só a própria conta.';

let _shareFrasePadrao = SHARE_FRASE_PADRAO_DEFAULT;
let _shareOgImageUrl = SHARE_OG_IMAGE_DEFAULT;
let _shareFlagsLoaded = false;

function linkIndicacao(codigo) {
    const code = String(codigo || '').trim().toUpperCase();
    // Link curto e brandável: /c/CODIGO → 404.html (OG) → cadastro + welcome
    return INDICACAO_BASE + '/c/' + encodeURIComponent(code || '');
}

function shareNomeFromPerfil(perfil) {
    if (!perfil) return '';
    const n = (perfil.apelido || perfil.nome || '').trim();
    return n;
}

function shareOgDescription(nome) {
    const n = String(nome || '').trim();
    if (n) {
        return n + ' te chamou pra negociar com mais segurança. Cadastre-se no Minera Pará — cada um vê só a própria conta.';
    }
    return SHARE_OG_DESC_SEM_NOME;
}

/**
 * Texto mínimo do convite (o vídeo já fala).
 * opts: { nome } → "{nome} te convidou pra Família Minera.\n{link}"
 */
function textoCompartilharIndicacao(codigo, opts) {
    opts = opts || {};
    const code = String(codigo || '').trim().toUpperCase() || '……';
    const link = linkIndicacao(code);
    const nome = String(opts.nome != null ? opts.nome : '').trim();
    /* Texto mínimo: o vídeo já fala. Só quem convida + link. */
    if (nome) return nome + ' te convidou pra Família Minera.\n' + link;
    return link;
}

async function carregarShareFlags() {
    if (_shareFlagsLoaded) return;
    _shareFlagsLoaded = true;
    try {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
        const { data, error } = await supabaseClient
            .from('app_flags')
            .select('key,value_text')
            .in('key', ['share_frase_padrao', 'share_og_image_url']);
        if (error) {
            // SQL 35 ainda não aplicado — constantes locais
            console.warn('share flags:', error.message);
            return;
        }
        (data || []).forEach((r) => {
            if (r.key === 'share_frase_padrao' && r.value_text && String(r.value_text).trim()) {
                _shareFrasePadrao = String(r.value_text).trim();
            }
            if (r.key === 'share_og_image_url' && r.value_text && String(r.value_text).trim()) {
                _shareOgImageUrl = String(r.value_text).trim();
            }
        });
    } catch (e) {
        console.warn('share flags', e);
    }
}

async function garantirCodigoIndicacao(perfil) {
    if (!perfil || !perfil.auth_id) return perfil;
    if (perfil.codigo_indicacao) return perfil;
    for (let tentativa = 0; tentativa < 5; tentativa++) {
        const codigo = gerarCodigoIndicacao();
        const { data, error } = await supabaseClient
            .from('usuarios')
            .update({ codigo_indicacao: codigo })
            .eq('auth_id', perfil.auth_id)
            .is('codigo_indicacao', null)
            .select('codigo_indicacao, pontos_saldo')
            .maybeSingle();
        if (!error && data && data.codigo_indicacao) {
            perfil.codigo_indicacao = data.codigo_indicacao;
            if (data.pontos_saldo != null) perfil.pontos_saldo = data.pontos_saldo;
            return perfil;
        }
        // já tinha código ou race — releia
        const { data: again } = await supabaseClient
            .from('usuarios')
            .select('codigo_indicacao, pontos_saldo')
            .eq('auth_id', perfil.auth_id)
            .maybeSingle();
        if (again && again.codigo_indicacao) {
            perfil.codigo_indicacao = again.codigo_indicacao;
            perfil.pontos_saldo = again.pontos_saldo != null ? Number(again.pontos_saldo) : 0;
            return perfil;
        }
        if (error && /codigo_indicacao|column|schema cache/i.test(error.message || '')) {
            console.warn('SQL 16 necessário:', error.message);
            return perfil;
        }
    }
    return perfil;
}

function htmlCardFamilia(perfil) {
    const pts = perfil && perfil.pontos_saldo != null ? Number(perfil.pontos_saldo) : 0;
    const codigo = (perfil && perfil.codigo_indicacao) || '…';
    const link = linkIndicacao(codigo);
    const nome = shareNomeFromPerfil(perfil);
    const desconto = (pts * 0.1).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const previewText = textoCompartilharIndicacao(codigo, { nome: nome });
    const ogDesc = shareOgDescription(nome);
    const ogImg = _shareOgImageUrl || SHARE_OG_IMAGE_DEFAULT;
    return (
        '<section class="card familia-card familia-collapsed" id="card-familia-mineira">' +
        '<button type="button" class="familia-bar" id="btn-familia-toggle" aria-expanded="false" aria-controls="familia-panel">' +
        '<span class="familia-bar-icon" aria-hidden="true">⛏️</span>' +
        '<span class="familia-bar-text">Faça parte da Família Minera — venha trabalhar conosco e tenha renda extra</span>' +
        '<span class="familia-bar-chevron" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="familia-panel" id="familia-panel" hidden>' +
        '<h2 class="familia-panel-title">Família Minera</h2>' +
        '<p class="sub">Indique colegas: ao se cadastrarem com seu link, você ganha pontos. ' +
        '<strong>1 ponto = R$ 0,10</strong> de desconto na comissão de 1% (máx. = valor da comissão).</p>' +
        '<div class="familia-stats">' +
        '<div class="familia-stat"><span class="familia-stat-val" id="familia-pontos">' + pts +
        '</span><span class="familia-stat-lbl">pontos</span></div>' +
        '<div class="familia-stat"><span class="familia-stat-val">' + desconto +
        '</span><span class="familia-stat-lbl">desconto disponível</span></div>' +
        '</div>' +
        '<div class="familia-og-card" aria-hidden="true">' +
        '<img class="familia-og-logo" src="' + suporteEsc(ogImg) + '" alt="" width="72" height="72" loading="lazy">' +
        '<div class="familia-og-meta">' +
        '<strong class="familia-og-title">Minera Pará</strong>' +
        '<p class="familia-og-desc" id="familia-og-desc">' + suporteEsc(ogDesc) + '</p>' +
        '</div></div>' +
        '<label for="familia-msg-custom">Mensagem (opcional)</label>' +
        '<textarea id="familia-msg-custom" rows="3" maxlength="500" placeholder="Deixe vazio para usar a frase padrão de privacidade/cadastro…"></textarea>' +
        '<input type="hidden" id="familia-nome" value="' + suporteEsc(nome) + '">' +
        '<label for="familia-codigo">Seu código</label>' +
        '<div class="familia-share-row">' +
        '<input type="text" id="familia-codigo" readonly value="' + suporteEsc(codigo) + '">' +
        '<button type="button" class="btn-sm btn-ok btn-wa-share" id="btn-compartilhar-ref">Compartilhar convite (vídeo)</button>' +
        '<button type="button" class="btn-sm" id="btn-copiar-ref">Copiar texto</button>' +
        '</div>' +
        '<input type="hidden" id="familia-link" value="' + suporteEsc(link) + '">' +
        '<p class="sub familia-link-hint" id="familia-link-hint">' + suporteEsc(link) + '</p>' +
        '<details class="familia-share-preview" open>' +
        '<summary>Prévia da mensagem</summary>' +
        '<pre class="familia-share-text" id="familia-share-text">' + suporteEsc(previewText) + '</pre>' +
        '</details>' +
        '</div>' +
        '</section>'
    );
}

function setFamiliaExpanded(expanded) {
    const card = document.getElementById('card-familia-mineira');
    const panel = document.getElementById('familia-panel');
    const btn = document.getElementById('btn-familia-toggle');
    if (!card || !panel || !btn) return;
    card.classList.toggle('familia-collapsed', !expanded);
    card.classList.toggle('familia-expanded', !!expanded);
    panel.hidden = !expanded;
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function familiaSharePayload(perfilOpt) {
    let codigo = ((document.getElementById('familia-codigo') || {}).value || '').trim().toUpperCase();
    let link = (document.getElementById('familia-link') || {}).value || '';
    let nome = ((document.getElementById('familia-nome') || {}).value || '').trim();
    const mensagem = ((document.getElementById('familia-msg-custom') || {}).value || '').trim();
    const shareCard = document.getElementById('card-compartilhar');
    if ((!codigo || codigo === '…') && shareCard) {
        codigo = (shareCard.getAttribute('data-codigo') || '').trim().toUpperCase() || codigo;
        link = shareCard.getAttribute('data-link') || link;
        nome = (shareCard.getAttribute('data-nome') || nome || '').trim();
    }
    if ((!codigo || codigo === '…') && perfilOpt) {
        codigo = String(perfilOpt.codigo_indicacao || '').trim().toUpperCase();
        nome = nome || shareNomeFromPerfil(perfilOpt);
    }
    if (!link) link = linkIndicacao(codigo);
    const text = textoCompartilharIndicacao(codigo, { nome: nome, mensagem: mensagem });
    return { codigo, link, text, nome, mensagem };
}

function atualizarFamiliaSharePreview() {
    const pre = document.getElementById('familia-share-text');
    const desc = document.getElementById('familia-og-desc');
    if (!pre && !desc) return;
    const { text, nome } = familiaSharePayload();
    if (pre) pre.textContent = text;
    if (desc) desc.textContent = shareOgDescription(nome);
}

async function copiarTextoIndicacao() {
    const { text, link } = familiaSharePayload();
    try {
        await navigator.clipboard.writeText(text);
        if (typeof toastMsg === 'function') toastMsg('Mensagem de indicação copiada!');
        else alert('Copiado!\n\n' + text);
        return true;
    } catch (e) {
        try {
            await navigator.clipboard.writeText(link);
            if (typeof toastMsg === 'function') toastMsg('Link copiado (texto bloqueado pelo navegador)');
            else prompt('Copie o link:', link);
            return true;
        } catch (e2) {
            prompt('Copie a mensagem:', text);
            return false;
        }
    }
}

/**
 * Primary CTA: open WhatsApp directly with invite text+link.
 * Desktop: wa.me still opens WhatsApp Web; clipboard only if open fails.
 */

async function familiaShareImageFile() {
    const url = (_shareOgImageUrl || SHARE_OG_IMAGE_DEFAULT || '').split('?')[0];
    if (!url) return null;
    try {
        const bust = url + (url.includes('?') ? '&' : '?') + 'share=1&v=20260923aq';
        const res = await fetch(bust, { mode: 'cors', cache: 'no-store' });
        if (!res.ok) return null;
        const blob = await res.blob();
        const type = blob.type || 'image/png';
        const ext = type.includes('jpeg') || type.includes('jpg') ? 'jpg' : 'png';
        return new File([blob], 'familia-minera-convite.' + ext, { type: type });
    } catch (e) {
        return null;
    }
}

/** Vídeo de convite (Web Share Level 2 — WhatsApp no celular anexa o arquivo). */
async function familiaShareVideoFile() {
    const raw = (typeof SHARE_VIDEO_DEFAULT === 'string' ? SHARE_VIDEO_DEFAULT : 'media/convite-familia-minera.mp4');
    if (!raw) return null;
    try {
        const abs = new URL(raw, window.location.href).href;
        const bust = abs + (abs.includes('?') ? '&' : '?') + 'share=1&v=20260923aq';
        const res = await fetch(bust, { cache: 'no-store' });
        if (!res.ok) return null;
        const blob = await res.blob();
        const type = blob.type && blob.type.startsWith('video/') ? blob.type : 'video/mp4';
        if (blob.size < 1000) return null;
        return new File([blob], 'convite-familia-minera.mp4', { type: type });
    } catch (e) {
        console.warn('familiaShareVideoFile', e);
        return null;
    }
}

async function compartilharNoWhatsApp(perfilOpt) {
    /* WhatsApp: prioriza Web Share com vídeo (wa.me NÃO anexa arquivo). */
    return compartilharIndicacao({ perfil: perfilOpt, destino: 'whatsapp' });
}

async function abrirWhatsAppSoTexto(text) {
    const wa = 'https://wa.me/?text=' + encodeURIComponent(text || '');
    try {
        const w = window.open(wa, '_blank', 'noopener');
        if (!w) window.location.href = wa;
        if (typeof toastMsg === 'function') toastMsg('Abrindo WhatsApp…');
        return true;
    } catch (e) {
        await copiarTextoIndicacao();
        return false;
    }
}

async function compartilharIndicacao(opts) {
    opts = opts || {};
    await carregarShareFlags();
    let payload = familiaSharePayload(opts.perfil);
    if ((!payload.codigo || payload.codigo === '…') && opts.perfil && typeof garantirCodigoIndicacao === 'function') {
        try {
            const p = await garantirCodigoIndicacao(opts.perfil);
            payload = familiaSharePayload(p);
        } catch (e) { /* ignore */ }
    }
    const text = payload.text || '';
    const link = payload.link || (payload.codigo ? linkIndicacao(payload.codigo) : '');
    if (!payload.codigo || payload.codigo === '…') {
        if (typeof toastMsg === 'function') toastMsg('Código de indicação ainda não pronto. Abra Perfil e tente de novo.');
        else alert('Código de indicação ainda não pronto.');
        return false;
    }
    /* 1) Vídeo + texto curto (nome + link). wa.me NÃO leva arquivo — só sheet nativo. */
    try {
        if (navigator.share) {
            if (typeof toastMsg === 'function') toastMsg('Preparando vídeo…');
            const video = await familiaShareVideoFile();
            if (video) {
                const dataVid = { files: [video], title: 'Família Minera', text: text };
                const dataVidOnly = { files: [video] };
                if (!navigator.canShare || navigator.canShare(dataVid) || navigator.canShare(dataVidOnly)) {
                    try {
                        await navigator.share(dataVid);
                    } catch (eShare) {
                        /* Alguns Androids aceitam só files; texto vai no caption se o app deixar */
                        if (eShare && eShare.name === 'AbortError') return false;
                        await navigator.share({ files: [video], text: text });
                    }
                    if (typeof toastMsg === 'function') toastMsg('Escolha o WhatsApp na lista — o vídeo vai junto.');
                    return true;
                }
            }
            const img = await familiaShareImageFile();
            if (img) {
                const dataImg = { files: [img], title: 'Família Minera', text: text };
                if (!navigator.canShare || navigator.canShare(dataImg)) {
                    await navigator.share(dataImg);
                    if (typeof toastMsg === 'function') toastMsg('Convite com imagem enviado!');
                    return true;
                }
            }
            await navigator.share({ title: 'Família Minera', text: text });
            if (typeof toastMsg === 'function') toastMsg('Convite compartilhado!');
            return true;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return false;
        console.warn('share', e);
    }
    /* Fallback sem Web Share: só texto curto no WhatsApp */
    return abrirWhatsAppSoTexto(text);
}

function bindCardFamilia() {
    const toggle = document.getElementById('btn-familia-toggle');
    if (toggle && !toggle._boundToggle) {
        toggle._boundToggle = true;
        toggle.addEventListener('click', () => {
            const open = toggle.getAttribute('aria-expanded') === 'true';
            setFamiliaExpanded(!open);
        });
    }
    const msgEl = document.getElementById('familia-msg-custom');
    if (msgEl && !msgEl._boundPreview) {
        msgEl._boundPreview = true;
        msgEl.addEventListener('input', () => atualizarFamiliaSharePreview());
    }
    const btnShare = document.getElementById('btn-compartilhar-ref');
    if (btnShare && !btnShare._bound) {
        btnShare._bound = true;
        btnShare.addEventListener('click', async (ev) => {
            if (ev) ev.stopPropagation();
            await compartilharIndicacao();
        });
    }
    const btn = document.getElementById('btn-copiar-ref');
    if (btn && !btn._bound) {
        btn._bound = true;
        btn.addEventListener('click', async (ev) => {
            if (ev) ev.stopPropagation();
            await copiarTextoIndicacao();
        });
    }
}

async function montarCardFamilia(container, perfil, where) {
    if (!container) return perfil;
    await carregarShareFlags();
    perfil = await garantirCodigoIndicacao(perfil);
    // refresh pontos
    if (perfil && perfil.auth_id) {
        try {
            const { data } = await supabaseClient
                .from('usuarios')
                .select('codigo_indicacao, pontos_saldo')
                .eq('auth_id', perfil.auth_id)
                .maybeSingle();
            if (data) {
                if (data.codigo_indicacao) perfil.codigo_indicacao = data.codigo_indicacao;
                if (data.pontos_saldo != null) perfil.pontos_saldo = Number(data.pontos_saldo);
            }
        } catch (e) { /* SQL 16? */ }
    }
    let host = document.getElementById('card-familia-mineira');
    if (!host) {
        const wrap = document.createElement('div');
        wrap.innerHTML = htmlCardFamilia(perfil);
        host = wrap.firstElementChild;
        if (where === 'inicio') {
            const cot = document.getElementById('card-cotacoes');
            if (cot && cot.parentNode) cot.parentNode.insertBefore(host, cot.nextSibling);
            else container.insertBefore(host, container.firstChild);
        } else if (where === 'perfil') {
            const comissoes = document.getElementById('card-comissoes');
            if (comissoes && comissoes.parentNode) comissoes.parentNode.insertBefore(host, comissoes);
            else {
                const prefs = document.getElementById('card-prefs');
                if (prefs && prefs.parentNode) prefs.parentNode.insertBefore(host, prefs.nextSibling);
                else container.appendChild(host);
            }
        } else {
            container.appendChild(host);
        }
    } else {
        host.outerHTML = htmlCardFamilia(perfil);
    }
    bindCardFamilia();
    return perfil;
}

/**
 * Aplica pontos na comissão: 1 ponto = R$ 0,10, máx = comissão cheia.
 * Retorna { valor_comissao, desconto_pontos, valor_comissao_original, pontos_usados }.
 */
async function aplicarDescontoPontosComissao(vendedorAuthId, valorComissaoOriginal) {
    const original = Math.round(Number(valorComissaoOriginal) * 100) / 100;
    const out = {
        valor_comissao: original,
        desconto_pontos: 0,
        valor_comissao_original: original,
        pontos_usados: 0
    };
    if (!(original > 0) || !vendedorAuthId) return out;
    try {
        const { data: u, error } = await supabaseClient
            .from('usuarios')
            .select('pontos_saldo')
            .eq('auth_id', vendedorAuthId)
            .maybeSingle();
        if (error || !u) return out;
        const saldo = Math.max(0, Number(u.pontos_saldo) || 0);
        if (!(saldo > 0)) return out;
        const maxDescontoReais = original;
        const maxPontos = Math.ceil(maxDescontoReais / 0.1);
        const pontosUsados = Math.min(saldo, maxPontos);
        let desconto = Math.round(pontosUados * 0.1 * 100) / 100;
        if (desconto > original) desconto = original;
        const final = Math.round((original - desconto) * 100) / 100;
        const novoSaldo = Math.round((saldo - pontosUados) * 100) / 100;
        const { error: updErr } = await supabaseClient
            .from('usuarios')
            .update({ pontos_saldo: novoSaldo })
            .eq('auth_id', vendedorAuthId);
        if (updErr) {
            console.warn('debit pontos:', updErr.message);
            return out;
        }
        await supabaseClient.from('indicacao_pontos').insert([{
            auth_id: vendedorAuthId,
            pontos: -pontosUados,
            motivo: 'Desconto comissão 1% (−R$ ' + desconto.toFixed(2) + ')'
        }]);
        out.valor_comissao = final;
        out.desconto_pontos = desconto;
        out.pontos_usados = pontosUados;
        return out;
    } catch (e) {
        console.warn(e);
        return out;
    }
}

async function creditarPontosIndicacao(referrerAuthId, pontos, motivo) {
    if (!referrerAuthId || !(pontos > 0)) return false;
    try {
        const { data: u } = await supabaseClient
            .from('usuarios')
            .select('pontos_saldo')
            .eq('auth_id', referrerAuthId)
            .maybeSingle();
        if (!u) return false;
        const novo = Math.round(((Number(u.pontos_saldo) || 0) + pontos) * 100) / 100;
        const { error } = await supabaseClient
            .from('usuarios')
            .update({ pontos_saldo: novo })
            .eq('auth_id', referrerAuthId);
        if (error) throw error;
        await supabaseClient.from('indicacao_pontos').insert([{
            auth_id: referrerAuthId,
            pontos,
            motivo: motivo || 'Indicação'
        }]);
        return true;
    } catch (e) {
        console.warn('creditar pontos:', e);
        return false;
    }
}

/** Captura código de indicação: /c/CODIGO, ?ref= ou ?c= → localStorage */
function capturarRefUrl() {
    try {
        let ref = '';
        const path = String(window.location.pathname || '');
        const m = path.match(/\/c\/([A-Za-z0-9_-]+)\/?$/i);
        if (m) ref = String(m[1] || '').trim().toUpperCase();
        if (!ref) {
            const q = new URLSearchParams(window.location.search);
            ref = (q.get('ref') || q.get('c') || '').trim().toUpperCase();
        }
        if (ref) localStorage.setItem('minera_ref', ref);
    } catch (e) { /* ignore */ }
}

function temConviteIndicacao() {
    try {
        const q = new URLSearchParams(window.location.search);
        if ((q.get('ref') || q.get('c') || '').trim()) return true;
        if ((q.get('welcome') || '') === '1') return true;
    } catch (e) { /* ignore */ }
    return !!lerRefSalvo();
}

function lerRefSalvo() {
    try {
        return (localStorage.getItem('minera_ref') || '').trim().toUpperCase();
    } catch (e) {
        return '';
    }
}

async function processarIndicacaoNoCadastro(novoUser, nome) {
    const codigo = lerRefSalvo();
    if (!codigo || !novoUser || !novoUser.id) return;
    try {
        // SECURITY DEFINER RPC (SQL 17) — no cross-profile SELECT/UPDATE from client
        const motivo = 'Indicação: ' + (nome || novoUser.email || 'novo usuário') + ' (código ' + codigo + ')';
        const { data, error } = await supabaseClient.rpc('processar_indicacao', {
            p_codigo: codigo,
            p_pontos: SUPORTE_REF_PREMIO,
            p_motivo: motivo
        });
        if (error) {
            console.warn('indicação rpc:', error.message);
            return;
        }
        if (data) {
            try { localStorage.removeItem('minera_ref'); } catch (e2) { /* */ }
        }
    } catch (e) {
        console.warn('indicação cadastro:', e);
    }
}

/** Após cadastro: atalho compartilhar (index) sem quebrar fluxo. */
function mostrarSharePosCadastro(perfil) {
    if (!perfil || !perfil.codigo_indicacao) return;
    let host = document.getElementById('share-pos-cadastro');
    if (!host) {
        host = document.createElement('section');
        host.id = 'share-pos-cadastro';
        host.className = 'card familia-card familia-expanded';
        const card = document.getElementById('auth-card');
        if (card && card.parentNode) card.parentNode.insertBefore(host, card.nextSibling);
        else {
            const c = document.querySelector('.container');
            if (c) c.appendChild(host);
            else return;
        }
    }
    const codigo = perfil.codigo_indicacao;
    const nome = shareNomeFromPerfil(perfil) || (perfil.nome || '');
    const link = linkIndicacao(codigo);
    const text = textoCompartilharIndicacao(codigo, { nome: nome });
    host.innerHTML =
        '<div class="familia-panel" style="padding:14px">' +
        '<h2 class="familia-panel-title">Convide colegas</h2>' +
        '<p class="sub">Compartilhe seu link da Família Minera e ganhe pontos.</p>' +
        '<div class="familia-og-card">' +
        '<img class="familia-og-logo" src="' + suporteEsc((_shareOgImageUrl || SHARE_OG_IMAGE_DEFAULT)) + '" alt="" width="72" height="72">' +
        '<div class="familia-og-meta"><strong class="familia-og-title">Minera Pará</strong>' +
        '<p class="familia-og-desc">' + suporteEsc(shareOgDescription(nome)) + '</p></div></div>' +
        '<input type="hidden" id="familia-codigo" value="' + suporteEsc(codigo) + '">' +
        '<input type="hidden" id="familia-link" value="' + suporteEsc(link) + '">' +
        '<input type="hidden" id="familia-nome" value="' + suporteEsc(nome) + '">' +
        '<textarea id="familia-msg-custom" rows="2" maxlength="500" placeholder="Mensagem opcional…"></textarea>' +
        '<div class="familia-share-row" style="margin-top:8px">' +
        '<button type="button" class="btn-sm btn-ok btn-wa-share" id="btn-compartilhar-ref">Compartilhar convite (vídeo)</button>' +
        '<button type="button" class="btn-sm" id="btn-copiar-ref">Copiar texto</button>' +
        '</div>' +
        '<pre class="familia-share-text" id="familia-share-text">' + suporteEsc(text) + '</pre>' +
        '</div>';
    bindCardFamilia();
}

window.garantirFaleConosco = garantirFaleConosco;
window.abrirSuporte = abrirSuporte;
window.montarCardFamilia = montarCardFamilia;
window.mostrarSharePosCadastro = mostrarSharePosCadastro;
window.aplicarDescontoPontosComissao = aplicarDescontoPontosComissao;
window.capturarRefUrl = capturarRefUrl;
window.temConviteIndicacao = temConviteIndicacao;
window.lerRefSalvo = lerRefSalvo;
window.linkIndicacao = linkIndicacao;
window.textoCompartilharIndicacao = textoCompartilharIndicacao;
window.processarIndicacaoNoCadastro = processarIndicacaoNoCadastro;
window.garantirCodigoIndicacao = garantirCodigoIndicacao;
window.familiaSharePayload = familiaSharePayload;
window.compartilharIndicacao = compartilharIndicacao;
window.compartilharNoWhatsApp = compartilharNoWhatsApp;
window.copiarTextoIndicacao = copiarTextoIndicacao;
window.carregarShareFlags = carregarShareFlags;
window.SHARE_FRASE_PADRAO_DEFAULT = SHARE_FRASE_PADRAO_DEFAULT;
window.SHARE_OG_IMAGE_DEFAULT = SHARE_OG_IMAGE_DEFAULT;
window.SHARE_VIDEO_DEFAULT = SHARE_VIDEO_DEFAULT;
window.familiaShareVideoFile = familiaShareVideoFile;
window.SUPORTE_REF_PREMIO = SUPORTE_REF_PREMIO;
