/**
 * Anti-golpe: bloqueia / mascara contato externo no chat e anúncios.
 * Negociações devem ficar no Minera Pará.
 */
(function (global) {
    'use strict';

    var MSG_BLOQUEIO =
        'Negociações devem ficar no Minera Pará. Não envie telefone, WhatsApp, Pix, e-mail ou links externos.';

    // Telefone BR formatado: +55, DDD, 8–9 dígitos com espaços/traços/parênteses
    var RE_PHONE =
        /(?:\+?\s*55\s*)?(?:\(?\s*\d{2}\s*\)?\s*)?(?:9\s*)?\d{4}\s*[\s.\-]?\s*\d{4}\b|(?:whats?\.?\s*app|zap|wpp|wa\.me)[\s:#\-]*[\d+().\s\-]{8,}/gi;

    // 8–11 dígitos consecutivos (ex.: 91253569) — códigos curtos 3–5 dígitos passam
    var RE_DIGIT_RUN = /\d{8,11}/g;

    // CPF 000.000.000-00 ou 11 dígitos consecutivos (contexto cpf)
    var RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
    var RE_CPF_LABEL = /\bcpf\b[\s:#\-]*\d{11}\b/gi;

    // CNPJ 00.000.000/0000-00
    var RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

    // Pix EVP UUID
    var RE_PIX_EVP = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

    // E-mail (também chave Pix e-mail)
    var RE_EMAIL = /\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/gi;

    // Links http(s) externos (exceto data: e paths relativos do app)
    var RE_HTTP = /https?:\/\/[^\s<>"']+/gi;

    // Domínios / handles sociais comuns
    var RE_SOCIAL =
        /(?:instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|tiktok\.com|t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|youtu\.be|linktr\.ee|bit\.ly|tinyurl\.com)[^\s<>"']*|(?:^|[\s])@[a-z0-9._]{3,}\b/gi;

    // Chave Pix telefone isolada (já coberta por RE_PHONE); label "pix:" + token
    var RE_PIX_LABEL = /\b(?:chave\s*)?pix\b[\s:#\-]+[^\s]{5,}/gi;

    // Intent keywords even WITHOUT phone digits (fala no whatsapp / me chama no zap)
    var RE_WA_INTENT =
        /\b(?:whats?\.?\s*app|zap|zapp|wpp|whts|telegram|só\s+no\s+zap|fala\s+no\s+whats?app|chama\s+no\s+zap|me\s+chama\s+no\s+zap)\b/i;

    var ALL_BLOCK = [
        RE_PHONE,
        RE_DIGIT_RUN,
        RE_CPF,
        RE_CPF_LABEL,
        RE_CNPJ,
        RE_PIX_EVP,
        RE_EMAIL,
        RE_HTTP,
        RE_SOCIAL,
        RE_PIX_LABEL,
        RE_WA_INTENT
    ];

    function resetFlags(re) {
        re.lastIndex = 0;
        return re;
    }

    /**
     * Dígitos misturados em token (ex.: Jhon09499ss53569 → 10 dígitos).
     * Também cobre telefone com separadores fracionados num mesmo "token" alfanumérico.
     */
    function contemDigitosMisturados(texto) {
        var s = String(texto == null ? '' : texto);
        // Tokens separados por espaço/pontuação leve; mantém letras+dígitos juntos
        var parts = s.split(/[\s,;:!?¡¿|/\\]+/);
        for (var i = 0; i < parts.length; i++) {
            var tok = parts[i];
            if (!tok || tok.length < 8) continue;
            var digits = tok.replace(/\D/g, '');
            // 8–13: celular local até +55+DDD+9 dígitos
            if (digits.length >= 8 && digits.length <= 13) return true;
        }
        // Sequência só com separadores de telefone (parênteses, traços, espaços)
        var onlyPhoneChars = s.replace(/[^\d+().\s\-]/g, ' ');
        var compact = onlyPhoneChars.replace(/[\s().+\-]/g, '');
        // Janelas de 8–11 dígitos consecutivos após remover separadores de grupos
        if (/\d{8,11}/.test(compact)) return true;
        return false;
    }

    function contemBloqueio(texto) {
        var s = String(texto == null ? '' : texto);
        if (!s.trim()) return false;
        for (var i = 0; i < ALL_BLOCK.length; i++) {
            var re = resetFlags(ALL_BLOCK[i]);
            if (re.test(s)) return true;
        }
        if (contemDigitosMisturados(s)) return true;
        return false;
    }

    function mascarar(texto) {
        var s = String(texto == null ? '' : texto);
        ALL_BLOCK.forEach(function (re) {
            s = s.replace(resetFlags(re), '[oculto]');
        });
        // Mascara tokens com 8+ dígitos embutidos (nome+telefone)
        s = s.replace(/[A-Za-zÀ-ÿ0-9._%+\-()]{8,}/g, function (tok) {
            var digits = tok.replace(/\D/g, '');
            if (digits.length >= 8 && digits.length <= 13) return '[oculto]';
            return tok;
        });
        return s;
    }

    /** Valida campos; retorna { ok, motivo, limpo } — limpo com mask se soft. */
    function validarTexto(texto, opts) {
        opts = opts || {};
        var s = String(texto == null ? '' : texto);
        if (!contemBloqueio(s)) {
            return { ok: true, motivo: null, limpo: s };
        }
        if (opts.strip) {
            return { ok: true, motivo: null, limpo: mascarar(s) };
        }
        return { ok: false, motivo: MSG_BLOQUEIO, limpo: s };
    }

    /** Storage público Supabase (fotos/vídeos de lote) — NÃO aplicar no texto do chat. */
    function isSupabaseStorageUrl(u) {
        var s = String(u == null ? '' : u);
        if (!s) return false;
        try {
            var url = new URL(s);
            if (!/\.supabase\.co$/i.test(url.hostname)) return false;
            return /\/storage\//i.test(url.pathname);
        } catch (e) {
            // fallback: hostname + path sem URL absoluta
            return /https?:\/\/[a-z0-9.-]+\.supabase\.co\/storage\//i.test(s);
        }
    }

    function isLoteMediaField(k) {
        return k === 'imagem_url' || k === 'video_url' || k === 'fotos' || k === 'fotos_json';
    }

    /** Valida vários campos de uma vez (lote). */
    function validarCampos(obj, keys, opts) {
        opts = opts || {};
        var out = Object.assign({}, obj);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (out[k] == null || out[k] === '') continue;
            // Mídia de lote: data: + *.supabase.co/storage — timestamps nos paths NÃO são telefone
            if (isLoteMediaField(k)) {
                var u = String(out[k]);
                if (u.indexOf('data:') === 0) continue;
                // Pode ser espaço-separado (várias fotos)
                var parts = u.split(/\s+/).filter(Boolean);
                var allOk = parts.every(function (part) {
                    if (part.indexOf('data:') === 0) return true;
                    if (isSupabaseStorageUrl(part)) return true;
                    return false;
                });
                if (allOk && parts.length) continue;
                // URL não-supabase: só bloquear se parecer contato (wa.me etc.)
                resetFlags(RE_SOCIAL); resetFlags(RE_EMAIL); resetFlags(RE_PHONE);
                if (RE_SOCIAL.test(u) || RE_EMAIL.test(u) || RE_PHONE.test(u)) {
                    resetFlags(RE_SOCIAL); resetFlags(RE_EMAIL); resetFlags(RE_PHONE);
                    if (opts.strip) {
                        out[k] = null;
                        continue;
                    }
                    return { ok: false, motivo: MSG_BLOQUEIO, campos: out };
                }
                resetFlags(RE_SOCIAL); resetFlags(RE_EMAIL); resetFlags(RE_PHONE);
                // Digit runs em path de storage já tratados; outras URLs de imagem passam
                continue;
            }
            var r = validarTexto(out[k], opts);
            if (!r.ok) return { ok: false, motivo: r.motivo, campos: out };
            out[k] = r.limpo;
        }
        return { ok: true, motivo: null, campos: out };
    }

    global.AntiGolpe = {
        MSG_BLOQUEIO: MSG_BLOQUEIO,
        contemBloqueio: contemBloqueio,
        mascarar: mascarar,
        validarTexto: validarTexto,
        validarCampos: validarCampos,
        isSupabaseStorageUrl: isSupabaseStorageUrl
    };
})(typeof window !== 'undefined' ? window : this);
