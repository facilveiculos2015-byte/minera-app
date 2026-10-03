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
    function lerWebm(b) {
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
                if (tr) { var q = ini + tr.n + 2, flags = b[q]; q += 1; if (((flags >> 1) & 3) === 0 && q < f2) frames.push(b.slice(q, f2)); }
            }
            p = f2;
        }
        return { frames: frames, canais: canais, preSkip: preSkip };
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
    async function decodificarPcm(ab) {
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

    async function paraUniversal(file) {
        try {
            if (!file || !precisaConverter(file.type)) return file;
            var ab = await file.arrayBuffer();
            var pcm = await decodificarPcm(ab);
            var mono16 = paraInt16(reamostrar(pcm.mono, pcm.taxa, TAXA));
            if (!mono16.length) return file;
            var stem = String(file.name || 'audio').replace(/\.[^.]+$/, '');
            try {
                await carregarScript('lame.min.js');
                var b = mp3(mono16, TAXA);
                if (b.size > 0) return new File([b], stem + '.mp3', { type: 'audio/mpeg' });
            } catch (eMp3) { console.warn('mp3', eMp3); }
            return new File([wav(mono16, TAXA)], stem + '.wav', { type: 'audio/wav' });
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
            var pcm = await decodificarPcm(await r.arrayBuffer());
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
        try { var a = audioEl || document.createElement('audio'); return !a.canPlayType || a.canPlayType(mime) === ''; } catch (e) { return false; }
    }
    /* 0,1 s de silêncio — "destrava" o <audio> no gesto do usuário (iOS) enquanto converte */
    var SILENCIO = (function () { try { return URL.createObjectURL(wav(new Int16Array(1600), 16000)); } catch (e) { return ''; } })();

    window.AudioCompat = {
        paraUniversal: paraUniversal, urlTocavel: urlTocavel, decodificarPcm: decodificarPcm,
        naoToca: naoToca, precisaConverter: precisaConverter, silencio: SILENCIO, _lerWebm: lerWebm, _decodeOpusWebm: decodeOpusWebm
    };
})();
