/* Minera Pará — LIGAÇÃO DE VOZ 1:1 (WebRTC) no chat. Requer o SQL 63.
 *
 * window.MineraChamada
 *   .ligar({ auth_id, nome })   → liga (precisa ser chamado DENTRO do toque: pede o microfone)
 *   .ativa()                    → true durante uma ligação
 *   .iniciar()                  → começa a escutar ligações (feito sozinho quando há sessão)
 *
 * Como funciona (estabilidade primeiro):
 *  - Estado oficial no banco (tabela chamadas, RLS: só os 2 participantes). Mudanças chegam por
 *    Realtime (postgres_changes) E por consulta a cada 2 s enquanto conecta (se o Realtime cair, a
 *    ligação continua). Toque de 45 s; o servidor também fecha ligação esquecida.
 *  - Oferta/resposta (SDP) só DEPOIS de atender, gravadas na linha da ligação (durável) e apagadas no fim.
 *    Candidatos ICE: canal Realtime PRIVADO chamada:<id> (mais rápido) + a descrição completa regravada
 *    no banco quando a coleta termina (funciona mesmo sem o canal).
 *  - Queda de rede: ICE restart automático (quem ligou renegocia; quem recebeu pede), até 25 s; depois encerra.
 *  - TURN: credencial curta da Edge Function turn-credenciais (se existir); senão só STUN público.
 *  - Fim da ligação (qualquer caminho): para TODAS as trilhas do microfone (indicador laranja do iPhone some),
 *    fecha o RTCPeerConnection, o canal e o áudio.
 */
