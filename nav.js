/** Nav chips por papéis — união se múltiplos; admin/vazio → todos. Sempre Perfil + Sair. */

const NAV_ITENS = [
    { id: 'inicio', label: 'Feed', href: 'inicio.html' },
    { id: 'lotes', label: 'Meus Lotes', href: 'lotes.html' },
    { id: 'britagem', label: 'Britagem', href: 'processamento.html' },
    { id: 'estoque', label: 'Estoque', href: 'estoque.html' },
    { id: 'expedicao', label: 'Expedição', href: 'expedicao.html' },
    { id: 'frete', label: 'Logística', href: 'frete.html' },
    { id: 'chat', label: 'Chat', href: 'chat.html' },
    { id: 'relatorios', label: 'Relatórios', href: 'relatorios.html' },
    { id: 'perfil', label: 'Perfil', href: 'perfil.html' }
];

const PAPEIS_CHIPS = {
    minerador: ['inicio', 'lotes', 'chat'],
    comprador: ['inicio', 'chat'],
    transportador: ['inicio', 'frete', 'chat'],
    transportador_mina_britador: ['inicio', 'frete', 'chat'],
    transportador_britador_porto: ['inicio', 'frete', 'chat'],
    dono_britador: ['inicio', 'britagem', 'estoque', 'chat'],
    carregamento: ['inicio', 'expedicao', 'frete', 'chat'],
    admin: NAV_ITENS.map(i => i.id)
};

function chipsPermitidos(perfil) {
    const allIds = NAV_ITENS.map(i => i.id);
    if (!perfil) return allIds;
    if (typeof ehAdmin === 'function' && ehAdmin(perfil)) return allIds;
    const papeis = Array.isArray(perfil.papeis) ? perfil.papeis : [];
    if (!papeis.length) return allIds;
    const set = new Set(['perfil']);
    papeis.forEach(p => {
        const key = String(p).toLowerCase();
        const chips = PAPEIS_CHIPS[key];
        if (chips) chips.forEach(c => set.add(c));
        else if (key === 'admin') allIds.forEach(c => set.add(c));
    });
    return allIds.filter(id => set.has(id));
}

function montarNav(paginaAtiva, perfil) {
    const permitidos = new Set(chipsPermitidos(perfil));
    const itens = NAV_ITENS.filter(it => permitidos.has(it.id));
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    nav.className = 'nav-chips';
    nav.innerHTML = itens.map(it => {
        const on = it.id === paginaAtiva ? ' on' : '';
        return '<a class="chip' + on + '" href="' + APP_ROOT + it.href + '">' + it.label + '</a>';
    }).join('') +
    '<button type="button" class="chip chip-sair" id="nav-sair">Sair</button>';

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

    const legado = document.getElementById('btn-sair');
    if (legado) legado.classList.add('oculto');
}
