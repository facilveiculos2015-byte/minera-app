/* Utilitários de UI compartilhados — MineraBank */
(function () {
  'use strict';
  const P = {
    pix: '<path d="M12 3l4 4-4 4-4-4zM12 13l4 4-4 4-4-4zM3 12l4-4 4 4-4 4zM13 12l4-4 4 4-4 4z"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
    chart: '<path d="M3 20h18M6 16l4-5 3 3 5-7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.6 7.6C3.9 9.4 2 12 2 12s4 7 10 7a10 10 0 0 0 4.2-.9"/>',
    barcode: '<path d="M3 5v14M6 5v14M9 5v14M13 5v14M15 5v14M18 5v14M21 5v14"/>',
    send: '<path d="M4 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-4M14 21v-3"/>',
    loan: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
    piggy: '<path d="M4 11a7 6 0 0 1 13-2h2l1 3-2 1v3l-2 1v2h-3v-2H9v2H6v-3a6 6 0 0 1-2-5z"/><circle cx="14" cy="11" r=".8"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
    gauge: '<path d="M4 18a9 9 0 1 1 16 0M12 13l4-4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.7-1.5"/>',
    wifi: '<path d="M8.5 16.5a5 5 0 0 1 0-9M5.5 19.5a9 9 0 0 1 0-15M12 13v-2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h0a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
    doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    finger: '<path d="M12 11v4M8 9.5a4 4 0 0 1 8 0V14a8 8 0 0 1-1 4M5 12a7 7 0 0 1 12-5.5M5 16c.5 2 1.5 3.5 2.5 4.5M12 18.5c-.3 1-.7 2-1.3 2.5"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/>',
    device: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-1v-5z"/>',
    store: '<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11l2-8H6.2"/>',
    car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 11h10"/>',
    food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 3-3 6s1 3 3 3v9"/>',
    heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    mine: '<path d="M3 20l6-10 4 6 3-4 5 8z"/><circle cx="17" cy="6" r="2"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    mp: '<circle cx="12" cy="12" r="9"/><path d="M7 13c2-2 3 1 5-1s3 1 5-1"/>',
  };
  const ic = (n, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  let tt;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2400);
  }
  function sheet(html, onMount) {
    closeSheet(true);
    const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'ov';
    const sh = document.createElement('div'); sh.className = 'sh'; sh.id = 'sh'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = '<div class="grab"></div>' + html;
    document.body.append(ov, sh);
    requestAnimationFrame(() => { ov.classList.add('on'); sh.classList.add('on'); });
    ov.onclick = () => closeSheet();
    if (onMount) onMount(sh);
    return sh;
  }
  function closeSheet(now) {
    const ov = $('#ov'), sh = $('#sh'); if (!sh && !ov) return;
    if (ov) ov.id = ''; if (sh) sh.id = '';
    if (now) { ov?.remove(); sh?.remove(); return; }
    ov?.classList.remove('on'); sh?.classList.remove('on'); setTimeout(() => { ov?.remove(); sh?.remove(); }, 280);
  }
  function confirmSheet(title, text, okLabel, onOk) {
    sheet(`<h3>${title}</h3><p class="mut">${text}</p><button class="btn" id="cfOk">${okLabel}</button><button class="btn ol" id="cfNo">Cancelar</button>`, (s) => {
      $('#cfNo', s).onclick = () => closeSheet(); $('#cfOk', s).onclick = () => { closeSheet(); onOk(); };
    });
  }
  // QR ilustrativo determinístico (NÃO é um QR válido)
  function fakeQR(seed) {
    let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const n = 25; let r = '';
    const fin = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#111"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#111"/>`;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16)) continue;
      h = (h * 1103515245 + 12345) >>> 0; if ((h >>> 16) & 1) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="#111"/>`;
    }
    return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR Code ilustrativo">${r}${fin(0, 0)}${fin(18, 0)}${fin(0, 18)}</svg>`;
  }
  function theme(t) { if (t) localStorage.setItem('mb_theme', t); document.documentElement.dataset.theme = localStorage.getItem('mb_theme') || 'light'; }
  theme();
  async function share(text) {
    try { if (navigator.share) { await navigator.share({ title: 'Comprovante MineraBank', text }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); toast('Comprovante copiado'); } catch (e) { toast('Compartilhamento indisponível'); }
  }
  async function copy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg || 'Copiado'); } catch (e) { toast('Não foi possível copiar'); } }
  /* Código de verificação (SMS/e-mail): 6 dígitos, reenviar após 30s */
  function otpSheet({ title, destino, submit, resend, extra }) {
    let left = 30, timer;
    sheet(`<h3>${title || 'Digite o código'}</h3><p class="mut" style="margin-top:0">Enviamos um código de 6 dígitos para <b>${esc(destino || 'seu celular')}</b>. Ele vale por 5 minutos.</p>
      <label class="fl"><span>Código</span><input class="in" id="otpC" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="letter-spacing:10px;font-size:22px;text-align:center;font-weight:800"></label>${extra || ''}
      <p id="otpE" role="alert" class="sm" style="color:var(--bad);min-height:18px;margin:0 0 6px"></p><button class="btn" id="otpOk">Confirmar</button>${resend ? '<button class="btn ol" id="otpR" disabled>Reenviar código em 30s</button>' : ''}`, (s) => {
      const inp = $('#otpC', s); setTimeout(() => inp.focus(), 350);
      inp.oninput = () => (inp.value = inp.value.replace(/\D/g, '').slice(0, 6));
      const ok = $('#otpOk', s);
      ok.onclick = () => {
        if (inp.value.length !== 6) return ($('#otpE', s).textContent = 'Digite os 6 dígitos.');
        ok.disabled = true;
        Promise.resolve(submit(inp.value, s)).then(() => clearInterval(timer), (e) => { ok.disabled = false; $('#otpE', s).textContent = e.message; if (/expirad|esgotad|Solicite um novo/i.test(e.message)) inp.value = ''; });
      };
      if (resend) {
        const r = $('#otpR', s);
        const tick = () => { left--; if (left <= 0) { clearInterval(timer); r.disabled = false; r.textContent = 'Reenviar código'; } else r.textContent = `Reenviar código em ${left}s`; };
        timer = setInterval(tick, 1000);
        r.onclick = () => { r.disabled = true; Promise.resolve(resend()).then(() => { toast('Novo código enviado'); left = 30; timer = setInterval(tick, 1000); }, (e) => { r.disabled = false; $('#otpE', s).textContent = e.message; }); };
      }
    });
  }
  /* Passkeys (WebAuthn): conversão base64url <-> ArrayBuffer */
  const b64u = { dec: (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer; },
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
  const passkey = {
    supported: () => !!(window.PublicKeyCredential && navigator.credentials),
    async create(o) {
      const pk = { ...o, challenge: b64u.dec(o.challenge), user: { ...o.user, id: b64u.dec(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64u.dec(c.id) })) };
      const c = await navigator.credentials.create({ publicKey: pk });
      return { id: c.id, rawId: b64u.enc(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment || undefined,
        response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), attestationObject: b64u.enc(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] } };
    },
    async get(o) {
      const pk = { ...o, challenge: b64u.dec(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64u.dec(c.id) })) };
      const c = await navigator.credentials.get({ publicKey: pk });
      return { id: c.id, rawId: b64u.enc(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment || undefined,
        response: { clientDataJSON: b64u.enc(c.response.clientDataJSON), authenticatorData: b64u.enc(c.response.authenticatorData), signature: b64u.enc(c.response.signature), userHandle: c.response.userHandle ? b64u.enc(c.response.userHandle) : undefined } };
    },
  };
  /* Câmera (getUserMedia) → JPEG; rejeita para cair no seletor de arquivo */
  function camera(facing, title, fileLabel = 'Escolher arquivo') {
    return new Promise((resolve, reject) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return reject(new Error('sem câmera'));
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false }).then((stream) => {
        const stop = () => stream.getTracks().forEach((t) => t.stop());
        sheet(`<h3>${title}</h3><div style="position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:${facing === 'user' ? '3/4' : '4/3'}"><video id="cv" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video></div><button class="btn" id="shot" style="margin-top:12px">${ic('cam')} Capturar</button><button class="btn ol" id="file">${fileLabel}</button>`, (s) => {
          const v = $('#cv', s); v.srcObject = stream;
          $('#shot', s).onclick = () => { const c = document.createElement('canvas'); c.width = v.videoWidth || 640; c.height = v.videoHeight || 480; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob((b) => { stop(); closeSheet(); b ? resolve(b) : reject(new Error('falha')); }, 'image/jpeg', 0.88); };
          $('#file', s).onclick = () => { stop(); closeSheet(); reject(new Error('arquivo')); };
          $('#ov').addEventListener('click', stop);
        });
      }, reject);
    });
  }
  /* Envio binário autenticado (KYC, comprovante) */
  async function upload(path, blob) {
    const r = await fetch((window.MB_API_BASE || '') + path, { method: 'PUT', headers: { Authorization: 'Bearer ' + sessionStorage.getItem('mb_token'), 'X-Device-Id': localStorage.getItem('mb_dev') || '', 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    const d = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(d.message || 'Falha no envio.'); e.code = d.error; throw e; } return d;
  }
  window.UI = { ic, brl, esc, $, $$, toast, sheet, closeSheet, confirmSheet, fakeQR, theme, share, copy, otpSheet, passkey, camera, upload };
})();
