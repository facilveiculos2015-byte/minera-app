let perfilAtual = null;
let sessionAtual = null;
let lotesMeus = [];
let lotesTodos = [];
let lotesModo = 'disponiveis'; // disponiveis | meus
/** URL pública após upload Storage (não data-URL). */
let imagemUploadUrl = null;
let imagemUploading = false;

const LOTE_IMG_MAX = 8388608; // 8 MB
const LOTE_IMG_COMPRESS_OVER = 1572864; // ~1.5 MB
const LOTE_STORAGE_BUCKET = 'chat-midia';
const LOTE_STORAGE_FOLDER = 'lotes';

const PAPEIS_LOTE_LABELS = {
    minerador: 'Minerador',
    comprador: 'Comprador',
    transportador: 'Transportador',
    transportador_mina_britador: 'Transportador (Mina - Britador)',
    transportador_britador_porto: 'Transportador (Britador - Porto)',
    dono_britador: 'Dono de Britador',
    carregamento: 'Carregador',
    admin: 'Admin'
};

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rotuloPapelLote(papel) {
    if (!papel) return '';
    const k = String(papel).toLowerCase();
    return PAPEIS_LOTE_LABELS[k] || papel;
}

function papeisAtivosUsuario() {
    const raw = (perfilAtual && Array.isArray(perfilAtual.papeis)) ? perfilAtual.papeis : [];
    let arr = raw.map(p => String(p).toLowerCase().trim()).filter(Boolean);
    // Não listar admin como opção de publicação de marketplace, salvo se for o único
    const semAdmin = arr.filter(p => p !== 'admin');
    if (semAdmin.length) arr = semAdmin;
    // Dedup
    const seen = {};
    return arr.filter(p => (seen[p] ? false : (seen[p] = true)));
}

function montarSelectPublicadoComo(preselect) {
    const sel = document.getElementById('publicado_como');
    const wrap = document.getElementById('wrap-publicado-como');
    const hint = document.getElementById('publicado-como-hint');
    if (!sel) return;
    const papeis = papeisAtivosUsuario();
    const prev = preselect != null ? String(preselect).toLowerCase() : (sel.value || '');
    sel.innerHTML = '<option value="">Selecione o papel…</option>' +
        papeis.map(p => '<option value="' + esc(p) + '">' + esc(rotuloPapelLote(p)) + '</option>').join('');
    if (papeis.length === 1) {
        sel.value = papeis[0];
        sel.required = true;
        if (wrap) wrap.classList.add('publicado-unico');
        if (hint) hint.textContent = 'Publicando como ' + rotuloPapelLote(papeis[0]) + '.';
    } else if (papeis.length === 0) {
        sel.value = '';
        sel.required = true;
        if (wrap) wrap.classList.remove('publicado-unico');
        if (hint) hint.textContent = 'Defina ao menos um papel em Perfil para publicar.';
    } else {
        if (prev && papeis.includes(prev)) sel.value = prev;
        else sel.value = '';
        sel.required = true;
        if (wrap) wrap.classList.remove('publicado-unico');
        if (hint) hint.textContent = 'Escolha com qual categoria esta publicação aparece no feed.';
    }
}

function badgePublicadoComo(papel) {
    if (!papel) return '';
    return '<span class="lote-papel-badge">' + esc(rotuloPapelLote(papel)) + '</span>';
}

function loteLocalMeta(l) {
    const bits = [];
    if (l.cidade && l.estado) bits.push(l.cidade + '-' + String(l.estado).toUpperCase());
    else if (l.cidade) bits.push(l.cidade);
    else if (l.estado) bits.push(String(l.estado).toUpperCase());
    if (l.ddd) bits.push('DDD ' + l.ddd);
    if (l.origem) bits.push(l.origem);
    return bits.length ? bits.join(' · ') : '—';
}

async function onLoteEstadoChange() {
    const uf = (document.getElementById('lote_estado').value || '').toUpperCase();
    if (typeof LocalidadeBR !== 'undefined') {
        await LocalidadeBR.preencherSelectCidades(document.getElementById('lote_cidade'), uf, '');
    }
    document.getElementById('lote_ddd').value = '';
}

async function onLoteCidadeChange() {
    const uf = (document.getElementById('lote_estado').value || '').toUpperCase();
    const cidade = document.getElementById('lote_cidade').value || '';
    if (cidade && uf && typeof LocalidadeBR !== 'undefined') {
        const d = LocalidadeBR.dddDeCidade(cidade, uf);
        if (d) document.getElementById('lote_ddd').value = d;
    }
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
    imagemUploadUrl = null;
    imagemUploading = false;
}

