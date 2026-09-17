/** Bottom bar Instagram-style + Mais sheet + chips secundários. */

const NAV_PRIMARIOS = [
    { id: 'inicio', label: 'Feed', href: 'inicio.html', icon: '🏠' },
    { id: 'lotes', label: 'Lotes', href: 'lotes.html', icon: '📦' },
    { id: 'novo', label: 'Novo', href: 'lotes.html?novo=1', icon: '+', special: true },
    { id: 'chat', label: 'Chat', href: 'chat.html', icon: '💬' },
    { id: 'perfil', label: 'Perfil', href: 'perfil.html', icon: '👤', avatar: true }
];

const NAV_SECUNDARIOS = [
    { id: 'financeiro', label: 'Caixa Minera', href: 'financeiro.html', featured: true },
    { id: 'mapa', label: 'Mapa de Satélite', href: 'mapa.html' },
    { id: 'britagem', label: 'Britagem', href: 'processamento.html' },
    { id: 'frete', label: 'Logística', href: 'frete.html' },
    { id: 'estoque', label: 'Estoque', href: 'estoque.html' },
    { id: 'expedicao', label: 'Expedição', href: 'expedicao.html' },
    { id: 'relatorios', label: 'Relatórios', href: 'relatorios.html' },
    { id: 'admin', label: 'Admin', href: 'admin.html', adminOnly: true }
];

const PAPEIS_CHIPS = {
    minerador: ['inicio', 'financeiro', 'lotes', 'novo', 'chat', 'perfil', 'mapa'],
    comprador: ['inicio', 'financeiro', 'chat', 'perfil', 'mapa'],
    transportador: ['inicio', 'financeiro', 'frete', 'chat', 'perfil'],
    transportador_mina_britador: ['inicio', 'financeiro', 'frete', 'chat', 'perfil'],
    transportador_britador_porto: ['inicio', 'financeiro', 'frete', 'chat', 'perfil'],
    dono_britador: ['inicio', 'financeiro', 'britagem', 'estoque', 'chat', 'perfil'],
    carregamento: ['inicio', 'financeiro', 'expedicao', 'frete', 'chat', 'perfil'],
    admin: ['inicio', 'financeiro', 'lotes', 'novo', 'chat', 'perfil', 'mapa', 'britagem', 'frete', 'estoque', 'expedicao', 'relatorios', 'admin']
};

