/** Bottom bar Instagram-style + Mais sheet + chips secundários. */

const NAV_PRIMARIOS = [
    { id: 'inicio', label: 'Início', href: 'inicio.html', icon: "<svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true' focusable='false'><path d='M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z'/></svg>" },
    { id: 'lotes', label: 'Lotes', href: 'lotes.html', icon: "<svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true' focusable='false'><path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/><path d='M3.3 7L12 12l8.7-5M12 12v9'/></svg>" },
    { id: 'novo', label: 'Novo', href: 'lotes.html?novo=1', icon: '+', special: true },
    { id: 'chat', label: 'Chat', href: 'chat.html', icon: "<svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true' focusable='false'><path d='M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3V11.5A8.5 8.5 0 1 1 21 11.5z'/></svg>" },
    { id: 'perfil', label: 'Perfil', href: 'perfil.html', icon: "<svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true' focusable='false'><circle cx='12' cy='8' r='3.5'/><path d='M5 19.5c1.8-3.2 4-4.5 7-4.5s5.2 1.3 7 4.5'/></svg>", avatar: true }
];

const NAV_SECUNDARIOS = [
    { id: 'mapa', label: 'Mapa', href: 'mapa.html' },
    // Ferramentas (deep-link secundário dentro do catálogo Serviços)
    { id: 'britagem', label: 'Minha Britagem', href: 'processamento.html', grupo: 'ferramentas', icon: '•' },
    { id: 'frete', label: 'Meus Fretes', href: 'frete.html', grupo: 'ferramentas', icon: '•' },
    // Estoque / Expedição / Relatórios: HTML mantido (admin/URL direta), ocultos do chrome do cliente
    { id: 'admin', label: 'Admin', href: 'admin.html', adminOnly: true }
];

/** Catálogo de serviços no marketplace (papéis → oferta). */
const SERVICOS_CATALOGO = [
    { id: 'frete', label: 'Frete / Transportador', icon: '🚛', match: ['transportador', 'transportador_mina_britador', 'transportador_britador_porto'] },
    { id: 'britagem', label: 'Britagem / Britador', icon: '⛏', match: ['dono_britador'] },
    { id: 'carregamento', label: 'Carregamento', icon: '📦', match: ['carregamento'] },
    { id: 'minerador', label: 'Minerador (vendedor de lote)', icon: '⛏', match: ['minerador'] },
    { id: 'maquinario', label: 'Maquinário (venda)', icon: '🧰', match: ['minerador', 'comprador', 'transportador', 'transportador_mina_britador', 'transportador_britador_porto', 'dono_britador', 'carregamento', 'admin'] },
    { id: 'comprador', label: 'Comprador', icon: '🛒', match: ['comprador'] }
];

const NAV_SERVICO_IDS = new Set(['frete', 'britagem', 'servicos']);
let _servicosDirCache = null;
let _servicosFiltro = '';
let _servicosBusca = '';

const PAPEIS_CHIPS = {
    /* Maquinário: qualquer papel anuncia — por isso todos têm lotes + novo */
    minerador: ['inicio', 'lotes', 'novo', 'chat', 'perfil', 'mapa'],
    comprador: ['inicio', 'lotes', 'novo', 'chat', 'perfil', 'mapa'],
    transportador: ['inicio', 'lotes', 'novo', 'frete', 'chat', 'perfil', 'mapa'],
    transportador_mina_britador: ['inicio', 'lotes', 'novo', 'frete', 'chat', 'perfil', 'mapa'],
    transportador_britador_porto: ['inicio', 'lotes', 'novo', 'frete', 'chat', 'perfil', 'mapa'],
    dono_britador: ['inicio', 'lotes', 'novo', 'britagem', 'chat', 'perfil', 'mapa'],
    carregamento: ['inicio', 'lotes', 'novo', 'frete', 'chat', 'perfil', 'mapa'],
    admin: ['inicio', 'lotes', 'novo', 'chat', 'perfil', 'mapa', 'britagem', 'frete', 'admin']
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
    const set = new Set(['perfil', 'inicio', 'chat', 'mapa']);
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
    fecharServicosPanel();
    const sheet = document.getElementById('mais-sheet');
    if (sheet) sheet.classList.remove('oculto');
}


function _escNav(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _looksEmailNav(s) {
    return /@/.test(String(s || ''));
}

function displayNomePublico(u) {
    if (!u) return 'Usuário';
    const ap = String(u.apelido || '').trim();
    const no = String(u.nome || '').trim();
    if (ap && !_looksEmailNav(ap)) return ap;
    if (no && !_looksEmailNav(no)) return no;
    return 'Usuário';
}

function papeisLista(u) {
    const arr = (Array.isArray(u && u.papeis) ? u.papeis : []).map(p => String(p).toLowerCase());
    if (!arr.length && u && u.tipo) arr.push(String(u.tipo).toLowerCase());
    return arr;
}

function servicosDoUsuario(u) {
    const papeis = papeisLista(u);
    return SERVICOS_CATALOGO.filter(s => s.match.some(m => papeis.includes(m)));
}

function fecharServicosPanel() {
    const sheet = document.getElementById('servicos-sheet');
    const btn = document.getElementById('nav-servicos');
    if (sheet) sheet.classList.add('oculto');
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('open');
    }
}

function abrirServicosPanel() {
    fecharMaisSheet();
    garantirServicosSheet();
    const sheet = document.getElementById('servicos-sheet');
    const btn = document.getElementById('nav-servicos');
    if (sheet) sheet.classList.remove('oculto');
    if (btn) {
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('open');
    }
    carregarServicosCatalogo();
}

function toggleServicosPanel() {
    const sheet = document.getElementById('servicos-sheet');
    if (!sheet || sheet.classList.contains('oculto')) abrirServicosPanel();
    else fecharServicosPanel();
}

try {
    window.abrirServicosPanel = abrirServicosPanel;
    window.fecharServicosPanel = fecharServicosPanel;
    window.toggleServicosPanel = toggleServicosPanel;
} catch (e) { /* ignore */ }

async function rpcServicosDiretorio(busca) {
    try {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) return [];
        const termo = String(busca || '').trim();
        if (_looksEmailNav(termo)) return [];
        let rows = [];
        if (termo.length >= 1) {
            const { data, error } = await supabaseClient.rpc('chat_buscar_nome', { p_nome: termo });
            if (!error && data) rows = data;
        }
        if (!rows.length) {
            const { data, error } = await supabaseClient.rpc('chat_diretorio');
            if (error) throw error;
            rows = data || [];
        }
        return (rows || []).map(u => {
            const out = Object.assign({}, u);
            delete out.email;
            delete out.Email;
            if (_looksEmailNav(out.nome)) out.nome = '';
            if (_looksEmailNav(out.apelido)) out.apelido = '';
            return out;
        }).filter(u => servicosDoUsuario(u).length > 0);
    } catch (e) {
        console.warn('servicos catalogo', e);
        return [];
    }
}

