function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAPEIS_EDIT = [
    'minerador',
    'comprador',
    'transportador_mina_britador',
    'transportador_britador_porto',
    'dono_britador',
    'carregamento',
    'admin'
];
let perfilAtual = null;
/** @type {object|null} active pix_admin row */
let pixAtivoCache = null;

function iniciaisSimples(nome) {
    const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function atualizarPerfilHero(perfil) {
    if (!perfil) return;
    const nome = (perfil.apelido || perfil.nome || perfil.email || 'Você').trim();
    const elN = document.getElementById('perfil-hero-nome');
    const elS = document.getElementById('perfil-hero-sub');
    const elA = document.getElementById('perfil-hero-av');
    if (elN) elN.textContent = nome;
    if (elS) {
        const papeis = Array.isArray(perfil.papeis) ? perfil.papeis.join(', ') : '';
        elS.textContent = papeis ? ('Papéis: ' + papeis) : (perfil.email || 'Atualize seus dados');
    }
    if (elA) elA.textContent = iniciaisSimples(nome);
}

async function atualizarCardCompartilhar(perfil) {
    const card = document.getElementById('card-compartilhar');
    if (!card || !perfil) return;
    if (typeof garantirCodigoIndicacao === 'function') {
        perfil = await garantirCodigoIndicacao(perfil) || perfil;
    }
    const codigo = (perfil.codigo_indicacao || '').trim().toUpperCase() || '…';
    const link = (typeof linkIndicacao === 'function') ? linkIndicacao(codigo) : '';
    const nome = (perfil.apelido || perfil.nome || '').trim();
    card.setAttribute('data-codigo', codigo === '…' ? '' : codigo);
    card.setAttribute('data-link', link);
    card.setAttribute('data-nome', nome);
    const txt = document.getElementById('compartilhar-codigo-txt');
    if (txt) txt.textContent = codigo;
    const sub = document.getElementById('compartilhar-sub');
    if (sub && link) {
        sub.textContent = 'Seu link: ' + link;
    }
    // Sync hidden familia fields if present
    const fc = document.getElementById('familia-codigo');
    const fl = document.getElementById('familia-link');
    const fn = document.getElementById('familia-nome');
    if (fc && codigo && codigo !== '…') fc.value = codigo;
    if (fl && link) fl.value = link;
    if (fn && nome) fn.value = nome;
    return perfil;
}

function bindPerfilShare() {
    const btnWa = document.getElementById('btn-compartilhar-whatsapp');
    if (btnWa && !btnWa._bound) {
        btnWa._bound = true;
        btnWa.addEventListener('click', async () => {
            try {
                /* Mesmo fluxo do Início / Família Minera: vídeo + nome + link */
                if (perfilAtual && typeof atualizarCardCompartilhar === 'function') {
                    await atualizarCardCompartilhar(perfilAtual);
                }
                if (typeof compartilharIndicacao === 'function') {
                    await compartilharIndicacao({ perfil: perfilAtual, destino: 'whatsapp' });
                } else if (typeof compartilharNoWhatsApp === 'function') {
                    await compartilharNoWhatsApp(perfilAtual);
                } else {
                    alert('Atualize o app (cache) e tente de novo.');
                }
            } catch (e) {
                console.warn('share wa', e);
                if (typeof toastMsg === 'function') toastMsg('Falha ao compartilhar. Atualize a página.');
            }
        });
    }
    const btnCopy = document.getElementById('btn-copiar-link-perfil');
    if (btnCopy && !btnCopy._bound) {
        btnCopy._bound = true;
        btnCopy.addEventListener('click', async () => {
            const card = document.getElementById('card-compartilhar');
            const link = (card && card.getAttribute('data-link')) || '';
            const codigo = (card && card.getAttribute('data-codigo')) || '';
            const text = (typeof textoCompartilharIndicacao === 'function')
                ? textoCompartilharIndicacao(codigo, { nome: (card && card.getAttribute('data-nome')) || '' })
                : link;
            try {
                await navigator.clipboard.writeText(text || link);
                if (typeof toastMsg === 'function') toastMsg('Link/código copiado!');
            } catch (e) {
                prompt('Copie o link:', link || text);
            }
        });
    }
}


function lerPapeisForm() {
    return PAPEIS_EDIT.filter(id => {
        const el = document.getElementById('perfil-papel-' + id);
        return el && el.checked;
    });
}

function preencherForm(perfil) {
    document.getElementById('perfil-nome').value = perfil.nome || '';
    document.getElementById('perfil-apelido').value = perfil.apelido || '';
    document.getElementById('perfil-email').value = perfil.email || '';
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis.map(p => String(p).toLowerCase()) : [];
    // Legado transportador → marca ambas pernas
    const temTranspLegado = papeis.includes('transportador');
    PAPEIS_EDIT.forEach(id => {
        const el = document.getElementById('perfil-papel-' + id);
        if (!el) return;
        if (id === 'transportador_mina_britador' || id === 'transportador_britador_porto') {
            el.checked = papeis.includes(id) || temTranspLegado;
        } else {
            el.checked = papeis.includes(id);
        }
    });
    const rowAdmin = document.getElementById('row-admin');
    if (rowAdmin) {
        if (ehAdmin(perfil) || papeis.includes('admin')) {
            rowAdmin.classList.remove('oculto');
        } else {
            rowAdmin.classList.add('oculto');
        }
    }
}

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('perfil-msg');
    const nome = document.getElementById('perfil-nome').value.trim();
    const apelido = document.getElementById('perfil-apelido').value.trim() || null;
    const papeis = lerPapeisForm();
    if (!perfilAtual || !perfilAtual.auth_id) {
        msgEl.textContent = 'Perfil ainda não vinculado na tabela usuarios. Faça logout/login e tente de novo.';
        msgEl.className = 'msg erro';
        return;
    }
    if (typeof verificarNomeApelidoDisponivel === 'function') {
        const chk = await verificarNomeApelidoDisponivel(nome, apelido, perfilAtual.auth_id);
        if (!chk.ok) {
            msgEl.textContent = chk.message || (typeof MSG_NOME_APELIDO_DUPLICADO === 'string' ? MSG_NOME_APELIDO_DUPLICADO : 'Já existe alguém com este nome e apelido. Escolha outro apelido.');
            msgEl.className = 'msg erro';
            return;
        }
    }
    const tipo = papeis.includes('admin') ? 'admin' : 'operador';
    const { error } = await supabaseClient
        .from('usuarios')
        .update({ nome, apelido, papeis, tipo })
        .eq('auth_id', perfilAtual.auth_id);
    if (error) {
        if (typeof erroUnicidadeNomeApelido === 'function' && erroUnicidadeNomeApelido(error)) {
            msgEl.textContent = (typeof MSG_NOME_APELIDO_DUPLICADO === 'string' ? MSG_NOME_APELIDO_DUPLICADO : null) || 'Já existe alguém com este nome e apelido. Escolha outro apelido.';
        } else {
            msgEl.textContent = 'Erro: ' + error.message;
        }
        msgEl.className = 'msg erro';
        return;
    }
    perfilAtual.nome = nome;
    perfilAtual.apelido = apelido;
    perfilAtual.papeis = papeis;
    perfilAtual.tipo = tipo;
    aplicarUserLabel(perfilAtual);
    montarNav('perfil', perfilAtual);
    atualizarPerfilHero(perfilAtual);
    const sairTop2 = document.getElementById('btn-sair');
    if (sairTop2) sairTop2.classList.remove('oculto');
    msgEl.textContent = 'Perfil salvo!';
    msgEl.className = 'msg ok';
    await registrarLog('perfil_atualizar', { papeis }, perfilAtual);
});


