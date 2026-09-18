/** Caixa Minera — banco UX: Empréstimo / Depositar / Sacar + PIN */
const TAXA_YIELD_MAX = 5;
const JUROS_EMPRESTIMO = 15;
const SAIBA_KEY = 'minera_saiba_mais_caixa';
const PIN_UNLOCK_KEY = 'minera_caixa_unlocked';

let perfilAtual = null;
let sessionAtual = null;
let saldoAtual = 0;
let taxaYieldMax = TAXA_YIELD_MAX;
let saldoRow = null;
let pixAtivoCache = null;
let forgotVerified = false;

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

function userEmail() {
    return (sessionAtual && sessionAtual.user && sessionAtual.user.email) ||
        (perfilAtual && perfilAtual.email) || '';
}

function setMsg(id, texto, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (texto ? (ok ? ' ok' : ' erro') : '');
}

function setCaixaMsg(t, ok) { setMsg('caixa-msg', t, ok); }
function setEmpMsg(t, ok) { setMsg('emp-msg', t, ok); }
function setDepMsg(t, ok) { setMsg('dep-msg', t, ok); }
function setSaqueMsg(t, ok) { setMsg('saque-msg', t, ok); }

function isUnlocked() {
    try { return sessionStorage.getItem(PIN_UNLOCK_KEY) === '1'; } catch (e) { return false; }
}
function setUnlocked(v) {
    try {
        if (v) sessionStorage.setItem(PIN_UNLOCK_KEY, '1');
        else sessionStorage.removeItem(PIN_UNLOCK_KEY);
    } catch (e) { /* ignore */ }
}

