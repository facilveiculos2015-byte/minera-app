let perfilAtual = null;
let pollTimer = null;
let meuAuthId = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function carregarChat() {
    const box = document.getElementById('chat-msgs');
    try {
        const { data, error } = await supabaseClient
            .from('chat_mensagens')
            .select('*')
            .order('criado_em', { ascending: true })
            .limit(200);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhuma mensagem ainda. Diga oi!</p>';
            return;
        }
        box.innerHTML = data.map(m => {
            const mine = m.de_auth_id && m.de_auth_id === meuAuthId;
            const when = m.criado_em ? new Date(m.criado_em).toLocaleString('pt-BR') : '';
            return `<div class="bubble ${mine ? 'mine' : 'theirs'}">
                <div class="bubble-meta">${esc(m.de_nome || 'Alguém')} · ${when}</div>
                <div class="bubble-text">${esc(m.texto)}</div>
            </div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Chat indisponível: ' + esc(err.message) +
            '. Rode o SQL 06-minera-completo.sql no Supabase.</p>';
    }
}

document.getElementById('form-chat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-texto');
    const texto = input.value.trim();
    if (!texto) return;
    const msgEl = document.getElementById('chat-msg');
    const { error } = await supabaseClient.from('chat_mensagens').insert([{
        de_auth_id: meuAuthId,
        de_nome: (perfilAtual && perfilAtual.nome) || 'Usuário',
        texto
    }]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    msgEl.textContent = '';
    input.value = '';
    await carregarChat();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    meuAuthId = session.user.id;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('chat');
    await carregarChat();
    pollTimer = setInterval(carregarChat, 4000);
})();

window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
});
