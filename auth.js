// Base da pasta do app (funciona no GitHub Pages com /minera-app/)

function mostrarAba(nome) {
    const entrar = nome === 'entrar';
    const formEntrar = document.getElementById('form-entrar');
    const formCad = document.getElementById('form-cadastrar');
    formEntrar.classList.toggle('oculto', !entrar);
    formCad.classList.toggle('oculto', entrar);
    formEntrar.style.display = entrar ? 'flex' : 'none';
    formCad.style.display = entrar ? 'none' : 'flex';
    document.getElementById('tab-entrar').classList.toggle('on', entrar);
    document.getElementById('tab-cadastrar').classList.toggle('on', !entrar);
    document.getElementById('auth-msg').textContent = '';
    if (entrar) {
        const email = document.getElementById('login-email');
        setTimeout(() => email && email.focus(), 50);
    }
}

function msg(texto, ok) {
    const el = document.getElementById('auth-msg');
    el.textContent = texto;
    el.className = 'msg ' + (ok ? 'ok' : 'erro');
}

async function irSeLogado() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) irPara('inicio.html');
    } catch (e) {
        console.error(e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tab-entrar').addEventListener('click', () => mostrarAba('entrar'));
    document.getElementById('tab-cadastrar').addEventListener('click', () => mostrarAba('cadastrar'));

    document.getElementById('form-entrar').addEventListener('submit', async (e) => {
        e.preventDefault();
        msg('Entrando...', true);
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-senha').value;
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                msg(error.message === 'Invalid login credentials'
                    ? 'E-mail ou senha incorretos. Confira se já criou a conta e se a senha está certa.'
                    : ('Erro: ' + error.message), false);
                return;
            }
            if (!data.session) {
                msg('Login sem sessão. Tente de novo.', false);
                return;
            }
            irPara('inicio.html');
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no login: ' + (err.message || err), false);
        }
    });

    document.getElementById('form-cadastrar').addEventListener('submit', async (e) => {
        e.preventDefault();
        msg('Criando conta...', true);
        const nome = document.getElementById('cad-nome').value.trim();
        const email = document.getElementById('cad-email').value.trim();
        const password = document.getElementById('cad-senha').value;
        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { nome } }
            });
            if (error) {
                msg('Erro no cadastro: ' + error.message, false);
                return;
            }
            if (data.session) {
                irPara('inicio.html');
                return;
            }
            // Conta criada sem sessão: preenche Entrar e troca a aba
            document.getElementById('login-email').value = email;
            document.getElementById('login-senha').value = password;
            mostrarAba('entrar');
            msg('Conta criada. Confira e-mail e senha abaixo e aperte Entrar de novo.', true);
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no cadastro: ' + (err.message || err), false);
        }
    });

    // estado inicial das abas
    mostrarAba('entrar');
    irSeLogado();
});