function bytesToHex(buf) {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSaltHex(len) {
    const arr = new Uint8Array(len || 16);
    crypto.getRandomValues(arr);
    return bytesToHex(arr);
}

async function sha256Hex(str) {
    const enc = new TextEncoder().encode(String(str));
    const dig = await crypto.subtle.digest('SHA-256', enc);
    return bytesToHex(dig);
}

async function hashPin(pin, salt) {
    return sha256Hex(String(salt) + '|' + String(pin));
}

/** Juros 15% a.m.: total = valor * (1 + 0.15 * (prazo_dias/30)) */
function totalEmprestimoPrevisto(valor, prazoDias) {
    const v = Number(valor) || 0;
    const dias = Number(prazoDias);
    const meses = (isFinite(dias) && dias > 0) ? (dias / 30) : 1;
    return v * (1 + (JUROS_EMPRESTIMO / 100) * meses);
}

function atualizarTotalPrevisto() {
    const valor = parseFloat(document.getElementById('emp-valor').value) || 0;
    const prazo = parseInt((document.getElementById('emp-prazo') || {}).value, 10) || 0;
    const total = totalEmprestimoPrevisto(valor, prazo > 0 ? prazo : 30);
    const el = document.getElementById('emp-total-previsto');
    if (el) {
        const mesesLabel = prazo > 0 ? (prazo / 30) : 1;
        const mesesTxt = (Math.round(mesesLabel * 100) / 100).toLocaleString('pt-BR');
        el.textContent = valor > 0
            ? 'Total previsto no pagamento (15% a.m. · ' + mesesTxt + ' mês(es)): ' + fmtBRL(total)
            : 'Total previsto no pagamento (15% a.m.): R$ —';
    }
}

function estimarRendimentoPct() {
    // Até 5% a.m. conforme variação simples ouro/dólar (MVP)
    let pct = Number(taxaYieldMax);
    if (!isFinite(pct) || pct <= 0) pct = TAXA_YIELD_MAX;
    pct = Math.min(TAXA_YIELD_MAX, Math.max(0.5, pct));
    try {
        const ouro = parseFloat(localStorage.getItem('minera_cot_ouro_usd'));
        const prev = parseFloat(localStorage.getItem('minera_cot_ouro_usd_prev'));
        if (isFinite(ouro) && isFinite(prev) && prev > 0) {
            const varPct = Math.abs((ouro - prev) / prev) * 100;
            pct = Math.min(TAXA_YIELD_MAX, Math.max(0.5, varPct * 2));
        }
    } catch (e) { /* ignore */ }
    return Math.min(TAXA_YIELD_MAX, pct);
}

function renderSaldo() {
    document.getElementById('caixa-saldo').textContent = fmtBRL(saldoAtual);
    const taxa = estimarRendimentoPct();
    const proj = saldoAtual * (taxa / 100);
    document.getElementById('caixa-rendimento').textContent =
        'Rendimento estimado até ' + String(TAXA_YIELD_MAX).replace('.', ',') +
        '% a.m. conforme cotação da bolsa' +
        (saldoAtual > 0 ? ' · ref. ~' + String(taxa.toFixed(1)).replace('.', ',') + '% → ~' + fmtBRL(proj) + '/mês' : '');
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
        .insert([{ auth_id: uid, saldo: 0, taxa_mensal: TAXA_YIELD_MAX, taxa_yield_max: TAXA_YIELD_MAX }])
        .select('*')
        .maybeSingle();
    if (insErr) throw insErr;
    return created;
}

function showLockPanels(mode) {
    // mode: set | unlock | forgot
    const setP = document.getElementById('panel-set-pin');
    const unP = document.getElementById('panel-unlock-pin');
    const foP = document.getElementById('panel-forgot-pin');
    if (setP) setP.classList.toggle('oculto', mode !== 'set');
    if (unP) unP.classList.toggle('oculto', mode !== 'unlock');
    if (foP) foP.classList.toggle('oculto', mode !== 'forgot');
}

function applyLockUI(hasPin, unlocked) {
    const card = document.getElementById('card-caixa');
    const lock = document.getElementById('caixa-lock');
    if (!card || !lock) return;
    if (!hasPin) {
        card.classList.add('caixa-locked');
        lock.classList.remove('oculto');
        showLockPanels('set');
        return;
    }
    if (!unlocked) {
        card.classList.add('caixa-locked');
        lock.classList.remove('oculto');
        showLockPanels('unlock');
        return;
    }
    card.classList.remove('caixa-locked');
    lock.classList.add('oculto');
}

async function carregarCaixa() {
    try {
        saldoRow = await garantirSaldoRow();
        saldoAtual = saldoRow && saldoRow.saldo != null ? Number(saldoRow.saldo) : 0;
        taxaYieldMax = saldoRow && saldoRow.taxa_yield_max != null
            ? Number(saldoRow.taxa_yield_max)
            : (saldoRow && saldoRow.taxa_mensal != null ? Number(saldoRow.taxa_mensal) : TAXA_YIELD_MAX);
        if (!isFinite(taxaYieldMax) || taxaYieldMax <= 0) taxaYieldMax = TAXA_YIELD_MAX;
        renderSaldo();
        const hasPin = !!(saldoRow && saldoRow.pin_hash && saldoRow.pin_salt);
        applyLockUI(hasPin, isUnlocked());
    } catch (e) {
        console.warn(e);
        setCaixaMsg((e && e.message ? e.message : String(e)) + ' (SQL 14/15?)', false);
        renderSaldo();
        applyLockUI(false, false);
    }
}

async function salvarPin(pin) {
    if (!pin || pin.length < 6) throw new Error('Senha da Caixa: mínimo 6 caracteres');
    const uid = authId();
    const salt = randomSaltHex(16);
    const hash = await hashPin(pin, salt);
    await garantirSaldoRow();
    const { error } = await supabaseClient.from('caixa_saldos').update({
        pin_hash: hash,
        pin_salt: salt,
        atualizado_em: new Date().toISOString()
    }).eq('auth_id', uid);
    if (error) throw error;
    saldoRow = await garantirSaldoRow();
    setUnlocked(true);
    applyLockUI(true, true);
}

async function verificarPin(pin) {
    if (!saldoRow || !saldoRow.pin_hash || !saldoRow.pin_salt) return false;
    const h = await hashPin(pin, saldoRow.pin_salt);
    return h === saldoRow.pin_hash;
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
            saque: 'Saque',
            rendimento: 'Rendimento',
            emprestimo: 'Empréstimo',
            deposito_pendente: 'Depósito (pendente)'
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
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 14/15)</p>';
    }
}