function renderServicosCatalogoList() {
    const box = document.getElementById('servicos-dir-list');
    if (!box) return;
    let items = (_servicosDirCache || []).slice();
    if (_servicosFiltro) {
        const cat = SERVICOS_CATALOGO.find(s => s.id === _servicosFiltro);
        if (cat) {
            items = items.filter(u => servicosDoUsuario(u).some(s => s.id === cat.id));
        }
    }
    if (_servicosBusca) {
        const t = _servicosBusca.toLowerCase();
        items = items.filter(u =>
            displayNomePublico(u).toLowerCase().includes(t) ||
            String(u.nome || '').toLowerCase().includes(t) ||
            String(u.apelido || '').toLowerCase().includes(t) ||
            String(u.cidade || '').toLowerCase().includes(t)
        );
    }
    if (!items.length) {
        box.innerHTML = '<p class="servicos-empty">Nenhum prestador encontrado. Amplie o filtro ou tente outra categoria.</p>';
        return;
    }
    box.innerHTML = items.map(u => {
        const nome = displayNomePublico(u);
        const ini = iniciaisNome(nome);
        const offs = servicosDoUsuario(u);
        const cidade = String(u.cidade || u.localidade || '').trim();
        const badges = offs.map(s =>
            '<span class="svc-badge">' + _escNav(s.label) + '</span>'
        ).join('');
        const chatHref = (typeof APP_ROOT === 'string' ? APP_ROOT : '') +
            'chat.html?com=' + encodeURIComponent(u.auth_id);
        return '<article class="svc-card">' +
            '<div class="svc-avatar" aria-hidden="true">' + _escNav(ini) + '</div>' +
            '<div class="svc-body">' +
            '<strong class="svc-nome">' + _escNav(nome) + '</strong>' +
            '<span class="svc-verificado">Prestador na plataforma</span>' +
            '<div class="svc-badges">' + badges + '</div>' +
            (cidade ? '<div class="svc-cidade">' + _escNav(cidade) + '</div>' : '') +
            '</div>' +
            '<a class="btn-sm svc-negociar" href="' + chatHref + '">Negociar</a>' +
            '</article>';
    }).join('');
}

async function carregarServicosCatalogo() {
    const box = document.getElementById('servicos-dir-list');
    if (box) box.innerHTML = '<p class="sub">Carregando prestadores…</p>';
    _servicosDirCache = await rpcServicosDiretorio(_servicosBusca);
    renderServicosCatalogoList();
}

function garantirServicosSheet(ferramentas) {
    let sheet = document.getElementById('servicos-sheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'servicos-sheet';
        sheet.className = 'servicos-sheet oculto';
        sheet.innerHTML =
            '<div class="mais-backdrop" data-close-svc="1"></div>' +
            '<div class="servicos-mkt-panel" role="dialog" aria-label="Catálogo de Serviços">' +
            '<div class="mais-handle"></div>' +
            '<div class="servicos-mkt-head">' +
            '<h3>Serviços</h3>' +
            '<p class="servicos-mkt-cue">Prestadores verificados na sua região</p>' +
            '</div>' +
            '<label class="servicos-busca-wrap"><span class="sr-only">Buscar</span>' +
            '<input type="search" id="servicos-busca" class="servicos-busca" placeholder="Buscar por nome…" autocomplete="off"></label>' +
            '<div class="servicos-filtros" id="servicos-filtros" role="tablist" aria-label="Filtrar serviços"></div>' +
            '<div class="servicos-dir-list" id="servicos-dir-list"></div>' +
            '<div class="servicos-ferramentas" id="servicos-ferramentas"></div>' +
            '</div>';
        document.body.appendChild(sheet);
        sheet.addEventListener('click', (e) => {
            if (e.target && e.target.getAttribute('data-close-svc') === '1') fecharServicosPanel();
        });
        if (!document._servicosEscBound) {
            document._servicosEscBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') fecharServicosPanel();
            });
        }
    }

    const filtros = document.getElementById('servicos-filtros');
    if (filtros && !filtros._built) {
        filtros._built = true;
        const chips = [{ id: '', label: 'Todos', icon: '' }].concat(
            SERVICOS_CATALOGO.map(s => ({ id: s.id, label: s.label, icon: s.icon }))
        );
        filtros.innerHTML = chips.map(c =>
            '<button type="button" class="fchip svc-fchip' + (!c.id ? ' on' : '') + '" data-svc="' + c.id + '">' +
            (c.icon ? ('<span class="svc-fchip-ico" aria-hidden="true">' + c.icon + '</span> ') : '') +
            c.label + '</button>'
        ).join('');
        filtros.addEventListener('click', (e) => {
            const btn = e.target.closest('.svc-fchip');
            if (!btn) return;
            filtros.querySelectorAll('.svc-fchip').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            _servicosFiltro = btn.getAttribute('data-svc') || '';
            renderServicosCatalogoList();
        });
    }

    const busca = document.getElementById('servicos-busca');
    if (busca && !busca._bound) {
        busca._bound = true;
        let t = null;
        busca.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                _servicosBusca = String(busca.value || '').trim();
                carregarServicosCatalogo();
            }, 280);
        });
    }

    const ferrBox = document.getElementById('servicos-ferramentas');
    if (ferrBox) {
        const tools = Array.isArray(ferramentas) ? ferramentas : [];
        if (tools.length) {
            ferrBox.innerHTML = '<div class="servicos-ferr-title">Minhas ferramentas</div>' +
                tools.map(it =>
                    '<a class="servicos-ferr-link" href="' + APP_ROOT + it.href + '">' +
                    '<span aria-hidden="true">' + (it.icon || '•') + '</span> ' + _escNav(it.label) + '</a>'
                ).join('');
            ferrBox.classList.remove('oculto');
        } else {
            ferrBox.innerHTML = '';
            ferrBox.classList.add('oculto');
        }
    }
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
        btn.title = 'Bank Minera — Minera Bank';
        btn.setAttribute('aria-label', 'Bank Minera — Minera Bank');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M12 3L2 9v2h20V9L12 3zm1 6H11v2h2V9zm-4 0H7v2h2V9zm8 0h-2v2h2V9zM4 13v7h3v-5h2v5h2v-5h2v5h2v-5h2v5h3v-7H4z"/></svg>' +
            '<span class="btn-caixa-bank-label">Bank Minera</span>';
        const notif = document.getElementById('btn-notif');
        const sair = document.getElementById('btn-sair');
        if (notif && notif.parentNode === actions) actions.insertBefore(btn, notif);
        else if (sair && sair.parentNode === actions) actions.insertBefore(btn, sair);
        else actions.insertBefore(btn, actions.firstChild);
    }
    btn.href = href;
    btn.title = 'Bank Minera — Minera Bank';
    btn.setAttribute('aria-label', 'Bank Minera — Minera Bank');
    if (!btn.querySelector('.btn-caixa-bank-label')) {
        const label = document.createElement('span');
        label.className = 'btn-caixa-bank-label';
        label.textContent = 'Bank Minera';
        btn.appendChild(label);
    }
}


