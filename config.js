/* ===================== AMBIENTE (produção × teste) =====================
 * O MESMO código roda em produção (https://minerapara.com.br) e no ambiente de teste
 * (GitHub Pages padrão / Netlify). O ambiente é decidido pelo hostname:
 *   - minerapara.com.br / www.minerapara.com.br  → 'producao' (sem faixa, banco de produção)
 *   - qualquer outro host (github.io, netlify.app, localhost…) → 'teste' (faixa "AMBIENTE DE TESTE")
 * Para trocar o banco do TESTE edite só a linha MINERA_DB.teste abaixo (url + anon key).
 */
const MINERA_HOSTS_PRODUCAO = ['minerapara.com.br', 'www.minerapara.com.br'];
const MINERA_DB = {
    producao: {
        url: 'https://eelbuaxgfzvxosatwcxk.supabase.co',
        anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbGJ1YXhnZnp2eG9zYXR3Y3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjI2MTAsImV4cCI6MjEwNDAzODYxMH0.ecoI2ClOQY9VKTcaMc1NoFTTvo0L-sadqfqHyDwxDTA'
    },
    // Banco do TESTE (projeto Supabase 'minera-teste'). Para voltar a usar a produção no teste: teste: null
    teste: { url: 'https://ldzefbwdghqiudafqjar.supabase.co', anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkemVmYndkZ2hxaXVkYWZxamFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMDAxMTMsImV4cCI6MjEwNjU3NjExM30.7Fcc_mExeItmsSi5iKZzYkPpMYuSmgH-xnpmn9xEGUA' }
};
const MINERA_AMBIENTE = (function () {
    try { return MINERA_HOSTS_PRODUCAO.indexOf(String(location.hostname).toLowerCase()) >= 0 ? 'producao' : 'teste'; }
    catch (e) { return 'producao'; }
})();
const MINERA_TESTE = MINERA_AMBIENTE === 'teste';
/** Superapp DESLIGADO: o teste é igual à produção (código do superapp guardado no branch superapp-fase1). */
const MINERA_SUPERAPP = false;
const MINERA_DB_ATUAL = (MINERA_TESTE && MINERA_DB.teste) ? MINERA_DB.teste : MINERA_DB.producao;
const MINERA_DB_COMPARTILHADO = MINERA_TESTE && MINERA_DB_ATUAL === MINERA_DB.producao;

const SUPABASE_URL = MINERA_DB_ATUAL.url;
const SUPABASE_ANON_KEY = MINERA_DB_ATUAL.anon;
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Base do app derivada em tempo de execução a partir do endereço deste config.js:
 * '/' em https://minerapara.com.br (e Netlify/servidor local na raiz), '/minera-app/' no antigo
 * project site, '/minerio-direto-teste/' no teste do GitHub Pages — qualquer subpasta funciona. */
const APP_ROOT = (function () {
    try {
        const cs = document.currentScript;
        if (cs && cs.src && /\/config\.js(\?|$)/.test(cs.src)) {
            const u = new URL('./', cs.src);
            if (u.origin === location.origin) return u.pathname;
        }
    } catch (e) { /* fallback abaixo */ }
    try { return /^\/minera-app(\/|$)/.test(location.pathname) ? '/minera-app/' : '/'; } catch (e) { return '/'; }
})();
/** URL pública canônica (links de convite/compartilhamento). No teste usa o próprio endereço do teste. */
const APP_PUBLIC_URL = MINERA_TESTE ? (location.origin + APP_ROOT) : 'https://minerapara.com.br/';
function irPara(pagina) {
    let p = String(pagina || '').replace(/^\.\//, '').replace(/^\//, '');
    // Chat Minera (app só-chat em /chat/): o login fica dentro do /chat/ e, depois de entrar, volta para o chat
    if (window.MINERA_CHAT_APP === true) {
        if (/^entrar\.html/i.test(p)) p = 'chat/' + p;
        else if (/^(inicio|admin|chat|tutorial)\.html/i.test(p)) p = 'chat/';
    }
    // Gestor Minera (app só-gestor em /gestor/): mesmo login do site, dentro do /gestor/, e depois volta para o gestor
    if (window.MINERA_GESTOR_APP === true) {
        if (/^entrar\.html/i.test(p)) p = 'gestor/' + p;
        else if (/^(inicio|admin|gestor|tutorial)\.html/i.test(p)) p = 'gestor/';
    }
    window.location.replace(APP_ROOT + p);
}

/* Faixa "AMBIENTE DE TESTE" — só fora de produção. */
(function () {
    if (!MINERA_TESTE) return;
    try { document.documentElement.classList.add('minera-ambiente-teste'); } catch (e) { /* ignora */ }
    function faixa() {
        if (!document.body || document.getElementById('minera-faixa-teste')) return;
        const st = document.createElement('style');
        st.textContent =
            '#minera-faixa-teste{position:fixed;top:0;left:0;right:0;z-index:2147483000;pointer-events:none;' +
            'background:repeating-linear-gradient(45deg,#b91c1c,#b91c1c 10px,#991b1b 10px,#991b1b 20px);color:#fff;' +
            'font:700 11px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.04em;text-align:center;' +
            'padding:calc(env(safe-area-inset-top,0px) + 3px) 6px 3px;box-shadow:0 1px 4px rgba(0,0,0,.35);opacity:.92;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '#minera-faixa-teste small{font-weight:600;opacity:.9;letter-spacing:0}';
        document.head.appendChild(st);
        const d = document.createElement('div');
        d.id = 'minera-faixa-teste';
        d.setAttribute('role', 'status');
        d.innerHTML = 'AMBIENTE DE TESTE — Minério Direto' +
            (MINERA_DB_COMPARTILHADO ? ' <small>· banco REAL</small>' : ' <small>· banco de teste</small>');
        document.body.appendChild(d);
    }
    if (document.body) faixa();
    else document.addEventListener('DOMContentLoaded', faixa);
})();

/** Google Maps (opcional). Mapa padrão é Leaflet+OSM gratuito — chave vazia NÃO bloqueia.
 *  Veja docs/google-maps-key.md. Alternativa: window.MINERA_GOOGLE_MAPS_KEY. */
const GOOGLE_MAPS_API_KEY = '';
