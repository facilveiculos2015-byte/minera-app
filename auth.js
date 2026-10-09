
const WELCOME_SEEN_KEY = 'minera_welcome_seen';

function welcomeJaVisto() {
    try { return sessionStorage.getItem(WELCOME_SEEN_KEY) === '1'; } catch (e) { return false; }
}
function marcarWelcomeVisto() {
    try { sessionStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch (e) { /* ignore */ }
}
function revelarAuthAposWelcome() {
    const w = document.getElementById('welcome-card');
    const a = document.getElementById('auth-card');
    if (w) w.classList.add('oculto');
    if (a) a.classList.remove('oculto');
    marcarWelcomeVisto();
}
function setupWelcomeGate() {
    const w = document.getElementById('welcome-card');
    const a = document.getElementById('auth-card');
    if (!w || !a) return;
    if (typeof modoRecuperacao !== 'undefined' && modoRecuperacao) {
        w.classList.add('oculto');
        a.classList.remove('oculto');
        return;
    }
    // Volta do link do e-mail (confirmado ou vencido): mostra direto o login com o aviso
    if (welcomeJaVisto() || (typeof urlIndicaConfirmacaoCadastro === 'function' && (urlIndicaConfirmacaoCadastro() || urlErroLinkEmail()))) {
        w.classList.add('oculto');
        a.classList.remove('oculto');
        return;
    }
    w.classList.remove('oculto');
    a.classList.add('oculto');
    const btn = document.getElementById('btn-welcome-continuar');
    if (btn && !btn._welcomeBound) {
        btn._welcomeBound = true;
        btn.addEventListener('click', revelarAuthAposWelcome);
    }
}

const PAPEIS_OPCOES = [
    { id: 'minerador', label: 'Minerador' },
    { id: 'comprador', label: 'Comprador' },
    { id: 'transportador_mina_britador', label: 'Transportador (Mina - Britador)' },
    { id: 'transportador_britador_porto', label: 'Transportador (Britador - Porto)' },
    { id: 'dono_britador', label: 'Dono de Britador' },
    { id: 'carregamento', label: 'Operador de Carregamento' }
];

function mostrarAba(nome) {
    const entrar = nome === 'entrar';
    const formEntrar = document.getElementById('form-entrar');
    const formCad = document.getElementById('form-cadastrar');
    formEntrar.classList.toggle('oculto', !entrar);
    formCad.classList.toggle('oculto', entrar);
    formEntrar.style.display = entrar ? 'flex' : 'none';
    formCad.style.display = entrar ? 'none' : 'flex';
    document.getElementById('tab-entrar').classList.toggle('on', entrar);
    document.getElementById('tab-cadastrar').classList.toggle('on', !entrar);
    const welcome = document.getElementById('cadastro-welcome');
    if (welcome) welcome.classList.toggle('oculto', entrar);
    document.getElementById('auth-msg').textContent = '';
    esconderReenvioLogin();
    if (entrar) {
        const email = document.getElementById('login-email');
        setTimeout(() => email && email.focus(), 50);
    }
}

function msg(texto, ok) {
    const el = document.getElementById('auth-msg');
    el.textContent = texto;
    el.className = 'msg ' + (ok ? 'ok' : 'erro');
}

function lerPapeisCadastro() {
    return PAPEIS_OPCOES
        .map(p => p.id)
        .filter(id => {
            const el = document.getElementById('papel-' + id);
            return el && el.checked;
        });
}

async function upsertUsuarioPerfil(user, nome, papeis, apelido) {
    if (!user || !user.id) return { error: null };
    const row = {
        auth_id: user.id,
        nome: nome || (user.user_metadata && user.user_metadata.nome) || 'Usuário',
        email: user.email,
        senha_hash: 'supabase-auth'
    };
    const ap = (apelido != null ? apelido : (user.user_metadata && user.user_metadata.apelido)) || '';
    // Sempre grava apelido (string, pode ser vazia) para o índice nome+apelido
    row.apelido = String(ap).trim() ? String(ap).trim() : null;
    // Só grava tipo/papeis no CADASTRO (papeis explícito). No login NÃO enviar —
    // senão sobrescreve admin → operador e apaga o menu Admin.
    if (Array.isArray(papeis)) {
        row.papeis = papeis;
        row.tipo = papeis.includes('admin') ? 'admin' : 'operador';
    }
    // Perfil já existe (todo login) → UPDATE direto. O upsert dispara o gatilho de
    // unicidade nome+apelido no INSERT e conta a própria linha → 409 no console a cada login.
    try {
        const { data: ja } = await supabaseClient.from('usuarios').select('auth_id').eq('auth_id', user.id).maybeSingle();
        if (ja && ja.auth_id === user.id) {
            const upd0 = { nome: row.nome, email: row.email, senha_hash: 'supabase-auth', apelido: row.apelido };
            if (Array.isArray(papeis)) { upd0.papeis = row.papeis; upd0.tipo = row.tipo; }
            const { error: e0 } = await supabaseClient.from('usuarios').update(upd0).eq('auth_id', user.id);
            if (!e0) return { error: null };
            if (typeof erroUnicidadeNomeApelido === 'function' && erroUnicidadeNomeApelido(e0)) return { error: e0 };
            console.warn('update own usuario:', e0.message);
            return { error: e0 };
        }
    } catch (e) { /* segue p/ upsert */ }
    // Conflict target MUST be auth_id only — never overwrite another profile by email/id
    const { error } = await supabaseClient
        .from('usuarios')
        .upsert(row, { onConflict: 'auth_id' });
    if (!error) return { error: null };
    console.warn('upsert auth_id:', error.message);
    if (typeof erroUnicidadeNomeApelido === 'function' && erroUnicidadeNomeApelido(error)) {
        return { error: error };
    }
    const { data: own } = await supabaseClient
        .from('usuarios')
        .select('id, auth_id')
        .eq('auth_id', user.id)
        .maybeSingle();
    if (own && own.auth_id === user.id) {
        const upd = {
            nome: row.nome,
            email: row.email,
            senha_hash: 'supabase-auth',
            apelido: row.apelido
        };
        if (Array.isArray(papeis)) {
            upd.papeis = row.papeis;
            upd.tipo = row.tipo;
        }
        const { error: updErr } = await supabaseClient
            .from('usuarios')
            .update(upd)
            .eq('auth_id', user.id);
        if (updErr) console.warn('update own usuario:', updErr.message);
        return { error: updErr || null };
    }
    // Insert sem papeis: defaults do banco (tipo operador, papeis {})
    const ins = Object.assign({}, row);
    if (!Array.isArray(papeis)) {
        ins.tipo = 'operador';
        ins.papeis = [];
    }
    const { error: insErr } = await supabaseClient.from('usuarios').insert([ins]);
    if (insErr) console.warn('insert usuario:', insErr.message);
    return { error: insErr || null };
}

/* ===== Confirmação de e-mail (Supabase Auth "Confirm email" ligado) =====
 * Cadastro sem sessão: mostra o cartão "Enviamos um link…". O perfil (usuarios), o apelido e a indicação
 * só podem ser gravados com sessão (RLS) → são feitos no 1º login / na volta do link (finalizarCadastroSeNecessario). */
/* CAPTCHA (Cloudflare Turnstile, captcha.js). Sem chave no config.js = desligado (tudo como antes). */
const MC = window.MineraCaptcha || {
    ativo: false, MSG: '', ehErro: () => false, opcoes: (b) => Object.assign({}, b || {}),
    criar: () => ({ ativo: false, pegar: () => '', liberar() {}, pronto: () => true, sincronizar() {} })
};
const MSG_CAPTCHA_ESPERA = 'Espere a verificação “Não sou um robô” terminar e tente de novo.';
let capEntrar = null, capCadastrar = null, capReenviar = null;
/** Versão dos Termos de Uso/Privacidade aceita no cadastro (igual à de termos.html). */
const TERMOS_VERSAO = '2026-10-09';
/** Faz UMA chamada protegida do supabase.auth com token novo e renova o quadrinho depois (token só vale 1 vez).
 *  Devolve { espera: true } se ainda não há token (não chama o Supabase). */
async function comCaptcha(cap, fn) {
    const t = cap ? cap.pegar() : '';
    if (t === null) return { espera: true, data: null, error: null };
    try { return await fn(t); } finally { if (cap) cap.liberar(); }
}

const MSG_CONFIRMAR_EMAIL = 'Confirme seu e-mail: enviamos um link para a sua caixa de entrada (veja também o spam).';
const REENVIO_ESPERA_S = 60;

/** Para onde o link do e-mail volta: sempre o login do app em que a pessoa se cadastrou (site, /chat/ ou /gestor/). */
function urlRetornoConfirmacao() {
    let base = '';
    try { if (typeof APP_PUBLIC_URL === 'string' && /^https:\/\//.test(APP_PUBLIC_URL)) base = APP_PUBLIC_URL; } catch (e) { /* ignore */ }
    if (!base) base = window.location.origin + (typeof APP_ROOT !== 'undefined' ? APP_ROOT : '/');
    if (!/\/$/.test(base)) base += '/';
    const sub = window.MINERA_CHAT_APP === true ? 'chat/' : (window.MINERA_GESTOR_APP === true ? 'gestor/' : '');
    return base + sub + 'entrar.html';
}

/** URL com que a página abriu (guardada no <head> antes do supabase-js limpar o #). */
function urlAuthInicial() {
    try {
        const u = window.MINERA_URL_AUTH;
        if (u && typeof u === 'object') return String(u.h || '') + '&' + String(u.s || '');
    } catch (e) { /* ignore */ }
    return String(window.location.hash || '') + '&' + String(window.location.search || '');
}
function urlParam(nome) {
    try {
        const p = new URLSearchParams(urlAuthInicial().replace(/^#/, '').replace(/&\?/, '&').replace(/^\?/, ''));
        return (p.get(nome) || '').trim();
    } catch (e) { return ''; }
}
/** Marca gravada no <head> do entrar.html (vale 2 min: sobrevive ao recarregamento de build do pwa.js). */
function voltaEmailMarca() {
    try {
        const v = String(sessionStorage.getItem('minera_volta_email') || '').split(':');
        if (v[0] && Date.now() - Number(v[1] || 0) < 120000) return v[0];
    } catch (e) { /* ignore */ }
    return '';
}
function limparVoltaEmail() { try { sessionStorage.removeItem('minera_volta_email'); } catch (e) { /* ignore */ } }
/** Voltou do link "Confirmar meu e-mail"? */
function urlIndicaConfirmacaoCadastro() {
    const t = urlParam('type').toLowerCase();
    if ((t === 'signup' || t === 'email') && !urlParam('error_code') && !urlParam('error')) return true;
    return voltaEmailMarca() === 'confirmado';
}
/** Link vencido / já usado / inválido (o Supabase volta com #error=…&error_code=…). */
function urlErroLinkEmail() {
    return urlParam('error_code') || urlParam('error') || (voltaEmailMarca() === 'erro' ? 'erro' : '');
}

function emailEhNaoConfirmado(error) {
    if (!error) return false;
    return String(error.code || '') === 'email_not_confirmed' || /email not confirmed/i.test(String(error.message || ''));
}

function chaveReenvio(email) { return 'minera_reenvio_' + String(email || '').trim().toLowerCase(); }
function marcarReenvio(email) { try { localStorage.setItem(chaveReenvio(email), String(Date.now())); } catch (e) { /* ignore */ } }
function segundosParaReenviar(email) {
    try {
        const t = Number(localStorage.getItem(chaveReenvio(email)) || 0);
        const falta = Math.ceil((t + REENVIO_ESPERA_S * 1000 - Date.now()) / 1000);
        return falta > 0 ? Math.min(falta, REENVIO_ESPERA_S) : 0;
    } catch (e) { return 0; }
}

/** Botão "Reenviar e-mail de confirmação" com espera de 60 s (contador no próprio botão). */
function prepararBotaoReenvio(btn, getEmail, mostrar, cap) {
    if (!btn) return;
    const rotulo = 'Reenviar e-mail de confirmação';
    btn._mcapTrava = () => segundosParaReenviar(getEmail()) > 0;
    function atualizar() {
        const falta = segundosParaReenviar(getEmail());
        if (falta > 0) {
            btn.disabled = true;
            btn.textContent = 'Reenviar em ' + falta + ' s';
            clearTimeout(btn._reenvioT);
            btn._reenvioT = setTimeout(atualizar, 1000);
        } else {
            btn.disabled = !!(btn._reenvioCap && !btn._reenvioCap.pronto());
            btn.textContent = rotulo;
        }
    }
    btn._reenvioCap = cap || null;
    btn._atualizarReenvio = atualizar;
    if (!btn._reenvioBound) {
        btn._reenvioBound = true;
        btn.addEventListener('click', async () => {
            const email = String(getEmail() || '').trim();
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { mostrar('Digite o seu e-mail no campo E-mail.', false); return; }
            if (segundosParaReenviar(email) > 0) { atualizar(); return; }
            const capR = btn._reenvioCap;
            if (capR && !capR.pronto()) { mostrar(MSG_CAPTCHA_ESPERA, false); return; }
            btn.disabled = true;
            btn.textContent = 'Enviando...';
            try {
                const r = await comCaptcha(capR, (tk) => supabaseClient.auth.resend({
                    type: 'signup',
                    email,
                    options: MC.opcoes({ emailRedirectTo: urlRetornoConfirmacao() }, tk)
                }));
                const error = r.error;
                if (r.espera) {
                    mostrar(MSG_CAPTCHA_ESPERA, false);
                } else if (error && MC.ehErro(error)) {
                    mostrar(MC.MSG, false); // captcha recusado: não conta a espera de 60 s
                } else if (error) {
                    marcarReenvio(email);
                    const t = String(error.code || '') + ' ' + String(error.message || '') + ' ' + String(error.status || '');
                    if (/rate|429|security purposes|after \d+ seconds|over_email/i.test(t)) {
                        mostrar('Muitos pedidos em pouco tempo. Espere alguns minutos e tente de novo.', false);
                    } else {
                        mostrar('Não deu para reenviar agora. Tente de novo em alguns minutos.', false);
                    }
                } else {
                    marcarReenvio(email);
                    mostrar('Pronto! Enviamos um novo link para ' + email + '. Veja a caixa de entrada e o spam.', true);
                }
            } catch (err) {
                marcarReenvio(email);
                mostrar('Sem conexão. Confira a internet e tente de novo.', false);
            }
            atualizar();
        });
    }
    atualizar();
}

/** Cartão "Enviamos um link para <email>" (depois do cadastro, quando o Supabase pede confirmação). */
function mostrarCartaoConfirmarEmail(email) {
    const wc = document.getElementById('welcome-card');
    if (wc) wc.classList.add('oculto');
    const ac = document.getElementById('auth-card');
    if (ac) ac.classList.add('oculto');
    const card = document.getElementById('confirmar-email-card');
    if (!card) { msg('Enviamos um link para ' + email + '. Abra o e-mail e toque em Confirmar meu e-mail para ativar sua conta.', true); return; }
    const alvo = document.getElementById('conf-email-alvo');
    if (alvo) alvo.textContent = email;
    const cm = document.getElementById('conf-msg');
    if (cm) { cm.textContent = ''; cm.className = 'msg'; }
    card.classList.remove('oculto');
    card.dataset.email = email;
    prepararBotaoReenvio(document.getElementById('btn-reenviar-confirmacao'), () => card.dataset.email || '', (t, ok) => {
        if (!cm) return;
        cm.textContent = t;
        cm.className = 'msg ' + (ok ? 'ok' : 'erro');
    }, capReenviar);
    try { card.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ }
}

function esconderReenvioLogin() {
    const b = document.getElementById('btn-reenviar-login');
    if (b) b.classList.add('oculto');
}
function mostrarReenvioLogin() {
    const b = document.getElementById('btn-reenviar-login');
    if (!b) return;
    b.classList.remove('oculto');
    prepararBotaoReenvio(b, () => (document.getElementById('login-email') || {}).value || '', msg, capEntrar);
}

/**
 * 1º login depois de confirmar o e-mail: cria o perfil (usuarios) com o que a pessoa preencheu no cadastro
 * (guardado no user_metadata: nome, apelido, papéis, código de indicação), aplica a indicação e gera o código
 * de convite. Não faz nada se o perfil já existe. Devolve { novo, aviso }.
 */
async function finalizarCadastroSeNecessario(user) {
    const r = { novo: false, aviso: '' };
    if (!user || !user.id) return r;
    try {
        const { data: ja, error: eSel } = await supabaseClient.from('usuarios').select('auth_id').eq('auth_id', user.id).maybeSingle();
        if (eSel) return r;
        const meta = user.user_metadata || {};
        const nome = String(meta.nome || '').trim() || 'Usuário';
        if (ja && ja.auth_id) {
            // Perfil já existe: só garante a indicação do cadastro (se o 1º login foi interrompido no meio)
            await aplicarIndicacaoDoCadastro(user, meta, nome, false);
            return r;
        }
        const validos = PAPEIS_OPCOES.map(p => p.id);
        const papeis = Array.isArray(meta.papeis) ? meta.papeis.filter(id => validos.indexOf(id) >= 0) : [];
        let apelido = String(meta.apelido || '').trim();
        let up = await upsertUsuarioPerfil(user, nome, papeis, apelido);
        if (up && up.error && typeof erroUnicidadeNomeApelido === 'function' && erroUnicidadeNomeApelido(up.error)) {
            // Outra pessoa pegou o mesmo nome+apelido enquanto o e-mail não era confirmado
            for (let i = 0; i < 3 && up && up.error; i++) {
                const novoAp = ((apelido || 'Minera') + ' ' + (100 + Math.floor(Math.random() * 900))).slice(0, 40);
                up = await upsertUsuarioPerfil(user, nome, papeis, novoAp);
                if (!up || !up.error) {
                    r.aviso = 'O apelido "' + (apelido || nome) + '" já estava em uso. Usamos "' + novoAp + '" — você pode trocar no Perfil.';
                    apelido = novoAp;
                    try { await supabaseClient.auth.updateUser({ data: { apelido: novoAp } }); } catch (eMeta) { /* ignore */ }
                }
            }
        }
        if (up && up.error) { console.warn('perfil 1º login:', up.error.message); return r; }
        r.novo = true;
        await aplicarIndicacaoDoCadastro(user, meta, nome, true);
        if (typeof garantirCodigoIndicacao === 'function') {
            try { await garantirCodigoIndicacao({ auth_id: user.id, nome: nome, apelido: apelido }); } catch (eCod) { /* ignore */ }
        }
    } catch (e) {
        console.warn('finalizarCadastro', e);
    }
    return r;
}

/**
 * Indicação do cadastro: código digitado (user_metadata.ref_codigo, vale em qualquer aparelho) ou, no perfil novo,
 * o guardado neste aparelho. processar_indicacao (servidor) só vale 1 vez por conta e recusa auto-indicação.
 */
async function aplicarIndicacaoDoCadastro(user, meta, nome, perfilNovo) {
    if (typeof processarIndicacaoNoCadastro !== 'function') return;
    const chave = 'minera_ref_ok_' + user.id;
    try {
        if (localStorage.getItem(chave) === '1') return;
        const ref = String((meta && meta.ref_codigo) || '').trim().toUpperCase();
        const temRef = /^[A-Z0-9_-]{3,20}$/.test(ref);
        if (!temRef && !perfilNovo) return;
        if (temRef) localStorage.setItem('minera_ref', ref);
        await processarIndicacaoNoCadastro(user, nome);
        localStorage.setItem(chave, '1');
        localStorage.removeItem('minera_ref_pendente');
    } catch (e) { /* ignore */ }
}

async function irSeLogado() {
    // pwa.js vai recarregar a página (build novo): faz tudo no recarregamento, sem cortar o 1º login no meio
    if (window.__mineraRecarregando === true) return;
    const confirmou = urlIndicaConfirmacaoCadastro();
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            if (confirmou) {
                limparHashAuth();
                msg('E-mail confirmado! Agora entre com seu e-mail e senha.', true);
            }
            return;
        }
        const fin = await finalizarCadastroSeNecessario(session.user);
        if (confirmou) {
            limparHashAuth();
            msg('E-mail confirmado! Sua conta está ativa. Entrando...' + (fin.aviso ? ' ' + fin.aviso : ''), true);
            try { sessionStorage.setItem('minera_apoio_mostrar', '1'); sessionStorage.setItem('minera_sessao_app', '1'); } catch (e2) { /* ignore */ }
            try { if (window.MINERA_CHAT_APP === true) sessionStorage.setItem('minera_chat_unlock_sess_' + session.user.id, '1'); } catch (e3) { /* ignore */ }
            await new Promise(res => setTimeout(res, fin.aviso ? 4000 : 1800));
            limparVoltaEmail();
        }
        let dest = 'inicio.html';
        if (typeof destinoPosLogin === 'function') {
            dest = await destinoPosLogin(session.user);
        }
        irPara(dest);
    } catch (e) {
        console.error(e);
    }
}

function urlIndicaRecuperacao() {
    try {
        const hash = (window.location.hash || '').replace(/^#/, '');
        const hp = new URLSearchParams(hash);
        if ((hp.get('type') || '').toLowerCase() === 'recovery') return true;
        const q = new URLSearchParams(window.location.search || '');
        if ((q.get('type') || '').toLowerCase() === 'recovery') return true;
    } catch (e) { /* ignore */ }
    return false;
}

function limparHashAuth() {
    try {
        if (window.history && history.replaceState) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    } catch (e) { /* ignore */ }
}

function mostrarFormNovaSenha() {
    const wc = document.getElementById('welcome-card');
    if (wc) wc.classList.add('oculto');
    const ac = document.getElementById('auth-card');
    if (ac) ac.classList.remove('oculto');
    const tabs = document.querySelector('.tabs');
    if (tabs) tabs.classList.add('oculto');
    const welcome = document.getElementById('cadastro-welcome');
    if (welcome) welcome.classList.add('oculto');
    const fe = document.getElementById('form-entrar');
    const fc = document.getElementById('form-cadastrar');
    const fn = document.getElementById('form-nova-senha');
    if (fe) { fe.classList.add('oculto'); fe.style.display = 'none'; }
    if (fc) { fc.classList.add('oculto'); fc.style.display = 'none'; }
    if (fn) {
        fn.classList.remove('oculto');
        fn.style.display = 'flex';
        const p1 = document.getElementById('nova-senha');
        setTimeout(() => p1 && p1.focus(), 50);
    }
    const h = document.querySelector('.auth-header p');
    if (h) h.textContent = 'Defina uma nova senha para continuar';
}

let modoRecuperacao = false;

function entrarModoRecuperacao() {
    if (modoRecuperacao) return;
    modoRecuperacao = true;
    mostrarFormNovaSenha();
    msg('Link de recuperação válido. Escolha sua nova senha.', true);
}

document.addEventListener('DOMContentLoaded', () => {
    // Quadrinhos "Não sou um robô" (só com TURNSTILE_SITEKEY no config.js): Entrar/Esqueci/Reenviar do login,
    // Criar conta e Reenviar do cartão "Confirme seu e-mail". Botões ficam desligados até a verificação passar.
    const qs = (s) => document.querySelector(s);
    const reenvioAtualiza = (id) => { const b = document.getElementById(id); if (b && b._atualizarReenvio) b._atualizarReenvio(); };
    capEntrar = MC.criar(document.getElementById('cap-entrar'), {
        acao: 'login',
        botoes: () => [qs('#form-entrar button[type=submit]'), qs('#btn-esqueci'), qs('#btn-reenviar-login')],
        aoMudar: () => reenvioAtualiza('btn-reenviar-login')
    });
    capCadastrar = MC.criar(document.getElementById('cap-cadastrar'), { acao: 'signup', botoes: () => [qs('#form-cadastrar button[type=submit]')] });
    // Termos de Uso + Política de Privacidade: "Criar conta" só libera com a caixinha marcada (junto com o captcha)
    {
        const btnCad = qs('#form-cadastrar button[type=submit]'), chkT = document.getElementById('cad-termos');
        if (btnCad && chkT) {
            btnCad._mcapTrava = () => !chkT.checked;
            const sincT = () => {
                try { if (capCadastrar && capCadastrar.sincronizar) capCadastrar.sincronizar(); } catch (e) { /* ignore */ }
                if (!chkT.checked) btnCad.disabled = true;
                else if (!btnCad.hasAttribute('data-captcha-espera')) btnCad.disabled = false;
            };
            chkT.addEventListener('change', sincT); sincT();
        }
    }
    capReenviar = MC.criar(document.getElementById('cap-reenviar'), {
        acao: 'resend',
        botoes: () => [qs('#btn-reenviar-confirmacao')],
        aoMudar: () => reenvioAtualiza('btn-reenviar-confirmacao')
    });

    document.getElementById('tab-entrar').addEventListener('click', () => mostrarAba('entrar'));
    document.getElementById('tab-cadastrar').addEventListener('click', () => mostrarAba('cadastrar'));

    // Recovery: Supabase redireciona com hash type=recovery e dispara PASSWORD_RECOVERY
    try {
        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') entrarModoRecuperacao();
        });
    } catch (e) { console.warn(e); }
    if (urlIndicaRecuperacao()) entrarModoRecuperacao();

    // Cartão "Confirme seu e-mail": "Já confirmei — entrar" volta para o login com o e-mail preenchido
    const btnConfVoltar = document.getElementById('btn-conf-voltar');
    if (btnConfVoltar) btnConfVoltar.addEventListener('click', () => {
        const card = document.getElementById('confirmar-email-card');
        if (card) card.classList.add('oculto');
        const ac = document.getElementById('auth-card');
        if (ac) ac.classList.remove('oculto');
        mostrarAba('entrar');
        const s = document.getElementById('login-senha');
        setTimeout(() => s && s.focus(), 60);
    });

    document.getElementById('btn-esqueci').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        if (!email) {
            msg('Preencha o e-mail acima para recuperar a senha.', false);
            document.getElementById('login-email').focus();
            return;
        }
        if (capEntrar && !capEntrar.pronto()) { msg(MSG_CAPTCHA_ESPERA, false); return; }
        msg('Enviando e-mail de recuperação...', true);
        try {
            const root = (typeof APP_ROOT !== 'undefined' ? APP_ROOT : (/^\/minera-app(\/|$)/.test(location.pathname) ? '/minera-app/' : '/'));
            const redirectTo = window.location.origin + root + 'index.html';
            const r = await comCaptcha(capEntrar, (tk) => supabaseClient.auth.resetPasswordForEmail(email, MC.opcoes({ redirectTo }, tk)));
            if (r.espera) { msg(MSG_CAPTCHA_ESPERA, false); return; }
            const error = r.error;
            if (error) {
                msg(MC.ehErro(error) ? MC.MSG : ('Erro: ' + error.message), false);
                return;
            }
            msg('Se este e-mail existir, enviamos um link para redefinir a senha. Confira a caixa de entrada.', true);
        } catch (err) {
            msg('Falha ao enviar: ' + (err.message || err), false);
        }
    });

    try { ['cad-senha', 'nova-senha'].forEach(id => mineraSenhaRegra(document.getElementById(id))); } catch (eRegra) { /* ignore */ }
    const formNova = document.getElementById('form-nova-senha');
    if (formNova) {
        formNova.addEventListener('submit', async (e) => {
            e.preventDefault();
            const s1 = (document.getElementById('nova-senha') || {}).value || '';
            const s2 = (document.getElementById('nova-senha-confirma') || {}).value || '';
            if (!mineraSenhaOk(s1)) {
                msg(MINERA_SENHA_MSG + '.', false);
                return;
            }
            if (s1 !== s2) {
                msg('As senhas não coincidem.', false);
                return;
            }
            msg('Salvando nova senha...', true);
            try {
                const { error } = await supabaseClient.auth.updateUser({ password: s1 });
                if (error) {
                    msg(/weak_password|at least|should contain|characters/i.test(String(error.code || '') + ' ' + String(error.message || '')) ? MINERA_SENHA_MSG + '.' : ('Erro ao atualizar senha: ' + error.message), false);
                    return;
                }
                limparHashAuth();
                // Nova senha = os outros aparelhos que estavam nesta conta saem (quem não sabe a senha nova não continua dentro)
                try { await supabaseClient.auth.signOut({ scope: 'others' }); } catch (eOut) { /* ignore */ }
                msg('Senha atualizada! Os outros aparelhos desta conta foram desconectados. Entrando...', true);
                setTimeout(() => irPara('inicio.html'), 600);
            } catch (err) {
                msg('Falha: ' + (err.message || err), false);
            }
        });
    }

    document.getElementById('form-entrar').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (capEntrar && !capEntrar.pronto()) { msg(MSG_CAPTCHA_ESPERA, false); return; }
        msg('Entrando...', true);
        esconderReenvioLogin();
        limparVoltaEmail();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-senha').value;
        try {
            const r = await comCaptcha(capEntrar, (tk) => supabaseClient.auth.signInWithPassword({ email, password, options: MC.opcoes(null, tk) }));
            if (r.espera) { msg(MSG_CAPTCHA_ESPERA, false); return; }
            const { data, error } = r;
            if (error && MC.ehErro(error)) { msg(MC.MSG, false); return; }
            if (error && emailEhNaoConfirmado(error)) {
                msg(MSG_CONFIRMAR_EMAIL, false);
                mostrarReenvioLogin();
                return;
            }
            if (error) {
                msg(error.message === 'Invalid login credentials'
                    ? 'E-mail ou senha incorretos. Confira se já criou a conta e se a senha está certa.'
                    : ('Erro: ' + error.message), false);
                return;
            }
            if (!data.session) {
                msg('Login sem sessão. Tente de novo.', false);
                return;
            }
            // 1º login depois de confirmar o e-mail: cria o perfil com nome/apelido/papéis/indicação do cadastro
            const fin = await finalizarCadastroSeNecessario(data.user);
            if (fin.aviso) {
                msg(fin.aviso, true);
                await new Promise(res => setTimeout(res, 3500));
            }
            // Perfil que já existia: sem papeis (preserva tipo/admin já gravados no banco)
            if (!fin.novo) await upsertUsuarioPerfil(data.user, data.user.user_metadata && data.user.user_metadata.nome);
            let dest = 'inicio.html';
            if (typeof destinoPosLogin === 'function') {
                dest = await destinoPosLogin(data.user);
            }
            // Entrada no app: card "Pix de apoio" 1x na primeira página (MineraApoio em nav.js)
            try { sessionStorage.setItem('minera_apoio_mostrar', '1'); sessionStorage.setItem('minera_sessao_app', '1'); } catch (e2) { /* ignore */ }
            // Chat Minera com "pedir senha" ligado: quem acabou de entrar com a senha não digita de novo (chat-trava.js)
            try { if (window.MINERA_CHAT_APP === true) sessionStorage.setItem('minera_chat_unlock_sess_' + data.user.id, '1'); } catch (e3) { /* ignore */ }
            irPara(dest);
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no login: ' + (err.message || err), false);
        }
    });

    const MSG_EMAIL_JA_TEM_CONTA = 'Esse e-mail já tem conta no Minera Pará. Toque em Entrar ou em Esqueci minha senha.';
    document.getElementById('form-cadastrar').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (capCadastrar && !capCadastrar.pronto()) { msg(MSG_CAPTCHA_ESPERA, false); return; }
        msg('Criando conta...', true);
        const nome = document.getElementById('cad-nome').value.trim();
        const apelidoEl = document.getElementById('cad-apelido');
        const apelido = apelidoEl ? apelidoEl.value.trim() : '';
        const email = document.getElementById('cad-email').value.trim();
        const password = document.getElementById('cad-senha').value;
        if (!mineraSenhaOk(password)) { msg(MINERA_SENHA_MSG + '.', false); return; }
        const chkTermos = document.getElementById('cad-termos');
        if (chkTermos && !chkTermos.checked) { msg('Para criar a conta, marque que leu e concorda com os Termos de Uso e a Política de Privacidade.', false); return; }
        const papeis = lerPapeisCadastro();
        // Código de indicação digitado (opcional) → minera_ref (validação real no servidor: processar_indicacao)
        const refEl = document.getElementById('cad-ref');
        let refCodigo = '';
        if (refEl) {
            const refTxt = refEl.value.trim().toUpperCase().replace(/\s+/g, '');
            try {
                if (/^[A-Z0-9_-]{3,20}$/.test(refTxt)) { localStorage.setItem('minera_ref', refTxt); refCodigo = refTxt; }
                else if (!refTxt) localStorage.removeItem('minera_ref');
            } catch (eRef) { /* ignore */ }
        }
        try {
            if (typeof verificarNomeApelidoDisponivel === 'function') {
                const chk = await verificarNomeApelidoDisponivel(nome, apelido, null);
                if (!chk.ok) {
                    msg(chk.message || MSG_NOME_APELIDO_DUPLICADO, false);
                    return;
                }
            }
            if (!refCodigo && typeof lerRefSalvo === 'function') {
                const salvo = lerRefSalvo();
                if (/^[A-Z0-9_-]{3,20}$/.test(salvo)) refCodigo = salvo;
            }
            const meta = { nome, papeis, apelido };
            if (chkTermos && chkTermos.checked) { meta.termos_aceitos_em = new Date().toISOString(); meta.termos_versao = TERMOS_VERSAO; }
            if (refCodigo) meta.ref_codigo = refCodigo; // indicação aplicada no 1º login (pode confirmar em outro aparelho)
            const r = await comCaptcha(capCadastrar, (tk) => supabaseClient.auth.signUp({
                email,
                password,
                options: MC.opcoes({
                    data: meta,
                    emailRedirectTo: urlRetornoConfirmacao()
                }, tk)
            }));
            if (r.espera) { msg(MSG_CAPTCHA_ESPERA, false); return; }
            const { data, error } = r;
            if (error && MC.ehErro(error)) { msg(MC.MSG, false); return; }
            // E-mail que já tem conta: com "Confirm email" ligado o Supabase NÃO devolve erro, devolve um usuário com
            // identities = [] (e não manda e-mail nem cria nada); com ele desligado devolve 'User already registered'.
            const jaExiste = (error && /already registered|already exists|user_already_exists|email_exists/i.test(String(error.code || '') + ' ' + String(error.message || ''))) ||
                (!error && data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
            if (jaExiste) {
                // Supabase devolve um usuário "falso" (sem identities) quando o e-mail já tem conta — não é conta nova
                document.getElementById('login-email').value = email;
                document.getElementById('login-senha').value = '';
                mostrarAba('entrar');
                msg(MSG_EMAIL_JA_TEM_CONTA, false);
                return;
            }
            if (error) {
                msg(/weak_password|at least|should contain|characters/i.test(String(error.code || '') + ' ' + String(error.message || '')) ? MINERA_SENHA_MSG + '.' : ('Erro no cadastro: ' + error.message), false);
                return;
            }
            if (data.user && !data.session) {
                // "Confirm email" ligado: sem sessão ainda. Perfil, apelido e indicação são gravados no 1º login
                // (finalizarCadastroSeNecessario) — sem sessão o banco recusa (RLS).
                marcarReenvio(email); // o e-mail acabou de sair: botão Reenviar só daqui a 60 s
                document.getElementById('login-email').value = email;
                document.getElementById('login-senha').value = '';
                mostrarCartaoConfirmarEmail(email);
                return;
            }
            if (data.user) {
                const up = await upsertUsuarioPerfil(data.user, nome, papeis, apelido);
                if (up && up.error && typeof erroUnicidadeNomeApelido === 'function' && erroUnicidadeNomeApelido(up.error)) {
                    msg((typeof MSG_NOME_APELIDO_DUPLICADO === 'string' ? MSG_NOME_APELIDO_DUPLICADO : null) || 'Já existe alguém com este nome e apelido. Escolha outro apelido.', false);
                    return;
                }
                if (typeof processarIndicacaoNoCadastro === 'function') {
                    await processarIndicacaoNoCadastro(data.user, nome);
                }
                // Sem sessão (confirmação de e-mail): credita no 1º login desta conta
                try {
                    if (!data.session && localStorage.getItem('minera_ref')) localStorage.setItem('minera_ref_pendente', email.toLowerCase());
                    else localStorage.removeItem('minera_ref_pendente');
                } catch (ePend) { /* ignore */ }
                // Garante código de indicação do novo usuário
                let perfilNovo = { auth_id: data.user.id, nome: nome, apelido: apelido };
                if (typeof garantirCodigoIndicacao === 'function') {
                    perfilNovo = await garantirCodigoIndicacao(perfilNovo) || perfilNovo;
                }
                if (!data.session && typeof mostrarSharePosCadastro === 'function' && perfilNovo.codigo_indicacao) {
                    if (typeof carregarShareFlags === 'function') await carregarShareFlags();
                    mostrarSharePosCadastro(perfilNovo);
                }
            }
            if (data.session) {
                irPara('inicio.html');
                return;
            }
            document.getElementById('login-email').value = email;
            document.getElementById('login-senha').value = password;
            mostrarAba('entrar');
            msg('Conta criada. Confira e-mail e senha abaixo e aperte Entrar. Você já pode compartilhar seu convite abaixo.', true);
        } catch (err) {
            console.error(err);
            msg('Falha de conexão no cadastro: ' + (err.message || err), false);
        }
    });

    if (typeof capturarRefUrl === 'function') capturarRefUrl();
    try {
        const refIn = document.getElementById('cad-ref');
        const refSalvo = (typeof lerRefSalvo === 'function') ? lerRefSalvo() : '';
        if (refIn && refSalvo && !refIn.value) refIn.value = refSalvo;
    } catch (eRefIn) { /* ignore */ }
    // Convite /c/CODIGO ou ?ref= → welcome + aba cadastro (exceto recuperação)
    const convite = (typeof temConviteIndicacao === 'function')
        ? temConviteIndicacao()
        : (() => {
            try {
                const q = new URLSearchParams(window.location.search);
                return !!(q.get('ref') || q.get('c') || q.get('welcome') === '1');
            } catch (e) { return false; }
        })();
    if (convite) {
        try { sessionStorage.removeItem(WELCOME_SEEN_KEY); } catch (e) { /* ignore */ }
        const wc = document.getElementById('welcome-card');
        if (wc) {
            const title = document.getElementById('welcome-title');
            if (title) title.textContent = 'Bem-vindo à Família Minera';
            const ps = wc.querySelectorAll('p');
            if (ps[0]) {
                ps[0].textContent = 'Você foi convidado(a) para o Minera Pará. Crie sua conta para entrar no marketplace, frete, britagem e Bank — com segurança e renda extra na Família Minera.';
            }
        }
        const cadWel = document.getElementById('cadastro-welcome');
        if (cadWel) {
            const codigo = (typeof lerRefSalvo === 'function' ? lerRefSalvo() : '') || '';
            const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[c]);
            cadWel.innerHTML =
                '<strong>Convite Família Minera' + (codigo ? ' · ' + esc(codigo) : '') + '</strong>' +
                '<p>Ao criar a conta por este link, você entra na rede de indicação. Negocie no app (anti-golpe) e evite combinar pagamento só por WhatsApp.</p>';
        }
    }
    if (!modoRecuperacao) {
        try {
            if (convite) mostrarAba('cadastrar');
            else mostrarAba('entrar');
        } catch (e) {
            mostrarAba('entrar');
        }
        irSeLogado();
        // Link do e-mail vencido/já usado (o Supabase volta com #error_code=otp_expired…)
        if (urlErroLinkEmail() && !urlIndicaRecuperacao()) {
            limparHashAuth();
            mostrarAba('entrar');
            msg('Este link do e-mail venceu ou já foi usado. Entre com seu e-mail e senha. Se aparecer "Confirme seu e-mail", toque em Reenviar e-mail de confirmação. Se esqueceu a senha, toque em Esqueci minha senha.', false);
        }
    }
    try { setupWelcomeGate(); } catch (e) { console.warn('welcome', e); }
    try {
        if (typeof aplicarTema === 'function') aplicarTema(typeof lerTema === 'function' ? lerTema() : 'dark');
        if (typeof bindTemaPicker === 'function') bindTemaPicker(document);
    } catch (e) { console.warn('tema', e); }
});