function garantirHeaderModoUiBtn(perfil) {
    const stickyOld = document.getElementById('modo-ui-sticky');
    const btnOld = document.getElementById('btn-modo-ui');
    const bpOld = document.getElementById('btn-modo-ui-painel');

    const isAdm = typeof ehAdmin === 'function' && ehAdmin(perfil);
    if (!isAdm) {
        if (btnOld) btnOld.remove();
        if (stickyOld) stickyOld.remove();
        if (bpOld) bpOld.remove();
        return;
    }

    const adminUi = typeof emModoAdminUi === 'function' && emModoAdminUi(perfil);
    const usuarioUi = typeof emModoUsuarioUi === 'function' && emModoUsuarioUi(perfil);

    function bindVoltarAdmin(el) {
        if (!el) return;
        el.onclick = (ev) => {
            if (ev) ev.preventDefault();
            if (typeof gravarModoUi === 'function') gravarModoUi('admin');
            if (typeof irPara === 'function') irPara('admin.html');
            else window.location.href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'admin.html';
        };
    }

    /** Sticky SEMPRE no modo usuário — não depende de header.header-row (Início/Chat/Perfil). */
    
/** Páginas raiz da bottom-nav — não injetam Voltar de página. */
const PAGINAS_RAIZ = new Set(['inicio', 'lotes', 'chat', 'perfil', 'index']);

function paginaAtualId() {
    const path = (location.pathname || '').split('/').pop() || '';
    const base = path.replace(/\.html$/i, '') || 'inicio';
    if (base === 'index' || base === '') return 'inicio';
    if (base === 'lote-detalhe') return 'lote-detalhe';
    return base;
}

function destinoVoltarPadrao() {
    const id = paginaAtualId();
    if (id === 'lote-detalhe') return 'inicio.html';
    if (id === 'financeiro' || id === 'mapa' || id === 'frete' || id === 'processamento') return 'inicio.html';
    if (id === 'admin' || id === 'estoque' || id === 'expedicao' || id === 'relatorios' || id === 'tutorial') return 'inicio.html';
    return 'inicio.html';
}

function irVoltarApp() {
    try {
        const ref = document.referrer || '';
        const sameOrigin = ref && ref.indexOf(location.origin) === 0;
        if (sameOrigin && history.length > 1) {
            history.back();
            return;
        }
    } catch (e) { /* ignore */ }
    const root = (typeof APP_ROOT === 'string') ? APP_ROOT : '';
    location.href = root + destinoVoltarPadrao();
}

/** Botão Voltar bem visível em telas que saem da aba raiz. */
function garantirBotaoVoltarPagina() {
    const id = paginaAtualId();
    if (PAGINAS_RAIZ.has(id)) return;
    if (document.getElementById('app-back-btn')) return;
    // lote-detalhe já tem btn-voltar — reforça handler
    const existing = document.getElementById('btn-voltar');
    if (existing) {
        existing.addEventListener('click', function (e) {
            e.preventDefault();
            irVoltarApp();
        });
        existing.classList.add('app-back-btn');
        return;
    }
    const bar = document.createElement('div');
    bar.className = 'app-back-bar';
    bar.id = 'app-back-bar';
    bar.innerHTML = '<button type="button" class="app-back-btn" id="app-back-btn" aria-label="Voltar à tela anterior"><span class="ab-ico" aria-hidden="true">←</span> Voltar</button>';
    const btn = bar.querySelector('#app-back-btn');
    btn.addEventListener('click', irVoltarApp);
    const container = document.querySelector('.container') || document.body;
    const header = container.querySelector('header.header-row, header');
    if (header && header.parentNode) {
        header.parentNode.insertBefore(bar, header);
    } else {
        container.insertBefore(bar, container.firstChild);
    }
}


function garantirStickyVoltar() {
        let sticky = document.getElementById('modo-ui-sticky');
        if (!sticky) {
            sticky = document.createElement('div');
            sticky.id = 'modo-ui-sticky';
            sticky.className = 'modo-ui-sticky';
            sticky.setAttribute('role', 'region');
            sticky.setAttribute('aria-label', 'Modo usuário do admin');
            const parent = document.body || document.documentElement;
            parent.insertBefore(sticky, parent.firstChild);
        }
        sticky.innerHTML =
            '<span>Modo usuário (admin) — você continua logado como admin</span>' +
            '<button type="button" id="btn-modo-ui-sticky" class="btn-modo-ui btn-modo-voltar">Voltar ao Admin</button>';
        bindVoltarAdmin(document.getElementById('btn-modo-ui-sticky'));
        return sticky;
    }

    const header = document.querySelector('header.header-row');
    let actions = header ? header.querySelector('.header-actions') : null;
    if (header && !actions) {
        actions = document.createElement('div');
        actions.className = 'header-actions';
        header.appendChild(actions);
    }

    if (adminUi) {
        if (stickyOld) stickyOld.remove();
        if (!actions) return; // painel admin sem header de cliente: ok
        let btn = btnOld;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'btn-modo-ui';
            btn.className = 'btn-modo-ui';
            const notif = document.getElementById('btn-notif');
            const sair = document.getElementById('btn-sair');
            if (notif && notif.parentNode === actions) actions.insertBefore(btn, notif);
            else if (sair && sair.parentNode === actions) actions.insertBefore(btn, sair);
            else actions.appendChild(btn);
        }
        btn.textContent = 'Ver como usuário';
        btn.title = 'Mostrar a interface normal de cliente';
        btn.setAttribute('aria-label', 'Ver como usuário');
        btn.classList.remove('btn-modo-voltar');
        btn.classList.add('btn-modo-ver-user');
        btn.onclick = () => {
            if (typeof gravarModoUi === 'function') gravarModoUi('usuario');
            if (typeof irPara === 'function') irPara('inicio.html');
            else window.location.href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'inicio.html';
        };
        let btnPainel = document.getElementById('btn-modo-ui-painel');
        const onAdminPage = document.body && (
            document.body.classList.contains('pagina-admin') ||
            /admin\.html$/i.test(location.pathname)
        );
        if (!onAdminPage) {
            if (!btnPainel) {
                btnPainel = document.createElement('a');
                btnPainel.id = 'btn-modo-ui-painel';
                btnPainel.className = 'btn-modo-ui btn-modo-painel';
                btnPainel.textContent = 'Painel Admin';
                actions.insertBefore(btnPainel, btn);
            }
            btnPainel.href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'admin.html';
            btnPainel.classList.remove('oculto');
        } else if (btnPainel) {
            btnPainel.remove();
        }
        return;
    }

    if (usuarioUi) {
        // Sticky em TODAS as telas de cliente (Início sem header incluso)
        garantirStickyVoltar();
        if (bpOld) bpOld.remove();

        if (actions) {
            let btn = btnOld;
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.id = 'btn-modo-ui';
                btn.className = 'btn-modo-ui';
                const notif = document.getElementById('btn-notif');
                const sair = document.getElementById('btn-sair');
                if (notif && notif.parentNode === actions) actions.insertBefore(btn, notif);
                else if (sair && sair.parentNode === actions) actions.insertBefore(btn, sair);
                else actions.appendChild(btn);
            }
            btn.textContent = 'Voltar ao Admin';
            btn.title = 'Voltar ao painel de monitoramento';
            btn.setAttribute('aria-label', 'Voltar ao Admin');
            btn.classList.add('btn-modo-voltar');
            btn.classList.remove('btn-modo-ver-user');
            bindVoltarAdmin(btn);
        } else if (btnOld) {
            btnOld.remove();
        }
        return;
    }

    if (btnOld) btnOld.remove();
    if (stickyOld) stickyOld.remove();
    if (bpOld) bpOld.remove();
}