function iniciaisNome(nome) {
    const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function chipsPermitidos(perfil) {
    const allIds = NAV_PRIMARIOS.map(i => i.id).concat(NAV_SECUNDARIOS.map(i => i.id));
    if (!perfil) return allIds.filter(id => id !== 'admin');
    if (typeof ehAdmin === 'function' && ehAdmin(perfil)) return allIds;
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis : [];
    if (!papeis.length) return allIds.filter(id => id !== 'admin');
    const set = new Set(['perfil', 'inicio', 'chat', 'mapa', 'financeiro']);
    papeis.forEach(p => {
        const key = String(p).toLowerCase();
        const chips = PAPEIS_CHIPS[key];
        if (chips) chips.forEach(c => set.add(c));
        else if (key === 'admin') allIds.forEach(c => set.add(c));
    });
    return allIds.filter(id => set.has(id));
}

function fecharMaisSheet() {
    const sheet = document.getElementById('mais-sheet');
    if (sheet) sheet.classList.add('oculto');
}

function abrirMaisSheet() {
    const sheet = document.getElementById('mais-sheet');
    if (sheet) sheet.classList.remove('oculto');
}

function garantirMaisSheet(secundarios) {
    let sheet = document.getElementById('mais-sheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'mais-sheet';
        sheet.className = 'mais-sheet oculto';
        sheet.innerHTML =
            '<div class="mais-backdrop" data-close="1"></div>' +
            '<div class="mais-panel" role="dialog" aria-label="Mais opções">' +
            '<div class="mais-handle"></div>' +
            '<h3>Mais</h3>' +
            '<div class="mais-list" id="mais-list"></div>' +
            '<button type="button" class="btn-ghost mais-sair" id="mais-sair">Sair</button>' +
            '</div>';
        document.body.appendChild(sheet);
        sheet.addEventListener('click', (e) => {
            if (e.target && e.target.getAttribute('data-close') === '1') fecharMaisSheet();
        });
    }
    const list = document.getElementById('mais-list');
    const extras = secundarios.slice();
    // Tutorial sempre disponível no sheet Mais
    if (!extras.some(it => it.id === 'tutorial')) {
        extras.push({ id: 'tutorial', label: 'Tutorial', href: 'tutorial.html' });
    }
    list.innerHTML = extras.map(it =>
        '<a class="mais-item' + (it.featured ? ' mais-item-featured' : '') + '" href="' + APP_ROOT + it.href + '">' +
        (it.featured ? '🏦 ' : '') + it.label + '</a>'
    ).join('') || '<p class="sub">Nenhuma opção extra para seus papéis.</p>';

    const btnSair = document.getElementById('mais-sair');
    if (btnSair && !btnSair._bound) {
        btnSair._bound = true;
        btnSair.addEventListener('click', async () => {
            if (typeof sairApp === 'function') await sairApp();
            else {
                await supabaseClient.auth.signOut();
                irPara('index.html');
            }
        });
    }
}


function garantirHeaderCaixaBtn() {
    const header = document.querySelector('header.header-row');
    if (!header) return;
    let actions = header.querySelector('.header-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'header-actions';
        header.appendChild(actions);
    }
    let btn = document.getElementById('btn-caixa-bank');
    const href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'financeiro.html';
    if (!btn) {
        btn = document.createElement('a');
        btn.id = 'btn-caixa-bank';
        btn.className = 'btn-caixa-bank';
        btn.title = 'Caixa Minera';
        btn.setAttribute('aria-label', 'Caixa Minera');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M12 3L2 9v2h20V9L12 3zm1 6H11v2h2V9zm-4 0H7v2h2V9zm8 0h-2v2h2V9zM4 13v7h3v-5h2v5h2v-5h2v5h2v-5h2v5h3v-7H4z"/></svg>';
        const notif = document.getElementById('btn-notif');
        const sair = document.getElementById('btn-sair');
        if (notif && notif.parentNode === actions) actions.insertBefore(btn, notif);
        else if (sair && sair.parentNode === actions) actions.insertBefore(btn, sair);
        else actions.insertBefore(btn, actions.firstChild);
    }
    btn.href = href;
}

function montarNav(paginaAtiva, perfil) {
    garantirBrandLogo();
    garantirHeaderNotifBtn();
    garantirHeaderCaixaBtn();
    const permitidos = new Set(chipsPermitidos(perfil));
    const body = document.body;
    if (body) {
        body.classList.add('has-bottom-nav');
        body.classList.toggle('pagina-chat', paginaAtiva === 'chat');
    }

    // Top slim secondary row (role extras) — oculto no Chat (WhatsApp-like)
    const topNav = document.getElementById('app-nav');
    if (topNav) {
        const secs = NAV_SECUNDARIOS.filter(it => {
            if (it.adminOnly && !(typeof ehAdmin === 'function' && ehAdmin(perfil))) return false;
            return permitidos.has(it.id);
        });
        if (paginaAtiva === 'chat') {
            topNav.className = 'nav-chips nav-secondary oculto';
            topNav.innerHTML = '';
            topNav.setAttribute('aria-hidden', 'true');
            // Mantém sheet "Mais" disponível via outros atalhos se necessário
            garantirMaisSheet(secs);
        } else {
            topNav.className = 'nav-chips nav-secondary';
            topNav.removeAttribute('aria-hidden');
            let html = secs.map(it => {
                const on = it.id === paginaAtiva ? ' on' : '';
                const feat = it.featured ? ' chip-featured' : '';
                return '<a class="chip' + feat + on + '" href="' + APP_ROOT + it.href + '">' + it.label + '</a>';
            }).join('');
            html += '<button type="button" class="chip chip-mais" id="nav-mais">Mais</button>';
            html += '<button type="button" class="chip chip-sair" id="nav-sair">Sair</button>';
            topNav.innerHTML = html;

            const btnMais = document.getElementById('nav-mais');
            if (btnMais) btnMais.addEventListener('click', abrirMaisSheet);

            const btn = document.getElementById('nav-sair');
            if (btn) {
                btn.addEventListener('click', async () => {
                    if (typeof sairApp === 'function') await sairApp();
                    else {
                        await supabaseClient.auth.signOut();
                        irPara('index.html');
                    }
                });
            }
            garantirMaisSheet(secs);
        }
    }

    // Bottom Instagram bar
    let bar = document.getElementById('bottom-nav');
    if (!bar) {
        bar = document.createElement('nav');
        bar.id = 'bottom-nav';
        bar.className = 'bottom-nav';
        bar.setAttribute('aria-label', 'Navegação principal');
        document.body.appendChild(bar);
    }

    const iniciais = iniciaisNome(perfil && perfil.nome);
    bar.innerHTML = NAV_PRIMARIOS.map(it => {
        const on = (it.id === paginaAtiva || (it.id === 'lotes' && paginaAtiva === 'novo')) ? ' on' : '';
        if (it.special) {
            return '<a class="bn-item bn-novo' + on + '" href="' + APP_ROOT + it.href + '" title="Novo">' +
                '<span class="bn-plus">+</span><span class="bn-label">Novo</span></a>';
        }
        if (it.avatar) {
            return '<a class="bn-item bn-perfil' + on + '" href="' + APP_ROOT + it.href + '" title="Perfil">' +
                '<span class="bn-avatar" aria-hidden="true">' + iniciais + '</span>' +
                '<span class="bn-label">Perfil</span></a>';
        }
        return '<a class="bn-item' + on + '" href="' + APP_ROOT + it.href + '">' +
            '<span class="bn-icon" aria-hidden="true">' + it.icon + '</span>' +
            '<span class="bn-label">' + it.label + '</span></a>';
    }).join('');

    const legado = document.getElementById('btn-sair');
    if (legado) legado.classList.add('oculto');

    // Fale conosco (Robô Minera) — botão pequeno no header / float
    if (typeof garantirFaleConosco === 'function') {
        garantirFaleConosco(perfil);
    }

    // Notificações de DM (badge no sino) + empréstimos pendentes (admin)
    try {
        const uid = perfil && perfil.auth_id;
        if (uid && typeof MineraNotif !== 'undefined' && MineraNotif.start) {
            const adm = typeof ehAdmin === 'function' && ehAdmin(perfil);
            MineraNotif.start(uid, { isAdmin: !!adm });
        }
    } catch (e) { /* ignore */ }
}


/** Logo escavadeira ao lado do título Minera App (toda página autenticada) */
function garantirBrandLogo() {
    const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
    const src = root + 'logo-escavadeira.png?v=20260916af';
    document.querySelectorAll('header.header-row h1, header.auth-header h1').forEach(h1 => {
        // Already wrapped in brand-row with logo
        const existingRow = h1.closest('.brand-row');
        if (existingRow && existingRow.querySelector('.brand-logo')) {
            const img0 = existingRow.querySelector('.brand-logo');
            if (img0 && img0.getAttribute('src') !== src) img0.src = src;
            return;
        }
        const wrap = h1.parentElement;
        if (!wrap) return;
        if (wrap.querySelector(':scope > .brand-logo, :scope > .brand-row > .brand-logo')) {
            const img0 = wrap.querySelector('.brand-logo');
            if (img0 && img0.getAttribute('src') !== src) img0.src = src;
            return;
        }
        wrap.classList.add('brand-title');
        const img = document.createElement('img');
        img.className = 'brand-logo';
        img.src = src;
        img.alt = 'Minera App';
        img.width = 40;
        img.height = 40;
        img.decoding = 'async';
        if (!wrap.classList.contains('brand-row')) {
            const row = document.createElement('div');
            row.className = 'brand-row';
            h1.parentNode.insertBefore(row, h1);
            row.appendChild(img);
            row.appendChild(h1);
        } else {
            wrap.insertBefore(img, h1);
        }
    });
    // index / auth logo-mark
    document.querySelectorAll('.logo-mark').forEach(mark => {
        let img = mark.querySelector('img.brand-logo-lg');
        if (img) {
            if (img.getAttribute('src') !== src) img.src = src;
            return;
        }
        mark.innerHTML = '';
        img = document.createElement('img');
        img.className = 'brand-logo-lg';
        img.src = src;
        img.alt = 'Minera App';
        img.width = 72;
        img.height = 72;
        img.decoding = 'async';
        mark.appendChild(img);
    });
}

// Early inject (before async montarNav) so logo never flashes missing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', garantirBrandLogo);
} else {
    try { garantirBrandLogo(); } catch (e) { /* ignore */ }
}

