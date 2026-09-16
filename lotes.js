let perfilAtual = null;
let sessionAtual = null;
let lotesMeus = [];
let imagemDataUrl = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function abrirModal(titulo) {
    document.getElementById('modal-lote-titulo').textContent = titulo || 'Novo Lote';
    document.getElementById('modal-lote').classList.remove('oculto');
    document.getElementById('lote-msg').textContent = '';
}

function fecharModal() {
    document.getElementById('modal-lote').classList.add('oculto');
    document.getElementById('form-lote').reset();
    document.getElementById('lote-id').value = '';
    imagemDataUrl = null;
}

function ehMeuLote(l) {
    const uid = sessionAtual && sessionAtual.user ? sessionAtual.user.id : null;
    const nome = (perfilAtual && perfilAtual.nome) || '';
    if (uid && l.criado_por_id && l.criado_por_id === uid) return true;
    if (uid && l.criado_por_id == null && nome && l.criado_por === nome) return true;
    if (!l.criado_por_id && nome && l.criado_por === nome) return true;
    return false;
}

function renderCards(lista) {
    const listaDiv = document.getElementById('lotes-lista');
    if (!lista.length) {
        listaDiv.innerHTML = '<p>Você ainda não cadastrou lotes. Use <b>+ Novo Lote</b>.</p>';
        return;
    }
    listaDiv.innerHTML = '<div class="lote-cards">' + lista.map(l => {
        const preco = formatPreco(l.preco);
        const img = l.imagem_url
            ? '<div class="lote-img"><img src="' + esc(l.imagem_url) + '" alt="" loading="lazy"></div>'
            : '<div class="lote-img placeholder"><span>⛏️</span></div>';
        return `<article class="lote-card" data-id="${l.id}">
            ${img}
            <div class="lote-card-body">
                <div class="lote-card-top">
                    <span class="lote-tipo">${esc(l.tipo_minerio || 'Minério')}</span>
                    <span class="${statusBadgeClass(l.status)}">${esc(statusAmigavel(l.status))}</span>
                </div>
                <h3 class="lote-codigo">${esc(l.codigo_lote)}</h3>
                <p class="lote-meta">📍 ${esc(l.origem || '—')} · ⚖️ ${esc(formatPeso(l.peso_bruto_kg))}</p>
                ${preco ? '<p class="lote-preco">' + esc(preco) + '</p>' : ''}
                <div class="card-actions">
                    <button type="button" class="btn-sm" data-act="edit" data-id="${l.id}">Editar</button>
                    <button type="button" class="btn-sm btn-danger" data-act="del" data-id="${l.id}">Excluir</button>
                    <button type="button" class="btn-sm btn-ok" data-act="vendido" data-id="${l.id}">Marcar como Vendido</button>
                </div>
            </div>
        </article>`;
    }).join('') + '</div>';
}

async function carregarLotes() {
    const listaDiv = document.getElementById('lotes-lista');
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false });
        if (error) throw error;
        lotesMeus = (data || []).filter(ehMeuLote);
        renderCards(lotesMeus);
    } catch (err) {
        console.error(err);
        listaDiv.innerHTML = '<p class="erro">Erro ao carregar dados. Faça login de novo.</p>';
    }
}

function preencherForm(lote) {
    document.getElementById('lote-id').value = lote ? lote.id : '';
    document.getElementById('codigo_lote').value = lote ? (lote.codigo_lote || '') : '';
    document.getElementById('tipo_minerio').value = lote ? (lote.tipo_minerio || '') : '';
    document.getElementById('origem').value = lote ? (lote.origem || '') : '';
    document.getElementById('peso_bruto').value = lote ? (lote.peso_bruto_kg || '') : '';
    document.getElementById('preco').value = lote && lote.preco != null ? lote.preco : '';
    document.getElementById('imagem_url').value = lote ? (lote.imagem_url || '') : '';
    document.getElementById('lote_lat').value = lote && lote.lat != null ? lote.lat : '';
    document.getElementById('lote_lng').value = lote && lote.lng != null ? lote.lng : '';
    imagemDataUrl = null;
    document.getElementById('imagem_file').value = '';
}