/** Sair só no Perfil (#btn-sair). Bind once → sairApp(). */
function garantirBtnSair(paginaAtiva) {
    const btn = document.getElementById('btn-sair');
    if (!btn) return;
    if (!btn._sairBound) {
        btn._sairBound = true;
        btn.addEventListener('click', async () => {
            if (typeof sairApp === 'function') await sairApp();
            else {
                await supabaseClient.auth.signOut();
                irPara('index.html');
            }
        });
    }
    // Sair no Perfil (logout do app) e no Admin (monitoramento também precisa sair)
    if (paginaAtiva === 'perfil' || paginaAtiva === 'admin') btn.classList.remove('oculto');
    else btn.classList.add('oculto');
}

function montarNav(paginaAtiva, perfil) {
    garantirBrandLogo();
    garantirHeaderNotifBtn();

    // Modo UI admin: default + bloqueio de páginas de cliente
    if (typeof garantirModoUiPadrao === 'function') garantirModoUiPadrao(perfil);
    if (typeof enforceAdminModoPagina === 'function' && enforceAdminModoPagina(perfil, paginaAtiva)) {
        return;
    }

    const adminUi = typeof emModoAdminUi === 'function' && emModoAdminUi(perfil);
    const usuarioUi = typeof emModoUsuarioUi === 'function' && emModoUsuarioUi(perfil);
    const isAdminPage = paginaAtiva === 'admin'
        || (document.body && document.body.classList.contains('pagina-admin'));
    // Chrome de monitoramento: modo admin OU qualquer visita a admin.html
    const hideClientChrome = adminUi || isAdminPage;

    if (!hideClientChrome) garantirHeaderCaixaBtn();
    else {
        const caixaBtn = document.getElementById('btn-caixa-bank');
        if (caixaBtn) caixaBtn.classList.add('oculto');
    }

    garantirHeaderModoUiBtn(perfil);

    const permitidos = new Set(chipsPermitidos(perfil));
    const body = document.body;
    if (body) {
        body.classList.toggle('pagina-chat', paginaAtiva === 'chat');
        body.classList.toggle('pagina-lote-detalhe', paginaAtiva === 'lote-detalhe');
        body.classList.toggle('pagina-admin', isAdminPage);
        body.classList.toggle('modo-ui-admin', !!adminUi);
        body.classList.toggle('modo-ui-usuario', !!usuarioUi);
        if (hideClientChrome) body.classList.remove('has-bottom-nav');
        else body.classList.add('has-bottom-nav');
    }

    // Secondary #app-nav: no Serviços / Mais / Sair / Mapa chips (Mapa = atalho Início).
    // Row stays empty/hidden on client pages (incl. lote-detalhe). Sheets still built for deep-links.
    const topNav = document.getElementById('app-nav');
    if (topNav) {
        const secs = NAV_SECUNDARIOS.filter(it => {
            if (it.adminOnly && !(typeof ehAdmin === 'function' && ehAdmin(perfil))) return false;
            return permitidos.has(it.id);
        });
        const ferramentas = secs.filter(it => it.grupo === 'ferramentas');
        const maisItens = secs.filter(it => it.id !== 'mapa' && !it.grupo);
        topNav.className = 'nav-chips nav-secondary oculto';
        topNav.innerHTML = '';
        topNav.setAttribute('aria-hidden', 'true');
        topNav.hidden = true;
        if (!hideClientChrome) {
            garantirMaisSheet(maisItens.length ? maisItens : secs.filter(it => !it.grupo));
            garantirServicosSheet(ferramentas);
            // Remove Sair from Mais sheet (Sair only via Perfil #btn-sair)
            const maisSair = document.getElementById('mais-sair');
            if (maisSair) maisSair.classList.add('oculto');
        }
    }

    // Bottom Instagram bar — oculto no modo/página admin (monitoramento)
    let bar = document.getElementById('bottom-nav');
    if (hideClientChrome) {
        if (bar) {
            bar.classList.add('oculto');
            bar.setAttribute('aria-hidden', 'true');
            bar.innerHTML = '';
        }
        garantirBtnSair(paginaAtiva);
        // Esconde Fale conosco / Mais sheet no modo monitoramento
        const sheet = document.getElementById('mais-sheet');
        if (sheet) sheet.classList.add('oculto');
        const svcSheet = document.getElementById('servicos-sheet');
        if (svcSheet) svcSheet.classList.add('oculto');
        const fale = document.getElementById('card-fale-conosco');
        if (fale) fale.classList.add('oculto');
    } else {
        if (!bar) {
            bar = document.createElement('nav');
            bar.id = 'bottom-nav';
            bar.className = 'bottom-nav';
            bar.setAttribute('aria-label', 'Navegação principal');
            document.body.appendChild(bar);
        }
        bar.classList.remove('oculto');
        bar.removeAttribute('aria-hidden');

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

        garantirBtnSair(paginaAtiva);
    }

    // Fale conosco (Robô Minera) — SÓ no Perfil; nunca no monitoramento admin
    if (!hideClientChrome && typeof garantirFaleConosco === 'function') {
        garantirFaleConosco(perfil);
    }

    // Notificações de DM (badge no sino) + empréstimos/alertas (admin)
    try {
        const uid = perfil && perfil.auth_id;
        if (uid && typeof MineraNotif !== 'undefined' && MineraNotif.start) {
            const adm = typeof ehAdmin === 'function' && ehAdmin(perfil);
            MineraNotif.start(uid, { isAdmin: !!adm });
        }
    } catch (e) { /* ignore */ }

    // Pix de apoio: 1x por entrada no app (depois do lembrete de mensagens, se houver)
    try {
        if (!hideClientChrome && typeof MineraApoio !== 'undefined') MineraApoio.talvezMostrar(perfil);
        else if (hideClientChrome && typeof MineraApoio !== 'undefined' && MineraApoio.pendente()) sessionStorage.removeItem('minera_apoio_mostrar');
    } catch (e) { /* ignore */ }
}


