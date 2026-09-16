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
    garantirHeaderCaixaBtn();
    const permitidos = new Set(chipsPermitidos(perfil));
    const body = document.body;
    if (body) body.classList.add('has-bottom-nav');

    // Top slim secondary row (role extras)
    const topNav = document.getElementById('app-nav');
    if (topNav) {
        const secs = NAV_SECUNDARIOS.filter(it => {
            if (it.adminOnly && !(typeof ehAdmin === 'function' && ehAdmin(perfil))) return false;
            return permitidos.has(it.id);
        });
        topNav.className = 'nav-chips nav-secondary';
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
}
