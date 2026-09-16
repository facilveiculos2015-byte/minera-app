/** Sessão + perfil (usuarios.auth_id) + papéis múltiplos + bloqueio + tema */

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

function usuarioBloqueado(perfil) {
    if (!perfil) return false;
    return !!(perfil.bloqueado === true || perfil.bloqueado === 'true' || perfil.bloqueado === 't');
}

async function getPerfil(session) {
    if (!session || !session.user) return null;
    const uid = session.user.id;
    const email = session.user.email || '';
    const metaNome = (session.user.user_metadata && session.user.user_metadata.nome) || '';

    // Never load another profile via query string / arbitrary id
    try {
        const u = new URL(window.location.href);
        const banned = ['id', 'user', 'user_id', 'auth_id', 'uid', 'perfil'];
        let dirty = false;
        for (const k of banned) {
            if (u.searchParams.has(k)) {
                u.searchParams.delete(k);
                dirty = true;
            }
        }
        if (dirty && window.history && history.replaceState) {
            history.replaceState(null, '', u.pathname + u.search + u.hash);
        }
    } catch (e) { /* ignore */ }

    function mapRow(data) {
        return {
            id: data.id,
            auth_id: data.auth_id || uid,
            nome: data.nome || metaNome || 'Usuário',
            apelido: data.apelido || null,
            email: data.email || email,
            tipo: data.tipo || 'operador',
            papeis: normalizarPapeis(data.papeis, data.tipo),
            bloqueado: !!(data.bloqueado === true || data.bloqueado === 'true' || data.bloqueado === 't'),
            bloqueado_motivo: data.bloqueado_motivo || null,
            bloqueado_em: data.bloqueado_em || null,
            codigo_indicacao: data.codigo_indicacao || null,
            indicado_por: data.indicado_por || null,
            pontos_saldo: data.pontos_saldo != null ? Number(data.pontos_saldo) : 0
        };
    }

    try {
        const { data, error } = await supabaseClient
            .from('usuarios')
            .select('*')
            .eq('auth_id', uid)
            .maybeSingle();
        if (error) console.warn('getPerfil:', error.message);
        if (data) {
            // Refuse rows that somehow do not belong to this session
            if (data.auth_id && data.auth_id !== uid) {
                console.warn('getPerfil: ignored foreign auth_id');
            } else {
                const perfil = mapRow(data);
                await verificarInadimplencia(perfil);
                if (perfil.auth_id) {
                    try {
                        const { data: d2 } = await supabaseClient
                            .from('usuarios')
                            .select('bloqueado,bloqueado_motivo,bloqueado_em')
                            .eq('auth_id', uid)
                            .maybeSingle();
                        if (d2) {
                            perfil.bloqueado = !!(d2.bloqueado === true || d2.bloqueado === 'true' || d2.bloqueado === 't');
                            perfil.bloqueado_motivo = d2.bloqueado_motivo || perfil.bloqueado_motivo;
                            perfil.bloqueado_em = d2.bloqueado_em || perfil.bloqueado_em;
                        }
                    } catch (e) { /* ignore */ }
                }
                mostrarBannerBloqueio(perfil);
                return perfil;
            }
        }
    } catch (e) {
        console.warn(e);
    }

    // Stub only — no email cross-lookup (RLS isolates usuarios; avoid hijack)
    return {
        id: null,
        auth_id: uid,
        nome: metaNome || 'Usuário',
        email,
        tipo: 'operador',
        papeis: [],
        bloqueado: false,
        bloqueado_motivo: null,
        bloqueado_em: null,
        codigo_indicacao: null,
        indicado_por: null,
        pontos_saldo: 0
    };
}

/**
 * Cron-less: comissões pendentes vencidas → status atrasado + usuario.bloqueado.
 * Também desbloqueia se não houver mais pendências/atrasos.
 */
