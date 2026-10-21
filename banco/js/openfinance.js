/* Open Finance — "Minhas contas em outros bancos" (Pluggy). Telas de extensão registradas em window.MBX. */
(function () {
  'use strict';
  const V = (H, c) => (localStorage.getItem('mb_hide') === '1' ? 'R$ ••••' : H.brl(c / 100));
  const logo = (H, a) => `<span class="ic">${a.logo ? `<img src="${H.esc(a.logo)}" alt="" width="24" height="24" style="border-radius:6px" onerror="this.remove()">` : H.ic('link')}</span>`;
  const tipoLbl = (a) => (a.tipo === 'CREDIT' ? 'Cartão de crédito' : a.subtipo === 'SAVINGS_ACCOUNT' ? 'Poupança' : 'Conta corrente');
  const stLbl = (s) => ({ UPDATED: ['ok', 'Atualizada'], UPDATING: ['', 'Atualizando'], LOGIN_ERROR: ['bad', 'Reconectar'], OUTDATED: ['bad', 'Desatualizada'], WAITING_USER_INPUT: ['', 'Aguardando você'] }[s] || ['', 'Conectada']);

  function lista(H) {
    return H.tb('Minhas contas em outros bancos') + `<div class="pg" id="ofPg"><div style="min-height:40vh;display:grid;place-items:center" class="mut sm">Carregando…</div></div>`;
  }
  async function listaMount(H) {
    const st = await H.API.get('/me/openfinance/status');
    const pg = H.$('#ofPg'); if (!pg) return;
    if (!st.disponivel) { location.hash = '#/inicio'; return; }
    if (!st.conexoes.length) {
      pg.innerHTML = `<div class="card">${H.cta('link', 'Veja todos os seus bancos aqui', 'Conecte contas de outras instituições pelo Open Finance e acompanhe saldos e movimentações sem sair da MineraBank.', [['Conectar um banco', '#/openfinance/conectar']])}</div>
      <div class="day">Como funciona</div><div class="card" style="padding:4px 16px">${H.li('shield', 'Consentimento seu', 'Você autoriza na tela do seu banco', '')}${H.li('eye', 'Somente leitura', 'Não movimentamos dinheiro nessas contas', '')}${H.li('trash', 'Desconecte quando quiser', 'A conexão é apagada aqui e na Pluggy', '')}</div>`;
      return;
    }
    let r; try { r = await H.API.get('/me/openfinance/contas'); } catch (e) { pg.innerHTML = `<div class="card">${H.empty('help', 'Não foi possível carregar', H.esc(e.message))}</div><button class="btn" id="ofRt">Tentar novamente</button>`; H.$('#ofRt').onclick = () => listaMount(H); return; }
    const por = r.conexoes.map((c) => ({ c, contas: r.contas.filter((a) => a.conexaoId === c.id), erro: r.indisponiveis.some((x) => x.conexaoId === c.id) }));
    pg.innerHTML = `<div class="card" style="background:var(--ink);color:#fff;border:0"><small style="color:#B8B8C0">Saldo em contas de outros bancos</small><div class="b" style="font-size:26px;margin-top:2px">${V(H, r.saldoTotalCents)}</div><small style="color:#B8B8C0">${r.conexoes.length} ${r.conexoes.length > 1 ? 'instituições conectadas' : 'instituição conectada'} · via Open Finance</small></div>
      ${por.map(({ c, contas, erro }) => { const [k, l] = stLbl(c.status); return `<div class="day">${H.esc(c.banco)}</div><div class="card" style="padding:4px 16px">
        ${contas.map((a) => H.li('link', H.esc(a.nome), `${tipoLbl(a)}${a.numero ? ' · ' + H.esc(a.numero) : ''}`, `<span class="right">${a.tipo === 'CREDIT' ? `<small class="mut" style="display:block">Fatura</small><b>${V(H, Math.abs(a.saldoCents))}</b>` : `<b>${V(H, a.saldoCents)}</b>`}${a.limiteDisponivelCents !== undefined ? `<small class="mut" style="display:block">Limite ${V(H, a.limiteDisponivelCents)}</small>` : ''}</span>`, `data-go="#/openfinance/conta/${H.esc(a.id)}"`).replace('<span class="ic">' + H.ic('link') + '</span>', logo(H, a))).join('')}
        ${!contas.length ? `<p class="sm mut" style="margin:12px 0">${erro ? 'Instituição indisponível no momento. Tente mais tarde.' : 'Sincronizando suas contas…'}</p>` : ''}
        <div class="li"><span class="t"><small>Desde ${new Date(c.conectadoEm).toLocaleDateString('pt-BR')}</small></span><span class="tag ${k}">${l}</span><button class="btn sm ol" style="width:auto;margin:0 0 0 8px" data-ofdel="${H.esc(c.id)}" data-ofnome="${H.esc(c.banco)}">Desconectar</button></div></div>`; }).join('')}
      <a class="btn" style="margin-top:14px" href="#/openfinance/conectar">${H.ic('plus')} Conectar outro banco</a>
      <p class="sm mut" style="text-align:center">Atualizado às ${new Date(r.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · dados fornecidos pelas instituições via Pluggy</p>`;
    H.$$('[data-ofdel]').forEach((b) => (b.onclick = () => H.confirmSheet('Desconectar ' + b.dataset.ofnome + '?', 'Paramos de acessar os dados dessa instituição e a conexão é apagada na MineraBank e na Pluggy. Você pode reconectar quando quiser.', 'Desconectar', () => H.API.del('/me/openfinance/conexoes/' + b.dataset.ofdel).then(() => { H.toast('Banco desconectado'); listaMount(H); }, (e) => H.toast(e.message)))));
  }

  function conectar(H) { return H.tb('Conectar um banco') + `<div class="pg" id="ofPg"><div style="min-height:40vh;display:grid;place-items:center" class="mut sm">Carregando…</div></div>`; }
  async function conectarMount(H) {
    const st = await H.API.get('/me/openfinance/status'); const pg = H.$('#ofPg'); if (!pg) return;
    if (!st.disponivel) { location.hash = '#/inicio'; return; }
    pg.innerHTML = `<div class="card"><h3 style="margin:0 0 8px">Termo de consentimento (LGPD)</h3><ul class="sm" style="padding-left:18px;line-height:1.55;margin:0">${st.consentimento.texto.map((t) => `<li style="margin-bottom:6px">${H.esc(t)}</li>`).join('')}</ul>
      <label class="li" style="cursor:pointer"><input type="checkbox" id="ofOk" style="width:20px;height:20px;accent-color:var(--y)"><span class="t"><b>Li e autorizo</b><small>Versão ${H.esc(st.consentimento.versao)}</small></span></label></div>
      <button class="btn" id="ofGo" style="margin-top:12px" disabled>Continuar para a Pluggy</button><p class="sm mut" id="ofMsg" style="text-align:center">A conexão é feita pela Pluggy, em ambiente seguro. Escolha seu banco e autorize por lá.</p>`;
    H.$('#ofOk').onchange = (e) => (H.$('#ofGo').disabled = !e.target.checked);
    H.$('#ofGo').onclick = async () => {
      const b = H.$('#ofGo'); b.disabled = true;
      try {
        const r = await H.API.post('/me/openfinance/connect-token', { consentimento: true, versao: st.consentimento.versao, tema: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' });
        await sdk();
        let pc = null;
        pc = new window.PluggyConnect({
          connectToken: r.connectToken, includeSandbox: !!r.sandbox, language: 'pt', theme: r.tema, countries: ['BR'], ...(r.widgetUrl ? { url: r.widgetUrl } : {}),
          onSuccess: async (d) => {
            const id = d && d.item && d.item.id; if (!id) return;
            try { await H.API.post('/me/openfinance/conexoes', { itemId: id }); try { await pc.destroy(); } catch (_) {} H.toast('Banco conectado'); location.hash = '#/openfinance'; }
            catch (e) { H.infoSheet('Conectar banco', e.message); }
          },
          onError: (e) => H.toast((e && e.message) || 'Não foi possível conectar. Tente novamente.'),
          onClose: () => { const x = H.$('#ofGo'); if (x) x.disabled = false; },
        });
        await pc.init();
      } catch (e) { b.disabled = false; H.infoSheet('Conectar banco', e.message); }
    };
  }
  // SDK oficial do Pluggy Connect (MIT), servido pela própria MineraBank e carregado só nesta tela
  let sdkP = null;
  const sdk = () => window.PluggyConnect ? Promise.resolve() : (sdkP ||= new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'js/vendor/pluggy-connect-2.14.2.min.js'; s.onload = ok; s.onerror = () => { sdkP = null; ko(new Error('Sem conexão. Tente novamente.')); }; document.head.appendChild(s); }));

  function conta(H) { return H.tb('Movimentações') + `<div class="pg" id="ofPg"><div style="min-height:40vh;display:grid;place-items:center" class="mut sm">Carregando…</div></div>`; }
  async function contaMount(H, id) {
    const pg = H.$('#ofPg'); let dias = 30;
    const load = async () => {
      const de = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
      const r = await H.API.get(`/me/openfinance/contas/${encodeURIComponent(id)}/transacoes?de=${de}`);
      if (!H.$('#ofPg')) return;
      const a = r.conta; const grp = {};
      r.transacoes.forEach((t) => { const d = new Date(t.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }); (grp[d] ||= []).push(t); });
      pg.innerHTML = `<div class="card"><small class="mut">${H.esc(a.banco)} · ${tipoLbl(a)}${a.numero ? ' · ' + H.esc(a.numero) : ''}</small>${a.tipo === 'CREDIT' ? '<small class="mut" style="display:block">Fatura atual</small>' : ''}<div class="b" style="font-size:24px">${V(H, a.tipo === 'CREDIT' ? Math.abs(a.saldoCents) : a.saldoCents)}</div>${a.limiteDisponivelCents !== undefined ? `<small class="mut">Limite disponível ${V(H, a.limiteDisponivelCents)}</small>` : ''}</div>
        <div class="chips" style="display:flex;gap:8px;margin:14px 0 0">${[7, 30, 90].map((n) => `<button class="tag ${n === dias ? 'ok' : ''}" data-ofd="${n}" style="border:0">${n} dias</button>`).join('')}</div>
        ${Object.keys(grp).length ? Object.entries(grp).map(([d, ts]) => `<div class="day">${H.esc(d)}</div><div class="card" style="padding:4px 16px">${ts.map((t) => H.li('cash', H.esc(t.descricao), H.esc(t.categoria || (t.tipo === 'CREDIT' ? 'Entrada' : 'Saída')), `<span class="right"><b class="${t.valorCents > 0 ? 'pos' : 'neg'}">${localStorage.getItem('mb_hide') === '1' ? '••••' : (t.valorCents > 0 ? '+ ' : '- ') + H.brl(Math.abs(t.valorCents) / 100)}</b></span>`)).join('')}</div>`).join('') : `<div class="card" style="margin-top:12px">${H.empty('cash', 'Nenhuma movimentação no período')}</div>`}`;
      H.$$('[data-ofd]').forEach((b) => (b.onclick = () => { dias = Number(b.dataset.ofd); load().catch((e) => H.toast(e.message)); }));
    };
    await load();
  }

  const ROUTES = [[/^openfinance$/, lista, listaMount], [/^openfinance\/conectar$/, conectar, conectarMount], [/^openfinance\/conta\/([\w-]{1,64})$/, conta, contaMount]];
  const base = window.MBX;
  window.MBX = { ...base,
    match(r) { for (const [re, html, mount] of ROUTES) { const m = r.match(re); if (m) return { tab: 'inicio', html: (H) => html(H, m[1]), mount: (H) => Promise.resolve(mount(H, m[1])).catch((e) => H.toast(e.message)) }; } return base.match(r); },
  };
})();
