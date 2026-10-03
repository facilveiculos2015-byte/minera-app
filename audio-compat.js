/* Minera Pará — compatibilidade de áudio do chat entre Android e iPhone.
 *  - paraUniversal(file): áudio gravado em WebM/Opus ou Ogg (Chrome/Android) → MP3 16 kHz mono
 *    (lamejs, carregado sob demanda) antes do upload. MP3 toca em iPhone, Android e desktop.
 *    Falhou o MP3 → WAV 16 kHz mono. Falhou tudo → manda o original (nunca bloqueia o envio).
 *  - urlTocavel(src): para áudios ANTIGOS em WebM/Opus que o iPhone não toca: baixa o arquivo,
 *    tenta decodeAudioData (Safari 17+ às vezes consegue) e, se falhar, decodifica com
 *    opus-decoder (WASM, sob demanda) + leitor WebM mínimo → WAV local (blob:).
 *  - decodificarPcm(buf): PCM mono para desenhar a onda quando decodeAudioData falha.
 */
(function () {
    'use strict';
    var VER = (function () { try { var s = document.currentScript && document.currentScript.src; var m = /[?&]v=([^&#]+)/.exec(s || ''); return m ? m[1] : ''; } catch (e) { return ''; } })();
    var BASE = (function () { try { var s = document.currentScript && document.currentScript.src; return s ? s.replace(/[^/]*$/, '') : ''; } catch (e) { return ''; } })();
    var TAXA = 16000, KBPS = 32;

    function baseMime(t) { return String(t || '').split(';')[0].trim().toLowerCase(); }
    var carregando = {};
    function carregarScript(nome) {
        if (carregando[nome]) return carregando[nome];
        carregando[nome] = new Promise(function (res, rej) {
            var s = document.createElement('script');
            s.src = BASE + 'vendor/' + nome + (VER ? '?v=' + VER : '');
            s.async = true; s.charset = 'utf-8'; // opus-decoder embute o WASM em texto UTF-8
            s.onload = function () { res(); };
            s.onerror = function () { carregando[nome] = null; rej(new Error('falha ao carregar ' + nome)); };
            document.head.appendChild(s);
        });
        return carregando[nome];
    }

    var ctxDec = null;
    function ctx() {
        var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
        if (!ctxDec) { try { ctxDec = new C(); } catch (e) { ctxDec = null; } }
        return ctxDec;
    }
    function decodeNativo(buf) {
        var c = ctx(); if (!c) return Promise.reject(new Error('sem AudioContext'));
        return new Promise(function (res, rej) {
            var feito = false;
            var t = setTimeout(function () { if (!feito) { feito = true; rej(new Error('timeout decode')); } }, 15000);
            try {
                var p = c.decodeAudioData(buf.slice(0), function (b) { if (!feito) { feito = true; clearTimeout(t); res(b); } }, function (e) { if (!feito) { feito = true; clearTimeout(t); rej(e || new Error('decode')); } });
                if (p && p.then) p.then(function (b) { if (!feito) { feito = true; clearTimeout(t); res(b); } }, function (e) { if (!feito) { feito = true; clearTimeout(t); rej(e || new Error('decode')); } });
            } catch (e) { feito = true; clearTimeout(t); rej(e); }
        });
    }
    function mixMono(chs, n) {
        if (chs.length === 1) return chs[0].length === n ? chs[0] : chs[0].subarray(0, n);
        var out = new Float32Array(n);
        for (var c = 0; c < chs.length; c++) { var d = chs[c]; for (var i = 0; i < n; i++) out[i] += d[i] / chs.length; }
        return out;
    }
    /** Reamostragem linear simples (voz) */
    function reamostrar(dados, de, para) {
        if (de === para) return dados;
        var n = Math.max(1, Math.floor(dados.length * para / de)), out = new Float32Array(n), r = de / para;
        for (var i = 0; i < n; i++) { var x = i * r, a = Math.floor(x), f = x - a, b = Math.min(dados.length - 1, a + 1); out[i] = dados[a] * (1 - f) + dados[b] * f; }
        return out;
    }
    function paraInt16(f) {
        var out = new Int16Array(f.length);
        for (var i = 0; i < f.length; i++) { var s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        return out;
    }
    function wav(pcm16, taxa) {
        var buf = new ArrayBuffer(44 + pcm16.length * 2), v = new DataView(buf);
        function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
        str(0, 'RIFF'); v.setUint32(4, 36 + pcm16.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, taxa, true);
        v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm16.length * 2, true);
        new Int16Array(buf, 44).set(pcm16);
        return new Blob([buf], { type: 'audio/wav' });
    }
    function mp3(pcm16, taxa) {
        var L = window.lamejs; if (!L || !L.Mp3Encoder) throw new Error('lamejs indisponível');
        var enc = new L.Mp3Encoder(1, taxa, KBPS), partes = [], BLOCO = 1152;
        for (var i = 0; i < pcm16.length; i += BLOCO) { var o = enc.encodeBuffer(pcm16.subarray(i, i + BLOCO)); if (o.length) partes.push(new Uint8Array(o)); }
        var f = enc.flush(); if (f.length) partes.push(new Uint8Array(f));
        return new Blob(partes, { type: 'audio/mpeg' });
    }

    /* ---------- leitor WebM mínimo (MediaRecorder: 1 faixa Opus, sem lacing) ---------- */
    var MASTERS = { 0x18538067: 1, 0x1F43B675: 1, 0x1654AE6B: 1, 0xAE: 1, 0xA0: 1 };
    function vint(b, p, comMarcador) {
        if (p >= b.length) return null;
        var f = b[p], len = 1, m = 0x80;
        while (len <= 8 && !(f & m)) { m >>= 1; len++; }
        if (len > 8 || p + len > b.length) return null;
        var val = comMarcador ? f : (f & (m - 1)), unos = (f & (m - 1)) === (m - 1);
        for (var i = 1; i < len; i++) { val = val * 256 + b[p + i]; if (b[p + i] !== 0xff) unos = false; }
        return { v: val, n: len, desconhecido: !comMarcador && unos };
    }
    function idx(b, pat, ate) {
        ate = Math.min(b.length - pat.length, ate == null ? b.length : ate);
        for (var i = 0; i <= ate; i++) { var k = 0; while (k < pat.length && b[i + k] === pat[k]) k++; if (k === pat.length) return i; }
        return -1;
    }
    /** Arquivos estragados pelo bug de gravação (≤ 20261003b): começam no meio do cabeçalho
     *  ou num Cluster sem cabeçalho. Recoloca o byte perdido / pula até o 1º elemento válido. */
    function ressincronizar(b) {
        if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return b;
        function pre(x) { var o = new Uint8Array(b.length + 1); o[0] = x; o.set(b, 1); return o; }
        if (b[0] === 0x45 && b[1] === 0xDF && b[2] === 0xA3) return pre(0x1A);
        if (b[0] === 0x43 && b[1] === 0xB6 && b[2] === 0x75) return pre(0x1F);
        var i = idx(b, [0x1A, 0x45, 0xDF, 0xA3], 4096); if (i >= 0) return b.subarray(i);
        i = idx(b, [0x1F, 0x43, 0xB6, 0x75]); if (i >= 0) return b.subarray(i);
        return b;
    }
    function lerWebm(b) {
        b = ressincronizar(b);
        var frames = [], canais = 1, preSkip = 0, p = 0, fim = b.length;
        while (p < fim) {
            var id = vint(b, p, true); if (!id) break;
            var tm = vint(b, p + id.n, false); if (!tm) break;
            var ini = p + id.n + tm.n, f2 = tm.desconhecido ? fim : Math.min(fim, ini + tm.v);
            if (MASTERS[id.v]) { p = ini; continue; }
            if (tm.desconhecido) break;
            if (id.v === 0x63A2 && f2 - ini >= 12) { // CodecPrivate = OpusHead
                canais = b[ini + 9] || 1; preSkip = b[ini + 10] | (b[ini + 11] << 8);
            } else if (id.v === 0xA3 || id.v === 0xA1) { // SimpleBlock / Block
                var tr = vint(b, ini, false);
                if (tr) { var q = ini + tr.n + 2, flags = b[q]; q += 1; if (f2 - q > 4000 || f2 - ini !== tm.v) break; /* tamanho absurdo = arquivo misturado */ if (((flags >> 1) & 3) === 0 && q < f2) frames.push(b.slice(q, f2)); }
            }
            p = f2;
        }
        // Arquivo misturado (bug de gravação ≤ 20261003b: pedaços de 2 gravações no mesmo arquivo):
        // a leitura estruturada para cedo. Varre por assinatura de SimpleBlock (A3 tam 81 tt tt 80).
        var usados = 0; for (var u = 0; u < frames.length; u++) usados += frames[u].length;
        if (usados < b.length * 0.5) {
            var fs2 = varrerBlocos(b);
            var u2 = 0; for (var v = 0; v < fs2.length; v++) u2 += fs2[v].length;
            if (u2 > usados) frames = fs2;
        }
        return { frames: frames, canais: canais, preSkip: preSkip };
    }
    function varrerBlocos(b) {
        var out = [], i = 0, n = b.length;
        while (i < n - 8) {
            if (b[i] === 0xA3) {
                var t = vint(b, i + 1, false);
                if (t && !t.desconhecido && t.v >= 5 && t.v <= 4000) {
                    var q = i + 1 + t.n, fimB = q + t.v;
                    if (b[q] === 0x81 && fimB <= n && (b[q + 3] & 0x86) === 0x80) { out.push(b.slice(q + 4, fimB)); i = fimB; continue; }
                }
            }
            i++;
        }
        // mantém só frames com a mesma configuração Opus (byte TOC) da maioria — descarta falsos positivos
        var cont = {}, top = -1, topN = 0;
        out.forEach(function (f) { var k = f[0] & 0xF8; cont[k] = (cont[k] || 0) + 1; if (cont[k] > topN) { topN = cont[k]; top = k; } });
        return out.filter(function (f) { return (f[0] & 0xF8) === top; });
    }
    async function decodeOpusWebm(ab) {
        var w = lerWebm(new Uint8Array(ab));
        if (!w.frames.length) throw new Error('webm sem frames opus');
        await carregarScript('opus-decoder.min.js');
        var lib = (window['opus-decoder'] || (typeof globalThis !== 'undefined' && globalThis['opus-decoder']));
        if (!lib || !lib.OpusDecoder) throw new Error('opus-decoder indisponível');
        var dec = new lib.OpusDecoder({ channels: Math.min(2, Math.max(1, w.canais)), preSkip: w.preSkip });
        await dec.ready;
        try {
            var r = await dec.decodeFrames(w.frames);
            return { mono: mixMono(r.channelData, r.samplesDecoded), taxa: r.sampleRate || 48000 };
        } finally { try { dec.free(); } catch (e) { /* ignore */ } }
    }
    /** ArrayBuffer → { mono: Float32Array, taxa } (nativo; senão Opus/WebM via WASM) */
    function pareceWebm(u8) {
        if (u8.length < 4) return false;
        if (u8[0] === 0x1A && u8[1] === 0x45 && u8[2] === 0xDF && u8[3] === 0xA3) return true;
        if ((u8[0] === 0x45 && u8[1] === 0xDF && u8[2] === 0xA3) || (u8[0] === 0x43 && u8[1] === 0xB6 && u8[2] === 0x75)) return true;
        return idx(u8, [0x1F, 0x43, 0xB6, 0x75], 4096) >= 0 && idx(u8, [0x49, 0x44, 0x33], 0) !== 0; // tem Cluster e não é MP3/ID3
    }
    /** MP3 / MP4(M4A) / WAV pelo conteúdo (servidor pode mandar como octet-stream) */
    function tipoPorBytes(u8) {
        if (u8.length < 12) return '';
        if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) return 'audio/mpeg';
        if (u8[0] === 0xFF && (u8[1] & 0xE0) === 0xE0) return 'audio/mpeg';
        if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return 'audio/mp4';
        if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57) return 'audio/wav';
        if (pareceWebm(u8)) return 'audio/webm';
        if (u8[0] === 0x4F && u8[1] === 0x67 && u8[2] === 0x67 && u8[3] === 0x53) return 'audio/ogg';
        return '';
    }
    async function decodificarPcm(ab) {
        if (pareceWebm(new Uint8Array(ab, 0, Math.min(ab.byteLength, 8192)))) {
            try { return await decodeOpusWebm(ab); } catch (eOpus) { console.warn('opus-wasm', eOpus); }
        }
        try {
            var a = await decodeNativo(ab);
            var chs = []; for (var c = 0; c < a.numberOfChannels; c++) chs.push(a.getChannelData(c));
            return { mono: mixMono(chs, a.length), taxa: a.sampleRate };
        } catch (e) {
            return decodeOpusWebm(ab);
        }
    }

    /** Precisa converter antes do upload? (formatos que o iPhone não toca) */
    function precisaConverter(mime) { mime = baseMime(mime); return mime === 'audio/webm' || mime === 'audio/ogg' || mime === 'video/webm'; }

    async function duracaoDe(blob) {
        try { var a = await decodeNativo(await blob.arrayBuffer()); return a.duration; } catch (e) { return -1; }
    }
    /** file: gravação; durEsperada (s): duração medida na gravação (opcional) */
    async function paraUniversal(file, durEsperada) {
        try {
            if (!file || !precisaConverter(file.type)) return file;
            var ab = await file.arrayBuffer();
            var pcm = await decodificarPcm(ab);
            var segs = pcm.mono.length / pcm.taxa;
            var pico = 0; for (var k = 0; k < pcm.mono.length; k += 7) { var v = Math.abs(pcm.mono[k]); if (v > pico) pico = v; }
            // decodificação incompleta (gravação estragada) → não converte: manda o original
            if (segs < 0.3 || (durEsperada > 1.5 && segs < durEsperada * 0.6)) { console.warn('áudio: PCM curto', segs, durEsperada); return file; }
            var mono16 = paraInt16(reamostrar(pcm.mono, pcm.taxa, TAXA));
            var stem = String(file.name || 'audio').replace(/\.[^.]+$/, '');
            try {
                await carregarScript('lame.min.js');
                var b = mp3(mono16, TAXA);
                var dMp3 = await duracaoDe(b);
                if (b.size > 0 && (dMp3 < 0 || dMp3 >= segs * 0.8)) return new File([b], stem + '.mp3', { type: 'audio/mpeg' });
                console.warn('áudio: MP3 inválido', b.size, dMp3, segs);
            } catch (eMp3) { console.warn('mp3', eMp3); }
            if (pico > 0) return new File([wav(mono16, TAXA)], stem + '.wav', { type: 'audio/wav' });
            return file;
        } catch (e) {
            console.warn('áudio: conversão falhou, enviando original', e);
            return file;
        }
    }

    var cacheUrl = {};
    /** URL tocável (blob: WAV) para áudio que este navegador não toca. */
    function urlTocavel(src) {
        if (cacheUrl[src]) return cacheUrl[src];
        cacheUrl[src] = (async function () {
            var r = await fetch(src, { credentials: 'omit' }); if (!r.ok) throw new Error('HTTP ' + r.status);
            var ab = await r.arrayBuffer();
            var tipo = tipoPorBytes(new Uint8Array(ab, 0, Math.min(ab.byteLength, 8192)));
            if (tipo === 'audio/mpeg' || tipo === 'audio/mp4' || tipo === 'audio/wav') {
                var el = document.createElement('audio');
                if (el.canPlayType && el.canPlayType(tipo)) return URL.createObjectURL(new Blob([ab], { type: tipo }));
            }
            var pcm = await decodificarPcm(ab);
            var taxa = pcm.taxa > 24000 ? 24000 : pcm.taxa;
            return URL.createObjectURL(wav(paraInt16(reamostrar(pcm.mono, pcm.taxa, taxa)), taxa));
        })();
        cacheUrl[src].catch(function () { delete cacheUrl[src]; });
        return cacheUrl[src];
    }
    /** Este navegador provavelmente NÃO toca esse mime em <audio>? */
    function naoToca(mime, audioEl) {
        mime = baseMime(mime); if (!mime) return false;
        try { if (localStorage.getItem('minera_audio_compat_forcar') === '1' && precisaConverter(mime)) return true; } catch (e) { /* ignore */ }
        // iPhone/iPad: WebM/Ogg sempre pela conversão (canPlayType pode dizer "maybe" e mesmo assim falhar)
        if (precisaConverter(mime) && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return true;
        try { var a = audioEl || document.createElement('audio'); return !a.canPlayType || a.canPlayType(mime) === ''; } catch (e) { return false; }
    }
    /* 0,1 s de silêncio — "destrava" o <audio> no gesto do usuário (iOS) enquanto converte */
    var SILENCIO = (function () { try { return URL.createObjectURL(wav(new Int16Array(1600), 16000)); } catch (e) { return ''; } })();

    window.AudioCompat = {
        paraUniversal: paraUniversal, urlTocavel: urlTocavel, decodificarPcm: decodificarPcm,
        naoToca: naoToca, precisaConverter: precisaConverter, silencio: SILENCIO, _lerWebm: lerWebm, _decodeOpusWebm: decodeOpusWebm, _tipoPorBytes: tipoPorBytes
    };
})();