async function aplicarFlagsPerfil() {
    const comissaoOn = (typeof isComissao1pctAtiva === 'function')
        ? await isComissao1pctAtiva()
        : false;
    const vaquinhaOn = (typeof isVaquinhaAtiva === 'function')
        ? await isVaquinhaAtiva()
        : true;

    const cardVaq = document.getElementById('card-vaquinha');
    if (cardVaq) {
        if (vaquinhaOn) cardVaq.classList.remove('oculto');
        else cardVaq.classList.add('oculto');
    }

    const pixTitle = document.getElementById('pix-user-title');
    const pixHint = document.getElementById('pix-user-vaquinha-hint');
    if (vaquinhaOn) {
        if (pixTitle) pixTitle.textContent = 'Pix — apoie o desenvolvimento';
        if (pixHint) pixHint.classList.remove('oculto');
    } else {
        if (pixTitle) pixTitle.textContent = comissaoOn ? 'Pagar via Pix' : 'Pix';
        if (pixHint) pixHint.classList.add('oculto');
    }

    const sub = document.getElementById('comissoes-sub');
    const cardCom = document.getElementById('card-comissoes');
    if (cardCom) {
        // Pausada: some tudo — usuário não deve nem saber que existia cobrança %
        if (comissaoOn) {
            cardCom.classList.remove('oculto');
            cardCom.setAttribute('data-comissao-ativa', '1');
            if (sub) sub.textContent = '1% sobre vendas marcadas como Vendido. Pague via Pix para liberar.';
        } else {
            cardCom.classList.add('oculto');
            cardCom.setAttribute('data-comissao-ativa', '0');
        }
    }
    return { comissaoOn, vaquinhaOn };
}

