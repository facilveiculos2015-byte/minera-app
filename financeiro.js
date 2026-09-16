/** Caixa Minera + Empréstimos */
const TAXA_MENSAL_DEFAULT = 0.5;
const JUROS_EMPRESTIMO = 15;
const SAIBA_KEY = 'minera_saiba_mais_caixa';

let perfilAtual = null;
let sessionAtual = null;
let saldoAtual = 0;
let taxaMensal = TAXA_MENSAL_DEFAULT;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtBRL(n) {
    const v = Number(n);
    if (!isFinite(v)) return 'R$ —';
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function authId() {
    return (sessionAtual && sessionAtual.user && sessionAtual.user.id) ||
        (perfilAtual && perfilAtual.auth_id) || null;
}

function setCaixaMsg(texto, ok) {
    const el = document.getElementById('caixa-msg');
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (texto ? (ok ? ' ok' : ' erro') : '');
}

function setEmpMsg(texto, ok) {
    const el = document.getElementById('emp-msg');
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (texto ? (ok ? ' ok' : ' erro') : '');
}

function atualizarTotalPrevisto() {
    const valor = parseFloat(document.getElementById('emp-valor').value) || 0;
    const total = valor * (1 + JUROS_EMPRESTIMO / 100);
    const el = document.getElementById('emp-total-previsto');
    if (el) {
        el.textContent = valor > 0
            ? 'Total previsto no pagamento (juros 15%): ' + fmtBRL(total)
            : 'Total previsto no pagamento (juros 15%): R$ —';
    }
}

function renderSaldo() {
    document.getElementById('caixa-saldo').textContent = fmtBRL(saldoAtual);
    const proj = saldoAtual * (taxaMensal / 100);
    document.getElementById('caixa-rendimento').textContent =
        'Rendimento previsto: ' + String(taxaMensal).replace('.', ',') + '%/mês' +
        (saldoAtual > 0 ? ' · ~' + fmtBRL(proj) + '/mês' : '');
}

async function garantirSaldoRow() {
    const uid = authId();
    if (!uid) return null;
    const { data, error } = await supabaseClient
        .from('caixa_saldos')
        .select('*')
        .eq('auth_id', uid)
        .maybeSingle();
    if (error) throw error;
    if (data) return data;
    const { data: created, error: insErr } = await supabaseClient
        .from('caixa_saldos')
        .insert([{ auth_id: uid, saldo: 0, taxa_mensal: TAXA_MENSAL_DEFAULT }])
        .select('*')
        .maybeSingle();
    if (insErr) throw insErr;
    return created;
}

async function carregarCaixa() {
    try {
        const row = await garantirSaldoRow();
        saldoAtual = row && row.saldo != null ? Number(row.saldo) : 0;
        taxaMensal = row && row.taxa_mensal != null ? Number(row.taxa_mensal) : TAXA_MENSAL_DEFAULT;
        renderSaldo();
    } catch (e) {
        console.warn(e);
        setCaixaMsg((e && e.message ? e.message : String(e)) + ' (SQL 14?)', false);
        renderSaldo();
    }
}

async function carregarMovimentos() {
    const box = document.getElementById('caixa-movimentos');
    const uid = authId();
    try {
        const { data, error } = await supabaseClient
            .from('caixa_movimentos')
            .select('*')
            .eq('auth_id', uid)
            .order('criado_em', { ascending: false })
            .limit(40);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhum movimento ainda.</p>';
            return;
        }
        const labels = {
            deposito: 'Depósito',
            saque: 'Saque (Pegar)',
            rendimento: 'Rendimento',
            emprestimo: 'Empréstimo'
        };
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Tipo</th><th>Valor</th><th>Saldo após</th></tr></thead><tbody>' +
            data.map(m => {
                const when = m.criado_em ? new Date(m.criado_em).toLocaleString('pt-BR') : '—';
                const sinal = (m.tipo === 'saque') ? '−' : '+';
                return '<tr><td>' + esc(when) + '</td><td>' + esc(labels[m.tipo] || m.tipo) +
                    '</td><td>' + esc(sinal + ' ' + fmtBRL(m.valor)) +
                    '</td><td>' + esc(m.saldo_apos != null ? fmtBRL(m.saldo_apos) : '—') +
                    '</td></tr>';
            }).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 14)</p>';
    }
}

