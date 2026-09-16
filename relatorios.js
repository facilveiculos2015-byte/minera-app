let perfilAtual = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kpiCard(label, value) {
    return `<div class="kpi-card"><div class="kpi-value">${value}</div><div class="kpi-label">${esc(label)}</div></div>`;
}

async function carregarKpis() {
    const grid = document.getElementById('kpi-grid');
    try {
        const [lotes, proc, estoque, exp] = await Promise.all([
            supabaseClient.from('lotes').select('id, peso_bruto_kg, status'),
            supabaseClient.from('processamento').select('id, peso_saida_kg'),
            supabaseClient.from('estoque').select('id, peso_atual_kg'),
            supabaseClient.from('expedicao').select('id, quantidade_kg, valor_total')
        ]);

        const L = lotes.data || [];
        const P = proc.data || [];
        const E = estoque.data || [];
        const X = exp.data || [];

        const sum = (arr, key) => arr.reduce((a, r) => a + (Number(r[key]) || 0), 0);
        const pesoLotes = sum(L, 'peso_bruto_kg');
        const pesoProc = sum(P, 'peso_saida_kg');
        const pesoEst = sum(E, 'peso_atual_kg');
        const pesoExp = sum(X, 'quantidade_kg');
        const valorExp = sum(X, 'valor_total');
        const pendentes = L.filter(l => (l.status || '') === 'pendente').length;

        grid.innerHTML =
            kpiCard('Lotes', L.length) +
            kpiCard('Peso lotes (kg)', pesoLotes.toLocaleString('pt-BR')) +
            kpiCard('Pendentes', pendentes) +
            kpiCard('Britagens', P.length) +
            kpiCard('Peso processado (kg)', pesoProc.toLocaleString('pt-BR')) +
            kpiCard('Itens estoque', E.length) +
            kpiCard('Peso estoque (kg)', pesoEst.toLocaleString('pt-BR')) +
            kpiCard('Expedições', X.length) +
            kpiCard('Peso expedido (kg)', pesoExp.toLocaleString('pt-BR')) +
            kpiCard('Valor expedido (R$)', valorExp.toLocaleString('pt-BR'));
    } catch (err) {
        console.error(err);
        grid.innerHTML = '<p class="erro">Erro ao carregar KPIs: ' + esc(err.message) + '</p>';
    }
}

async function carregarLogs() {
    const box = document.getElementById('logs-lista');
    try {
        const { data, error } = await supabaseClient
            .from('logs_sistema')
            .select('*')
            .order('id', { ascending: false })
            .limit(30);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum log ainda.</p>';
            return;
        }
        box.innerHTML = '<ul class="log-list">' + data.map(l => {
            const when = l.data_hora ? new Date(l.data_hora).toLocaleString('pt-BR') : '';
            const det = l.detalhes ? (typeof l.detalhes === 'string' ? l.detalhes : JSON.stringify(l.detalhes)) : '';
            return `<li><span class="log-when">${when}</span> <b>${esc(l.acao)}</b> ${esc(det)}</li>`;
        }).join('') + '</ul>';
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="sub">Logs não legíveis agora: ' + esc(err.message) + '</p>';
    }
}

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('relatorios', perfilAtual);
    await carregarKpis();
    await carregarLogs();
    renderHistRelatorios();
})();


function renderHistRelatorios() {
    const box = document.getElementById('cotacoes-historico-rel');
    if (!box) return;
    let arr = [];
    try {
        const raw = localStorage.getItem('minera_cot_historico');
        arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) arr = [];
    } catch (e) { arr = []; }
    arr = arr.slice().reverse().slice(0, 24);
    if (!arr.length) {
        box.innerHTML = '<p class="sub">Sem histórico ainda. Abra o Feed para capturar cotações.</p>';
        return;
    }
    const labels = { USD: 'Dólar', XAU: 'Ouro', HG: 'Cobre' };
    box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        '<th>Quando</th><th>Símbolo</th><th>USD</th><th>BRL</th><th>Fonte</th></tr></thead><tbody>' +
        arr.map(p => {
            const when = p.capturado_em ? new Date(p.capturado_em).toLocaleString('pt-BR') : '—';
            const usd = p.valor_usd != null ? Number(p.valor_usd).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
            const brl = p.valor_brl != null ? Number(p.valor_brl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
            return `<tr><td>${when}</td><td>${labels[p.simbolo] || p.simbolo || '—'}</td><td>${usd}</td><td>${brl}</td><td>${esc(p.fonte || '')}</td></tr>`;
        }).join('') + '</tbody></table></div>';
    // try hydrate from DB
    (async () => {
        try {
            const { data, error } = await supabaseClient
                .from('cotacoes_historico')
                .select('*')
                .order('capturado_em', { ascending: false })
                .limit(30);
            if (error || !data || !data.length) return;
            box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
                '<th>Quando</th><th>Símbolo</th><th>USD</th><th>BRL</th><th>Fonte</th></tr></thead><tbody>' +
                data.map(p => {
                    const when = p.capturado_em ? new Date(p.capturado_em).toLocaleString('pt-BR') : '—';
                    const usd = p.valor_usd != null ? Number(p.valor_usd).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
                    const brl = p.valor_brl != null ? Number(p.valor_brl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
                    return `<tr><td>${when}</td><td>${labels[p.simbolo] || esc(p.simbolo) || '—'}</td><td>${usd}</td><td>${brl}</td><td>${esc(p.fonte || '')}</td></tr>`;
                }).join('') + '</tbody></table></div>';
        } catch (e) { /* ignore */ }
    })();
}
