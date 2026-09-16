/** Nav chips compartilhados — Início, Lotes, Britagem, Estoque, Expedição, Chat, Relatórios, Sair */

function montarNav(paginaAtiva) {
    const itens = [
        { id: 'inicio', label: 'Início', href: 'inicio.html' },
        { id: 'lotes', label: 'Lotes', href: 'lotes.html' },
        { id: 'britagem', label: 'Britagem', href: 'processamento.html' },
        { id: 'estoque', label: 'Estoque', href: 'estoque.html' },
        { id: 'expedicao', label: 'Expedição', href: 'expedicao.html' },
        { id: 'chat', label: 'Chat', href: 'chat.html' },
        { id: 'relatorios', label: 'Relatórios', href: 'relatorios.html' }
    ];
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

    // Esconde btn-sair legado do header se existir (nav já tem Sair)
    const legado = document.getElementById('btn-sair');
    if (legado) legado.classList.add('oculto');
}