async function carregarPedidos() {
    const box = document.getElementById('caixa-pedidos');
    const uid = authId();
    if (!box) return;
    try {
        const [dep, saq] = await Promise.all([
            supabaseClient.from('caixa_deposito_pedidos').select('*').eq('auth_id', uid)
                .order('criado_em', { ascending: false }).limit(15),
            supabaseClient.from('caixa_saque_pedidos').select('*').eq('auth_id', uid)
                .order('criado_em', { ascending: false }).limit(15)
        ]);
        if (dep.error) throw dep.error;
        if (saq.error) throw saq.error;
        const rows = [];
        (dep.data || []).forEach(d => rows.push({
            when: d.criado_em, tipo: 'Depósito', valor: d.valor, status: d.status, extra: d.comprovante_url
        }));
        (saq.data || []).forEach(s => rows.push({
            when: s.criado_em, tipo: 'Saque', valor: s.valor, status: s.status, extra: s.chave_pix_destino
        }));
        rows.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
        if (!rows.length) {
            box.innerHTML = '<p class="sub">Nenhum pedido de depósito/saque ainda.</p>';
            return;
        }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
            '<th>Quando</th><th>Tipo</th><th>Valor</th><th>Status</th></tr></thead><tbody>' +
            rows.slice(0, 20).map(r => {
                const when = r.when ? new Date(r.when).toLocaleString('pt-BR') : '—';
                return '<tr><td>' + esc(when) + '</td><td>' + esc(r.tipo) +
                    '</td><td>' + esc(fmtBRL(r.valor)) +
                    '</td><td><span class="badge">' + esc(r.status || '—') + '</span></td></tr>';
            }).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 15)</p>';
    }
}

function statusEmpLabel(st) {
    const map = { analise: 'Em análise', aprovado: 'Aprovado', rejeitado: 'Rejeitado', pago: 'Pago' };
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
                    '</td><td>' + esc(fmtBRL(e.total_previsto != null ? e.total_previsto : totalEmprestimoPrevisto(e.valor, e.prazo_dias))) +
                    '</td><td>' + esc(e.prazo_dias) + ' d</td><td><span class="' +
                    statusEmpBadge(e.status) + '">' + esc(statusEmpLabel(e.status)) +
                    '</span></td></tr>';
            }).join('') + '</tbody></table></div>';
    } catch (e) {
        box.innerHTML = '<p class="erro">' + esc(e.message) + ' (SQL 14)</p>';
    }
}

