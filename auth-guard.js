/** Sessão + perfil (usuarios.auth_id) + papéis múltiplos */

async function requireSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        irPara('index.html');
        return null;
    }
    return session;
}

function normalizarPapeis(raw, tipo) {
    let arr = [];
    if (Array.isArray(raw)) {
        arr = raw.map(p => String(p).toLowerCase().trim()).filter(Boolean);
    } else if (typeof raw === 'string' && raw.trim()) {
        // fallback se vier como "{a,b}" do pg
        arr = raw.replace(/[{}]/g, '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    }
    const t = (tipo || '').toLowerCase();
    if (t === 'admin' && !arr.includes('admin')) arr.push('admin');
    return arr;
}

function temPapel(perfil, role) {
    if (!perfil || !role) return false;
    const r = String(role).toLowerCase();
    if (ehAdmin(perfil)) return true;
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis : [];
    return papeis.map(p => String(p).toLowerCase()).includes(r);
}

function ehAdmin(perfil) {
    if (!perfil) return false;
    if ((perfil.tipo || '').toLowerCase() === 'admin') return true;
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis : [];
    return papeis.map(p => String(p).toLowerCase()).includes('admin');
}

function rotuloPapeis(perfil) {
    if (!perfil) return '';
    if (ehAdmin(perfil)) return 'admin';
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis : [];
    if (!papeis.length) return perfil.tipo || 'operador';
    const labels = {
        minerador: 'minerador',
        comprador: 'comprador',
        transportador: 'transportador',
        dono_britador: 'dono britador',
        carregamento: 'carregamento',
        admin: 'admin'
    };
    return papeis.map(p => labels[p] || p).join(', ');
}

async function getPerfil(session) {
    if (!session || !session.user) return null;
    const uid = session.user.id;
    const email = session.user.email || '';
    const metaNome = (session.user.user_metadata && session.user.user_metadata.nome) || '';

    function mapRow(data) {
        return {
            id: data.id,
            auth_id: data.auth_id || uid,
            nome: data.nome || metaNome || email,
            email: data.email || email,
            tipo: data.tipo || 'operador',
            papeis: normalizarPapeis(data.papeis, data.tipo)
        };
    }

    try {
        const { data, error } = await supabaseClient
            .from('usuarios')
            .select('*')
            .eq('auth_id', uid)
            .maybeSingle();
        if (error) console.warn('getPerfil:', error.message);
        if (data) return mapRow(data);
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
            return mapRow(Object.assign({}, byEmail, { auth_id: uid }));
        }
    } catch (e) {
        console.warn(e);
    }

    return {
        id: null,
        auth_id: uid,
        nome: metaNome || email,
        email,
        tipo: 'operador',
        papeis: []
    };
}

async function requireRole(perfil, rolesPermitidos) {
    const ok = rolesPermitidos.map(r => String(r).toLowerCase());
    if (ehAdmin(perfil)) return true;
    const papeis = (perfil && Array.isArray(perfil.papeis) ? perfil.papeis : [])
        .map(p => String(p).toLowerCase());
    const tipo = (perfil && perfil.tipo ? String(perfil.tipo) : 'operador').toLowerCase();
    const hit = ok.some(r => papeis.includes(r) || r === tipo);
    if (!hit) {
        alert('Acesso restrito. Seus papéis: ' + (rotuloPapeis(perfil) || tipo));
        irPara('inicio.html');
        return false;
    }
    return true;
}

function aplicarUserLabel(perfil) {
    const el = document.getElementById('user-label');
    if (!el || !perfil) return;
    el.textContent = 'Olá, ' + (perfil.nome || perfil.email) + ' · ' + rotuloPapeis(perfil);
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
