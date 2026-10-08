/* Minera Pará — card "Novidade: Chat Minera na tela inicial" ao abrir o chat do app (chat.html).
 * No Chat Minera (/chat/, modo só-chat) não mostra nada: só marca que o app instalado já foi usado (standalone).
 * Regras: no máximo 1×/dia por usuário; "Agora não", X e ESC fecham só desta vez; "Não mostrar mais" marcado
 * (ou o chat instalado pelo instalador) = nunca mais para aquele usuário. Não aparece com conversa aberta
 * (link direto ?para=/?grupo=), gravando áudio, com a Nova conversa aberta nem para quem já usa o Chat Minera. */
(function () {
    'use strict';
    var K_USADO = 'minera_chat_app_usado';          // o /chat/ já abriu instalado (standalone) neste aparelho
    var K_INSTALADO = 'minera_chat_instalado';      // instalador: appinstalled neste aparelho
    function kNunca(uid) { return 'minera_chat_card_nunca_' + uid; }
    function kDia(uid) { return 'minera_chat_card_dia_' + uid; }
    function ls(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* ignore */ }
        return null;
    }
    function standalone() {
        try {
            return (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
        } catch (e) { return false; }
    }
    function hoje() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    if (window.MINERA_CHAT_APP === true) {
        if (standalone()) ls(K_USADO, '1');
        return;
    }

    function ocupado() {
        try {
            // eslint-disable-next-line no-undef
            if (typeof contatoAtivo !== 'undefined' && contatoAtivo) return true;
            // eslint-disable-next-line no-undef
            if (typeof gravando !== 'undefined' && gravando) return true;
        } catch (e) { /* ignore */ }
        var b = document.body;
        return !!(b && (b.classList.contains('chat-thread-open') || b.classList.contains('nc-aberta') || b.classList.contains('chat-gravando')));
    }
    function linkDireto() {
        return /[?&](com|para|dm|grupo|lote)=/.test(location.search || '');
    }

    var aberto = null;
    function fechar(nunca, uid) {
        if (!aberto) return;
        var marcado = nunca || !!(aberto.querySelector('#cn-nunca') || {}).checked;
        if (marcado && uid) ls(kNunca(uid), '1');
        document.removeEventListener('keydown', aberto._onKey, true);
        aberto.remove();
        aberto = null;
        document.body.classList.remove('cn-aberto');
    }

    function mostrar(uid) {
        if (aberto || document.getElementById('chat-novidade')) return;
        var root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
        var v = (window.MineraPwa && MineraPwa.assetV) || '';
        var el = document.createElement('div');
        el.id = 'chat-novidade';
        el.className = 'cn-modal';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'cn-tit');
        el.innerHTML =
            '<div class="cn-backdrop" aria-hidden="true"></div>' +
            '<div class="cn-card">' +
            '<button type="button" class="cn-x" id="cn-x" aria-label="Fechar">✕</button>' +
            '<img class="cn-ico" src="' + root + 'chat/icon-192.png' + (v ? '?v=' + v : '') + '" alt="" width="64" height="64">' +
            '<h2 class="cn-tit" id="cn-tit">📲 Novidade: Chat Minera na tela inicial</h2>' +
            '<p>Agora você pode ter o chat do Minera Pará direto na tela inicial do seu celular, igual ao WhatsApp. Com um toque você abre suas conversas, sem precisar entrar no site nem no app completo.</p>' +
            '<p>É o mesmo chat, com a mesma conta e as mesmas conversas. Tudo o que você manda por um aparece no outro na hora: mensagens, fotos e áudios.</p>' +
            '<p class="cn-como">Como colocar:</p>' +
            '<ul class="cn-lista">' +
            '<li><strong>Android:</strong> toque em Instalar e confirme.</li>' +
            '<li><strong>iPhone:</strong> toque em Compartilhar (o quadrado com a seta para cima), depois em Adicionar à Tela de Início e em Adicionar. No iPhone, você entra na sua conta uma vez dentro do Chat Minera.</li>' +
            '</ul>' +
            '<a class="cn-go" id="cn-go" href="' + root + 'chat/instalar.html">Colocar na tela inicial</a>' +
            '<button type="button" class="cn-depois" id="cn-depois">Agora não</button>' +
            '<label class="cn-nunca-lbl"><input type="checkbox" id="cn-nunca"> Não mostrar mais esta mensagem</label>' +
            '</div>';
        document.body.appendChild(el);
        document.body.classList.add('cn-aberto');
        aberto = el;
        ls(kDia(uid), hoje()); // mostrado hoje → só volta amanhã
        el.querySelector('#cn-x').addEventListener('click', function () { fechar(false, uid); });
        el.querySelector('#cn-depois').addEventListener('click', function () { fechar(false, uid); });
        el.querySelector('#cn-go').addEventListener('click', function () {
            // "Não mostrar mais" marcado vale também aqui; instalado → o instalador grava o "nunca mais" deste usuário
            if ((el.querySelector('#cn-nunca') || {}).checked) ls(kNunca(uid), '1');
            try { ls('minera_chat_last_uid', uid); } catch (e) { /* ignore */ }
        });
        el._onKey = function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); fechar(false, uid); } };
        document.addEventListener('keydown', el._onKey, true);
        try { el.querySelector('#cn-go').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }

    async function talvezMostrar() {
        try {
            if (linkDireto() || ocupado()) return;
            if (ls(K_USADO) === '1' || ls(K_INSTALADO) === '1') return;
            if (typeof supabaseClient === 'undefined') return;
            var r = await supabaseClient.auth.getSession();
            var uid = r && r.data && r.data.session && r.data.session.user ? r.data.session.user.id : null;
            if (!uid) return;
            if (ls(kNunca(uid)) === '1') return;
            if (ls(kDia(uid)) === hoje()) return;
            if (ocupado() || document.visibilityState === 'hidden') return;
            mostrar(uid);
        } catch (e) { /* nunca atrapalha o chat */ }
    }

    window.MineraChatNovidade = { talvezMostrar: talvezMostrar, fechar: function () { fechar(false, null); } };
    // espera o chat montar (sessão, lista); não disputa com link direto de conversa nem com o áudio
    if (document.readyState === 'complete') setTimeout(talvezMostrar, 1500);
    else window.addEventListener('load', function () { setTimeout(talvezMostrar, 1500); });
})();
