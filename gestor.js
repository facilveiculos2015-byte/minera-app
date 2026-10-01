/* Gestor financeiro (só anotação — NÃO é o Minera Bank).
 * Carradas (lucro por carrada) + despesas c/ foto de comprovante.
 * Offline: cache em localStorage + fila (outbox) de upserts por id gerado no celular;
 * fotos pendentes ficam no IndexedDB até subir p/ o bucket privado gestor-docs/{uid}/. */
(function () {
    'use strict';
    const G = window.GestorCalc;
    const $ = (s, el) => (el || document).querySelector(s);
    const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const BUCKET = 'gestor-docs';

    // Colunas que o celular manda (calculadas ficam com o banco)
    const COLS_CARRADA = ['id', 'client_id', 'data', 'minerio', 'comprador', 'placa', 'motorista', 'ticket_numero', 'nf_numero',
        'peso_bruto_kg', 'tara_kg', 'peso_liquido_kg', 'umidade_pct', 'teor', 'preco_modo',
        'preco_ponto', 'preco_t_informado', 'valor_informado', 'ajuste', 'tabela_id', 'tabela_teor_ref', 'preco_manual', 'custo_minerio', 'frete_base', 'frete_unit',
        'carregamento_base', 'carregamento_unit', 'impostos_pct', 'outros_custos', 'status', 'ticket_foto_path', 'observacao', 'deleted_at'];
    const COLS_LANC = ['id', 'client_id', 'data', 'tipo', 'valor', 'categoria_id', 'descricao', 'observacao', 'forma_pagto',
        'status', 'vencimento', 'carrada_id', 'comprovante_path', 'deleted_at'];
    const COLS_CAT = ['id', 'nome', 'tipo', 'icone', 'ordem', 'arquivada'];
    const COLS_TAB = ['id', 'client_id', 'nome', 'minerio', 'comprador', 'modo', 'observacao', 'deleted_at'];
    const NUM_CARRADA = ['peso_bruto_kg', 'tara_kg', 'peso_liquido_kg', 'umidade_pct', 'teor', 'preco_ponto',
        'preco_t_informado', 'valor_informado', 'ajuste', 'custo_minerio', 'frete_unit', 'carregamento_unit', 'impostos_pct', 'outros_custos'];
    const TXT_CARRADA = ['data', 'minerio', 'comprador', 'placa', 'motorista', 'ticket_numero', 'nf_numero', 'observacao'];
    const CATS_PADRAO = [ // offline antes da 1ª sincronização (ids reais vêm do banco)
        ['diesel', 'Diesel / combustível', 'saida', '⛽'], ['frete_pago', 'Frete pago', 'saida', '🚛'],
        ['carregamento', 'Carregamento pago', 'saida', '🏗️'], ['compra_minerio', 'Compra de minério', 'saida', '⛏️'],
        ['funcionarios', 'Funcionários / diárias', 'saida', '👷'], ['alimentacao', 'Alimentação / rancho', 'saida', '🍲'],
        ['manutencao', 'Manutenção / peças', 'saida', '🔧'], ['aluguel_equip', 'Aluguel de máquina', 'saida', '🚜'],
        ['pedagio_balanca', 'Pedágio / balança', 'saida', '⚖️'], ['impostos', 'Impostos / CFEM / taxas', 'saida', '🧾'],
        ['analise_teor', 'Análise de teor / laudo', 'saida', '🧪'], ['outras_saidas', 'Outras despesas', 'saida', '➖'],
        ['venda_minerio', 'Venda de minério', 'entrada', '⛏️'], ['servico', 'Serviço recebido', 'entrada', '🧰'],
        ['outras_entradas', 'Outras entradas', 'entrada', '➕']];

    let uid = null;
    let db = { carradas: [], lancamentos: [], categorias: [], tabelas: [] };
    let outbox = [];
    let flushing = false;
    let semRede = false; // último envio falhou por rede/servidor fora
    let servidorErro = '';
    let aba = 'resumo';
    let filtroCarradas = 'aberta';

    // ---------- util ----------
    function hoje() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Belem' }); }
    function novoId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
    }
    function pick(o, cols) { const r = {}; cols.forEach((c) => { if (o[c] !== undefined) r[c] = o[c]; }); return r; }
    function ddmm(iso) { const d = G.dataBR(iso); return d.slice(0, 5); }
    function isNetErr(e) {
        if (!navigator.onLine) return true;
        if (!e) return false;
        if (e.code && /^[0-9A-Z]{5}$|^PGRST/.test(e.code)) return false; // erro do Postgres/PostgREST
        const st = Number(e.status || e.statusCode || 0);
        if (st >= 500 || st === 0) return true;
        return /fetch|network|load failed|timeout/i.test(String(e.message || e));
    }
    function chave(n) { return 'gf_' + n + '_' + uid; }
    function salvarLocal() {
        try { localStorage.setItem(chave('cache'), JSON.stringify(db)); } catch (e) { console.warn('gestor cache', e); }
        try { localStorage.setItem(chave('outbox'), JSON.stringify(outbox)); } catch (e) { console.warn('gestor outbox', e); }
    }
    function lerLocal() {
        try { const c = JSON.parse(localStorage.getItem(chave('cache')) || 'null'); if (c) db = Object.assign(db, c); } catch (e) { /* ignore */ }
        if (!Array.isArray(db.tabelas)) db.tabelas = [];
        try { outbox = JSON.parse(localStorage.getItem(chave('outbox')) || '[]') || []; } catch (e) { outbox = []; }
        if (!db.categorias.length) {
            db.categorias = CATS_PADRAO.map((c, i) => ({ id: 'preset:' + c[0], slug: c[0], nome: c[1], tipo: c[2], icone: c[3], ordem: i, auth_id: null }));
        }
    }
    function pendente(id) { return outbox.some((it) => it.row && it.row.id === id); }

    // ---------- toast ----------
    let toastTimer = null;
    function toast(txt, desfazer) {
        const t = $('#gf-toast'), b = $('#gf-toast-btn');
        $('#gf-toast-txt').textContent = txt;
        b.classList.toggle('oculto', !desfazer);
        b.onclick = desfazer ? () => { t.classList.add('oculto'); desfazer(); } : null;
        t.classList.remove('oculto');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.add('oculto'), desfazer ? 6000 : 3000);
    }

    // ---------- IndexedDB p/ fotos pendentes ----------
    function idb() {
        return new Promise((res, rej) => {
            const r = indexedDB.open('gestor-fotos', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('fotos');
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
    }
    async function idbOp(modo, fn) {
        const d = await idb();
        return new Promise((res, rej) => {
            const tx = d.transaction('fotos', modo); const req = fn(tx.objectStore('fotos'));
            tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error);
        });
    }
    const idbPut = (k, v) => idbOp('readwrite', (s) => s.put(v, k));
    const idbGet = (k) => idbOp('readonly', (s) => s.get(k));
    const idbDel = (k) => idbOp('readwrite', (s) => s.delete(k));

    /** Foto → JPEG ~1600px, qualidade 0.8 */
    async function comprimir(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
            const max = 1600, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            return await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
        } finally { URL.revokeObjectURL(url); }
    }
    const urlCache = {};
    async function urlFoto(path) {
        if (!path) return null;
        try { const b = await idbGet(path); if (b) return URL.createObjectURL(b); } catch (e) { /* ignore */ }
        if (urlCache[path] && urlCache[path].ate > Date.now()) return urlCache[path].url;
        const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrl(path, 3600);
        if (error || !data) return null;
        urlCache[path] = { url: data.signedUrl, ate: Date.now() + 3000 * 1000 };
        return data.signedUrl;
    }

    // ---------- dados ----------
    const carradasVivas = () => db.carradas.filter((c) => !c.deleted_at);
    const tabelasVivas = () => db.tabelas.filter((t) => !t.deleted_at).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    const catsVivas = () => db.categorias.filter((c) => !c.arquivada);
    function carradaViva(id) { const c = id && db.carradas.find((x) => x.id === id); return c && !c.deleted_at && c.status !== 'cancelada' ? c : null; }
    const lancVivos = () => db.lancamentos.filter((l) => !l.deleted_at);
    function despesasDe(cid) { return lancVivos().filter((l) => l.carrada_id === cid && l.tipo === 'saida'); }
    function calc(c) { return G.calcCarrada(c, despesasDe(c.id).reduce((s, l) => s + Number(l.valor || 0), 0)); }
    function catPor(id) { return db.categorias.find((c) => c.id === id) || null; }
    function upsertLocal(tab, row) {
        const arr = db[tab]; const i = arr.findIndex((x) => x.id === row.id);
        if (i >= 0) arr[i] = Object.assign({}, arr[i], row); else arr.unshift(row);
    }
    const TABELAS = { carradas: ['gf_carradas', COLS_CARRADA], lancamentos: ['gf_lancamentos', COLS_LANC], categorias: ['gf_categorias', COLS_CAT] };
    function gravar(tab, row) {
        upsertLocal(tab, row);
        if (tab === 'tabelas') { // tabela + linhas: 1 RPC atômica (idempotente)
            outbox.push({ rpc: 'gf_tabela_preco_salvar', tab, row: Object.assign(pick(row, COLS_TAB), { linhas: (row.linhas || []).map((l) => ({ teor: l.teor, valor: l.valor })) }) });
        } else {
            outbox.push({ table: TABELAS[tab][0], tab, row: pick(row, TABELAS[tab][1]) });
        }
        salvarLocal(); render(); flush();
    }

    async function flush() {
        if (flushing || !uid) return;
        flushing = true;
        semRede = false;
        try {
            while (outbox.length) {
                if (!navigator.onLine) { semRede = true; break; }
                const it = outbox[0];
                if (it.foto) {
                    const blob = await idbGet(it.foto).catch(() => null);
                    if (blob) {
                        const { error } = await supabaseClient.storage.from(BUCKET).upload(it.foto, blob, { contentType: 'image/jpeg', upsert: true });
                        if (error && isNetErr(error)) { semRede = true; break; }
                        if (error) toast('Foto não subiu: ' + (error.message || 'erro'));
                        else await idbDel(it.foto).catch(() => {});
                    }
                } else if (it.fotoDel) {
                    const { error } = await supabaseClient.storage.from(BUCKET).remove([it.fotoDel]);
                    if (error && isNetErr(error)) { semRede = true; break; }
                } else if (it.rpc) {
                    const r = it.row;
                    const { data, error } = await supabaseClient.rpc(it.rpc, { p_tabela: pick(r, COLS_TAB), p_linhas: r.linhas || null });
                    if (error && isNetErr(error)) { semRede = true; break; }
                    if (error) { servidorErro = error.message || 'erro'; toast('Não salvou a tabela: ' + servidorErro); }
                    else if (data && !outbox.slice(1).some((o) => o.row && o.row.id === data.id)) upsertLocal('tabelas', data);
                } else if (it.row) {
                    const row = Object.assign({}, it.row);
                    if (row.categoria_id && String(row.categoria_id).startsWith('preset:')) {
                        const c = db.categorias.find((x) => x.id === row.categoria_id);
                        const real = c && db.categorias.find((x) => x.slug === c.slug && !String(x.id).startsWith('preset:'));
                        if (!real) break; // espera baixar as categorias reais
                        row.categoria_id = real.id;
                    }
                    const { data, error } = await supabaseClient.from(it.table).upsert(row, { onConflict: 'id' }).select().single();
                    if (error && isNetErr(error)) { semRede = true; break; }
                    if (error) {
                        servidorErro = error.message || 'erro';
                        toast('Não salvou no servidor: ' + servidorErro);
                    } else if (data) {
                        if (!outbox.slice(1).some((o) => o.row && o.row.id === data.id)) upsertLocal(it.tab, data);
                    }
                }
                outbox.shift();
                salvarLocal();
            }
        } catch (e) {
            console.warn('gestor flush', e);
        } finally {
            flushing = false;
            renderSync(); render();
        }
    }

    async function puxar() {
        if (!navigator.onLine) { renderSync(); return; }
        try {
            const [cat, car, lan, tab] = await Promise.all([
                supabaseClient.from('gf_categorias').select('*').order('ordem'),
                supabaseClient.from('gf_carradas').select('*').is('deleted_at', null).order('data', { ascending: false }).range(0, 1999),
                supabaseClient.from('gf_lancamentos').select('*').is('deleted_at', null).order('data', { ascending: false }).range(0, 4999),
                supabaseClient.from('gf_tabelas_preco').select('*, linhas:gf_tabelas_preco_linhas(teor, valor)').is('deleted_at', null).order('nome')
            ]);
            const err = cat.error || car.error || lan.error || tab.error;
            if (err) {
                if (!isNetErr(err)) servidorErro = 'Servidor do Gestor indisponível (' + (err.message || err.code) + ').';
                renderSync(); return;
            }
            servidorErro = '';
            const pend = {};
            outbox.forEach((o) => { if (o.row) pend[o.row.id] = o; });
            const mesclar = (lista, tab) => {
                const m = lista.map((r) => (pend[r.id] ? Object.assign({}, r, pend[r.id].row) : r));
                Object.values(pend).filter((o) => o.tab === tab && !m.some((r) => r.id === o.row.id)).forEach((o) => {
                    const local = db[tab].find((x) => x.id === o.row.id);
                    m.unshift(Object.assign({}, local, o.row));
                });
                return m;
            };
            db.categorias = (cat.data || []).length ? mesclar(cat.data, 'categorias') : db.categorias;
            db.tabelas = mesclar((tab.data || []).map((t) => Object.assign(t, { linhas: (t.linhas || []).map((l) => ({ teor: Number(l.teor), valor: Number(l.valor) })).sort((a, b) => a.teor - b.teor) })), 'tabelas');
            db.carradas = mesclar(car.data || [], 'carradas');
            db.lancamentos = mesclar(lan.data || [], 'lancamentos');
            salvarLocal(); render(); flush();
        } catch (e) { console.warn('gestor puxar', e); renderSync(); }
    }

    // ---------- render ----------
    function renderSync() {
        const el = $('#gf-sync'); if (!el) return;
        const n = outbox.length;
        let txt = '';
        if (servidorErro) txt = '⚠️ ' + servidorErro + ' Seus dados ficam guardados neste celular.';
        else if (n && (!navigator.onLine || semRede)) txt = '⏳ ' + n + ' aguardando internet — salvo no celular';
        else if (n) txt = '⏳ Sincronizando ' + n + '…';
        else if (!navigator.onLine) txt = '📴 Sem internet — mostrando dados salvos no celular';
        el.textContent = txt;
        el.classList.toggle('oculto', !txt);
    }
    function statusBadge(c) {
        if (c.status === 'finalizada') return '<span class="gf-badge gf-badge-ok">Finalizada</span>';
        if (c.status === 'cancelada') return '<span class="gf-badge">Cancelada</span>';
        return '<span class="gf-badge gf-badge-aberta">Aberta</span>';
    }
    function cardCarrada(c0) {
        const c = calc(c0);
        const cls = c.lucro > 0 ? 'pos' : c.lucro < 0 ? 'neg' : '';
        const pesos = c.peso_umido_t != null ? G.fmtNum(c.peso_umido_t, 2) + ' t líq. · ' + G.fmtNum(c.peso_seco_t, 2) + ' t seco' : 'sem peso';
        const lbl = c.status === 'finalizada' ? 'Lucro' : 'Lucro (prévia)';
        return '<div class="gf-item gf-carrada"><button type="button" class="gf-item-main" data-carrada="' + esc(c.id) + '">' +
            '<span class="gf-item-top"><span class="gf-item-tit">🚛 ' + esc(ddmm(c.data)) + ' · ' + esc(c.minerio || 'Minério') +
            (c.placa ? ' · ' + esc(c.placa) : '') + '</span>' + statusBadge(c) + '</span>' +
            '<span class="gf-item-sub">' + esc(pesos) + (c.teor != null ? ' · teor ' + esc(G.fmtNum(c.teor, 2)) + '%' : '') + (c.comprador ? ' · ' + esc(c.comprador) : '') + (pendente(c.id) ? ' · ⏳' : '') + '</span>' +
            '<span class="gf-item-lucro ' + cls + '"><small>' + lbl + '</small> ' + esc(G.fmtBRL(c.lucro)) + '</span></button>' +
            acoes('carrada', c.id) + '</div>';
    }
    function acoes(tipo, id) {
        return '<div class="gf-item-acoes"><button type="button" class="gf-acao" data-ed="' + tipo + ':' + esc(id) + '">✏️ Editar</button>' +
            '<button type="button" class="gf-acao gf-acao-del" data-del="' + tipo + ':' + esc(id) + '">🗑️ Excluir</button></div>';
    }
    function vazio(txt) { return '<p class="gf-vazio">' + txt + '</p>'; }

    function renderResumo() {
        const lista = carradasVivas().filter((c) => c.status !== 'cancelada')
            .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criado_em || '').localeCompare(a.criado_em || ''));
        $('#resumo-carradas').innerHTML = lista.length
            ? lista.slice(0, 15).map(cardCarrada).join('') + (lista.length > 15 ? '<button type="button" class="gf-btn gf-btn-sec" data-ir="carradas">Ver todas (' + lista.length + ')</button>' : '')
            : vazio('Nenhuma carrada ainda. Toque em <b>🚛 Nova carrada</b> para anotar a primeira.');
        // mês (secundário)
        const sel = $('#resumo-mes');
        const meses = new Set([hoje().slice(0, 7)]);
        carradasVivas().forEach((c) => c.data && meses.add(c.data.slice(0, 7)));
        lancVivos().forEach((l) => l.data && meses.add(l.data.slice(0, 7)));
        const atual = sel.value || hoje().slice(0, 7);
        sel.innerHTML = Array.from(meses).sort().reverse().map((m) => {
            const nome = new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            return '<option value="' + m + '"' + (m === atual ? ' selected' : '') + '>' + esc(nome) + '</option>';
        }).join('');
        const mes = sel.value;
        const fin = carradasVivas().filter((c) => c.status === 'finalizada' && (c.data || '').startsWith(mes)).map(calc);
        const lucro = fin.reduce((s, c) => s + c.lucro, 0);
        const avulsas = lancVivos().filter((l) => !carradaViva(l.carrada_id) && (l.data || '').startsWith(mes));
        const desp = avulsas.filter((l) => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0);
        const ent = avulsas.filter((l) => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0);
        const res = lucro + ent - desp;
        const abertas = carradasVivas().filter((c) => c.status === 'aberta').length;
        $('#resumo-mes-box').innerHTML =
            '<div><small>Carradas finalizadas</small><b>' + fin.length + '</b></div>' +
            '<div><small>Lucro das carradas</small><b class="' + (lucro >= 0 ? 'pos' : 'neg') + '">' + G.fmtBRL(lucro) + '</b></div>' +
            '<div><small>Despesas avulsas</small><b class="neg">' + G.fmtBRL(desp) + '</b></div>' +
            '<div><small>Entradas avulsas</small><b class="pos">' + G.fmtBRL(ent) + '</b></div>' +
            '<div class="gf-mes-total"><small>Resultado do mês</small><b class="' + (res >= 0 ? 'pos' : 'neg') + '">' + G.fmtBRL(res) + '</b></div>' +
            (abertas ? '<p class="sub gf-mes-nota">' + abertas + ' carrada(s) aberta(s) ainda não entram no mês.</p>' : '');
    }
    function renderCarradas() {
        $$('#filtro-carradas .gf-chip').forEach((b) => b.classList.toggle('on', b.dataset.f === filtroCarradas));
        const l = carradasVivas().filter((c) => filtroCarradas === 'todas' || c.status === filtroCarradas)
            .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        $('#lista-carradas').innerHTML = l.length ? l.map(cardCarrada).join('') : vazio('Nada aqui ainda.');
    }
    function itemLanc(l) {
        const cat = catPor(l.categoria_id);
        const car = l.carrada_id && db.carradas.find((c) => c.id === l.carrada_id);
        const sinal = l.tipo === 'entrada' ? '+' : '−';
        return '<div class="gf-item gf-lanc-wrap"><button type="button" class="gf-item-main gf-lanc" data-lanc="' + esc(l.id) + '">' +
            '<span class="gf-lanc-ico" aria-hidden="true">' + esc((cat && cat.icone) || (l.tipo === 'entrada' ? '➕' : '➖')) + '</span>' +
            '<span class="gf-lanc-meio"><span class="gf-item-tit">' + esc(l.descricao || (cat && cat.nome) || (l.tipo === 'entrada' ? 'Entrada' : 'Despesa')) + '</span>' +
            '<span class="gf-item-sub">' + esc(ddmm(l.data)) + (cat && l.descricao ? ' · ' + esc(cat.nome) : '') +
            (car ? ' · 🚛 ' + esc(ddmm(car.data)) + (car.placa ? ' ' + esc(car.placa) : '') : '') +
            (l.status === 'pendente' ? ' · <span class="gf-pend">pendente</span>' : '') +
            (l.comprovante_path ? ' · 📎' : '') + (pendente(l.id) ? ' · ⏳' : '') + '</span></span>' +
            '<span class="gf-lanc-valor ' + (l.tipo === 'entrada' ? 'pos' : 'neg') + '">' + sinal + ' ' + esc(G.fmtBRL(Number(l.valor))) + '</span></button>' +
            acoes('lanc', l.id) + '</div>';
    }
    function renderCadastros() {
        const tabs = tabelasVivas();
        $('#lista-tabelas').innerHTML = tabs.length ? tabs.map((t) => {
            const L = (t.linhas || []).slice().sort((a, b) => a.teor - b.teor);
            const faixa = L.length ? G.fmtNum(L[0].teor, 2) + '% a ' + G.fmtNum(L[L.length - 1].teor, 2) + '%' : 'sem linhas';
            return '<div class="gf-item"><button type="button" class="gf-item-main" data-ed="tabela:' + esc(t.id) + '">' +
                '<span class="gf-item-tit">📋 ' + esc(t.nome) + (pendente(t.id) ? ' ⏳' : '') + '</span>' +
                '<span class="gf-item-sub">' + esc([t.minerio, t.comprador].filter(Boolean).join(' · ') || 'Qualquer minério') + '</span>' +
                '<span class="gf-item-sub">' + L.length + ' linha(s) · ' + esc(faixa) + ' · ' + (t.modo === 'tonelada' ? 'R$ por tonelada' : 'R$ por ponto') + '</span></button>' +
                acoes('tabela', t.id) + '</div>';
        }).join('') : vazio('Nenhuma tabela ainda. Toque em <b>＋ Nova tabela</b>.');
        const minhas = catsVivas().filter((c) => c.auth_id);
        $('#lista-categorias').innerHTML = (minhas.length ? minhas.map((c) =>
            '<div class="gf-item"><button type="button" class="gf-item-main" data-ed="cat:' + esc(c.id) + '"><span class="gf-item-tit">' + esc(c.icone || '•') + ' ' + esc(c.nome) + (pendente(c.id) ? ' ⏳' : '') + '</span>' +
            '<span class="gf-item-sub">' + (c.tipo === 'entrada' ? 'Entrada' : 'Despesa') + '</span></button>' + acoes('cat', c.id) + '</div>').join('')
            : vazio('Você ainda não criou categorias.')) + '<p class="sub gf-ajuda">🔒 As categorias padrão do app não podem ser alteradas.</p>';
    }
    function renderDespesas() {
        const l = lancVivos().sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criado_em || '').localeCompare(a.criado_em || ''));
        if (!l.length) { $('#lista-despesas').innerHTML = vazio('Nenhuma despesa ainda. Toque em <b>＋</b> para anotar.'); return; }
        let html = '', dia = '';
        l.forEach((x) => {
            if (x.data !== dia) { dia = x.data; html += '<h3 class="gf-dia">' + esc(G.dataBR(dia)) + '</h3>'; }
            html += itemLanc(x);
        });
        $('#lista-despesas').innerHTML = html;
    }
    function render() {
        renderSync();
        if (aba === 'resumo') renderResumo();
        if (aba === 'carradas') renderCarradas();
        if (aba === 'despesas') renderDespesas();
        if (aba === 'cadastros') renderCadastros();
        $('#gf-fab').classList.toggle('oculto', aba === 'resumo' || aba === 'cadastros');
        if (!$('#sheet-carrada').classList.contains('oculto')) atualizarConta();
    }
    function irAba(a) {
        aba = a;
        $$('.gf-tab').forEach((b) => { const on = b.dataset.aba === a; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        $$('.gf-aba').forEach((s) => s.classList.toggle('oculto', s.id !== 'aba-' + a));
        render();
    }

    // ---------- folhas (sheets) + gesto voltar ----------
    const pilha = [];
    let ignorarPop = 0;
    function abrir(id) {
        const el = $('#' + id);
        el.classList.remove('oculto');
        el.scrollTop = 0;
        pilha.push(id);
        document.body.classList.add('gf-sheet-aberta');
        try { history.pushState({ gf: id }, ''); } catch (e) { /* ignore */ }
    }
    function fecharTopo(viaPop) {
        const id = pilha.pop();
        if (!id) return;
        $('#' + id).classList.add('oculto');
        if (!pilha.length) document.body.classList.remove('gf-sheet-aberta');
        if (!viaPop) { try { if (history.state && history.state.gf === id) { ignorarPop++; history.back(); } } catch (e) { /* ignore */ } }
        if (id === 'sheet-despesa' && pilha.includes('sheet-carrada')) atualizarConta();
        render();
    }
    window.addEventListener('popstate', () => {
        if (ignorarPop) { ignorarPop--; return; }
        const modal = $$('.gf-modal').find((m) => !m.classList.contains('oculto'));
        if (modal) { modal.classList.add('oculto'); return; }
        if (pilha.length) fecharTopo(true);
    });

    function segSet(form, campo, v) {
        const seg = $('[data-campo="' + campo + '"]', form);
        if (!seg) return;
        seg.dataset.valor = v;
        $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    }
    function segGet(form, campo) { const s = $('[data-campo="' + campo + '"]', form); return s ? s.dataset.valor : null; }

    // ---------- carrada ----------
    let fc = null; // carrada em edição
    const fCar = () => $('#form-carrada');
    function lembretes() { try { return JSON.parse(localStorage.getItem(chave('ultimos')) || '{}'); } catch (e) { return {}; } }

    function abrirCarrada(id) {
        const f = fCar();
        const ult = lembretes();
        fc = id ? Object.assign({}, db.carradas.find((c) => c.id === id)) : {
            id: null, data: hoje(), preco_modo: 'ponto', frete_base: ult.frete_base || 'por_t', tabela_id: ult.tabela_id || null, preco_manual: false,
            carregamento_base: ult.carregamento_base || 'por_t', status: 'aberta', minerio: ult.minerio || 'Manganês',
            preco_ponto: ult.preco_ponto, frete_unit: ult.frete_unit, carregamento_unit: ult.carregamento_unit, comprador: ult.comprador
        };
        TXT_CARRADA.forEach((k) => { if (f.elements[k]) f.elements[k].value = fc[k] || ''; });
        if (fc.data) f.elements.data.value = fc.data;
        NUM_CARRADA.forEach((k) => { if (f.elements[k]) f.elements[k].value = G.numInput(fc[k]); });
        ['preco_modo', 'frete_base', 'carregamento_base'].forEach((k) => segSet(f, k, fc[k]));
        $('#sc-titulo').textContent = id ? 'Carrada ' + ddmm(fc.data) : 'Nova carrada';
        $('details.gf-mais', f).open = !!Number(fc.ajuste || 0);
        if (!id && fc.tabela_id && !tabelasVivas().some((t) => t.id === fc.tabela_id)) fc.tabela_id = null;
        opcoesTabela(fc.tabela_id);
        estadoCarrada();
        if (!id) aplicarTabela(); else infoTabelaSalva();
        abrir('sheet-carrada');
    }
    function lerCarrada() {
        const f = fCar();
        const o = Object.assign({}, fc);
        TXT_CARRADA.forEach((k) => { const v = f.elements[k].value.trim(); o[k] = v || null; });
        if (!o.data) o.data = hoje();
        NUM_CARRADA.forEach((k) => { o[k] = G.parseBR(f.elements[k].value); });
        ['preco_modo', 'frete_base', 'carregamento_base'].forEach((k) => { o[k] = segGet(f, k); });
        o.tabela_id = f.elements.tabela_id.value && f.elements.tabela_id.value !== '__nova' ? f.elements.tabela_id.value : null;
        if (!o.tabela_id) { o.tabela_teor_ref = null; o.preco_manual = false; }
        if (o.placa) o.placa = o.placa.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
        return o;
    }
    function estadoCarrada() {
        const f = fCar();
        const modo = segGet(f, 'preco_modo');
        $$('[data-modo]', f).forEach((d) => d.classList.toggle('oculto', d.dataset.modo !== modo));
        const fin = fc.status === 'finalizada';
        $('#sc-campos').disabled = fin;
        $('#sc-status').outerHTML = '<span id="sc-status">' + (fc.id ? statusBadge(fc) : '') + '</span>';
        $('#sc-salvar').classList.toggle('oculto', fin);
        $('#sc-finalizar').classList.toggle('oculto', fin);
        $('#sc-reabrir').classList.toggle('oculto', !fin);
        $('#sc-excluir').classList.toggle('oculto', !fc.id);
        atualizarConta();
    }
    function linhaConta(lbl, v, det, cls) {
        return '<div class="gf-conta-l ' + (cls || '') + '"><span>' + lbl + (det ? '<small>' + det + '</small>' : '') + '</span><b>' + v + '</b></div>';
    }
    function contaHtml(c) {
        const t = c.peso_pago_t, tu = c.peso_umido_t;
        let det = '';
        if (c.preco_modo === 'total') det = 'valor informado';
        else if (t != null && c.preco_t != null) det = G.fmtNum(t, 2) + ' t seco × ' + G.fmtBRL(c.preco_t);
        if (c.ajuste) det += (det ? ' ' : '') + (c.ajuste > 0 ? '+ ' : '− ') + G.fmtBRL(Math.abs(c.ajuste));
        const fdet = (base, unit) => base === 'viagem' ? 'por viagem' : (tu != null && unit ? G.fmtNum(tu, 2) + ' t × ' + G.fmtBRL(unit) : '');
        const nD = despesasDe(c.id).length;
        return linhaConta('Valor de venda', G.fmtBRL(c.valor_venda), det, 'gf-conta-venda') +
            linhaConta('− Custo do minério', G.fmtBRL(c.custo_minerio || 0)) +
            linhaConta('− Frete', G.fmtBRL(c.frete_total), fdet(c.frete_base, c.frete_unit)) +
            linhaConta('− Carregamento', G.fmtBRL(c.carregamento_total), fdet(c.carregamento_base, c.carregamento_unit)) +
            linhaConta('− Impostos', G.fmtBRL(c.impostos_total), c.impostos_pct ? G.fmtNum(c.impostos_pct, 2) + '%' : '') +
            linhaConta('− Outros custos', G.fmtBRL(c.outros_custos || 0)) +
            linhaConta('− Despesas da carrada', G.fmtBRL(c.despesas_total), nD ? nD + ' lançamento(s)' : '') +
            linhaConta(c.status === 'finalizada' ? '= Lucro da carrada' : '= Lucro (prévia)', G.fmtBRL(c.lucro), '', 'gf-conta-lucro ' + (c.lucro >= 0 ? 'pos' : 'neg'));
    }
    function atualizarConta() {
        if (!fc) return;
        if (fc.id) { const atual = db.carradas.find((x) => x.id === fc.id); if (atual) fc.status = atual.status; }
        const c = calc(lerCarrada());
        $('#sc-pesos').innerHTML = c.erro ? '<span class="neg">⚠️ ' + esc(c.erro) + '</span>'
            : c.peso_umido_t != null ? 'Peso líquido <b>' + G.fmtNum(c.peso_umido_t, 2) + ' t</b>' + (c.umidade_pct ? ' − ' + G.fmtNum(c.umidade_pct, 2) + '% umidade' : '') + ' = <b>' + G.fmtNum(c.peso_seco_t, 2) + ' t seco</b>' : 'Digite bruto e tara (ou o líquido).';
        $('#sc-preco').innerHTML = c.preco_modo === 'ponto'
            ? 'Preço da tonelada: <b>' + G.fmtBRL(c.preco_t) + '</b>' + (c.preco_ponto && c.teor ? ' <small>(' + G.fmtBRL(c.preco_ponto) + ' × ' + G.fmtNum(c.teor, 2) + ' pontos)</small>' : '') +
              '<br>Total: <b>' + G.fmtBRL(c.valor_venda) + '</b>' + (c.peso_seco_t != null && c.preco_t ? ' <small>(' + G.fmtNum(c.peso_seco_t, 2) + ' t seco × ' + G.fmtBRL(c.preco_t) + ')</small>' : '')
            : 'Total: <b>' + G.fmtBRL(c.valor_venda) + '</b>';
        $('#sc-conta').innerHTML = contaHtml(c);
        const ds = fc.id ? despesasDe(fc.id) : [];
        $('#sc-despesas').innerHTML = ds.length ? '<h3 class="gf-h3">Despesas desta carrada</h3>' + ds.map(itemLanc).join('') : '';
    }
    function salvarCarrada(status) {
        const o = lerCarrada();
        const c = calc(o);
        if (c.erro) { toast(c.erro); return null; }
        if (!o.id) { o.id = novoId(); o.client_id = o.id; o.criado_em = new Date().toISOString(); }
        if (status) o.status = status;
        fc = o;
        localStorage.setItem(chave('ultimos'), JSON.stringify({
            minerio: o.minerio, tabela_id: o.tabela_id, preco_ponto: o.preco_ponto, frete_unit: o.frete_unit, frete_base: o.frete_base,
            carregamento_unit: o.carregamento_unit, carregamento_base: o.carregamento_base, comprador: o.comprador
        }));
        gravar('carradas', o);
        return o;
    }

    // ---------- tabela de preço na carrada ----------
    function opcoesTabela(sel) {
        const min = fCar().elements.minerio.value;
        const l = tabelasVivas().slice().sort((a, b) => (b.minerio === min) - (a.minerio === min));
        if (sel && !l.some((t) => t.id === sel)) { const t = db.tabelas.find((x) => x.id === sel); if (t) l.push(t); } // tabela excluída mas usada
        $('#sc-tabela').innerHTML = '<option value="">— Sem tabela (digitar preço) —</option>' + l.map((t) =>
            '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.nome + (t.minerio ? ' · ' + t.minerio : '') + (t.deleted_at ? ' (excluída)' : '')) + '</option>').join('') +
            '<option value="__nova">＋ Cadastrar nova tabela…</option>';
    }
    /** Acha o preço do teor na tabela e preenche o campo (se não foi digitado à mão) */
    function aplicarTabela() {
        const f = fCar();
        const tid = f.elements.tabela_id.value;
        const info = $('#sc-tabela-info');
        const t = tid && db.tabelas.find((x) => x.id === tid);
        if (!t) { info.classList.add('oculto'); fc.tabela_teor_ref = null; return; }
        info.classList.remove('oculto');
        const un = t.modo === 'tonelada' ? 'por tonelada' : 'por ponto';
        if (fc.preco_manual) {
            info.innerHTML = '✏️ Preço digitado à mão (tabela ignorada). <button type="button" class="gf-btn gf-btn-mini gf-btn-sec" id="sc-usar-tabela">Usar tabela</button>';
            return;
        }
        const teor = G.parseBR(f.elements.teor.value);
        const L = (t.linhas || []).slice().sort((a, b) => a.teor - b.teor);
        if (teor == null) { info.innerHTML = '📋 Digite o teor para achar o preço na tabela.'; fc.tabela_teor_ref = null; return; }
        const r = G.lookupTabela(L, teor);
        if (!r) {
            fc.tabela_teor_ref = null;
            info.innerHTML = '⚠️ Teor ' + esc(G.fmtNum(teor, 2)) + '% está abaixo da 1ª linha da tabela' + (L.length ? ' (' + esc(G.fmtNum(L[0].teor, 2)) + '%)' : '') + '. Digite o preço.';
            return;
        }
        fc.tabela_teor_ref = r.teor;
        if (t.modo === 'tonelada') { segSet(f, 'preco_modo', 'tonelada'); f.elements.preco_t_informado.value = G.numInput(r.valor); }
        else { segSet(f, 'preco_modo', 'ponto'); f.elements.preco_ponto.value = G.numInput(r.valor); }
        $$('[data-modo]', f).forEach((d) => d.classList.toggle('oculto', d.dataset.modo !== segGet(f, 'preco_modo')));
        info.innerHTML = '📋 <b>' + esc(t.nome) + '</b>: usou a linha <b>' + esc(G.fmtNum(r.teor, 2)) + '%</b> → ' + esc(G.fmtBRL(r.valor)) + ' ' + un +
            (r.exato ? ' (linha exata)' : ' (faixa: teor ' + esc(G.fmtNum(teor, 2)) + '% ≥ ' + esc(G.fmtNum(r.teor, 2)) + '%)');
    }

    // Carrada já salva: mostra a linha usada sem recalcular (preço é "foto" do dia)
    function infoTabelaSalva() {
        const info = $('#sc-tabela-info');
        const t = fc.tabela_id && db.tabelas.find((x) => x.id === fc.tabela_id);
        if (!t) { info.classList.add('oculto'); return; }
        info.classList.remove('oculto');
        info.innerHTML = fc.preco_manual ? '✏️ Preço digitado à mão (tabela <b>' + esc(t.nome) + '</b> ignorada).'
            : fc.tabela_teor_ref != null ? '📋 <b>' + esc(t.nome) + '</b>: usou a linha <b>' + esc(G.fmtNum(fc.tabela_teor_ref, 2)) + '%</b>. Mude o teor ou a tabela para recalcular.'
            : '📋 <b>' + esc(t.nome) + '</b>';
    }

    // ---------- tabela de preço (cadastro) ----------
    let ft = null;
    const fTab = () => $('#form-tabela');
    function linhasDoForm() {
        return $$('#st-linhas .gf-tab-linha').map((el) => ({ teor: G.parseBR($('[data-k=teor]', el).value), valor: G.parseBR($('[data-k=valor]', el).value) }));
    }
    function renderLinhas(linhas) {
        $('#st-linhas').innerHTML = linhas.map((l, i) => '<div class="gf-tab-linha" data-i="' + i + '">' +
            '<input type="text" inputmode="decimal" data-k="teor" aria-label="Teor %" placeholder="40" value="' + esc(G.numInput(l.teor)) + '">' +
            '<input type="text" inputmode="decimal" data-k="valor" aria-label="Valor" placeholder="10,00" value="' + esc(G.numInput(l.valor)) + '">' +
            '<button type="button" class="gf-acao gf-acao-del gf-linha-del" data-del-linha="' + i + '" aria-label="Excluir linha">🗑️</button></div>').join('') ||
            '<p class="gf-vazio">Sem linhas. Toque em ＋ Adicionar linha ou cole da planilha.</p>';
    }
    function modoTabelaUi() {
        const m = segGet(fTab(), 'modo');
        $('#st-col-valor').textContent = m === 'tonelada' ? 'R$ por tonelada' : 'R$ por ponto';
        $('#st-ajuda').textContent = m === 'tonelada'
            ? 'Cada linha é o preço da tonelada seca para aquela faixa de teor.'
            : 'Cada linha é o R$ por ponto (1% de teor) por tonelada: preço/t = valor × teor da carga.';
    }
    function abrirTabela(id, minerio) {
        const f = fTab();
        ft = id ? JSON.parse(JSON.stringify(db.tabelas.find((t) => t.id === id))) : { id: null, nome: '', minerio: minerio || '', comprador: '', modo: 'ponto', linhas: [{ teor: null, valor: null }] };
        f.elements.nome.value = ft.nome || ''; f.elements.minerio.value = ft.minerio || ''; f.elements.comprador.value = ft.comprador || '';
        segSet(f, 'modo', ft.modo || 'ponto'); modoTabelaUi();
        renderLinhas((ft.linhas || []).slice().sort((a, b) => (a.teor == null) - (b.teor == null) || a.teor - b.teor));
        $('#st-colar').value = ''; $('#st-colar-box').open = false;
        $('#st-titulo').textContent = id ? 'Editar tabela' : 'Nova tabela de preço';
        $('#st-excluir').classList.toggle('oculto', !id);
        abrir('sheet-tabela');
    }
    function salvarTabela() {
        const f = fTab();
        const nome = f.elements.nome.value.trim();
        if (!nome) { toast('Dê um nome para a tabela'); f.elements.nome.focus(); return; }
        const brutas = linhasDoForm().filter((l) => l.teor != null || l.valor != null);
        if (brutas.some((l) => l.teor == null || l.valor == null)) { toast('Preencha teor e valor em todas as linhas'); return; }
        if (brutas.some((l) => l.teor < 0 || l.teor > 100 || l.valor < 0)) { toast('Teor deve ser de 0 a 100%'); return; }
        const teores = brutas.map((l) => l.teor);
        if (new Set(teores).size !== teores.length) { toast('Tem teor repetido na tabela'); return; }
        if (!brutas.length) { toast('Adicione pelo menos 1 linha'); return; }
        const o = Object.assign({}, ft, { nome, minerio: f.elements.minerio.value || null, comprador: f.elements.comprador.value.trim() || null,
            modo: segGet(f, 'modo'), linhas: brutas.sort((a, b) => a.teor - b.teor) });
        if (!o.id) { o.id = novoId(); o.client_id = o.id; }
        gravar('tabelas', o);
        fecharTopo();
        toast('Tabela salva');
        if (pilha[pilha.length - 1] === 'sheet-carrada') { opcoesTabela(o.id); fc.preco_manual = false; aplicarTabela(); atualizarConta(); }
    }

    // ---------- categoria do usuário ----------
    let fk = null;
    function abrirCategoria(id, tipo) {
        const f = $('#form-categoria');
        fk = id ? Object.assign({}, db.categorias.find((c) => c.id === id)) : { id: null, tipo: tipo || 'saida', nome: '', icone: '' };
        segSet(f, 'tipo', fk.tipo); f.elements.nome.value = fk.nome || ''; f.elements.icone.value = fk.icone || '';
        $('#sk-titulo').textContent = id ? 'Editar categoria' : 'Nova categoria';
        $('#sk-excluir').classList.toggle('oculto', !id);
        abrir('sheet-categoria');
    }
    function salvarCategoria() {
        const f = $('#form-categoria');
        const nome = f.elements.nome.value.trim();
        if (!nome) { toast('Digite o nome'); return; }
        const tipo = segGet(f, 'tipo');
        if (catsVivas().some((c) => c.id !== fk.id && c.tipo === tipo && c.nome.toLowerCase() === nome.toLowerCase())) { toast('Já existe essa categoria'); return; }
        const o = Object.assign({}, fk, { nome, tipo, icone: f.elements.icone.value.trim() || null, arquivada: false });
        if (!o.id) { o.id = novoId(); o.ordem = 200; o.auth_id = uid; }
        gravar('categorias', o);
        fecharTopo();
        toast('Categoria salva');
        if (pilha[pilha.length - 1] === 'sheet-despesa' && fd && segGet(fDes(), 'tipo') === o.tipo) { fd.categoria_id = o.id; renderCats(); }
    }

    // ---------- despesa ----------
    let fd = null, fotoNova = null, fotoRemovida = false;
    const fDes = () => $('#form-despesa');
    function renderCats() {
        const tipo = segGet(fDes(), 'tipo');
        $('#sd-cats').innerHTML = catsVivas().filter((c) => c.tipo === tipo).map((c) =>
            '<button type="button" class="gf-cat' + (fd.categoria_id === c.id ? ' on' : '') + '" data-cat="' + esc(c.id) + '"><span aria-hidden="true">' +
            esc(c.icone || '•') + '</span>' + esc(c.nome) + '</button>').join('') +
            '<button type="button" class="gf-cat gf-cat-nova" data-acao="nova-categoria-aqui"><span aria-hidden="true">＋</span>Nova categoria</button>';
    }
    function opcoesCarrada(sel) {
        const l = carradasVivas().filter((c) => c.status !== 'cancelada' && (c.status === 'aberta' || c.id === sel))
            .concat(carradasVivas().filter((c) => c.status === 'finalizada' && c.id !== sel).slice(0, 10));
        $('#sd-carrada').innerHTML = '<option value="">— Nenhuma (despesa avulsa) —</option>' + l.map((c) =>
            '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(ddmm(c.data) + ' · ' + (c.minerio || '') + (c.placa ? ' · ' + c.placa : '') + (c.status === 'finalizada' ? ' (finalizada)' : '')) + '</option>').join('');
    }
    async function mostrarFoto() {
        const prev = $('#sd-foto-prev'), img = $('#sd-foto-img');
        if (fotoNova) { img.src = URL.createObjectURL(fotoNova); prev.classList.remove('oculto'); }
        else if (fd.comprovante_path && !fotoRemovida) {
            prev.classList.remove('oculto'); img.removeAttribute('src'); img.alt = 'Carregando foto…';
            const u = await urlFoto(fd.comprovante_path);
            if (u) { img.src = u; img.alt = 'Comprovante'; } else img.alt = 'Foto indisponível sem internet';
        } else { prev.classList.add('oculto'); img.removeAttribute('src'); }
        $('#sd-foto-btn').textContent = (fotoNova || (fd.comprovante_path && !fotoRemovida)) ? '📷 Trocar foto' : '📷 Foto do comprovante';
    }
    function abrirDespesa(id, carradaId) {
        const f = fDes();
        fd = id ? Object.assign({}, db.lancamentos.find((l) => l.id === id))
            : { id: null, tipo: 'saida', data: hoje(), status: 'pago', forma_pagto: 'pix', carrada_id: carradaId || null };
        fotoNova = null; fotoRemovida = false;
        f.elements.valor.value = fd.valor != null ? G.numInput(fd.valor) : '';
        f.elements.data.value = fd.data || hoje();
        f.elements.forma_pagto.value = fd.forma_pagto || 'pix';
        f.elements.descricao.value = fd.descricao || '';
        f.elements.observacao.value = fd.observacao || '';
        segSet(f, 'tipo', fd.tipo); segSet(f, 'status', fd.status);
        opcoesCarrada(fd.carrada_id);
        renderCats();
        $('#sd-titulo').textContent = id ? (fd.tipo === 'entrada' ? 'Editar entrada' : 'Editar despesa') : 'Nova despesa';
        $('#sd-excluir').classList.toggle('oculto', !id);
        mostrarFoto();
        abrir('sheet-despesa');
        if (!id) setTimeout(() => { try { f.elements.valor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 250);
    }
    async function salvarDespesa() {
        const f = fDes();
        const valor = G.parseBR(f.elements.valor.value);
        if (!valor || valor <= 0) { toast('Digite o valor'); f.elements.valor.focus(); return; }
        const o = Object.assign({}, fd, {
            tipo: segGet(f, 'tipo'), valor: Math.round(valor * 100) / 100, data: f.elements.data.value || hoje(),
            forma_pagto: f.elements.forma_pagto.value, descricao: f.elements.descricao.value.trim() || null,
            observacao: f.elements.observacao.value.trim() || null, status: segGet(f, 'status'),
            carrada_id: f.elements.carrada_id.value || null
        });
        if (!o.id) { o.id = novoId(); o.client_id = o.id; o.criado_em = new Date().toISOString(); }
        const antigo = fd.comprovante_path || null;
        if (fotoNova) {
            const path = uid + '/' + o.id + '-' + Date.now() + '.jpg';
            try { await idbPut(path, fotoNova); } catch (e) { toast('Não deu para guardar a foto'); return; }
            outbox.push({ foto: path });
            o.comprovante_path = path;
            if (antigo) outbox.push({ fotoDel: antigo });
        } else if (fotoRemovida) {
            o.comprovante_path = null;
            if (antigo) outbox.push({ fotoDel: antigo });
        }
        gravar('lancamentos', o);
        fecharTopo();
        toast(o.tipo === 'entrada' ? 'Entrada salva' : 'Despesa salva');
    }

    // ---------- excluir c/ desfazer ----------
    const NOMES = { carradas: ['Carrada', 'Excluir esta carrada? As despesas dela passam a contar como avulsas.'],
        lancamentos: ['Lançamento', 'Excluir este lançamento?'], tabelas: ['Tabela', 'Excluir esta tabela de preço? As carradas já feitas não mudam.'],
        categorias: ['Categoria', 'Excluir esta categoria? Os lançamentos antigos continuam com ela.'] };
    function excluir(tab, id, semConfirmar) {
        const r = db[tab].find((x) => x.id === id); if (!r) return false;
        if (!semConfirmar && !confirm(NOMES[tab][1])) return false;
        const campo = tab === 'categorias' ? { arquivada: true } : { deleted_at: new Date().toISOString() };
        const volta = tab === 'categorias' ? { arquivada: false } : { deleted_at: null };
        gravar(tab, Object.assign({}, r, campo));
        toast(NOMES[tab][0] + ' excluída', () => { gravar(tab, Object.assign({}, r, volta)); toast('Desfeito'); });
        return true;
    }
    function editarCarrada(id) {
        const c = db.carradas.find((x) => x.id === id); if (!c) return;
        if (c.status === 'finalizada') {
            if (!confirm('Esta carrada está finalizada. Reabrir para editar?')) return;
            gravar('carradas', Object.assign({}, c, { status: 'aberta' }));
            toast('Carrada reaberta');
        }
        abrirCarrada(id);
    }

    // ---------- CSV ----------
    function baixar(nome, txt) {
        const blob = new Blob([txt], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nome;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    function csvCarradas() {
        const l = carradasVivas().map(calc).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
        const modo = { ponto: 'Por ponto', tonelada: 'Por tonelada', total: 'Valor total' };
        const cols = [
            ['Data', (c) => G.dataBR(c.data)], ['Status', (c) => c.status], ['Minério', (c) => c.minerio], ['Placa', (c) => c.placa],
            ['Motorista', (c) => c.motorista], ['Comprador', (c) => c.comprador], ['Ticket', (c) => c.ticket_numero], ['NF', (c) => c.nf_numero],
            ['Peso líquido (kg)', (c) => c.peso_liquido_kg], ['Umidade %', (c) => c.umidade_pct], ['Peso líquido (t)', (c) => c.peso_umido_t], ['Peso seco (t)', (c) => c.peso_seco_t],
            ['Teor %', (c) => c.teor], ['Modo preço', (c) => modo[c.preco_modo] || c.preco_modo],
            ['Tabela', (c) => { const t = c.tabela_id && db.tabelas.find((x) => x.id === c.tabela_id); return t ? t.nome : ''; }],
            ['Linha da tabela (teor %)', (c) => c.tabela_teor_ref], ['Preço por ponto', (c) => c.preco_ponto], ['Preço/t', (c) => c.preco_t],
            ['Valor de venda', (c) => c.valor_venda], ['Custo minério', (c) => c.custo_minerio || 0], ['Frete', (c) => c.frete_total],
            ['Carregamento', (c) => c.carregamento_total], ['Impostos', (c) => c.impostos_total], ['Outros custos', (c) => c.outros_custos || 0],
            ['Despesas vinculadas', (c) => c.despesas_total], ['Lucro', (c) => c.lucro], ['Observação', (c) => c.observacao]
        ].map(([titulo, v]) => ({ titulo, v }));
        baixar('gestor-carradas-' + hoje() + '.csv', G.csv(cols, l));
    }
    function csvDespesas() {
        const l = lancVivos().sort((a, b) => (a.data || '').localeCompare(b.data || ''));
        const cols = [
            ['Data', (x) => G.dataBR(x.data)], ['Tipo', (x) => (x.tipo === 'entrada' ? 'Entrada' : 'Despesa')],
            ['Categoria', (x) => { const c = catPor(x.categoria_id); return c ? c.nome : ''; }], ['Descrição', (x) => x.descricao],
            ['Valor', (x) => Number(x.valor)], ['Pagamento', (x) => x.forma_pagto], ['Status', (x) => x.status],
            ['Carrada', (x) => { const c = x.carrada_id && db.carradas.find((k) => k.id === x.carrada_id); return c ? G.dataBR(c.data) + ' ' + (c.placa || '') : ''; }],
            ['Tem foto', (x) => (x.comprovante_path ? 'sim' : '')], ['Observação', (x) => x.observacao]
        ].map(([titulo, v]) => ({ titulo, v }));
        baixar('gestor-despesas-' + hoje() + '.csv', G.csv(cols, l));
    }

    // ---------- eventos ----------
    function bind() {
        $$('.gf-tab').forEach((b) => b.addEventListener('click', () => irAba(b.dataset.aba)));
        document.addEventListener('click', (e) => {
            const t = e.target.closest('[data-acao],[data-carrada],[data-lanc],[data-ir],[data-fechar],[data-f],[data-cat],[data-ed],[data-del],[data-del-linha],#sc-usar-tabela,.gf-seg button');
            if (!t) return;
            if (t.matches('.gf-seg button')) {
                const seg = t.closest('.gf-seg'), form = t.closest('form');
                if (form && form.querySelector('fieldset:disabled') && form.querySelector('fieldset:disabled').contains(t)) return;
                segSet(form, seg.dataset.campo, t.dataset.v);
                if (form.id === 'form-carrada') { if (seg.dataset.campo === 'preco_modo' && form.elements.tabela_id.value) { fc.preco_manual = true; aplicarTabela(); } estadoCarrada(); }
                if (form.id === 'form-tabela') modoTabelaUi();
                if (form.id === 'form-despesa' && seg.dataset.campo === 'tipo') { fd.categoria_id = null; renderCats(); $('#sd-titulo').textContent = t.dataset.v === 'entrada' ? 'Nova entrada' : 'Nova despesa'; }
                return;
            }
            if (t.id === 'sc-usar-tabela') { fc.preco_manual = false; aplicarTabela(); atualizarConta(); return; }
            if (t.dataset.ed) {
                const [tipo, id] = t.dataset.ed.split(':');
                if (tipo === 'carrada') editarCarrada(id); else if (tipo === 'lanc') abrirDespesa(id);
                else if (tipo === 'tabela') abrirTabela(id); else if (tipo === 'cat') abrirCategoria(id);
                return;
            }
            if (t.dataset.del) {
                const [tipo, id] = t.dataset.del.split(':');
                excluir({ carrada: 'carradas', lanc: 'lancamentos', tabela: 'tabelas', cat: 'categorias' }[tipo], id);
                return;
            }
            if (t.dataset.delLinha != null) { // linha da tabela em edição: some na hora, com Desfazer
                const linhas = linhasDoForm(); const i = Number(t.dataset.delLinha); const tirada = linhas.splice(i, 1)[0];
                renderLinhas(linhas);
                toast('Linha excluída', () => { const l2 = linhasDoForm(); l2.splice(i, 0, tirada); renderLinhas(l2); });
                return;
            }
            if (t.dataset.acao === 'nova-tabela') abrirTabela(null);
            else if (t.dataset.acao === 'nova-categoria') abrirCategoria(null);
            else if (t.dataset.acao === 'nova-categoria-aqui') abrirCategoria(null, segGet(fDes(), 'tipo'));
            else if (t.dataset.acao === 'nova-carrada') abrirCarrada(null);
            else if (t.dataset.acao === 'nova-despesa') abrirDespesa(null);
            else if (t.dataset.carrada) abrirCarrada(t.dataset.carrada);
            else if (t.dataset.lanc) abrirDespesa(t.dataset.lanc);
            else if (t.dataset.ir) irAba(t.dataset.ir);
            else if (t.hasAttribute('data-fechar')) {
                const modal = t.closest('.gf-modal');
                if (modal) modal.classList.add('oculto'); else fecharTopo();
            } else if (t.dataset.f) { filtroCarradas = t.dataset.f; renderCarradas(); }
            else if (t.dataset.cat) { fd.categoria_id = fd.categoria_id === t.dataset.cat ? null : t.dataset.cat; renderCats(); }
        });
        $('#gf-fab').addEventListener('click', () => (aba === 'despesas' ? abrirDespesa(null) : abrirCarrada(null)));
        fCar().addEventListener('input', (e) => {
            const n = e.target.name;
            if (n === 'tabela_id') {
                if (e.target.value === '__nova') { e.target.value = fc.tabela_id || ''; abrirTabela(null, fCar().elements.minerio.value); return; }
                fc.tabela_id = e.target.value || null; fc.preco_manual = false; aplicarTabela();
            } else if (n === 'teor' || n === 'minerio') { if (n === 'minerio') opcoesTabela(fCar().elements.tabela_id.value); aplicarTabela(); }
            else if (['preco_ponto', 'preco_t_informado', 'valor_informado'].includes(n) && fCar().elements.tabela_id.value) { fc.preco_manual = true; aplicarTabela(); }
            atualizarConta();
        });
        fCar().addEventListener('submit', (e) => {
            e.preventDefault();
            if (salvarCarrada()) { fecharTopo(); toast('Carrada salva'); }
        });
        $('#sc-finalizar').addEventListener('click', () => {
            const c = calc(lerCarrada());
            if (!(c.valor_venda > 0)) { toast('Preencha peso e preço antes de finalizar'); return; }
            const o = salvarCarrada('finalizada');
            if (!o) return;
            estadoCarrada();
            $('#ml-conta').innerHTML = '<p class="gf-ml-lucro ' + (c.lucro >= 0 ? 'pos' : 'neg') + '"><small>Lucro da carrada</small>' + G.fmtBRL(calc(o).lucro) + '</p>' + contaHtml(calc(o));
            $('#modal-lucro').classList.remove('oculto');
        });
        $('#sc-reabrir').addEventListener('click', () => { gravar('carradas', Object.assign({}, fc, { status: 'aberta' })); fc.status = 'aberta'; estadoCarrada(); toast('Carrada reaberta'); });
        $('#sc-excluir').addEventListener('click', () => {
            if (!fc.id || !confirm(NOMES.carradas[1])) return;
            const id = fc.id; fecharTopo(); excluir('carradas', id, true);
        });
        $('#sc-add-despesa').addEventListener('click', () => {
            if (!fc.id) { const o = salvarCarrada(); if (!o) return; estadoCarrada(); }
            abrirDespesa(null, fc.id);
        });
        fDes().addEventListener('submit', (e) => { e.preventDefault(); salvarDespesa(); });
        $('#sd-excluir').addEventListener('click', () => {
            if (!fd.id || !confirm(NOMES.lancamentos[1])) return;
            const id = fd.id; fecharTopo(); excluir('lancamentos', id, true);
        });
        $('#sd-foto-btn').addEventListener('click', () => $('#sd-foto-input').click());
        $('#sd-foto-input').addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            try { fotoNova = await comprimir(file); fotoRemovida = false; mostrarFoto(); }
            catch (err) { toast('Não consegui abrir essa imagem'); }
        });
        $('#sd-foto-remover').addEventListener('click', () => { fotoNova = null; fotoRemovida = true; mostrarFoto(); });
        $('#sd-foto-img').addEventListener('click', () => {
            const src = $('#sd-foto-img').src; if (!src) return;
            $('#mf-img').src = src; $('#modal-foto').classList.remove('oculto');
        });
        $('#resumo-mes').addEventListener('change', renderResumo);
        fTab().addEventListener('submit', (e) => { e.preventDefault(); salvarTabela(); });
        $('#st-add-linha').addEventListener('click', () => {
            const l = linhasDoForm(); l.push({ teor: null, valor: null }); renderLinhas(l);
            const ins = $$('#st-linhas [data-k=teor]'); if (ins.length) ins[ins.length - 1].focus();
        });
        $('#st-importar').addEventListener('click', () => {
            const novas = G.parseTabelaColada($('#st-colar').value);
            if (!novas.length) { toast('Não achei linhas (teor e valor por linha)'); return; }
            const atuais = linhasDoForm().filter((l) => l.teor != null || l.valor != null);
            if (atuais.length && !confirm('Trocar as ' + atuais.length + ' linha(s) atuais pelas ' + novas.length + ' coladas?')) return;
            renderLinhas(novas); $('#st-colar').value = ''; $('#st-colar-box').open = false;
            toast(novas.length + ' linha(s) importada(s) — confira e salve');
        });
        $('#st-excluir').addEventListener('click', () => {
            if (!ft.id || !confirm(NOMES.tabelas[1])) return;
            const id = ft.id; fecharTopo(); excluir('tabelas', id, true);
        });
        $('#form-categoria').addEventListener('submit', (e) => { e.preventDefault(); salvarCategoria(); });
        $('#sk-excluir').addEventListener('click', () => {
            if (!fk.id || !confirm(NOMES.categorias[1])) return;
            const id = fk.id; fecharTopo(); excluir('categorias', id, true);
        });
        $('#btn-csv-carradas').addEventListener('click', csvCarradas);
        $('#btn-csv-despesas').addEventListener('click', csvDespesas);
        window.addEventListener('online', () => { servidorErro = ''; puxar(); });
        window.addEventListener('offline', renderSync);
        setInterval(() => { if (outbox.length) flush(); }, 20000);
    }

    // ---------- início ----------
    (async function init() {
        const session = await requireSession();
        if (!session) return;
        uid = session.user.id;
        lerLocal();
        bind();
        render();
        const h = location.hash; // limpa o # antes de empilhar a folha (senão voltar reabre)
        if (h) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
        if (h === '#nova-carrada') abrirCarrada(null);
        else if (h === '#nova-despesa') abrirDespesa(null);
        puxar();
        try {
            const perfil = await getPerfil(session);
            aplicarUserLabel(perfil);
            montarNav('gestor', perfil);
        } catch (e) { console.warn('gestor perfil', e); }
    })();

    window.__gestor = { get db() { return db; }, get outbox() { return outbox; }, flush, puxar }; // QA/depuração
})();