async function verificarInadimplencia(perfil) {
    if (!perfil || !perfil.auth_id) return;
    try {
        const { data, error } = await supabaseClient
            .from('comissoes')
            .select('id,status,vencimento,vendedor_auth_id')
            .eq('vendedor_auth_id', perfil.auth_id)
            .in('status', ['pendente', 'atrasado'])
            .limit(50);
        if (error) {
            if (/relation|comissoes|schema cache|does not exist/i.test(error.message || '')) return;
            console.warn('verificarInadimplencia:', error.message);
            return;
        }
        const agora = Date.now();
        let temAtraso = false;
        for (const c of (data || [])) {
            const venc = c.vencimento ? new Date(c.vencimento).getTime() : 0;
            if ((c.status === 'pendente' || c.status === 'atrasado') && venc && venc < agora) {
                temAtraso = true;
                if (c.status !== 'atrasado') {
                    try {
                        await supabaseClient.from('comissoes')
                            .update({ status: 'atrasado' })
                            .eq('id', c.id);
                    } catch (e) { console.warn(e); }
                }
            } else if (c.status === 'atrasado') {
                temAtraso = true;
            }
        }
        if (temAtraso && perfil.id && !usuarioBloqueado(perfil)) {
            const motivo = 'Comissão em atraso — pague via Pix no Perfil para liberar.';
            await supabaseClient.from('usuarios').update({
                bloqueado: true,
                bloqueado_motivo: motivo,
                bloqueado_em: new Date().toISOString()
            }).eq('auth_id', perfil.auth_id);
            perfil.bloqueado = true;
            perfil.bloqueado_motivo = motivo;
            perfil.bloqueado_em = new Date().toISOString();
        } else if (!temAtraso && perfil.id && usuarioBloqueado(perfil)) {
            // auto-clear only if block was for commission (keep manual admin blocks with other reasons)
            const motivo = (perfil.bloqueado_motivo || '').toLowerCase();
            if (!motivo || /comiss[aã]o|atraso|inadimpl/i.test(motivo)) {
                // still have unpaid? already checked — clear
                await supabaseClient.from('usuarios').update({
                    bloqueado: false,
                    bloqueado_motivo: null,
                    bloqueado_em: null
                }).eq('auth_id', perfil.auth_id);
                perfil.bloqueado = false;
                perfil.bloqueado_motivo = null;
                perfil.bloqueado_em = null;
            }
        }
    } catch (e) {
        console.warn('verificarInadimplencia', e);
    }
}

function mostrarBannerBloqueio(perfil) {
    const old = document.getElementById('banner-bloqueio');
    if (!usuarioBloqueado(perfil)) {
        if (old) old.remove();
        return;
    }
    let el = old;
    if (!el) {
        el = document.createElement('div');
        el.id = 'banner-bloqueio';
        el.className = 'banner-bloqueio';
        document.body.insertBefore(el, document.body.firstChild);
    }
    const motivo = perfil.bloqueado_motivo || 'Conta bloqueada por inadimplência.';
    const escM = (s) => String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    el.innerHTML = '<strong>Conta bloqueada</strong> — ' +
        escM(motivo) +
        ' <a href="' + (typeof APP_ROOT !== 'undefined' ? APP_ROOT : '/minera-app/') +
        'perfil.html#comissoes">Pagar comissão (Pix)</a>';
}

/** Bloqueia ações sensíveis; permite Perfil Pix + logout. */
function exigirDesbloqueado(perfil, acaoLabel) {
    if (!usuarioBloqueado(perfil)) return true;
    const msg = 'Conta bloqueada. ' + (perfil.bloqueado_motivo || 'Pague a comissão em atraso no Perfil.') +
        (acaoLabel ? ' (' + acaoLabel + ' indisponível)' : '');
    if (typeof toastMsg === 'function') toastMsg(msg);
    else alert(msg);
    return false;
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
    el.textContent = 'Olá, ' + (perfil.apelido || perfil.nome || 'Usuário') + ' · ' + rotuloPapeis(perfil);
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
    if (s === 'atrasado') return 'Atrasado';
    if (s === 'pago') return 'Pago';
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

/* ---- Tema claro/escuro ---- */
function lerTema() {
    try {
        const t = localStorage.getItem('minera_tema');
        if (t === 'light' || t === 'dark') return t;
    } catch (e) { /* ignore */ }
    return 'dark';
}

function aplicarTema(tema) {
    const t = tema === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('minera_tema', t); } catch (e) { /* ignore */ }
    const btn = document.getElementById('btn-tema');
    if (btn) btn.textContent = t === 'light' ? '🌙 Escuro' : '☀️ Claro';
}

function alternarTema() {
    aplicarTema(lerTema() === 'light' ? 'dark' : 'light');
}

/* apply ASAP (before paint if script late, still ok) */
(function bootTema() {
    try {
        document.documentElement.setAttribute('data-theme', lerTema());
    } catch (e) { /* ignore */ }
})();

/* ---- Tutorial first-login ---- */
function checarTutorialPrimeiroAcesso() {
    try {
        if (localStorage.getItem('minera_tutorial_visto') === '1') return;
        const path = (location.pathname || '');
        if (/tutorial\.html$/i.test(path)) return;
        // defer redirect slightly so page can paint
        setTimeout(() => {
            try {
                if (localStorage.getItem('minera_tutorial_visto') === '1') return;
                irPara('tutorial.html');
            } catch (e) { /* ignore */ }
        }, 400);
    } catch (e) { /* ignore */ }
}
