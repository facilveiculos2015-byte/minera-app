/* Cliente da API MineraBank (mesma origem por padrão; ajuste window.MB_API_BASE se servir o web separado). */
(function () {
  'use strict';
  const BASE = window.MB_API_BASE || '';
  const tok = () => sessionStorage.getItem('mb_token');
  // Identificador do aparelho (para reconhecer dispositivos e alertar acessos novos)
  const dev = () => { let d = localStorage.getItem('mb_dev'); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('mb_dev', d); } return d; };
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev(), ...(tok() ? { Authorization: 'Bearer ' + tok() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { const err = new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.'); err.status = 0; throw err; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path.startsWith('/me')) { sessionStorage.removeItem('mb_token'); location.replace('login.html'); }
    if (!res.ok) { const err = new Error(data.message || 'Não foi possível concluir a operação.'); err.status = res.status; err.code = data.error; err.data = data; throw err; }
    return data;
  }
  window.API = { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b || {}), del: (p) => call('DELETE', p), token: tok, device: dev };
})();
