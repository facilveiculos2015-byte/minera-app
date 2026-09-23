
const WELCOME_SEEN_KEY = 'minera_welcome_seen';

function welcomeJaVisto() {
    try { return sessionStorage.getItem(WELCOME_SEEN_KEY) === '1'; } catch (e) { return false; }
}
function marcarWelcomeVisto() {
    try { sessionStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch (e) { /* ignore */ }
}
function revelarAuthAposWelcome() {
    const w = document.getElementById('welcome-card');
    const a = document.getElementById('auth-card');
    if (w) w.classList.add('oculto');
    if (a) a.classList.remove('oculto');
    marcarWelcomeVisto();
}
function setupWelcomeGate() {
    const w = document.getElementById('welcome-card');
    const a = document.getElementById('auth-card');
    if (!w || !a) return;
    if (typeof modoRecuperacao !== 'undefined' && modoRecuperacao) {
        w.classList.add('oculto');
        a.classList.remove('oculto');
        return;
    }
    if (welcomeJaVisto()) {
        w.classList.add('oculto');
        a.classList.remove('oculto');
        return;
    }
    w.classList.remove('oculto');
    a.classList.add('oculto');
    const btn = document.getElementById('btn-welcome-continuar');
    if (btn && !btn._welcomeBound) {
        btn._welcomeBound = true;
        btn.addEventListener('click', revelarAuthAposWelcome);
    }
}

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

async function upsertUsuarioPerfil(user, nome, papeis, apelido) {
    if (!user || !user.id) return;
    const row = {
        auth_id: user.id,
        nome: nome || (user.user_metadata && user.user_metadata.nome) || 'Usuário',
        email: user.email,
        senha_hash: 'supabase-auth'
    };
    const ap = (apelido != null ? apelido : (user.user_metadata && user.user_metadata.apelido)) || '';
    if (String(ap).trim()) row.apelido = String(ap).trim();
    // Só grava tipo/papeis no CADASTRO (papeis explícito). No login NÃO enviar —
    // senão sobrescreve admin → operador e apaga o menu Admin.
    if (Array.isArray(papeis)) {
        row.papeis = papeis;
        row.tipo = papeis.includes('admin') ? 'admin' : 'operador';
    }
    // Conflict target MUST be auth_id only — never overwrite another profile by email/id
    const { error } = await supabaseClient
        .from('usuarios')
        .upsert(row, { onConflict: 'auth_id' });
    if (error) {
        console.warn('upsert auth_id:', error.message);
        const { data: own } = await supabaseClient
            .from('usuarios')
            .select('id, auth_id')
            .eq('auth_id', user.id)
            .maybeSingle();
        if (own && own.auth_id === user.id) {
            const upd = {
                nome: row.nome,
                email: row.email,
                senha_hash: 'supabase-auth'
            };
            if (row.apelido) upd.apelido = row.apelido;
            if (Array.isArray(papeis)) {
                upd.papeis = row.papeis;
                upd.tipo = row.tipo;
            }
            const { error: updErr } = await supabaseClient
                .from('usuarios')
                .update(upd)
                .eq('auth_id', user.id);
            if (updErr) console.warn('update own usuario:', updErr.message);
        } else {
            // Insert sem papeis: defaults do banco (tipo operador, papeis {})
            const ins = Object.assign({}, row);
            if (!Array.isArray(papeis)) {
                ins.tipo = 'operador';
                ins.papeis = [];
            }
            const { error: insErr } = await supabaseClient.from('usuarios').insert([ins]);
            if (insErr) console.warn('insert usuario:', insErr.message);
        }
    }
}

async function irSeLogado() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;
        let dest = 'inicio.html';
        if (typeof destinoPosLogin === 'function') {
            dest = await destinoPosLogin(session.user);
        }
        irPara(dest);
    } catch (e) {
        console.error(e);
    }
}

