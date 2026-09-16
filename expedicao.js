let perfilAtual = null;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function carregarSelects() {
    const [lotes, estoque] = await Promise.all([
        supabaseClient.from('lotes').select('id, codigo_lote').order('id', { ascending: false }),
        supabaseClient.from('estoque').select('id, tipo_material, peso_atual_kg').order('id', { ascending: false })
    ]);
    const sl = document.getElementById('exp_lote_id');
    sl.innerHTML = '<option value="">—</option>' +
        ((lotes.data || []).map(l => `<option value="${l.id}">${esc(l.codigo_lote)}</option>`).join(''));
    const se = document.getElementById('exp_estoque_id');
    se.innerHTML = '<option value="">—</option>' +
        ((estoque.data || []).map(e => `<option value="${e.id}">${esc(e.tipo_material)} (${e.peso_atual_kg} kg)</option>`).join(''));
}

async function carregarExp() {
    const box = document.getElementById('exp-lista');
    try {
        const { data, error } = await supabaseClient
            .from('expedicao')
            .select('*')
            .order('id', { ascending: false })
            .limit(100);
        if (error) throw error;
        if (!data.length) {
            box.innerHTML = '<p>Nenhuma expedição.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Destino</th><th>Qtd (kg)</th><th>NF</th><th>Valor</th><th>Data</th><th>Lote</th></tr></thead><tbody>' +
            data.map(x => `<tr>
                <td><b>${esc(x.destino)}</b></td>
                <td>${x.quantidade_kg}</td>
                <td>${esc(x.nota_fiscal || '—')}</td>
                <td>${x.valor_total != null ? 'R$ ' + Number(x.valor_total).toLocaleString('pt-BR') : '—'}</td>
                <td>${x.data_expedicao ? new Date(x.data_expedicao).toLocaleString('pt-BR') : '—'}</td>
                <td>${x.lote_id || '—'}</td>
            </tr>`).join('') + '</tbody></table></div>';
    } catch (err) {
        console.error(err);
        box.innerHTML = '<p class="erro">Erro: ' + esc(err.message) + '</p>';
    }
}

document.getElementById('form-exp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('exp-msg');
    const loteVal = document.getElementById('exp_lote_id').value;
    const estVal = document.getElementById('exp_estoque_id').value;
    const row = {
        lote_id: loteVal ? parseInt(loteVal, 10) : null,
        estoque_id: estVal ? parseInt(estVal, 10) : null,
        quantidade_kg: parseFloat(document.getElementById('quantidade_kg').value),
        destino: document.getElementById('destino').value.trim(),
        nota_fiscal: document.getElementById('nota_fiscal').value.trim() || null,
        valor_total: document.getElementById('valor_total').value
            ? parseFloat(document.getElementById('valor_total').value) : null
    };
    const { error } = await supabaseClient.from('expedicao').insert([row]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    if (row.lote_id) {
        await supabaseClient.from('lotes').update({ status: 'expedido' }).eq('id', row.lote_id);
    }
    await registrarLog('expedicao_criar', row, perfilAtual);
    msgEl.textContent = 'Expedição registrada!';
    msgEl.className = 'msg ok';
    document.getElementById('form-exp').reset();
    carregarSelects();
    carregarExp();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('expedicao', perfilAtual);
    await carregarSelects();
    carregarExp();
})();