function bindVaquinhaPix() {
    const btn = document.getElementById('btn-vaquinha-pix');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
        const card = document.getElementById('card-pix-user');
        const input = document.getElementById('pix-valor');
        if (input) {
            // qualquer valor — deixa em branco para o usuário escolher
            input.value = '';
            try { input.focus(); } catch (e) { /* ignore */ }
        }
        if (card) {
            card.scrollIntoView({ behavior: 'smooth' });
            const form = document.getElementById('form-pix-comprovante');
            if (form) form.classList.remove('oculto');
        }
        if (typeof atualizarPixEmv === 'function') atualizarPixEmv(null, 'VAQUINHA');
        if (typeof toastMsg === 'function') {
            toastMsg('Digite qualquer valor e use o Pix Copia e Cola — obrigado pelo apoio!');
        }
    });
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('perfil', perfilAtual);
    preencherForm(perfilAtual);
    atualizarPerfilHero(perfilAtual);
    // Keep slim topbar Sair visible (nav.js hides legado #btn-sair with bottom-nav)
    const sairTop = document.getElementById('btn-sair');
    if (sairTop) sairTop.classList.remove('oculto');
    if (typeof montarCardFamilia === 'function') {
        perfilAtual = await montarCardFamilia(document.querySelector('.container'), perfilAtual, 'perfil') || perfilAtual;
    }
    await atualizarCardCompartilhar(perfilAtual);
    bindPerfilShare();
    if (typeof aplicarTema === 'function') aplicarTema(typeof lerTema === 'function' ? lerTema() : 'dark');
    if (typeof bindTemaPicker === 'function') bindTemaPicker(document);
    const btnTema = document.getElementById('btn-tema');
    if (btnTema && !btnTema._temaBound) {
        btnTema._temaBound = true;
        btnTema.addEventListener('click', () => {
            if (typeof alternarTema === 'function') alternarTema();
        });
    }
    const btnTut = document.getElementById('btn-abrir-tutorial');
    if (btnTut) btnTut.addEventListener('click', () => irPara('tutorial.html'));
    bindVaquinhaPix();
    await aplicarFlagsPerfil();
    await carregarPixUsuario();
    await carregarComissoesPendentes();
    if (location.hash === '#pix' || location.hash === '#comissoes' || location.hash === '#vaquinha') {
        let el = null;
        if (location.hash === '#comissoes') el = document.getElementById('card-comissoes');
        else if (location.hash === '#vaquinha') el = document.getElementById('card-vaquinha');
        else el = document.getElementById('card-pix-user');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
})();