function abrirFormMovimento(tipo) {
    const form = document.getElementById('form-movimento');
    document.getElementById('mov-tipo').value = tipo;
    document.getElementById('mov-valor').value = '';
    document.getElementById('mov-obs').value = '';
    document.getElementById('mov-submit').textContent =
        tipo === 'deposito' ? 'Confirmar depósito' : 'Confirmar saque';
    form.classList.remove('oculto');
    setCaixaMsg('', true);
}

async function processarMovimento(tipo, valor, obs) {
    const uid = authId();
    if (!uid) throw new Error('Sessão inválida');
    if (!(valor > 0)) throw new Error('Informe um valor válido');

    const row = await garantirSaldoRow();
    let saldo = row && row.saldo != null ? Number(row.saldo) : 0;
    if (tipo === 'saque' && valor > saldo + 1e-9) {
        throw new Error('Saldo insuficiente');
    }
    const novo = tipo === 'deposito' ? saldo + valor : saldo - valor;

    const { error: movErr } = await supabaseClient.from('caixa_movimentos').insert([{
        auth_id: uid,
        tipo: tipo,
        valor: valor,
        saldo_apos: novo,
        observacao: obs || null
    }]);
    if (movErr) throw movErr;

    const { error: upErr } = await supabaseClient.from('caixa_saldos').update({
        saldo: novo,
        atualizado_em: new Date().toISOString()
    }).eq('auth_id', uid);
    if (upErr) throw upErr;

    saldoAtual = novo;
    renderSaldo();
    await carregarMovimentos();
}

function statusEmpLabel(st) {
    const map = {
        analise: 'Em análise',
        aprovado: 'Aprovado',
        rejeitado: 'Rejeitado',
        pago: 'Pago'
    };
    return map[st] || st || '—';
}

function statusEmpBadge(st) {
    const s = String(st || '').toLowerCase();
    if (s === 'aprovado' || s === 'pago') return 'badge badge-pago';
    if (s === 'rejeitado') return 'badge badge-atrasado';
    return 'badge badge-pendente';
}

async function carregarEmprestimos() {
    const box = document.getElementById('lista-emprestimos');
    const uid = authId();
    try {
        const { data, error } = await supabaseClient
            .from('emprestimos')
            .select('*')
            .eq('auth_id', uid)
            .order('criado_em', { ascending: false })
            .limit(40);
        if (error) throw error;
        if (!data || !data.length) {
            box.innerHTML = '<p class="sub">Nenhuma solicitação ainda.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Valor</th><th>Total prev.</th><th>Prazo</th><th>Status</th></tr></thead><tbody>' +
            data.map(e => {
                const when = e.criado_em ? new Date(e.criado_em).toLocaleString('pt-BR') : '—';
                return '<tr><td>' + esc(when) + '</td><td>' + esc(fmtBRL(e.valor)) +
                    '</td><td>' + esc(fmtBRL(e.total_previsto != null ? e.total_previsto : Number(e.valor) * 1.15)) +
                    '</td><td>' + esc(e.prazo_dias) + ' d</td><td><span class="' +
                    statusEmpBadge(e.status) + '">' + esc(statusEmpLabel(e.status)) +
                    '</span></td></tr>';
            }).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 14)</p>';
    }
}

function saibaDismissed() {
    try { return localStorage.getItem(SAIBA_KEY) === '1'; } catch (e) { return false; }
}

function abrirSaibaMais() {
    const modal = document.getElementById('modal-saiba-mais');
    if (modal) modal.classList.remove('oculto');
}

function fecharSaibaMais() {
    const nao = document.getElementById('saiba-nao-mostrar');
    if (nao && nao.checked) {
        try { localStorage.setItem(SAIBA_KEY, '1'); } catch (e) { /* ignore */ }
    }
    const modal = document.getElementById('modal-saiba-mais');
    if (modal) modal.classList.add('oculto');
}

