/* MineraBank — Cripto e Bolsa, Modo Previsão (pontos) e Score MineraBank. Rotas registradas no roteador do app (window.MBX). */
(function () {
  'use strict';
  const timers = [];
  const every = (ms, fn) => timers.push(setInterval(fn, ms));
  const stop = () => { while (timers.length) clearInterval(timers.pop()); };
  const nf = (v, d) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const price = (q) => (q.classe === 'indice' ? nf(q.preco, 0) + ' pts' : 'R$ ' + nf(q.preco, q.preco < 10 ? 4 : 2));
  const varTxt = (v) => `<span class="${v >= 0 ? 'up' : 'dn'}">${v >= 0 ? '▲' : '▼'} ${nf(Math.abs(v), 2)}%</span>`;
  const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit' });
  const dataH = (t, per) => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Belem', ...(per === '1D' ? { hour: '2-digit', minute: '2-digit' } : per === '1A' ? { day: '2-digit', month: 'short', year: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
  const AV = { BTC: '₿', ETH: 'Ξ', SOL: 'S', USDT: '$', BNB: 'B', XRP: 'X', DOGE: 'Ð', ADA: '₳', IBOV: 'IB', USDBRL: 'US$' };
  function sparkSvg(vals) {
    if (!vals || vals.length < 2) return '<svg class="spark"></svg>';
    const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 64},${26 - ((v - mn) / r) * 24}`).join(' ');
    return `<svg class="spark" viewBox="0 0 64 28" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${vals[vals.length - 1] >= vals[0] ? 'var(--ok)' : 'var(--bad)'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  // gráfico interativo (toque/arraste mostra preço e horário)
  function chart(el, pts, fmt, per) {
    if (!pts || pts.length < 2) { el.innerHTML = '<p class="sm mut" style="text-align:center;padding:60px 0">Histórico indisponível para este período.</p>'; return; }
    const W = 360, H = 200, vs = pts.map((p) => p[1]), mn = Math.min(...vs), mx = Math.max(...vs), r = mx - mn || 1;
    const X = (i) => (i / (pts.length - 1)) * W, Y = (v) => 12 + (1 - (v - mn) / r) * (H - 24);
    const line = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    const col = vs[vs.length - 1] >= vs[0] ? 'var(--ok)' : 'var(--bad)';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfico de preço"><defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,${H} ${line} ${W},${H}" fill="url(#gA)"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <line id="cx" x1="0" x2="0" y1="0" y2="${H}" stroke="var(--mut)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" opacity="0"/><circle id="cd" r="4" fill="${col}" opacity="0"/></svg><div class="tip"></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cx = el.querySelector('#cx'), cd = el.querySelector('#cd');
    const show = (e) => { const b = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - b.left) / b.width) * (pts.length - 1)))); const x = X(i);
      cx.setAttribute('x1', x); cx.setAttribute('x2', x); cx.setAttribute('opacity', 1); cd.setAttribute('cx', x); cd.setAttribute('cy', Y(pts[i][1])); cd.setAttribute('opacity', 1);
      tip.textContent = fmt(pts[i][1]) + ' · ' + dataH(pts[i][0], per); tip.style.left = Math.max(60, Math.min(b.width - 60, (x / W) * b.width)) + 'px'; tip.style.opacity = 1; };
    const hide = () => { cx.setAttribute('opacity', 0); cd.setAttribute('opacity', 0); tip.style.opacity = 0; };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
  }

  const infoBtn = (id) => `<button class="back" id="${id}" aria-label="Regras e informações" style="font-weight:800;font-size:17px">?</button>`;
  // Regras/termos ficam atrás do "?" (telas limpas). Aceite obrigatório uma vez antes de jogar ou usar o Turbo.
  async function regras(H, onAceite) {
    const r = await H.API.get('/me/previsao/regulamento');
    H.sheet(`<h3>${H.esc(r.titulo)}</h3><ol class="sm" style="padding-left:18px;line-height:1.55;max-height:46vh;overflow:auto">${r.itens.map((i) => `<li style="margin-bottom:6px">${H.esc(i)}</li>`).join('')}</ol>
      ${r.aceite ? '<button class="btn" id="rgOk">Fechar</button>' : '<button class="btn" id="rgOk">Li e concordo</button><button class="btn ol" id="rgNo">Agora não</button>'}`, () => {
      H.$('#rgOk').onclick = async () => { if (!r.aceite) { try { await H.API.post('/me/previsao/aceite'); } catch (e) { return H.toast(e.message); } } H.closeSheet(); if (!r.aceite && onAceite) onAceite(); };
      if (H.$('#rgNo')) H.$('#rgNo').onclick = () => H.closeSheet();
    });
  }
  const infoList = (H, titulo, itens) => H.sheet(`<h3>${H.esc(titulo)}</h3><ul class="sm" style="padding-left:18px;line-height:1.55">${itens.map((i) => `<li style="margin-bottom:6px">${H.esc(i)}</li>`).join('')}</ul><button class="btn" id="ilOk">Entendi</button>`, () => (H.$('#ilOk').onclick = () => H.closeSheet()));

  /* ---------------- Cripto e Bolsa ---------------- */
  let aba = sessionStorage.getItem('mb_mk_aba') || 'cripto';
  function mercado(H) {
    return H.tb('Cripto e Bolsa', `<a class="back" href="#/mercado/alertas" aria-label="Alertas" style="margin-left:auto">${H.ic('bell')}</a>`) + `<div class="pg">
      <div class="seg" id="abas">${[['cripto', 'Cripto'], ['b3', 'Bolsa (B3)'], ['indices', 'Índices'], ['favoritos', 'Favoritos']].map(([k, l]) => `<button data-a="${k}" class="${aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="card" style="margin-top:12px;padding:4px 16px" id="lst"><div class="lring" style="margin:30px auto"><i></i></div></div>
      <p class="live" id="upd"></p><div class="risk" id="risk"></div>
      <a class="ban" href="#/previsao" style="margin-top:12px;background:var(--ink);color:#fff"><span class="ic" style="background:rgba(245,196,0,.15);color:var(--y)">${H.ic('chart')}</span><span class="sp"><b>Modo Previsão</b><p style="color:#B8B8C0">Jogo gratuito com pontos: acerte se BTC, dólar e Ibovespa sobem ou descem.</p></span>${H.ic('chev', 'chev')}</a></div>`;
  }
  async function mercadoMount(H) {
    const load = async () => {
      try {
        const r = await H.API.get('/me/mercado/ativos?classe=' + aba); if (!H.$('#lst')) return;
        H.$('#risk').textContent = r.aviso;
        H.$('#lst').innerHTML = r.ativos.length ? r.ativos.map((q) => `<button class="mk-li" data-s="${q.sym}"><span class="av">${H.esc(AV[q.sym] || q.sym.slice(0, 4))}</span><span class="t"><b>${H.esc(q.sym)}${q.favorito ? ' <span style="color:var(--y-d,#C99F00)">★</span>' : ''}</b><small>${H.esc(q.nome)}</small></span>
          ${q.disponivel ? `${sparkSvg(q.spark)}<span class="r"><b>${price(q)}</b><small>${varTxt(q.varPct)}${q.atrasado ? ` · <span title="Cotação com atraso">atraso ${q.atrasoMin} min</span>` : ''}</small></span>` : `<span class="r"><small class="mut" style="max-width:140px;display:block">${H.esc(q.motivo)}</small></span>`}</button>`).join('')
          : H.cta('heart', 'Nenhum favorito ainda', 'Toque na estrela de um ativo para acompanhá-lo aqui.', [['Ver criptomoedas', '', '', 'id="vcr"']]);
        H.$$('.mk-li').forEach((b) => (b.onclick = () => (location.hash = '#/mercado/ativo/' + b.dataset.s)));
        if (H.$('#vcr')) H.$('#vcr').onclick = () => { aba = 'cripto'; sessionStorage.setItem('mb_mk_aba', aba); H.$$('#abas button').forEach((x) => x.classList.toggle('on', x.dataset.a === aba)); load(); };
        H.$('#upd').innerHTML = `<i></i> Atualizado às ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Belem' })}${aba === 'cripto' ? ' · tempo real' : ''}`;
      } catch (e) { if (H.$('#lst')) H.$('#lst').innerHTML = H.cta('wifi', 'Cotações indisponíveis', e.message); }
    };
    H.$$('#abas button').forEach((b) => (b.onclick = () => { aba = b.dataset.a; sessionStorage.setItem('mb_mk_aba', aba); H.$$('#abas button').forEach((x) => x.classList.toggle('on', x === b)); H.$('#lst').innerHTML = '<div class="lring" style="margin:30px auto"><i></i></div>'; load(); }));
    await load(); every(5000, load);
  }
  function ativo(H, sym) {
    return H.tb(H.esc(sym), `<button class="back" id="fav" aria-label="Favoritar" style="margin-left:auto;font-size:20px">☆</button>`) + `<div class="pg"><div class="card" id="hd"><div class="lring" style="margin:20px auto"><i></i></div></div>
      <div class="card"><div class="seg" id="per">${['1D', '1S', '1M', '1A'].map((p, i) => `<button data-p="${p}" class="${i ? '' : 'on'}">${p}</button>`).join('')}</div><div class="chart" id="ch" style="margin-top:10px"></div><small class="mut" id="src"></small></div>
      <div class="g2" id="ord" style="margin-top:12px"></div>
      <div class="card" style="margin-top:12px"><div class="row"><b class="sp">Alertas de preço</b><button class="chip" id="nal">+ Criar alerta</button></div><div id="als" class="sm mut" style="margin-top:8px"></div></div>
      <div class="risk" id="risk"></div></div>`;
  }
  async function ativoMount(H, sym) {
    let q, per = '1D';
    const head = () => { H.$('#hd').innerHTML = q.disponivel ? `<small class="mut">${H.esc(q.nome)}</small><div class="big" id="px">${price(q)}</div><div>${varTxt(q.varPct)} <small class="mut">hoje</small></div>
      <p class="live" style="margin:8px 0 0"><i style="${q.atrasado ? 'background:var(--y-d,#C99F00)' : ''}"></i>${q.atrasado ? `Cotação com atraso de ${q.atrasoMin} min (${hora(q.ts)})` : 'Ao vivo'} · ${H.esc(q.fonte)}</p>`
      : `<small class="mut">${H.esc(q.nome)}</small><p><b>Cotação indisponível.</b><br><span class="sm mut">${H.esc(q.motivo)}</span></p>`;
      H.$('#fav').textContent = q.favorito ? '★' : '☆'; H.$('#fav').style.color = q.favorito ? 'var(--y-d,#C99F00)' : '';
      H.$('#als').innerHTML = q.alertas.filter((a) => a.ativo).length ? q.alertas.filter((a) => a.ativo).map((a) => `<div class="row" style="padding:6px 0"><span class="sp">${a.cond === 'acima' ? 'Subir acima de' : 'Cair abaixo de'} <b>${price({ ...q, preco: a.preco })}</b></span><button class="chip" data-del="${a.id}">Remover</button></div>`).join('') : 'Receba uma notificação quando o preço chegar ao valor que você escolher.';
      H.$$('[data-del]').forEach((b) => (b.onclick = () => H.API.del('/me/mercado/alertas/' + b.dataset.del).then(refresh, (e) => H.toast(e.message))));
    };
    const refresh = async () => { try { q = await H.API.get('/me/mercado/ativos/' + sym); if (H.$('#hd')) head(); } catch (e) { H.toast(e.message); } };
    const drawChart = async () => { const h = await H.API.get(`/me/mercado/ativos/${sym}/historico?periodo=${per}`).catch(() => ({ pontos: [] })); if (!H.$('#ch')) return; chart(H.$('#ch'), h.pontos, (v) => price({ ...q, preco: v }), per); H.$('#src').textContent = h.indisponivel ? h.motivo : h.fonte ? 'Fonte: ' + h.fonte : ''; };
    await refresh(); H.$('#risk').textContent = q.aviso;
    if (q.negociavel) {
      H.$('#ord').innerHTML = '<button class="btn" id="buy" style="margin:0">Comprar</button><button class="btn ol" id="sell" style="margin:0">Vender</button>';
      const order = (lado) => H.sheet(`<h3>${lado === 'compra' ? 'Comprar' : 'Vender'} ${H.esc(sym)}</h3><label class="fl">Valor (R$)<input class="in" id="ov" inputmode="decimal" placeholder="0,00"></label>
        <div class="risk">${H.esc(q.aviso)}</div><button class="btn" id="oc">Enviar ordem</button>`, () => { H.$('#oc').onclick = async () => {
          const v = Math.round(parseFloat(H.$('#ov').value.replace(/\./g, '').replace(',', '.')) * 100); if (!(v >= 100)) return H.toast('Informe um valor a partir de R$ 1,00.');
          try { await H.API.post('/me/mercado/ordens', { sym, lado, valorCents: v, idempotencyKey: 'ord-' + crypto.randomUUID() }); H.closeSheet(); H.toast('Ordem enviada ao parceiro.'); }
          catch (e) { H.closeSheet(); H.infoSheet(e.status === 503 ? 'Parceiro ainda não conectado' : 'Não foi possível enviar', e.message); } }; });
      H.$('#buy').onclick = () => order('compra'); H.$('#sell').onclick = () => order('venda');
    } else H.$('#ord').innerHTML = '<p class="sm mut" style="grid-column:1/-1;margin:0">Ativo de referência, apenas para acompanhamento.</p>';
    H.$('#fav').onclick = () => (q.favorito ? H.API.del('/me/mercado/favoritos/' + sym) : H.API.put('/me/mercado/favoritos/' + sym)).then(() => { q.favorito = !q.favorito; head(); H.toast(q.favorito ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.'); }, (e) => H.toast(e.message));
    H.$('#nal').onclick = () => H.sheet(`<h3>Alerta de preço · ${H.esc(sym)}</h3><p class="sm mut">Preço atual: ${q.disponivel ? price(q) : '—'}</p><div class="seg" id="alc"><button data-c="acima" class="on">Subir acima de</button><button data-c="abaixo">Cair abaixo de</button></div>
      <label class="fl">Preço<input class="in" id="alp" inputmode="decimal" value="${q.disponivel ? nf(q.preco * 1.05, q.preco < 10 ? 4 : 2) : ''}"></label><button class="btn" id="alok">Criar alerta</button>`, () => {
      let c = 'acima'; H.$$('#alc button').forEach((b) => (b.onclick = () => { c = b.dataset.c; H.$$('#alc button').forEach((x) => x.classList.toggle('on', x === b)); }));
      H.$('#alok').onclick = () => { const p = parseFloat(H.$('#alp').value.replace(/\./g, '').replace(',', '.')); if (!(p > 0)) return H.toast('Informe um preço válido.');
        H.API.post('/me/mercado/alertas', { sym, cond: c, preco: p }).then(() => { H.closeSheet(); H.toast('Alerta criado. Avisaremos por notificação.'); refresh(); }, (e) => H.toast(e.message)); }; });
    H.$$('#per button').forEach((b) => (b.onclick = () => { per = b.dataset.p; H.$$('#per button').forEach((x) => x.classList.toggle('on', x === b)); drawChart(); }));
    await drawChart();
    every(3000, async () => { const [n] = await H.API.get('/me/mercado/cotacoes?syms=' + sym).catch(() => [null]); if (n && n.disponivel && H.$('#px')) { q = { ...q, ...n }; H.$('#px').textContent = price(q); } });
    every(60000, () => per === '1D' && drawChart());
  }
  function alertas(H) { return H.tb('Alertas de preço') + '<div class="pg"><div class="card" id="al" style="padding:4px 16px"><div class="lring" style="margin:30px auto"><i></i></div></div></div>'; }
  async function alertasMount(H) {
    const l = await H.API.get('/me/mercado/alertas');
    H.$('#al').innerHTML = l.length ? l.map((a) => `<div class="mk-li" style="cursor:default"><span class="av">${H.esc(AV[a.sym] || a.sym.slice(0, 4))}</span><span class="t"><b>${H.esc(a.sym)} ${a.cond === 'acima' ? 'acima de' : 'abaixo de'} ${nf(a.preco, a.preco < 10 ? 4 : 2)}</b><small>${a.ativo ? 'Ativo' : 'Disparado ' + (a.disparadoEm ? new Date(a.disparadoEm).toLocaleString('pt-BR', { timeZone: 'America/Belem' }) : '')}</small></span></div>`).join('')
      : H.cta('bell', 'Nenhum alerta criado', 'Abra um ativo e toque em "Criar alerta" para ser avisado quando o preço chegar onde você quer.', [['Ver cotações', '#/mercado']]);
  }

  /* ---------------- Modo Previsão ---------------- */
  let pv = { ativo: 'BTC', dir: null, jan: 5, pts: 50, aba: 'jogar' };
  function previsao(H) {
    return H.tb('Modo Previsão', `<span class="pts" id="saldoP" style="margin-left:auto">— pts</span>${infoBtn('pvInfo')}`) + `<div class="pg">
      <div class="seg" id="pab">${[['jogar', 'Jogar'], ['aprender', 'Aprender'], ['ranking', 'Ranking'], ['conquistas', 'Conquistas'], ['loja', 'Vantagens']].map(([k, l]) => `<button data-t="${k}" class="${pv.aba === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="pc" style="margin-top:12px"><div class="lring" style="margin:30px auto"><i></i></div></div></div>`;
  }
  async function previsaoMount(H) {
    let R;
    const saldo = async () => { R = await H.API.get('/me/previsao'); if (H.$('#saldoP')) H.$('#saldoP').textContent = nf(R.saldo, 0) + ' pts'; };
    const tabs = { jogar, aprender, ranking, conquistas, loja };
    const comAceite = (fn) => () => (R.aceite ? fn() : regras(H, () => { R.aceite = true; fn(); }));
    H.$('#pvInfo').onclick = () => regras(H, () => { R.aceite = true; });
    H.$$('#pab button').forEach((b) => (b.onclick = () => { pv.aba = b.dataset.t; H.$$('#pab button').forEach((x) => x.classList.toggle('on', x === b)); stop(); render(); }));
    const render = async () => { H.$('#pc').innerHTML = '<div class="lring" style="margin:30px auto"><i></i></div>'; try { await saldo(); await tabs[pv.aba](); } catch (e) { H.$('#pc').innerHTML = H.cta('wifi', 'Não foi possível carregar', e.message); } };
    async function jogar() {
      const ATV = R.ativos;
      H.$('#pc').innerHTML = `${R.bonusDisponivel ? `<button class="ban" id="bon" style="width:100%;border:0;margin-bottom:12px;text-align:left;font:inherit;cursor:pointer"><span class="ic">${H.ic('gift')}</span><span class="sp"><b>Bônus diário disponível</b><p>Pegue seus pontos grátis de hoje${H.D().cartaoCategoria && H.D().cartaoCategoria.multiplicador > 1 ? ` (MineraPontos ${nf(H.D().cartaoCategoria.multiplicador, 2).replace(/,?0+$/, '')}x)` : ''}.</p></span>${H.ic('chev', 'chev')}</button>` : ''}
        <div class="card"><div class="seg" id="atv">${Object.entries(ATV).map(([k]) => `<button data-a="${k}" class="${pv.ativo === k ? 'on' : ''}">${k === 'USDBRL' ? 'Dólar' : k === 'IBOV' ? 'Ibovespa' : k}</button>`).join('')}</div>
          <div style="margin-top:12px"><small class="mut" id="pnm">${H.esc(ATV[pv.ativo])}</small><div class="big" id="ppx">—</div><p class="live" style="margin:2px 0 0"><i></i><span id="pts2">Ao vivo</span></p></div>
          <div class="chart" id="pch" style="margin-top:6px"></div>
          <b style="display:block;margin:6px 0 8px">Daqui a</b><div class="seg" id="jan">${R.janelas.map((j) => `<button data-j="${j}" class="${pv.jan === j ? 'on' : ''}">${j} min</button>`).join('')}</div>
          <b style="display:block;margin:14px 0 8px">O preço vai…</b><div class="dir"><button class="s ${pv.dir === 'sobe' ? 'on' : ''}" data-d="sobe">▲ Subir</button><button class="d ${pv.dir === 'desce' ? 'on' : ''}" data-d="desce">▼ Descer</button></div>
          <div class="row" style="margin-top:14px"><b class="sp">Pontos</b><span class="pts" id="ptv">${pv.pts}</span></div><input type="range" id="ptr" min="${R.regras.stakeMin}" max="${Math.max(R.regras.stakeMin, Math.min(R.regras.stakeMax, R.saldo))}" step="10" value="${Math.min(pv.pts, Math.max(R.regras.stakeMin, R.saldo))}" aria-label="Pontos">
          <button class="btn" id="go" ${R.saldo < R.regras.stakeMin ? 'disabled' : ''}>Fazer previsão</button></div>
        <div class="sec-h" style="margin:18px 2px 8px"><h2>Suas previsões</h2></div><div class="card" id="mp" style="padding:4px 16px"></div>
        <div class="card" style="margin-top:12px"><b>Sequência</b><p class="sm mut" style="margin:4px 0 0">Atual: <b>${R.streak.atual}</b> acerto(s) seguidos · Melhor: <b>${R.streak.melhor}</b> · Acertos: <b>${R.streak.acertos}/${R.streak.total}</b></p></div>
        ${R.apoio.ativo ? `<div class="card" style="margin-top:12px"><div class="row"><span class="ic" style="width:40px;height:40px;border-radius:12px;background:var(--ink);color:var(--y);display:grid;place-items:center">${H.ic('bolt')}</span><span class="sp"><b>Turbo de Pontos</b><small class="mut" style="display:block">${R.apoio.pontosPorReal} pts por R$ 1</small></span></div><button class="btn" id="apo">Turbine suas previsões</button></div>` : ''}`;
      const sel = async () => {
        H.$('#pnm').textContent = ATV[pv.ativo];
        const [q] = await H.API.get('/me/mercado/cotacoes?syms=' + pv.ativo).catch(() => [null]); if (!H.$('#ppx')) return;
        if (q && q.disponivel) { H.$('#ppx').textContent = price(q); H.$('#pts2').textContent = q.atrasado ? `Cotação de ${hora(q.ts)} (com atraso)` : 'Ao vivo · ' + q.fonte; } else { H.$('#ppx').textContent = '—'; H.$('#pts2').textContent = (q && q.motivo) || 'Cotação indisponível'; }
        const h = await H.API.get(`/me/mercado/ativos/${pv.ativo}/historico?periodo=1D`).catch(() => ({ pontos: [] })); if (H.$('#pch') && q) chart(H.$('#pch'), h.pontos.slice(-120), (v) => price({ ...q, preco: v }), '1D');
      };
      const mine = async () => {
        const l = await H.API.get('/me/previsao/previsoes'); if (!H.$('#mp')) return;
        H.$('#mp').innerHTML = l.length ? l.slice(0, 10).map((p) => { const lbl = { aberta: '<span class="pill warn cd" data-t="' + p.liquidaEm + '"></span>', ganhou: `<b class="up">+${p.premio} pts</b>`, perdeu: '<b class="dn">Errou</b>', empate: '<span class="mut">Devolvido</span>', anulada: '<span class="mut">Anulada</span>' }[p.status];
          return `<div class="mk-li" style="cursor:default"><span class="av" style="background:${p.direcao === 'sobe' ? '#E3F5EC' : '#FBE6E6'};color:${p.direcao === 'sobe' ? 'var(--ok)' : 'var(--bad)'}">${p.direcao === 'sobe' ? '▲' : '▼'}</span><span class="t"><b>${H.esc(p.nomeAtivo)} · ${p.pontos} pts</b><small>Entrada ${price({ classe: p.ativo === 'IBOV' ? 'indice' : '', preco: p.entrada.preco })}${p.saida ? ' → ' + price({ classe: p.ativo === 'IBOV' ? 'indice' : '', preco: p.saida.preco }) : ''} · ${p.janelaMin} min</small></span><span class="r">${lbl}</span></div>`; }).join('')
          : H.cta('chart', 'Faça sua primeira previsão', 'Escolha um ativo, o tempo e se ele vai subir ou descer. É grátis e só vale pontos.');
        tickCd();
      };
      const tickCd = () => H.$$('.cd[data-t]').forEach((el) => { const s = Math.max(0, Math.round((+el.dataset.t - Date.now()) / 1000)); el.textContent = s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Liquidando…'; });
      H.$$('#atv button').forEach((b) => (b.onclick = () => { pv.ativo = b.dataset.a; H.$$('#atv button').forEach((x) => x.classList.toggle('on', x === b)); sel(); }));
      H.$$('#jan button').forEach((b) => (b.onclick = () => { pv.jan = +b.dataset.j; H.$$('#jan button').forEach((x) => x.classList.toggle('on', x === b)); }));
      H.$$('.dir button').forEach((b) => (b.onclick = () => { pv.dir = b.dataset.d; H.$$('.dir button').forEach((x) => x.classList.toggle('on', x === b)); }));
      H.$('#ptr').oninput = (e) => { pv.pts = +e.target.value; H.$('#ptv').textContent = pv.pts; };
      if (H.$('#bon')) H.$('#bon').onclick = () => H.API.post('/me/previsao/bonus').then((r) => { H.toast(`+${r.pontos} pontos de bônus!`); render(); }, (e) => H.toast(e.message));
      if (H.$('#apo')) H.$('#apo').onclick = comAceite(() => H.sheet(`<div class="row"><h3 class="sp" style="margin:0">Turbo de Pontos</h3>${infoBtn('tbInfo')}</div>
        <label class="fl">Valor (R$)<input class="in" id="apv" inputmode="decimal" value="10,00"></label><p class="sm mut" id="apcalc"></p>
        <button class="btn" id="apok">Turbine suas previsões</button>`, () => {
        H.$('#tbInfo').onclick = () => regras(H);
        const calc = () => { const v = parseFloat(H.$('#apv').value.replace(/\./g, '').replace(',', '.')) || 0; H.$('#apcalc').textContent = `Você recebe ${nf(Math.floor(v * R.apoio.pontosPorReal), 0)} pontos.`; }; H.$('#apv').oninput = calc; calc();
        H.$('#apok').onclick = async () => { const v = Math.round(parseFloat(H.$('#apv').value.replace(/\./g, '').replace(',', '.')) * 100);
          try { const r = await H.API.post('/me/previsao/turbo', { valorCents: v }); H.closeSheet(); H.infoSheet('Pix gerado', `+${r.pontosDeAgradecimento} pts após a confirmação.\n\n${r.pixCopiaCola || ''}`); }
          catch (e) { H.closeSheet(); H.infoSheet(e.status === 503 ? 'Turbo de Pontos indisponível' : 'Não foi possível gerar', e.message); } }; }));
      H.$('#go').onclick = comAceite(async () => {
        if (!pv.dir) return H.toast('Escolha se o preço vai subir ou descer.');
        H.$('#go').disabled = true;
        try { await H.API.post('/me/previsao/previsoes', { ativo: pv.ativo, direcao: pv.dir, janelaMin: pv.jan, pontos: pv.pts }); H.toast(`Previsão registrada! Resultado em ${pv.jan} min.`); pv.dir = null; await saldo(); H.$$('.dir button').forEach((x) => x.classList.remove('on')); mine(); }
        catch (e) { H.toast(e.message); } finally { if (H.$('#go')) H.$('#go').disabled = false; }
      });
      await Promise.all([sel(), mine()]);
      every(3000, sel); every(1000, tickCd); every(10000, () => { mine(); saldo(); });
    }
    async function ranking() {
      const r = await H.API.get('/me/previsao/ranking');
      const row = (x) => `<div class="rk ${x.destaque ? 'hl' : ''} ${x.voce ? 'me' : ''}"><span class="p">${x.pos <= 3 ? ['🥇', '🥈', '🥉'][x.pos - 1] : x.pos}</span><span class="sp"><b>${H.esc(x.nome)}${x.voce ? ' (você)' : ''}</b>${x.titulo || x.selo ? `<small class="mut" style="display:block">${H.esc([x.titulo, x.selo].filter(Boolean).join(' · '))}</small>` : ''}</span><span style="text-align:right"><b class="${x.pontos >= 0 ? 'up' : 'dn'}">${x.pontos >= 0 ? '+' : ''}${nf(x.pontos, 0)}</b><small class="mut" style="display:block">${x.acertos}/${x.previsoes} acertos</small></span></div>`;
      H.$('#pc').innerHTML = `<div class="card"><b>Ranking da semana</b><p class="sm mut" style="margin:2px 0 8px">Semana desde ${new Date(r.semanaDesde).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' })}</p>
        ${r.top.length ? r.top.map(row).join('') : H.cta('gift', 'Ranking em aberto', 'Faça previsões esta semana para aparecer aqui.')}${r.voce && r.voce.pos > 20 ? '<div style="margin-top:8px">' + row(r.voce) + '</div>' : ''}</div>`;
    }
    async function conquistas() {
      const r = await H.API.get('/me/previsao/conquistas');
      H.$('#pc').innerHTML = `<div class="card"><div class="g3"><div><small class="mut">Sequência</small><div class="b" style="font-size:22px">${r.streak.atual}</div></div><div><small class="mut">Melhor</small><div class="b" style="font-size:22px">${r.streak.melhor}</div></div><div><small class="mut">Acertos</small><div class="b" style="font-size:22px">${r.streak.acertos}</div></div></div></div>
        <div class="ach" style="margin-top:12px">${r.conquistas.map((c) => `<div class="${c.desbloqueada ? 'on' : ''}"><span style="font-size:22px">${c.desbloqueada ? '🏅' : '🔒'}</span><b>${H.esc(c.nome)}</b><small class="mut">${H.esc(c.descricao)}</small></div>`).join('')}</div>`;
    }
    async function loja() {
      const r = await H.API.get('/me/previsao/vantagens');
      const tipo = { badge: 'Selo', titulo: 'Título', skin: 'Visual do cartão', destaque: 'Ranking' };
      H.$('#pc').innerHTML = `<div class="card" style="padding:4px 16px">${r.vantagens.map((p) => `<div class="mk-li" style="cursor:default"><span class="av">${p.tipo === 'skin' ? H.ic('card') : p.tipo === 'destaque' ? '★' : p.tipo === 'titulo' ? 'T' : '🏅'}</span><span class="t"><b>${H.esc(p.nome)}</b><small>${tipo[p.tipo] || ''} · ${H.esc(p.descricao)}</small></span>
        <span class="r">${p.resgatado ? (['skin', 'titulo', 'badge'].includes(p.tipo) ? `<button class="chip ${p.equipado ? 'on' : ''}" data-eq="${p.id}" data-on="${p.equipado ? 0 : 1}">${p.equipado ? 'Em uso' : 'Usar'}</button>` : '<span class="pill ok">Ativo</span>') : `<button class="chip" data-rd="${p.id}" ${R.saldo < p.custo ? 'disabled' : ''}>${nf(p.custo, 0)} pts</button>`}</span></div>`).join('')}</div>`;
      H.$$('[data-rd]').forEach((b) => (b.onclick = () => H.confirmSheet('Trocar pontos?', '', 'Trocar', () => H.API.post(`/me/previsao/vantagens/${b.dataset.rd}/resgatar`).then(() => { H.toast('Vantagem resgatada!'); H.reload(); render(); }, (e) => H.toast(e.message)))));
      H.$$('[data-eq]').forEach((b) => (b.onclick = () => H.API.post(`/me/previsao/vantagens/${b.dataset.eq}/equipar`, { equipar: b.dataset.on === '1' }).then(() => { H.reload(); render(); }, (e) => H.toast(e.message))));
    }
    async function aprender() {
      const t = await H.API.get('/me/previsao/trilha');
      H.$('#pc').innerHTML = `<div class="card"><div class="row"><b class="sp">Trilha de aprendizado</b><span class="pill">${t.concluidas}/${t.total}</span></div><div class="bar"><span style="width:${(t.concluidas / t.total) * 100}%"></span></div></div>
        <div class="card" style="margin-top:12px;padding:4px 16px">${t.licoes.map((l) => `<button class="mk-li" data-l="${l.id}"><span class="av" style="${l.concluida ? 'background:var(--y-s)' : ''}">${l.concluida ? '✓' : { Cripto: '₿', Bolsa: 'B3', Investimentos: '%' }[l.tema]}</span><span class="t"><b>${H.esc(l.titulo)}</b><small>${H.esc(l.tema)}</small></span><span class="r">${l.concluida ? '<span class="pill ok">Concluída</span>' : `<span class="pill">+${t.pontosPorLicao} pts</span>`}</span></button>`).join('')}</div>`;
      H.$$('[data-l]').forEach((b) => (b.onclick = () => { const l = t.licoes.find((x) => x.id === b.dataset.l);
        H.sheet(`<small class="mut">${H.esc(l.tema)}</small><h3 style="margin-top:2px">${H.esc(l.titulo)}</h3><p>${H.esc(l.texto)}</p><b>${H.esc(l.pergunta)}</b><div style="margin-top:10px">${l.opcoes.map((o, i) => `<button class="btn ol" data-o="${i}" style="margin:6px 0 0">${H.esc(o)}</button>`).join('')}</div>`, () => {
          H.$$('[data-o]').forEach((ob) => (ob.onclick = async () => { const r = await H.API.post('/me/previsao/trilha/' + l.id, { resposta: +ob.dataset.o }).catch((e) => ({ mensagem: e.message }));
            if (r.correta) { H.closeSheet(); H.toast(r.mensagem); render(); } else { ob.classList.add('dn'); H.toast(r.mensagem); } })); }); }));
    }
    await render();
    if (!R.aceite) regras(H, () => { R.aceite = true; });
  }

  /* ---------------- Score MineraBank ---------------- */
  function gauge(score) {
    const a = Math.PI * (1 - score / 1000), x = 110 + 90 * Math.cos(a), y = 110 - 90 * Math.sin(a);
    return `<svg class="gauge" viewBox="0 0 220 125" width="240" aria-hidden="true"><path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="var(--card2)" stroke-width="16" stroke-linecap="round"/>
      <path d="M20 110 A90 90 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="var(--y)" stroke-width="16" stroke-linecap="round"/></svg>`;
  }
  function score(H) { return H.tb('Score MineraBank', `<span style="margin-left:auto"></span>${infoBtn('scInfo')}`) + '<div class="pg" id="sc"><div class="lring" style="margin:40px auto"><i></i></div></div>'; }
  async function scoreMount(H) {
    const r = await H.API.get('/me/score');
    H.$('#sc').innerHTML = `<div class="card" style="text-align:center">${gauge(r.score)}<div class="gnum">${r.score}</div><div class="gfx">${H.esc(r.faixa)}${r.penalidade ? ` · −${r.penalidade} por atrasos` : ''}</div></div>
      <div class="card" style="margin-top:12px"><b>Evolução</b><div class="chart" id="hch" style="margin-top:6px"></div></div>
      <div class="sec-h" style="margin:18px 2px 8px"><h2>Fatores</h2></div>
      <div class="card" style="padding:4px 16px">${r.fatores.map((f) => `<div class="fx"><div class="row"><b>${H.esc(f.nome)}</b><span><b>${f.pontos}</b><span class="mut">/${f.max}</span></span></div><div class="bar"><span style="width:${f.max ? (f.pontos / f.max) * 100 : 0}%"></span></div></div>`).join('')}</div>
      <div class="sec-h" style="margin:18px 2px 8px"><h2>Sugestões para você</h2></div>
      <div class="card">${r.sugestoes.creditoAteCents ? `<b>Crédito de até ${H.brl(r.sugestoes.creditoAteCents / 100)}</b><small style="display:block;color:var(--y-d,#C99F00);font-weight:700">Sujeito a análise de crédito</small>` : '<b>Continue movimentando sua conta</b>'}
        <b style="display:block;margin-top:10px">Cartão ${H.esc(r.cartao.nome)}</b>${r.cartao.proxima ? `<small class="mut">Faltam ${H.brl(r.cartao.faltaCents / 100)} para ${H.esc(r.cartao.proxima.nome)}</small>` : ''}
        <div class="g2" style="margin-top:10px"><a class="btn" href="#/credito" style="margin:0">Simular crédito</a><a class="btn ol" href="#/garantia" style="margin:0">Limite garantido</a></div></div>
`;
    H.$('#scInfo').onclick = () => infoList(H, 'Sobre o Score MineraBank', [r.lgpd, ...r.fatores.map((f) => `${f.nome}: ${f.dica}`), r.sugestoes.aviso, 'Acertos e pontos do Modo Previsão não influenciam o score, limites ou crédito.']);
    chart(H.$('#hch'), r.historico.map((h) => [Date.parse(h.dia + 'T12:00:00-03:00'), h.score]).concat(r.historico.length < 2 ? [[Date.now(), r.score]] : []), (v) => Math.round(v) + ' pts', '1A');
  }

  const ROUTES = [
    [/^mercado$/, mercado, mercadoMount], [/^mercado\/alertas$/, alertas, alertasMount], [/^mercado\/ativo\/([A-Z0-9]{2,8})$/, ativo, ativoMount],
    [/^previsao$/, previsao, previsaoMount], [/^score$/, score, scoreMount],
  ];
  window.MBX = {
    infoList,
    stop,
    match(r) { for (const [re, html, mount] of ROUTES) { const m = r.match(re); if (m) return { html: (H) => html(H, m[1]), mount: (H) => Promise.resolve(mount(H, m[1])).catch((e) => H.toast(e.message)) }; } return null; },
  };
})();