/** Logo escavadeira ao lado do título Minera Pará (toda página autenticada) */
function garantirBrandLogo() {
    const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
    const src = root + 'logo-escavadeira.png?v=20260925b';
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
        img.alt = 'Minera Pará';
        img.width = 56;
        img.height = 56;
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
        img.alt = 'Minera Pará';
        img.width = 96;
        img.height = 96;
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

/* Entrada no app (novo lançamento / nova sessão do navegador): marca para o card
 * "Pix de apoio" aparecer 1x. sessionStorage sobrevive a reload (inclusive o reload
 * de atualização do pwa.js), a trocar de página e a voltar do background. */
(function marcarEntradaApp() {
    try {
        if (sessionStorage.getItem('minera_sessao_app') !== '1') {
            sessionStorage.setItem('minera_sessao_app', '1');
            sessionStorage.setItem('minera_apoio_mostrar', '1');
        }
    } catch (e) { /* ignore */ }
})();

/** Poll de DMs não lidas + badge + toast + Browser Notification */
const MineraNotif = (function () {
    let started = false;
    let timer = null;
    let authId = null;
    let knownIds = new Set();
    let bootstrapped = false;
    let isAdminUser = false;
    let adminEmpPendentes = 0;
    let adminAlertasN = 0;
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

    /** Badge na aba Chat da barra inferior (mesma contagem de DMs não lidas do sino). */
    function renderChatTabBadge() {
        const tab = document.querySelector('#bottom-nav .bn-item[href$="chat.html"]');
        if (!tab) return;
        let b = tab.querySelector('.bn-badge');
        if (!b) {
            b = document.createElement('span');
            b.className = 'bn-badge oculto';
            b.setAttribute('aria-hidden', 'true');
            const icon = tab.querySelector('.bn-icon');
            (icon || tab).appendChild(b);
        }
        const n = dmBadgeCount;
        if (n > 0) {
            b.textContent = n > 99 ? '99+' : String(n);
            b.classList.remove('oculto');
            tab.setAttribute('aria-label', 'Chat, ' + n + ' mensagem(ns) nova(s)');
        } else {
            b.classList.add('oculto');
            tab.removeAttribute('aria-label');
        }
    }

    function renderCombinedBadge() {
        renderChatTabBadge();
        const badge = document.getElementById('notif-badge');
        const btn = document.getElementById('btn-notif');
        if (!badge) return;
        const total = dmBadgeCount + (isAdminUser ? (adminEmpPendentes + adminAlertasN) : 0);
        if (total > 0) {
            badge.textContent = total > 99 ? '99+' : String(total);
            badge.classList.remove('oculto');
            if (btn) btn.classList.add('has-unread');
        } else {
            badge.classList.add('oculto');
            if (btn) btn.classList.remove('has-unread');
        }
    }

    function setAdminAlertas(n) {
        adminAlertasN = Math.max(0, Number(n) || 0);
        isAdminUser = true;
        renderCombinedBadge();
        fillAdminAlertasInDropdown();
    }

    function fillAdminAlertasInDropdown() {
        const list = document.getElementById('notif-dd-list');
        if (!list || !isAdminUser) return;
        let block = document.getElementById('notif-alerta-block');
        if (adminAlertasN <= 0) {
            if (block) block.remove();
            return;
        }
        const href = (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'admin.html#alertas';
        const html = '<a class="notif-dd-item notif-alerta-item" id="notif-alerta-block" href="' + href + '">' +
            '<strong>Alertas de crédito</strong>' +
            '<span>' + adminAlertasN + ' alerta(s) — a vencer ou em atraso</span></a>';
        if (block) block.outerHTML = html;
        else list.insertAdjacentHTML('afterbegin', html);
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
                showBrowserNotif('Minera Pará — Empréstimos', adminEmpPendentes + ' pedido(s) em análise');
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

    /**
     * Notificação do sistema. Usa o Service Worker (funciona no PWA Android) e cai para
     * new Notification. opts: { tag, url }. (Web Push com app fechado: ver sw.js 'push'.)
     */
    function showBrowserNotif(title, body, opts) {
        opts = opts || {};
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
            const options = {
                body: body || '',
                icon: root + 'icon-192.png',
                badge: root + 'icon-192.png',
                tag: opts.tag || 'minera',
                renotify: !!opts.tag,
                silent: false,
                vibrate: [80, 40, 80],
                data: { url: opts.url || (root + 'chat.html') }
            };
            const fallback = () => { try { new Notification(title, options); } catch (e) { /* ignore */ } };
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('sw timeout')), 2000));
                Promise.race([navigator.serviceWorker.ready, timeout])
                    .then((reg) => reg.showNotification(title, options))
                    .catch(fallback);
            } else {
                fallback();
            }
        } catch (e) { /* ignore */ }
    }

    /* ---------- Lembrete ao abrir o app (mensagens recebidas enquanto estava fora) ---------- */
    let lastUnread = [];
    let primeiroPollFeito = false;
    let lembretePendente = false;
    let notificarNoBootstrap = false;
    function kLembreteDismiss() { return 'minera_notif_lembrete_max_' + authId; }
    function paginaChat() {
        return !!(document.body && document.body.classList.contains('pagina-chat')) || /\/chat\.html$/i.test(location.pathname);
    }
    function escN(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function nomeSeguro(n) {
        n = String(n || '').trim();
        return (!n || /@/.test(n)) ? 'Alguém' : n;
    }
    /** chat.html com a conversa deste peer aberta e a aba visível? (contatoAtivo vem de chat.js) */
    function conversaAbertaCom(peer) {
        try {
            if (!paginaChat() || document.visibilityState !== 'visible') return false;
            // eslint-disable-next-line no-undef
            const ativo = (typeof contatoAtivo !== 'undefined') ? contatoAtivo : null;
            return !!(ativo && ativo.auth_id && ativo.auth_id === peer);
        } catch (e) { return false; }
    }
    function fecharLembrete() {
        const el = document.getElementById('notif-lembrete');
        if (el) el.remove();
    }
    function avaliarLembrete() {
        lembretePendente = false;
        if (!authId || paginaChat()) return;
        const unread = lastUnread;
        if (!unread.length) return;
        const maxId = unread.reduce((mx, m) => Math.max(mx, Number(m.id) || 0), 0);
        let dismissed = 0;
        try { dismissed = Number(localStorage.getItem(kLembreteDismiss()) || 0); } catch (e) { /* ignore */ }
        if (maxId <= dismissed) return;
        const peers = [];
        const nomes = {};
        unread.forEach(m => {
            if (!nomes[m.de_auth_id]) { nomes[m.de_auth_id] = nomeSeguro(m.de_nome); peers.push(m.de_auth_id); }
        });
        const n = unread.length;
        let de = 'de ' + nomes[peers[0]];
        if (peers.length === 2) de += ' e ' + nomes[peers[1]];
        else if (peers.length > 2) de += ', ' + nomes[peers[1]] + ' e mais ' + (peers.length - 2);
        const root = (typeof APP_ROOT === 'string' ? APP_ROOT : '');
        const href = root + 'chat.html' + (peers.length === 1 ? ('?para=' + encodeURIComponent(peers[0])) : '');
        fecharLembrete();
        const el = document.createElement('div');
        el.id = 'notif-lembrete';
        el.className = 'notif-lembrete';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<div class="nl-txt"><strong>📩 Você tem ' + n + ' mensage' + (n === 1 ? 'm nova' : 'ns novas') + '</strong>' +
            '<span>' + escN(de) + '</span></div>' +
            '<div class="nl-acoes"><button type="button" class="nl-depois">Depois</button>' +
            '<a class="nl-ver" href="' + href + '">Ver mensagens</a></div>';
        const sticky = document.getElementById('modo-ui-sticky');
        if (sticky && sticky.offsetParent !== null) {
            const r = sticky.getBoundingClientRect();
            if (r.bottom > 0) el.style.top = Math.round(r.bottom + 8) + 'px';
        }
        document.body.appendChild(el);
        try { sessionStorage.setItem('minera_notif_lembrete_visto_sessao', '1'); } catch (e) { /* ignore */ }
        const pc = document.getElementById('notif-perm-card');
        if (pc) pc.remove();
        const guardar = () => { try { localStorage.setItem(kLembreteDismiss(), String(maxId)); } catch (e) { /* ignore */ } };
        el.querySelector('.nl-depois').addEventListener('click', () => { guardar(); fecharLembrete(); });
        el.querySelector('.nl-ver').addEventListener('click', () => { guardar(); });
    }

    async function poll() {
        if (!authId || typeof supabaseClient === 'undefined') return;
        try {
            const leituras = lsLeituras();
            const { data, error } = await supabaseClient
                .from('chat_mensagens')
                .select('id,de_auth_id,de_nome,para_auth_id,texto,tipo,criado_em,status,deleted_at,apagada_para')
                .eq('para_auth_id', authId)
                .is('deleted_at', null)
                .order('id', { ascending: false })
                .limit(100);
            if (error) { primeiroPollFeito = true; lembretePendente = false; return; }

            const unread = [];
            const byPeer = {};
            (data || []).forEach(m => {
                if ((m.status || '') === 'agendada') return;
                if (Array.isArray(m.apagada_para) && m.apagada_para.indexOf(authId) >= 0) return;
                const lastRead = Number(leituras[m.de_auth_id] || 0);
                if (Number(m.id) > lastRead) {
                    unread.push(m);
                    if (!byPeer[m.de_auth_id]) byPeer[m.de_auth_id] = m;
                }
            });

            // Contagem = mensagens não lidas (sino, aba Chat e lembrete usam o mesmo número)
            lastUnread = unread;
            primeiroPollFeito = true;
            updateBadge(unread.length);
            if (lembretePendente) avaliarLembrete();
            else if (!unread.length) fecharLembrete();

            // Toast / browser notif for newly seen ids after bootstrap
            const fresh = (data || []).filter(m =>
                Number(m.id) > lsSeenGlobal() &&
                (!bootstrapped || !knownIds.has(m.id)) &&
                (m.status || '') !== 'agendada' &&
                !(Array.isArray(m.apagada_para) && m.apagada_para.indexOf(authId) >= 0) &&
                Number(m.id) > Number(lsLeituras()[m.de_auth_id] || 0)
            );
            // Troca de página no meio da sessão: avisa as que chegaram durante a navegação
            const avisar = bootstrapped ? fresh : (notificarNoBootstrap && lsSeenGlobal() > 0 ? fresh : []);
            if (!bootstrapped) {
                (data || []).forEach(m => knownIds.add(m.id));
                if (data && data[0]) setSeenGlobal(data[0].id);
                bootstrapped = true;
            }
            {
                let tocarPim = false, tocarTick = false;
                avisar.forEach(m => {
                    knownIds.add(m.id);
                    setSeenGlobal(m.id);
                    // Conversa aberta e visível no chat: chat.js já mostra/marca como lida → só um "tick" discreto
                    if (conversaAbertaCom(m.de_auth_id)) { tocarTick = true; return; }
                    tocarPim = true;
                    let nome = m.de_nome || 'Alguém';
                    if (/@/.test(String(nome))) nome = 'Alguém';
                    const preview = (m.texto || (m.tipo && m.tipo !== 'text' ? '[' + m.tipo + ']' : 'Nova mensagem')).slice(0, 80);
                    if (typeof toastMsg === 'function') toastMsg('Nova mensagem de ' + nome);
                    showBrowserNotif('Minera Pará — ' + nome, preview, {
                        tag: 'dm-' + m.de_auth_id,
                        url: (typeof APP_ROOT === 'string' ? APP_ROOT : '') + 'chat.html?para=' + encodeURIComponent(m.de_auth_id)
                    });
                });
                // Um som por evento (MineraSom tem throttle de 2 s)
                if (tocarPim && window.MineraSom) MineraSom.pim();
                else if (tocarTick && window.MineraSom) MineraSom.tick();
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
                fillAdminAlertasInDropdown();
            }
            // Admin: poll pending loans for bell badge
            if (isAdminUser) {
                try {
                    const { data: nEmp, error: empErr } = await supabaseClient.rpc('admin_contar_emprestimos_pendentes');
                    if (!empErr && nEmp != null) setAdminEmpPendentes(Number(nEmp) || 0);
                } catch (empE) { /* SQL 23 optional until applied */ }
                try {
                    const { data: nAl, error: alErr } = await supabaseClient.rpc('admin_contar_alertas_nao_lidos');
                    if (!alErr && nAl != null) setAdminAlertas(Number(nAl) || 0);
                } catch (alE) { /* SQL 30 optional until applied */ }
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
                // Permissão de notificação: só pelo card "Ativar avisos" / Perfil → Configurações
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
        renderCombinedBadge();
        if (started) return;
        started = true;
        // Lembrete: 1ª checagem de cada sessão do app
        const kSess = 'minera_notif_lembrete_sessao_' + uid;
        try {
            if (sessionStorage.getItem(kSess) !== '1') {
                sessionStorage.setItem(kSess, '1');
                lembretePendente = true;
            } else {
                notificarNoBootstrap = true;
            }
        } catch (e) { lembretePendente = true; }
        poll();
        timer = setInterval(poll, 8000);
        let hiddenAt = 0;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
            // Voltou ao app: checa já; lembra de novo se ficou > 5 min fora
            if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) lembretePendente = true;
            hiddenAt = 0;
            poll();
        });
    }

    /** Para coordenação (Pix de apoio): lembrete ainda pode aparecer / está na tela? */
    function lembreteOcupado() {
        if (document.getElementById('notif-lembrete')) return true;
        return started && (!primeiroPollFeito || lembretePendente);
    }
    return { start, poll, updateBadge, setAdminEmpPendentes, setAdminAlertas, renderCombinedBadge, showBrowserNotif, avaliarLembrete, lembreteOcupado };
})();
window.MineraNotif = MineraNotif;

