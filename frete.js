let perfilAtual = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function labelPerna(p) {
    if (p === 'mina_britador') return 'Mina → Britador';
    if (p === 'britador_porto') return 'Britador → Porto';
    return p || '—';
}

async function carregarLotesSelect() {
    const sel = document.getElementById('frete_lote_id');
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('id, codigo_lote, tipo_minerio, peso_bruto_kg')
            .order('id', { ascending: false })
            .limit(100);
        if (error) throw error;
        sel.innerHTML = '<option value="">—</option>' + (data || []).map(l =>
            `<option value="${l.id}">${esc(l.codigo_lote)}${l.tipo_minerio ? ' · ' + esc(l.tipo_minerio) : ''} (${l.peso_bruto_kg} kg)</option>`
        ).join('');
    } catch (e) {
        console.warn(e);
    }
}

async function carregarFretes() {
    const box = document.getElementById('frete-lista');
    try {
        const { data, error } = await supabaseClient
            .from('fretes')
            .select('*')
            .order('id', { ascending: false })
            .limit(50);
        if (error) throw error;
        if (!data.length) {
            box.innerHTML = '<p>Nenhum frete agendado ainda.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Perna</th><th>Origem</th><th>Destino</th><th>Veículo</th><th>Peso</th><th>Status</th><th>Por</th></tr></thead><tbody>' +
            data.map(f => `<tr>
                <td>${esc(labelPerna(f.perna))}</td>
                <td>${esc(f.origem || '—')}</td>
                <td>${esc(f.destino || '—')}</td>
                <td>${esc(f.veiculo || '—')}</td>
                <td>${f.peso_kg != null ? f.peso_kg : '—'}</td>
                <td><span class="badge badge-${esc(f.status || 'agendado')}">${esc(f.status || 'agendado')}</span></td>
                <td>${esc(f.criado_por || '—')}</td>
            </tr>`).join('') +
            '</tbody></table></div>';
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Erro ao carregar fretes. Confira se o SQL 08 já foi aplicado no Supabase.</p>';
    }
}

document.getElementById('form-frete').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('frete-msg');
    const loteVal = document.getElementById('frete_lote_id').value;
    const pesoRaw = document.getElementById('peso_kg').value;
    const { data: { session } } = await supabaseClient.auth.getSession();
    const nome = (perfilAtual && perfilAtual.nome) ||
        (session && session.user && session.user.email) || 'Usuário';
    const row = {
        lote_id: loteVal ? parseInt(loteVal, 10) : null,
        perna: document.getElementById('perna').value,
        origem: document.getElementById('origem').value.trim(),
        destino: document.getElementById('destino').value.trim(),
        veiculo: document.getElementById('veiculo').value.trim() || null,
        motorista: document.getElementById('motorista').value.trim() || null,
        peso_kg: pesoRaw === '' ? null : parseFloat(pesoRaw),
        status: document.getElementById('status').value || 'agendado',
        observacoes: document.getElementById('observacoes').value.trim() || null,
        criado_por: nome,
        criado_por_id: session && session.user ? session.user.id : null
    };
    const { error } = await supabaseClient.from('fretes').insert([row]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    msgEl.textContent = 'Frete salvo!';
    msgEl.className = 'msg ok';
    await registrarLog('frete_criar', { perna: row.perna, lote_id: row.lote_id }, perfilAtual);
    document.getElementById('form-frete').reset();
    carregarFretes();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('frete', perfilAtual);
    await carregarLotesSelect();
    carregarFretes();
})();