async function buscarPixAtivo() {
    // Always use the active pix_admin row; never fall back to an inactive/legacy key.
    const { data, error } = await supabaseClient
        .from('pix_admin')
        .select('*')
        .eq('ativo', true)
        .order('atualizado_em', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data && data[0] ? data[0] : null;
}

/**
 * Build / refresh Copia e Cola + QR for current pix key and optional amount.
 * @param {number|string|null} [valor]
 * @param {string} [txid]
 */
function atualizarPixEmv(valor, txid) {
    const panel = document.getElementById('pix-emv-panel');
    const ta = document.getElementById('pix-copia-cola');
    const qrEl = document.getElementById('pix-qr');
    if (!panel || !ta || !qrEl) return;

    const pix = pixAtivoCache;
    const chave = (pix && pix.chave_pix) || (window.PixBrCode && PixBrCode.FALLBACK_CHAVE) || '';
    if (!chave || typeof gerarPixCopiaCola !== 'function') {
        panel.classList.add('oculto');
        return;
    }

    const nome = (pix && pix.titular) || (window.PixBrCode && PixBrCode.FALLBACK_NOME) || 'JeL empreendimentos';
    const cidade = (window.PixBrCode && PixBrCode.FALLBACK_CIDADE) || 'BELEM';

    let amount = valor;
    if (amount == null || amount === '') {
        const input = document.getElementById('pix-valor');
        amount = input && input.value !== '' ? input.value : null;
    }

    try {
        const payload = gerarPixCopiaCola({
            chave,
            nome,
            cidade,
            valor: amount,
            txid: txid || (amount != null && amount !== '' ? 'COMISSAO' : '***')
        });
        ta.value = payload;
        panel.classList.remove('oculto');
        if (window.PixBrCode && typeof PixBrCode.renderQr === 'function') {
            PixBrCode.renderQr(qrEl, payload, 200);
        }
    } catch (e) {
        console.warn('Pix EMV', e);
        panel.classList.add('oculto');
    }
}

async function carregarPixUsuario() {
    const info = document.getElementById('pix-user-info');
    const form = document.getElementById('form-pix-comprovante');
    if (!info) return;
    try {
        const pix = await buscarPixAtivo();
        pixAtivoCache = pix;
        if (!pix || !pix.chave_pix) {
            info.innerHTML = '<p class="sub">Nenhuma chave Pix ativa no momento.</p>';
            if (form) form.classList.add('oculto');
            const panel = document.getElementById('pix-emv-panel');
            if (panel) panel.classList.add('oculto');
            return;
        }
        info.innerHTML = '<div class="pix-box"><strong>Chave Pix</strong>' +
            '<div class="pix-chave">' + String(pix.chave_pix).replace(/</g,'&lt;') + '</div>' +
            '<p class="sub">' + (pix.tipo_chave || '') +
            (pix.titular ? ' · ' + String(pix.titular).replace(/</g,'&lt;') : '') + '</p>' +
            (pix.instrucoes ? '<p>' + String(pix.instrucoes).replace(/</g,'&lt;') + '</p>' : '') +
            '</div>';
        if (form) form.classList.remove('oculto');
        atualizarPixEmv();
    } catch (e) {
        info.innerHTML = '<p class="erro">Pix indisponível (rode SQL 10): ' + esc(e.message || e) + '</p>';
        if (form) form.classList.add('oculto');
    }
    await carregarMeusPix();
}

async function carregarMeusPix() {
    const box = document.getElementById('pix-user-hist');
    if (!box || !perfilAtual) return;
    try {
        let q = supabaseClient.from('pix_pagamentos').select('*').order('criado_em', { ascending: false }).limit(10);
        if (perfilAtual.auth_id) q = q.eq('usuario_auth_id', perfilAtual.auth_id);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || !data.length) {
            box.textContent = '';
            return;
        }
        box.innerHTML = '<p><strong>Seus envios:</strong></p><ul>' + data.map(p => {
            const when = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '';
            return '<li>' + when + ' · R$ ' + (p.valor != null ? p.valor : '—') +
                ' · <span class="badge">' + (p.status || 'pendente') + '</span></li>';
        }).join('') + '</ul>';
    } catch (e) {
        console.warn('pix_pagamentos', e);
        box.textContent = '';
    }
}

