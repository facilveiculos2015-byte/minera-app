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
        arr = raw.replace(/[{}]/g, '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    }
    const t = (tipo || '').toLowerCase();
    if (t === 'admin' && !arr.includes('admin')) arr.push('admin');
    return arr;
}

/** transportador legado → ambas pernas; transportador_* batem em transportador */
function temPapel(perfil, role) {
    if (!perfil || !role) return false;
    if (ehAdmin(perfil)) return true;
    const r = String(role).toLowerCase();
    const papeis = (Array.isArray(perfil.papeis) ? perfil.papeis : [])
        .map(p => String(p).toLowerCase());
    if (papeis.includes(r)) return true;
    if (r === 'transportador') {
        return papeis.some(p =>
            p === 'transportador' ||
            p === 'transportador_mina_britador' ||
            p === 'transportador_britador_porto'
        );
    }
    if (r === 'transportador_mina_britador' || r === 'transportador_britador_porto') {
        return papeis.includes(r) || papeis.includes('transportador');
    }
    return false;
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
        minerador: 'Minerador',
        comprador: 'Comprador',
        transportador: 'Transportador',
        transportador_mina_britador: 'Transportador (Mina - Britador)',
        transportador_britador_porto: 'Transportador (Britador - Porto)',
        dono_britador: 'Dono de Britador',
        carregamento: 'Operador de Carregamento',
        admin: 'Admin'
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
    const hit = ok.some(r => temPapel(perfil, r));
    if (!hit) {
        alert('Acesso restrito. Seus papéis: ' + (rotuloPapeis(perfil) || (perfil && perfil.tipo) || 'operador'));
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

function toastMsg(texto) {
    let t = document.getElementById('app-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'app-toast';
        t.className = 'app-toast';
        document.body.appendChild(t);
    }
    t.textContent = texto;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function statusAmigavel(st) {
    const s = (st || 'pendente').toLowerCase();
    if (s === 'pendente') return 'Disponível';
    if (s === 'em_processo') return 'Em trânsito';
    if (s === 'expedido') return 'Vendido';
    if (s === 'processado') return 'Processado';
    return s;
}

function statusBadgeClass(st) {
    const s = (st || 'pendente').toLowerCase();
    return 'badge badge-' + s;
}

function formatPeso(kg) {
    const n = Number(kg) || 0;
    if (n >= 1000) {
        const ton = (n / 1000).toFixed(n % 1000 === 0 ? 0 : 2);
        return n + ' kg (' + ton + ' t)';
    }
    return n + ' kg';
}

function formatPreco(p) {
    if (p == null || p === '' || isNaN(Number(p))) return null;
    return Number(p).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
