const PAPEIS_OPCOES = [
    { id: 'minerador', label: 'Minerador' },
    { id: 'comprador', label: 'Comprador' },
    { id: 'transportador_mina_britador', label: 'Transportador (Mina - Britador)' },
    { id: 'transportador_britador_porto', label: 'Transportador (Britador - Porto)' },
    { id: 'dono_britador', label: 'Dono de Britador' },
    { id: 'carregamento', label: 'Operador de Carregamento' }
];

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
    const welcome = document.getElementById('cadastro-welcome');
    if (welcome) welcome.classList.toggle('oculto', entrar);
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

function lerPapeisCadastro() {
    return PAPEIS_OPCOES
        .map(p => p.id)
        .filter(id => {
            const el = document.getElementById('papel-' + id);
            return el && el.checked;
        });
}

async function upsertUsuarioPerfil(user, nome, papeis) {
    if (!user) return;
    const row = {
        auth_id: user.id,
        nome: nome || (user.user_metadata && user.user_metadata.nome) || user.email || 'Usuário',
        email: user.email,
        tipo: (Array.isArray(papeis) && papeis.includes('admin')) ? 'admin' : 'operador',
        senha_hash: 'supabase-auth'
    };
    if (Array.isArray(papeis)) {
        row.papeis = papeis;
    }
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
            const upd = {
                auth_id: user.id,
                nome: row.nome,
                senha_hash: 'supabase-auth'
            };
            if (Array.isArray(papeis)) {
                upd.papeis = papeis;
                upd.tipo = row.tipo;
            }
            await supabaseClient.from('usuarios').update(upd).eq('id', existing.id);
        } else {
            if (!Array.isArray(row.papeis)) row.papeis = [];
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

    document.getElementById('btn-esqueci').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        if (!email) {
            msg('Preencha o e-mail acima para recuperar a senha.', false);
            document.getElementById('login-email').focus();
            return;
        }
        msg('Enviando e-mail de recuperação...', true);
        try {
            const redirectTo = window.location.origin + APP_ROOT + 'index.html';
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
            if (error) {
                msg('Erro: ' + error.message, false);
                return;
            }
            msg('Se este e-mail existir, enviamos um link para redefinir a senha. Confira a caixa de entrada.', true);
        } catch (err) {
            msg('Falha ao enviar: ' + (err.message || err), false);
        }
    });

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
        const papeis = lerPapeisCadastro();
        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { nome, papeis } }
            });
            if (error) {
                msg('Erro no cadastro: ' + error.message, false);
                return;
            }
            if (data.user) {
                await upsertUsuarioPerfil(data.user, nome, papeis);
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
