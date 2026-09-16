let perfilAtual = null;
let lotesCache = {};

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toIso(localVal) {
    if (!localVal) return null;
    const d = new Date(localVal);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

async function carregarSelectLotes() {
    const sel = document.getElementById('lote_id');
    const { data, error } = await supabaseClient
        .from('lotes')
        .select('id, codigo_lote, status, peso_bruto_kg')
        .order('id', { ascending: false });
    if (error) {
        sel.innerHTML = '<option value="">Erro ao carregar lotes</option>';
        return;
    }
    lotesCache = {};
    (data || []).forEach(l => { lotesCache[l.id] = l; });
    sel.innerHTML = '<option value="">Selecione o lote</option>' +
        (data || []).map(l => `<option value="${l.id}">${esc(l.codigo_lote)} (${l.peso_bruto_kg} kg · ${esc(l.status)})</option>`).join('');
}

async function carregarProc() {
    const box = document.getElementById('proc-lista');
    try {
        const { data, error } = await supabaseClient
            .from('processamento')
            .select('*, lotes(codigo_lote)')
            .order('id', { ascending: false })
            .limit(100);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p>Nenhum processamento registrado.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Lote</th><th>Britador</th><th>Saída (kg)</th><th>Início</th><th>Fim</th><th>Obs</th></tr></thead><tbody>' +
            data.map(p => {
                const cod = (p.lotes && p.lotes.codigo_lote) || ('#' + p.lote_id);
                return `<tr>
                    <td>${esc(cod)}</td>
                    <td>${esc(p.britador_id || '—')}</td>
                    <td>${p.peso_saida_kg}</td>
                    <td>${p.inicio_processo ? new Date(p.inicio_processo).toLocaleString('pt-BR') : '—'}</td>
                    <td>${p.fim_processo ? new Date(p.fim_processo).toLocaleString('pt-BR') : '—'}</td>
                    <td>${esc(p.observacoes || '')}</td>
                </tr>`;
            }).join('') + '</tbody></table></div>';
    } catch (err) {
        console.error(err);
        // fallback sem join
        try {
            const { data, error } = await supabaseClient.from('processamento').select('*').order('id', { ascending: false }).limit(100);
            if (error) throw error;
            if (!data.length) { box.innerHTML = '<p>Nenhum processamento.</p>'; return; }
            box.innerHTML = '<ul>' + data.map(p =>
                `<li>Lote #${p.lote_id} · ${esc(p.britador_id)} · ${p.peso_saida_kg} kg</li>`
            ).join('') + '</ul>';
        } catch (e2) {
            box.innerHTML = '<p class="erro">Erro ao carregar: ' + esc(e2.message || err.message) + '</p>';
        }
    }
}

document.getElementById('form-proc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('proc-msg');
    const lote_id = parseInt(document.getElementById('lote_id').value, 10);
    const britador_id = document.getElementById('britador_id').value.trim();
    const peso_saida_kg = parseFloat(document.getElementById('peso_saida_kg').value);
    const row = {
        lote_id,
        britador_id,
        peso_saida_kg,
        inicio_processo: toIso(document.getElementById('inicio_processo').value),
        fim_processo: toIso(document.getElementById('fim_processo').value),
        observacoes: document.getElementById('observacoes').value.trim() || null
    };
    const { error } = await supabaseClient.from('processamento').insert([row]);
    if (error) {
        msgEl.textContent = 'Erro: ' + error.message;
        msgEl.className = 'msg erro';
        return;
    }
    await supabaseClient.from('lotes').update({ status: 'em_processo' }).eq('id', lote_id);
    await registrarLog('processamento_criar', { lote_id, britador_id, peso_saida_kg }, perfilAtual);
    msgEl.textContent = 'Processamento salvo!';
    msgEl.className = 'msg ok';
    document.getElementById('form-proc').reset();
    carregarSelectLotes();
    carregarProc();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('britagem', perfilAtual);
    await carregarSelectLotes();
    carregarProc();
})();