(function () {
    'use strict';
    if (window.MineraChamada) return;
    // TRAVA PELO BACKEND (teste e produção): o botão nasce escondido (style="display:none" no HTML)
    // e só aparece se o banco tiver o SQL 63 E responder chamada_config() → { ativo: true }.
    // Sem o SQL (ou app_flags 'chamadas_ativas' = false) nada aparece e nada escuta.
    // window.MINERA_CHAMADA_ATIVA = false desliga localmente (emergência no próprio site).
    if (window.MINERA_CHAMADA_ATIVA === false) return;
    var ATIVO = false, cfgT = 0;
    function botaoLigar(mostrar) {
        var b = document.getElementById('btn-chat-ligar'); if (!b) return;
        b.style.display = mostrar ? '' : 'none';
        document.documentElement.classList.toggle('chamada-ok', !!mostrar);
    }

    var CFG = Object.assign({
        toqueMs: 45000,
        stun: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
        soRelay: false,            // true = só TURN (esconde o IP do outro lado; precisa de TURN configurado)
        fnTurn: 'turn-credenciais',
        semConexaoMs: 25000
    }, window.MINERA_CHAMADA_CFG || {});

    var eu = null, chanRows = null, chanSt = 'CLOSED', chanRetryT = null, iniciado = false;
    var C = null;                 // ligação atual
    var todosStreams = [];        // p/ teste: todo microfone aberto por aqui

    function sb() { return (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : null; }
    function $(id) { return document.getElementById(id); }
    function log() { try { if (window.MINERA_CHAMADA_LOG) console.log.apply(console, ['[chamada]'].concat([].slice.call(arguments))); } catch (e) { /* ignore */ } }
    function toastC(t) { try { if (typeof toastMsg === 'function') toastMsg(t); } catch (e) { /* ignore */ } }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function iniciais(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
    function suportado() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
    // id desta ABA (aparelho + aba): 2 abas/janelas do mesmo aparelho tocando → só a que atendeu fica com a ligação
    var ABA = Math.random().toString(36).slice(2, 8);
    function aparelho() {
        var v = 'ap';
        try {
            var k = 'minera_chamada_aparelho'; v = localStorage.getItem(k);
            if (!v || !/^[A-Za-z0-9-]{8,40}$/.test(v)) { v = 'ap-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem(k, v); }
        } catch (e) { v = 'ap-sem-armazenamento'; }
        return v + '-' + ABA;
    }
    function fmt(seg) { seg = Math.max(0, Math.floor(seg)); return Math.floor(seg / 60) + ':' + String(seg % 60).padStart(2, '0'); }
    function nomeSeguro(n) { n = String(n || '').trim(); return n && n.indexOf('@') < 0 ? n : 'Contato'; }

    /* ---------------- áudio do aparelho (iPhone: eco / alto-falante) ----------------
     * No iPhone o cancelamento de eco só funciona bem se o ÚNICO som tocando for o da ligação
     * (<audio> com srcObject = trilha WebRTC). AudioContext ligado (som de mensagem do nav.js,
     * decodificador de áudio, onda do gravador, toque antigo daqui) atrapalha o eco e força o
     * alto-falante. Por isso: toques em <audio> com WAV gerado aqui (sem AudioContext) e,
     * durante a ligação, TODO AudioContext da página fica suspenso (volta ao fim). */
    var IOS = /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var ctxTodos = [], ctxPausados = [], emChamadaAudio = false;
    (function rastrearAudioContext() {
        try {
            var Orig = window.AudioContext || window.webkitAudioContext;
            if (!Orig || Orig.__mineraRastreado) return;
            var R = function (op) {
                var c = op === undefined ? new Orig() : new Orig(op);
                ctxTodos.push(c);
                if (emChamadaAudio) { try { c.suspend(); ctxPausados.push(c); } catch (e) { /* ignore */ } }
                return c;
            };
            R.prototype = Orig.prototype; R.__mineraRastreado = true;
            try { Object.setPrototypeOf(R, Orig); } catch (e) { /* ignore */ }
            if (window.AudioContext) window.AudioContext = R;
            if (window.webkitAudioContext) window.webkitAudioContext = R;
        } catch (e) { /* ignore */ }
    })();
    function audioDaChamada(ligado) {
        if (ligado === emChamadaAudio) return;
        emChamadaAudio = ligado;
        if (ligado) {
            ctxPausados = [];
            ctxTodos.forEach(function (c) { try { if (c.state === 'running') { c.suspend(); ctxPausados.push(c); } } catch (e) { /* ignore */ } });
            try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) { /* ignore */ }
        } else {
            // só 'auto' ('playback' registraria a página como player na tela bloqueada)
            try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch (e) { /* ignore */ }
            limparMediaSession();
            try { if (audioPre && (!C || C.audio !== audioPre)) { audioPre.remove(); } } catch (e) { /* ignore */ }
            audioPre = null;
            var vol = ctxPausados; ctxPausados = [];
            setTimeout(function () { vol.forEach(function (c) { try { if (c.state === 'suspended') c.resume().catch(function () {}); } catch (e) { /* ignore */ } }); }, 1500);
        }
    }

    /* ---------------- toques: WAV gerado (8 kHz mono) tocado num <audio> ---------------- */
    var wavCache = {};
    function wav(partes, vol) {   // partes: [[freqs[], segundos], ...]  (freqs vazio = silêncio)
        var taxa = 8000, n = 0; partes.forEach(function (p) { n += Math.round(p[1] * taxa); });
        var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), o = 0;
        function str(t) { for (var i = 0; i < t.length; i++) v.setUint8(o++, t.charCodeAt(i)); }
        str('RIFF'); v.setUint32(o, 36 + n * 2, true); o += 4; str('WAVEfmt '); v.setUint32(o, 16, true); o += 4;
        v.setUint16(o, 1, true); o += 2; v.setUint16(o, 1, true); o += 2; v.setUint32(o, taxa, true); o += 4;
        v.setUint32(o, taxa * 2, true); o += 4; v.setUint16(o, 2, true); o += 2; v.setUint16(o, 16, true); o += 2;
        str('data'); v.setUint32(o, n * 2, true); o += 4;
        partes.forEach(function (p) {
            var m = Math.round(p[1] * taxa), f = p[0], rampa = Math.min(160, m / 4);
            for (var i = 0; i < m; i++) {
                var x = 0;
                for (var k = 0; k < f.length; k++) x += Math.sin(2 * Math.PI * f[k] * i / taxa) / f.length;
                var env = Math.min(1, i / rampa, (m - i) / rampa);
                v.setInt16(o, Math.max(-1, Math.min(1, x * vol * env)) * 32767, true); o += 2;
            }
        });
        return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }
    function wavDe(tipo) {
        if (wavCache[tipo]) return wavCache[tipo];
        var T = {
            // TODOS com no máximo 0,9 s: o WebKit só mostra o player "Tocando agora" (tela bloqueada /
            // Central de Controle) para áudio com MAIS de 0,95 s ("You've got mail", MediaElementSession).
            // A repetição (toque a cada 3 s, chamando a cada 5 s) é feita por timer, sem loop.
            toque: [[[440, 480], 0.4], [[], 0.1], [[440, 480], 0.38]],
            chamando: [[[425], 0.9]],
            ocupado: [[[425], 0.25], [[], 0.25]],
            fim: [[[480], 0.18], [[], 0.04], [[380], 0.25]],
            silencio: [[[], 0.05]]
        };
        var vol = { toque: 0.5, chamando: 0.3, ocupado: 0.32, fim: 0.3, silencio: 0 }[tipo];
        return (wavCache[tipo] = wav(T[tipo], vol));
    }
    var somEl = null, somTipo = '';
    function elSom() {
        if (!somEl) { somEl = document.createElement('audio'); somEl.setAttribute('playsinline', ''); somEl.preload = 'auto'; somEl.id = 'chamada-som'; semPlayer(somEl); }
        return somEl;
    }
    // iPhone: destrava o <audio> do toque no 1º toque na tela (sem AudioContext)
    function destravar() { try { var a = elSom(); a.src = wavDe('silencio'); a.loop = false; var p = a.play(); if (p && p.then) p.then(function () { if (!somTipo) a.pause(); }).catch(function () {}); } catch (e) { /* ignore */ } }
    document.addEventListener('pointerdown', function d1() { destravar(); document.removeEventListener('pointerdown', d1, true); }, true);

    /** Nada de player na tela bloqueada: sem AirPlay/transmissão, sem controles, Media Session vazia. */
    function semPlayer(el) {
        try { el.disableRemotePlayback = true; el.setAttribute('disableremoteplayback', ''); el.setAttribute('x-webkit-airplay', 'deny'); el.controls = false; el.removeAttribute('controls'); } catch (e) { /* ignore */ }
    }
    function limparMediaSession() {
        try {
            var ms = navigator.mediaSession; if (!ms) return;
            ms.metadata = null;
            ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto', 'skipad'].forEach(function (a) { try { ms.setActionHandler(a, null); } catch (e) { /* ação não suportada */ } });
            try { ms.playbackState = 'none'; } catch (e) { /* ignore */ }
            try { if (ms.setPositionState) ms.setPositionState(); } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }
    var vibT = null, repT = null;
    function pararSom() {
        somTipo = ''; clearInterval(vibT); vibT = null; clearInterval(repT); repT = null;
        try { if (somEl) { somEl.onended = null; somEl.pause(); somEl.loop = false; somEl.removeAttribute('src'); somEl.load(); } } catch (e) { /* ignore */ }
        try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* ignore */ }
    }
    /** Fim da ligação: joga fora o elemento do toque (some do "Tocando agora"). */
    function descartarSom() {
        pararSom();
        try { if (somEl) { somEl.remove(); } } catch (e) { /* ignore */ }
        somEl = null;
        limparMediaSession();
    }
    /** 'toque' (recebendo), 'chamando' (425 Hz 1 s / 4 s, padrão BR), 'ocupado', 'fim' */
    function tocar(tipo) {
        pararSom();
        try {
            var a = elSom(); somTipo = tipo;
            a.loop = false;
            a.src = wavDe(tipo); a.currentTime = 0;
            var toca = function () { if (somTipo !== tipo) return; try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () { /* sem toque na tela ainda: só vibra */ }); } catch (e) { /* ignore */ } };
            toca();
            var cada = { toque: 3000, chamando: 5000, ocupado: 500 }[tipo];
            if (cada) {
                var vezes = 0;
                repT = setInterval(function () { if (tipo === 'ocupado' && ++vezes >= 6) { pararSom(); return; } toca(); }, cada);
            }
            if (tipo === 'fim') a.onended = function () { if (somTipo === tipo) pararSom(); };
        } catch (e) { /* ignore */ }
        if (tipo === 'toque') {
            var vib = function () { try { if (navigator.vibrate) navigator.vibrate([400, 200, 400]); } catch (e) { /* ignore */ } };
            vib(); vibT = setInterval(vib, 3000);
        }
    }

    /* ---------------- tela ---------------- */
    var CSS = '' +
        '.ch-tela,.ch-trava{--ch-amarelo:#F5A623;--ch-escuro:#1a1205}' +
        '.ch-tela{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:space-between;' +
        'padding:calc(28px + env(safe-area-inset-top)) 20px calc(34px + env(safe-area-inset-bottom));background:linear-gradient(180deg,#2b1f08 0%,#0f0c06 72%);color:#fbf6ec;font-family:inherit;text-align:center}' +
        '.ch-tela.oculto{display:none}' +
        '.ch-topo{font-size:13px;opacity:.75;letter-spacing:.2px}' +
        '.ch-meio{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:4vh}' +
        '.ch-av{width:112px;height:112px;border-radius:50%;background:var(--ch-amarelo);color:var(--ch-escuro);display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;box-shadow:0 0 0 0 rgba(245,166,35,.5)}' +
        '.ch-tela[data-fase=tocando] .ch-av,.ch-tela[data-fase=chamando] .ch-av{animation:chPulso 1.6s infinite}' +
        '@keyframes chPulso{0%{box-shadow:0 0 0 0 rgba(245,166,35,.55)}70%{box-shadow:0 0 0 26px rgba(245,166,35,0)}100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}}' +
        '.ch-nome{font-size:26px;font-weight:700;max-width:90vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.ch-status{font-size:16px;opacity:.85;min-height:22px;font-variant-numeric:tabular-nums}' +
        '.ch-acoes,.ch-entrada{display:flex;gap:26px;align-items:flex-start;justify-content:center;width:100%}' +
        '.ch-b{display:flex;flex-direction:column;align-items:center;gap:8px;background:none;border:0;color:inherit;font:inherit;font-size:13px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
        '.ch-b .ch-c{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.14);transition:transform .1s}' +
        '.ch-b:active .ch-c{transform:scale(.94)}' +
        '.ch-b[aria-pressed=true] .ch-c{background:var(--ch-amarelo);color:var(--ch-escuro)}' +
        '.ch-b.ch-verm .ch-c{background:#e5484d;color:#fff}.ch-b.ch-amarelo .ch-c{background:var(--ch-amarelo);color:var(--ch-escuro)}' +
        '.ch-b svg{width:30px;height:30px}' +
        '.ch-b .ch-l{max-width:98px;line-height:1.2}' +
        '.ch-tela .ch-b,.ch-tela .ch-b:hover,.ch-tela .ch-b:active{background:none;box-shadow:none;padding:0;border-radius:0}.ch-tela .ch-travar:hover{background:rgba(255,255,255,.1)}' +
        '.ch-tela[data-papel=entrada][data-fase=tocando] .ch-acoes{display:none}' +
        '.ch-tela:not([data-fase=tocando]) .ch-entrada,.ch-tela[data-papel=saida] .ch-entrada{display:none}' +
        '.ch-tela[data-fase=fim] .ch-acoes{opacity:.35;pointer-events:none}' +
        '.ch-travar{margin-top:14px;background:rgba(255,255,255,.1);color:inherit;border:0;border-radius:18px;padding:8px 16px;font:inherit;font-size:14px;display:none}' +
        '.ch-tela[data-fase=conectada] .ch-travar{display:inline-block}' +
        '.ch-trava{position:fixed;inset:0;z-index:2147483600;background:#000;color:#b5a88f;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;' +
        'padding:0 22px calc(48px + env(safe-area-inset-bottom));touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;overscroll-behavior:contain}' +
        '.ch-trava.oculto{display:none}.ch-trava-meio{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;margin-top:32vh}' +
        '.ch-trava-t{font-size:15px;opacity:.7}.ch-trava-cron{font-size:34px;color:#f1d9a6;font-variant-numeric:tabular-nums}.ch-trava-nome{font-size:14px;opacity:.55}' +
        '.ch-trava-trilho{position:relative;width:min(88vw,340px);height:62px;border-radius:31px;background:rgba(255,255,255,.08);display:flex;align-items:center}' +
        '.ch-trava-dica{position:absolute;left:0;right:0;text-align:center;font-size:14px;opacity:.6;pointer-events:none}' +
        '.ch-trava-trilho.segurando{background:rgba(245,166,35,.22);transition:background 1.5s}' +
        '.ch-trava-alca{position:relative;z-index:1;margin-left:4px;width:54px;height:54px;border-radius:50%;background:var(--ch-amarelo);color:var(--ch-escuro);display:flex;align-items:center;justify-content:center;font-size:24px;touch-action:none;cursor:grab}' +
        '.ch-saida{margin-top:10px;font-size:13px;opacity:.75;max-width:86vw;min-height:1em}.ch-tela[data-fase=tocando] .ch-saida{display:none}' +
        '.bubble.bubble-chamada{align-self:center;max-width:86%;margin:6px auto;padding:7px 14px;border-radius:16px;background:rgba(127,127,127,.14);color:inherit;font-size:13.5px;display:flex;gap:8px;align-items:center;cursor:pointer;box-shadow:none}' +
        '.bubble.bubble-chamada::before,.bubble.bubble-chamada::after{display:none!important}' +
        '.bubble.bubble-chamada.perdida .bc-ic{color:#e5484d}.bubble.bubble-chamada .bc-h{opacity:.6;font-size:12px}' +
        '.gk-circ.gk-ligar svg{width:21px;height:21px}body.chat-grupo-aberto #btn-chat-ligar,body.chat-bloqueado #btn-chat-ligar{display:none}';
    var IC = {
        mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
        micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/></svg>',
        falante: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
        falanteOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
        fone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>',
        desligar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1a1 1 0 0 1-.56.9c-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9z"/></svg>'
    };
    function montarTela() {
        if ($('chamada-tela')) return $('chamada-tela');
        if (!$('chamada-css')) { var st = document.createElement('style'); st.id = 'chamada-css'; st.textContent = CSS; document.head.appendChild(st); }
        var d = document.createElement('div');
        d.id = 'chamada-tela'; d.className = 'ch-tela oculto'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Ligação de voz');
        d.innerHTML =
            '<div class="ch-topo">🔒 Ligação de voz · criptografada</div>' +
            '<div class="ch-meio"><div class="ch-av" id="ch-av">?</div><div class="ch-nome" id="ch-nome">—</div><div class="ch-status" id="ch-status" aria-live="polite"></div><div class="ch-saida" id="ch-saida">🔊 Ligação em viva-voz</div><button type="button" class="ch-travar" id="ch-btn-travar">🔒 Travar tela</button></div>' +
            '<div style="width:100%">' +
            '<div class="ch-acoes">' +
            '<button type="button" class="ch-b" id="ch-btn-mudo" aria-pressed="false" aria-label="Silenciar microfone"><span class="ch-c">' + IC.mic + '</span><span class="ch-l">Silenciar microfone</span></button>' +
            '<button type="button" class="ch-b ch-verm" id="ch-btn-desligar"><span class="ch-c">' + IC.desligar + '</span><span>Desligar</span></button>' +
            '<button type="button" class="ch-b" id="ch-btn-som" aria-pressed="false" aria-label="Silenciar alto-falante"><span class="ch-c">' + IC.falante + '</span><span class="ch-l">Silenciar som</span></button>' +
            '</div>' +
            '<div class="ch-entrada">' +
            '<button type="button" class="ch-b ch-verm" id="ch-btn-recusar"><span class="ch-c">' + IC.desligar + '</span><span>Recusar</span></button>' +
            '<button type="button" class="ch-b ch-amarelo" id="ch-btn-atender"><span class="ch-c">' + IC.fone + '</span><span>Atender</span></button>' +
            '</div></div>';
        document.body.appendChild(d);
        $('ch-btn-desligar').addEventListener('click', function () { desligar('desligou'); });
        $('ch-btn-recusar').addEventListener('click', function () { desligar('recusou'); });
        $('ch-btn-atender').addEventListener('click', atender);
        $('ch-btn-mudo').addEventListener('click', alternarMudo);
        $('ch-btn-som').addEventListener('click', alternarSom);
        $('ch-btn-travar').addEventListener('click', function () { travar('botão'); });
        return d;
    }
    function tela(fase, status) {
        var d = montarTela();
        if (C) { d.setAttribute('data-papel', C.papel); $('ch-nome').textContent = C.peerNome || 'Contato'; $('ch-av').textContent = iniciais(C.peerNome); }
        if (fase) d.setAttribute('data-fase', fase);
        if (status != null) $('ch-status').textContent = status;
        if (fase === 'chamando' || fase === 'tocando') { mostrarSom(); var bm = $('ch-btn-mudo'); if (bm && !(C && C.mudo)) { bm.setAttribute('aria-pressed', 'false'); bm.querySelector('.ch-c').innerHTML = IC.mic; bm.querySelector('.ch-l').textContent = 'Silenciar microfone'; } }
        d.classList.remove('oculto');
    }
    function esconderTela() { var d = $('chamada-tela'); if (d) d.classList.add('oculto'); }

    /* ---------------- banco ---------------- */
    async function rpc(nome, args) {
        var c = sb(); if (!c) throw new Error('sem cliente');
        var r = await c.rpc(nome, args || {});
        if (r.error) throw r.error;
        return r.data;
    }
    function linha(d) { return Array.isArray(d) ? (d[0] || null) : d; }
    async function lerLinha(id) {
        var c = sb(); if (!c) return null;
        var r = await c.from('chamadas').select('*').eq('id', id).maybeSingle();
        return r && r.data || null;
    }

    async function buscarIce(id) {
        var c = sb(); var pad = { iceServers: CFG.stun, provedor: 'stun', ttl: 0 };
        if (!c || !c.functions) return pad;
        try {
            var r = await Promise.race([
                c.functions.invoke(CFG.fnTurn, { body: { chamada_id: id } }),
                new Promise(function (res) { setTimeout(function () { res({ error: 'tempo' }); }, 3500); })
            ]);
            var d = r && !r.error && r.data;
            if (d && Array.isArray(d.iceServers) && d.iceServers.length) return { iceServers: d.iceServers, provedor: d.provedor || '?', ttl: Number(d.ttl) || 0, em: Date.now() };
        } catch (e) { /* sem TURN: só STUN */ }
        return pad;
    }

    /* ---------------- ciclo da ligação ---------------- */
    function novo(row, papel, peerId, peerNome) {
        C = {
            id: row.id, row: row, papel: papel, peerId: peerId, peerNome: peerNome, fase: papel === 'saida' ? 'chamando' : 'tocando',
            pc: null, stream: null, audio: null, ch: null, chSt: 'CLOSED', locVer: 0, remVer: 0, remSdp: '', candsLocais: [], candsRem: new Set(),
            filaCands: [], fila: Promise.resolve(), timers: {}, ice: null, icePromise: null, mudo: false, somMudo: false,
            conectadaEm: 0, semConexaoDesde: 0, reiniciando: false, atendiAqui: papel === 'saida', fim: false, token: null
        };
        guardarToken();
        return C;
    }
    async function guardarToken() { try { var s = await sb().auth.getSession(); if (C && s && s.data && s.data.session) C.token = s.data.session.access_token; } catch (e) { /* ignore */ } }
    function timer(nome, fn, ms, rep) { if (!C) return; clearTimer(nome); C.timers[nome] = (rep ? setInterval : setTimeout)(fn, ms); }
    function clearTimer(nome) { if (C && C.timers[nome]) { clearTimeout(C.timers[nome]); clearInterval(C.timers[nome]); delete C.timers[nome]; } }

    async function pegarMic() {
        pararSom();
        audioDaChamada(true);    // nenhum AudioContext tocando (eco)
        var s;
        try {
            s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, channelCount: { ideal: 1 } }, video: false });
        } catch (e) {
            if (!C || C.fim || !C.stream) audioDaChamada(false);
            throw e;
        }
        try { var st = s.getAudioTracks()[0].getSettings(); log('mic', JSON.stringify(st)); C && (C.micCfg = st); } catch (e) { /* ignore */ }
        // 'play-and-record' DEPOIS do microfone (Safari re-roteia; antes do getUserMedia às vezes pega o mic errado)
        try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* ignore */ }
        todosStreams.push(s);
        return s;
    }
    function soltarMic(s) { if (!s) return; try { s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ } }

    async function ligar(peer) {
        if (!peer || !peer.auth_id) return;
        if (C) { toastC('Você já está em uma ligação.'); return; }
        if (!ATIVO && !(await conferirBackend(true))) { toastC('Ligação de voz indisponível no momento.'); return; }
        if (!suportado()) { toastC('Este navegador não faz ligação. Atualize o app/navegador.'); return; }
        if (!eu) await iniciar();
        if (!eu) { toastC('Entre na sua conta para ligar.'); return; }
        var stream;
        try { stream = await pegarMic(); }   // dentro do toque (iOS exige)
        catch (e) { toastC('Sem acesso ao microfone. Permita o microfone para ligar.'); return; }
        var temp = { id: null }; C = Object.assign(temp, { fase: 'iniciando', papel: 'saida', peerNome: peer.nome || 'Contato', timers: {}, stream: stream });
        tela('chamando', 'Chamando…');
        var row;
        try { row = linha(await rpc('chamada_iniciar', { p_para: peer.auth_id, p_aparelho: aparelho() })); }
        catch (e) {
            soltarMic(stream); C = null; audioDaChamada(false);
            var msg = String((e && e.message) || '');
            tela('fim', /function|schema|does not exist|404/i.test(msg) ? 'Ligação ainda não disponível' : (msg || 'Não foi possível ligar'));
            setTimeout(function () { if (!C) esconderTela(); }, 2200);
            return;
        }
        if (!row) { soltarMic(stream); C = null; audioDaChamada(false); esconderTela(); return; }
        if (row.para === eu && row.estado === 'tocando') {      // ligação cruzada: a pessoa está me ligando → atende já
            novo(row, 'entrada', row.de, peer.nome || nomeSeguro(row.de_nome)); C.stream = stream;
            await atender(); return;
        }
        novo(row, 'saida', peer.auth_id, peer.nome || 'Contato'); C.stream = stream;
        if (row.estado === 'ocupado') { finalizar('Ocupado', 3000); tocar('ocupado'); return; }
        tela('chamando', 'Chamando…'); tocar('chamando');
        C.icePromise = buscarIce(row.id).then(function (x) { if (C && C.id === row.id) C.ice = x; return x; });
        timer('toque', function () { desligar('timeout'); }, CFG.toqueMs);
        timer('poll', poll, 2000, true);
        timer('ping', ping, 20000, true);
        guardaSaida(true);
    }

    function entrada(row) {
        if (C) { if (C.id !== row.id) rpc('chamada_encerrar', { p_id: row.id, p_motivo: 'ocupado' }).catch(function () {}); return; }
        novo(row, 'entrada', row.de, nomeSeguro(row.de_nome));
        tela('tocando', 'Ligação de voz…'); tocar('toque');
        var restante = CFG.toqueMs + 3000 - Math.max(0, Date.now() - new Date(row.criado_em).getTime());
        timer('toque', function () { poll(); timer('toqueFim', function () { if (C && C.fase === 'tocando') finalizar('Ligação perdida', 1500); }, 4000); }, Math.min(CFG.toqueMs + 3000, Math.max(5000, restante)));
        timer('poll', poll, 2500, true);
        try { if (document.visibilityState === 'hidden' && typeof MineraNotif !== 'undefined' && MineraNotif.showBrowserNotif) { /* o push do servidor já avisa */ } } catch (e) { /* ignore */ }
    }

    async function atender() {
        if (!C || C.papel !== 'entrada' || C.fase !== 'tocando') return;
        pararSom();
        tela('conectando', 'Conectando…');
        try { if (!C.stream) C.stream = await pegarMic(); }    // dentro do toque em "Atender"
        catch (e) { toastC('Sem acesso ao microfone.'); desligar('falhou'); return; }
        var row;
        try { row = linha(await rpc('chamada_atender', { p_id: C.id, p_aparelho: aparelho() })); }
        catch (e) { finalizar('Não foi possível atender', 1800); return; }
        if (!C) return;
        if (!row || row.estado !== 'atendida') { atualizar(row || C.row); if (C && !C.fim) finalizar('Ligação encerrada', 1500); return; }
        C.atendiAqui = true; C.fase = 'conectando';
        C.icePromise = buscarIce(C.id).then(function (x) { if (C) C.ice = x; return x; });
        clearTimer('toque'); clearTimer('toqueFim');
        timer('poll', poll, 2000, true);
        timer('ping', ping, 20000, true);
        timer('semConexao', function () { if (C && !C.conectadaEm) { log('nunca conectou'); desligar('falhou', 'Não foi possível conectar'); } }, 30000);
        guardaSaida(true);
        await criarPC();
        abrirCanal();
        atualizar(row);
    }

    async function criarPC() {
        if (!C || C.pc) return;
        var ice = C.ice || (C.icePromise ? await Promise.race([C.icePromise, new Promise(function (r) { setTimeout(function () { r(null); }, 3000); })]) : null) || { iceServers: CFG.stun, provedor: 'stun' };
        if (!C || C.pc) return;
        C.ice = ice;
        var conf = { iceServers: ice.iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' };
        if (CFG.soRelay && ice.provedor !== 'stun') conf.iceTransportPolicy = 'relay';
        var pc = new RTCPeerConnection(conf);
        C.pc = pc;
        C.stream.getAudioTracks().forEach(function (t) { t.enabled = !C.mudo; pc.addTrack(t, C.stream); });
        pc.onicecandidate = function (e) {
            if (!C || C.pc !== pc) return;
            if (e.candidate) {
                var j = e.candidate.toJSON ? e.candidate.toJSON() : { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex };
                C.candsLocais.push({ v: C.locVer, c: j });
                sinal({ ev: 'ice', v: C.locVer, c: j });
            } else {
                regravarSdp();   // coleta terminou → descrição completa no banco (funciona sem o canal)
            }
        };
        pc.onicegatheringstatechange = function () { if (C && C.pc === pc && pc.iceGatheringState === 'complete') regravarSdp(); };
        pc.ontrack = function (e) {
            if (!C || C.pc !== pc) return;
            var a = C.audio;
            // UM só elemento para o som do outro lado (nunca o nosso microfone); remove sobras de outra ligação
            if (!a) { a = prepararAudio(); C.audio = a; }
            var novoSrc = (e.streams && e.streams[0]) || C.remStream || (C.remStream = new MediaStream());
            if (!e.streams || !e.streams[0]) { try { if (novoSrc.getTracks().indexOf(e.track) < 0) novoSrc.addTrack(e.track); } catch (er) { /* ignore */ } }
            if (a.srcObject !== novoSrc) a.srcObject = novoSrc;
            var p = a.play(); if (p && p.catch) p.catch(function () { /* autoplay: toque na tela libera */ });
            a.muted = !!C.somMudo;
        };
        var onEstado = function () {
            if (!C || C.pc !== pc) return;
            var st = pc.connectionState || pc.iceConnectionState;
            log('estado', st, pc.iceConnectionState);
            if (st === 'connected' || st === 'completed') conectou();
            else if (st === 'disconnected') caiu(false);
            else if (st === 'failed') caiu(true);
        };
        pc.onconnectionstatechange = onEstado;
        pc.oniceconnectionstatechange = function () { if (!pc.connectionState) onEstado(); else if (pc.iceConnectionState === 'failed') caiu(true); };
    }

    function conectou() {
        if (!C) return;
        C.semConexaoDesde = 0; C.reiniciando = false; clearTimer('reconecta'); clearTimer('desiste'); clearTimer('semConexao');
        if (!C.conectadaEm) {
            C.conectadaEm = Date.now(); pararSom();
            timer('cron', function () { if (C && C.fase === 'conectada') $('ch-status').textContent = fmt((Date.now() - C.conectadaEm) / 1000); }, 1000, true);
            timer('poll', poll, 10000, true);
        }
        C.fase = 'conectada';
        tela('conectada', fmt((Date.now() - C.conectadaEm) / 1000));
        limparMediaSession();
        manterTelaAcesa(true);
        travaAgendar();
    }
    function caiu(falhou) {
        if (!C || C.fim || !C.conectadaEm && !falhou) return;
        if (!C.semConexaoDesde) C.semConexaoDesde = Date.now();
        if (C.conectadaEm) { C.fase = 'reconectando'; tela('reconectando', 'Reconectando…'); }
        timer('poll', poll, 2000, true);
        // 'disconnected' costuma voltar sozinho em 1–3 s; 'failed' renegocia já
        timer('reconecta', function () { reiniciarIce(); }, falhou ? 0 : 2500);
        if (!C.timers.desiste) timer('desiste', function () { if (C && C.fase !== 'conectada') desligar('falhou', 'Ligação caiu'); }, CFG.semConexaoMs);
    }
    async function reiniciarIce() {
        if (!C || !C.pc || C.fim) return;
        if (C.papel !== 'saida') { sinal({ ev: 'reiniciar' }); return; }   // quem ligou é sempre quem oferece (sem colisão)
        if (C.reiniciando && C.pc.signalingState !== 'stable') return;
        C.reiniciando = true;
        try {
            if (C.ice && C.ice.ttl && C.ice.em && Date.now() - C.ice.em > (C.ice.ttl - 300) * 1000) {
                var novoIce = await buscarIce(C.id);
                if (C && novoIce.provedor !== 'stun' && C.pc.setConfiguration) { C.ice = novoIce; try { C.pc.setConfiguration({ iceServers: novoIce.iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' }); } catch (e) { /* ignore */ } }
            }
            await fazerOferta(true);
        } catch (e) { log('restart falhou', e); C && (C.reiniciando = false); }
        timer('reinicioOk', function () { if (C) C.reiniciando = false; }, 6000);
    }
    async function fazerOferta(restart) {
        if (!C || !C.pc) return;
        var pc = C.pc;
        if (pc.signalingState !== 'stable') { try { await pc.setLocalDescription({ type: 'rollback' }); } catch (e) { /* ignore */ } }
        var of = await pc.createOffer(restart ? { iceRestart: true } : {});
        C.locVer = (C.locVer || 0) + 1;
        C.candsLocais = [];
        await pc.setLocalDescription(of);
        await enviarSdp();
        timer('regravar', regravarSdp, 2500);
    }
    async function enviarSdp() {
        if (!C || !C.pc || !C.pc.localDescription) return;
        var tipo = C.papel === 'saida' ? 'oferta' : 'resposta';
        var sdp = C.pc.localDescription.sdp, v = C.locVer;
        for (var i = 0; i < 3; i++) {
            try { var row = linha(await rpc('chamada_sdp', { p_id: C.id, p_tipo: tipo, p_sdp: sdp, p_ver: v })); log('sdp gravado', tipo, v); if (row && C) C.row = row; return; }
            catch (e) { log('sdp erro', e); await new Promise(function (r) { setTimeout(r, 700 * (i + 1)); }); if (!C) return; }
        }
    }
    var regravando = false;
    async function regravarSdp() {
        if (!C || !C.pc || regravando) return;
        regravando = true; try { await enviarSdp(); } finally { regravando = false; }
    }

    /** Aplica a linha do banco (Realtime ou consulta). */
    function atualizar(row) {
        if (!C || !row || row.id !== C.id) return;
        C.row = row;
        var e = row.estado;
        log('linha', e, 'oferta_v', row.oferta_ver, 'resp_v', row.resposta_ver, 'fase', C.fase, 'loc', C.locVer, 'rem', C.remVer);
        if (e === 'recusada' || e === 'perdida' || e === 'ocupado' || e === 'encerrada') {
            var txt = e === 'recusada' ? (C.papel === 'saida' ? 'Ligação recusada' : 'Ligação recusada')
                : e === 'ocupado' ? 'Ocupado'
                : e === 'perdida' ? (C.papel === 'saida' ? 'Sem resposta' : 'Ligação perdida')
                : 'Ligação encerrada';
            finalizar(txt, e === 'ocupado' ? 3000 : 1800);
            if (e === 'ocupado') tocar('ocupado');
            return;
        }
        if (e !== 'atendida') return;
        if (C.papel === 'entrada' && row.para_aparelho !== aparelho()) { finalizar('Atendida em outro aparelho', 1500); return; }
        if (C.papel === 'saida' && C.fase === 'chamando') {
            C.fase = 'conectando'; pararSom(); clearTimer('toque');
            tela('conectando', 'Conectando…');
            timer('semConexao', function () { if (C && !C.conectadaEm) desligar('falhou', 'Não foi possível conectar'); }, 30000);
            C.fila = C.fila.then(async function () { await criarPC(); abrirCanal(); await fazerOferta(false); }).catch(function (er) { log('oferta', er); });
            return;
        }
        if (C.papel === 'entrada' && row.oferta && row.oferta_ver >= C.remVer) {
            var o = row.oferta, ov = row.oferta_ver;
            C.fila = C.fila.then(function () { return aplicarRemoto('offer', o, ov); }).catch(function (er) { log('aplicar oferta', er); });
        }
        if (C.papel === 'saida' && row.resposta && row.resposta_ver === C.locVer && row.resposta_ver >= C.remVer) {
            var r = row.resposta, rv = row.resposta_ver;
            C.fila = C.fila.then(function () { return aplicarRemoto('answer', r, rv); }).catch(function (er) { log('aplicar resposta', er); });
        }
    }
    async function aplicarRemoto(tipo, sdp, ver) {
        log('aplicar', tipo, ver, 'rem', C && C.remVer, 'sig', C && C.pc && C.pc.signalingState);
        if (!C || !C.pc) { if (C && tipo === 'offer') { await criarPC(); } if (!C || !C.pc) return; }
        var pc = C.pc;
        if (ver > C.remVer || (tipo === 'answer' && pc.signalingState === 'have-local-offer' && ver === C.locVer)) {
            if (tipo === 'answer' && pc.signalingState !== 'have-local-offer') return;
            await pc.setRemoteDescription({ type: tipo, sdp: sdp });
            C.remVer = ver; C.remSdp = sdp; C.candsRem = new Set();
            if (tipo === 'offer') {
                var ans = await pc.createAnswer();
                C.locVer = ver; C.candsLocais = [];
                await pc.setLocalDescription(ans);
                await enviarSdp();
                timer('regravar', regravarSdp, 2500);
            }
            var fila = C.filaCands.filter(function (x) { return x.v === ver; });
            C.filaCands = C.filaCands.filter(function (x) { return x.v > ver; });
            for (var i = 0; i < fila.length; i++) await addCand(fila[i].c, ver);
            candsDaSdp(sdp);
        } else if (ver === C.remVer && sdp !== C.remSdp) {
            C.remSdp = sdp; candsDaSdp(sdp);         // mesma descrição com mais candidatos (regravada no fim da coleta)
        }
    }
    function candsDaSdp(sdp) {
        var mid = '0', idx = -1;
        String(sdp).split(/\r?\n/).forEach(function (l) {
            if (/^m=/.test(l)) idx++;
            var m = /^a=mid:(.+)$/.exec(l); if (m) mid = m[1].trim();
            if (/^a=candidate:/.test(l)) addCand({ candidate: l.slice(2).trim(), sdpMid: mid, sdpMLineIndex: Math.max(0, idx) }, C.remVer);
        });
    }
    async function addCand(c, ver) {
        if (!C || !C.pc || !c || !c.candidate) return;
        if (ver !== C.remVer || !C.pc.remoteDescription) { if (ver >= C.remVer) C.filaCands.push({ v: ver, c: c }); return; }
        var chave = String(c.candidate).replace(/^candidate:/, '');
        if (C.candsRem.has(chave)) return;
        C.candsRem.add(chave);
        try { await C.pc.addIceCandidate(c); } catch (e) { log('cand', e && e.message); }
    }

    /* canal privado (candidatos ao vivo) */
    function abrirCanal() {
        var c = sb(); if (!C || C.ch || !c || !c.channel) return;
        var id = C.id;
        (async function () {
            try { var s = await c.auth.getSession(); var tk = s && s.data && s.data.session && s.data.session.access_token; if (tk && c.realtime && c.realtime.setAuth) await c.realtime.setAuth(tk); } catch (e) { /* ignore */ }
            if (!C || C.id !== id || C.ch) return;
            var ch = c.channel('chamada:' + id, { config: { private: true, broadcast: { self: false, ack: false } } });
            C.ch = ch;
            ch.on('broadcast', { event: 'sinal' }, function (m) { onSinal(m && m.payload); });
            ch.subscribe(function (st) {
                if (!C || C.ch !== ch) return;
                C.chSt = st; log('canal', st);
                if (st === 'SUBSCRIBED') { sinal({ ev: 'oi' }); reenviarCands(); }
            });
        })();
    }
    function sinal(p) {
        if (!C || !C.ch || C.chSt !== 'SUBSCRIBED') return false;
        try { C.ch.send({ type: 'broadcast', event: 'sinal', payload: Object.assign({ de: eu }, p) }); return true; } catch (e) { return false; }
    }
    function reenviarCands() { if (!C) return; var v = C.locVer; var l = C.candsLocais.filter(function (x) { return x.v === v; }).map(function (x) { return x.c; }); if (l.length) sinal({ ev: 'ice-todos', v: v, l: l }); }
    function onSinal(p) {
        if (!C || !p || p.de === eu) return;
        if (p.ev === 'ice' && p.c) addCand(p.c, Number(p.v) || 0);
        else if (p.ev === 'ice-todos' && Array.isArray(p.l)) p.l.slice(0, 60).forEach(function (c) { addCand(c, Number(p.v) || 0); });
        else if (p.ev === 'oi') { reenviarCands(); poll(); }
        else if (p.ev === 'reiniciar') { if (C.papel === 'saida') reiniciarIce(); }
        else if (p.ev === 'tchau') poll();
    }

    async function poll() {
        if (!C || !C.id || C.fim) return;
        try { var r = await lerLinha(C.id); if (r) atualizar(r); } catch (e) { /* rede: tenta de novo */ }
    }
    async function ping() {
        if (!C || !C.id || C.fim) return;
        guardarToken();
        try { var r = linha(await rpc('chamada_ping', { p_id: C.id })); if (r) atualizar(r); } catch (e) { /* ignore */ }
    }

    /* ---------------- fim ---------------- */
    function desligar(motivo, texto) {
        if (!C || C.fim) return;
        var id = C.id;
        sinal({ ev: 'tchau' });
        var txt = texto || (motivo === 'recusou' ? 'Ligação recusada' : motivo === 'timeout' ? 'Sem resposta' : 'Ligação encerrada');
        if (id) encerrarNoServidor(id, motivo);
        finalizar(txt, motivo === 'timeout' ? 1800 : 1200);
    }
    async function encerrarNoServidor(id, motivo) {
        for (var i = 0; i < 4; i++) {
            try { await rpc('chamada_encerrar', { p_id: id, p_motivo: motivo }); return; }
            catch (e) { await new Promise(function (r) { setTimeout(r, 800 * (i + 1)); }); }
        }
    }
    /** Solta TUDO na hora (microfone primeiro) e esconde a tela depois de mostrar o motivo. */
    function finalizar(texto, msTela) {
        if (!C || C.fim) return;
        var c = C; c.fim = true; c.fase = 'fim';
        Object.keys(c.timers).forEach(function (k) { clearTimeout(c.timers[k]); clearInterval(c.timers[k]); });
        c.timers = {};
        pararSom();
        soltarMic(c.stream); c.stream = null;
        try { if (c.pc) { c.pc.getSenders().forEach(function (s) { try { if (s.track) s.track.stop(); } catch (e) { /* ignore */ } }); c.pc.onicecandidate = null; c.pc.ontrack = null; c.pc.onconnectionstatechange = null; c.pc.oniceconnectionstatechange = null; c.pc.close(); } } catch (e) { /* ignore */ }
        c.pc = null;
        try { if (c.audio) { c.audio.pause(); c.audio.srcObject = null; c.audio.remove(); } } catch (e) { /* ignore */ }
        c.audio = null;
        audioDaChamada(false);
        try { if (c.ch && sb()) sb().removeChannel(c.ch); } catch (e) { /* ignore */ }
        c.ch = null;
        guardaSaida(false);
        travaFim();
        if (texto) { tela('fim', texto); if (!/Ocupado/.test(texto)) tocar('fim'); }
        setTimeout(function () { if (!C || C === c) descartarSom(); }, Math.max(3500, (msTela || 1200) + 600));
        setTimeout(function () { if (C === c) { C = null; esconderTela(); } }, msTela || 1200);
        if (!texto) { C = null; setTimeout(function () { if (!C) esconderTela(); }, msTela || 0); }
    }

    /* ---------------- trava de bolso (sem sensor de proximidade na web) ----------------
     * Ligação conectada + tela de toque: 3 s sem tocar → tela preta que engole todo toque.
     * Destrava só de propósito: arrastar a alça até o fim OU segurar a alça 1,5 s.
     * Ligação é sempre em viva-voz; a trava evita toques acidentais de mão/orelha. Botão "Travar tela" trava na hora.
     * Obs.: o indicador de microfone do iOS (Dynamic Island, topo) é do sistema — nenhum site consegue bloquear;
     * por isso o topo da trava fica vazio. */
    var TRAVA_MS = 3000, TRAVA_SEGURAR_MS = 1500;
    function telaDeToque() { return IOS || (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window); }
    function travaEl() {
        var t = $('ch-trava'); if (t) return t;
        t = document.createElement('div'); t.id = 'ch-trava'; t.className = 'ch-trava oculto'; t.setAttribute('role', 'dialog'); t.setAttribute('aria-label', 'Tela travada');
        t.innerHTML = '<div class="ch-trava-meio"><div class="ch-trava-t">🔒 Tela travada</div><div class="ch-trava-cron" id="ch-trava-cron">0:00</div><div class="ch-trava-nome" id="ch-trava-nome"></div></div>' +
            '<div class="ch-trava-trilho" id="ch-trava-trilho"><span class="ch-trava-dica">deslize para destravar  →</span><div class="ch-trava-alca" id="ch-trava-alca" aria-label="Destravar">🔓</div></div>';
        document.body.appendChild(t);
        // engole TUDO (toque, clique, arrasto, zoom, menu) fora da alça
        var engole = function (e) { if (e.target && e.target.id === 'ch-trava-alca') return; e.preventDefault(); e.stopPropagation(); };
        ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'gesturestart', 'wheel'].forEach(function (ev) { t.addEventListener(ev, engole, { capture: true, passive: false }); });
        var alca = $('ch-trava-alca'), trilho = $('ch-trava-trilho'), x0 = 0, dx = 0, segT = null, ativo = false;
        var max = function () { return Math.max(40, trilho.clientWidth - alca.offsetWidth - 8); };
        var volta = function () { ativo = false; clearTimeout(segT); alca.style.transition = 'transform .2s'; alca.style.transform = 'translateX(0)'; trilho.classList.remove('segurando'); };
        alca.addEventListener('pointerdown', function (e) {
            e.preventDefault(); e.stopPropagation(); ativo = true; x0 = e.clientX; dx = 0; alca.style.transition = 'none';
            try { alca.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
            trilho.classList.add('segurando');
            clearTimeout(segT); segT = setTimeout(function () { if (ativo && Math.abs(dx) < 12) { volta(); destravar2('segurou'); } }, TRAVA_SEGURAR_MS);
        });
        alca.addEventListener('pointermove', function (e) {
            if (!ativo) return; e.preventDefault(); e.stopPropagation();
            dx = Math.max(0, Math.min(max(), e.clientX - x0)); alca.style.transform = 'translateX(' + dx + 'px)';
            if (dx > 12) { clearTimeout(segT); trilho.classList.remove('segurando'); }
        });
        var solta = function (e) { if (!ativo) return; e.preventDefault(); e.stopPropagation(); var ok = dx >= max() * 0.85; volta(); if (ok) destravar2('deslizou'); };
        alca.addEventListener('pointerup', solta); alca.addEventListener('pointercancel', function () { volta(); });
        ['touchstart', 'touchmove', 'touchend', 'click'].forEach(function (ev) { alca.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false }); });
        return t;
    }
    function travada() { var t = $('ch-trava'); return !!(t && !t.classList.contains('oculto')); }
    function travar(motivo) {
        if (!C || C.fim) return;
        var t = travaEl(); clearTimer('trava');
        $('ch-trava-nome').textContent = C.peerNome || '';
        $('ch-trava-cron').textContent = C.conectadaEm ? fmt((Date.now() - C.conectadaEm) / 1000) : '';
        t.classList.remove('oculto'); C.travas = (C.travas || 0) + 1; log('trava', motivo);
        timer('travaCron', function () { if (C && C.conectadaEm && travada()) $('ch-trava-cron').textContent = fmt((Date.now() - C.conectadaEm) / 1000); }, 1000, true);
    }
    function destravar2(como) {
        var t = $('ch-trava'); if (t) t.classList.add('oculto');
        clearTimer('travaCron'); log('destrava', como);
        if (C) C.destravas = (C.destravas || 0) + 1;
        travaAgendar();
    }
    function travaAgendar() {
        clearTimer('trava');
        if (!C || C.fim || C.fase !== 'conectada' || travada() || !telaDeToque()) return;
        timer('trava', function () { if (C && !C.fim && C.fase === 'conectada' && telaDeToque()) travar('3s sem toque'); }, TRAVA_MS);
    }
    function travaFim() { clearTimer('trava'); clearTimer('travaCron'); var t = $('ch-trava'); if (t) t.classList.add('oculto'); manterTelaAcesa(false); }
    // qualquer toque na tela da ligação adia a trava
    document.addEventListener('pointerdown', function (e) { if (C && !C.fim && !travada() && e.target && e.target.closest && e.target.closest('#chamada-tela')) travaAgendar(); }, true);
    // Wake Lock pode falhar se a página ainda não estava visível ao conectar → tenta de novo a cada toque na ligação
    document.addEventListener('pointerdown', function () { if (C && !C.fim && C.fase === 'conectada' && !wake) manterTelaAcesa(true); }, true);

    // Wake Lock: a tela não apaga sozinha durante a ligação (no iPhone, tela apagada pode pausar o microfone do app web)
    var wake = null;
    async function manterTelaAcesa(ligar) {
        try {
            if (ligar) { if (!wake && navigator.wakeLock && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', function () { wake = null; }); } }
            else if (wake) { var w = wake; wake = null; await w.release(); }
        } catch (e) { wake = null; }
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && C && !C.fim && C.fase === 'conectada') manterTelaAcesa(true); });

    function alternarMudo() {
        if (!C) return;
        C.mudo = !C.mudo;
        if (C.stream) C.stream.getAudioTracks().forEach(function (t) { t.enabled = !C.mudo; });
        var b = $('ch-btn-mudo'); b.setAttribute('aria-pressed', C.mudo ? 'true' : 'false');
        b.querySelector('.ch-c').innerHTML = C.mudo ? IC.micOff : IC.mic;
        b.querySelector('.ch-l').textContent = C.mudo ? 'Ativar microfone' : 'Silenciar microfone';
        b.setAttribute('aria-label', C.mudo ? 'Ativar microfone' : 'Silenciar microfone');
    }
    /* Ligação SEMPRE em viva-voz (decisão do dono): sem troca ouvido/alto-falante, sem setSinkId.
     * "Silenciar alto-falante" só liga/desliga o som do outro lado (audio.muted) neste aparelho. */
    var audioPre = null;
    function prepararAudio() {
        if (audioPre && audioPre.isConnected) return audioPre;
        document.querySelectorAll('audio#chamada-audio').forEach(function (v) { try { v.pause(); v.srcObject = null; v.remove(); } catch (er) { /* ignore */ } });
        var a = document.createElement('audio'); a.id = 'chamada-audio'; a.autoplay = true; a.setAttribute('playsinline', ''); a.style.display = 'none'; semPlayer(a);
        document.body.appendChild(a); audioPre = a;
        return a;
    }
    function mostrarSom() {
        var b = $('ch-btn-som'); if (!b) return;
        var mudo = !!(C && C.somMudo);
        b.setAttribute('aria-pressed', mudo ? 'true' : 'false');
        b.querySelector('.ch-c').innerHTML = mudo ? IC.falanteOff : IC.falante;
        b.querySelector('.ch-l').textContent = mudo ? 'Ativar som' : 'Silenciar som';
        b.setAttribute('aria-label', mudo ? 'Ativar som do alto-falante' : 'Silenciar alto-falante');
    }
    function alternarSom() {
        if (!C) return;
        C.somMudo = !C.somMudo;
        var a = C.audio || audioPre;
        if (a) { a.muted = C.somMudo; if (!C.somMudo) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } }
        mostrarSom();
    }

    // sair da página no meio da ligação: avisa o servidor (keepalive) e pergunta antes
    function antesDeSair(e) { if (C && !C.fim) { e.preventDefault(); e.returnValue = ''; return ''; } }
    function aoSair() {
        if (!C || C.fim || !C.id || !C.token) return;
        try {
            fetch(SUPABASE_URL + '/rest/v1/rpc/chamada_encerrar', {
                method: 'POST', keepalive: true,
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + C.token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_id: C.id, p_motivo: C.papel === 'entrada' && C.fase === 'tocando' ? 'recusou' : 'desligou' })
            }).catch(function () {});
        } catch (e) { /* ignore */ }
        sinal({ ev: 'tchau' });
        finalizar(null, 0);
    }
    function guardaSaida(on) {
        if (on) { window.addEventListener('beforeunload', antesDeSair); }
        else { window.removeEventListener('beforeunload', antesDeSair); }
    }
    window.addEventListener('pagehide', aoSair);

    /* ---------------- escutar ligações ---------------- */
    function onRow(p) {
        var row = p && p.new; if (!row || !row.id) return;
        if (C && row.id === C.id) { atualizar(row); return; }
        if (row.para === eu && row.estado === 'tocando' && p.eventType === 'INSERT') entrada(row);
    }
    function assinar() {
        var c = sb(); if (!c || !eu || !c.channel) return;
        if (chanRows) { try { c.removeChannel(chanRows); } catch (e) { /* ignore */ } chanRows = null; }
        var ch = c.channel('chamadas-' + eu + '-' + Date.now().toString(36));
        ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chamadas', filter: 'para=eq.' + eu }, onRow)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chamadas', filter: 'para=eq.' + eu }, onRow)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chamadas', filter: 'de=eq.' + eu }, onRow)
          .subscribe(function (st) {
              chanSt = st; log('rows', st);
              if (st === 'SUBSCRIBED') { verPendente(); }
              if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { clearTimeout(chanRetryT); chanRetryT = setTimeout(assinar, 5000); }
          });
        chanRows = ch;
    }
    var pendT = 0;
    async function verPendente() {
        if (!eu || C || Date.now() - pendT < 1500) return;
        pendT = Date.now();
        try { var r = linha(await rpc('chamada_pendente', {})); if (r && !C && r.estado === 'tocando' && r.para === eu) entrada(r); } catch (e) { /* SQL 63 ausente */ }
    }
    async function abrirPeloAviso() {
        var id = '';
        try { id = new URL(location.href).searchParams.get('chamada') || ''; } catch (e) { /* ignore */ }
        if (!/^[0-9a-f-]{36}$/i.test(id)) return;
        try { var u = new URL(location.href); u.searchParams.delete('chamada'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* ignore */ }
        var r = await lerLinha(id).catch(function () { return null; });
        if (r && r.estado === 'tocando' && r.para === eu && !C) entrada(r);
        else if (r && !C) toastC(r.estado === 'atendida' ? 'Ligação já atendida.' : 'Ligação perdida.');
    }
    // pergunta ao banco se a ligação existe/está ligada (no máx. 1x por minuto)
    async function conferirBackend(forcar) {
        if (!forcar && Date.now() - cfgT < 60000) return ATIVO;
        cfgT = Date.now();
        var ok = false;
        try { var d = linha(await rpc('chamada_config', {})); ok = !!(d && d.ativo === true); } catch (e) { ok = false; /* SQL 63 ausente → fica escondido */ }
        if (!ok && C && !C.fim) ok = true;      // nunca derruba ligação em andamento
        ATIVO = ok && suportado();
        botaoLigar(ATIVO);
        return ATIVO;
    }
    async function iniciar() {
        var c = sb(); if (!c) return;
        try { var s = await c.auth.getSession(); var u = s && s.data && s.data.session && s.data.session.user; if (!u) return; eu = u.id; } catch (e) { return; }
        if (!(await conferirBackend(true))) return;
        if (iniciado) return; iniciado = true;
        montarTela();
        assinar();
        abrirPeloAviso();
        verPendente();
    }
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !eu) return;
        if (!iniciado) { conferirBackend(false).then(function (ok) { if (ok) iniciar(); }); return; }
        conferirBackend(false);
        if (C) { poll(); if (C.pc && C.fase === 'reconectando') reiniciarIce(); } else verPendente();
        if (chanSt !== 'SUBSCRIBED') assinar();
    });
    window.addEventListener('online', function () { if (C && C.pc && C.fase !== 'conectada') reiniciarIce(); if (eu && chanSt !== 'SUBSCRIBED') assinar(); });

    window.MineraChamada = {
        ligar: ligar, iniciar: iniciar, disponivel: function () { return ATIVO; }, ativa: function () { return !!(C && !C.fim); }, suportado: suportado,
        _reiniciarIce: function () { return reiniciarIce(); },
        /** bytes de áudio recebidos/enviados (prova de que o áudio passa) */
        _stats: async function () {
            if (!C || !C.pc) return null;
            var r = { recebidos: 0, enviados: 0, par: null };
            (await C.pc.getStats()).forEach(function (s) {
                if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'audio') r.recebidos += s.bytesReceived || 0;
                if (s.type === 'outbound-rtp' && (s.kind || s.mediaType) === 'audio') r.enviados += s.bytesSent || 0;
                if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') r.par = s.id;
            });
            return r;
        },
        _debug: function () {
            return {
                fase: C ? C.fase : 'livre', id: C ? C.id : null, papel: C ? C.papel : null, estadoDb: C && C.row ? C.row.estado : null,
                mudo: C ? C.mudo : false, pc: C && C.pc ? (C.pc.connectionState || C.pc.iceConnectionState) : null,
                canal: C ? C.chSt : null, rows: chanSt, provedor: C && C.ice ? C.ice.provedor : null,
                tracks: todosStreams.reduce(function (a, s) { return a.concat(s.getTracks().map(function (t) { return t.readyState; })); }, []),
                micAbertos: todosStreams.length,
                ctx: ctxTodos.map(function (c) { return c.state; }),
                sessao: navigator.audioSession ? navigator.audioSession.type : null,
                audiosRemotos: [].filter.call(document.querySelectorAll('audio,video'), function (v) { return !!v.srcObject; }).length,
                micTocandoLocal: [].some.call(document.querySelectorAll('audio,video'), function (v) { var ids = todosStreams.reduce(function (a, s) { return a.concat(s.getTracks().map(function (t) { return t.id; })); }, []); return !!(v.srcObject && v.srcObject.getTracks && v.srcObject.getTracks().some(function (t) { return ids.indexOf(t.id) >= 0; })); }),
                toque: { tipo: somTipo, tocando: !!(somEl && !somEl.paused && somEl.src) },
                somMudo: !!(C && C.somMudo), audioMudo: (function () { var v = document.getElementById('chamada-audio'); return v ? v.muted : null; })(),
                ios: IOS,
                travada: travada(), travas: C ? (C.travas || 0) : 0, destravas: C ? (C.destravas || 0) : 0, telaAcesa: !!wake,
                somEl: somEl ? { dur: somEl.duration, loop: somEl.loop, src: !!somEl.getAttribute('src') } : null,
                audiosNoDom: document.querySelectorAll('audio').length,
                mediaSession: navigator.mediaSession ? { meta: navigator.mediaSession.metadata, estado: navigator.mediaSession.playbackState } : null,
                saidaTexto: $('ch-saida') ? $('ch-saida').textContent : '',
                trilhasRecebidas: (function () { var v = document.getElementById('chamada-audio'); return v && v.srcObject ? v.srcObject.getAudioTracks().length : 0; })(),
                trilhasEnviadas: C && C.pc ? C.pc.getSenders().filter(function (x) { return x.track; }).length : 0
            };
        }
    };
    // começa sozinho quando houver sessão (as páginas já criaram o supabaseClient antes)
    function auto() { iniciar(); try { sb() && sb().auth.onAuthStateChange(function (ev, s) { if (s && s.user && s.user.id !== eu) { eu = s.user.id; iniciado = false; iniciar(); } }); } catch (e) { /* ignore */ } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
