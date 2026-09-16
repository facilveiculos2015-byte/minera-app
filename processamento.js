let perfilAtual = null;
let lotesCache = {};
let cfgAtual = { preco_por_ton: 50, tempo_horas_lote: 4, prazo_retirada_dias: 3 };

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toIso(localVal) {
    if (!localVal) return null;
    const d = new Date(localVal);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

function aplicarKpisConfig(cfg) {
    document.getElementById('kpi-preco').textContent = 'R$ ' + Number(cfg.preco_por_ton).toLocaleString('pt-BR');
    document.getElementById('kpi-tempo').textContent = Number(cfg.tempo_horas_lote) + ' h';
    document.getElementById('kpi-prazo').textContent = 'Até ' + Number(cfg.prazo_retirada_dias) + ' dias';
    document.getElementById('cfg-preco').value = cfg.preco_por_ton;
    document.getElementById('cfg-tempo').value = cfg.tempo_horas_lote;
    document.getElementById('cfg-prazo').value = cfg.prazo_retirada_dias;
}

function salvarCfgLocal(cfg) {
    try { localStorage.setItem('britagem_config', JSON.stringify(cfg)); } catch (e) {}
}

function lerCfgLocal() {
    try {
        const raw = localStorage.getItem('britagem_config');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}

async function carregarConfig() {
    const local = lerCfgLocal();
    if (local) cfgAtual = Object.assign({}, cfgAtual, local);
    try {
        const { data, error } = await supabaseClient
            .from('britagem_config')
            .select('*')
            .eq('id', 1)
            .maybeSingle();
        if (!error && data) {
            cfgAtual = {
                preco_por_ton: data.preco_por_ton != null ? data.preco_por_ton : 50,
                tempo_horas_lote: data.tempo_horas_lote != null ? data.tempo_horas_lote : 4,
                prazo_retirada_dias: data.prazo_retirada_dias != null ? data.prazo_retirada_dias : 3
            };
            salvarCfgLocal(cfgAtual);
        }
    } catch (e) {
        console.warn('britagem_config:', e);
    }
    aplicarKpisConfig(cfgAtual);
}

async function atualizarFila() {
    try {
        const { data, error } = await supabaseClient
            .from('lotes')
            .select('id, status')
            .in('status', ['pendente', 'em_processo']);
        if (error) throw error;
        const lista = data || [];
        const fila = lista.filter(l => (l.status || '').toLowerCase() === 'pendente').length;
        const proc = lista.filter(l => (l.status || '').toLowerCase() === 'em_processo').length;
        document.getElementById('kpi-fila').textContent = String(fila);
        document.getElementById('kpi-proc').textContent = String(Math.max(proc, proc > 0 ? 1 : 0));
        // Spec: count in queue + 1 em processamento — show actual counts
        if (proc === 0 && fila > 0) {
            document.getElementById('kpi-proc').textContent = '0';
        }
    } catch (e) {
        document.getElementById('kpi-fila').textContent = '—';
        document.getElementById('kpi-proc').textContent = '—';
    }
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
        (data || []).map(l => `<option value="${l.id}">${esc(l.codigo_lote)} (${l.peso_bruto_kg} kg · ${esc(statusAmigavel(l.status))})</option>`).join('');
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

document.getElementById('form-britagem-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('cfg-msg');
    const pode = temPapel(perfilAtual, 'dono_britador') || ehAdmin(perfilAtual);
    if (!pode) {
        msgEl.textContent = 'Apenas Dono de Britador ou Admin pode salvar.';
        msgEl.className = 'msg erro';
        return;
    }
    const cfg = {
        preco_por_ton: parseFloat(document.getElementById('cfg-preco').value) || 50,
        tempo_horas_lote: parseFloat(document.getElementById('cfg-tempo').value) || 4,
        prazo_retirada_dias: parseInt(document.getElementById('cfg-prazo').value, 10) || 3
    };
    cfgAtual = cfg;
    salvarCfgLocal(cfg);
    aplicarKpisConfig(cfg);
    try {
        const { error } = await supabaseClient.from('britagem_config').upsert({
            id: 1,
            preco_por_ton: cfg.preco_por_ton,
            tempo_horas_lote: cfg.tempo_horas_lote,
            prazo_retirada_dias: cfg.prazo_retirada_dias,
            atualizado_em: new Date().toISOString()
        });
        if (error) {
            msgEl.textContent = 'Salvo localmente. Tabela britagem_config: ' + error.message + ' (rode SQL 09).';
            msgEl.className = 'msg erro';
            return;
        }
        msgEl.textContent = 'Configuração salva!';
        msgEl.className = 'msg ok';
        await registrarLog('britagem_config', cfg, perfilAtual);
    } catch (err) {
        msgEl.textContent = 'Salvo no dispositivo. Erro remoto: ' + (err.message || err);
        msgEl.className = 'msg erro';
    }
});

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
    atualizarFila();
});

(async function init() {
    const session = await requireSession();
    if (!session) return;
    perfilAtual = await getPerfil(session);
    aplicarUserLabel(perfilAtual);
    montarNav('britagem', perfilAtual);
    await carregarConfig();
    await atualizarFila();
    await carregarSelectLotes();
    carregarProc();
})();
