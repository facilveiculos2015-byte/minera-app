const SUPABASE_URL = 'https://eelbuaxgfzvxosatwcxk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbGJ1YXhnZnp2eG9zYXR3Y3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjI2MTAsImV4cCI6MjEwNDAzODYxMH0.ecoI2ClOQY9VKTcaMc1NoFTTvo0L-sadqfqHyDwxDTA';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Base do app derivada em tempo de execução: '/' em https://minerapara.com.br (e em servidor local
 * na raiz) e '/minera-app/' se ainda estiver no project site do GitHub Pages. Assim os dois hosts
 * funcionam durante a transição de domínio. */
const APP_ROOT = (function () {
    try { return /^\/minera-app(\/|$)/.test(location.pathname) ? '/minera-app/' : '/'; } catch (e) { return '/'; }
})();
/** URL pública canônica (links de convite/compartilhamento, og:). */
const APP_PUBLIC_URL = 'https://minerapara.com.br/';
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

/** Google Maps (opcional). Mapa padrão é Leaflet+OSM gratuito — chave vazia NÃO bloqueia.
 *  Veja docs/google-maps-key.md. Alternativa: window.MINERA_GOOGLE_MAPS_KEY. */
const GOOGLE_MAPS_API_KEY = '';