function bindUI() {
    document.getElementById('btn-depositar').addEventListener('click', () => abrirFormMovimento('deposito'));
    document.getElementById('btn-pegar').addEventListener('click', () => abrirFormMovimento('saque'));
    document.getElementById('mov-cancelar').addEventListener('click', () => {
        document.getElementById('form-movimento').classList.add('oculto');
    });

    document.getElementById('form-movimento').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const tipo = document.getElementById('mov-tipo').value;
        const valor = parseFloat(document.getElementById('mov-valor').value);
        const obs = document.getElementById('mov-obs').value.trim();
        try {
            await processarMovimento(tipo, valor, obs);
            document.getElementById('form-movimento').classList.add('oculto');
            setCaixaMsg(tipo === 'deposito' ? 'Depósito registrado.' : 'Saque registrado.', true);
            if (typeof toastMsg === 'function') toastMsg(tipo === 'deposito' ? 'Depósito ok' : 'Saque ok');
        } catch (e) {
            setCaixaMsg(e.message || String(e), false);
        }
    });

    document.getElementById('emp-valor').addEventListener('input', atualizarTotalPrevisto);
    document.getElementById('form-emprestimo').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const uid = authId();
        const valor = parseFloat(document.getElementById('emp-valor').value);
        const prazo = parseInt(document.getElementById('emp-prazo').value, 10);
        const finalidade = document.getElementById('emp-finalidade').value.trim();
        const nome = document.getElementById('emp-nome').value.trim();
        const telefone = document.getElementById('emp-telefone').value.trim();
        const rendaRaw = document.getElementById('emp-renda').value;
        const renda = rendaRaw === '' ? null : parseFloat(rendaRaw);
        const observacoes = document.getElementById('emp-obs').value.trim();
        if (!(valor > 0) || !(prazo > 0) || !finalidade || !nome) {
            setEmpMsg('Preencha valor, prazo, finalidade e nome.', false);
            return;
        }
        const total = valor * (1 + JUROS_EMPRESTIMO / 100);
        try {
            const { error } = await supabaseClient.from('emprestimos').insert([{
                auth_id: uid,
                nome: nome,
                telefone: telefone || null,
                valor: valor,
                prazo_dias: prazo,
                finalidade: finalidade,
                renda_declarada: isFinite(renda) ? renda : null,
                observacoes: observacoes || null,
                juros_pct: JUROS_EMPRESTIMO,
                total_previsto: total,
                status: 'analise'
            }]);
            if (error) throw error;
            document.getElementById('form-emprestimo').reset();
            document.getElementById('emp-nome').value = (perfilAtual && perfilAtual.nome) || '';
            atualizarTotalPrevisto();
            setEmpMsg('Solicitação enviada — sujeita à análise de crédito.', true);
            if (typeof toastMsg === 'function') toastMsg('Empréstimo em análise');
            await carregarEmprestimos();
        } catch (e) {
            setEmpMsg((e.message || String(e)) + ' (SQL 14?)', false);
        }
    });

    document.getElementById('btn-saiba-mais').addEventListener('click', abrirSaibaMais);
    document.getElementById('saiba-mais-fechar').addEventListener('click', fecharSaibaMais);
    document.getElementById('saiba-mais-ok').addEventListener('click', fecharSaibaMais);
    document.getElementById('modal-saiba-mais').addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute('data-close-saiba') === '1') fecharSaibaMais();
    });
}

(async function init() {
    sessionAtual = await requireSession();
    if (!sessionAtual) return;
    perfilAtual = await getPerfil(sessionAtual);
    aplicarUserLabel(perfilAtual);
    montarNav('financeiro', perfilAtual);
    document.getElementById('emp-nome').value = (perfilAtual && perfilAtual.nome) || '';
    bindUI();
    atualizarTotalPrevisto();
    await Promise.all([carregarCaixa(), carregarMovimentos(), carregarEmprestimos()]);
    if (!saibaDismissed()) abrirSaibaMais();
})();