const formPix = document.getElementById('form-pix-comprovante');
if (formPix) {
    formPix.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('pix-user-msg');
        if (!perfilAtual) return;
        const valorRaw = document.getElementById('pix-valor').value;
        const row = {
            usuario_id: perfilAtual.id || null,
            usuario_auth_id: perfilAtual.auth_id,
            usuario_nome: perfilAtual.nome || perfilAtual.email,
            valor: valorRaw === '' ? null : parseFloat(valorRaw),
            comprovante_url: document.getElementById('pix-comprovante').value.trim(),
            status: 'pendente'
        };
        const { error } = await supabaseClient.from('pix_pagamentos').insert([row]);
        if (error) {
            msgEl.textContent = 'Erro: ' + error.message + ' (SQL 10?)';
            msgEl.className = 'msg erro';
            return;
        }
        msgEl.textContent = 'Comprovante enviado! Aguarde confirmação.';
        msgEl.className = 'msg ok';
        formPix.reset();
        carregarMeusPix();
        atualizarPixEmv();
    });
}

const pixValorInput = document.getElementById('pix-valor');
if (pixValorInput) {
    pixValorInput.addEventListener('input', () => atualizarPixEmv());
    pixValorInput.addEventListener('change', () => atualizarPixEmv());
}

const btnCopiarPix = document.getElementById('btn-copiar-pix');
if (btnCopiarPix) {
    btnCopiarPix.addEventListener('click', async () => {
        const ta = document.getElementById('pix-copia-cola');
        const payload = ta && ta.value;
        if (!payload) return toastMsg('Nada para copiar');
        try {
            if (window.PixBrCode && PixBrCode.copiarTexto) {
                await PixBrCode.copiarTexto(payload);
            } else {
                await navigator.clipboard.writeText(payload);
            }
            toastMsg('Pix Copia e Cola copiado!');
        } catch (e) {
            if (ta) {
                ta.focus();
                ta.select();
            }
            toastMsg('Selecione e copie manualmente (Ctrl+C)');
        }
    });
}


