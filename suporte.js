/**
 * Fale conosco — Robô Minera (FAQ por keywords) + fila para humano.
 * Depende de: config.js, supabaseClient, getPerfil/session helpers.
 */

const SUPORTE_PONTOS_POR_REAL = 10; // 1 ponto = R$ 0,10 → 10 pts = R$ 1
const SUPORTE_REF_PREMIO = 100;    // pontos ao indicar (cadastro com ?ref=)

const FAQ_INTENTS = [
    {
        id: 'lotes',
        keys: ['lote', 'lotes', 'marketplace', 'vender', 'comprar', 'postar', 'feed', 'anuncio', 'anúncio'],
        reply: '📦 **Lotes** — No Feed você vê o marketplace. Em **Meus Lotes** (chip Novo / Lotes) você cadastra quantidade, tipo de minério, preço e foto. Marque como **Vendido** quando fechar a venda — isso gera a comissão de 1%.'
    },
    {
        id: 'mapa',
        keys: ['mapa', 'satelite', 'satélite', 'coordenada', 'gps', 'localizacao', 'localização'],
        reply: '🗺️ **Mapa de Satélite** — Abra em Mais → Mapa. Lotes com lat/lng aparecem no mapa. Ao cadastrar/editar o lote, você pode informar coordenadas para facilitar logística e visita.'
    },
    {
        id: 'pix',
        keys: ['pix', 'pagamento', 'pagar', 'qr', 'comprovante', 'nubank', 'comissao pix', 'comissão pix'],
        reply: '💠 **Pix** — Comissões e depósitos no Caixa usam a chave Pix do admin. Em **Perfil** você gera QR / Copia e Cola e envia o comprovante. Depósitos do Caixa Minera também geram Pix e o admin confirma o crédito.'
    },
    {
        id: 'comissao',
        keys: ['comissao', 'comissão', '1%', 'um por cento', 'taxa', 'percentual'],
        reply: '💰 **Comissão 1%** — Ao marcar um lote como Vendido, o app gera comissão de 1% sobre o preço. Você paga via Pix no Perfil. Pontos da Família Mineira dão desconto automático: **1 ponto = R$ 0,10** na comissão (até zerar o valor).'
    },
    {
        id: 'caixa',
        keys: ['caixa', 'depositar', 'deposito', 'depósito', 'sacar', 'saque', 'emprestimo', 'empréstimo', 'saldo', 'yield', 'pin'],
        reply: '🏦 **Caixa Minera** — Ícone de banco no header ou chip Caixa Minera. Você pode **depositar** (Pix + comprovante), **sacar** (informe chave destino) e solicitar **empréstimo** (análise do admin). Há PIN próprio do Caixa e yield configurável até 5% a.m. conforme cotação/config.'
    },
    {
        id: 'chat',
        keys: ['chat', 'golpe', 'anti-golpe', 'mensagem', 'conversa', 'whatsapp', 'fraude'],
        reply: '💬 **Chat anti-golpe** — Negocie pelo Chat do app. O anti-golpe alerta sobre pedidos de pagamento fora da plataforma e dados sensíveis. Prefira Pix oficial do app e nunca compartilhe senha/PIN.'
    },
    {
        id: 'papeis',
        keys: ['papel', 'papeis', 'papéis', 'perfil', 'minerador', 'comprador', 'transportador', 'britador', 'carregamento'],
        reply: '👤 **Papéis** — Em Perfil você marca um ou mais papéis (minerador, comprador, transportador, dono de britador, carregamento). Cada papel libera chips diferentes na navegação (Lotes, Frete, Britagem, Expedição…).'
    },
    {
        id: 'frete',
        keys: ['frete', 'logistica', 'logística', 'transporte', 'caminhao', 'caminhão', 'rota'],
        reply: '🚛 **Frete / Logística** — Em Mais → Logística você registra fretes (origem, destino, valor, status). Transportadores veem o chip conforme o papel (mina–britador ou britador–porto).'
    },
    {
        id: 'britagem',
        keys: ['britagem', 'britador', 'processamento', 'processar', 'moagem'],
        reply: '⚙️ **Britagem** — Dono de britador usa Mais → Britagem para configurar e acompanhar processamento dos lotes. Estoque relacionado aparece em Estoque.'
    },
    {
        id: 'tutorial',
        keys: ['tutorial', 'ajuda', 'como usar', 'primeiros passos', 'guia', 'comecar', 'começar'],
        reply: '📖 **Tutorial** — Abra Mais → Tutorial (ou o botão no Perfil) para um guia rápido do Minera App: lotes, chat, Pix, Caixa e papéis.'
    },
    {
        id: 'indicacao',
        keys: ['indicacao', 'indicação', 'familia', 'família', 'convidar', 'referral', 'pontos', 'renda extra', 'codigo', 'código'],
        reply: '⛏️ **Família Mineira** — Convide colegas com seu link/código. Cada cadastro com seu código rende pontos. **1 ponto = R$ 0,10** de desconto na comissão de 1% (máximo = valor total da comissão). Veja o card no Feed e no Perfil.'
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
    if (document.getElementById('btn-fale-conosco')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-fale-conosco';
    btn.className = 'btn-fale-conosco';
    btn.title = 'Fale conosco';
    btn.setAttribute('aria-label', 'Fale conosco');
    btn.innerHTML = '<span class="fale-icon" aria-hidden="true">💬</span><span class="fale-label">Fale conosco</span>';

    const header = document.querySelector('header.header-row');
    if (header) {
        let actions = header.querySelector('.header-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'header-actions';
            header.appendChild(actions);
        }
        const caixa = document.getElementById('btn-caixa-bank');
        const notif = document.getElementById('btn-notif');
        if (caixa && caixa.parentNode === actions) actions.insertBefore(btn, caixa.nextSibling);
        else if (notif && notif.parentNode === actions) actions.insertBefore(btn, notif);
        else actions.appendChild(btn);
    } else {
        btn.classList.add('btn-fale-float');
        document.body.appendChild(btn);
    }

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

    btn.addEventListener('click', () => abrirSuporte());
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
        const { data, error } = await supabaseClient
            .from('suporte_mensagens')
            .select('id, de_auth_id, de_nome, texto, origem, criado_em')
            .eq('thread_auth_id', authId)
            .order('criado_em', { ascending: true })
            .limit(100);
        if (error) {
            if (force) renderSuporteMsgs([]);
            return;
        }
        const rows = data || [];
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

/** Chamado por nav.js em páginas autenticadas */
function garantirFaleConosco(perfil) {
    if (perfil) _suportePerfil = perfil;
    garantirSuporteUi();
}

/* —— Família Mineira / indicação —— */

function gerarCodigoIndicacao() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'MIN';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

function linkIndicacao(codigo) {
    return 'https://facilveiculos2015-byte.github.io/minera-app/?ref=' + encodeURIComponent(codigo || '');
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
    const desconto = (pts * 0.1).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return (
        '<section class="card familia-card" id="card-familia-mineira">' +
        '<h2>⛏️ Família Mineira</h2>' +
        '<p class="familia-lead"><strong>Faça parte da família mineira — venha trabalhar conosco e tenha sua renda extra</strong></p>' +
        '<p class="sub">Indique colegas: ao se cadastrarem com seu link, você ganha pontos. ' +
        '<strong>1 ponto = R$ 0,10</strong> de desconto na comissão de 1% (máx. = valor da comissão).</p>' +
        '<div class="familia-stats">' +
        '<div class="familia-stat"><span class="familia-stat-val" id="familia-pontos">' + pts +
        '</span><span class="familia-stat-lbl">pontos</span></div>' +
        '<div class="familia-stat"><span class="familia-stat-val">' + desconto +
        '</span><span class="familia-stat-lbl">desconto disponível</span></div>' +
        '</div>' +
        '<label for="familia-codigo">Seu código</label>' +
        '<div class="familia-share-row">' +
        '<input type="text" id="familia-codigo" readonly value="' + suporteEsc(codigo) + '">' +
        '<button type="button" class="btn-sm btn-ok" id="btn-copiar-ref">Copiar link</button>' +
        '</div>' +
        '<input type="hidden" id="familia-link" value="' + suporteEsc(link) + '">' +
        '<p class="sub familia-link-hint" id="familia-link-hint">' + suporteEsc(link) + '</p>' +
        '</section>'
    );
}

function bindCardFamilia() {
    const btn = document.getElementById('btn-copiar-ref');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', async () => {
        const link = (document.getElementById('familia-link') || {}).value
            || linkIndicacao((document.getElementById('familia-codigo') || {}).value);
        try {
            await navigator.clipboard.writeText(link);
            if (typeof toastMsg === 'function') toastMsg('Link de indicação copiado!');
            else alert('Link copiado: ' + link);
        } catch (e) {
            prompt('Copie o link:', link);
        }
    });
}

async function montarCardFamilia(container, perfil, where) {
    if (!container) return perfil;
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
            const prefs = document.getElementById('card-prefs');
            if (prefs && prefs.parentNode) prefs.parentNode.insertBefore(host, prefs);
            else container.appendChild(host);
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

/** Captura ?ref= na landing e guarda em localStorage */
function capturarRefUrl() {
    try {
        const q = new URLSearchParams(window.location.search);
        const ref = (q.get('ref') || '').trim().toUpperCase();
        if (ref) localStorage.setItem('minera_ref', ref);
    } catch (e) { /* ignore */ }
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
        const { data: refUser } = await supabaseClient
            .from('usuarios')
            .select('auth_id, codigo_indicacao, nome')
            .eq('codigo_indicacao', codigo)
            .maybeSingle();
        if (!refUser || !refUser.auth_id || refUser.auth_id === novoUser.id) return;
        await supabaseClient.from('usuarios').update({
            indicado_por: codigo
        }).eq('auth_id', novoUser.id);
        await creditarPontosIndicacao(
            refUser.auth_id,
            SUPORTE_REF_PREMIO,
            'Indicação: ' + (nome || novoUser.email || 'novo usuário') + ' (código ' + codigo + ')'
        );
        try { localStorage.removeItem('minera_ref'); } catch (e2) { /* */ }
    } catch (e) {
        console.warn('indicação cadastro:', e);
    }
}

window.garantirFaleConosco = garantirFaleConosco;
window.abrirSuporte = abrirSuporte;
window.montarCardFamilia = montarCardFamilia;
window.aplicarDescontoPontosComissao = aplicarDescontoPontosComissao;
window.capturarRefUrl = capturarRefUrl;
window.processarIndicacaoNoCadastro = processarIndicacaoNoCadastro;
window.garantirCodigoIndicacao = garantirCodigoIndicacao;
window.SUPORTE_REF_PREMIO = SUPORTE_REF_PREMIO;
