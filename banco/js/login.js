(function () {
  'use strict';
  const { ic, $, toast, sheet, closeSheet, otpSheet, passkey, camera } = window.UI;
  const API = window.API;
  if (API.token()) { location.replace('index.html'); return; }
  const root = $('#auth');
  const dig = (s) => s.replace(/\D/g, '');
  const maskCpf = (v) => dig(v).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  const celDig = (v) => { let d = dig(v); if (d.startsWith('00')) d = d.slice(2); if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); return d.slice(0, 11); };
  const maskCel = (v) => { const d = celDig(v); return d.length <= 2 ? d : d.length <= 6 ? d.slice(0, 2) + ' ' + d.slice(2) : d.length <= 10 ? d.slice(0, 2) + ' ' + d.slice(2, d.length - 4) + '-' + d.slice(-4) : d.slice(0, 2) + ' ' + d.slice(2, 7) + '-' + d.slice(7); };
  const celOk = (d) => /^[1-9][1-9]\d{8,9}$/.test(d) && (d.length === 10 || d[2] === '9');
  const cpfOk = (c) => { if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false; const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); return (s * 10) % 11 % 10; }; return dv(9) === +c[9] && dv(10) === +c[10]; };
  // aceita AAAA-MM-DD (input date) ou DD/MM/AAAA (navegadores sem seletor de data); devolve ISO ou ''
  const isoDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) || ((x) => x && [x[0], x[3], x[2], x[1]])(/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)); if (!m) return ''; const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
  const maskCep = (v) => dig(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
  const logo = '<div class="logo"><i>' + ic('mine') + '</i><span>Minera<b>Bank</b></span></div>';
  const enter = (r) => { sessionStorage.setItem('mb_token', r.token); sessionStorage.setItem('mb_user', r.primeiroNome); location.href = 'index.html'; };
  const busy = (btn, on, label) => { btn.disabled = on; btn.innerHTML = on ? '<span class="lring sm" style="width:22px;height:22px" aria-label="Carregando"></span>' : label; };

  function login() {
    root.innerHTML = `${logo}<h1>Olá! Acesse sua conta</h1><p style="color:#B8B8C0;margin:0 0 22px">Banco digital com Pix, cartão e investimentos.</p>
    <form id="f" novalidate>
      <label class="fl"><span>CPF</span><input class="in" id="cpf" inputmode="numeric" autocomplete="username" placeholder="000.000.000-00"></label>
      <label class="fl"><span>Senha</span><input class="in" id="pw" type="password" autocomplete="current-password" placeholder="Sua senha de acesso"></label>
      <p id="err" role="alert" style="color:#FF8A8A;min-height:20px;margin:0 0 6px;font-size:13px"></p>
      <button class="btn">Entrar</button>
    </form>
    <button class="btn ol" id="bio" style="margin-top:10px">${ic('finger')} Entrar com biometria</button>
    <div style="display:flex;justify-content:space-between;margin-top:8px"><button class="lnk" id="esq">Esqueci a senha</button><button class="lnk" id="abrir">Abrir conta grátis</button></div>
    <p style="margin-top:auto;color:#77777F;font-size:12px;text-align:center">Conexão protegida · seus dados são criptografados</p>`;
    $('#cpf').oninput = (e) => (e.target.value = maskCpf(e.target.value));
    $('#f').onsubmit = (e) => {
      e.preventDefault();
      if (dig($('#cpf').value).length !== 11) return ($('#err').textContent = 'Informe um CPF com 11 dígitos.');
      if ($('#pw').value.length < 6) return ($('#err').textContent = 'A senha deve ter ao menos 6 caracteres.');
      const b = $('#f button'); busy(b, true);
      const cpf = dig($('#cpf').value), senha = $('#pw').value;
      API.post('/auth/login', { cpf, senha }).then((r) => {
        if (!r.otpRequired) return enter(r);
        busy(b, false, 'Entrar');
        let otpId = r.otpId;
        otpSheet({ title: 'Novo dispositivo', destino: r.destino, submit: (code) => API.post('/auth/login/otp', { otpId, code }).then(enter),
          resend: () => API.post('/auth/login', { cpf, senha }).then((x) => { otpId = x.otpId; }) });
      }, (x) => { busy(b, false, 'Entrar'); $('#err').textContent = x.message; });
    };
    const bioInfo = (msg) => sheet(`<div style="text-align:center"><div style="width:84px;height:84px;margin:6px auto 12px;border-radius:50%;background:var(--y-s);display:grid;place-items:center;color:var(--y-d)">${ic('finger').replace('<svg', '<svg width="44" height="44"')}</div><h3>Biometria</h3><p class="mut">${window.UI.esc(msg)}</p><button class="btn" id="no">Entrar com senha</button></div>`, (s) => { $('#no', s).onclick = () => { closeSheet(); $('#pw').focus(); }; });
    $('#bio').onclick = async () => {
      if (!passkey.supported()) return bioInfo('Este aparelho não oferece biometria no navegador. Entre com CPF e senha.');
      const b = $('#bio'); b.disabled = true;
      try {
        const cpf = dig($('#cpf').value);
        const o = await API.post('/auth/webauthn/options', cpf.length === 11 ? { cpf } : {});
        const response = await passkey.get(o.options);
        const r = await API.post('/auth/webauthn/verify', { challengeId: o.challengeId, response });
        enter(r);
      } catch (x) {
        b.disabled = false;
        if (x && x.name === 'NotAllowedError') return bioInfo('Biometria cancelada ou não encontrada neste aparelho. No primeiro acesso, entre com CPF e senha e ative a biometria em Perfil → Segurança.');
        bioInfo(x.message || 'Não foi possível usar a biometria. Entre com CPF e senha.');
      }
    };
    $('#esq').onclick = () => sheet(`<h3>Recuperar senha</h3><p class="mut">Enviaremos um código para o celular cadastrado.</p><label class="fl"><span>CPF</span><input class="in" id="rc" inputmode="numeric" value="${window.UI.esc($('#cpf').value)}"></label><button class="btn" id="go">Enviar código</button>`, (s) => {
      $('#rc', s).oninput = (e) => (e.target.value = maskCpf(e.target.value));
      $('#go', s).onclick = () => {
        const cpf = dig($('#rc', s).value); if (cpf.length !== 11) return toast('CPF inválido: confira os 11 dígitos.');
        const b = $('#go', s); b.disabled = true;
        API.post('/auth/forgot', { cpf }).then((r) => {
          let otpId = r.otpId;
          otpSheet({ title: 'Criar nova senha', destino: r.destino,
            extra: '<label class="fl"><span>Nova senha (mín. 6 caracteres)</span><input class="in" id="np1" type="password" autocomplete="new-password"></label><label class="fl"><span>Confirmar nova senha</span><input class="in" id="np2" type="password" autocomplete="new-password"></label>',
            submit: (code, sh) => {
              const n1 = $('#np1', sh).value, n2 = $('#np2', sh).value;
              if (n1.length < 6) return Promise.reject(new Error('A nova senha deve ter ao menos 6 caracteres.'));
              if (n1 !== n2) return Promise.reject(new Error('As senhas não conferem.'));
              return API.post('/auth/reset', { otpId, code, nova: n1 }).then((x) => { closeSheet(); toast(x.message || 'Senha alterada'); $('#cpf').value = maskCpf(cpf); $('#pw').value = ''; $('#pw').focus(); });
            },
            resend: () => API.post('/auth/forgot', { cpf }).then((x) => { otpId = x.otpId; }) });
        }, (x) => { b.disabled = false; toast(x.message); });
      };
    });
    $('#abrir').onclick = () => onboarding(0, {});
  }

  const LEGAL = {
    termos: ['Termos de Uso', 'A conta MineraBank é uma conta de pagamento pré-paga. Para usá-la você precisa ser maior de 18 anos, manter seus dados atualizados e proteger suas senhas. Operações como Pix, transferências, cartão e crédito podem depender de instituições parceiras autorizadas pelo Banco Central e só são liberadas após a verificação da sua identidade. Podemos limitar ou bloquear operações para proteger você contra fraudes. Você pode encerrar a conta quando quiser, em Perfil → Encerrar conta.'],
    privacidade: ['Política de Privacidade', 'Tratamos seus dados (nome, CPF, contato, endereço, documentos, selfie, dados do aparelho e transações) para abrir e manter sua conta, prevenir fraudes e lavagem de dinheiro e cumprir obrigações legais (LGPD, art. 7º, II e V). Documentos e selfie ficam cifrados. Ofertas personalizadas e compartilhamento com parceiros só acontecem com seu consentimento, que pode ser revogado a qualquer momento. Você pode baixar seus dados ou pedir a exclusão em Perfil → Privacidade; dados exigidos por lei são mantidos pelo prazo legal.'],
  };
  const legal = (k) => sheet(`<h3>${LEGAL[k][0]}</h3><p class="mut" style="line-height:1.55">${LEGAL[k][1]}</p><p class="mut sm">Versão 2026-10</p><button class="btn" id="okL">Fechar</button>`, (s) => ($('#okL', s).onclick = () => closeSheet()));
  const STEPS = ['Dados pessoais', 'Documento e selfie', 'Endereço', 'Senhas'];
  function onboarding(i, d) {
    const head = `<div class="row" style="margin-bottom:10px"><button class="back" id="bk" aria-label="Voltar" style="background:#1D1D22;color:#fff">${ic('left')}</button><span class="sp b">Abrir conta · ${i + 1}/4</span></div>
      <div class="steps">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><h1 style="margin-top:6px">${STEPS[i]}</h1>`;
    const bodies = [
      `<label class="fl"><span>Nome completo</span><input class="in" id="nome" value="${d.nome || ''}" autocomplete="name"></label>
       <label class="fl"><span>CPF</span><input class="in" id="cpf" inputmode="numeric" value="${d.cpf || ''}"></label>
       <label class="fl"><span>Data de nascimento</span><input class="in" id="nasc" type="date" value="${d.nasc || ''}"></label>
       <label class="fl"><span>Celular</span><input class="in" id="cel" inputmode="tel" autocomplete="tel-national" placeholder="94 99225-3569" value="${d.cel || ''}"></label>
       <label class="fl"><span>E-mail</span><input class="in" id="em" type="email" value="${d.em || ''}"></label>`,
      `<p style="color:#B8B8C0;margin-top:0">Precisamos confirmar que é você. Use boa iluminação e sem acessórios.</p>
       <p style="color:#B8B8C0;margin:0 0 8px;font-size:13px"><b style="color:#fff">Qual documento você vai enviar?</b></p>
       <div class="g2" style="margin-bottom:12px">${[['rg', 'RG (identidade)'], ['cnh', 'CNH']].map(([t, l]) => `<div class="ph" id="tipo_${t}" data-tipo="${t}" role="button" tabindex="0" aria-pressed="${d.docTipo === t}" style="background:#1D1D22;border-color:${d.docTipo === t ? '#F5C400' : '#3A3A42'};${d.docTipo === t ? 'border-style:solid;' : ''}color:#B8B8C0;height:90px"><div>${ic('doc').replace('<svg', '<svg width="24" height="24"')}<br><b>${l}</b></div></div>`).join('')}</div>
       ${d.docTipo === 'rg' ? `<input type="file" id="f_doc_frente" accept="image/*" capture="environment" hidden><input type="file" id="f_doc_verso" accept="image/*" capture="environment" hidden><input type="file" id="f_selfie_doc" accept="image/*" capture="user" hidden>
       <div class="g2" style="margin-bottom:12px"><div class="ph" id="doc_frente" role="button" tabindex="0" style="background:#1D1D22;border-color:#3A3A42;color:#B8B8C0;height:130px"><div>${ic('doc').replace('<svg', '<svg width="28" height="28"')}<br><b>RG</b><br><small>Frente</small></div></div><div class="ph" id="doc_verso" role="button" tabindex="0" style="background:#1D1D22;border-color:#3A3A42;color:#B8B8C0;height:130px"><div>${ic('doc').replace('<svg', '<svg width="28" height="28"')}<br><b>RG</b><br><small>Verso</small></div></div></div>
       <div class="ph" id="selfie_doc" role="button" tabindex="0" style="background:#1D1D22;border-color:#3A3A42;color:#B8B8C0"><div>${ic('cam').replace('<svg', '<svg width="32" height="32"')}<br><b>Selfie segurando o documento</b><br><small>Toque para tirar a foto</small></div></div>`
       : d.docTipo === 'cnh' ? `<input type="file" id="f_cnh" accept="image/*,application/pdf" hidden><input type="file" id="f_selfie" accept="image/*" capture="user" hidden>
       <div class="ph" id="cnh" role="button" tabindex="0" style="background:#1D1D22;border-color:#3A3A42;color:#B8B8C0;height:130px;margin-bottom:12px"><div>${ic('doc').replace('<svg', '<svg width="28" height="28"')}<br><b>CNH</b><br><small>Foto, galeria ou PDF</small></div></div>
       <div class="ph" id="selfie" role="button" tabindex="0" style="background:#1D1D22;border-color:#3A3A42;color:#B8B8C0"><div>${ic('cam').replace('<svg', '<svg width="32" height="32"')}<br><b>Selfie</b><br><small>Toque para tirar a foto</small></div></div>` : ''}
       <p style="color:#77777F;font-size:12px;margin:10px 0 0">RG ou CNH. As imagens são enviadas cifradas e usadas só para verificar sua identidade.</p>`,
      `<label class="fl"><span>CEP</span><input class="in" id="cep" inputmode="numeric" autocomplete="postal-code" value="${d.cep || ''}" placeholder="66000-000"></label><p id="cepMsg" style="color:#77777F;font-size:12px;margin:-6px 0 10px;min-height:16px">Digite o CEP para preencher o endereço automaticamente.</p>
       <label class="fl"><span>Rua</span><input class="in" id="rua" value="${d.rua || ''}"></label><label class="fl"><span>Bairro</span><input class="in" id="bai" value="${d.bai || ''}"></label>
       <div class="g2"><label class="fl"><span>Número</span><input class="in" id="num" value="${d.num || ''}"></label><label class="fl"><span>Complemento</span><input class="in" id="comp" value="${d.comp || ''}"></label></div>
       <div class="g2"><label class="fl"><span>Cidade</span><input class="in" id="cid" value="${d.cid || ''}"></label><label class="fl"><span>UF</span><input class="in" id="uf" maxlength="2" value="${d.uf || ''}"></label></div>`,
      `<label class="fl"><span>Senha de acesso (mín. 6 caracteres)</span><input class="in" id="pw" type="password" autocomplete="new-password"></label>
       <label class="fl"><span>Senha de transação (4 dígitos)</span><input class="in" id="pin" type="password" inputmode="numeric" maxlength="4"></label>
       <label class="fl"><span>Senha do cartão (6 dígitos)</span><input class="in" id="pin6" type="password" inputmode="numeric" maxlength="6"></label>
       ${[['ac', 'Li e aceito os <a href="#" data-doc="termos" style="color:#F5C400">Termos de Uso</a>. <b style="color:#fff">(obrigatório)</b>'], ['ap', 'Li e aceito a <a href="#" data-doc="privacidade" style="color:#F5C400">Política de Privacidade</a> e o tratamento dos meus dados para abrir e manter a conta (LGPD). <b style="color:#fff">(obrigatório)</b>'], ['cMk', 'Quero receber ofertas personalizadas com base no meu uso. (opcional)'], ['cSh', 'Autorizo compartilhar meus dados com parceiros para ofertas de produtos. (opcional)']].map(([id, t]) => `<label class="row" style="font-size:13px;color:#B8B8C0;margin:6px 0 10px;align-items:flex-start;gap:10px"><input type="checkbox" id="${id}" style="width:20px;height:20px;flex:0 0 20px;accent-color:#F5C400;margin-top:1px"><span>${t}</span></label>`).join('')}
       <p style="color:#77777F;font-size:12px;margin:0 0 12px">Você pode mudar os opcionais quando quiser em Perfil → Privacidade. Registramos data e hora de cada aceite.</p>`,
    ];
    root.innerHTML = head + `<form id="f" novalidate>${bodies[i]}<p id="err" role="alert" style="color:#FF8A8A;min-height:20px;font-size:13px;margin:0 0 6px"></p><button class="btn">${i === 3 ? 'Criar minha conta' : 'Continuar'}</button></form>`;
    $('#bk').onclick = () => (i ? onboarding(i - 1, d) : login());
    root.querySelectorAll('[data-doc]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); legal(a.dataset.doc); }));
    const v = (id) => ($('#' + id) ? $('#' + id).value.trim() : '');
    if ($('#cpf')) $('#cpf').oninput = (e) => (e.target.value = maskCpf(e.target.value));
    if ($('#cel')) $('#cel').oninput = (e) => (e.target.value = maskCel(e.target.value));
    if ($('#cep')) {
      let last = '';
      $('#cep').oninput = (e) => {
        e.target.value = maskCep(e.target.value); const c = dig(e.target.value);
        if (c.length !== 8 || c === last) return; last = c;
        const m = $('#cepMsg'); m.style.color = '#B8B8C0'; m.textContent = 'Buscando endereço…';
        API.get('/auth/cep/' + c).then((a) => {
          if (dig($('#cep').value) !== c) return;
          [['rua', a.rua], ['bai', a.bairro], ['cid', a.cidade], ['uf', a.uf]].forEach(([id, val]) => { if (val) $('#' + id).value = val; });
          m.style.color = '#7FD49B'; m.textContent = 'Endereço encontrado. Confira e informe o número.'; $('#num').focus();
        }, (x) => { m.style.color = '#FFB86B'; m.textContent = x.message || 'Não foi possível buscar o CEP. Preencha manualmente.'; $('#rua').focus(); });
      };
    }
    const got = d.fotos || (d.fotos = {});
    root.querySelectorAll('[data-tipo]').forEach((el) => (el.onclick = () => { if (d.docTipo !== el.dataset.tipo) { d.docTipo = el.dataset.tipo; d.fotos = {}; } onboarding(i, d); }));
    const KYC_LBL = { doc_frente: 'RG — frente', doc_verso: 'RG — verso', selfie_doc: 'Selfie segurando o documento', selfie: 'Selfie' };
    ['doc_frente', 'doc_verso', 'selfie_doc', 'cnh', 'selfie'].forEach((k) => {
      const el = $('#' + k); if (!el) return;
      const mark = () => { el.style.borderColor = '#F5C400'; el.style.borderStyle = 'solid'; el.querySelector('small').textContent = 'Capturado ✓'; };
      if (got[k]) mark();
      const inp = $('#f_' + k);
      inp.onchange = () => { if (inp.files && inp.files[0]) { got[k] = inp.files[0]; mark(); } };
      // CNH: seletor nativo (câmera, galeria ou PDF). Demais: somente câmera.
      el.onclick = k === 'cnh' ? () => inp.click() : () => camera(k.startsWith('selfie') ? 'user' : 'environment', KYC_LBL[k], 'Usar a câmera do aparelho').then((blob) => { got[k] = blob; mark(); }, () => inp.click());
    });
    $('#f').onsubmit = (e) => {
      e.preventDefault(); const err = (m) => ($('#err').textContent = m);
      if (i === 0) {
        if (v('nome').split(' ').length < 2) return err('Informe nome e sobrenome.');
        if (!cpfOk(dig(v('cpf')))) return err('CPF inválido: confira os 11 dígitos.');
        if (!v('nasc')) return err('Informe a data de nascimento.');
        const nasc = isoDate(v('nasc')); if (!nasc) return err('Data de nascimento inválida: use dd/mm/aaaa.');
        const idade = (Date.now() - Date.parse(nasc)) / (365.25 * 864e5); if (idade < 18 || idade >= 120) return err('É preciso ter 18 anos ou mais para abrir a conta.');
        if (!celOk(celDig(v('cel')))) return err('Celular inválido: use DDD + número (ex.: 94 99225-3569).');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('em'))) return err('E-mail inválido: confira o endereço (ex.: nome@email.com).');
        Object.assign(d, { nome: v('nome'), cpf: v('cpf'), nasc, cel: maskCel(v('cel')), em: v('em') });
      }
      if (i === 1) { if (!d.docTipo) return err('Escolha o tipo de documento: RG ou CNH.'); if (d.docTipo === 'rg' && (!got.doc_frente || !got.doc_verso || !got.selfie_doc)) return err('Tire as fotos da frente e do verso do RG e a selfie segurando o documento.'); if (d.docTipo === 'cnh' && (!got.cnh || !got.selfie)) return err('Envie a CNH (foto ou PDF) e tire a selfie.'); }
      if (i === 2) {
        if (dig(v('cep')).length !== 8) return err('CEP inválido: use 8 dígitos (ex.: 66035-000).');
        if (!v('rua') || !v('num') || !v('cid') || v('uf').length !== 2) return err('Preencha o endereço completo.');
        Object.assign(d, { cep: v('cep'), rua: v('rua'), bai: v('bai'), num: v('num'), comp: v('comp'), cid: v('cid'), uf: v('uf').toUpperCase() });
      }
      if (i === 3) {
        if (v('pw').length < 6) return err('Senha de acesso muito curta.');
        if (!/^\d{4}$/.test(v('pin'))) return err('A senha de transação deve ter 4 dígitos.');
        if (!/^\d{6}$/.test(v('pin6'))) return err('A senha do cartão deve ter 6 dígitos.');
        if (/^(\d)\1+$/.test(v('pin')) || v('pin') === '1234') return err('Evite sequências ou dígitos repetidos.');
        if (!$('#ac').checked || !$('#ap').checked) return err('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
        const b = $('#f button'); busy(b, true);
        const uploadKyc = async (token) => { for (const k of (d.docTipo === 'cnh' ? ['cnh', 'selfie'] : ['doc_frente', 'doc_verso', 'selfie_doc'])) { const f = d.fotos[k]; if (!f) continue; const r = await fetch((window.MB_API_BASE || '') + '/me/kyc/' + k + '?tipo=' + d.docTipo, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': f.type || 'image/jpeg' }, body: f }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'Falha ao enviar documentos.'); } };
        API.post('/auth/register', { nome: d.nome, cpf: dig(d.cpf), nascimento: d.nasc, celular: celDig(d.cel), email: d.em, endereco: { cep: d.cep, rua: d.rua, numero: d.num, complemento: d.comp || '', bairro: d.bai || '', cidade: d.cid, uf: d.uf }, senha: v('pw'), pin: v('pin'), pinCartao: v('pin6'), consentimentos: { termos: true, privacidade: true, marketing: $('#cMk').checked, compartilhamento: $('#cSh').checked } }).then(async (r) => {
          let kycMsg = 'Documentos enviados. Vamos verificar sua identidade; Pix, transferências e cartão são liberados assim que a verificação for aprovada.';
          try { await uploadKyc(r.token); } catch (x) { kycMsg = 'Não foi possível enviar os documentos agora (' + x.message + '). Você poderá reenviar depois.'; }
          root.innerHTML = `${logo}<div style="margin:auto 0;text-align:center"><div style="width:86px;height:86px;border-radius:50%;background:#F5C400;color:#111;display:grid;place-items:center;margin:0 auto 18px">${ic('check').replace('<svg', '<svg width="44" height="44"')}</div><h1 style="margin:0 0 8px">Conta criada</h1><p style="color:#B8B8C0">Bem-vindo(a), ${window.UI.esc(r.primeiroNome)}! Sua conta está em análise; você já pode acessar o app.</p><p style="color:#77777F;font-size:13px">${window.UI.esc(kycMsg)}</p></div><button class="btn" id="go">Acessar minha conta</button>`;
          $('#go').onclick = () => enter(r);
        }, (x) => { busy(b, false, 'Criar minha conta'); err(x.message); });
        return;
      }
      onboarding(i + 1, d);
    };
  }
  login();
})();