function fmtBRL(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function carregarComissoesPendentes() {
    const box = document.getElementById('comissoes-pendentes');
    if (!box || !perfilAtual) return;
    const cardCom = document.getElementById('card-comissoes');
    if (cardCom && (cardCom.classList.contains('oculto') || cardCom.getAttribute('data-comissao-ativa') === '0')) {
        box.innerHTML = '';
        return;
    }
    try {
        let q = supabaseClient
            .from('comissoes')
            .select('*')
            .in('status', ['pendente', 'atrasado'])
            .order('criado_em', { ascending: false })
            .limit(30);
        if (perfilAtual.auth_id) q = q.eq('vendedor_auth_id', perfilAtual.auth_id);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhuma comissão pendente.</p>';
            return;
        }
        const agora = Date.now();
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Lote</th><th>Venda</th><th>Comissão 1%</th><th>Vencimento</th><th>Status</th><th></th></tr></thead><tbody>' +
            data.map(c => {
                let st = c.status || 'pendente';
                if (st === 'pendente' && c.vencimento && new Date(c.vencimento).getTime() < agora) {
                    st = 'atrasado';
                    supabaseClient.from('comissoes').update({ status: 'atrasado' }).eq('id', c.id).then(() => {});
                }
                const venc = c.vencimento ? new Date(c.vencimento).toLocaleDateString('pt-BR') : '—';
                const desc = c.desconto_pontos != null && Number(c.desconto_pontos) > 0
                    ? '<br><span class="sub">−' + fmtBRL(c.desconto_pontos) + ' pts' +
                      (c.valor_comissao_original != null ? ' (de ' + fmtBRL(c.valor_comissao_original) + ')' : '') + '</span>'
                    : '';
                return `<tr data-id="${c.id}">
                    <td>#${c.lote_id != null ? c.lote_id : '—'}</td>
                    <td>${fmtBRL(c.valor_venda)}</td>
                    <td><strong>${fmtBRL(c.valor_comissao)}</strong>${desc}</td>
                    <td>${venc}</td>
                    <td><span class="badge badge-${st}">${st}</span></td>
                    <td><button type="button" class="btn-sm btn-ok" data-act="pagar-comissao"
                        data-valor="${c.valor_comissao}" data-id="${c.id}">Pagar via Pix</button></td>
                </tr>`;
            }).join('') + '</tbody></table></div>';
        if (typeof verificarInadimplencia === 'function') await verificarInadimplencia(perfilAtual);
        if (typeof mostrarBannerBloqueio === 'function') mostrarBannerBloqueio(perfilAtual);
    } catch (e) {
        console.warn('comissoes', e);
        box.innerHTML = '<p class="erro">Comissões indisponíveis (rode SQL 12): ' + esc(e.message || e) + '</p>';
    }
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="pagar-comissao"]');
    if (!btn) return;
    const valor = btn.getAttribute('data-valor');
    const comissaoId = btn.getAttribute('data-id');
    const card = document.getElementById('card-pix-user');
    const input = document.getElementById('pix-valor');
    if (input && valor != null) {
        const n = Number(valor);
        input.value = Number.isFinite(n) ? n.toFixed(2) : valor;
    }
    if (card) {
        card.scrollIntoView({ behavior: 'smooth' });
        const form = document.getElementById('form-pix-comprovante');
        if (form) form.classList.remove('oculto');
    }
    const txid = comissaoId ? ('C' + String(comissaoId).replace(/\D/g, '').slice(0, 24)) : 'COMISSAO';
    atualizarPixEmv(valor, txid);
    toastMsg('QR e Copia e Cola prontos — pague e envie o comprovante');
});

