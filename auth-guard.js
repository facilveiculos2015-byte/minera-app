/** Sessão + perfil (usuarios.auth_id) + roles */

async function requireSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        irPara('index.html');
        return null;
    }
    return session;
}

async function getPerfil(session) {
    if (!session || !session.user) return null;
    const uid = session.user.id;
    const email = session.user.email || '';
    const metaNome = (session.user.user_metadata && session.user.user_metadata.nome) || '';

    try {
        const { data, error } = await supabaseClient
            .from('usuarios')
            .select('*')
            .eq('auth_id', uid)
            .maybeSingle();
        if (error) console.warn('getPerfil:', error.message);
        if (data) {
            return {
                id: data.id,
                auth_id: data.auth_id,
                nome: data.nome || metaNome || email,
                email: data.email || email,
                tipo: data.tipo || 'operador'
            };
        }
    } catch (e) {
        console.warn(e);
    }

    // Fallback: tenta por e-mail e vincula auth_id
    try {
        const { data: byEmail } = await supabaseClient
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (byEmail) {
            if (!byEmail.auth_id) {
                await supabaseClient.from('usuarios').update({ auth_id: uid }).eq('id', byEmail.id);
            }
            return {
                id: byEmail.id,
                auth_id: uid,
                nome: byEmail.nome || metaNome || email,
                email: byEmail.email || email,
                tipo: byEmail.tipo || 'operador'
            };
        }
    } catch (e) {
        console.warn(e);
    }

    return {
        id: null,
        auth_id: uid,
        nome: metaNome || email,
        email,
        tipo: 'operador'
    };
}

async function requireRole(perfil, rolesPermitidos) {
    const ok = rolesPermitidos.map(r => String(r).toLowerCase());
    const tipo = (perfil && perfil.tipo ? String(perfil.tipo) : 'operador').toLowerCase();
    if (!ok.includes(tipo)) {
        alert('Acesso restrito. Seu perfil: ' + tipo);
        irPara('inicio.html');
        return false;
    }
    return true;
}

function aplicarUserLabel(perfil) {
    const el = document.getElementById('user-label');
    if (!el || !perfil) return;
    const role = perfil.tipo || 'operador';
    el.textContent = 'Olá, ' + (perfil.nome || perfil.email) + ' · ' + role;
}

async function sairApp() {
    await supabaseClient.auth.signOut();
    irPara('index.html');
}

async function registrarLog(acao, detalhes, perfil) {
    try {
        await supabaseClient.from('logs_sistema').insert([{
            usuario_id: perfil && perfil.id ? perfil.id : null,
            acao,
            detalhes: detalhes || null
        }]);
    } catch (e) {
        console.warn('log:', e);
    }
}
