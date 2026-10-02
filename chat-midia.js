/* Minera Pará — mídia do chat: compressão de imagem, upload no Storage
 * (bucket chat-midia) e utilitários de MIME. NUNCA grava data-URL na mensagem:
 * se o upload falhar, a mensagem fica "falhou" com ↻ para reenviar.
 */
(function () {
    'use strict';

    /** MIME sem ";codecs=..." (o Storage rejeita alguns). */
    function baseMime(t) { return String(t || '').split(';')[0].trim().toLowerCase(); }

    function extForMime(mime, fallback) {
        var m = baseMime(mime);
        var map = {
            'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'video/ogg': 'ogg',
            'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
            'audio/wav': 'wav', 'audio/wave': 'wav', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
            'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'application/pdf': 'pdf'
        };
        return map[m] || fallback || 'bin';
    }

    function pickRecorderMime() {
        if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        var ua = navigator.userAgent || '';
        var apple = /iPhone|iPad|iPod/i.test(ua) || (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/i.test(ua));
        var lista = apple
            ? ['audio/mp4', 'audio/aac', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
            : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/aac'];
        for (var i = 0; i < lista.length; i++) {
            try { if (MediaRecorder.isTypeSupported(lista[i])) return lista[i]; } catch (e) { /* ignore */ }
        }
        return '';
    }

    function mimeFromMediaUrl(url) {
        var s = String(url || '');
        if (s.indexOf('data:audio/') === 0) return baseMime(s.slice(5).split(',')[0]);
        var u = s.split(/[?#]/)[0].toLowerCase();
        if (/\.webm$/.test(u)) return 'audio/webm';
        if (/\.ogg$/.test(u)) return 'audio/ogg';
        if (/\.(m4a|mp4)$/.test(u)) return 'audio/mp4';
        if (/\.(mp3|mpeg)$/.test(u)) return 'audio/mpeg';
        if (/\.wav$/.test(u)) return 'audio/wav';
        return '';
    }

    /**
     * Compressão: maior lado ≤ 1600 px, JPEG q=0.8. GIF não mexe (animação).
     * Se já for pequena (≤ 350 KB e ≤ 1600 px) devolve o original.
     * Retorna { file, w, h, antes, depois }.
     */
    async function comprimirImagem(file, maxLado, qualidade) {
        maxLado = maxLado || 1600; qualidade = qualidade || 0.8;
        var antes = file.size;
        var mime = baseMime(file.type);
        if (!/^image\//.test(mime) || mime === 'image/gif' || mime === 'image/svg+xml') return { file: file, antes: antes, depois: antes };
        var bmp = null, w = 0, h = 0, fonte = null;
        try {
            if (window.createImageBitmap) {
                try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e1) { bmp = await createImageBitmap(file); }
                w = bmp.width; h = bmp.height; fonte = bmp;
            }
        } catch (e) { bmp = null; }
        if (!fonte) {
            var url = URL.createObjectURL(file);
            try {
                fonte = await new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = url; });
                w = fonte.naturalWidth; h = fonte.naturalHeight;
            } catch (e2) { URL.revokeObjectURL(url); return { file: file, antes: antes, depois: antes }; }
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }
        if (!w || !h) return { file: file, antes: antes, depois: antes };
        var escala = Math.min(1, maxLado / Math.max(w, h));
        if (escala === 1 && antes <= 350000) { if (bmp && bmp.close) bmp.close(); return { file: file, w: w, h: h, antes: antes, depois: antes }; }
        var cw = Math.round(w * escala), ch = Math.round(h * escala);
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; // PNG transparente → fundo branco no JPEG
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(fonte, 0, 0, cw, ch);
        if (bmp && bmp.close) bmp.close();
        var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', qualidade); });
        if (!blob || blob.size >= antes) return { file: file, w: w, h: h, antes: antes, depois: antes };
        var nome = String(file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
        return { file: new File([blob], nome, { type: 'image/jpeg' }), w: cw, h: ch, antes: antes, depois: blob.size };
    }

    /** Upload no bucket chat-midia (pasta do usuário). Lança erro se falhar. */
    async function upload(file, pasta, uid) {
        var mime = baseMime(file.type) || (pasta === 'audios' ? 'audio/webm' : 'application/octet-stream');
        var ext = extForMime(mime, String(file.name || '').split('.').pop() || 'bin');
        var stem = String(file.name || 'arquivo').replace(/\.[^.]+$/, '').replace(/[^\w.\-]/g, '_').slice(0, 40) || 'arquivo';
        var path = (uid || 'anon') + '/' + (pasta || 'geral') + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + stem + '.' + ext;
        var payload = file;
        try { if (baseMime(file.type) !== mime || /;/.test(String(file.type || ''))) payload = new File([file], stem + '.' + ext, { type: mime }); } catch (e) { /* ignore */ }
        var r = await supabaseClient.storage.from('chat-midia').upload(path, payload, { upsert: false, contentType: mime, cacheControl: '31536000' });
        if (r.error) throw r.error;
        var pub = supabaseClient.storage.from('chat-midia').getPublicUrl((r.data && r.data.path) || path);
        if (!pub || !pub.data || !pub.data.publicUrl) throw new Error('Upload sem URL pública');
        return pub.data.publicUrl;
    }

    function pastaPara(tipo) {
        return tipo === 'imagem' ? 'imagens' : tipo === 'video' ? 'videos' : tipo === 'audio' ? 'audios' : 'docs';
    }

    window.ChatMidia = {
        baseMime: baseMime, extForMime: extForMime, pickRecorderMime: pickRecorderMime,
        mimeFromMediaUrl: mimeFromMediaUrl, comprimirImagem: comprimirImagem, upload: upload, pastaPara: pastaPara
    };
})();