/**
 * Permissão de avisos de mensagem — mesma filosofia do geo.js: NUNCA pede ao carregar.
 * Só pede ao tocar em "Ativar" (card no Início ou Perfil → Configurações).
 * localStorage minera_notif_decidido = granted|denied ; minera_notif_adiado_ate = timestamp (7 dias).
 */
const MineraNotifPerm = (function () {
    const K_DEC = 'minera_notif_decidido';
    const K_ADIADO = 'minera_notif_adiado_ate';
    const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
    function suportado() { return typeof window !== 'undefined' && 'Notification' in window; }
    function estado() {
        if (!suportado()) return 'unsupported';
        return Notification.permission; // default | granted | denied
    }
    function ls(k, v) {
        try {
            if (v === undefined) return localStorage.getItem(k);
            if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        } catch (e) { /* ignore */ }
        return null;
    }
    function sincronizar() {
        const st = estado();
        if (st === 'granted' || st === 'denied') ls(K_DEC, st);
        return st;
    }
    function adiado() { return Number(ls(K_ADIADO) || 0) > Date.now(); }
    function deveMostrarCard() {
        // Prioridade: lembrete de mensagens > Pix de apoio > este card (espera outra sessão)
        try {
            if (sessionStorage.getItem('minera_apoio_mostrar') === '1' || sessionStorage.getItem('minera_apoio_visto_sessao') === '1') return false;
            if (sessionStorage.getItem('minera_notif_lembrete_visto_sessao') === '1') return false;
        } catch (e) { /* ignore */ }
        if (document.getElementById('notif-lembrete')) return false;
        const st = sincronizar();
        if (st !== 'default') return false;
        if (ls(K_DEC) === 'granted' || ls(K_DEC) === 'denied') return false;
        return !adiado();
    }
    function adiar() { ls(K_ADIADO, String(Date.now() + SETE_DIAS)); }
    async function pedir() {
        if (!suportado()) return 'unsupported';
        let r;
        try { r = await Notification.requestPermission(); } catch (e) { r = Notification.permission; }
        if (r === 'granted' || r === 'denied') ls(K_DEC, r);
        else adiar(); // fechou o prompt sem decidir
        atualizarUis();
        if (r === 'granted' && typeof toastMsg === 'function') toastMsg('Avisos de mensagem ativados');
        return r;
    }
    function fecharCard() {
        const c = document.getElementById('notif-perm-card');
        if (c) c.remove();
    }
    /** Card pequeno e dispensável (Início). */
    function montarCard(parent, before) {
        if (!parent || document.getElementById('notif-perm-card')) return;
        if (!deveMostrarCard()) return;
        const el = document.createElement('div');
        el.id = 'notif-perm-card';
        el.className = 'notif-perm-card';
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', 'Ativar avisos de mensagem');
        el.innerHTML = '<div class="npc-txt"><strong>🔔 Ativar avisos de mensagem</strong>' +
            '<span>Saiba na hora quando alguém responder seu anúncio.</span></div>' +
            '<div class="npc-acoes"><button type="button" class="npc-nao">Agora não</button>' +
            '<button type="button" class="npc-sim">Ativar</button></div>';
        parent.insertBefore(el, before || null);
        el.querySelector('.npc-nao').addEventListener('click', () => { adiar(); fecharCard(); });
        el.querySelector('.npc-sim').addEventListener('click', async () => { await pedir(); fecharCard(); });
    }
    /** Linha dentro de Perfil → ⚙️ Configurações. */
    function montarToggle(host) {
        if (!host) return;
        host.classList.add('notif-perm-row');
        host.innerHTML = '<div class="npr-txt"><strong>🔔 Avisos de mensagem</strong><span class="npr-st"></span></div>' +
            '<button type="button" class="npr-btn"></button><p class="npr-help sub oculto"></p>';
        host.querySelector('.npr-btn').addEventListener('click', async () => {
            if (estado() === 'default') await pedir();
            atualizarUis();
        });
        atualizarToggle(host);
    }
    function atualizarToggle(host) {
        host = host || document.getElementById('notif-perm-toggle');
        if (!host || !host.querySelector('.npr-btn')) return;
        const st = sincronizar();
        const btn = host.querySelector('.npr-btn');
        const lbl = host.querySelector('.npr-st');
        const help = host.querySelector('.npr-help');
        help.classList.add('oculto');
        btn.disabled = false;
        btn.classList.remove('on');
        btn.setAttribute('role', 'switch');
        btn.setAttribute('aria-checked', st === 'granted' ? 'true' : 'false');
        if (st === 'granted') {
            lbl.textContent = 'Ativado neste aparelho';
            btn.textContent = 'Ativado';
            btn.classList.add('on');
            btn.disabled = true;
            help.textContent = 'Para desativar, use as configurações de notificação do navegador/celular.';
            help.classList.remove('oculto');
        } else if (st === 'denied') {
            lbl.textContent = 'Bloqueado no navegador';
            btn.textContent = 'Bloqueado';
            btn.disabled = true;
            help.textContent = 'Bloqueado no navegador. Para liberar: toque no cadeado ao lado do endereço (ou Configurações do app → Notificações) e permita notificações para o Minera Pará.';
            help.classList.remove('oculto');
        } else if (st === 'unsupported') {
            lbl.textContent = 'Este navegador não suporta avisos';
            btn.textContent = 'Indisponível';
            btn.disabled = true;
        } else {
            lbl.textContent = 'Desativado';
            btn.textContent = 'Ativar';
        }
    }
    function atualizarUis() {
        atualizarToggle();
        if (!deveMostrarCard()) fecharCard();
    }
    return { estado, pedir, adiar, deveMostrarCard, montarCard, montarToggle, atualizarToggle, sincronizar };
})();
window.MineraNotifPerm = MineraNotifPerm;