function urlIndicaRecuperacao() {
    try {
        const hash = (window.location.hash || '').replace(/^#/, '');
        const hp = new URLSearchParams(hash);
        if ((hp.get('type') || '').toLowerCase() === 'recovery') return true;
        const q = new URLSearchParams(window.location.search || '');
        if ((q.get('type') || '').toLowerCase() === 'recovery') return true;
    } catch (e) { /* ignore */ }
    return false;
}

function limparHashAuth() {
    try {
        if (window.history && history.replaceState) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    } catch (e) { /* ignore */ }
}

function mostrarFormNovaSenha() {
    const wc = document.getElementById('welcome-card');
    if (wc) wc.classList.add('oculto');
    const ac = document.getElementById('auth-card');
    if (ac) ac.classList.remove('oculto');
    const tabs = document.querySelector('.tabs');
    if (tabs) tabs.classList.add('oculto');
    const welcome = document.getElementById('cadastro-welcome');
    if (welcome) welcome.classList.add('oculto');
    const fe = document.getElementById('form-entrar');
    const fc = document.getElementById('form-cadastrar');
    const fn = document.getElementById('form-nova-senha');
    if (fe) { fe.classList.add('oculto'); fe.style.display = 'none'; }
    if (fc) { fc.classList.add('oculto'); fc.style.display = 'none'; }
    if (fn) {
        fn.classList.remove('oculto');
        fn.style.display = 'flex';
        const p1 = document.getElementById('nova-senha');
        setTimeout(() => p1 && p1.focus(), 50);
    }
    const h = document.querySelector('.auth-header p');
    if (h) h.textContent = 'Defina uma nova senha para continuar';
}

let modoRecuperacao = false;

function entrarModoRecuperacao() {
    if (modoRecuperacao) return;
    modoRecuperacao = true;
    mostrarFormNovaSenha();
    msg('Link de recuperação válido. Escolha sua nova senha.', true);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('tab-entrar').addEventListener('click', () => mostrarAba('entrar'));
    document.getElementById('tab-cadastrar').addEventListener('click', () => mostrarAba('cadastrar'));

    // Recovery: Supabase redireciona com hash type=recovery e dispara PASSWORD_RECOVERY
    try {
        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') entrarModoRecuperacao();
        });
    } catch (e) { console.warn(e); }
    if (urlIndicaRecuperacao()) entrarModoRecuperacao();

    document.getElementById('btn-esqueci').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        if (!email) {
            msg('Preencha o e-mail acima para recuperar a senha.', false);
            document.getElementById('login-email').focus();
            return;
        }
        msg('Enviando e-mail de recuperação...', true);
        try {
            const root = (typeof APP_ROOT !== 'undefined' ? APP_ROOT : '/minera-app/');
            const redirectTo = window.location.origin + root + 'index.html';
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

    const formNova = document.getElementById('form-nova-senha');
    if (formNova) {
        formNova.addEventListener('submit', async (e) => {
            e.preventDefault();
            const s1 = (document.getElementById('nova-senha') || {}).value || '';
            const s2 = (document.getElementById('nova-senha-confirma') || {}).value || '';
            if (s1.length < 6) {
                msg('A senha deve ter no mínimo 6 caracteres.', false);
                return;
            }
            if (s1 !== s2) {
                msg('As senhas não coincidem.', false);
                return;
            }
            msg('Salvando nova senha...', true);
            try {
                const { error } = await supabaseClient.auth.updateUser({ password: s1 });
                if (error) {
                    msg('Erro ao atualizar senha: ' + error.message, false);
                    return;
                }
                limparHashAuth();
                msg('Senha atualizada! Entrando...', true);
                setTimeout(() => irPara('inicio.html'), 600);
            } catch (err) {
                msg('Falha: ' + (err.message || err), false);
            }
        });
    }

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
            // Sem papeis: preserva tipo/admin já gravados no banco
            await upsertUsuarioPerfil(data.user, data.user.user_metadata && data.user.user_metadata.nome);
            let dest = 'inicio.html';
            if (typeof destinoPosLogin === 'function') {
                dest = await destinoPosLogin(data.user);
            }
            irPara(dest);
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no login: ' + (err.message || err), false);
        }
    });

    document.getElementById('form-cadastrar').addEventListener('submit', async (e) => {
        e.preventDefault();
        msg('Criando conta...', true);
        const nome = document.getElementById('cad-nome').value.trim();
        const apelidoEl = document.getElementById('cad-apelido');
        const apelido = apelidoEl ? apelidoEl.value.trim() : '';
        const email = document.getElementById('cad-email').value.trim();
        const password = document.getElementById('cad-senha').value;
        const papeis = lerPapeisCadastro();
        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { nome, papeis, apelido } }
            });
            if (error) {
                msg('Erro no cadastro: ' + error.message, false);
                return;
            }
            if (data.user) {
                await upsertUsuarioPerfil(data.user, nome, papeis, apelido);
                if (typeof processarIndicacaoNoCadastro === 'function') {
                    await processarIndicacaoNoCadastro(data.user, nome);
                }
                // Garante código de indicação do novo usuário
                let perfilNovo = { auth_id: data.user.id, nome: nome, apelido: apelido };
                if (typeof garantirCodigoIndicacao === 'function') {
                    perfilNovo = await garantirCodigoIndicacao(perfilNovo) || perfilNovo;
                }
                if (!data.session && typeof mostrarSharePosCadastro === 'function' && perfilNovo.codigo_indicacao) {
                    if (typeof carregarShareFlags === 'function') await carregarShareFlags();
                    mostrarSharePosCadastro(perfilNovo);
                }
            }
            if (data.session) {
                irPara('inicio.html');
                return;
            }
            document.getElementById('login-email').value = email;
            document.getElementById('login-senha').value = password;
            mostrarAba('entrar');
            msg('Conta criada. Confira e-mail e senha abaixo e aperte Entrar. Você já pode compartilhar seu convite abaixo.', true);
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no cadastro: ' + (err.message || err), false);
        }
    });

    if (typeof capturarRefUrl === 'function') capturarRefUrl();
    // Convite /c/CODIGO ou ?ref= → welcome + aba cadastro (exceto recuperação)
    const convite = (typeof temConviteIndicacao === 'function')
        ? temConviteIndicacao()
        : (() => {
            try {
                const q = new URLSearchParams(window.location.search);
                return !!(q.get('ref') || q.get('c') || q.get('welcome') === '1');
            } catch (e) { return false; }
        })();
    if (convite) {
        try { sessionStorage.removeItem(WELCOME_SEEN_KEY); } catch (e) { /* ignore */ }
        const wc = document.getElementById('welcome-card');
        if (wc) {
            const title = document.getElementById('welcome-title');
            if (title) title.textContent = 'Bem-vindo à Família Mineira';
            const ps = wc.querySelectorAll('p');
            if (ps[0]) {
                ps[0].textContent = 'Você foi convidado(a) para o Minera Pará. Crie sua conta para entrar no marketplace, frete, britagem e Bank — com segurança e renda extra na Família Mineira.';
            }
        }
        const cadWel = document.getElementById('cadastro-welcome');
        if (cadWel) {
            const codigo = (typeof lerRefSalvo === 'function' ? lerRefSalvo() : '') || '';
            const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[c]);
            cadWel.innerHTML =
                '<strong>Convite Família Mineira' + (codigo ? ' · ' + esc(codigo) : '') + '</strong>' +
                '<p>Ao criar a conta por este link, você entra na rede de indicação. Negocie no app (anti-golpe) e evite combinar pagamento só por WhatsApp.</p>';
        }
    }
    if (!modoRecuperacao) {
        try {
            if (convite) mostrarAba('cadastrar');
            else mostrarAba('entrar');
        } catch (e) {
            mostrarAba('entrar');
        }
        irSeLogado();
    }
    try { setupWelcomeGate(); } catch (e) { console.warn('welcome', e); }
});