function ehMeuLote(l) {
    const uid = sessionAtual && sessionAtual.user ? sessionAtual.user.id : null;
    const nome = (perfilAtual && perfilAtual.nome) || '';
    if (uid && l.criado_por_id && l.criado_por_id === uid) return true;
    if (uid && l.criado_por_id == null && nome && l.criado_por === nome) return true;
    if (!l.criado_por_id && nome && l.criado_por === nome) return true;
    return false;
}

/** Marketplace: pendente/disponível/em trânsito — não expedido (vendido). */
function loteDisponivelMkt(l) {
    const s = String(l && l.status != null ? l.status : '').toLowerCase();
    return s !== 'expedido';
}

function atualizarLotesSub() {
    const sub = document.getElementById('lotes-sub');
    if (!sub) return;
    sub.textContent = lotesModo === 'meus'
        ? 'Gerencie e anuncie os lotes que você criou'
        : 'Anúncios disponíveis no marketplace';
}

function renderCards(lista) {
    const listaDiv = document.getElementById('lotes-lista');
    const meus = lotesModo === 'meus';
    if (!lista.length) {
        if (meus) {
            listaDiv.innerHTML = '<div class="lotes-empty"><p><strong>Você ainda não cadastrou lotes</strong></p><p class="sub">Use <b>+ Novo Lote</b> para anunciar.</p></div>';
        } else {
            listaDiv.innerHTML = '<div class="lotes-empty"><p><strong>Nenhum lote disponível</strong></p><p class="sub">Quando houver anúncios pendentes/disponíveis, eles aparecem aqui.</p></div>';
        }
        return;
    }
    const root = (typeof APP_ROOT === 'string') ? APP_ROOT : '';
    listaDiv.innerHTML = '<div class="lote-cards">' + lista.map(l => {
        const preco = formatPreco(l.preco);
        const codigo = l.codigo_lote || '';
        const img = l.imagem_url
            ? '<div class="lote-img"><img src="' + esc(l.imagem_url) + '" alt="" loading="lazy"></div>'
            : '<div class="lote-img placeholder"><span>⛏️</span></div>';
        let actions;
        if (meus) {
            actions = `<div class="card-actions">
                    <button type="button" class="btn-sm" data-act="edit" data-id="${l.id}">Editar</button>
                    <button type="button" class="btn-sm btn-danger" data-act="del" data-id="${l.id}">Excluir</button>
                    <button type="button" class="btn-sm btn-ok" data-act="vendido" data-id="${l.id}">Marcar como Vendido</button>
                </div>`;
        } else {
            const det = root + 'lote-detalhe.html?codigo=' + encodeURIComponent(codigo);
            const nego = root + 'chat.html?' +
                (l.criado_por_id ? ('com=' + encodeURIComponent(l.criado_por_id) + '&') : '') +
                'lote=' + encodeURIComponent(codigo);
            actions = `<div class="card-actions">
                    <a class="btn-sm" href="${det}">Ver anúncio</a>
                    <a class="btn-sm btn-ok" href="${nego}">Negociar</a>
                </div>`;
        }
        const anunciante = !meus && l.criado_por
            ? '<p class="lote-meta">Anunciante: ' + esc(l.criado_por) + '</p>'
            : '';
        return `<article class="lote-card" data-id="${l.id}">
            ${img}
            <div class="lote-card-body">
                <div class="lote-card-top">
                    <span class="lote-tipo">${esc(l.tipo_minerio || 'Minério')}</span>
                    ${badgePublicadoComo(l.publicado_como)}
                    <span class="${statusBadgeClass(l.status)}">${esc(statusAmigavel(l.status))}</span>
                </div>
                <h3 class="lote-codigo">${esc(codigo)}</h3>
                <p class="lote-meta">📍 ${esc(loteLocalMeta(l))} · ⚖️ ${esc(formatPeso(l.peso_bruto_kg))}</p>
                ${anunciante}
                ${preco ? '<p class="lote-preco">' + esc(preco) + '</p>' : ''}
                ${actions}
            </div>
        </article>`;
    }).join('') + '</div>';
}