/**
 * Som de nova mensagem ("pim"): 2 notas senoidais geradas com Web Audio (sem arquivo).
 * Desbloqueia o AudioContext no 1º toque/tecla da sessão; falha em silêncio se bloqueado.
 * Throttle: no máximo 1 som a cada 2 s. Liga/desliga: localStorage minera_notif_som ('0' = off).
 */
const MineraSom = (function () {
    const K = 'minera_notif_som';
    const THROTTLE_MS = 2000;
    let ctx = null;
    let last = 0;
    function ativo() {
        try { return localStorage.getItem(K) !== '0'; } catch (e) { return true; }
    }
    function setAtivo(on) {
        try { localStorage.setItem(K, on ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    function unlock() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!ctx) ctx = new AC();
            if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
            if (ctx.state === 'running') removerUnlock();
        } catch (e) { /* ignore */ }
    }
    const EVS = ['pointerdown', 'touchend', 'keydown', 'click'];
    function removerUnlock() { EVS.forEach(ev => document.removeEventListener(ev, unlock, true)); }
    EVS.forEach(ev => document.addEventListener(ev, unlock, { capture: true, passive: true }));
    function nota(freq, t0, dur, vol) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    function podeTocar() {
        if (!ativo() || !ctx || ctx.state !== 'running') return false;
        const now = Date.now();
        if (now - last < THROTTLE_MS) return false;
        last = now;
        return true;
    }
    /** "pim" — 880 Hz → 1320 Hz, ~120 ms cada, volume baixo. */
    function pim() {
        try {
            if (!podeTocar()) return false;
            const t = ctx.currentTime + 0.01;
            nota(880, t, 0.12, 0.12);
            nota(1320, t + 0.12, 0.16, 0.1);
            return true;
        } catch (e) { return false; }
    }
    /** "tick" bem discreto (conversa aberta). */
    function tick() {
        try {
            if (!podeTocar()) return false;
            nota(1500, ctx.currentTime + 0.01, 0.05, 0.02);
            return true;
        } catch (e) { return false; }
    }
    /** Linha "Som de mensagem" em Perfil → ⚙️ Configurações. */
    function montarToggle(host) {
        if (!host) return;
        host.classList.add('notif-perm-row');
        host.innerHTML = '<div class="npr-txt"><strong>🔊 Som de mensagem</strong><span class="npr-st"></span></div>' +
            '<button type="button" class="npr-btn npr-som" role="switch"></button>';
        const btn = host.querySelector('.npr-btn');
        const st = host.querySelector('.npr-st');
        function render() {
            const on = ativo();
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            btn.textContent = on ? 'Ligado' : 'Desligado';
            btn.classList.toggle('som-off', !on);
            st.textContent = on ? 'Toca um "pim" quando chega mensagem' : 'Sem som ao chegar mensagem';
        }
        btn.addEventListener('click', () => {
            setAtivo(!ativo());
            render();
            if (ativo()) { unlock(); last = 0; setTimeout(pim, 30); }
        });
        render();
    }
    return { pim, tick, ativo, setAtivo, montarToggle, unlock, _ctx: () => ctx };
})();
window.MineraSom = MineraSom;

