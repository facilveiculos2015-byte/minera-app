/**
 * Minera Pará — áudio do chat estilo WhatsApp.
 *  - Gravação: onda ao vivo (Web Audio AnalyserNode) desenhada num <canvas>.
 *  - Os níveis da gravação viram os "picos" da mensagem (40 barras), guardados
 *    no fragmento da URL do áudio (#wf=<base36>&d=<segundos>) — não precisa de SQL
 *    e apps antigos continuam tocando (o fragmento não vai para o servidor).
 *  - Player: play/pause, barras estáticas com progresso colorido, toque/arraste
 *    para pular, duração e velocidade 1x/1,5x/2x. Sem picos (áudio antigo ou
 *    enviado como arquivo) → calcula decodificando o áudio (cache local).
 */
(function () {
    'use strict';
    var NBARRAS = 40;
    var CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
    var CACHE_KEY = 'minera_audio_picos_v1';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function fmt(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

    /* ---------- picos <-> texto ---------- */
    function reamostrar(niveis, n) {
        n = n || NBARRAS;
        var out = [];
        if (!niveis || !niveis.length) { for (var z = 0; z < n; z++) out.push(0.15); return out; }
        for (var i = 0; i < n; i++) {
            var a = Math.floor(i * niveis.length / n), b = Math.max(a + 1, Math.floor((i + 1) * niveis.length / n));
            var mx = 0; for (var j = a; j < b && j < niveis.length; j++) mx = Math.max(mx, niveis[j]);
            out.push(mx);
        }
        var top = Math.max.apply(null, out) || 1;
        return out.map(function (v) { return Math.max(0.08, Math.min(1, v / top)); });
    }
    function codificar(picos) { return (picos || []).map(function (p) { return CHARS[Math.max(0, Math.min(35, Math.round(p * 35)))]; }).join(''); }
    function decodificar(s) {
        s = String(s || '');
        if (!/^[0-9a-z]{8,80}$/.test(s)) return null;
        return s.split('').map(function (c) { return Math.max(0.08, CHARS.indexOf(c) / 35); });
    }
    /** "https://…/a.webm#wf=…&d=12.3" → { src, picos, dur } */
    function lerUrl(url) {
        var s = String(url || ''), i = s.indexOf('#');
        var src = i >= 0 ? s.slice(0, i) : s, frag = i >= 0 ? s.slice(i + 1) : '';
        var picos = null, dur = 0;
        frag.split('&').forEach(function (kv) {
            var p = kv.split('='); if (p.length !== 2) return;
            if (p[0] === 'wf') picos = decodificar(p[1]);
            if (p[0] === 'd') dur = Math.max(0, Math.min(3600, Number(p[1]) || 0));
        });
        return { src: src, picos: picos, dur: dur };
    }
    function fragmento(picos, dur) { return '#wf=' + codificar(picos) + '&d=' + (Math.round((Number(dur) || 0) * 10) / 10); }

    /* barras "falsas" estáveis (enquanto calcula) a partir do hash da URL */
    function picosFalsos(seed) {
        var h = 2166136261; seed = String(seed || 'x');
        for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
        var out = [];
        for (var k = 0; k < NBARRAS; k++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; out.push(0.2 + ((h >>> 0) % 1000) / 1000 * 0.6); }
        return out;
    }

    /* ---------- cache de picos calculados ---------- */
    function cacheLer() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; } }
    function cacheGravar(src, picos, dur) {
        try {
            var c = cacheLer(); var ks = Object.keys(c);
            if (ks.length > 150) ks.slice(0, ks.length - 150).forEach(function (k) { delete c[k]; });
            c[src] = { w: codificar(picos), d: Math.round(dur * 10) / 10 };
            localStorage.setItem(CACHE_KEY, JSON.stringify(c));
        } catch (e) { /* ignore */ }
    }
    var ctxDecod = null;
    async function calcularPicos(src) {
        var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
        var r = await fetch(src, { credentials: 'omit' }); if (!r.ok) return null;
        var buf = await r.arrayBuffer();
        var dados, duracaoS;
        if (window.AudioCompat) { var pcm = await AudioCompat.decodificarPcm(buf); dados = pcm.mono; duracaoS = pcm.mono.length / pcm.taxa; }
        else {
            if (!ctxDecod) ctxDecod = new C();
            var audio = await new Promise(function (res, rej) { var p = ctxDecod.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
            dados = audio.getChannelData(0); duracaoS = audio.duration;
        }
        var n = NBARRAS, passo = Math.max(1, Math.floor(dados.length / n)), niveis = [];
        for (var i = 0; i < n; i++) {
            var soma = 0, ini = i * passo, fim = Math.min(dados.length, ini + passo);
            for (var j = ini; j < fim; j += 16) soma += dados[j] * dados[j];
            niveis.push(Math.sqrt(soma / Math.max(1, (fim - ini) / 16)));
        }
        return { picos: reamostrar(niveis, n), dur: duracaoS };
    }

    /* ---------- player ---------- */
    function barrasHtml(picos) {
        return picos.map(function (p) { return '<i style="height:' + Math.round(14 + p * 86) + '%"></i>'; }).join('');
    }
    /** HTML da bolha de áudio. url pode trazer #wf=…&d=… */
    function playerHtml(url, opts) {
        opts = opts || {};
        var info = lerUrl(url), picos = info.picos, dur = info.dur, calc = !picos;
        if (!picos) { var c = cacheLer()[info.src]; if (c) { picos = decodificar(c.w); dur = dur || c.d; calc = !picos; } }
        var mostrar = picos || picosFalsos(info.src);
        return '<div class="au-player' + (calc ? ' au-calc' : '') + '" data-src="' + esc(info.src) + '" data-dur="' + (dur || 0) + '">' +
            '<button type="button" class="au-play" aria-label="Tocar áudio"><svg class="au-i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>' +
            '<svg class="au-i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg></button>' +
            '<div class="au-col"><div class="au-wave" role="slider" aria-label="Posição do áudio" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">' + barrasHtml(mostrar) + '</div>' +
            '<div class="au-meta"><span class="au-tempo">' + (dur ? fmt(dur) : '0:00') + '</span><button type="button" class="au-vel" aria-label="Velocidade">1x</button></div></div>' +
            (opts.mime ? '<audio preload="none" playsinline webkit-playsinline><source src="' + esc(info.src) + '" type="' + esc(opts.mime) + '"></audio>'
                : '<audio preload="none" playsinline webkit-playsinline src="' + esc(info.src) + '"></audio>') +
            '</div>';
    }

    var atual = null; // player tocando
    function el(p, s) { return p.querySelector(s); }
    function duracao(p) {
        var a = el(p, 'audio'), d = Number(p.getAttribute('data-dur')) || 0;
        if (a && isFinite(a.duration) && a.duration > 0) d = a.duration;
        return d;
    }
    function pintar(p) {
        var a = el(p, 'audio'), d = duracao(p), t = a ? a.currentTime : 0;
        var frac = d ? Math.max(0, Math.min(1, t / d)) : 0;
        var bars = p.querySelectorAll('.au-wave i'), lim = Math.round(frac * bars.length);
        for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < lim);
        var w = el(p, '.au-wave'); if (w) w.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
        var tm = el(p, '.au-tempo'); if (tm) tm.textContent = (a && !a.paused) || t > 0 ? fmt(t) : fmt(d);
    }
    var raf = 0;
    function loop() { raf = 0; if (atual) { pintar(atual); var a = el(atual, 'audio'); if (a && !a.paused) raf = requestAnimationFrame(loop); } }
    function parar(p) {
        var a = el(p, 'audio'); if (a && !a.paused) a.pause();
        p.classList.remove('tocando'); pintar(p);
    }
    /* Áudio que este navegador não toca (ex.: WebM/Opus antigo do Android no iPhone):
     * converte para WAV local (AudioCompat) e toca. O <audio> é "destravado" no gesto
     * com 0,1 s de silêncio, senão o iOS bloqueia o play() depois da conversão. */
    function mimeDo(p) { var s = el(p, 'audio source'); return (s && s.getAttribute('type')) || (window.ChatMidia ? ChatMidia.mimeFromMediaUrl(p.getAttribute('data-src')) : ''); }
    function linkBaixar(p) {
        var host = p.parentNode || p;
        if (host.querySelector('.au-dl')) return;
        var a = document.createElement('a');
        a.className = 'btn-sm au-dl'; a.href = p.getAttribute('data-src') || '#'; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('download', '');
        a.textContent = 'Baixar áudio';
        var d = document.createElement('div'); d.className = 'audio-err hint'; d.textContent = 'Não foi possível tocar este áudio.';
        host.appendChild(d); host.appendChild(a);
    }
    function tocarCompat(p, a) {
        if (!window.AudioCompat || p._compat) return false;
        p._compat = 'carregando';
        p.classList.add('au-carregando');
        try { a.innerHTML = ''; if (AudioCompat.silencio) { a.src = AudioCompat.silencio; var s0 = a.play(); if (s0 && s0.catch) s0.catch(function () { /* ignore */ }); } } catch (e) { /* ignore */ }
        AudioCompat.urlTocavel(p.getAttribute('data-src')).then(function (u) {
            p._compat = 'ok';
            p.classList.remove('au-carregando', 'au-erro');
            try { a.pause(); } catch (e) { /* ignore */ }
            a.src = u; a.preload = 'auto';
            if (atual === p) { a.playbackRate = Number(p.getAttribute('data-vel') || 1); var pr = a.play(); if (pr && pr.catch) pr.catch(function () { p.classList.remove('tocando'); }); }
        }).catch(function (e) {
            console.warn('áudio compat', e);
            p._compat = 'falhou';
            p.classList.remove('au-carregando', 'tocando'); p.classList.add('au-erro');
            linkBaixar(p);
        });
        return true;
    }
    function tocar(p) {
        if (atual && atual !== p) parar(atual);
        atual = p;
        var a = el(p, 'audio'); if (!a) return;
        if (p._compat === 'carregando') return;
        if (!p._compat && window.AudioCompat && AudioCompat.naoToca(mimeDo(p), a)) { bindAudio(p, a); tocarCompat(p, a); return; }
        bindAudio(p, a);
        a.playbackRate = Number(p.getAttribute('data-vel') || 1);
        var pr = a.play(); if (pr && pr.catch) pr.catch(function (e) {
            p.classList.remove('tocando');
            if (e && e.name === 'NotSupportedError') tocarCompat(p, a);
        });
    }
    function bindAudio(p, a) {
        if (!a._bound) {
            a._bound = true;
            a.addEventListener('ended', function () { p.classList.remove('tocando'); a.currentTime = 0; pintar(p); });
            a.addEventListener('pause', function () { p.classList.remove('tocando'); pintar(p); });
            a.addEventListener('play', function () { p.classList.add('tocando'); if (!raf) raf = requestAnimationFrame(loop); });
            a.addEventListener('loadedmetadata', function () { pintar(p); });
            a.addEventListener('error', function () {
                p.classList.remove('tocando');
                if (p._compat === 'carregando') return;
                if (!p._compat && tocarCompat(p, a)) return;
                p.classList.add('au-erro');
            });
        }
    }
    function buscar(p, frac) {
        var a = el(p, 'audio'), d = duracao(p); if (!a || !d) return;
        try { a.currentTime = Math.max(0, Math.min(d - 0.05, frac * d)); } catch (e) { /* ignore */ }
        pintar(p);
    }

    /* cálculo preguiçoso de picos (só quando aparece na tela) */
    var io = null, fila = [], rodando = 0;
    function processarFila() {
        while (rodando < 2 && fila.length) {
            var p = fila.shift(); rodando++;
            (function (p) {
                var src = p.getAttribute('data-src');
                calcularPicos(src).then(function (r) {
                    if (!r) return;
                    cacheGravar(src, r.picos, r.dur);
                    document.querySelectorAll('.au-player.au-calc').forEach(function (q) {
                        if (q.getAttribute('data-src') !== src) return;
                        el(q, '.au-wave').innerHTML = barrasHtml(r.picos);
                        if (!Number(q.getAttribute('data-dur'))) q.setAttribute('data-dur', String(r.dur || 0));
                        q.classList.remove('au-calc'); pintar(q);
                    });
                }).catch(function () { /* fica com as barras padrão */ }).then(function () { rodando--; processarFila(); });
            })(p);
        }
    }
    function observar(root) {
        var ps = (root || document).querySelectorAll('.au-player.au-calc:not([data-obs])');
        if (!ps.length) return;
        if (!io && 'IntersectionObserver' in window) {
            io = new IntersectionObserver(function (es) {
                es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fila.push(e.target); processarFila(); } });
            }, { rootMargin: '200px' });
        }
        ps.forEach(function (p) { p.setAttribute('data-obs', '1'); if (io) io.observe(p); else { fila.push(p); processarFila(); } });
    }

    function ligar(container) {
        if (!container || container._auBound) return;
        container._auBound = true;
        container.addEventListener('click', function (e) {
            var p = e.target.closest && e.target.closest('.au-player'); if (!p) return;
            if (e.target.closest('.au-play')) {
                e.preventDefault();
                var a = el(p, 'audio');
                if (a && !a.paused) parar(p); else tocar(p);
                return;
            }
            if (e.target.closest('.au-vel')) {
                var v = Number(p.getAttribute('data-vel') || 1); v = v === 1 ? 1.5 : (v === 1.5 ? 2 : 1);
                p.setAttribute('data-vel', String(v));
                el(p, '.au-vel').textContent = String(v).replace('.', ',') + 'x';
                var au = el(p, 'audio'); if (au) au.playbackRate = v;
                return;
            }
        });
        // toque/arraste na onda = pular
        var arr = null;
        function frac(p, x) { var r = el(p, '.au-wave').getBoundingClientRect(); return (x - r.left) / Math.max(1, r.width); }
        container.addEventListener('pointerdown', function (e) {
            var w = e.target.closest && e.target.closest('.au-wave'); if (!w) return;
            var p = w.closest('.au-player'); var a = el(p, 'audio');
            if (a && a.preload === 'none') { a.preload = 'metadata'; try { a.load(); } catch (er) { /* ignore */ } }
            arr = { p: p, id: e.pointerId };
            try { w.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
            buscar(p, frac(p, e.clientX));
        });
        container.addEventListener('pointermove', function (e) { if (arr && e.pointerId === arr.id) buscar(arr.p, frac(arr.p, e.clientX)); });
        var fim = function (e) { if (arr && e.pointerId === arr.id) arr = null; };
        container.addEventListener('pointerup', fim); container.addEventListener('pointercancel', fim);
    }

    /* ---------- visualização ao vivo durante a gravação ---------- */
    function visualizar(stream, canvas) {
        var C = window.AudioContext || window.webkitAudioContext;
        var niveis = [], hist = [], ctx = null, an = null, src = null, rafV = 0, ativo = true, ult = 0;
        try {
            ctx = new C();
            src = ctx.createMediaStreamSource(stream);
            an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.3;
            src.connect(an);
            if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
        } catch (e) { an = null; }
        var dados = an ? new Uint8Array(an.fftSize) : null;
        function desenhar(t) {
            if (!ativo) return;
            rafV = requestAnimationFrame(desenhar);
            if (t - ult < 60) return; // ~16 barras/s
            ult = t;
            var nivel = 0;
            if (an) {
                an.getByteTimeDomainData(dados);
                var s = 0; for (var i = 0; i < dados.length; i++) { var v = (dados[i] - 128) / 128; s += v * v; }
                nivel = Math.min(1, Math.sqrt(s / dados.length) * 3.2);
            }
            niveis.push(nivel); hist.push(nivel);
            if (!canvas) return;
            var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
            if (!w || !h) return;
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
            var g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
            var bw = 3, gap = 2, cab = Math.floor(w / (bw + gap));
            if (hist.length > cab) hist = hist.slice(hist.length - cab);
            var cor = getComputedStyle(canvas).color || '#F5A623';
            g.fillStyle = cor;
            for (var k = 0; k < hist.length; k++) {
                var bh = Math.max(3, hist[k] * (h - 4));
                var x = w - (hist.length - k) * (bw + gap);
                var y = (h - bh) / 2;
                if (g.roundRect) { g.beginPath(); g.roundRect(x, y, bw, bh, 1.5); g.fill(); } else g.fillRect(x, y, bw, bh);
            }
        }
        rafV = requestAnimationFrame(desenhar);
        return {
            parar: function () {
                if (!ativo) return reamostrar(niveis, NBARRAS);
                ativo = false; cancelAnimationFrame(rafV); rafV = 0;
                // solta tudo que segura o microfone: nós de áudio + AudioContext fechado
                try { if (src) src.disconnect(); } catch (e) { /* ignore */ }
                try { if (an) an.disconnect(); } catch (e) { /* ignore */ }
                try { if (ctx && ctx.state !== 'closed' && ctx.close) { var pc = ctx.close(); if (pc && pc.catch) pc.catch(function () { /* ignore */ }); } } catch (e) { /* ignore */ }
                src = null; an = null; ctx = null;
                if (canvas) { var g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); }
                return reamostrar(niveis, NBARRAS);
            },
            niveis: function () { return niveis.slice(); }
        };
    }

    window.ChatAudio = {
        playerHtml: playerHtml, ligar: ligar, observar: observar, visualizar: visualizar,
        fragmento: fragmento, lerUrl: lerUrl, reamostrar: reamostrar, fmt: fmt,
        pararTodos: function () { if (atual) parar(atual); }
    };
})();