function aplicarLotesModo() {
    atualizarLotesSub();
    if (lotesModo === 'meus') renderCards(lotesMeus);
    else renderCards(lotesTodos.filter(loteDisponivelMkt));
}

async function carregarLotes() {
    const listaDiv = document.getElementById('lotes-lista');
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('*')
            .order('id', { ascending: false });
        if (error) throw error;
        lotesTodos = data || [];
        lotesMeus = lotesTodos.filter(ehMeuLote);
        aplicarLotesModo();
    } catch (err) {
        console.error(err);
        listaDiv.innerHTML = '<p class="erro">Erro ao carregar dados. Faça login de novo.</p>';
    }
}

async function preencherForm(lote) {
    document.getElementById('lote-id').value = lote ? lote.id : '';
    document.getElementById('codigo_lote').value = lote ? (lote.codigo_lote || '') : '';
    document.getElementById('tipo_minerio').value = lote ? (lote.tipo_minerio || '') : '';
    document.getElementById('origem').value = lote ? (lote.origem || '') : '';
    document.getElementById('peso_bruto').value = lote ? (lote.peso_bruto_kg || '') : '';
    document.getElementById('preco').value = lote && lote.preco != null ? lote.preco : '';
    document.getElementById('imagem_url').value = lote ? (lote.imagem_url || '') : '';
    document.getElementById('lote_lat').value = lote && lote.lat != null ? lote.lat : '';
    document.getElementById('lote_lng').value = lote && lote.lng != null ? lote.lng : '';
    imagemUploadUrl = null;
    document.getElementById('imagem_file').value = '';
    montarSelectPublicadoComo(lote ? lote.publicado_como : null);

    const uf = lote && lote.estado ? String(lote.estado).toUpperCase() : '';
    const cidade = lote && lote.cidade ? lote.cidade : '';
    const ddd = lote && lote.ddd != null ? String(lote.ddd) : '';
    if (typeof LocalidadeBR !== 'undefined') {
        await LocalidadeBR.preencherSelectEstados(document.getElementById('lote_estado'), uf);
        await LocalidadeBR.preencherSelectCidades(document.getElementById('lote_cidade'), uf, cidade);
    } else {
        document.getElementById('lote_estado').value = uf;
    }
    document.getElementById('lote_ddd').value = ddd || (
        (cidade && uf && typeof LocalidadeBR !== 'undefined')
            ? (LocalidadeBR.dddDeCidade(cidade, uf) || '')
            : ''
    );
}

function extForMime(mime, fallback) {
    const m = (mime || '').toLowerCase();
    if (m === 'image/jpeg') return 'jpg';
    if (m === 'image/png') return 'png';
    if (m === 'image/gif') return 'gif';
    if (m === 'image/webp') return 'webp';
    return fallback || 'jpg';
}

/** Comprime JPEG via canvas se > ~1.5MB (max edge 1600, q≈0.82). */
function comprimirImagemSePreciso(file) {
    return new Promise((resolve) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            resolve(file);
            return;
        }
        if (file.size <= LOTE_IMG_COMPRESS_OVER) {
            resolve(file);
            return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                URL.revokeObjectURL(url);
                let w = img.naturalWidth || img.width;
                let h = img.naturalHeight || img.height;
                const maxEdge = 1600;
                if (w > maxEdge || h > maxEdge) {
                    if (w >= h) {
                        h = Math.round(h * (maxEdge / w));
                        w = maxEdge;
                    } else {
                        w = Math.round(w * (maxEdge / h));
                        h = maxEdge;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob((blob) => {
                    if (!blob) {
                        resolve(file);
                        return;
                    }
                    const nome = (file.name || 'lote').replace(/\.[^.]+$/, '') + '.jpg';
                    resolve(new File([blob], nome, { type: 'image/jpeg', lastModified: Date.now() }));
                }, 'image/jpeg', 0.82);
            } catch (e) {
                console.warn('compress', e);
                resolve(file);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(file);
        };
        img.src = url;
    });
}