// Hook after init: load pix when perfil ready
(async function pixInitHook() {
    // wait a tick for main init
    for (let i = 0; i < 40; i++) {
        if (perfilAtual) break;
        await new Promise(r => setTimeout(r, 50));
    }
    if (perfilAtual) {
        await carregarPixUsuario();
        await carregarComissoesPendentes();
        if (location.hash === '#pix' || location.hash === '#comissoes') {
            const el = document.getElementById(location.hash === '#comissoes' ? 'card-comissoes' : 'card-pix-user');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    }
})();

/* ---------------- Meus anúncios (editar / vendido / excluir) ----------------
 * Reusa anuncios-acoes.js (mesma lógica de lotes.js). Oculto no modo admin (como Fale conosco).
 * Comissão pausada: nenhuma UI de taxa aqui. */
let meusAnuncios = [];
let meusAnunciosSession = null;

function maModoAdmin() {
    const b = document.body;
    return !!(b && (b.classList.contains('modo-ui-admin') || b.classList.contains('pagina-admin')))
        || (typeof emModoAdminUi === 'function' && emModoAdminUi(perfilAtual));
}

function maFotoPrincipal(l) {
    let fotos = [];
    if (Array.isArray(l.fotos)) fotos = l.fotos.filter(Boolean);
    else if (typeof l.fotos === 'string' && l.fotos.trim()) {
        try { fotos = JSON.parse(l.fotos) || []; } catch (e) { fotos = l.fotos.split(/\s+/).filter(Boolean); }
    }
    return l.imagem_url || fotos[0] || '';
}

function maTitulo(l) {
    const tipo = l.tipo_minerio || 'Minério';
    if (String(tipo).trim() === 'Maquinário') {
        const eq = String(l.origem || '').split(' — ')[0].trim();
        return eq ? ('Maquinário · ' + eq) : 'Maquinário';
    }
    return tipo;
}

function maPreco(l) {
    if (l.teor != null && l.teor !== '') {
        return 'Teor: ' + String(l.teor) + (String(l.tipo_minerio || '').toLowerCase() === 'cobre' && l.cobre_tipo
            ? ' (' + (l.cobre_tipo === 'soluvel' ? 'solúvel' : 'total') + ')' : '');
    }
    return (typeof formatPreco === 'function' ? formatPreco(l.preco) : null) || 'Sob consulta';
}

function maItemHtml(l) {
    const root = (typeof APP_ROOT === 'string') ? APP_ROOT : '';
    const foto = maFotoPrincipal(l);
    const vendido = String(l.status || '').toLowerCase() === 'expedido';
    const ico = String(l.tipo_minerio || '').trim() === 'Maquinário' ? '🧰' : '⛏️';
    const det = root + 'lote-detalhe.html?codigo=' + encodeURIComponent(l.codigo_lote || '');
    const thumb = foto
        ? '<img src="' + esc(foto) + '" alt="" loading="lazy" onerror="this.parentNode.innerHTML=\'<span>' + ico + '</span>\'">'
        : '<span>' + ico + '</span>';
    return '<article class="ma-item" data-id="' + esc(l.id) + '">' +
        '<a class="ma-thumb" href="' + det + '" aria-label="Ver anúncio ' + esc(l.codigo_lote || '') + '">' + thumb + '</a>' +
        '<div class="ma-info">' +
        '<a class="ma-titulo" href="' + det + '">' + esc(maTitulo(l)) + '</a>' +
        '<p class="ma-codigo">' + esc(l.codigo_lote || '—') + '</p>' +
        '<p class="ma-preco">' + esc(maPreco(l)) + '</p>' +
        '<span class="ma-status ' + esc(statusBadgeClass(l.status)) + '">' + esc(statusAmigavel(l.status)) + '</span>' +
        '</div>' +
        '<div class="ma-acoes">' +
        '<a class="ma-btn ma-btn-editar" href="' + root + 'lotes.html?editar=' + encodeURIComponent(l.id) + '&de=perfil">✏️ Editar</a>' +
        (vendido ? '' : '<button type="button" class="ma-btn ma-btn-vendido" data-ma-act="vendido" data-id="' + esc(l.id) + '">✅ Marcar como vendido</button>') +
        '<button type="button" class="ma-btn ma-btn-excluir" data-ma-act="del" data-id="' + esc(l.id) + '">🗑️ Excluir</button>' +
        '</div>' +
        '</article>';
}

function renderMeusAnuncios() {
    const box = document.getElementById('meus-anuncios-lista');
    if (!box) return;
    box.classList.remove('loading');
    if (!meusAnuncios.length) {
        const root = (typeof APP_ROOT === 'string') ? APP_ROOT : '';
        box.innerHTML = '<div class="ma-empty"><p><strong>Você ainda não tem anúncios</strong></p>' +
            '<a class="btn-ok ma-empty-btn" href="' + root + 'lotes.html?novo=1">+ Criar anúncio</a></div>';
        return;
    }
    box.innerHTML = '<div class="ma-lista">' + meusAnuncios.map(maItemHtml).join('') + '</div>';
}

async function carregarMeusAnuncios() {
    const card = document.getElementById('card-meus-anuncios');
    if (!card || !perfilAtual) return;
    if (maModoAdmin() || typeof AnunciosAcoes === 'undefined') {
        card.classList.add('oculto');
        return;
    }
    card.classList.remove('oculto');
    const novo = document.getElementById('ma-btn-novo');
    if (novo && typeof APP_ROOT === 'string') novo.href = APP_ROOT + 'lotes.html?novo=1';
    const box = document.getElementById('meus-anuncios-lista');
    try {
        if (!meusAnunciosSession) {
            const { data } = await supabaseClient.auth.getSession();
            meusAnunciosSession = data && data.session;
        }
        // Mesmo tratamento de bloqueio/inadimplência de lotes.js
        if (typeof verificarInadimplencia === 'function') await verificarInadimplencia(perfilAtual);
        const r = await AnunciosAcoes.carregarMeus(meusAnunciosSession, perfilAtual);
        meusAnuncios = r.meus;
        renderMeusAnuncios();
    } catch (e) {
        console.warn('meus anúncios', e);
        if (box) {
            box.classList.remove('loading');
            box.innerHTML = '<p class="erro">Não foi possível carregar seus anúncios. Tente de novo.</p>';
        }
    }
}

document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('[data-ma-act]');
    if (!btn || btn.disabled) return;
    const id = parseInt(btn.getAttribute('data-id'), 10);
    const lote = meusAnuncios.find(l => l.id === id);
    if (!lote) return;
    const act = btn.getAttribute('data-ma-act');
    btn.disabled = true;
    try {
        if (act === 'vendido') {
            const ok = await AnunciosAcoes.marcarVendido(id, lote, meusAnunciosSession, perfilAtual);
            if (ok) {
                lote.status = 'expedido';
                const item = btn.closest('.ma-item');
                const chip = item && item.querySelector('.ma-status');
                if (chip) {
                    chip.className = 'ma-status ' + statusBadgeClass('expedido');
                    chip.textContent = statusAmigavel('expedido');
                }
                btn.remove();
                return;
            }
        } else if (act === 'del') {
            const ok = await AnunciosAcoes.excluir(id, perfilAtual);
            if (ok) {
                meusAnuncios = meusAnuncios.filter(l => l.id !== id);
                const item = btn.closest('.ma-item');
                if (item) item.remove();
                if (!meusAnuncios.length) renderMeusAnuncios();
                return;
            }
        }
    } catch (err) {
        console.warn(err);
        toastMsg('Não foi possível concluir a ação. Tente de novo.');
    }
    btn.disabled = false;
});