function garantirHeaderNotifBtn() {
    const header = document.querySelector('header.header-row');
    if (!header) return;
    let actions = header.querySelector('.header-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'header-actions';
        header.appendChild(actions);
    }
    let btn = document.getElementById('btn-notif');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btn-notif';
        btn.className = 'btn-icon';
        btn.title = 'Notificações';
        btn.setAttribute('aria-label', 'Notificações');
        btn.innerHTML = '🔔<span class="notif-badge oculto" id="notif-badge">0</span>';
        const sair = document.getElementById('btn-sair');
        if (sair && sair.parentNode === actions) actions.insertBefore(btn, sair);
        else actions.appendChild(btn);
    } else if (!document.getElementById('notif-badge')) {
        const badge = document.createElement('span');
        badge.className = 'notif-badge oculto';
        badge.id = 'notif-badge';
        badge.textContent = '0';
        btn.appendChild(badge);
    }
}

/** Poll de DMs não lidas + badge + toast + Browser Notification */
const MineraNotif = (function () {
    let started = false;
    let timer = null;
    let authId = null;
    let knownIds = new Set();
    let bootstrapped = false;
    let isAdminUser = false;
    let adminEmpPendentes = 0;
    let lastEmpToastN = -1;

    function lsLeituras() {
        try {
            return JSON.parse(localStorage.getItem('minera_chat_leituras_' + authId) || '{}') || {};
        } catch (e) { return {}; }
    }

    function lsSeenGlobal() {
        try {
            return Number(localStorage.getItem('minera_chat_seen_max_' + authId) || 0);
        } catch (e) { return 0; }
    }

    function setSeenGlobal(id) {
        try {
            const prev = lsSeenGlobal();
            if (Number(id) > prev) localStorage.setItem('minera_chat_seen_max_' + authId, String(id));
        } catch (e) { /* ignore */ }
    }

    let dmBadgeCount = 0;

    function updateBadge(n) {
        dmBadgeCount = Number(n) || 0;
        renderCombinedBadge();
    }

    function renderCombinedBadge() {
        const badge = document.getElementById('notif-badge');
        const btn = document.getElementById('btn-notif');
        if (!badge) return;
        const total = dmBadgeCount + (isAdminUser ? adminEmpPendentes : 0);
        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : String(total);
            badge.classList.remove('oculto');
            if (btn) btn.classList.add('has-unread');
        } else {
            badge.classList.add('oculto');
            if (btn) btn.classList.remove('has-unread');
        }
    }

    function setAdminEmpPendentes(n) {
        adminEmpPendentes = Math.max(0, Number(n) || 0);
        isAdminUser = true;
        renderCombinedBadge();
        // Toast once when new pending appears
        if (adminEmpPendentes > 0 && adminEmpPendentes !== lastEmpToastN) {
            if (lastEmpToastN >= 0 && adminEmpPendentes > lastEmpToastN) {
                if (typeof toastMsg === 'function') {
                    toastMsg(adminEmpPendentes + ' empréstimo(s) aguardando análise');
                }
                showBrowserNotif('Minera App — Empréstimos', adminEmpPendentes + ' pedido(s) em análise');
            }
            lastEmpToastN = adminEmpPendentes;
        }
        if (adminEmpPendentes === 0) lastEmpToastN = 0;
        fillAdminEmpInDropdown();
    }

    function fillAdminEmpInDropdown() {
        const list = document.getElementById('notif-dd-list');
        if (!list || !isAdminUser) return;
        let empBlock = document.getElementById('notif-emp-block');
        if (adminEmpPendentes <= 0) {
            if (empBlock) empBlock.remove();
            return;
        }
        const href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'admin.html#sec-admin-emprestimos';
        const html = '<a class="notif-dd-item notif-emp-item" id="notif-emp-block" href="' + href + '">' +
            '<strong>Empréstimos em análise</strong>' +
            '<span>' + adminEmpPendentes + ' pedido(s) — Liberar ou Recusar no Admin</span></a>';
        if (empBlock) {
            empBlock.outerHTML = html;
        } else {
            list.insertAdjacentHTML('afterbegin', html);
        }
    }

    function ensureDropdown() {
        let dd = document.getElementById('notif-dropdown');
        if (dd) return dd;
        dd = document.createElement('div');
        dd.id = 'notif-dropdown';
        dd.className = 'notif-dropdown oculto';
        dd.innerHTML = '<div class="notif-dd-head">Notificações</div><div class="notif-dd-list" id="notif-dd-list"></div>' +
            '<a class="notif-dd-foot" id="notif-dd-foot" href="#">Abrir Chat</a>';
        document.body.appendChild(dd);
        const foot = document.getElementById('notif-dd-foot');
        if (foot) foot.href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'chat.html';
        document.addEventListener('click', (e) => {
            if (!dd.classList.contains('oculto')) {
                if (!dd.contains(e.target) && e.target.id !== 'btn-notif' && !(e.target.closest && e.target.closest('#btn-notif'))) {
                    dd.classList.add('oculto');
                }
            }
        });
        return dd;
    }

    function showBrowserNotif(title, body) {
        try {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') {
                new Notification(title, { body: body || '', icon: (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'logo-escavadeira.png?v=20260916af' });
            }
        } catch (e) { /* ignore */ }
    }

    async function poll() {
        if (!authId || typeof supabaseClient === 'undefined') return;
        try {
            const leituras = lsLeituras();
            const { data, error } = await supabaseClient
                .from('chat_mensagens')
                .select('id,de_auth_id,de_nome,para_auth_id,texto,tipo,criado_em,status,deleted_at')
                .eq('para_auth_id', authId)
                .is('deleted_at', null)
                .order('id', { ascending: false })
                .limit(40);
            if (error) return;

            const unread = [];
            const byPeer = {};
            (data || []).forEach(m => {
                if ((m.status || '') === 'agendada') return;
                const lastRead = Number(leituras[m.de_auth_id] || 0);
                if (Number(m.id) > lastRead) {
                    unread.push(m);
                    if (!byPeer[m.de_auth_id]) byPeer[m.de_auth_id] = m;
                }
            });

            updateBadge(Object.keys(byPeer).length || (unread.length ? unread.length : 0));

            // Toast / browser notif for newly seen ids after bootstrap
            const fresh = (data || []).filter(m =>
                Number(m.id) > lsSeenGlobal() &&
                (!bootstrapped || !knownIds.has(m.id))
            );
            if (!bootstrapped) {
                (data || []).forEach(m => knownIds.add(m.id));
                if (data && data[0]) setSeenGlobal(data[0].id);
                bootstrapped = true;
            } else {
                fresh.forEach(m => {
                    knownIds.add(m.id);
                    setSeenGlobal(m.id);
                    const nome = m.de_nome || 'Alguém';
                    const preview = (m.texto || (m.tipo && m.tipo !== 'text' ? '[' + m.tipo + ']' : 'Nova mensagem')).slice(0, 80);
                    if (typeof toastMsg === 'function') toastMsg('Nova mensagem de ' + nome);
                    showBrowserNotif('Minera App', nome + ': ' + preview);
                });
            }

            // Fill dropdown
            const list = document.getElementById('notif-dd-list');
            if (list) {
                const peers = Object.values(byPeer);
                if (!peers.length) {
                    list.innerHTML = '<p class="sub">Nenhuma mensagem nova</p>';
                } else {
                    list.innerHTML = peers.map(m => {
                        const href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') +
                            'chat.html?para=' + encodeURIComponent(m.de_auth_id);
                        const preview = (m.texto || '[' + (m.tipo || 'msg') + ']').slice(0, 60);
                        const escN = (s) => String(s == null ? '' : s)
                            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                        return '<a class="notif-dd-item" href="' + href + '"><strong>' +
                            escN(m.de_nome || 'Alguém') +
                            '</strong><span>' + escN(preview) + '</span></a>';
                    }).join('');
                }
                fillAdminEmpInDropdown();
            }
            // Admin: poll pending loans for bell badge
            if (isAdminUser) {
                try {
                    const { data: nEmp, error: empErr } = await supabaseClient.rpc('admin_contar_emprestimos_pendentes');
                    if (!empErr && nEmp != null) setAdminEmpPendentes(Number(nEmp) || 0);
                } catch (empE) { /* SQL 23 optional until applied */ }
            }
        } catch (e) {
            console.warn('MineraNotif', e);
        }
    }

    function bindBell() {
        const btn = document.getElementById('btn-notif');
        if (!btn || btn._notifBound) return;
        btn._notifBound = true;
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dd = ensureDropdown();
            const rect = btn.getBoundingClientRect();
            dd.style.top = (rect.bottom + 8 + window.scrollY) + 'px';
            dd.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
            dd.classList.toggle('oculto');
            if (!dd.classList.contains('oculto')) {
                await poll();
                // Ask permission once
                try {
                    if ('Notification' in window && Notification.permission === 'default') {
                        Notification.requestPermission();
                    }
                } catch (err) { /* ignore */ }
            }
        });
    }

    function start(uid, opts) {
        if (!uid) return;
        authId = uid;
        opts = opts || {};
        if (opts.isAdmin) isAdminUser = true;
        bindBell();
        ensureDropdown();
        if (started) return;
        started = true;
        poll();
        timer = setInterval(poll, 8000);
    }

    return { start, poll, updateBadge, setAdminEmpPendentes, renderCombinedBadge };
})();
window.MineraNotif = MineraNotif;