async function uploadLoteImagem(file) {
    const mime = (file.type || 'image/jpeg').split(';')[0];
    const ext = extForMime(mime, (file.name || '').split('.').pop() || 'jpg');
    const uid = (sessionAtual && sessionAtual.user && sessionAtual.user.id) || 'anon';
    const path = uid + '/' + LOTE_STORAGE_FOLDER + '/' + Date.now() + '_' +
        String(file.name || ('lote.' + ext)).replace(/[^\w.\-]+/g, '_').replace(/\.[^.]+$/, '') + '.' + ext;
    const { data, error } = await supabaseClient.storage
        .from(LOTE_STORAGE_BUCKET)
        .upload(path, file, {
            upsert: false,
            contentType: mime,
            cacheControl: '3600'
        });
    if (error) throw error;
    const { data: pub } = supabaseClient.storage.from(LOTE_STORAGE_BUCKET).getPublicUrl((data && data.path) || path);
    if (!pub || !pub.publicUrl) throw new Error('URL pública indisponível');
    return pub.publicUrl;
}

async function onImagemFileChange(e) {
    const file = e.target.files && e.target.files[0];
    imagemUploadUrl = null;
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
        toastMsg('Selecione um arquivo de imagem.');
        e.target.value = '';
        return;
    }
    if (file.size > LOTE_IMG_MAX) {
        toastMsg('Imagem acima de 8 MB — escolha outra ou use URL.');
        e.target.value = '';
        return;
    }
    imagemUploading = true;
    toastMsg('Enviando imagem…');
    try {
        const ready = await comprimirImagemSePreciso(file);
        if (ready.size > LOTE_IMG_MAX) {
            toastMsg('Imagem acima de 8 MB — escolha outra ou use URL.');
            e.target.value = '';
            imagemUploading = false;
            return;
        }
        const url = await uploadLoteImagem(ready);
        imagemUploadUrl = url;
        document.getElementById('imagem_url').value = url;
        toastMsg('Imagem enviada');
    } catch (err) {
        console.warn(err);
        const msg = (err && err.message) ? err.message : String(err);
        toastMsg('Falha no upload — use URL ou aplique SQL 24/26 (storage).');
        imagemUploadUrl = null;
    } finally {
        imagemUploading = false;
    }
}

async function salvarLote(e) {
    e.preventDefault();
    const msgEl = document.getElementById('lote-msg');
    if (imagemUploading) {
        msgEl.textContent = 'Aguarde o envio da imagem…';
        msgEl.className = 'msg erro';
        toastMsg('Aguarde o envio da imagem…');
        return;
    }
    const id = document.getElementById('lote-id').value;
    const codigo_lote = document.getElementById('codigo_lote').value.trim();
    const origem = document.getElementById('origem').value.trim();
    const tipo_minerio = document.getElementById('tipo_minerio').value;
    const peso_bruto_kg = parseFloat(document.getElementById('peso_bruto').value);
    const precoRaw = document.getElementById('preco').value;
    const preco = precoRaw === '' ? null : parseFloat(precoRaw);
    let imagem_url = document.getElementById('imagem_url').value.trim() || null;
    if (imagemUploadUrl) imagem_url = imagemUploadUrl;
    const publicado_como = (document.getElementById('publicado_como').value || '').trim().toLowerCase();
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

    const estado = (document.getElementById('lote_estado').value || '').trim().toUpperCase();
    const cidade = (document.getElementById('lote_cidade').value || '').trim();
    let ddd = (document.getElementById('lote_ddd').value || '').trim().replace(/\D/g, '');
    if (ddd.length > 2) ddd = ddd.slice(0, 2);
    if (!estado || !cidade) {
        msgEl.textContent = 'Informe Estado e Cidade do lote (necessário para o Marketplace).';
        msgEl.className = 'msg erro';
        toastMsg('Escolha Estado e Cidade');
        return;
    }
    if (!ddd && typeof LocalidadeBR !== 'undefined') {
        ddd = LocalidadeBR.dddDeCidade(cidade, estado) || '';
    }
    if (ddd && !/^\d{2}$/.test(ddd)) {
        msgEl.textContent = 'DDD inválido (use 2 dígitos).';
        msgEl.className = 'msg erro';
        return;
    }

    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Criar/editar lote')) {
        msgEl.textContent = 'Conta bloqueada — pague a comissão no Perfil.';
        msgEl.className = 'msg erro';
        return;
    }

    const papeisOk = papeisAtivosUsuario();
    if (!publicado_como) {
        msgEl.textContent = 'Escolha “Publicar como” (seu papel/categoria).';
        msgEl.className = 'msg erro';
        toastMsg('Escolha Publicar como');
        return;
    }
    if (papeisOk.length && !papeisOk.includes(publicado_como) && !(ehAdmin(perfilAtual) && publicado_como === 'admin')) {
        msgEl.textContent = 'Papel inválido para sua conta.';
        msgEl.className = 'msg erro';
        return;
    }

    if (typeof AntiGolpe !== 'undefined') {
        const chk = AntiGolpe.validarCampos({
            codigo_lote, origem, imagem_url: imagem_url || ''
        }, ['codigo_lote', 'origem', 'imagem_url']);
        if (!chk.ok) {
            msgEl.textContent = chk.motivo;
            msgEl.className = 'msg erro';
            toastMsg(chk.motivo);
            return;
        }
        if (chk.campos) {
            // keep originals unless stripped null
        }
    }

    const nome = (perfilAtual && perfilAtual.nome) ||
        (sessionAtual && sessionAtual.user && sessionAtual.user.user_metadata && sessionAtual.user.user_metadata.nome) ||
        'Usuário';
    const uid = sessionAtual && sessionAtual.user ? sessionAtual.user.id : null;

    const payload = {
        codigo_lote,
        origem,
        tipo_minerio,
        peso_bruto_kg,
        preco,
        imagem_url,
        lat,
        lng,
        publicado_como,
        estado,
        cidade,
        ddd: ddd || null
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
        if (/publicado_como/i.test(error.message || '')) {
            hint = ' — aplique o SQL 26-lotes-publicado-como.sql no Supabase.';
        } else if (/\bestado\b|\bcidade\b|\bddd\b/i.test(error.message || '')) {
            hint = ' — aplique o SQL 29-lotes-localidade.sql no Supabase.';
        } else if (error.message.includes('preco') || error.message.includes('imagem')) {
            hint = ' — aplique o SQL 09-ui-marketplace.sql no Supabase.';
        } else if (error.message.includes('lat') || error.message.includes('lng') || error.message.includes('column')) {
            hint = ' — aplique o SQL 11-mapa-coords.sql (ou 29) no Supabase.';
        }
        msgEl.textContent = 'Erro: ' + error.message + hint;
        msgEl.className = 'msg erro';
        return;
    }
    msgEl.textContent = id ? 'Lote atualizado!' : 'Lote cadastrado!';
    msgEl.className = 'msg ok';
    await registrarLog(id ? 'lote_editar' : 'lote_criar', { codigo_lote, peso_bruto_kg, tipo_minerio, publicado_como }, perfilAtual);
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

