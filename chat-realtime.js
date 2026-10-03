/* Minera Pará — tempo real do chat (Supabase Realtime, supabase-js v2 fixado).
 * Carregado em todas as páginas (antes do nav.js).
 *
 * window.MineraRT
 *   .start(uid)            → abre 1 canal do usuário (postgres_changes; o RLS filtra)
 *   .on('msg'|'leitura'|'status'|'resync', fn) → devolve função p/ cancelar
 *   .isLive()              → true quando o canal está SUBSCRIBED
 *   .joinDm(peer, onEstado) / .leaveDm() / .sendEstado({ estado })  → canal PRIVADO dm:<menor>:<maior>
 *
 * Eventos:
 *   msg      { type: 'INSERT'|'UPDATE', row }   (mensagens de/para mim)
 *   leitura  row de chat_leituras onde com_auth_id = eu (o outro leu/recebeu → ticks)
 *   status   'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'
 *   resync   (re)conectou → quem usa deve buscar o que perdeu
 * Sem SQL 44 (tabelas fora da publicação) o canal assina mas nada chega; o app
 * continua funcionando pelo polling de fallback.
 */
(function () {
    'use strict';
    if (window.MineraRT) return;

    var uid = null;
    var chan = null;
    var status = 'CLOSED';
    var ouvintes = {};
    var retryT = null;
    var retryN = 0;
    var conectando = false;
    var dm = null; // { peer, topic, ch, st, onEstado }
    // Grupos (SQL 55): 2º canal com grupo_id=in.(meus grupos); o RLS filtra (só membro recebe)
    var chanG = null, gStatus = 'CLOSED', gruposKey = null, gRetryT = null;

    function sb() { return (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.channel) ? supabaseClient : null; }

    function on(ev, fn) {
        (ouvintes[ev] = ouvintes[ev] || []).push(fn);
        return function () { ouvintes[ev] = (ouvintes[ev] || []).filter(function (f) { return f !== fn; }); };
    }
    function emit(ev, p) {
        (ouvintes[ev] || []).slice().forEach(function (fn) { try { fn(p); } catch (e) { console.warn('MineraRT', ev, e); } });
    }

    /** Token da sessão no socket (necessário p/ RLS e canais privados). */
    async function garantirAuth() {
        var c = sb(); if (!c) return null;
        try {
            var r = await c.auth.getSession();
            var s = r && r.data && r.data.session;
            if (s && s.access_token && c.realtime && c.realtime.setAuth) await c.realtime.setAuth(s.access_token);
            return s || null;
        } catch (e) { return null; }
    }

    function agendarRetry() {
        if (retryT || !uid) return;
        var ms = Math.min(30000, 1000 * Math.pow(2, Math.min(retryN, 5)));
        retryN++;
        retryT = setTimeout(function () { retryT = null; conectar(); }, ms);
    }

    async function conectar() {
        var c = sb();
        if (!c || !uid || conectando) return;
        if (document.visibilityState === 'hidden') return; // reconecta ao voltar
        conectando = true;
        try {
            await garantirAuth();
            if (chan) { try { await c.removeChannel(chan); } catch (e) { /* ignore */ } chan = null; }
            var f = function (col) { return col + '=eq.' + uid; };
            var h = function (tipo) { return function (p) { if (p && p.new) emit('msg', { type: tipo, row: p.new }); }; };
            var ch = c.channel('minera-u-' + uid)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: f('para_auth_id') }, h('INSERT'))
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_mensagens', filter: f('para_auth_id') }, h('UPDATE'))
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: f('de_auth_id') }, h('INSERT'))
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_mensagens', filter: f('de_auth_id') }, h('UPDATE'))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_leituras', filter: f('com_auth_id') }, function (p) {
                    if (p && p.new && p.new.auth_id) emit('leitura', p.new);
                });
            chan = ch;
            ch.subscribe(function (st) {
                if (chan !== ch) return;
                var antes = status;
                status = st;
                emit('status', st);
                if (st === 'SUBSCRIBED') {
                    retryN = 0;
                    if (antes !== 'SUBSCRIBED') emit('resync');
                    conectarGrupos(false);
                } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
                    agendarRetry();
                }
            });
        } catch (e) {
            console.warn('MineraRT conectar', e);
            agendarRetry();
        } finally {
            conectando = false;
        }
    }

    async function meusGrupos() {
        var c = sb(); if (!c || !uid) return null;
        try {
            var r = await c.from('chat_grupo_membros').select('grupo_id').eq('auth_id', uid).is('saiu_em', null).limit(100);
            if (r.error) return null; // SQL 55 ainda não aplicado
            return (r.data || []).map(function (x) { return String(x.grupo_id); }).sort();
        } catch (e) { return null; }
    }
    /** (Re)assina as mensagens dos meus grupos. force = a lista de grupos mudou (criou/entrou/saiu). */
    async function conectarGrupos(force) {
        var c = sb(); if (!c || !uid || document.visibilityState === 'hidden') return;
        var ids = await meusGrupos();
        if (ids === null) return;
        var key = ids.join(',');
        if (!force && key === gruposKey && chanG && gStatus === 'SUBSCRIBED') return;
        if (chanG) { try { await c.removeChannel(chanG); } catch (e) { /* ignore */ } chanG = null; gStatus = 'CLOSED'; }
        gruposKey = key;
        if (!ids.length) return;
        var filtro = 'grupo_id=in.(' + ids.join(',') + ')';
        var h = function (tipo) { return function (p) { if (p && p.new) emit('msg', { type: tipo, row: p.new }); }; };
        var ch = c.channel('minera-g-' + uid + '-' + Date.now())
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: filtro }, h('INSERT'))
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_mensagens', filter: filtro }, h('UPDATE'));
        chanG = ch;
        ch.subscribe(function (st) {
            if (chanG !== ch) return;
            var antes = gStatus;
            gStatus = st;
            if (st === 'SUBSCRIBED' && antes !== 'SUBSCRIBED' && force) emit('resync');
            if ((st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') && !gRetryT) {
                gRetryT = setTimeout(function () { gRetryT = null; conectarGrupos(true); }, 5000);
            }
        });
    }

    // Fui adicionado/removido de um grupo (por outra pessoa ou outro aparelho)? O canal de grupos só escuta os grupos
    // que já conheço, então confere a lista a cada 15 s (consulta mínima, só com a tela visível) e reassina + ressincroniza.
    setInterval(async function () {
        if (!uid || gruposKey === null || document.visibilityState === 'hidden' || !sb()) return;
        var ids = await meusGrupos();
        if (ids === null || ids.join(',') === gruposKey) return;
        await conectarGrupos(true);
        emit('resync');
    }, 15000);

    function reconectarSePreciso() {
        if (!uid) return;
        if (gruposKey && gStatus !== 'SUBSCRIBED') conectarGrupos(true);
        if (status !== 'SUBSCRIBED') { if (retryT) { clearTimeout(retryT); retryT = null; } conectar(); }
        if (dm && dm.st !== 'SUBSCRIBED') abrirDm();
    }

    function start(u) {
        if (!u) return;
        if (uid === u && chan) return;
        uid = u;
        conectar();
    }

    /* ---------- Canal privado do par (digitando / gravando) ---------- */
    function dmTopic(a, b) {
        var x = String(a).toLowerCase(), y = String(b).toLowerCase();
        return 'dm:' + (x < y ? x + ':' + y : y + ':' + x);
    }
    async function abrirDm() {
        var c = sb(); if (!c || !dm || !uid) return;
        var alvo = dm;
        await garantirAuth();
        if (dm !== alvo) return;
        if (alvo.ch) { try { await c.removeChannel(alvo.ch); } catch (e) { /* ignore */ } }
        var ch = c.channel(alvo.topic, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: uid } } })
            .on('broadcast', { event: 'estado' }, function (m) {
                var p = m && m.payload;
                if (!p || p.de === uid || dm !== alvo) return;
                try { alvo.onEstado(p); } catch (e) { /* ignore */ }
            })
            .on('presence', { event: 'sync' }, function () {
                if (dm !== alvo) return;
                var on = false;
                try { var stt = ch.presenceState() || {}; on = Object.prototype.hasOwnProperty.call(stt, String(alvo.peer)); } catch (e) { /* ignore */ }
                alvo.online = on;
                try { alvo.onPresenca(on); } catch (e) { /* ignore */ }
            });
        alvo.ch = ch;
        alvo.st = 'JOINING';
        ch.subscribe(function (st) {
            if (alvo.ch !== ch) return;
            alvo.st = st;
            if (st === 'SUBSCRIBED' && document.visibilityState !== 'hidden') { try { ch.track({ t: Date.now() }); } catch (e) { /* ignore */ } }
        });
    }
    function joinDm(peer, onEstado, onPresenca) {
        if (!peer || !uid) return;
        var topic = dmTopic(uid, peer);
        if (dm && dm.topic === topic) { dm.onEstado = onEstado || dm.onEstado; dm.onPresenca = onPresenca || dm.onPresenca; return; }
        leaveDm();
        dm = { peer: peer, topic: topic, ch: null, st: 'CLOSED', onEstado: onEstado || function () {}, onPresenca: onPresenca || function () {} };
        abrirDm();
    }
    function leaveDm() {
        var c = sb();
        if (dm && dm.ch && c) { try { c.removeChannel(dm.ch); } catch (e) { /* ignore */ } }
        dm = null;
    }
    /** estado: 'digitando' | 'gravando' | 'parou' */
    function sendEstado(estado) {
        if (!dm || !dm.ch || dm.st !== 'SUBSCRIBED') return false;
        try {
            dm.ch.send({ type: 'broadcast', event: 'estado', payload: { de: uid, estado: estado, t: Date.now() } });
            return true;
        } catch (e) { return false; }
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            reconectarSePreciso(); emit('visivel');
            if (dm && dm.ch && dm.st === 'SUBSCRIBED') { try { dm.ch.track({ t: Date.now() }); } catch (e) { /* ignore */ } }
        } else if (dm && dm.ch && dm.st === 'SUBSCRIBED') { try { dm.ch.untrack(); } catch (e) { /* ignore */ } }
    });
    window.addEventListener('online', function () { reconectarSePreciso(); emit('online'); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) reconectarSePreciso(); });

    window.MineraRT = {
        start: start,
        on: on,
        isLive: function () { return status === 'SUBSCRIBED'; },
        status: function () { return status; },
        joinDm: joinDm,
        leaveDm: leaveDm,
        sendEstado: sendEstado,
        dmLive: function () { return !!(dm && dm.st === 'SUBSCRIBED'); },
        dmTopic: dmTopic,
        atualizarGrupos: function () { return conectarGrupos(true); },
        gruposLive: function () { return gStatus === 'SUBSCRIBED'; },
        reconectar: reconectarSePreciso
    };
})();
