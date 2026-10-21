/* MineraBank — app principal (SPA por hash). Todos os dados vêm da API (/me). */
(function () {
  'use strict';
  const { otpSheet, passkey, camera, upload } = window.UI;
  const { ic, brl, esc, $, $$, toast, sheet, closeSheet, confirmSheet, theme, share, copy } = window.UI;
  const API = window.API;
  if (!API.token()) { location.replace('login.html'); return; }
  let D = null; // dados do usuário vindos da API
  const S = { hide: localStorage.getItem('mb_hide') === '1' };
  const V = (v) => (S.hide ? '<span class="hidden-v">R$ ••••</span>' : brl(v));
  const view = () => $('#view');
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const tb = (title, extra) => `<div class="tb"><button class="back" data-back aria-label="Voltar">${ic('left')}</button><h1>${title}</h1>${extra || ''}</div>`;
  const li = (icn, t, s, right, attrs) => `<button class="li" ${attrs || ''}><span class="ic">${ic(icn)}</span><span class="t"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</span>${right !== undefined ? right : ic('chev', 'chev')}</button>`;
  const tog = (id, on, label, dis) => `<label class="tg"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${label}"><span></span></label>`;
  const swRow = (icn, t, s, id, on, dis) => `<div class="li"><span class="ic">${ic(icn)}</span><span class="t"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</span>${tog(id, on, t, dis)}</div>`;
  const empty = (icn, t, p) => `<div class="empty"><div class="ic">${ic(icn)}</div><b>${t}</b>${p ? `<p>${p}</p>` : ''}</div>`;
  // CTA no lugar de estado vazio (mesmo visual de .empty + botões)
  const cta = (icn, t, p, btns = []) => `<div class="empty"><div class="ic">${ic(icn)}</div><b>${t}</b>${p ? `<p>${p}</p>` : ''}${btns.length ? `<div style="margin-top:12px">${btns.map(([l, h, cls, attrs]) => h ? `<a class="btn ${cls || ''}" href="${h}" ${attrs || ''}>${l}</a>` : `<button class="btn ${cls || ''}" ${attrs || ''}>${l}</button>`).join('')}</div>` : ''}</div>`;
  // Ofertas e taxas de referência vêm da API (config.ofertas: CREDITO_ATE_CENTS, CDI_REF_AA, SIMULADOR_MAX_CENTS)
  const OF = () => D.ofertas || { creditoAteCents: 150000, cdiRefAa: 10.65, simuladorMaxCents: 1500000 };
  const pct = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  const proj = (v, meses = 12) => v * Math.pow(1 + OF().cdiRefAa / 100, meses / 12);
  const refNote = () => `Simulação com 100% do CDI de referência (${pct(OF().cdiRefAa)} a.a.), valor bruto antes do IR. Rentabilidade não garantida; rendimento depende do parceiro custodiante.`;
  const creditoBan = () => `<a class="ban" href="#/credito"><span class="ic">${ic('loan')}</span><span class="sp"><b>Crédito de até ${brl(OF().creditoAteCents / 100)}</b><p>Sujeito a análise de crédito · simule agora</p></span>${ic('chev', 'chev')}</a>`;
  const CAT = () => D.cartaoCategoria || { id: 'classico', nome: 'Clássico', multiplicador: 1, beneficios: [], proxima: null, progresso: 0, faltaCents: 0 };
  const ORDEM = [['classico', 'Clássico'], ['ouro', 'Ouro'], ['platinum', 'Platinum'], ['black', 'Black']];
  const catCard = (full) => { const k = CAT(); const i = ORDEM.findIndex((x) => x[0] === k.id);
    return `<div class="card"><div class="row"><b class="sp">Categoria ${esc(k.nome)}</b><span class="pill">MineraPontos ${String(k.multiplicador).replace('.', ',')}x</span>${full ? '<button class="back" id="catInfo" aria-label="Sobre as categorias" style="font-weight:800;margin-left:6px">?</button>' : ''}</div>
      ${k.proxima ? `<div class="bar"><span style="width:${Math.round(k.progresso * 100)}%"></span></div><small class="mut">Faltam ${S.hide ? 'R$ ••••' : brl(k.faltaCents / 100)} para ${esc(k.proxima.nome)}</small>` : ''}
      ${full ? `<div class="tierrow">${ORDEM.map(([id, n], j) => `<span class="${j === i ? 'on' : j < i ? 'done' : ''}">${n}</span>`).join('')}</div><ul class="sm mut" style="padding-left:18px;margin:10px 0 0;line-height:1.6">${(k.beneficios || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`; };
  const G = () => D.garantia || { reservadoCents: 0, limiteCents: 0, usadoCents: 0, disponivelCents: 0, resgatavelCents: 0 };
  const garantiaBan = () => `<a class="ban" href="#/garantia" style="background:var(--y-s);color:var(--tx)"><span class="ic">${ic('shield')}</span><span class="sp"><b>${G().reservadoCents ? 'Limite garantido: ' + (S.hide ? '••••' : brl(G().limiteCents / 100)) : 'Reserve e ganhe limite'}</b><p>${G().reservadoCents ? 'Guarde mais para aumentar seu limite' : 'Cada real guardado vira limite do cartão e continua rendendo'}</p></span>${ic('chev', 'chev')}</a>`;
  // Faixa de verificação de identidade (KYC): o que está liberado e o próximo passo
  function kycBan() {
    if (D.conta.status === 'approved') return '';
    const need = ['nao_enviado', 'incompleto'].includes(D.kyc) || D.conta.status === 'rejected';
    const t = D.conta.status === 'rejected' ? 'Não conseguimos verificar sua identidade' : need ? 'Envie documento e selfie' : 'Verificando sua identidade';
    const p = D.conta.status === 'rejected' ? 'Envie novas fotos ou fale com o atendimento.' : need ? 'Faltam fotos para liberar Pix, transferências e cartão.' : 'Pix, transferências, cartão e investimentos são liberados após a aprovação. Você já pode receber e consultar.';
    return `<section class="sec" style="margin-top:14px"><a class="ban" href="#/verificacao" style="background:var(--y-s);color:var(--tx)"><span class="ic">${ic('shield')}</span><span class="sp"><b>${t}</b><p>${p}</p></span>${ic('chev', 'chev')}</a></section>`;
  }
  function verificacao() {
    const k = D.kyc, ok = D.conta.status === 'approved';
    const step = (done, t, s) => li(done ? 'check' : 'clock', t, s, done ? '<span class="tag ok">Feito</span>' : '<span class="tag">Pendente</span>', '');
    return tb('Verificação de identidade') + `<div class="pg"><div class="card" style="padding:4px 16px">${step(true, 'Dados e CPF', 'Situação do CPF consultada na abertura')}${step(!['nao_enviado', 'incompleto'].includes(k), 'Documento e selfie', 'Frente, verso e selfie enviados cifrados')}${step(ok, 'Prova de vida e análise', ok ? 'Identidade confirmada' : k === 'reprovado' ? 'Não aprovada — envie novas fotos' : 'Em análise pela equipe de segurança')}</div>
    ${ok ? `<div class="card">${cta('check', 'Conta liberada', 'Pix, transferências, cartão e investimentos estão disponíveis.', [['Ir para o início', '#/inicio']])}</div>` : `<div class="card"><b>Enviar fotos</b><p class="sm mut" style="margin:4px 0 12px">Use boa iluminação, sem acessórios. RG ou CNH.</p><div class="g3">${[['doc_frente', 'doc', 'Frente'], ['doc_verso', 'doc', 'Verso'], ['selfie', 'cam', 'Selfie']].map(([id, i, l]) => `<button class="tile" data-kyc="${id}" style="text-align:center"><i style="margin:0 auto 8px">${ic(i)}</i><small>${l}</small></button>`).join('')}</div><input type="file" id="kycF" accept="image/*" hidden></div>`}
    <p class="sm mut">Até a aprovação você pode entrar, ver o saldo e receber. Funções que movimentam dinheiro ficam bloqueadas para proteger você.</p></div>`;
  }
  function atividade() {
    return tb('Atividade de segurança') + `<div class="pg"><div class="card" style="padding:4px 16px" id="audL">${ringHTML(true)}</div><p class="sm mut">Registramos acessos e ações sensíveis. Não reconhece algo? Troque sua senha e encerre as outras sessões.</p></div>`;
  }
  const AUD = { login: ['Entrada no app', 'out'], login_falhou: ['Senha incorreta', 'lock'], login_bloqueado: ['Acesso bloqueado por tentativas', 'lock'], login_otp_enviado: ['Código enviado para novo dispositivo', 'phone'], dispositivo_novo: ['Novo dispositivo conectado', 'device'], senha_alterada: ['Senha alterada', 'key'], senha_redefinida: ['Senha redefinida por código', 'key'], reset_solicitado: ['Recuperação de senha solicitada', 'key'], sessao_revogada: ['Sessão encerrada', 'device'], sessoes_revogadas: ['Outras sessões encerradas', 'device'], passkey_registrada: ['Biometria ativada', 'finger'], passkey_removida: ['Biometria removida', 'finger'], email_alterado: ['E-mail alterado', 'user'], celular_alterado: ['Celular alterado', 'phone'], contato_otp_enviado: ['Código para troca de contato', 'phone'], limite_aumento_solicitado: ['Aumento de limite solicitado', 'gauge'], modo_rua_desligado: ['Modo rua desligado', 'shield'], consentimentos: ['Consentimentos atualizados', 'lock'], dados_exportados: ['Dados exportados (LGPD)', 'doc'], exclusao_solicitada: ['Exclusão de dados solicitada', 'trash'], conta_criada: ['Conta criada', 'user'], kyc_documento_enviado: ['Documento de identidade enviado', 'doc'], kyc_approved: ['Identidade aprovada', 'check'], kyc_rejected: ['Identidade não aprovada', 'help'], admin_decisao_kyc: ['Análise de identidade concluída', 'shield'], comprovante_endereco_enviado: ['Comprovante de endereço enviado', 'home'], emprestimo_analisado: ['Análise de crédito', 'loan'], kyc_documento_visualizado: ['Documento consultado pela equipe de segurança', 'eye'] };
  function checklist() {
    const it = [['Fazer o primeiro depósito', D.saldo > 0 || D.tx.length > 0, '#/depositar', 'cash'], ['Cadastrar uma chave Pix', D.chaves.length > 0, '#/pix/chaves', 'key'], ['Criar uma Caixinha', D.investimentos.caixinhas.length > 0, '#/investir', 'piggy'], ['Pedir seu cartão', !!D.cartao, '#/cartao', 'card']];
    const ok = it.filter((x) => x[1]).length;
    return `<div style="padding:14px 0 6px"><div class="row"><b class="sp">Comece por aqui</b><small class="mut">${ok} de ${it.length}</small></div><div class="bar"><span style="width:${(ok / it.length) * 100}%"></span></div><p class="sm mut" style="margin:6px 0 0">Complete os passos e aproveite tudo da sua conta.</p></div>${it.map(([t, d, h, i]) => li(d ? 'check' : i, d ? `<s class="mut">${t}</s>` : t, d ? 'Feito' : 'Toque para fazer agora', d ? '<span class="tag ok">Feito</span>' : undefined, d ? '' : `data-go="${h}"`)).join('')}`;
  }
  const note = (msg) => `<div class="note">${ic('help')}<span>${esc(msg)}</span></div>`;
  const ringHTML = (sm) => `<div class="lring ${sm ? 'sm' : ''}" role="status" aria-label="Carregando"><i>${ic('mine')}</i></div>`;
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Belem' }).format(new Date());
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const toCents = (str) => { const v = parseFloat(String(str || '').replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(v) ? Math.round(v * 100) : 0; };
  const freqLbl = { once: 'Uma vez', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };
  const schedList = (once) => D.agendamentos.filter((x) => (x.freq === 'once') === once).map((x) => li(once ? 'clock' : 'repeat', esc(x.para), `${once ? '' : freqLbl[x.freq] + ' · '}${x.status === 'falhou' ? 'Falhou: ' + esc(x.erro || '') : 'Próximo: ' + x.proximaData.split('-').reverse().join('/')}${x.restantes != null && !once ? ' · ' + x.restantes + ' restantes' : ''}`, `<span class="right"><b>${brl(x.valorCents / 100)}</b><br><button class="btn sm ol" style="margin-top:4px;height:30px" data-cancel="${esc(x.id)}">Cancelar</button></span>`, '')).join('');
  const fmtDia = (d) => { const t = new Date(); const y = new Date(t - 864e5); if (d === today()) return 'Hoje'; if (d === y.toISOString().slice(0, 10)) return 'Ontem'; const [a, m, dd] = d.split('-'); return new Date(+a, m - 1, +dd).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }); };
  const celDig = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.slice(0, 11); };
  const fmtCel = (c) => { const d = celDig(c); return d.length <= 2 ? d : d.length <= 6 ? d.slice(0, 2) + ' ' + d.slice(2) : d.length <= 10 ? d.slice(0, 2) + ' ' + d.slice(2, d.length - 4) + '-' + d.slice(-4) : d.slice(0, 2) + ' ' + d.slice(2, 7) + '-' + d.slice(7); };
  const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia,' : h < 18 ? 'Boa tarde,' : 'Boa noite,'; };
  const initials = () => { const p = D.nome.split(' '); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };

  // Ação que depende de parceiro: chama a API e mostra a mensagem pt-BR retornada
  function rail(path, title) {
    loadingInline();
    API.post('/me/' + path).then(() => route(), (e) => { route(); infoSheet(title, e.message); });
  }
  function infoSheet(title, msg) { sheet(`<h3>${title}</h3>${note(msg)}<button class="btn" id="okI" style="margin-top:14px">Entendi</button>`, (s) => ($('#okI', s).onclick = () => closeSheet())); }
  function loadingInline() { view().innerHTML = `<div style="min-height:60vh;display:grid;place-items:center">${ringHTML(true)}</div>`; }
  let F = {}; // flags de recursos do servidor (/me/features): entradas de recursos desligados ficam ocultas
  const FF = (k) => F[k] === true;
  // telas que dependem de parceiros/credenciais: com a flag do servidor em false, somem todas as entradas (atalhos, cards, itens de menu) e a rota volta ao início
  const ROUTE_FLAG = { depositar: 'deposito', boleto: 'boleto', recarga: 'recarga', credito: 'credito', seguros: 'seguros', informe: 'informe', integracoes: 'integracoes', garantia: 'cartaoEmissor' };
  const off = (k) => F[k] === false;
  const TEXT_FLAG = { 'Quero investir em CDB': 'investimentos', 'Peça seu cartão': 'cartaoEmissor', 'Aumentar meu limite': 'cartaoEmissor' };
  const routeOff = (r) => { const k = ROUTE_FLAG[r.split('/')[0]]; return !!k && off(k); };
  function applyFlags(root) {
    root = root || document;
    $$('a[href^="#/"],[data-go^="#/"]', root).forEach((el) => { const r = (el.getAttribute('href') || el.dataset.go).slice(2); if (routeOff(r)) el.remove(); });
    if (off('ted')) { const t = $('[data-tt="ted"]', root); if (t) { const i = $('[data-tt="int"]', root); t.remove(); if (i && !i.classList.contains('on')) i.click(); } }
    if (off('turbo')) $$('#apo', root).forEach((el) => el.remove());
    if (off('ordens')) $$('#buy,#sell', root).forEach((el) => el.remove());
    if (off('investimentos')) $$('#apl,#res', root).forEach((el) => el.remove());
    if (off('cartaoEmissor')) $$('#askCard', root).forEach((el) => el.remove());
    $$('a,button', root).forEach((el) => { const k = TEXT_FLAG[(el.innerText || '').trim()]; if (k && off(k)) el.remove(); });
    if (off('otp') && $('#de', root)) $$('#sv', root).forEach((el) => el.remove());
    if (off('otp')) { $$('#de,#dc', root).forEach((el) => (el.disabled = true)); }
    $$('.sec', root).forEach((sec) => { if (!sec.children.length || (sec.querySelector('.promo-wrap') && !sec.querySelector('.promo'))) sec.remove(); });
  }
  async function reload() { const [d, f] = await Promise.all([API.get('/me'), API.get('/me/features').catch(() => F)]); D = d; F = f || {}; }

  /* ---------------- INÍCIO ---------------- */
  const SHORTCUTS = [['pix', 'Pix', '#/pix', 1], ['barcode', 'Pagar boleto', '#/boleto'], ['send', 'Transferir', '#/transferir'], ['plus', 'Depositar', '#/depositar'], ['phone', 'Recarga celular', '#/recarga'], ['qr', 'Cobrar', '#/pix/cobrar'], ['loan', 'Empréstimo', '#/credito'], ['chart', 'Investir', '#/investir'], ['piggy', 'Caixinhas', '#/investir'], ['card', 'Cartões', '#/cartao'], ['shield', 'Seguros', '#/seguros'], ['gift', 'Indicar amigos', '#/indique']];
  function inicio() {
    if (!D) return '';
    const unread = D.notifs.filter((n) => !n.lida).length;
    const inv = sum(D.investimentos.caixinhas.map((x) => x.saldoCents)) / 100;
    const st = D.conta.status === 'approved' ? 'Conta ativa' : D.conta.status === 'rejected' ? 'Verificação não aprovada' : 'Conta em análise';
    return `<header class="hd">
      <div class="hd-row"><a class="av" href="#/perfil" aria-label="Perfil">${esc(initials())}</a>
        <div class="hd-hi"><small>${saudacao()}</small><b>${esc(D.primeiroNome)}</b></div>
        <button class="ib" id="eye" aria-label="${S.hide ? 'Mostrar' : 'Ocultar'} valores">${ic(S.hide ? 'eyeoff' : 'eye')}</button>
        <a class="ib" href="#/ajuda" aria-label="Ajuda">${ic('help')}</a>
        <a class="ib" href="#/notificacoes" aria-label="Notificações">${ic('bell')}${unread ? `<span class="badge">${unread}</span>` : ''}</a></div>
      <a class="bal" href="#/extrato" style="display:block"><small>Saldo em conta</small><div class="v">${V(D.saldo)}</div>
        <span class="cdi">${st} · Ag ${esc(D.conta.agencia)} · Conta ${esc(D.conta.numero)}</span></a>
    </header>
    ${kycBan()}${D.saldo > 0 ? '' : `<section class="sec" style="margin-top:14px"><a class="ban" href="#/depositar" style="background:var(--ink);color:#fff"><span class="ic" style="background:var(--y);color:#111">${ic('pix')}</span><span class="sp"><b>Deposite via Pix e comece a render hoje</b><p style="color:#B8B8C0">Seu dinheiro guardado em Caixinhas rende com referência de 100% do CDI.</p></span>${ic('chev', 'chev')}</a></section>`}
    <nav class="sc-wrap" aria-label="Atalhos">${SHORTCUTS.map(([i, l, h, hl]) => `<a class="sc ${hl ? 'hl' : ''}" href="${h}"><i>${ic(i)}</i>${l}</a>`).join('')}</nav>
    <section class="sec"><div class="sec-h"><h2>Cartão de crédito</h2><a href="#/cartao">Ver cartão</a></div>
      ${D.cartao ? `<a class="card" href="#/cartao" style="display:block"><div class="row"><span class="sp"><small class="mut">Cartão virtual · limite de gastos</small><div class="b" style="font-size:22px">${V(D.cartao.limiteCents / 100)}</div></span><span class="tag ${D.cartao.bloqueado ? 'bad' : ''}">${D.cartao.bloqueado ? 'Bloqueado' : 'Emissão pendente'}</span></div><div class="bar"><span style="width:0%"></span></div><div class="row sm"><span class="sp mut">Sem fatura enquanto o emissor parceiro não estiver conectado</span></div></a>` : `<a class="card" href="#/cartao" style="display:block"><div class="row"><span class="sp"><small class="mut">Limite disponível</small><div class="b" style="font-size:22px">${V(G().limiteCents / 100)}</div></span><span class="tag">Sem anuidade</span></div><div class="bar"><span style="width:0%"></span></div><div class="row sm"><span class="sp mut">Utilizado ${V(0)}</span><b style="color:var(--y-d,#C99F00)">Peça seu cartão ›</b></div></a>`}</section>
    <section class="sec">${garantiaBan()}</section>
    <section class="sec">${creditoBan()}</section>
    <section class="sec"><div class="sec-h"><h2>Investimentos</h2><a href="#/investir">Ver tudo</a></div>
      <a class="card" href="#/investir" style="display:block">${D.investimentos.caixinhas.length ? `<small class="mut">Guardado em Caixinhas</small><div class="b" style="font-size:22px">${V(inv)}</div><div class="g3" style="margin-top:12px">${D.investimentos.caixinhas.slice(0, 3).map((x) => `<div><small class="mut" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.nome)}</small><div class="bar" style="margin:6px 0 0"><span style="width:${x.metaCents ? Math.min(100, (x.saldoCents / x.metaCents) * 100) : 0}%"></span></div></div>`).join('')}</div>` : `<small class="mut">Quanto seu dinheiro pode render</small><div class="b" style="font-size:20px;margin-top:2px">R$ 1.000 viraria ${brl(proj(1000))}</div><p class="sm mut" style="margin:4px 0 8px">em 12 meses a 100% do CDI (referência ${pct(OF().cdiRefAa)} a.a., bruto)</p><b style="color:var(--y-d,#C99F00)">Crie sua primeira Caixinha ›</b>`}</a></section>
    <section class="sec"><div class="sec-h"><h2>Seu relacionamento</h2><a href="#/score">Ver score</a></div>
      <a class="card" href="#/score" style="display:block"><div class="row"><span class="sp"><small class="mut">Score MineraBank</small><div class="b" style="font-size:24px">${D.score ? D.score.valor : '—'}<span class="mut" style="font-size:14px;font-weight:600"> /1000</span></div></span><b style="color:var(--y-d,#C99F00)">Ver ›</b></div><div class="bar"><span style="width:${D.score ? D.score.valor / 10 : 0}%"></span></div></a>
      <a href="#/cartao" style="display:block;margin-top:10px;color:inherit;text-decoration:none">${catCard(false)}</a></section>
    <section class="sec" style="margin-left:0;margin-right:0"><div class="sec-h" style="margin:0 18px 10px"><h2>Para você</h2></div>
      <div class="promo-wrap">
        <a class="promo" href="#/indique" style="background:linear-gradient(135deg,#111114,#3a3216)"><span class="tag">Indique</span><span><b>Convide amigos</b><p>Compartilhe a MineraBank com quem você confia.</p></span></a>
        <a class="promo" href="#/integracoes" style="background:linear-gradient(135deg,#C99F00,#F5C400);color:#111"><span class="tag" style="background:#111;color:#F5C400">Vendas</span><span><b>Receba com Mercado Pago</b><p>Conecte sua conta e cobre com Pix.</p></span></a>
        <a class="promo" href="#/seguros" style="background:linear-gradient(135deg,#2B2B31,#5E5E66)"><span class="tag">Seguros</span><span><b>Proteção em breve</b><p>Seguros com parceira registrada na SUSEP.</p></span></a>
      </div></section>
    <section class="sec"><a class="card row" href="#/integracoes"><span class="ic" style="width:46px;height:46px;border-radius:14px;background:var(--y-s);display:grid;place-items:center">${ic('mine')}</span><span class="sp"><b>Ponte Minera Pará</b><small class="mut" style="display:block">${D.bridge.ativo ? 'Conectada' : D.bridge.disponivel ? 'Opcional · toque para ativar' : 'Opcional · indisponível no momento'}</small></span><span class="tag ${D.bridge.ativo ? 'ok' : ''}">${D.bridge.ativo ? 'Ativa' : 'Desativada'}</span></a></section>
    ${FF('openFinance') ? `<section class="sec"><a class="card row" href="#/openfinance"><span class="ic" style="width:46px;height:46px;border-radius:14px;background:var(--y-s);display:grid;place-items:center">${ic('link')}</span><span class="sp"><b>Minhas contas em outros bancos</b><small class="mut" style="display:block">Open Finance · saldos e movimentações</small></span>${ic('chev', 'chev')}</a></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>Últimas movimentações</h2><a href="#/extrato">Extrato</a></div><div class="card" style="padding:4px 16px">${D.tx.length ? D.tx.slice(0, 4).map(txRow).join('') : checklist()}</div></section>`;
  }
  const txRow = (t) => li(t.cat || 'cash', esc(t.t), `${esc(t.h || '')} · ${esc(t.d || '')}`, `<span class="right"><b class="${t.v > 0 ? 'pos' : 'neg'}">${S.hide ? '••••' : (t.v > 0 ? '+ ' : '- ') + brl(Math.abs(t.v))}</b></span>`, `data-tx="${esc(t.id)}"`);

  /* ---------------- NOTIFICAÇÕES ---------------- */
  function notificacoes() {
    return tb('Notificações') + `<div class="pg"><div class="card" style="padding:4px 16px">${D.notifs.length ? D.notifs.map((n) => li(n.ic || 'bell', (!n.lida ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--y);margin-right:6px"></span>' : '') + esc(n.t), esc(n.d) + ' · ' + new Date(n.at).toLocaleDateString('pt-BR'), '')).join('') : empty('bell', 'Nenhuma notificação')}</div>
    ${D.notifs.some((n) => !n.lida) ? '<button class="btn ol" style="margin-top:14px" id="rdAll">Marcar todas como lidas</button>' : ''}</div>`;
  }

  /* ---------------- PIX ---------------- */
  function pix() {
    const tiles = [['send', 'Pagar com chave', 'CPF, celular, e-mail', '#/pix/pagar'], ['qr', 'Ler QR Code', 'Câmera', '#/pix/qr'], ['copy', 'Pix copia e cola', 'Colar código', '#/pix/copia'], ['cash', 'Cobrar', 'Gerar QR Code', '#/pix/cobrar'], ['clock', 'Pix agendado', 'Escolha a data', '#/pix/agendado'], ['repeat', 'Pix programado', 'Recorrente', '#/pix/recorrente']];
    return tb('Área Pix') + `<div class="pg"><div class="card row" style="margin-bottom:12px"><span class="sp"><small class="mut">Saldo disponível</small><div class="b" style="font-size:20px">${V(D.saldo)}</div></span><button class="btn sm dk" id="eye2" aria-label="Mostrar ou ocultar valores">${ic(S.hide ? 'eyeoff' : 'eye')}</button></div>
    <div class="g2">${tiles.map(([i, t, s, h]) => `<a class="tile" href="${h}"><i>${ic(i)}</i><b>${t}</b><small>${s}</small></a>`).join('')}</div>
    <div class="card" style="margin-top:12px;padding:4px 16px">${li('key', 'Minhas chaves', D.chaves.length ? `${D.chaves.length} chaves cadastradas` : 'Nenhuma chave cadastrada', undefined, 'data-go="#/pix/chaves"')}${li('gauge', 'Meus limites Pix', `Diurno ${brl(D.settings.limitePixDia)} · Noturno ${brl(D.settings.limitePixNoite)}`, undefined, 'data-go="#/pix/limites"')}${li('doc', 'Pix agendados', D.agendamentos.length ? `${D.agendamentos.length} agendamento(s) ativo(s)` : 'Nenhum agendamento', undefined, 'data-go="#/pix/agendado"')}</div></div>`;
  }
  function pixPagar() {
    return tb('Pagar com chave') + `<div class="pg"><p class="mut" style="margin-top:0">Para quem você quer enviar?</p>
    <div class="chips" style="padding:0 0 12px">${['CPF/CNPJ', 'Celular', 'E-mail', 'Aleatória'].map((k, i) => `<button class="chip ${i ? '' : 'on'}" data-kt="${k}">${k}</button>`).join('')}</div>
    <form id="fKey" novalidate><label class="fl"><span>Chave Pix</span><input class="in" id="key" placeholder="Digite o CPF ou CNPJ" autocomplete="off"></label><p id="err" class="sm" style="color:var(--bad);min-height:18px;margin:0 0 8px"></p><button class="btn">Continuar</button></form></div>`;
  }
  function pixQR() {
    return tb('Ler QR Code') + `<div class="cam"><video id="vid" playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video><div class="fr"><div class="ln"></div></div><p id="camMsg" style="position:absolute;bottom:16px;color:#fff;font-size:13px;margin:0;padding:0 16px;text-align:center">Aponte a câmera para o QR Code</p></div>
    <div class="pg" style="margin-top:14px"><a class="btn ol" href="#/pix/copia">Usar Pix copia e cola</a></div>`;
  }
  function pixCopia() {
    return tb('Pix copia e cola') + `<div class="pg"><p class="mut" style="margin-top:0">Cole o código Pix recebido para pagar.</p>
    <label class="fl"><span>Código Pix</span><textarea class="in" id="cc" rows="5" style="height:auto;padding:12px;resize:none" placeholder="00020126..."></textarea></label>
    <button class="btn ol" id="paste">${ic('copy')} Colar da área de transferência</button><button class="btn" id="go">Continuar</button></div>`;
  }
  function pixCobrar() {
    return tb('Cobrar com Pix') + `<div class="pg">${D.chaves.length ? '' : note('Cadastre uma chave Pix em Pix → Minhas chaves para gerar cobranças.') + '<div style="height:12px"></div>'}<div class="card"><label class="fl"><span>Valor (opcional)</span><input class="in" id="cv" inputmode="decimal" placeholder="R$ 0,00"></label>
    <label class="fl"><span>Descrição</span><input class="in" id="cd" maxlength="40" placeholder="Ex.: Venda de produto"></label>
    <label class="fl" style="margin-bottom:0"><span>Chave de recebimento</span><select class="in" id="ck">${D.chaves.map((k) => `<option value="${esc(k.id)}">${esc(k.tipo)}: ${esc(k.exibicao)}</option>`).join('')}</select></label></div>
    <button class="btn" id="gen" style="margin-top:12px">${ic('qr')} Gerar QR Code</button><div id="out"></div></div>`;
  }
  function pixAgendado() {
    const L = schedList(true);
    return tb('Pix agendado') + `<div class="pg"><div class="card" style="padding:4px 16px">${L || cta('clock', 'Nunca mais esqueça um pagamento', 'Agende um Pix abaixo e ele sai sozinho na data escolhida.')}</div>
    <h3 style="margin:18px 2px 10px;font-size:16px">Novo agendamento</h3><div class="card">
    <label class="fl"><span>Chave Pix do destinatário</span><input class="in" id="ak"></label>
    <div class="g2"><label class="fl"><span>Valor</span><input class="in" id="av" inputmode="decimal" placeholder="0,00"></label><label class="fl"><span>Data</span><input class="in" id="ad" type="date" min="${today()}"></label></div>
    <button class="btn" id="ag">Agendar Pix</button></div></div>`;
  }
  function pixRecorrente() {
    return tb('Pix programado') + `<div class="pg"><div class="ban" style="margin-bottom:12px"><span class="ic">${ic('repeat')}</span><span class="sp"><b>Pague contas fixas automaticamente</b><p>Mesada, aluguel, diarista…</p></span></div>
    <div class="card"><label class="fl"><span>Chave Pix</span><input class="in" id="rk"></label>
    <div class="g2"><label class="fl"><span>Valor</span><input class="in" id="rv" inputmode="decimal" placeholder="0,00"></label><label class="fl"><span>Frequência</span><select class="in" id="rf"><option value="weekly">Semanal</option><option value="monthly" selected>Mensal</option><option value="yearly">Anual</option></select></label></div>
    <div class="g2"><label class="fl"><span>Início</span><input class="in" type="date" id="ri" min="${today()}"></label><label class="fl"><span>Repetições</span><select class="in" id="rn"><option value="3">3</option><option value="6">6</option><option value="12" selected>12</option><option value="">Sem fim</option></select></label></div>
    <button class="btn" id="rg">Programar Pix</button></div>
    <div class="card" style="padding:4px 16px">${schedList(false) || cta('repeat', 'Automatize suas contas', 'Programe aluguel, mesada ou diarista e deixe o Pix sair todo mês.')}</div></div>`;
  }
  function pixLimites() {
    const st = D.settings;
    const r = (id, lbl, v, max, s) => `<div class="card"><div class="row"><span class="sp"><b>${lbl}</b><small class="mut" style="display:block">${s}</small></span><b id="${id}V">${brl(v)}</b></div><input type="range" id="${id}" min="0" max="${max}" step="100" value="${v}" aria-label="${lbl}"><div class="row sm mut"><span class="sp">R$ 0</span><span>${brl(max)}</span></div></div>`;
    return tb('Limites Pix') + `<div class="pg">${r('ld', 'Limite diurno', st.limitePixDia, 20000, '06h às 20h, por transação')}${r('ln', 'Limite noturno', st.limitePixNoite, 5000, '20h às 06h, por transação')}
    <div class="card">${swRow('shield', 'Modo rua', 'Limita Pix a R$ 200 fora de casa', 'mrua', st.modoRua)}</div>
    <p class="sm mut">Aumentos de limite levam até 24h para entrar em vigor (regra do Banco Central). Reduções são imediatas.</p><button class="btn" id="sv">Salvar limites</button></div>`;
  }
  function pixChaves() {
    return tb('Minhas chaves') + `<div class="pg"><p class="mut" style="margin-top:0">Você pode cadastrar até 5 chaves nesta conta.</p><div class="card" style="padding:4px 16px">${D.chaves.length ? D.chaves.map((k) => `<div class="li"><span class="ic">${ic('key')}</span><span class="t"><b>${esc(k.tipo)}</b><small>${esc(k.exibicao)}</small></span><button class="ib" style="background:var(--card2);color:var(--tx)" data-copy="${esc(k.valor)}" aria-label="Copiar chave">${ic('copy')}</button><button class="ib" style="background:var(--card2);color:var(--bad);margin-left:6px" data-del="${esc(k.id)}" aria-label="Excluir chave">${ic('trash')}</button></div>`).join('') : cta('key', 'Cadastre sua chave e receba Pix na hora', 'Com uma chave, qualquer pessoa te paga em segundos, 24h por dia.')}</div>
    <button class="btn" id="nk" style="margin-top:12px" ${D.chaves.length >= 5 ? 'disabled' : ''}>${ic('plus')} Cadastrar nova chave</button></div>`;
  }

  /* ----- fluxo: valor -> revisão -> senha -> envio (API) ----- */
  function payFlow(o) {
    let cents = Math.round((o.valor || 0) * 100);
    const draw = () => {
      view().innerHTML = tb(o.titulo) + `<div class="pg"><div class="card row"><span class="ic" style="width:42px;height:42px;border-radius:50%;background:var(--y-s);display:grid;place-items:center">${ic('user')}</span><span class="sp"><b>${esc(o.nome)}</b><small class="mut" style="display:block">${esc(o.chave)}${o.banco ? ' · ' + esc(o.banco) : ''}</small></span></div></div>
      <div class="amt"><small class="mut">Qual valor?</small><div class="v" id="amv">${brl(cents / 100)}</div><small class="mut">Saldo disponível ${V(D.saldo)}</small></div>
      <div class="kp">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => k === '' ? '<span></span>' : `<button data-k="${k}" aria-label="${k === '⌫' ? 'Apagar' : k}">${k}</button>`).join('')}</div>
      <div class="pg" style="margin-top:8px"><button class="btn" id="nx" ${cents ? '' : 'disabled'}>Continuar</button></div>`;
      bindBack();
      $$('[data-k]').forEach((b) => (b.onclick = () => { const k = b.dataset.k; cents = k === '⌫' ? Math.floor(cents / 10) : Math.min(cents * 10 + +k, 9999999); $('#amv').textContent = brl(cents / 100); $('#nx').disabled = !cents; }));
      $('#nx').onclick = () => { if (cents / 100 > D.saldo) return toast('Saldo insuficiente'); review(); };
    };
    const review = () => {
      const v = cents / 100;
      view().innerHTML = tb('Revisar ' + o.tipo) + `<div class="pg"><div class="amt" style="padding-top:6px"><small class="mut">Você está enviando</small><div class="v">${brl(v)}</div></div>
      <div class="card"><div class="rc" style="border:0;padding:0"><dl><dt>Para</dt><dd>${esc(o.nome)}</dd><dt>Chave/Conta</dt><dd>${esc(o.chave)}</dd>${o.banco ? `<dt>Instituição</dt><dd>${esc(o.banco)}</dd>` : ''}<dt>Quando</dt><dd>${esc(o.quando || 'Agora')}</dd><dt>Tarifa</dt><dd class="pos">Grátis</dd></dl></div></div>
      <label class="fl" style="margin-top:12px"><span>Mensagem (opcional)</span><input class="in" id="msg" maxlength="140"></label>
      <button class="btn" id="cf">Confirmar ${o.tipo}</button><button class="btn ol" id="ed">Alterar valor</button></div>`;
      bindBack(); $('#ed').onclick = draw; const key = uuid(); $('#cf').onclick = () => pinSheet((pin) => send(v, pin, key, $('#msg') ? $('#msg').value.trim() : ''));
    };
    const send = (v, pin, key, mensagem) => {
      loadingInline();
      const body = { ...(o.body || {}), pin, idempotencyKey: key, ...(mensagem ? { mensagem } : {}) };
      if (!o.fixedValue) body.valorCents = Math.round(v * 100);
      API.post(o.path || '/me/' + o.rail, body).then(async (r) => { await reload(); receipt(r); }, (e) => { review(); infoSheet(e.code === 'partner_required' ? o.tipo + ' indisponível' : 'Não foi possível concluir', e.message); });
    };
    const receipt = (r) => {
      const when = new Date(r.criadoEm).toLocaleString('pt-BR');
      view().innerHTML = tb('Comprovante') + `<div class="pg"><div class="rc"><div class="ok">${ic('check').replace('<svg', '<svg width="32" height="32"')}</div><h2 style="text-align:center;margin:0">${esc(o.tipo)} realizado</h2><p class="mut" style="text-align:center;margin:4px 0 0">${when}</p>
      <div class="amt" style="padding:14px 0 0"><div class="v" style="font-size:32px">${brl(r.valorCents / 100)}</div></div>
      <dl><dt>Para</dt><dd>${esc(r.para.nome)}</dd>${r.via && r.via.chave ? `<dt>Chave</dt><dd>${esc(r.via.chave)}</dd>` : ''}<dt>Conta</dt><dd>Ag 0001 · ${esc(r.para.conta)}</dd><dt>Instituição</dt><dd>MineraBank</dd><dt>De</dt><dd>${esc(r.de.nome)}</dd>${r.mensagem ? `<dt>Mensagem</dt><dd>${esc(r.mensagem)}</dd>` : ''}<dt>ID da transação</dt><dd style="font-family:monospace;font-size:12px">${esc(r.id)}</dd></dl></div>
      <button class="btn" id="shR" style="margin-top:14px">${ic('share')} Compartilhar comprovante</button><a class="btn ol" href="#/inicio">Voltar ao início</a></div>`;
      bindBack(); $("#shR").onclick = () => share(`Comprovante MineraBank — ${o.tipo} de ${brl(r.valorCents / 100)} para ${r.para.nome} em ${when}. ID ${r.id}`);
    };
    if (o.valor) review(); else draw();
  }
  function pinSheet(ok) {
    let pin = '';
    sheet(`<h3 style="text-align:center">Digite sua senha de 4 dígitos</h3><p class="mut sm" style="text-align:center" id="pinMsg">Senha de transação</p><div class="pin">${'<i></i>'.repeat(4)}</div>
      <div class="kp" style="padding:0">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => k === '' ? '<span></span>' : `<button data-p="${k}">${k}</button>`).join('')}</div>`, (s) => {
      const dots = $$('.pin i', s);
      $$('[data-p]', s).forEach((b) => (b.onclick = () => {
        const k = b.dataset.p;
        if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
        dots.forEach((d, i) => d.classList.toggle('f', i < pin.length));
        if (pin.length === 4) API.post('/me/verify-pin', { pin }).then(() => { closeSheet(); ok(pin); }, (e) => { pin = ''; dots.forEach((d) => d.classList.remove('f')); $('#pinMsg', s).textContent = e.message; $('#pinMsg', s).style.color = 'var(--bad)'; });
      }));
    });
  }

  /* ---------------- TRANSFERIR / BOLETO / DEPOSITAR / RECARGA ---------------- */
  function transferir() {
    return tb('Transferir') + `<div class="chips" style="margin-bottom:12px"><button class="chip on" data-tt="ted">TED outro banco</button><button class="chip" data-tt="int">Entre contas MineraBank</button></div>
    <div class="pg"><form class="card" id="fT" novalidate><div id="tf"></div><p id="err" class="sm" style="color:var(--bad);min-height:18px;margin:0 0 6px"></p><button class="btn">Continuar</button></form>
    <p class="sm mut">TEDs feitas após 17h ou em dias não úteis são processadas no próximo dia útil.</p></div>`;
  }
  const tedFields = (t) => t === 'ted' ? `<label class="fl"><span>Código do banco</span><input class="in" id="tb" inputmode="numeric" maxlength="3" placeholder="000"></label>
    <div class="g2"><label class="fl"><span>Agência</span><input class="in" id="ta" inputmode="numeric" maxlength="4"></label><label class="fl"><span>Conta com dígito</span><input class="in" id="tc" inputmode="numeric"></label></div>
    <label class="fl"><span>Tipo de conta</span><select class="in"><option>Corrente</option><option>Poupança</option><option>Pagamento</option></select></label>
    <label class="fl"><span>Nome do titular</span><input class="in" id="tn"></label><label class="fl"><span>CPF/CNPJ do titular</span><input class="in" id="td" inputmode="numeric"></label>`
    : `<label class="fl"><span>Conta MineraBank</span><input class="in" id="tc" inputmode="numeric" placeholder="000000-0"></label><label class="fl"><span>Nome do titular</span><input class="in" id="tn"></label>`;
  function boleto() {
    return tb('Pagar boleto') + `<div class="pg"><form class="card" id="fB" novalidate><label class="fl"><span>Linha digitável</span><input class="in" id="lb" inputmode="numeric" placeholder="Digite os 47 ou 48 números"></label><p id="err" class="sm" style="color:var(--bad);min-height:18px;margin:0 0 6px"></p><button class="btn">Continuar</button></form>
    <div class="card">${cta('doc', 'Pague boletos em segundos', 'Digite a linha digitável acima. Boletos registrados no seu CPF também aparecerão aqui.')}</div></div>`;
  }
  function depositar() {
    return tb('Depositar') + `<div class="chips" style="margin-bottom:12px"><button class="chip on" data-dp="pix">Pix</button><button class="chip" data-dp="bol">Boleto</button><button class="chip" data-dp="ted">TED</button></div><div class="pg" id="dpo"></div>`;
  }
  const depOpts = {
    pix: () => D.chaves.length ? `<div class="card"><p class="mut" style="margin-top:0">Receba um Pix em uma das suas chaves (toque para copiar):</p>${D.chaves.map((k) => li('key', esc(k.tipo), esc(k.exibicao), ic('copy', 'chev'), `data-copy="${esc(k.valor)}"`)).join('')}</div>` : `<div class="card">${empty('key', 'Você ainda não tem chave Pix', 'Cadastre uma chave para receber depósitos por Pix.')}<a class="btn" href="#/pix/chaves">Cadastrar chave</a></div>`,
    bol: () => `<div class="card"><label class="fl"><span>Valor do depósito</span><input class="in" id="dv" inputmode="decimal" placeholder="Mín. R$ 20,00"></label><button class="btn" id="gb">Gerar boleto</button></div><p class="sm mut">Compensação em até 3 dias úteis.</p>`,
    ted: () => `<div class="card"><div class="rc" style="border:0;padding:0"><dl style="margin:0"><dt>Banco</dt><dd>${esc(D.banco)}</dd><dt>Agência</dt><dd>${esc(D.conta.agencia)}</dd><dt>Conta</dt><dd>${esc(D.conta.numero)}</dd><dt>Titular</dt><dd>${esc(D.nome)}</dd><dt>CPF</dt><dd>${esc(D.cpf)}</dd></dl></div><div style="height:12px"></div>${note('O número do banco para TED será informado quando a conta de pagamento no parceiro estiver ativa.')}</div>`,
  };
  function recarga() {
    return tb('Recarga de celular') + `<div class="pg"><form class="card" id="fR" novalidate><label class="fl"><span>Número com DDD</span><input class="in" id="rn" inputmode="tel" value="${esc(fmtCel(D.celular))}"></label>
    <label class="fl"><span>Operadora</span><select class="in" id="ro"><option>Claro</option><option>Tim</option><option>Vivo</option><option>Oi</option></select></label>
    <span class="fl"><span>Valor</span></span><div class="g3" id="rvs">${[15, 20, 30, 40, 50, 100].map((v, i) => `<button type="button" class="chip ${i === 2 ? 'on' : ''}" data-rv="${v}" style="height:46px">${brl(v)}</button>`).join('')}</div>
    <button class="btn" style="margin-top:16px">Continuar</button></form></div>`;
  }

  /* ---------------- EXTRATO ---------------- */
  const EX = { f: 'todos', q: '', p: 30 };
  function extrato() {
    const ins = sum(D.tx.filter((t) => t.v > 0).map((t) => t.v)), outs = Math.abs(sum(D.tx.filter((t) => t.v < 0).map((t) => t.v)));
    return tb('Extrato') + `<div class="pg"><div class="card row" style="margin-bottom:12px"><span class="sp"><small class="mut">Saldo</small><div class="b" style="font-size:20px">${V(D.saldo)}</div></span><span class="right sm"><span class="pos b">+ ${S.hide ? '••••' : brl(ins)}</span><br><span class="b">- ${S.hide ? '••••' : brl(outs)}</span></span></div></div>
    <label class="search"><span class="sr">Buscar</span>${ic('search').replace('<svg', '<svg width="20" height="20"')}<input id="q" placeholder="Buscar transação" value="${esc(EX.q)}"></label>
    <div class="chips">${[['todos', 'Tudo'], ['in', 'Entradas'], ['out', 'Saídas']].map(([k, l]) => `<button class="chip ${EX.f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}<span style="width:1px;background:var(--line);flex:none"></span>${[[7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [90, '90 dias']].map(([k, l]) => `<button class="chip ${EX.p === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
    <div class="pg" id="exl">${skel(4)}</div>`;
  }
  const skel = (n) => Array.from({ length: n }, () => '<div class="row" style="padding:12px 0"><div class="sk" style="width:40px;height:40px;border-radius:12px"></div><div class="sp"><div class="sk" style="height:12px;width:70%;margin-bottom:8px"></div><div class="sk" style="height:10px;width:40%"></div></div></div>').join('');
  function renderExtrato() {
    const lim = new Date(Date.now() - EX.p * 864e5).toISOString().slice(0, 10);
    const q = EX.q.toLowerCase();
    const list = D.tx.filter((t) => (EX.f === 'todos' || (EX.f === 'in' ? t.v > 0 : t.v < 0)) && t.dia >= lim && (!q || (t.t + t.d).toLowerCase().includes(q)));
    const g = {}; list.forEach((t) => (g[t.dia] = g[t.dia] || []).push(t));
    const el = $('#exl'); if (!el) return;
    setTimeout(() => { const b = $('#exAll'); if (b) b.onclick = () => { EX.q = ''; EX.f = 'todos'; EX.p = 365; if ($('#q')) $('#q').value = ''; $$('[data-f]').forEach((x) => x.classList.toggle('on', x.dataset.f === 'todos')); renderExtrato(); }; });
    el.innerHTML = Object.keys(g).length ? Object.keys(g).map((d) => `<div class="day">${fmtDia(d)}</div><div class="card" style="padding:4px 16px">${g[d].map(txRow).join('')}</div>`).join('')
      : (D.tx.length ? `<div class="card" style="margin-top:6px">${cta('doc', 'Nada por aqui', 'Nenhuma transação para os filtros escolhidos.', [['Ver tudo', '', 'ol', 'id="exAll"']])}</div>` : `<div class="card" style="margin-top:6px;padding:4px 16px">${checklist()}</div><a class="btn" href="#/depositar" style="margin-top:12px">${ic('pix')} Depositar via Pix agora</a>`);
  }
  function txDetail(id) {
    const t = D.tx.find((x) => x.id === id); if (!t) return;
    sheet(`<div style="text-align:center"><span class="ic" style="width:54px;height:54px;border-radius:16px;background:var(--y-s);display:inline-grid;place-items:center">${ic(t.cat || 'cash')}</span><h3 style="margin:10px 0 2px">${esc(t.t)}</h3><div class="b ${t.v > 0 ? 'pos' : ''}" style="font-size:28px">${(t.v > 0 ? '+ ' : '- ') + brl(Math.abs(t.v))}</div><p class="mut sm">${fmtDia(t.dia)} às ${esc(t.h)}</p></div>
      <div class="rc" style="padding:0;border:0"><dl><dt>${t.v > 0 ? 'De' : 'Para'}</dt><dd>${esc(t.d)}</dd><dt>Status</dt><dd><span class="tag ok">Concluída</span></dd><dt>ID</dt><dd style="font-family:monospace;font-size:12px">${esc(t.id)}</dd></dl></div>
      <button class="btn" id="shr" style="margin-top:16px">${ic('share')} Compartilhar comprovante</button><button class="btn ol" id="ctg">Contestar ou pedir ajuda</button>`, (s) => {
      $('#shr', s).onclick = () => share(`Comprovante MineraBank — ${t.t} ${brl(Math.abs(t.v))} · ${t.d} · ${fmtDia(t.dia)} ${t.h} · ID ${t.id}`);
      $('#ctg', s).onclick = () => { closeSheet(); location.hash = '#/ajuda'; };
    });
  }

  /* ---------------- CARTÃO ---------------- */
  function cartao() {
    const nm = D.nome.toUpperCase().split(' '); const nomeCartao = nm.length > 2 ? `${nm[0]} ${nm[1][0]} ${nm[nm.length - 1]}` : nm.join(' ');
    const c = D.cartao;
    const face = `<div class="cc-sc"><div class="cc ${c && c.bloqueado ? 'lock' : ''} t-${CAT().id} ${D.cosmeticos && D.cosmeticos.skin ? 'sk-' + D.cosmeticos.skin : ''}" style=""><div class="f"><div class="row"><b style="font-size:16px">Minera<span style="color:var(--y)">Bank</span></b><span class="sp"></span>${c ? '<span class="tag">Virtual</span>' : ''}</div><span class="tierb" style="top:auto;bottom:44px">${esc(CAT().nome)}</span><div class="chipc"></div><div class="num">•••• •••• •••• ••••</div>${c ? '' : `<div style="position:absolute;right:20px;top:58px;text-align:right"><small style="opacity:.7;font-size:11px;display:block">Limite disponível</small><b>${V(G().limiteCents / 100)}</b><small style="opacity:.7;font-size:11px;display:block;margin-top:4px">Utilizado ${V(0)}</small></div>`}<div class="nm">${esc(nomeCartao)}</div><div class="lg">crédito</div></div></div></div>`;
    if (!c) return tb('Cartões') + face + `<div class="pg" style="margin-top:14px">${catCard(true)}<div style="height:12px"></div><div class="card">${cta('card', 'Peça seu cartão MineraBank', 'Sem anuidade. Cartão virtual na hora do pedido; número, validade e CVV são gerados pelo emissor parceiro assim que ele estiver conectado.')}<button class="btn" id="askCard">Peça seu cartão</button><a class="btn ol" href="#/garantia">Descubra seu limite em 1 minuto</a></div>
    ${garantiaBan()}<div style="height:12px"></div>${creditoBan()}<div style="height:12px"></div>
    <div class="card" style="padding:4px 16px">${swRow('wifi', 'Pagamento por aproximação', 'Disponível com o cartão', 'tAp', false, true)}${swRow('globe', 'Compras internacionais', 'Disponível com o cartão', 'tIn', false, true)}${swRow('cart', 'Compras online', 'Disponível com o cartão', 'tOn', false, true)}</div></div>`;
    return tb('Cartões') + face + `<div class="pg" style="margin-top:14px">${catCard(true)}<div style="height:12px"></div>${note('Cartão virtual solicitado. Número, validade e CVV serão gerados pelo emissor parceiro quando ele estiver conectado; até lá não há compras nem fatura.')}<div style="margin-top:12px">${garantiaBan()}</div><div class="g3" style="margin-top:12px">
      <button class="tile" id="show" style="text-align:center"><i style="margin:0 auto 8px">${ic('eye')}</i><small>Ver dados</small></button>
      <button class="tile" id="lockB" style="text-align:center"><i style="margin:0 auto 8px">${ic(c.bloqueado ? 'unlock' : 'lock')}</i><small>${c.bloqueado ? 'Desbloquear' : 'Bloquear'}</small></button>
      <a class="tile" href="#/fatura" style="text-align:center"><i style="margin:0 auto 8px">${ic('doc')}</i><small>Fatura</small></a></div>
    <div class="card" style="margin-top:12px"><div class="row"><b class="sp">Limite de gastos</b><b id="limV">${brl(c.limiteCents / 100)}</b></div>${G().reservadoCents ? `<input type="range" id="lim" min="0" max="${G().reservadoCents / 100}" step="1" value="${c.limiteCents / 100}" aria-label="Limite de gastos"><div class="row sm mut"><span class="sp">R$ 0</span><span>${brl(G().reservadoCents / 100)} guardado</span></div>` : `<p class="sm mut" style="margin:6px 0 10px">Seu limite nasce do que você guarda: cada real na Reserva vira R$ 1 de limite.</p><a class="btn" href="#/garantia">Reserve e ganhe limite</a>`}</div>
    <div class="card" style="padding:4px 16px">${swRow('wifi', 'Pagamento por aproximação', 'NFC no cartão físico', 'tAp', c.aproximacao)}${swRow('globe', 'Compras internacionais', 'Sujeitas a IOF', 'tIn', c.internacional)}${swRow('cart', 'Compras online', 'Lojas virtuais e assinaturas', 'tOn', c.online)}</div></div>`;
  }
  function fatura() { return tb('Fatura') + `<div class="pg"><div class="card">${cta('doc', 'Sua fatura começa aqui', 'Com o limite garantido, você usa o cartão e acompanha cada compra nesta tela.', [[D.cartao ? 'Aumentar meu limite' : 'Peça seu cartão', D.cartao ? '#/garantia' : '#/cartao']])}</div></div>`; }

  /* ---------------- CRÉDITO ---------------- */
  const CR = { v: 5000, n: 12 };
  function credito() {
    return tb('Empréstimo') + `<div class="pg"><div class="card" style="background:var(--ink);color:#fff;border:0"><small style="color:#B8B8C0">Crédito pessoal MineraBank</small><div class="b" style="font-size:26px;margin:2px 0">Crédito de até ${brl(OF().creditoAteCents / 100)}</div><small style="color:#F5C400;font-weight:700">Sujeito a análise de crédito</small><p style="color:#B8B8C0;font-size:13px;margin:8px 0 0">Simule até ${brl(OF().simuladorMaxCents / 100)} abaixo. Valores e taxas de referência; a contratação depende de instituição parceira autorizada pelo Banco Central.</p></div>
    <div class="card"><div class="row"><b class="sp">Quanto você precisa?</b><b id="crVv" style="font-size:20px">${brl(CR.v)}</b></div><input type="range" id="crV" min="500" max="${OF().simuladorMaxCents / 100}" step="100" value="${CR.v}" aria-label="Valor"><div class="row sm mut"><span class="sp">R$ 500</span><span>${brl(OF().simuladorMaxCents / 100)}</span></div>
    <div class="row" style="margin-top:12px"><b class="sp">Em quantas parcelas?</b><b id="crNv">${CR.n}x</b></div><input type="range" id="crN" min="3" max="36" step="1" value="${CR.n}" aria-label="Parcelas"><div class="row sm mut"><span class="sp">3x</span><span>36x</span></div></div>
    <div class="card" id="crRes"></div><button class="btn" id="crGo" style="margin-top:12px">Quero esse crédito</button><p class="sm mut" style="text-align:center;margin:6px 0 0">Sujeito a análise de crédito.</p><div style="margin-top:12px">${garantiaBan()}</div>
    <div class="day">Cronograma</div><div class="card" style="padding:4px 16px" id="crSch"></div></div>`;
  }
  // Empréstimo: comprovante de endereço (só aqui) → senha → análise de crédito → resultado
  function poaSheet(then) {
    sheet(`<h3>Comprovante de endereço</h3><p class="mut" style="margin-top:0">Para pedir empréstimo, precisamos de um comprovante recente (luz, água, telefone ou internet dos últimos 90 dias) no endereço <b>${esc((D.endereco || {}).rua || '')}, ${esc((D.endereco || {}).numero || '')}</b>.</p><input type="file" id="poaF" accept="image/*,application/pdf" hidden>
      <button class="btn" id="poaCam">${ic('cam')} Fotografar comprovante</button><button class="btn ol" id="poaFile">${ic('doc')} Enviar PDF ou imagem</button><p class="sm mut">O arquivo é guardado cifrado e usado só para validar seu endereço.</p>`, (s) => {
      const send = (blob) => { loadingInline(); upload('/me/docs/comprovante_endereco', blob).then(async () => { await reload(); toast('Comprovante enviado'); route(); then(); }, (e) => { route(); infoSheet('Comprovante de endereço', e.message); }); };
      const inp = $('#poaF', s); inp.onchange = () => { if (inp.files && inp.files[0]) { closeSheet(); send(inp.files[0]); } };
      $('#poaFile', s).onclick = () => inp.click();
      $('#poaCam', s).onclick = () => camera('environment', 'Comprovante de endereço').then(send, () => inp.click());
    });
  }
  function loanFlow() {
    if (!D.comprovanteEndereco) return poaSheet(loanFlow);
    confirmSheet('Pedir ' + brl(CR.v) + ' em ' + CR.n + 'x?', 'Vamos fazer a análise de crédito agora. A contratação é sujeita a análise e depende de instituição parceira autorizada pelo Banco Central.', 'Continuar', () => pinSheet((pin) => {
      loadingInline();
      API.post('/me/loans', { valorCents: Math.round(CR.v * 100), parcelas: CR.n, pin, idempotencyKey: uuid() }).then(async (r) => {
        await reload(); route();
        const msg = { liberado: 'Crédito aprovado e liberado na sua conta.', aprovado_aguardando_parceiro: `Crédito de ${brl(r.valorCents / 100)} aprovado na análise. A contratação será concluída quando a instituição parceira estiver conectada; avisaremos você.`, reprovado: (r.analise.motivo || 'Não aprovado na análise de crédito.') + (r.analise.maxCents ? ` Valor disponível após análise: até ${brl(r.analise.maxCents / 100)}.` : '') }[r.status];
        infoSheet(r.status === 'reprovado' ? 'Análise de crédito' : 'Crédito aprovado', msg);
      }, (e) => { route(); if (e.code === 'proof_of_address_required') return poaSheet(loanFlow); infoSheet('Empréstimo', e.message); });
    }));
  }
  function calcCredito() {
    const i = 0.0349, iof = CR.v * 0.0038 + CR.v * 0.000082 * Math.min(365, CR.n * 30);
    const p = (CR.v * i) / (1 - Math.pow(1 + i, -CR.n)); const total = p * CR.n;
    let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; const pv = (p * (1 - Math.pow(1 + m, -CR.n))) / m; if (pv > CR.v - iof) lo = m; else hi = m; }
    const cetA = Math.pow(1 + lo, 12) - 1; const d0 = new Date(); 
    $('#crVv').textContent = brl(CR.v); $('#crNv').textContent = CR.n + 'x';
    $('#crRes').innerHTML = `<div class="row"><span class="sp"><small class="mut">Parcela mensal estimada</small><div class="b" style="font-size:26px">${CR.n}x ${brl(p)}</div></span></div><div class="rc" style="border:0;padding:0"><dl><dt>Taxa de referência</dt><dd>3,49% a.m.</dd><dt>CET</dt><dd>${(lo * 100).toFixed(2).replace('.', ',')}% a.m. · ${(cetA * 100).toFixed(1).replace('.', ',')}% a.a.</dd><dt>IOF estimado</dt><dd>${brl(iof)}</dd><dt>Total a pagar</dt><dd>${brl(total)}</dd><dt>1º vencimento</dt><dd>${new Date(d0.getFullYear(), d0.getMonth() + 1, d0.getDate()).toLocaleDateString('pt-BR')}</dd></dl></div>`;
    let saldo = CR.v, rows = '';
    for (let k = 1; k <= CR.n; k++) { const j = saldo * i, a = p - j; saldo -= a; const d = new Date(d0.getFullYear(), d0.getMonth() + k, d0.getDate()).toLocaleDateString('pt-BR'); rows += `<div class="li"><span class="ic" style="font-weight:700;font-size:13px">${k}</span><span class="t"><b>${d}</b><small>Juros ${brl(j)} · Amortização ${brl(a)}</small></span><b>${brl(p)}</b></div>`; }
    $('#crSch').innerHTML = rows;
  }

  /* ---------------- INVESTIMENTOS ---------------- */
  function investir() {
    const cx = D.investimentos.caixinhas; const tot = sum(cx.map((x) => x.saldoCents)) / 100;
    return tb('Investimentos') + `<div class="pg"><div class="card"><small class="mut">Patrimônio guardado</small><div class="b" style="font-size:28px">${V(tot)}</div>${cx.length ? `<small class="mut">${cx.length} Caixinha(s) · rendimento disponível com o parceiro custodiante</small>` : ''}</div>
    <div class="card"><div class="row"><b class="sp">Quanto vai render?</b><b id="pjV">${brl(1000)}</b></div><input type="range" id="pjR" min="100" max="20000" step="100" value="1000" aria-label="Valor da simulação"><div class="b" style="font-size:20px;margin-top:8px" id="pjO">R$ 1.000,00 viraria ${brl(proj(1000))} em 12 meses</div><p class="sm mut" style="margin:4px 0 0">${refNote()}</p></div>
    <a class="ban" href="#/mercado" style="margin-top:12px;background:var(--ink);color:#fff"><span class="ic" style="background:rgba(245,196,0,.15);color:var(--y)">${ic('chart')}</span><span class="sp"><b>Cripto e Bolsa</b><p style="color:#B8B8C0">Bitcoin, ações, ETFs e FIIs com cotações e gráficos. Alertas de preço.</p></span>${ic('chev', 'chev')}</a>
    <a class="ban" href="#/previsao" style="margin-top:12px;background:var(--card);color:var(--tx);border:1px solid var(--line)"><span class="ic">${ic('gift')}</span><span class="sp"><b>Modo Previsão</b><p class="mut">Jogo gratuito com pontos. Não é investimento.</p></span>${ic('chev', 'chev')}</a>
    <div style="margin-top:12px">${garantiaBan()}</div>
    <div class="g2" style="margin-top:12px"><button class="btn" id="apl">Aplicar em CDB</button><button class="btn ol" id="res" style="margin-top:0">Resgatar CDB</button></div>
    <div class="sec-h" style="margin:20px 2px 10px"><h2>Caixinhas</h2><a href="#/investir" id="newCx">+ Nova</a></div>
    ${cx.length ? cx.map((x) => `<div class="card"><div class="row"><span class="ic" style="width:40px;height:40px;border-radius:12px;background:var(--y-s);display:grid;place-items:center">${ic('piggy')}</span><span class="sp"><b>${esc(x.nome)}</b><small class="mut" style="display:block">${x.metaCents ? 'Meta ' + (S.hide ? '••••' : brl(x.metaCents / 100)) + ' · ' + Math.round(Math.min(100, (x.saldoCents / x.metaCents) * 100)) + '%' : 'Sem meta'}</small></span><b>${V(x.saldoCents / 100)}</b></div><div class="bar"><span style="width:${x.metaCents ? Math.min(100, (x.saldoCents / x.metaCents) * 100) : 0}%"></span></div><div class="row" style="gap:8px"><button class="btn sm" data-cx="${esc(x.id)}" data-op="aplicar">Guardar</button><button class="btn sm ol" data-cx="${esc(x.id)}" data-op="resgatar">Resgatar</button></div></div>`).join('') : `<div class="card">${cta('piggy', 'Crie sua primeira Caixinha', 'Separe dinheiro por objetivo e acompanhe a meta. Escolha uma sugestão:')}<div class="chips" style="padding:0 0 4px;justify-content:center;flex-wrap:wrap">${[['Reserva de emergência', 5000], ['Viagem', 3000], ['Celular novo', 2500], ['Estudos', 2000], ['Casa própria', 20000]].map(([n, m]) => `<button class="chip" data-sug="${n}" data-meta="${m}">${n}</button>`).join('')}</div><button class="btn" id="newCx2">Criar Caixinha</button></div>`}
    <div class="sec-h" style="margin:20px 2px 10px"><h2>CDB</h2></div><div class="card">${cta('chart', 'CDB com liquidez diária', `R$ 5.000 viraria ${brl(proj(5000))} em 12 meses a 100% do CDI de referência (bruto). Disponível com o parceiro custodiante.`, [['Quero investir em CDB', '', '', 'id="apl2"']])}</div></div>`;
  }

  function invSheet(title, onOk) {
    sheet(`<h3>${title}</h3><label class="fl"><span>Valor</span><input class="in" id="iv" inputmode="decimal" placeholder="R$ 0,00"></label><div class="chips" style="padding:0 0 12px">${[50, 100, 500, 1000].map((v) => `<button class="chip" data-q="${v}">${brl(v)}</button>`).join('')}</div><button class="btn" id="ok">Confirmar</button>`, (s) => {
      $$('[data-q]', s).forEach((b) => (b.onclick = () => ($('#iv', s).value = b.dataset.q)));
      $('#ok', s).onclick = () => { const c = toCents($('#iv', s).value); if (!(c > 0)) return toast('Informe um valor válido'); closeSheet(); onOk(c); };
    });
  }

  /* ---------------- LIMITE GARANTIDO ---------------- */
  const GR = { v: 500 };
  function garantia() {
    const g = G();
    return tb('Limite garantido') + `<div class="pg"><div class="card" style="background:var(--ink);color:#fff;border:0"><small style="color:#B8B8C0">Reserve e ganhe limite</small><div class="row" style="margin-top:6px"><span class="sp"><small style="color:#B8B8C0;display:block">Guardado na Reserva</small><b style="font-size:22px">${V(g.reservadoCents / 100)}</b></span><span style="text-align:right"><small style="color:#B8B8C0;display:block">Limite do cartão</small><b style="font-size:22px;color:#F5C400">${V(g.limiteCents / 100)}</b></span></div><div class="row sm" style="margin-top:6px;color:#B8B8C0"><span class="sp">Utilizado ${V(g.usadoCents / 100)}</span><span>Resgatável ${V(g.resgatavelCents / 100)}</span></div></div>
    <div class="card"><b>Quanto você quer guardar?</b><div class="amt" style="padding:10px 0 4px"><input class="in" id="grI" inputmode="decimal" value="${brl(GR.v)}" aria-label="Valor" style="text-align:center;font-size:26px;font-weight:800;border:0;background:transparent"></div><input type="range" id="grR" min="10" max="10000" step="10" value="${GR.v}" aria-label="Valor"><div class="row sm mut"><span class="sp">R$ 10</span><span>R$ 10.000</span></div>
    <div class="chips" style="padding:10px 0 0">${[100, 300, 500, 1000].map((v) => `<button class="chip" data-gq="${v}">${brl(v)}</button>`).join('')}</div>
    <div class="rc" style="border:0;padding:8px 0 0" id="grS"></div></div>
    <button class="btn" id="grGo">${ic('shield')} Guardar e ganhar limite</button>${g.resgatavelCents ? '<button class="btn ol" id="grOut">Resgatar da Reserva</button>' : ''}
    <div class="card" style="padding:4px 16px;margin-top:12px">${li('piggy', 'Seu dinheiro continua rendendo', 'Referência de 100% do CDI, enquanto estiver guardado', '')}${li('card', 'O mesmo valor vira limite', 'R$ 1 guardado = R$ 1 de limite no cartão', '')}${li('unlock', 'Resgate quando quiser', 'A parte que não garante compras já feitas no cartão', '')}</div>
    <p class="sm mut">${esc(refNote())} O cartão é emitido pelo parceiro emissor; o limite passa a valer para compras quando a emissão estiver ativa.</p></div>`;
  }
  function calcGarantia() {
    const v = GR.v, r = proj(v) - v;
    $('#grS').innerHTML = `<p style="margin:0;font-size:15px;line-height:1.5">Guarde <b>${brl(v)}</b>, ganhe <b>${brl(v)}</b> de limite e renda <b class="pos">${brl(r)}</b> em 12 meses.</p><dl style="margin-top:8px"><dt>Saldo disponível</dt><dd>${V(D.saldo)}</dd><dt>Novo limite</dt><dd>${brl(G().limiteCents / 100 + v)}</dd></dl>`;
  }

  /* ---------------- SEGUROS / INDIQUE ---------------- */
  const SEG = [['Seguro Celular', 'phone'], ['Seguro de Vida', 'heart'], ['Seguro Residencial', 'home'], ['Proteção do Cartão', 'card']];
  function seguros() {
    return tb('Seguros') + `<div class="pg"><div class="ban" style="margin-bottom:12px"><span class="ic">${ic('shield')}</span><span class="sp"><b>Proteção sem burocracia</b><p>Em breve, com seguradora parceira.</p></span></div>
    <div class="g2">${SEG.map(([n, i]) => `<button class="tile" data-seg="${n}"><i>${ic(i)}</i><b>${n}</b><small>Em breve</small></button>`).join('')}</div>
    <div class="card" style="margin-top:12px"><b>Seus seguros</b><p class="mut sm" style="margin-bottom:0">Você ainda não tem seguros ativos.</p></div></div>`;
  }
  function indique() {
    const link = new URL('login.html', location.href).href;
    return tb('Indicar amigos') + `<div class="pg"><div class="card" style="background:var(--ink);color:#fff;text-align:center;border:0"><div style="width:64px;height:64px;border-radius:20px;background:var(--y);color:#111;display:grid;place-items:center;margin:0 auto 10px">${ic('gift').replace('<svg', '<svg width="32" height="32"')}</div><h2 style="margin:0">Convide seus amigos</h2><p style="color:#B8B8C0;margin:6px 0 14px">Compartilhe o link para abrir uma conta MineraBank.</p><div class="code" style="background:#232328;color:#F5C400;font-size:13px;font-weight:700">${esc(link)}</div></div>
    <button class="btn" style="margin-top:12px" id="shInv">${ic('share')} Compartilhar convite</button><button class="btn ol" data-copy="${esc(link)}">${ic('copy')} Copiar link</button>
    <div class="day">Como funciona</div><div class="card" style="padding:4px 16px">${li('send', '1. Envie seu convite', 'Pelo WhatsApp, e-mail ou redes', '')}${li('user', '2. Seu amigo abre a conta', 'Pelo link de convite', '')}${li('check', '3. Pronto', 'Vocês dois usam a MineraBank', '')}</div></div>`;
  }

  /* ---------------- PERFIL & CONFIG ---------------- */
  function perfil() {
    const dark = (localStorage.getItem('mb_theme') || 'light') === 'dark';
    return `<div class="hd" style="text-align:center;padding-top:30px"><div class="av" style="width:76px;height:76px;font-size:26px;margin:0 auto 10px">${esc(initials())}</div><b style="font-size:18px">${esc(D.nome)}</b><small style="display:block;color:#B8B8C0;margin-top:4px">Ag ${esc(D.conta.agencia)} · Conta ${esc(D.conta.numero)} · ${esc(D.banco)}</small><button class="btn sm" style="margin:12px auto 0" data-copy="${esc(`${D.banco} · Ag ${D.conta.agencia} · Conta ${D.conta.numero} · ${D.nome}`)}">${ic('copy')} Copiar dados da conta</button></div>
    <div class="sec"><div class="card" style="padding:4px 16px">${li('user', 'Dados pessoais', 'Nome, e-mail, celular, endereço', undefined, 'data-go="#/dados"')}${li('shield', 'Segurança', 'Senha, dispositivos, modo rua, biometria', undefined, 'data-go="#/seguranca"')}${li('lock', 'Privacidade', 'Dados e consentimentos (LGPD)', undefined, 'data-go="#/privacidade"')}${li('bell', 'Notificações', 'Push, e-mail, SMS', undefined, 'data-go="#/notifcfg"')}</div></div>
    <div class="sec"><div class="card" style="padding:4px 16px">${li('mp', 'Mercado Pago', D.mp.conectado ? 'Conta conectada' : 'Conectar sua conta para receber vendas', D.mp.conectado ? '<span class="tag ok">Conectado</span>' : undefined, 'data-go="#/integracoes"')}${li('mine', 'Ponte Minera Pará', D.bridge.ativo ? 'Ativa' : 'Opcional · desativada', undefined, 'data-go="#/integracoes"')}${FF('openFinance') ? li('link', 'Minhas contas em outros bancos', 'Open Finance · conectar e desconectar', undefined, 'data-go="#/openfinance"') : ''}</div></div>
    <div class="sec"><div class="card" style="padding:4px 16px"><div class="li"><span class="ic">${ic('moon')}</span><span class="t"><b>Modo escuro</b><small>Aparência do app</small></span>${tog('dk', dark, 'Modo escuro')}</div>${li('doc', 'Informe de rendimentos', 'Ano-base ' + (new Date().getFullYear() - 1), undefined, 'data-go="#/informe"')}${li('chat', 'Ajuda e atendimento', 'Central de ajuda', undefined, 'data-go="#/ajuda"')}${li('trash', 'Encerrar conta', '', undefined, 'data-go="#/encerrar"')}</div></div>
    <div class="sec"><button class="btn ol" id="out">${ic('out')} Sair do app</button><p class="sm mut" style="text-align:center">MineraBank v0.3</p></div>`;
  }
  function dados() {
    const e = D.endereco || {};
    return tb('Dados pessoais') + `<div class="pg"><div class="card"><label class="fl"><span>Nome completo</span><input class="in" value="${esc(D.nome)}" disabled></label><label class="fl"><span>CPF</span><input class="in" value="${esc(D.cpf)}" disabled></label>
    <label class="fl"><span>E-mail</span><input class="in" id="de" type="email" value="${esc(D.email)}"></label><label class="fl"><span>Celular</span><input class="in" id="dc" inputmode="tel" value="${esc(fmtCel(D.celular))}"></label>
    <label class="fl" style="margin-bottom:0"><span>Endereço</span><input class="in" value="${esc(`${e.rua || ''}, ${e.numero || ''}${e.complemento ? ' ' + e.complemento : ''} — ${e.cidade || ''}/${e.uf || ''}`)}" disabled></label></div>
    <button class="btn" style="margin-top:12px" id="sv">Salvar alterações</button><p class="sm mut">Para trocar e-mail ou celular, enviamos um código ao novo contato. Nome, CPF e endereço só podem ser alterados pelo atendimento, com comprovante.</p></div>`;
  }
  function seguranca() {
    const st = D.settings;
    return tb('Segurança') + `<div class="pg"><div class="card" style="padding:4px 16px">${li('key', 'Alterar senha de acesso', '', undefined, 'id="chPw"')}</div>
    <div class="card" style="padding:4px 16px">${li('finger', 'Entrar com biometria', D.passkeys.length ? D.passkeys.length + ' aparelho(s) com biometria ativa' : 'Use a digital ou o rosto deste aparelho', D.passkeys.length ? '<span class="tag ok">Ativa</span>' : undefined, 'id="pkAdd"')}${swRow('shield', 'Modo rua', 'Limita Pix e TED a R$ 200 fora de locais seguros', 'sRua', st.modoRua)}${li('gauge', 'Limite noturno', `Pix até ${brl(st.limitePixNoite)} das 20h às 6h`, undefined, 'data-go="#/pix/limites"')}</div>
    ${D.passkeys.length ? `<div class="day">Biometria (passkeys)</div><div class="card" style="padding:4px 16px">${D.passkeys.map((p) => li('finger', esc(p.nome), 'Ativada em ' + new Date(p.criadaEm).toLocaleDateString('pt-BR') + (p.ultimoUso ? ' · último uso ' + new Date(p.ultimoUso).toLocaleString('pt-BR') : ''), `<button class="btn sm ol" data-rmpk="${esc(p.id)}">Remover</button>`, '')).join('')}</div>` : ''}
    <div class="day">Sessões ativas</div><div class="card" style="padding:4px 16px">${D.dispositivos.map((d) => li('device', esc(uaName(d.ua)), `${{ biometria: 'Biometria', 'senha+otp': 'Senha + código', senha: 'Senha' }[d.metodo] || 'Senha'} · desde ${new Date(d.desde).toLocaleString('pt-BR')}${d.ip ? ' · IP ' + esc(d.ip.replace(/^::ffff:/, '')) : ''}`, d.atual ? '<span class="tag ok">Atual</span>' : `<button class="btn sm ol" data-rmdev="${esc(d.id)}">Remover</button>`, '')).join('')}</div>
    ${D.dispositivos.length > 1 ? '<button class="btn ol" id="rmAll">Encerrar todas as outras sessões</button>' : ''}
    <div class="card" style="padding:4px 16px;margin-top:12px">${li('doc', 'Atividade de segurança', 'Acessos e ações sensíveis', undefined, 'data-go="#/atividade"')}</div></div>`;
  }
  const uaName = (ua) => { const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'; const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''; return b + (o ? ' no ' + o : ''); };
  function privacidade() {
    const st = D.settings;
    return tb('Privacidade') + `<div class="pg"><div class="card" style="padding:4px 16px">${swRow('chart', 'Ofertas personalizadas', 'Usar meu histórico para sugestões', 'c_marketing', (D.consentimentos.marketing || {}).valor)}${swRow('link', 'Compartilhar com parceiros', 'Somente com consentimento', 'c_compartilhamento', (D.consentimentos.compartilhamento || {}).valor)}${swRow('user', 'Aparecer para contatos', 'Ao buscar por chave Pix', 'p_visivel', st.visivel)}</div>
    <div class="card" style="padding:4px 16px">${li('doc', 'Baixar meus dados (LGPD)', 'Cadastro, extrato, consentimentos e acessos', undefined, 'id="lgpd"')}${li('trash', 'Solicitar exclusão dos dados', D.exclusaoSolicitadaEm ? 'Pedido recebido em ' + new Date(D.exclusaoSolicitadaEm).toLocaleDateString('pt-BR') : 'Resposta em até 15 dias', D.exclusaoSolicitadaEm ? '<span class="tag">Em análise</span>' : undefined, D.exclusaoSolicitadaEm ? '' : 'id="lgpdDel"')}</div>
    <div class="card"><b>Termos e consentimentos</b><p class="sm mut" style="margin:6px 0 0">${D.consentimentos.termos ? `Termos de Uso e Política de Privacidade aceitos em ${new Date(D.consentimentos.termos.em).toLocaleString('pt-BR')} (versão ${esc(D.consentimentos.versao || '')}).` : 'Aceite registrado na abertura da conta.'} Cada mudança de consentimento fica registrada com data e hora.</p></div></div>`;
  }
  function notifcfg() {
    const st = D.settings;
    return tb('Notificações') + `<div class="pg"><div class="card" style="padding:4px 16px">${swRow('bell', 'Notificações push', 'Transações e alertas', 'p_push', st.push)}${swRow('doc', 'E-mail', 'Faturas e informes', 'p_emailNotif', st.emailNotif)}${swRow('phone', 'SMS', 'Códigos de segurança', 'p_sms', st.sms)}${swRow('gift', 'Promoções', 'Ofertas e campanhas', 'p_promo', st.promo)}</div></div>`;
  }
  function integracoes() {
    return tb('Integrações') + `<div class="pg"><div class="card"><div class="row"><span class="ic" style="width:48px;height:48px;border-radius:14px;background:#E6EEFD;color:#1C4AA8;display:grid;place-items:center">${ic('mp')}</span><span class="sp"><b>Mercado Pago</b><small class="mut" style="display:block">Receba vendas na sua própria conta MP</small></span><span class="tag ${D.mp.conectado ? 'ok' : ''}">${D.mp.conectado ? 'Conectado' : 'Desconectado'}</span></div>
    <p class="sm mut">Você será redirecionado ao Mercado Pago para autorizar o acesso. A MineraBank cobra uma comissão de marketplace por venda recebida.</p>
    ${D.mp.conectado ? '' : '<button class="btn" id="mpB">Conectar conta Mercado Pago</button>'}</div>
    <div class="card"><div class="row"><span class="ic" style="width:48px;height:48px;border-radius:14px;background:var(--y-s);display:grid;place-items:center">${ic('mine')}</span><span class="sp"><b>Ponte Minera Pará</b><small class="mut" style="display:block">Sincronizar dados com o app Minera Pará</small></span>${tog('brT', D.bridge.ativo, 'Ativar ponte Minera Pará')}</div>
    <p class="sm mut" style="margin-bottom:0">Opcional e desativada por padrão.</p></div></div>`;
  }
  function ajuda() {
    return tb('Ajuda') + `<div class="pg"><div class="card" style="padding:4px 16px">${li('pix', 'Pix', 'Chaves, limites e comprovantes', undefined, 'data-faq="pix"')}${li('card', 'Cartão', 'Pedido, bloqueio e fatura', undefined, 'data-faq="cartao"')}${li('user', 'Conta', 'Abertura, análise e dados', undefined, 'data-faq="conta"')}${li('shield', 'Segurança', 'Senhas, dispositivos e golpes', undefined, 'data-faq="seg"')}</div>
    <div class="day">Fale com a gente</div><div class="card" style="padding:4px 16px">${li('chat', 'Atendimento por e-mail', 'Resposta em até 1 dia útil', undefined, 'id="mailUs"')}</div></div>`;
  }
  const FAQ = {
    pix: ['Pix', 'O Pix será liberado quando a MineraBank estiver conectada a uma instituição parceira (PSP). Seus limites já podem ser configurados em Pix → Meus limites.'],
    cartao: ['Cartão', 'O cartão depende de um emissor parceiro. Assim que disponível, você poderá pedi-lo em Cartões.'],
    conta: ['Conta', 'Sua conta fica "em análise" até a verificação de identidade. Seus dados podem ser vistos em Perfil → Dados pessoais.'],
    seg: ['Segurança', 'Nunca compartilhe suas senhas. Veja e remova acessos em Perfil → Segurança → Dispositivos conectados.'],
  };
  function informe() { return tb('Informe de rendimentos') + `<div class="pg"><div class="card">${cta('doc', 'Comece a render para ter seu informe', 'O informe é gerado quando há rendimentos no ano-base.', [['Criar uma Caixinha', '#/investir']])}</div></div>`; }
  function encerrar() {
    return tb('Encerrar conta') + `<div class="pg"><div class="card"><b>Antes de encerrar</b><ul class="sm mut" style="padding-left:18px;line-height:1.7"><li>Saldo atual: ${V(D.saldo)}${D.saldo ? ' — transfira antes de encerrar' : ''}</li><li>Suas chaves Pix serão excluídas</li><li>Seus dados serão mantidos pelo prazo exigido em lei</li></ul></div>
    <label class="fl" style="margin-top:12px"><span>Motivo</span><select class="in"><option>Não uso mais</option><option>Tarifas</option><option>Atendimento</option><option>Outro</option></select></label>
    <button class="btn" style="background:var(--bad);color:#fff" id="enc">Solicitar encerramento</button><a class="btn ol" href="#/ajuda">Falar com atendimento</a></div>`;
  }

  /* ---------------- ROUTER ---------------- */
  const R = { verificacao, atividade, garantia, inicio, notificacoes, pix, 'pix/pagar': pixPagar, 'pix/qr': pixQR, 'pix/copia': pixCopia, 'pix/cobrar': pixCobrar, 'pix/agendado': pixAgendado, 'pix/recorrente': pixRecorrente, 'pix/limites': pixLimites, 'pix/chaves': pixChaves, transferir, boleto, depositar, recarga, extrato, cartao, fatura, credito, investir, seguros, indique, perfil, dados, seguranca, privacidade, notifcfg, integracoes, ajuda, informe, encerrar };
  const TAB = { inicio: 'inicio', extrato: 'inicio', notificacoes: 'inicio', pix: 'pix', cartao: 'cartao', fatura: 'cartao', garantia: 'cartao', verificacao: 'inicio', atividade: 'perfil', investir: 'investir', credito: 'investir', perfil: 'perfil' };
  let stream = null;
  function bindBack() { $$('[data-back]').forEach((b) => (b.onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/inicio')))); }
  function route() {
    closeSheet(true);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const r = location.hash.replace(/^#\/?/, '') || 'inicio';
    if (routeOff(r)) { location.replace('#/inicio'); return; }
    if (window.MBX) { window.MBX.stop(); const X = window.MBX.match(r); if (X) { const v = view(); v.style.animation = 'none'; void v.offsetWidth; v.style.animation = ''; const h = H(); v.innerHTML = X.html(h);
      $$('.nav a').forEach((a) => { const on = a.dataset.r === (X.tab || (r === 'score' ? 'inicio' : 'investir')); a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
      bindBack(); window.scrollTo(0, 0); Promise.resolve(X.mount(h)).then(() => applyFlags(v)); applyFlags(v); return; } }
    const name = R[r] ? r : 'inicio';
    const v = view(); v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
    v.innerHTML = R[name]();
    const tab = TAB[name] || (name.startsWith('pix') ? 'pix' : name === 'seguros' || name === 'indique' ? 'inicio' : 'perfil');
    $$('.nav a').forEach((a) => { const on = a.dataset.r === tab; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
    bindBack(); after(name); applyFlags(v); window.scrollTo(0, 0);
    if (['inicio', 'notificacoes', 'pix', 'investir', 'cartao', 'garantia'].includes(name) && !document.activeElement.matches('input')) { const before = JSON.stringify(D); reload().then(() => { if (JSON.stringify(D) !== before && (location.hash.replace(/^#\/?/, '') || 'inicio') === r && !$('#sh')) rerender(); }, () => {}); }
  }
  // contexto passado às telas de extensão (js/mercado.js)
  const H = () => ({ D: () => D, F: () => F, tb, cta, li, empty, ic, brl, esc, $, $$, toast, sheet, closeSheet, confirmSheet, infoSheet, API, reload: () => reload().catch(() => {}) });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#catInfo')) window.MBX.infoList(H(), 'Categorias do cartão', ['A categoria sobe conforme as compras no cartão nos últimos 12 meses.', ...ORDEM.map(([, n]) => n).slice(1).map((n, i) => `${n}: a partir de ${brl(((D.cartaoCategoria && D.cartaoCategoria.todas) || [])[i + 1]?.minCents / 100 || 0)} em compras.`).filter((x) => !x.includes('R$ 0,00')), 'MineraPontos multiplicam os pontos do bônus diário e das compras.', 'A bandeira do cartão depende do emissor parceiro. Benefícios das categorias não são financeiros.']); });
  function rerender() { if (!D) return; const y = window.scrollY; const r = location.hash.replace(/^#\/?/, '') || 'inicio'; const name = R[r] ? r : 'inicio'; view().innerHTML = R[name](); bindBack(); after(name); applyFlags(view()); window.scrollTo(0, y); }
  const saveSetting = (patch, okMsg) => API.patch('/me/settings', patch).then((st) => { D.settings = st; if (okMsg) toast(okMsg); }, (e) => { toast(e.message); rerender(); });

  function after(name) {
    const eye = $('#eye') || $('#eye2'); if (eye) eye.onclick = () => { S.hide = !S.hide; localStorage.setItem('mb_hide', S.hide ? '1' : '0'); rerender(); };
    if (name === 'notificacoes' && $('#rdAll')) $('#rdAll').onclick = () => API.post('/me/notifications/read').then(() => { D.notifs.forEach((n) => (n.lida = true)); rerender(); }, (e) => toast(e.message));
    if (name === 'pix/pagar') {
      const ph = { 'CPF/CNPJ': 'Digite o CPF ou CNPJ', Celular: '94 99225-3569', 'E-mail': 'nome@email.com', Aleatória: 'Cole a chave aleatória' };
      let kt = 'CPF/CNPJ';
      $$('[data-kt]').forEach((b) => (b.onclick = () => { kt = b.dataset.kt; $$('[data-kt]').forEach((x) => x.classList.toggle('on', x === b)); $('#key').placeholder = ph[kt]; $('#key').focus(); }));
      $('#fKey').onsubmit = (e) => {
        e.preventDefault(); const k = $('#key').value.trim(); const d = k.replace(/\D/g, '');
        const ok = kt === 'CPF/CNPJ' ? d.length === 11 || d.length === 14 : kt === 'Celular' ? d.length >= 10 && d.length <= 11 : kt === 'E-mail' ? /^\S+@\S+\.\S+$/.test(k) : /^[0-9a-f-]{32,36}$/i.test(k);
        if (!ok) return ($('#err').textContent = 'Chave inválida para o tipo ' + kt + '.');
        const b = $('#fKey button'); b.disabled = true;
        API.get('/me/pix/resolve?chave=' + encodeURIComponent(k) + '&tipo=' + encodeURIComponent(kt)).then((r) => payFlow({ titulo: 'Pix', tipo: 'Pix', path: '/me/pix/transfer', body: { chave: r.chave, tipo: r.tipo }, nome: r.nome, chave: `${r.tipo}: ${r.exibicao}`, banco: r.banco }), (e) => { b.disabled = false; if (e.code === 'partner_required') infoSheet('Pix para outra instituição', e.message); else $('#err').textContent = e.message; });
      };
    }
    if (name === 'pix/qr') {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => { stream = s; const v = $('#vid'); if (v) { v.srcObject = s; v.play(); } }, () => { const m = $('#camMsg'); if (m) m.textContent = 'Não foi possível acessar a câmera. Use o Pix copia e cola.'; });
      else $('#camMsg').textContent = 'Câmera indisponível neste aparelho. Use o Pix copia e cola.';
    }
    if (name === 'pix/copia') {
      $('#paste').onclick = async () => { try { $('#cc').value = await navigator.clipboard.readText(); } catch (e) { toast('Não foi possível ler a área de transferência'); } };
      $('#go').onclick = () => { const c = $('#cc').value.trim(); if (!/^000201/.test(c) || c.length < 40) return toast('Código Pix inválido'); API.post('/me/pix/decode', { code: c }).then((r) => payFlow({ titulo: 'Pix copia e cola', tipo: 'Pix', path: '/me/pix/transfer', body: r.valorCents ? { copiaECola: c } : { chave: r.chave, tipo: r.tipo }, fixedValue: !!r.valorCents, valor: r.valorCents ? r.valorCents / 100 : 0, nome: r.nome, chave: `${r.tipo}: ${r.exibicao}`, banco: r.banco }), (e) => infoSheet('Pix copia e cola', e.message)); };
    }
    if (name === 'pix/cobrar') $('#gen').onclick = () => {
      const raw = $('#cv').value.trim(); const c = raw ? toCents(raw) : 0;
      if (raw && !(c > 0 && c <= 10000000)) return toast('Informe um valor válido');
      const b = $('#gen'); b.disabled = true;
      API.post('/me/pix/qrcode', { ...(c ? { valorCents: c } : {}), ...($('#cd').value.trim() ? { descricao: $('#cd').value.trim() } : {}), ...($('#ck') && $('#ck').value ? { chaveId: $('#ck').value } : {}) }).then((r) => {
        b.disabled = false;
        $('#out').innerHTML = `<div class="card" style="text-align:center;margin-top:12px"><b>${c ? brl(c / 100) : 'Valor livre'}</b><p class="mut sm" style="margin:2px 0 0">${esc(r.chave)}</p><img class="qr" alt="QR Code Pix" src="${esc(r.qr)}"><p class="sm mut">${esc(r.aviso)}</p><div class="code">${esc(r.payload)}</div><div class="g2" style="margin-top:12px"><button class="btn" data-copy="${esc(r.payload)}">${ic('copy')} Copiar</button><button class="btn ol" style="margin-top:0" id="shQ">${ic('share')} Enviar</button></div></div>`;
        $('#shQ').onclick = () => share('Pix MineraBank (copia e cola): ' + r.payload);
      }, (e) => { b.disabled = false; infoSheet('Cobrança Pix', e.message); });
    };
    const schedule = (chave, c, data, freq, rep, okMsg) => API.get('/me/pix/resolve?chave=' + encodeURIComponent(chave)).then((r) => confirmSheet('Confirmar agendamento', `${brl(c / 100)} para <b>${esc(r.nome)}</b> (${esc(r.tipo)}: ${esc(r.exibicao)}) em ${data.split('-').reverse().join('/')}${freq !== 'once' ? ' · ' + freqLbl[freq] : ''}.`, 'Continuar', () => pinSheet((pin) => API.post('/me/pix/schedules', { chave: r.chave, valorCents: c, data, freq, repeticoes: rep, pin }).then(async () => { await reload(); toast(okMsg); rerender(); }, (e) => infoSheet('Agendamento', e.message)))), (e) => infoSheet('Agendamento', e.message));
    $$('[data-cancel]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); confirmSheet('Cancelar agendamento?', 'O Pix não será mais enviado.', 'Cancelar agendamento', () => API.del('/me/pix/schedules/' + b.dataset.cancel).then(async () => { await reload(); toast('Agendamento cancelado'); rerender(); }, (x) => toast(x.message))); }));
    if (name === 'pix/agendado') $('#ag').onclick = () => { const k = $('#ak').value.trim(), c = toCents($('#av').value); if (k.length < 5) return toast('Informe a chave Pix'); if (!(c > 0)) return toast('Valor inválido'); if (!$('#ad').value) return toast('Escolha a data'); schedule(k, c, $('#ad').value, 'once', null, 'Pix agendado'); };
    if (name === 'pix/recorrente') $('#rg').onclick = () => { const c = toCents($('#rv').value); if ($('#rk').value.trim().length < 5) return toast('Informe a chave Pix'); if (!(c > 0)) return toast('Valor inválido'); if (!$('#ri').value) return toast('Escolha a data de início'); schedule($('#rk').value.trim(), c, $('#ri').value, $('#rf').value, $('#rn').value ? +$('#rn').value : null, 'Pix programado'); };
    if (name === 'pix/limites') {
      ['ld', 'ln'].forEach((id) => ($('#' + id).oninput = (e) => ($('#' + id + 'V').textContent = brl(+e.target.value))));
      $('#sv').onclick = () => {
        const patch = { limitePixDia: +$('#ld').value, limitePixNoite: +$('#ln').value, modoRua: $('#mrua').checked };
        const done = (st) => { D.settings = st; toast(st.limitesPendentes ? 'Salvo. Aumentos valem em 24h; reduções já valem.' : 'Limites atualizados'); history.back(); };
        const raising = patch.limitePixDia > D.settings.limitePixDia || patch.limitePixNoite > D.settings.limitePixNoite;
        pinSheet((pin) => {
          if (!raising) return API.patch('/me/settings', { ...patch, pin }).then(done, (e) => infoSheet('Limites', e.message));
          let otpId; const send = () => API.post('/me/otp', { purpose: 'limite' }).then((r) => { otpId = r.otpId; return r; });
          send().then((r) => otpSheet({ title: 'Confirme o aumento de limite', destino: r.destino, resend: send, submit: (code) => API.patch('/me/settings', { ...patch, pin, otpId, code }).then((st) => { closeSheet(); done(st); }) }), (e) => infoSheet('Limites', e.message));
        });
      };
    }
    if (name === 'pix/chaves') {
      $$('[data-del]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const k = D.chaves.find((x) => x.id === b.dataset.del); confirmSheet('Excluir chave?', `A chave ${esc(k.tipo)} <b>${esc(k.exibicao)}</b> deixará de receber Pix.`, 'Excluir chave', () => API.del('/me/pix/keys/' + k.id).then(async () => { await reload(); toast('Chave excluída'); rerender(); }, (x) => toast(x.message))); }));
      $('#nk').onclick = () => sheet(`<h3>Cadastrar chave</h3><div class="card" style="padding:4px 16px">${['CPF', 'Celular', 'E-mail', 'Aleatória'].map((t) => { const has = t !== 'Aleatória' && D.chaves.some((k) => k.tipo === t); return li('key', t, has ? 'Já cadastrada' : t === 'Aleatória' ? 'Gerada automaticamente' : t === 'CPF' ? esc(D.cpf) : t === 'Celular' ? esc(fmtCel(D.celular)) : esc(D.email), undefined, `data-nt="${t}"`); }).join('')}</div>`, (s) => {
        $$('[data-nt]', s).forEach((b) => (b.onclick = () => { closeSheet(); API.post('/me/pix/keys', { tipo: b.dataset.nt }).then(async () => { await reload(); toast('Chave ' + b.dataset.nt + ' cadastrada'); rerender(); }, (e) => infoSheet('Cadastrar chave', e.message)); }));
      });
    }
    if (name === 'transferir') {
      let tt = 'ted'; const draw = () => ($('#tf').innerHTML = tedFields(tt)); draw();
      $$('[data-tt]').forEach((b) => (b.onclick = () => { tt = b.dataset.tt; $$('[data-tt]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
      $('#fT').onsubmit = (e) => {
        e.preventDefault(); const err = (m) => ($('#err').textContent = m);
        if (tt === 'ted' && !/^\d{3}$/.test($('#tb').value)) return err('Código do banco deve ter 3 dígitos.');
        if (tt === 'ted' && !/^\d{4}$/.test($('#ta').value)) return err('Agência deve ter 4 dígitos.');
        if (!/^\d{4,12}-?\d?$/.test($('#tc').value.trim())) return err('Conta inválida.');
        if ($('#tn').value.trim().length < 3) return err('Informe o nome do titular.');
        if (tt === 'ted' && ![11, 14].includes($('#td').value.replace(/\D/g, '').length)) return err('CPF/CNPJ inválido.');
        if (tt === 'ted') return payFlow({ titulo: 'Transferência', tipo: 'TED', rail: 'ted', body: { banco: $('#tb').value, agencia: $('#ta').value, conta: $('#tc').value.trim(), nome: $('#tn').value.trim(), documento: $('#td').value.replace(/\D/g, '') }, nome: $('#tn').value.trim(), chave: 'Banco ' + $('#tb').value + ' · Ag ' + $('#ta').value + ' · Cc ' + $('#tc').value, banco: '' });
        payFlow({ titulo: 'Transferência', tipo: 'Transferência', path: '/me/transfer', body: { conta: $('#tc').value.trim() }, nome: $('#tn').value.trim(), chave: 'Ag 0001 · Cc ' + $('#tc').value.trim(), banco: 'MineraBank' });
      };
    }
    if (name === 'boleto') $('#fB').onsubmit = (e) => { e.preventDefault(); const d = $('#lb').value.replace(/\D/g, ''); if (d.length !== 47 && d.length !== 48) return ($('#err').textContent = 'A linha digitável deve ter 47 ou 48 números.'); const vc = d.length === 47 ? +d.slice(-10) : 0; if (!vc) return ($('#err').textContent = 'Boleto sem valor: informe pelo emissor.'); payFlow({ titulo: 'Pagar boleto', tipo: 'Pagamento', rail: 'boleto', body: { linha: d }, fixedValue: false, nome: 'Boleto', chave: d.replace(/(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d)(\d{14})/, '$1.$2 $3.$4 $5.$6 $7 $8'), valor: vc / 100 }); };
    if (name === 'depositar') {
      const draw = (k) => { $('#dpo').innerHTML = depOpts[k](); if (k === 'bol') $('#gb').onclick = () => { const v = parseFloat(($('#dv').value || '').replace(',', '.')); if (!(v >= 20)) return toast('Valor mínimo R$ 20,00'); API.post('/me/deposit', { valorCents: Math.round(v * 100) }).then((r) => infoSheet('Boleto de depósito', 'Linha digitável: ' + r.linhaDigitavel), (e) => infoSheet('Depósito por boleto', e.message)); }; };
      draw('pix'); $$('[data-dp]').forEach((b) => (b.onclick = () => { $$('[data-dp]').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.dp); }));
    }
    if (name === 'recarga') {
      let rv = 30; $$('[data-rv]').forEach((b) => (b.onclick = () => { rv = +b.dataset.rv; $$('[data-rv]').forEach((x) => x.classList.toggle('on', x === b)); }));
      $('#rn').oninput = (e) => (e.target.value = fmtCel(e.target.value));
      $('#fR').onsubmit = (e) => { e.preventDefault(); if ($('#rn').value.replace(/\D/g, '').length !== 11) return toast('Número inválido'); payFlow({ titulo: 'Recarga', tipo: 'Recarga', rail: 'topup', body: { operadora: $('#ro').value, numero: $('#rn').value.replace(/\D/g, '') }, nome: $('#ro').value, chave: $('#rn').value, valor: rv }); };
    }
    if (name === 'extrato') {
      reload().then(renderExtrato, renderExtrato);
      $('#q').oninput = (e) => { EX.q = e.target.value; renderExtrato(); };
      $$('[data-f]').forEach((b) => (b.onclick = () => { EX.f = b.dataset.f; $$('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); renderExtrato(); }));
      $$('[data-p]').forEach((b) => (b.onclick = () => { EX.p = +b.dataset.p; $$('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); renderExtrato(); }));
    }
    if (name === 'cartao') {
      const patchCard = (p, msg) => API.patch('/me/card', p).then((c) => { D.cartao = c; if (msg) toast(msg); rerender(); }, (e) => { toast(e.message); rerender(); });
      if ($('#askCard')) $('#askCard').onclick = () => API.post('/me/card').then(async () => { await reload(); toast('Cartão virtual solicitado'); rerender(); }, (e) => infoSheet('Cartão', e.message));
      if (D.cartao) {
        $('#show').onclick = () => infoSheet('Dados do cartão', 'Número, validade e CVV serão gerados pelo emissor parceiro, que ainda não está conectado.');
        $('#lockB').onclick = () => patchCard({ bloqueado: !D.cartao.bloqueado }, D.cartao.bloqueado ? 'Cartão desbloqueado' : 'Cartão bloqueado');
        if ($('#lim')) $('#lim').oninput = (e) => ($('#limV').textContent = brl(+e.target.value));
        if ($('#lim')) $('#lim').onchange = (e) => patchCard({ limiteCents: Math.round(+e.target.value * 100) }, 'Limite ajustado');
        $('#tAp').onchange = (e) => patchCard({ aproximacao: e.target.checked }, 'Aproximação ' + (e.target.checked ? 'ativada' : 'desativada'));
        $('#tIn').onchange = (e) => patchCard({ internacional: e.target.checked }, 'Compras internacionais ' + (e.target.checked ? 'ativadas' : 'desativadas'));
        $('#tOn').onchange = (e) => patchCard({ online: e.target.checked }, 'Compras online ' + (e.target.checked ? 'ativadas' : 'desativadas'));
      }
    }
    if (name === 'credito') { calcCredito(); $('#crV').oninput = (e) => { CR.v = +e.target.value; calcCredito(); }; $('#crN').oninput = (e) => { CR.n = +e.target.value; calcCredito(); }; $('#crGo').onclick = loanFlow; }
    if (name === 'garantia') {
      const set = (v, fromInput) => { GR.v = Math.max(0, Math.min(1000000, Math.round(v * 100) / 100)); $('#grR').value = Math.min(10000, GR.v); if (!fromInput) $('#grI').value = brl(GR.v); calcGarantia(); };
      $('#grR').oninput = (e) => set(+e.target.value); $('#grI').oninput = (e) => set(toCents(e.target.value) / 100 || 0, true); $('#grI').onblur = () => set(GR.v);
      $$('[data-gq]').forEach((b) => (b.onclick = () => set(+b.dataset.gq)));
      calcGarantia();
      const mv = (op, c) => API.post('/me/reserva/' + op, { valorCents: c, idempotencyKey: uuid() }).then(async () => { await reload(); toast(op === 'aplicar' ? 'Pronto! Seu limite aumentou' : 'Resgate feito'); rerender(); }, (e) => infoSheet('Limite garantido', e.message));
      $('#grGo').onclick = () => { const c = Math.round(GR.v * 100); if (!(c > 0)) return toast('Informe um valor válido'); if (c > Math.round(D.saldo * 100)) return infoSheet('Saldo insuficiente', 'Deposite via Pix para guardar esse valor e ganhar o mesmo em limite.'); confirmSheet('Guardar ' + brl(c / 100) + '?', `O valor sai da conta, vai para a Reserva e vira ${brl(c / 100)} de limite. Você pode resgatar a parte não usada no cartão.`, 'Guardar', () => mv('aplicar', c)); };
      if ($('#grOut')) $('#grOut').onclick = () => invSheet('Resgatar da Reserva · até ' + brl(G().resgatavelCents / 100), (c) => mv('resgatar', c));
    }
    if (name === 'verificacao') {
      const inp = $('#kycF'); let cur;
      const send = (blob) => { loadingInline(); upload('/me/kyc/' + cur, blob).then(async () => { await reload(); toast('Foto enviada'); route(); }, (e) => { route(); infoSheet('Verificação', e.message); }); };
      if (inp) inp.onchange = () => { if (inp.files && inp.files[0]) send(inp.files[0]); };
      $$('[data-kyc]').forEach((b) => (b.onclick = () => { cur = b.dataset.kyc; camera(cur === 'selfie' ? 'user' : 'environment', cur === 'selfie' ? 'Selfie' : 'Documento — ' + (cur === 'doc_frente' ? 'frente' : 'verso')).then(send, () => inp.click()); }));
    }
    if (name === 'atividade') API.get('/me/security-log').then((L) => { const el = $('#audL'); if (!el) return; el.innerHTML = L.length ? L.map((a) => { const [t, i] = AUD[a.acao] || [a.acao, 'shield']; return li(i, esc(t), new Date(a.em).toLocaleString('pt-BR') + (a.ua ? ' · ' + esc(uaName(a.ua)) : ''), '', ''); }).join('') : cta('shield', 'Nenhum evento ainda', ''); }, (e) => { const el = $('#audL'); if (el) el.innerHTML = cta('help', 'Não foi possível carregar', esc(e.message)); });
    if (name === 'investir') {
      ['apl', 'res', 'apl2'].forEach((id) => { if ($('#' + id)) $('#' + id).onclick = () => rail('investments', 'CDB'); });
      $('#pjR').oninput = (e) => { const v = +e.target.value; $('#pjV').textContent = brl(v); $('#pjO').textContent = `${brl(v)} viraria ${brl(proj(v))} em 12 meses`; };
      $$('[data-sug]').forEach((b) => (b.onclick = () => { $('#newCx').click(); setTimeout(() => { $('#nn').value = b.dataset.sug; $('#nm').value = b.dataset.meta; }, 30); }));
      if ($('#newCx2')) $('#newCx2').onclick = () => $('#newCx').click();
      $('#newCx').onclick = (e) => { e.preventDefault(); sheet(`<h3>Nova Caixinha</h3><label class="fl"><span>Nome</span><input class="in" id="nn" maxlength="40" placeholder="Ex.: Reserva de emergência"></label><label class="fl"><span>Meta (opcional)</span><input class="in" id="nm" inputmode="decimal" placeholder="R$ 0,00"></label><button class="btn" id="ok">Criar Caixinha</button>`, (s) => { $('#ok', s).onclick = () => { const n = $('#nn', s).value.trim(), m = toCents($('#nm', s).value); if (!n) return toast('Dê um nome à Caixinha'); API.post('/me/caixinhas', { nome: n, ...(m > 0 ? { metaCents: m } : {}) }).then(async () => { closeSheet(); await reload(); toast('Caixinha criada'); rerender(); }, (x) => toast(x.message)); }; }); };
      $$('[data-cx]').forEach((b) => (b.onclick = () => { const x = D.investimentos.caixinhas.find((c) => c.id === b.dataset.cx), op = b.dataset.op; invSheet((op === 'aplicar' ? 'Guardar em ' : 'Resgatar de ') + esc(x.nome), (c) => API.post(`/me/caixinhas/${encodeURIComponent(x.id)}/${op}`, { valorCents: c, idempotencyKey: uuid() }).then(async () => { await reload(); toast(op === 'aplicar' ? 'Dinheiro guardado' : 'Resgate feito'); rerender(); }, (e) => toast(e.message))); }));
    }
    if (name === 'seguros') $$('[data-seg]').forEach((b) => (b.onclick = () => rail('insurance', esc(b.dataset.seg))));
    if (name === 'indique') $('#shInv').onclick = () => share('Abra sua conta na MineraBank: ' + new URL('login.html', location.href).href);
    if (name === 'perfil') {
      $('#dk').onchange = (e) => { theme(e.target.checked ? 'dark' : 'light'); toast(e.target.checked ? 'Modo escuro ativado' : 'Modo claro ativado'); };
      $('#out').onclick = () => confirmSheet('Sair do app?', 'Você precisará entrar novamente com CPF e senha.', 'Sair', () => { API.post('/me/logout').finally(() => { sessionStorage.clear(); location.href = 'login.html'; }); });
    }
    if (name === 'dados') $('#sv').onclick = () => {
      const em = $('#de').value.trim().toLowerCase(), cel = celDig($('#dc').value);
      if (!/^\S+@\S+\.\S+$/.test(em)) return toast('E-mail inválido');
      if (!/^[1-9][1-9]\d{8,9}$/.test(cel) || (cel.length === 11 && cel[2] !== '9')) return toast('Celular inválido: use DDD + número (ex.: 94 99225-3569)');
      const changes = []; if (em !== D.email) changes.push(['email', em, 'Confirme o novo e-mail']); if (cel !== D.celular) changes.push(['celular', cel, 'Confirme o novo celular']);
      if (!changes.length) return toast('Nenhuma alteração');
      const next = () => {
        const c = changes.shift(); if (!c) { toast('Dados atualizados'); return history.back(); }
        let otpId;
        const send = () => API.post('/me/contact/otp', { campo: c[0], valor: c[1] }).then((r) => { otpId = r.otpId; return r; });
        send().then((r) => otpSheet({ title: c[2], destino: r.destino, resend: send, submit: (code) => new Promise((res, rej) => { closeSheet(); pinSheet((pin) => API.patch('/me', { otpId, code, pin }).then((x) => { D = x; res(); next(); }, (e) => { rej(e); infoSheet('Não foi possível alterar', e.message); })); }) }), (e) => infoSheet('Dados pessoais', e.message));
      };
      next();
    };
    if (name === 'seguranca') {
      $('#chPw').onclick = () => sheet(`<h3>Alterar senha de acesso</h3><label class="fl"><span>Senha atual</span><input class="in" type="password" id="a1"></label><label class="fl"><span>Nova senha</span><input class="in" type="password" id="a2"></label><label class="fl"><span>Confirmar nova senha</span><input class="in" type="password" id="a3"></label><button class="btn" id="ok">Alterar senha</button>`, (s) => ($('#ok', s).onclick = () => { if ($('#a2', s).value.length < 6) return toast('Mínimo de 6 caracteres'); if ($('#a2', s).value !== $('#a3', s).value) return toast('As senhas não conferem'); API.post('/me/password', { atual: $('#a1', s).value, nova: $('#a2', s).value }).then(() => { closeSheet(); toast('Senha alterada'); }, (e) => toast(e.message)); }));
      $('#pkAdd').onclick = async () => {
        if (!passkey.supported()) return infoSheet('Biometria', 'Este navegador não suporta biometria (passkeys). Continue entrando com CPF e senha.');
        try {
          const o = await API.post('/me/webauthn/register/options');
          const response = await passkey.create(o.options);
          await API.post('/me/webauthn/register/verify', { challengeId: o.challengeId, response, nome: uaName(navigator.userAgent) });
          await reload(); toast('Biometria ativada neste aparelho'); rerender();
        } catch (e) { infoSheet('Biometria', e.name === 'NotAllowedError' ? 'Ativação cancelada. Você pode tentar de novo quando quiser.' : e.name === 'InvalidStateError' ? 'Este aparelho já tem biometria ativa para sua conta.' : e.message); }
      };
      $$('[data-rmpk]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); confirmSheet('Remover biometria?', 'Este aparelho deixará de entrar com biometria. A senha continua valendo.', 'Remover', () => API.del('/me/webauthn/' + encodeURIComponent(b.dataset.rmpk)).then(async () => { await reload(); toast('Biometria removida'); rerender(); }, (x) => toast(x.message))); }));
      if ($('#rmAll')) $('#rmAll').onclick = () => confirmSheet('Encerrar outras sessões?', 'Todos os outros aparelhos precisarão entrar novamente.', 'Encerrar sessões', () => API.del('/me/sessions').then(async (r) => { await reload(); toast(r.encerradas + ' sessão(ões) encerrada(s)'); rerender(); }, (x) => toast(x.message)));
      $('#sRua').onchange = (e) => { if (e.target.checked) return saveSetting({ modoRua: true }, 'Modo rua ativado'); e.target.checked = true; pinSheet((pin) => saveSetting({ modoRua: false, pin }, 'Modo rua desativado').then(rerender)); };
      $$('[data-rmdev]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); confirmSheet('Remover dispositivo?', 'Esse acesso será desconectado.', 'Remover', () => API.del('/me/sessions/' + b.dataset.rmdev).then(async () => { await reload(); toast('Dispositivo removido'); rerender(); }, (x) => toast(x.message))); }));
    }
    if (name === 'privacidade' || name === 'notifcfg') {
      $$('input[id^="p_"]').forEach((i) => (i.onchange = () => saveSetting({ [i.id.slice(2)]: i.checked }, 'Preferência salva')));
      $$('input[id^="c_"]').forEach((i) => (i.onchange = () => API.patch('/me/consents', { [i.id.slice(2)]: i.checked }).then((c) => { D.consentimentos = c; toast('Consentimento registrado'); }, (e) => { toast(e.message); i.checked = !i.checked; })));
      if ($('#lgpd')) $('#lgpd').onclick = () => API.get('/me/export').then((d) => { const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'meus-dados-minerabank.json'; a.click(); toast('Arquivo com seus dados gerado'); }, (e) => toast(e.message));
      if ($('#lgpdDel')) $('#lgpdDel').onclick = () => confirmSheet('Solicitar exclusão dos dados?', 'Vamos analisar e responder em até 15 dias. Dados exigidos por lei (como registros financeiros) são mantidos pelo prazo legal. Para encerrar a conta, use Perfil → Encerrar conta.', 'Continuar', () => pinSheet((pin) => API.post('/me/delete-request', { pin }).then(async (r) => { await reload(); infoSheet('Pedido registrado', r.message); rerender(); }, (e) => infoSheet('Exclusão de dados', e.message))));
    }
    if (name === 'integracoes') {
      if ($('#mpB')) $('#mpB').onclick = () => { const b = $('#mpB'); b.disabled = true; API.post('/me/mp/connect').then((r) => { location.href = r.authorizationUrl; }, (e) => { b.disabled = false; infoSheet('Mercado Pago', e.message); }); };
      $('#brT').onchange = (e) => saveSetting({ bridge: e.target.checked }, 'Ponte Minera Pará ' + (e.target.checked ? 'ativada' : 'desativada')).then(reload);
    }
    if (name === 'ajuda') {
      $$('[data-faq]').forEach((b) => (b.onclick = () => { const [t, m] = FAQ[b.dataset.faq]; infoSheet(t, m); }));
      $('#mailUs').onclick = () => infoSheet('Atendimento', 'O canal de atendimento será publicado com o lançamento. Enquanto isso, consulte os tópicos de ajuda acima.');
    }
    if (name === 'encerrar') $('#enc').onclick = () => confirmSheet('Tem certeza?', 'Sua solicitação de encerramento será registrada.', 'Solicitar encerramento', () => API.post('/me/close-request').then((r) => toast(r.message), (e) => toast(e.message)));
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go],[data-copy],[data-tx]'); if (!t) return;
    if (t.dataset.go) location.hash = t.dataset.go;
    else if (t.dataset.copy) copy(t.dataset.copy);
    else if (t.dataset.tx) txDetail(t.dataset.tx);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('hashchange', route);

  // abertura: splash com o logo + anel enquanto carrega os dados da API
  const splash = $('#splash');
  const done = () => { if (splash) { splash.classList.add('off'); setTimeout(() => splash.remove(), 300); } };
  reload().then(() => { sessionStorage.setItem('mb_user', D.primeiroNome); route(); done(); }, (e) => {
    done(); view().innerHTML = `<div class="pg" style="padding-top:80px">${empty('help', 'Não foi possível carregar sua conta', esc(e.message))}<button class="btn" id="retry">Tentar novamente</button></div>`;
    $('#retry').onclick = () => location.reload();
  });
  new MutationObserver(() => applyFlags(view())).observe(view(), { childList: true, subtree: true });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