async function criarComissaoVenda(lote) {
    const preco = lote && lote.preco != null ? Number(lote.preco) : 0;
    if (!(preco > 0) || !lote || !lote.id) return null;
    // Idempotente: skip se já existe comissão para este lote
    try {
        const { data: existentes, error: errSel } = await supabaseClient
            .from('comissoes')
            .select('id')
            .eq('lote_id', lote.id)
            .limit(1);
        if (errSel) {
            console.warn('comissoes select:', errSel.message);
            // tabela ausente → hint SQL 12
            if (/relation|comissoes|schema cache|does not exist/i.test(errSel.message || '')) {
                toastMsg('Aplique o SQL 12-comissoes.sql no Supabase');
            }
            return null;
        }
        if (existentes && existentes.length) return existentes[0];
    } catch (e) {
        console.warn(e);
        return null;
    }
    const percentual = 1;
    const valor_comissao_bruta = Math.round(preco * percentual) / 100;
    const uid = (sessionAtual && sessionAtual.user && sessionAtual.user.id)
        || (perfilAtual && perfilAtual.auth_id) || null;
    const nome = (perfilAtual && perfilAtual.nome)
        || (lote.criado_por)
        || 'Vendedor';
    let valor_comissao = valor_comissao_bruta;
    let desconto_pontos = 0;
    let valor_comissao_original = valor_comissao_bruta;
    if (typeof aplicarDescontoPontosComissao === 'function' && uid) {
        const disc = await aplicarDescontoPontosComissao(uid, valor_comissao_bruta);
        valor_comissao = disc.valor_comissao;
        desconto_pontos = disc.desconto_pontos || 0;
        valor_comissao_original = disc.valor_comissao_original != null
            ? disc.valor_comissao_original : valor_comissao_bruta;
    }
    const venc = new Date();
    venc.setDate(venc.getDate() + 7);
    const row = {
        lote_id: lote.id,
        vendedor_auth_id: uid,
        vendedor_nome: nome,
        valor_venda: preco,
        valor_comissao: valor_comissao,
        valor_comissao_original: valor_comissao_original,
        desconto_pontos: desconto_pontos,
        percentual: percentual,
        status: 'pendente',
        vencimento: venc.toISOString()
    };
    const { data, error } = await supabaseClient.from('comissoes').insert([row]).select('id').limit(1);
    if (error) {
        // unique race / already exists
        if (/duplicate|unique|comissoes_lote/i.test(error.message || '')) {
            return { id: null };
        }
        console.warn('comissao insert:', error.message);
        if (/relation|comissoes|schema cache|does not exist/i.test(error.message || '')) {
            toastMsg('Aplique o SQL 12-comissoes.sql no Supabase');
        } else {
            toastMsg('Comissão não gerada: ' + error.message);
        }
        return null;
    }
    return data && data[0] ? data[0] : { id: true };
}