(async function meusAnunciosInit() {
    for (let i = 0; i < 100 && !perfilAtual; i++) await new Promise(r => setTimeout(r, 50));
    if (!perfilAtual) return;
    await carregarMeusAnuncios();
    if (location.hash === '#meus-anuncios') {
        const el = document.getElementById('card-meus-anuncios');
        if (el && !el.classList.contains('oculto')) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
})();


/* ⚙️ Configurações (Editar perfil + Preferências): recolhido sempre que o Perfil abre. */
(function bindConfigToggle() {
    const btn = document.getElementById('btn-config-toggle');
    const panel = document.getElementById('perfil-config-panel');
    const card = document.getElementById('card-config');
    if (!btn || !panel || btn._bound) return;
    btn._bound = true;
    function setOpen(open) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        panel.hidden = !open;
        if (card) card.classList.toggle('open', open);
    }
    setOpen(false);
    btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        setOpen(open);
        if (open && card && card.scrollIntoView) {
            // mantém o cabeçalho do painel visível sem pular para o fim da página
            const r = card.getBoundingClientRect();
            if (r.top < 60 || r.top > window.innerHeight * 0.6) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    window.abrirConfiguracoesPerfil = function () { setOpen(true); };
    // Toggle "Avisos de mensagem" (permissão só no toque)
    if (window.MineraNotifPerm) MineraNotifPerm.montarToggle(document.getElementById('notif-perm-toggle'));
    if (window.MineraSom) MineraSom.montarToggle(document.getElementById('notif-som-toggle'));
})();