async function salvarLote(e) {
    e.preventDefault();
    const msgEl = document.getElementById('lote-msg');
    const id = document.getElementById('lote-id').value;
    const codigo_lote = document.getElementById('codigo_lote').value.trim();
    const origem = document.getElementById('origem').value.trim();
    const tipo_minerio = document.getElementById('tipo_minerio').value;
    const peso_bruto_kg = parseFloat(document.getElementById('peso_bruto').value);
    const precoRaw = document.getElementById('preco').value;
    const preco = precoRaw === '' ? null : parseFloat(precoRaw);
    let imagem_url = document.getElementById('imagem_url').value.trim() || null;
    if (imagemDataUrl) imagem_url = imagemDataUrl;
    const latRaw = document.getElementById('lote_lat').value.trim();
    const lngRaw = document.getElementById('lote_lng').value.trim();
    const lat = latRaw === '' ? null : parseFloat(latRaw);
    const lng = lngRaw === '' ? null : parseFloat(lngRaw);
    if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) {
        msgEl.textContent = 'Latitude/longitude inválidas.';
        msgEl.className = 'msg erro';
        return;
    }
    if ((lat == null) !== (lng == null)) {
        msgEl.textContent = 'Informe lat e lng juntos, ou deixe ambos vazios.';
        msgEl.className = 'msg erro';
        return;
    }

    const nome = (perfilAtual && perfilAtual.nome) ||
        (sessionAtual && sessionAtual.user && sessionAtual.user.user_metadata && sessionAtual.user.user_metadata.nome) ||
        (sessionAtual && sessionAtual.user && sessionAtual.user.email) || 'Usuário';
    const uid = sessionAtual && sessionAtual.user ? sessionAtual.user.id : null;

    const payload = {
        codigo_lote,
        origem,
        tipo_minerio,
        peso_bruto_kg,
        preco,
        imagem_url,
        lat,
        lng
    };

    let error;
    if (id) {
        const res = await supabaseClient.from('lotes').update(payload).eq('id', parseInt(id, 10));
        error = res.error;
    } else {
        payload.status = 'pendente';
        payload.criado_por = nome;
        payload.criado_por_id = uid;
        const res = await supabaseClient.from('lotes').insert([payload]);
        error = res.error;
    }

    if (error) {
        let hint = '';
        if (error.message.includes('preco') || error.message.includes('imagem')) {
            hint = ' — aplique o SQL 09-ui-marketplace.sql no Supabase.';
        } else if (error.message.includes('lat') || error.message.includes('lng') || error.message.includes('column')) {
            hint = ' — aplique o SQL 11-mapa-coords.sql no Supabase.';
        }
        msgEl.textContent = 'Erro: ' + error.message + hint;
        msgEl.className = 'msg erro';
        return;
    }
    msgEl.textContent = id ? 'Lote atualizado!' : 'Lote cadastrado!';
    msgEl.className = 'msg ok';
    await registrarLog(id ? 'lote_editar' : 'lote_criar', { codigo_lote, peso_bruto_kg, tipo_minerio }, perfilAtual);
    fecharModal();
    carregarLotes();
}

async function excluirLote(id) {
    if (!confirm('Excluir este lote?')) return;
    const { error } = await supabaseClient.from('lotes').delete().eq('id', id);
    if (error) {
        toastMsg('Erro ao excluir: ' + error.message);
        return;
    }
    await registrarLog('lote_excluir', { id }, perfilAtual);
    toastMsg('Lote excluído');
    carregarLotes();
}

async function marcarVendido(id) {
    const { error } = await supabaseClient.from('lotes').update({ status: 'expedido' }).eq('id', id);
    if (error) {
        toastMsg('Erro: ' + error.message);
        return;
    }
    await registrarLog('lote_vendido', { id }, perfilAtual);
    toastMsg('Marcado como Vendido');
    carregarLotes();
}

document.getElementById('btn-novo-lote').addEventListener('click', () => {
    preencherForm(null);
    abrirModal('Novo Lote');
});

document.getElementById('modal-lote-fechar').addEventListener('click', fecharModal);
document.getElementById('modal-lote-cancelar').addEventListener('click', fecharModal);
document.getElementById('modal-lote').addEventListener('click', (e) => {
    if (e.target && e.target.getAttribute('data-close')) fecharModal();
});

document.getElementById('imagem_file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    imagemDataUrl = null;
    if (!file) return;
    if (file.size > 120000) {
        toastMsg('Arquivo grande — use URL da imagem');
        e.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => { imagemDataUrl = reader.result; };
    reader.readAsDataURL(file);
});

document.getElementById('form-lote').addEventListener('submit', salvarLote);

document.getElementById('lotes-lista').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'), 10);
    const act = btn.getAttribute('data-act');
    const lote = lotesMeus.find(l => l.id === id);
    if (act === 'edit' && lote) {
        preencherForm(lote);
        abrirModal('Editar Lote');
    } else if (act === 'del') {
        excluirLote(id);
    } else if (act === 'vendido') {
        marcarVendido(id);
    }
});

(async function init() {
    sessionAtual = await requireSession();
    if (!sessionAtual) return;
    perfilAtual = await getPerfil(sessionAtual);
    aplicarUserLabel(perfilAtual);
    montarNav('lotes', perfilAtual);
    carregarLotes();
    try {
        const u = new URL(window.location.href);
        if (u.searchParams.get('novo') === '1' || u.hash === '#novo') {
            setTimeout(() => {
                const b = document.getElementById('btn-novo-lote');
                if (b) b.click();
            }, 200);
        }
    } catch (e) {}
})();