async function buscarPixAtivo() {
    const { data, error } = await supabaseClient
        .from('pix_admin')
        .select('*')
        .eq('ativo', true)
        .order('atualizado_em', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data && data[0] ? data[0] : null;
}

function fecharPaineisAcao() {
    document.getElementById('panel-depositar').classList.add('oculto');
    document.getElementById('panel-sacar').classList.add('oculto');
}

function abrirPanel(id) {
    fecharPaineisAcao();
    const el = document.getElementById(id);
    if (el) el.classList.remove('oculto');
}

async function gerarPixDeposito() {
    const valor = parseFloat(document.getElementById('dep-valor').value);
    if (!(valor > 0)) {
        setDepMsg('Informe um valor válido.', false);
        return;
    }
    try {
        pixAtivoCache = await buscarPixAtivo();
        const pix = pixAtivoCache;
        const chave = pix && pix.chave_pix;
        if (!chave || typeof gerarPixCopiaCola !== 'function') {
            setDepMsg('Nenhuma chave Pix ativa da plataforma. Contate o admin.', false);
            return;
        }
        const nome = (pix && pix.titular) || (window.PixBrCode && PixBrCode.FALLBACK_NOME) || 'JeL empreendimentos';
        const cidade = (window.PixBrCode && PixBrCode.FALLBACK_CIDADE) || 'BELEM';
        const payload = gerarPixCopiaCola({
            chave, nome, cidade, valor,
            txid: 'CAIXA' + String(Date.now()).slice(-8)
        });
        document.getElementById('dep-pix-info').textContent =
            'Titular: ' + nome + ' · Chave: ' + chave;
        document.getElementById('dep-pix-copia').value = payload;
        document.getElementById('dep-pix-box').classList.remove('oculto');
        if (window.PixBrCode && typeof PixBrCode.renderQr === 'function') {
            PixBrCode.renderQr(document.getElementById('dep-pix-qr'), payload, 180);
        }
        setDepMsg('Pague o Pix e envie a URL do comprovante.', true);
    } catch (e) {
        setDepMsg(e.message || String(e), false);
    }
}

async function enviarDeposito() {
    const uid = authId();
    const valor = parseFloat(document.getElementById('dep-valor').value);
    const url = (document.getElementById('dep-comprovante').value || '').trim();
    if (!(valor > 0)) { setDepMsg('Informe o valor.', false); return; }
    if (!url) { setDepMsg('Informe a URL do comprovante.', false); return; }
    const pix = pixAtivoCache || await buscarPixAtivo();
    try {
        const { error } = await supabaseClient.from('caixa_deposito_pedidos').insert([{
            auth_id: uid,
            valor: valor,
            comprovante_url: url,
            pix_chave_usada: (pix && pix.chave_pix) || null,
            pix_titular: (pix && pix.titular) || 'JeL empreendimentos',
            status: 'pendente'
        }]);
        if (error) throw error;
        // log movimento informativo (não credita)
        try {
            await supabaseClient.from('caixa_movimentos').insert([{
                auth_id: uid,
                tipo: 'deposito_pendente',
                valor: valor,
                saldo_apos: saldoAtual,
                observacao: 'Pedido pendente · comprovante enviado'
            }]);
        } catch (e) { console.warn(e); }
        setDepMsg('Pedido enviado. Aguarde confirmação do admin para creditar o saldo.', true);
        if (typeof toastMsg === 'function') toastMsg('Depósito pendente');
        document.getElementById('dep-comprovante').value = '';
        await carregarPedidos();
        await carregarMovimentos();
    } catch (e) {
        setDepMsg((e.message || String(e)) + ' (SQL 15?)', false);
    }
}

async function enviarSaque() {
    const uid = authId();
    const valor = parseFloat(document.getElementById('saque-valor').value);
    const chave = (document.getElementById('saque-chave').value || '').trim();
    if (!(valor > 0)) { setSaqueMsg('Informe um valor válido.', false); return; }
    if (!chave) { setSaqueMsg('Informe a chave Pix de destino.', false); return; }
    if (valor > saldoAtual + 1e-9) { setSaqueMsg('Saldo insuficiente.', false); return; }
    try {
        const { error } = await supabaseClient.from('caixa_saque_pedidos').insert([{
            auth_id: uid,
            valor: valor,
            chave_pix_destino: chave,
            status: 'pendente'
        }]);
        if (error) throw error;
        setSaqueMsg('Saque solicitado. Pode ser instantâneo ou demorar até 24 horas.', true);
        if (typeof toastMsg === 'function') toastMsg('Saque pendente');
        document.getElementById('saque-valor').value = '';
        document.getElementById('saque-chave').value = '';
        await carregarPedidos();
    } catch (e) {
        setSaqueMsg((e.message || String(e)) + ' (SQL 15?)', false);
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

function bindPinUI() {
    document.getElementById('btn-set-pin').addEventListener('click', async () => {
        const a = document.getElementById('pin-novo').value;
        const b = document.getElementById('pin-novo2').value;
        if (a !== b) { setMsg('pin-set-msg', 'As senhas não coincidem.', false); return; }
        try {
            await salvarPin(a);
            setMsg('pin-set-msg', 'Senha da Caixa salva.', true);
            if (typeof toastMsg === 'function') toastMsg('Caixa desbloqueada');
        } catch (e) {
            setMsg('pin-set-msg', e.message || String(e), false);
        }
    });

    document.getElementById('btn-unlock-pin').addEventListener('click', async () => {
        const pin = document.getElementById('pin-unlock').value;
        try {
            const ok = await verificarPin(pin);
            if (!ok) { setMsg('pin-unlock-msg', 'Senha incorreta.', false); return; }
            setUnlocked(true);
            applyLockUI(true, true);
            setMsg('pin-unlock-msg', '', true);
        } catch (e) {
            setMsg('pin-unlock-msg', e.message || String(e), false);
        }
    });

    document.getElementById('btn-forgot-pin').addEventListener('click', () => {
        forgotVerified = false;
        document.getElementById('forgot-new-pin-block').classList.add('oculto');
        document.getElementById('otp-pin-block').classList.add('oculto');
        showLockPanels('forgot');
    });
    document.getElementById('btn-forgot-back').addEventListener('click', () => showLockPanels('unlock'));

    document.getElementById('btn-reauth-pin').addEventListener('click', async () => {
        const pass = document.getElementById('forgot-login-pass').value;
        const email = userEmail();
        if (!email || !pass) {
            setMsg('pin-forgot-msg', 'Informe a senha de login.', false);
            return;
        }
        try {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;
            forgotVerified = true;
            document.getElementById('forgot-new-pin-block').classList.remove('oculto');
            setMsg('pin-forgot-msg', 'Login confirmado. Defina a nova senha da Caixa.', true);
        } catch (e) {
            setMsg('pin-forgot-msg', e.message || String(e), false);
        }
    });

    document.getElementById('btn-otp-pin').addEventListener('click', async () => {
        const email = userEmail();
        if (!email) { setMsg('pin-forgot-msg', 'E-mail da sessão indisponível.', false); return; }
        try {
            const { error } = await supabaseClient.auth.signInWithOtp({
                email,
                options: { shouldCreateUser: false }
            });
            if (error) throw error;
            document.getElementById('otp-pin-block').classList.remove('oculto');
            setMsg('pin-forgot-msg', 'OTP enviado para ' + email + '. Digite o código abaixo.', true);
        } catch (e) {
            setMsg('pin-forgot-msg', (e.message || String(e)) + ' — use a senha de login se o OTP falhar.', false);
        }
    });

    document.getElementById('btn-verify-otp-pin').addEventListener('click', async () => {
        const email = userEmail();
        const token = (document.getElementById('otp-code').value || '').trim();
        if (!token) { setMsg('pin-forgot-msg', 'Informe o código OTP.', false); return; }
        try {
            const { error } = await supabaseClient.auth.verifyOtp({
                email,
                token,
                type: 'email'
            });
            if (error) throw error;
            forgotVerified = true;
            document.getElementById('forgot-new-pin-block').classList.remove('oculto');
            setMsg('pin-forgot-msg', 'OTP ok. Defina a nova senha da Caixa.', true);
        } catch (e) {
            setMsg('pin-forgot-msg', e.message || String(e), false);
        }
    });

    document.getElementById('btn-save-forgot-pin').addEventListener('click', async () => {
        if (!forgotVerified) {
            setMsg('pin-forgot-msg', 'Confirme login ou OTP antes.', false);
            return;
        }
        const a = document.getElementById('forgot-pin-novo').value;
        const b = document.getElementById('forgot-pin-novo2').value;
        if (a !== b) { setMsg('pin-forgot-msg', 'As senhas não coincidem.', false); return; }
        try {
            await salvarPin(a);
            setMsg('pin-forgot-msg', 'Nova senha da Caixa salva.', true);
        } catch (e) {
            setMsg('pin-forgot-msg', e.message || String(e), false);
        }
    });
}


let empWizardStep = 1;
let empDocUrls = {};

function empShowStep(n) {
    n = Number(n) || 1;
    empWizardStep = n;
    document.querySelectorAll('#emp-wizard .emp-pane').forEach(p => {
        p.classList.toggle('oculto', Number(p.getAttribute('data-pane')) !== n);
    });
    document.querySelectorAll('#emp-steps .emp-step').forEach(s => {
        const step = Number(s.getAttribute('data-step'));
        s.classList.toggle('on', step === n);
        s.classList.toggle('done', step < n);
    });
    const bar = document.getElementById('emp-progress-bar');
    if (bar) bar.style.width = Math.min(100, Math.max(25, n * 25)) + '%';
}
async function empUploadDoc(file, kind) {
    if (!file) return null;
    const uid = authId();
    if (!uid) throw new Error('Sessão inválida');
    const ext = (file.name || 'doc').split('.').pop() || 'bin';
    const safe = String(kind).replace(/[^\w\-]+/g, '_');
    const path = uid + '/' + Date.now() + '_' + safe + '.' + ext;
    const { data, error } = await supabaseClient.storage
        .from('emprestimo-docs')
        .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600' });
    if (error) throw error;
    // Bucket privado: guarda path; admin lê via Storage policy. Prefer signed URL for display.
    const { data: signed, error: sErr } = await supabaseClient.storage
        .from('emprestimo-docs')
        .createSignedUrl(data.path || path, 60 * 60 * 24 * 30);
    if (!sErr && signed && signed.signedUrl) return signed.signedUrl;
    // Fallback: store storage path
    return 'emprestimo-docs/' + (data.path || path);
}

function empCollectPedido() {
    const valor = parseFloat(document.getElementById('emp-valor').value);
    const prazo = parseInt(document.getElementById('emp-prazo').value, 10);
    const finalidade = document.getElementById('emp-finalidade').value.trim();
    const nome = document.getElementById('emp-nome').value.trim();
    const telefone = document.getElementById('emp-telefone').value.trim();
    const rendaRaw = document.getElementById('emp-renda').value;
    const renda = rendaRaw === '' ? null : parseFloat(rendaRaw);
    const observacoes = document.getElementById('emp-obs').value.trim();
    return { valor, prazo, finalidade, nome, telefone, renda, observacoes };
}

function empCollectKyc() {
    return {
        endereco: (document.getElementById('emp-endereco').value || '').trim(),
        empresa: (document.getElementById('emp-empresa').value || '').trim(),
        anos_empresa: parseFloat(document.getElementById('emp-anos-empresa').value),
        comprova_renda: document.getElementById('emp-comprova-renda').value === 'sim'
    };
}

function empBuildResumo() {
    const p = empCollectPedido();
    const k = empCollectKyc();
    const total = totalEmprestimoPrevisto(p.valor, p.prazo);
    const docs = [
        ['Energia', empDocUrls.energia],
        ['Identidade', empDocUrls.identidade],
        ['CPF', empDocUrls.cpf],
        ['Selfie', empDocUrls.selfie],
        ['Extrato', empDocUrls.extrato]
    ].map(([l, u]) => l + ': ' + (u ? 'ok' : 'faltando')).join(' · ');
    return '<ul class="emp-resumo-list">' +
        '<li><strong>Valor:</strong> ' + esc(fmtBRL(p.valor)) + '</li>' +
        '<li><strong>Prazo:</strong> ' + esc(p.prazo) + ' dias</li>' +
        '<li><strong>Total previsto:</strong> ' + esc(fmtBRL(total)) + '</li>' +
        '<li><strong>Finalidade:</strong> ' + esc(p.finalidade) + '</li>' +
        '<li><strong>Endereço:</strong> ' + esc(k.endereco) + '</li>' +
        '<li><strong>Empresa:</strong> ' + esc(k.empresa) + ' (' + esc(k.anos_empresa) + ' anos)</li>' +
        '<li><strong>Comprova renda:</strong> ' + (k.comprova_renda ? 'sim' : 'não') + '</li>' +
        '<li><strong>Docs:</strong> ' + esc(docs) + '</li>' +
        '</ul><p class="aviso-credito"><strong>Sujeito à análise de crédito</strong></p>';
}

function bindEmpWizard() {
    const next1 = document.getElementById('emp-next-1');
    if (!next1 || next1._bound) return;
    next1._bound = true;

    next1.addEventListener('click', () => {
        const p = empCollectPedido();
        if (!(p.valor > 0) || !(p.prazo > 0) || !p.finalidade || !p.nome) {
            setEmpMsg('Preencha valor, prazo, finalidade e nome.', false);
            return;
        }
        setEmpMsg('', true);
        empShowStep(2);
    });
    document.getElementById('emp-back-2').addEventListener('click', () => empShowStep(1));
    document.getElementById('emp-next-2').addEventListener('click', () => {
        const k = empCollectKyc();
        if (!k.endereco || !k.empresa || !(k.anos_empresa >= 0) || document.getElementById('emp-comprova-renda').value === '') {
            setEmpMsg('Responda endereço, empresa, anos e comprovação de renda.', false);
            return;
        }
        setEmpMsg('', true);
        empShowStep(3);
    });
    document.getElementById('emp-back-3').addEventListener('click', () => empShowStep(2));
    document.getElementById('emp-next-3').addEventListener('click', async () => {
        const need = [
            ['energia', 'emp-doc-energia'],
            ['identidade', 'emp-doc-identidade'],
            ['cpf', 'emp-doc-cpf'],
            ['selfie', 'emp-doc-selfie']
        ];
        for (const [k, id] of need) {
            const inp = document.getElementById(id);
            if (!inp || !inp.files || !inp.files[0]) {
                setEmpMsg('Envie os documentos obrigatórios (energia, identidade, CPF e selfie).', false);
                return;
            }
        }
        const st = document.getElementById('emp-upload-status');
        try {
            setEmpMsg('Enviando documentos…', true);
            if (st) st.textContent = 'Upload em andamento…';
            empDocUrls = {};
            for (const [k, id] of need) {
                const f = document.getElementById(id).files[0];
                if (st) st.textContent = 'Enviando ' + k + '…';
                empDocUrls[k] = await empUploadDoc(f, k);
            }
            const extrato = document.getElementById('emp-doc-extrato');
            if (extrato && extrato.files && extrato.files[0]) {
                if (st) st.textContent = 'Enviando extrato…';
                empDocUrls.extrato = await empUploadDoc(extrato.files[0], 'extrato');
            }
            if (st) st.textContent = 'Documentos enviados.';
            document.getElementById('emp-resumo').innerHTML = empBuildResumo();
            setEmpMsg('', true);
            empShowStep(4);
        } catch (e) {
            setEmpMsg((e.message || String(e)) + ' (SQL 30 / bucket emprestimo-docs?)', false);
            if (st) st.textContent = '';
        }
    });
    document.getElementById('emp-back-4').addEventListener('click', () => empShowStep(3));
    document.getElementById('emp-enviar').addEventListener('click', async () => {
        const uid = authId();
        const p = empCollectPedido();
        const k = empCollectKyc();
        if (!(p.valor > 0) || !(p.prazo > 0) || !p.finalidade || !p.nome) {
            setEmpMsg('Dados do pedido incompletos.', false);
            return;
        }
        if (!empDocUrls.energia || !empDocUrls.identidade || !empDocUrls.cpf || !empDocUrls.selfie) {
            setEmpMsg('Documentos obrigatórios ausentes.', false);
            return;
        }
        const total = totalEmprestimoPrevisto(p.valor, p.prazo);
        const questionario = {
            endereco: k.endereco,
            empresa: k.empresa,
            anos_empresa: k.anos_empresa,
            comprova_renda: k.comprova_renda,
            respondido_em: new Date().toISOString()
        };
        try {
            const { error } = await supabaseClient.from('emprestimos').insert([{
                auth_id: uid,
                nome: p.nome,
                telefone: p.telefone || null,
                valor: p.valor,
                prazo_dias: p.prazo,
                finalidade: p.finalidade,
                renda_declarada: isFinite(p.renda) ? p.renda : null,
                observacoes: p.observacoes || null,
                juros_pct: JUROS_EMPRESTIMO,
                total_previsto: total,
                status: 'analise',
                endereco: k.endereco,
                empresa: k.empresa,
                anos_empresa: k.anos_empresa,
                comprova_renda: k.comprova_renda,
                doc_energia_url: empDocUrls.energia,
                doc_identidade_url: empDocUrls.identidade,
                doc_cpf_url: empDocUrls.cpf,
                doc_selfie_url: empDocUrls.selfie,
                doc_extrato_url: empDocUrls.extrato || null,
                questionario
            }]);
            if (error) throw error;
            empDocUrls = {};
            ['emp-valor','emp-finalidade','emp-telefone','emp-renda','emp-obs','emp-endereco','emp-empresa','emp-anos-empresa'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            document.getElementById('emp-prazo').value = '30';
            document.getElementById('emp-comprova-renda').value = '';
            ['emp-doc-energia','emp-doc-identidade','emp-doc-cpf','emp-doc-selfie','emp-doc-extrato'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            document.getElementById('emp-nome').value = (perfilAtual && perfilAtual.nome) || '';
            atualizarTotalPrevisto();
            empShowStep(1);
            setEmpMsg('Solicitação enviada — sujeita à análise de crédito.', true);
            if (typeof toastMsg === 'function') toastMsg('Empréstimo em análise');
            await carregarEmprestimos();
        } catch (e) {
            setEmpMsg((e.message || String(e)) + ' (SQL 14/30?)', false);
        }
    });
}

function bindUI() {
    bindPinUI();

    document.getElementById('btn-emprestimo-goto').addEventListener('click', () => {
        fecharPaineisAcao();
        const sec = document.getElementById('sec-emprestimo');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('btn-depositar').addEventListener('click', () => {
        abrirPanel('panel-depositar');
        setDepMsg('', true);
    });
    document.getElementById('btn-sacar').addEventListener('click', () => {
        abrirPanel('panel-sacar');
        setSaqueMsg('', true);
    });
    document.getElementById('dep-cancelar').addEventListener('click', fecharPaineisAcao);
    document.getElementById('saque-cancelar').addEventListener('click', fecharPaineisAcao);
    document.getElementById('btn-gerar-pix-dep').addEventListener('click', gerarPixDeposito);
    document.getElementById('btn-enviar-dep').addEventListener('click', enviarDeposito);
    document.getElementById('btn-enviar-saque').addEventListener('click', enviarSaque);
    document.getElementById('btn-copiar-pix-dep').addEventListener('click', async () => {
        const t = document.getElementById('dep-pix-copia').value;
        try {
            if (window.PixBrCode && PixBrCode.copiarTexto) await PixBrCode.copiarTexto(t);
            else if (navigator.clipboard) await navigator.clipboard.writeText(t);
            setDepMsg('Pix copiado.', true);
        } catch (e) {
            setDepMsg('Não foi possível copiar.', false);
        }
    });

    document.getElementById('emp-valor').addEventListener('input', atualizarTotalPrevisto);
    document.getElementById('emp-prazo').addEventListener('input', atualizarTotalPrevisto);
    bindEmpWizard();

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
    await Promise.all([carregarCaixa(), carregarMovimentos(), carregarEmprestimos(), carregarPedidos()]);
    if (!saibaDismissed() && isUnlocked()) abrirSaibaMais();
    // Status do empréstimo muda no Admin — atualiza a lista periodicamente
    setInterval(() => { try { carregarEmprestimos(); } catch (e) { /* ignore */ } }, 30000);
})();