async function marcarVendido(id) {
    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Marcar vendido')) return;
    const lote = lotesMeus.find(l => l.id === id) || null;
    const { error } = await supabaseClient.from('lotes').update({ status: 'expedido' }).eq('id', id);
    if (error) {
        toastMsg('Erro: ' + error.message);
        return;
    }
    await registrarLog('lote_vendido', { id }, perfilAtual);
    const preco = lote && lote.preco != null ? Number(lote.preco) : 0;
    if (preco > 0) {
        const criada = await criarComissaoVenda(lote);
        if (criada) {
            const valorFmt = preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            toastMsg('Comissão 1% (sobre R$ ' + valorFmt + ') gerada — pontos aplicados se houver; pague no Perfil/Pix');
        } else {
            toastMsg('Marcado como Vendido');
        }
    } else {
        toastMsg('Marcado como Vendido');
    }
    carregarLotes();
}

document.getElementById('btn-novo-lote').addEventListener('click', async () => {
    if (typeof exigirDesbloqueado === 'function' && !exigirDesbloqueado(perfilAtual, 'Novo lote')) return;
    await preencherForm(null);
    abrirModal('Novo Lote');
});

document.getElementById('modal-lote-fechar').addEventListener('click', fecharModal);
document.getElementById('modal-lote-cancelar').addEventListener('click', fecharModal);
document.getElementById('modal-lote').addEventListener('click', (e) => {
    if (e.target && e.target.getAttribute('data-close')) fecharModal();
});

document.getElementById('imagem_file').addEventListener('change', onImagemFileChange);

document.getElementById('form-lote').addEventListener('submit', salvarLote);

document.getElementById('lotes-lista').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'), 10);
    const act = btn.getAttribute('data-act');
    const lote = lotesMeus.find(l => l.id === id);
    if (act === 'edit' && lote) {
        preencherForm(lote).then(() => abrirModal('Editar Lote'));
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
    if (typeof verificarInadimplencia === 'function') await verificarInadimplencia(perfilAtual);
    mostrarBannerBloqueio(perfilAtual);
    const estEl = document.getElementById('lote_estado');
    const cidEl = document.getElementById('lote_cidade');
    if (estEl) estEl.addEventListener('change', () => { onLoteEstadoChange(); });
    if (cidEl) cidEl.addEventListener('change', () => { onLoteCidadeChange(); });
    if (typeof LocalidadeBR !== 'undefined') {
        try { await LocalidadeBR.preencherSelectEstados(estEl, ''); } catch (e) { console.warn(e); }
    }
    const tabs = document.getElementById('lotes-tabs');
    if (tabs && !tabs._bound) {
        tabs._bound = true;
        tabs.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-modo]');
            if (!btn) return;
            lotesModo = btn.getAttribute('data-modo') || 'disponiveis';
            tabs.querySelectorAll('.lotes-tab').forEach(b => {
                const on = b === btn;
                b.classList.toggle('on', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            aplicarLotesModo();
        });
    }
    let abrirNovo = false;
    try {
        const u = new URL(window.location.href);
        if (u.searchParams.get('novo') === '1' || u.hash === '#novo') {
            abrirNovo = true;
            lotesModo = 'meus';
            if (tabs) {
                tabs.querySelectorAll('.lotes-tab').forEach(b => {
                    const on = b.getAttribute('data-modo') === 'meus';
                    b.classList.toggle('on', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
            }
        }
    } catch (e) { console.warn('novo query', e); }
    await carregarLotes();
    if (abrirNovo) {
        setTimeout(() => {
            const b = document.getElementById('btn-novo-lote');
            if (b) b.click();
        }, 200);
    }
})();
