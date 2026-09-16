function mostrarAba(nome) {
    const entrar = nome === 'entrar';
    document.getElementById('form-entrar').classList.toggle('oculto', !entrar);
    document.getElementById('form-cadastrar').classList.toggle('oculto', entrar);
    document.getElementById('tab-entrar').classList.toggle('on', entrar);
    document.getElementById('tab-cadastrar').classList.toggle('on', !entrar);
    document.getElementById('auth-msg').textContent = '';
}

function msg(texto, ok) {
    const el = document.getElementById('auth-msg');
    el.textContent = texto;
    el.className = 'msg ' + (ok ? 'ok' : 'erro');
}

async function irSeLogado() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) window.location.href = 'lotes.html';
}

document.getElementById('form-entrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg('Entrando...', true);
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-senha').value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        msg(error.message === 'Invalid login credentials'
            ? 'E-mail ou senha incorretos.'
            : error.message, false);
        return;
    }
    window.location.href = 'lotes.html';
});

document.getElementById('form-cadastrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg('Criando conta...', true);
    const nome = document.getElementById('cad-nome').value.trim();
    const email = document.getElementById('cad-email').value.trim();
    const password = document.getElementById('cad-senha').value;
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { nome } }
    });
    if (error) {
        msg(error.message, false);
        return;
    }
    if (data.session) {
        window.location.href = 'lotes.html';
        return;
    }
    // sem sessão = confirmação de e-mail ligada
    msg('Conta criada. Se pedir confirmação de e-mail, confirme e depois entre. Se o projeto estiver sem confirmação, tente Entrar.', true);
    mostrarAba('entrar');
});

irSeLogado();
