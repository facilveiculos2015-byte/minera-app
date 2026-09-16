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

async function upsertUsuarioPerfil(user, nome) {
    if (!user) return;
    const row = {
        auth_id: user.id,
        nome: nome || (user.user_metadata && user.user_metadata.nome) || user.email || 'Usuário',
        email: user.email,
        tipo: 'operador',
        senha_hash: 'supabase-auth'
    };
    // Tenta upsert por auth_id; se falhar (sem unique match), tenta insert / update por email
    const { error } = await supabaseClient
        .from('usuarios')
        .upsert(row, { onConflict: 'auth_id' });
    if (error) {
        console.warn('upsert auth_id:', error.message);
        const { data: existing } = await supabaseClient
            .from('usuarios')
            .select('id')
            .eq('email', user.email)
            .maybeSingle();
        if (existing) {
            await supabaseClient.from('usuarios').update({
                auth_id: user.id,
                nome: row.nome,
                senha_hash: 'supabase-auth'
            }).eq('id', existing.id);
        } else {
            const { error: insErr } = await supabaseClient.from('usuarios').insert([row]);
            if (insErr) console.warn('insert usuario:', insErr.message);
        }
    }
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
            await upsertUsuarioPerfil(data.user, data.user.user_metadata && data.user.user_metadata.nome);
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
            if (data.user) {
                await upsertUsuarioPerfil(data.user, nome);
            }
            if (data.session) {
                irPara('inicio.html');
                return;
            }
            document.getElementById('login-email').value = email;
            document.getElementById('login-senha').value = password;
            mostrarAba('entrar');
            msg('Conta criada. Confira e-mail e senha abaixo e aperte Entrar.', true);
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no cadastro: ' + (err.message || err), false);
        }
    });

    mostrarAba('entrar');
    irSeLogado();
});