/**
 * Card "Pix de apoio" (vaquinha voluntária) — 1x por ENTRADA no app (login ou novo lançamento).
 * Mesma fonte do Perfil: flag vaquinha_ativa (isVaquinhaAtiva) + chave ativa de pix_admin.
 * Nunca: admin, vaquinha desligada, chave vazia, chat.html/tutorial (adia p/ próxima página),
 * junto com o lembrete de mensagens (espera ele sair).
 */
const MineraApoio = (function () {
    const K_MOSTRAR = 'minera_apoio_mostrar';
    const K_VISTO = 'minera_apoio_visto_sessao';
    let rodando = false;
    function ss(k, v) {
        try {
            if (v === undefined) return sessionStorage.getItem(k);
            if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
        } catch (e) { /* ignore */ }
        return null;
    }
    function pendente() { return ss(K_MOSTRAR) === '1'; }
    function concluir() { ss(K_MOSTRAR, null); ss(K_VISTO, '1'); }
    function paginaAdiavel() {
        const p = (location.pathname || '').toLowerCase();
        return /\/(chat|tutorial|index|admin)\.html$/.test(p);
    }
    function escA(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    async function copiar(txt) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); return true; }
        } catch (e) { /* fallback */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            const ok = document.execCommand('copy'); ta.remove(); return ok;
        } catch (e) { return false; }
    }
    function fechar() {
        const el = document.getElementById('apoio-pix-modal');
        if (el) el.remove();
        document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) { if (e.key === 'Escape') fechar(); }
    function mostrar(pix) {
        if (document.getElementById('apoio-pix-modal')) return;
        const chave = String(pix.chave_pix || '').trim();
        const el = document.createElement('div');
        el.id = 'apoio-pix-modal';
        el.className = 'apoio-pix-modal';
        el.innerHTML = '<div class="apm-backdrop" data-apm-close="1"></div>' +
            '<div class="apm-card" role="dialog" aria-modal="true" aria-labelledby="apm-titulo">' +
            '<button type="button" class="apm-x" data-apm-close="1" aria-label="Fechar">&times;</button>' +
            '<div class="apm-ico" aria-hidden="true">💛</div>' +
            '<h2 id="apm-titulo">Apoie o Minera Pará</h2>' +
            '<p class="apm-txt">Faça um Pix de qualquer valor para ajudar a desenvolver o produto cada vez melhor — mais segurança nas suas compras e vendas. É só uma iniciativa voluntária; sem obrigação.</p>' +
            '<div class="apm-chave"><span>Chave Pix' + (pix.tipo_chave ? ' (' + escA(pix.tipo_chave) + ')' : '') + '</span><strong>' + escA(chave) + '</strong>' +
            (pix.titular ? '<small>' + escA(pix.titular) + '</small>' : '') + '</div>' +
            '<button type="button" class="apm-copiar">📋 Copiar chave Pix</button>' +
            '<button type="button" class="apm-depois" data-apm-close="1">Agora não</button>' +
            '</div>';
        document.body.appendChild(el);
        concluir();
        el.addEventListener('click', (e) => {
            if (e.target.closest && e.target.closest('[data-apm-close]')) fechar();
        });
        el.querySelector('.apm-copiar').addEventListener('click', async () => {
            const ok = await copiar(chave);
            if (typeof toastMsg === 'function') toastMsg(ok ? 'Chave Pix copiada' : 'Não deu para copiar — segure a chave para copiar');
            if (ok) setTimeout(fechar, 600);
        });
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => { const x = el.querySelector('.apm-copiar'); try { x.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
    }
    async function talvezMostrar(perfil) {
        if (rodando || !pendente() || !perfil) return;
        // Admin (usuário admin ou modo monitoramento): nunca
        if ((typeof ehAdmin === 'function' && ehAdmin(perfil)) || document.body.classList.contains('modo-ui-admin') || document.body.classList.contains('pagina-admin')) { concluir(); return; }
        if (paginaAdiavel()) return; // fica pendente para a próxima página da sessão
        rodando = true;
        try {
            if (typeof isVaquinhaAtiva === 'function' && !(await isVaquinhaAtiva())) { concluir(); return; }
            const { data, error } = await supabaseClient.from('pix_admin').select('*').eq('ativo', true)
                .order('atualizado_em', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(1);
            const pix = !error && data && data[0];
            if (!pix || !String(pix.chave_pix || '').trim()) { concluir(); return; }
            // Espera o lembrete de mensagens (prioridade) sair; "Ver mensagens" navega → próxima página
            for (let i = 0; i < 240; i++) {
                const ocupado = window.MineraNotif && MineraNotif.lembreteOcupado && MineraNotif.lembreteOcupado();
                if (!ocupado) break;
                await new Promise(r => setTimeout(r, 500));
            }
            if (!pendente()) return;
            if (document.getElementById('notif-lembrete')) return;
            const pc = document.getElementById('notif-perm-card');
            if (pc) pc.remove();
            mostrar(pix);
        } catch (e) {
            console.warn('apoio pix', e);
        } finally {
            rodando = false;
        }
    }
    return { talvezMostrar, pendente, fechar };
})();
window.MineraApoio = MineraApoio;



(function initVoltarPagina() {
    function run() { try { garantirBotaoVoltarPagina(); } catch (e) { console.warn('voltar', e); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();

(function antiAutoZoomTap() {
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (e) {
        const now = Date.now();
        const t = e.target;
        const tag = (t && t.tagName) ? t.tagName.toUpperCase() : '';
        const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)
            || !!(t && t.closest && t.closest('#minera-lightbox'));
        if (!editable && now - lastTouchEnd <= 280 && e.touches.length === 0) {
            /* Bloqueia double-tap zoom; pinça com 2 dedos continua liberada */
            e.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });
})();
