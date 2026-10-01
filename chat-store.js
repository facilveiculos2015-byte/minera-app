/* Minera Pará — camada de dados do chat (só chat.html).
 * window.ChatStore: detecção do SQL 44, lista (inbox), páginas da conversa,
 * leitura/entrega, envio idempotente (client_id), fila offline (outbox) e
 * cache local (lista + últimas mensagens por conversa) p/ pintar na hora.
 *
 * Com SQL 44  → RPCs chat_inbox_v1 / chat_dm_pagina / chat_marcar_lido + client_id.
 * Sem SQL 44  → consultas legadas CORRIGIDAS (por par, order id desc, limit 40).
 */
(function () {
    'use strict';

    var COLS_BASE = 'id,de_auth_id,de_nome,para_auth_id,texto,tipo,midia_url,status,agendado_para,criado_em,deleted_at,moderacao,apagada_para,resposta_a_id';
    var COLS_44 = COLS_BASE + ',client_id,editado_em';
    var PAGINA = 40;

    var uid = null;
    var v44 = null;          // null = ainda não sei; true/false depois da 1ª chamada
    var forcarLegado = false; // QA: ?chat_legado=1

    try { forcarLegado = /[?&]chat_legado=1/.test(location.search); } catch (e) { /* ignore */ }
    // Última detecção (p/ enviar com client_id mesmo abrindo offline); revalidada a cada inbox
    try { if (!forcarLegado && localStorage.getItem('minera_chat_v44') === '1') v44 = true; } catch (e) { /* ignore */ }
    function marcarV44(v) {
        v44 = v;
        try { localStorage.setItem('minera_chat_v44', v ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    function sb() { return supabaseClient; }
    function cols() { return v44 ? COLS_44 : COLS_BASE; }
    function setUid(u) { uid = u; }
    function temV44() { return v44 === true; }

    function ehFuncaoAusente(err) {
        if (!err) return false;
        var c = String(err.code || '');
        return c === 'PGRST202' || c === '42883' || c === '404' || /Could not find the function|schema cache/i.test(err.message || '');
    }
    /** Erro de rede (offline, DNS, timeout) → vale tentar de novo. */
    function ehErroRede(err) {
        if (!err) return false;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        var m = String(err.message || err.details || err || '');
        return /Failed to fetch|NetworkError|Load failed|network|fetch|timeout|ERR_INTERNET|ECONN|aborted/i.test(m) && !err.code;
    }

    /* ---------------- cache local ---------------- */
    function kInbox() { return 'minera_chat_inbox_' + uid; }
    function kThread(peer) { return 'minera_chat_th_' + uid + '_' + peer; }
    function kThreadIdx() { return 'minera_chat_th_idx_' + uid; }
    function lerJSON(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
    function gravarJSON(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) {
            // cota cheia: limpa caches de conversa e tenta de novo
            try { limparCachesThread(); localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e2) { return false; }
        }
    }
    function limparCachesThread() {
        var idx = lerJSON(kThreadIdx(), []);
        idx.forEach(function (p) { try { localStorage.removeItem(kThread(p)); } catch (e) { /* ignore */ } });
        try { localStorage.removeItem(kThreadIdx()); } catch (e) { /* ignore */ }
    }
    function cacheInboxLer() { return uid ? lerJSON(kInbox(), null) : null; }
    function cacheInboxGravar(lista) { if (uid) gravarJSON(kInbox(), { t: Date.now(), l: (lista || []).slice(0, 150) }); }
    /** Nunca guarda data-URL (pesado) no cache. */
    function enxugar(m) {
        var o = {};
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k) && k.charAt(0) !== '_') o[k] = m[k];
        if (o.midia_url && /^data:/.test(o.midia_url)) { o.midia_url = null; o._semMidia = true; }
        return o;
    }
    function cacheThreadLer(peer) { return uid ? lerJSON(kThread(peer), null) : null; }
    function cacheThreadGravar(peer, msgs) {
        if (!uid || !peer) return;
        var ult = (msgs || []).filter(function (m) { return m && m.id != null; }).slice(-50).map(enxugar);
        gravarJSON(kThread(peer), { t: Date.now(), m: ult });
        var idx = lerJSON(kThreadIdx(), []).filter(function (p) { return p !== peer; });
        idx.unshift(peer);
        var sobra = idx.slice(20); // no máx. 20 conversas em cache
        sobra.forEach(function (p) { try { localStorage.removeItem(kThread(p)); } catch (e) { /* ignore */ } });
        gravarJSON(kThreadIdx(), idx.slice(0, 20));
    }

    /* ---------------- leituras locais (badge do sino usa o mesmo mapa) ---------------- */
    function kLeit() { return 'minera_chat_leituras_' + (uid || 'anon'); }
    function leituraLocal(peer) { var m = lerJSON(kLeit(), {}) || {}; return Number(m[peer] || 0); }
    function salvarLeituraLocal(peer, id) {
        if (!peer || !id) return false;
        var m = lerJSON(kLeit(), {}) || {};
        if (Number(id) > Number(m[peer] || 0)) { m[peer] = Number(id); gravarJSON(kLeit(), m); return true; }
        return false;
    }

    /* ---------------- perfis ---------------- */
    function semEmail(s) { s = String(s || '').trim(); return /@/.test(s) ? '' : s; }
    async function perfis(ids) {
        if (!ids || !ids.length) return [];
        try {
            var r = await sb().rpc('chat_perfis_publicos', { p_ids: ids });
            if (r.error) throw r.error;
            return (r.data || []).map(function (u) { var o = Object.assign({}, u); delete o.email; o.nome = semEmail(o.nome); o.apelido = semEmail(o.apelido); return o; });
        } catch (e) { console.warn('chat_perfis_publicos', e); return []; }
    }

    /* ---------------- INBOX ---------------- */
    function nomeContato(apelidoContato, apelido, nome) {
        return semEmail(apelidoContato) || semEmail(apelido) || semEmail(nome) || 'Contato';
    }
    /** Lista em 1 chamada (SQL 44) — ou legado corrigido em paralelo. Ordem: recência. */
    async function inbox() {
        if (v44 !== false && !forcarLegado) {
            var t0 = performance.now();
            var r = await sb().rpc('chat_inbox_v1', { p_limit: 200 });
            if (!r.error) {
                marcarV44(true);
                var lista = (r.data || []).filter(function (x) { return !x.oculto; }).map(function (x) {
                    var lidaLocal = leituraLocal(x.peer_auth_id);
                    var naoLidas = Number(x.nao_lidas || 0);
                    if (x.last_id && lidaLocal >= Number(x.last_id)) naoLidas = 0;
                    return {
                        auth_id: x.peer_auth_id,
                        nome: nomeContato(x.contato_apelido, x.peer_apelido, x.peer_nome),
                        apelido: semEmail(x.peer_apelido) || null,
                        nomeReal: semEmail(x.peer_nome) || null,
                        papeis: x.peer_papeis || [],
                        tipo: x.peer_tipo || '',
                        last: x.last_id ? {
                            id: x.last_id, de_auth_id: x.last_de_auth_id, texto: x.last_texto, tipo: x.last_tipo,
                            criado_em: x.last_criado_em, deleted_at: x.last_deleted ? x.last_criado_em : null
                        } : null,
                        unread: naoLidas,
                        peerLida: Number(x.peer_ultima_lida_id || 0),
                        peerEntregue: Number(x.peer_ultima_entregue_id || 0)
                    };
                });
                ordenar(lista);
                ChatStore.ultimoInboxMs = Math.round(performance.now() - t0);
                return lista;
            }
            // Sem SQL 44 → legado para sempre; outro erro (rede/rota) → legado só desta vez
            if (ehFuncaoAusente(r.error)) marcarV44(false);
            else console.warn('chat_inbox_v1 falhou; usando consulta legada', r.error && r.error.message);
        }
        return inboxLegado();
    }
    function ordenar(lista) {
        lista.sort(function (a, b) {
            var ia = a.last ? Number(a.last.id) : 0, ib = b.last ? Number(b.last.id) : 0;
            if (ia !== ib) return ib - ia;
            return String(a.nome).localeCompare(String(b.nome));
        });
        return lista;
    }
    async function inboxLegado() {
        var t0 = performance.now();
        var res = await Promise.all([
            sb().from('chat_contatos').select('contato_auth_id,apelido,criado_em').eq('auth_id', uid),
            sb().from('chat_mensagens').select('id,de_auth_id,para_auth_id,texto,tipo,criado_em,status,deleted_at,apagada_para')
                .or('de_auth_id.eq.' + uid + ',para_auth_id.eq.' + uid)
                .order('id', { ascending: false }).limit(400),
            sb().from('chat_conversas_ocultas').select('outro_auth_id,oculto_em').eq('auth_id', uid)
        ]);
        if (res[0].error) throw res[0].error;
        var contatos = res[0].data || [];
        var msgs = (res[1].data || []).filter(function (m) {
            if (Array.isArray(m.apagada_para) && m.apagada_para.indexOf(uid) >= 0) return false;
            if (m.para_auth_id === uid && (m.status || '') === 'agendada') return false;
            return !!m.para_auth_id;
        });
        var ocultas = {};
        (res[2].data || []).forEach(function (o) { ocultas[o.outro_auth_id] = o.oculto_em; });
        var last = {}, unread = {};
        msgs.forEach(function (m) {
            var peer = m.de_auth_id === uid ? m.para_auth_id : m.de_auth_id;
            if (!peer) return;
            if (!last[peer]) last[peer] = m;
            if (m.para_auth_id === uid && !m.deleted_at && Number(m.id) > leituraLocal(peer)) unread[peer] = (unread[peer] || 0) + 1;
        });
        var apelidos = {};
        contatos.forEach(function (c) { apelidos[c.contato_auth_id] = c.apelido; });
        var ids = Object.keys(Object.assign({}, apelidos, last));
        var ps = await perfis(ids);
        var byId = {};
        ps.forEach(function (p) { byId[p.auth_id] = p; });
        var lista = ids.map(function (peer) {
            var p = byId[peer] || {};
            var l = last[peer] || null;
            return {
                auth_id: peer,
                nome: nomeContato(apelidos[peer], p.apelido, p.nome),
                apelido: semEmail(p.apelido) || null,
                nomeReal: semEmail(p.nome) || null,
                papeis: p.papeis || [], tipo: p.tipo || '',
                last: l ? { id: l.id, de_auth_id: l.de_auth_id, texto: l.deleted_at ? '' : l.texto, tipo: l.tipo, criado_em: l.criado_em, deleted_at: l.deleted_at } : null,
                unread: unread[peer] || 0, peerLida: 0, peerEntregue: 0
            };
        }).filter(function (c) {
            var oc = ocultas[c.auth_id];
            if (!oc) return true;
            return c.last && new Date(c.last.criado_em).getTime() > new Date(oc).getTime();
        });
        ordenar(lista);
        ChatStore.ultimoInboxMs = Math.round(performance.now() - t0);
        return lista;
    }

    /* ---------------- CONVERSA (páginas) ---------------- */
    function filtrarVisiveis(lista) {
        return (lista || []).filter(function (m) {
            if (Array.isArray(m.apagada_para) && m.apagada_para.indexOf(uid) >= 0) return false;
            if ((m.moderacao || '') === 'removida' && !m.deleted_at) return false;
            if ((m.status || '') === 'agendada' && m.de_auth_id !== uid) return false;
            return true;
        });
    }
    /** 40 mais recentes (antesId = null) ou as 40 anteriores a antesId. Retorna ASC + temMais. */
    async function pagina(peer, antesId) {
        var lim = PAGINA;
        if (v44 === true && !forcarLegado) {
            var r = await sb().rpc('chat_dm_pagina', { p_outro: peer, p_antes_id: antesId || null, p_limit: lim });
            if (!r.error) {
                var d = r.data || [];
                return { msgs: filtrarVisiveis(d).reverse(), temMais: d.length >= lim };
            }
            if (!ehFuncaoAusente(r.error)) throw r.error;
            marcarV44(false);
        }
        var q = sb().from('chat_mensagens').select(cols())
            .or('and(de_auth_id.eq.' + uid + ',para_auth_id.eq.' + peer + '),and(de_auth_id.eq.' + peer + ',para_auth_id.eq.' + uid + ')')
            .order('id', { ascending: false }).limit(lim);
        if (antesId) q = q.lt('id', antesId);
        var r2 = await q;
        if (r2.error) throw r2.error;
        var d2 = r2.data || [];
        return { msgs: filtrarVisiveis(d2).reverse(), temMais: d2.length >= lim };
    }

    /** Estado de leitura do OUTRO sobre as minhas mensagens (ticks). */
    async function leituraDoOutro(peer) {
        try {
            var r = await sb().from('chat_leituras').select(v44 ? 'ultima_lida_id,ultima_entregue_id' : 'ultima_lida_id')
                .eq('auth_id', peer).eq('com_auth_id', uid).maybeSingle();
            if (r.error || !r.data) return { lida: 0, entregue: 0 };
            return { lida: Number(r.data.ultima_lida_id || 0), entregue: Number(r.data.ultima_entregue_id || r.data.ultima_lida_id || 0) };
        } catch (e) { return { lida: 0, entregue: 0 }; }
    }

    /** Marca lido SÓ PARA FRENTE e só se mudou (sem regravar a cada poll). */
    var lidoEnviado = {};
    async function marcarLido(peer, ateId) {
        if (!peer || !ateId) return;
        ateId = Number(ateId);
        var mudouLocal = salvarLeituraLocal(peer, ateId);
        if (mudouLocal && window.MineraNotif && MineraNotif.agendarPoll) MineraNotif.agendarPoll(50);
        if (Number(lidoEnviado[peer] || 0) >= ateId) return;
        lidoEnviado[peer] = ateId;
        try {
            if (v44 === true) {
                var r = await sb().rpc('chat_marcar_lido', { p_outro: peer, p_ate_id: ateId });
                if (!r.error) return;
                if (!ehFuncaoAusente(r.error)) { lidoEnviado[peer] = 0; return; }
            }
            await sb().from('chat_leituras').upsert([{ auth_id: uid, com_auth_id: peer, ultima_lida_id: ateId, lido_em: new Date().toISOString() }], { onConflict: 'auth_id,com_auth_id' });
        } catch (e) { lidoEnviado[peer] = 0; }
    }

    /* ---------------- ENVIO + FILA OFFLINE ---------------- */
    function kOutbox() { return 'minera_chat_outbox_' + uid; }
    function outboxLer() { return uid ? (lerJSON(kOutbox(), []) || []) : []; }
    function outboxGravar(l) { if (uid) gravarJSON(kOutbox(), l || []); }
    function outboxPor(cid) { return outboxLer().filter(function (x) { return x.client_id === cid; })[0] || null; }
    function outboxPut(item) {
        var l = outboxLer().filter(function (x) { return x.client_id !== item.client_id; });
        var o = {};
        for (var k in item) if (k.charAt(0) !== '_') o[k] = item[k];
        l.push(o);
        outboxGravar(l);
    }
    function outboxDel(cid) { outboxGravar(outboxLer().filter(function (x) { return x.client_id !== cid; })); }

    function uuid() {
        try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* ignore */ }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    /**
     * Insere a mensagem. Retorna { ok:true, row } | { ok:false, rede:true } | { ok:false, erro }.
     * 23505 (client_id repetido) = já estava no servidor → busca a linha e trata como sucesso.
     */
    async function inserir(item) {
        var row = {
            de_auth_id: uid,
            de_nome: item.de_nome || null, // o SQL 44 sobrescreve no servidor
            texto: item.texto || '',
            tipo: item.tipo || 'text',
            midia_url: item.midia_url || null,
            para_auth_id: item.para,
            status: item.status || 'enviada',
            agendado_para: item.agendado_para || null
        };
        if (item.resposta_a_id) row.resposta_a_id = Number(item.resposta_a_id);
        if (v44 === true) row.client_id = item.client_id;
        try {
            var r = await sb().from('chat_mensagens').insert([row]).select(cols()).single();
            if (!r.error && r.data) return { ok: true, row: r.data };
            var e = r.error;
            if (e && String(e.code) === '23505' && v44 === true) {
                var r2 = await sb().from('chat_mensagens').select(cols()).eq('de_auth_id', uid).eq('client_id', item.client_id).maybeSingle();
                if (r2.data) return { ok: true, row: r2.data };
                return { ok: false, rede: true };
            }
            if (e && /client_id/i.test(e.message || '') && v44 !== false) { marcarV44(false); return inserir(item); }
            if (ehErroRede(e) || (e && (e.status === 0 || e.code === '' || e.code == null) && /fetch/i.test(e.message || ''))) return { ok: false, rede: true };
            return { ok: false, erro: e };
        } catch (ex) {
            if (ehErroRede(ex) || ex instanceof TypeError) return { ok: false, rede: true };
            return { ok: false, erro: ex };
        }
    }

    /** Agendadas vencidas enviadas por mim → promove (comportamento existente: quem enviou promove). */
    async function promoverAgendadasVencidas() {
        try {
            var r = await sb().from('chat_mensagens').select('id')
                .eq('de_auth_id', uid).eq('status', 'agendada').is('deleted_at', null)
                .lte('agendado_para', new Date().toISOString()).limit(50);
            var ids = (r.data || []).map(function (x) { return x.id; });
            if (ids.length) await sb().from('chat_mensagens').update({ status: 'enviada' }).in('id', ids);
            return ids;
        } catch (e) { return []; }
    }

    window.ChatStore = {
        setUid: setUid, temV44: temV44, uuid: uuid, ehErroRede: ehErroRede,
        inbox: inbox, pagina: pagina, perfis: perfis, leituraDoOutro: leituraDoOutro,
        marcarLido: marcarLido, leituraLocal: leituraLocal, salvarLeituraLocal: salvarLeituraLocal,
        inserir: inserir, promoverAgendadasVencidas: promoverAgendadasVencidas,
        outboxLer: outboxLer, outboxPut: outboxPut, outboxDel: outboxDel, outboxPor: outboxPor,
        cacheInboxLer: cacheInboxLer, cacheInboxGravar: cacheInboxGravar,
        cacheThreadLer: cacheThreadLer, cacheThreadGravar: cacheThreadGravar,
        filtrarVisiveis: filtrarVisiveis, cols: cols, PAGINA: PAGINA,
        ultimoInboxMs: 0
    };
})();
