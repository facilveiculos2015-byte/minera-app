const SUPABASE_URL = 'https://eelbuaxgfzvxosatwcxk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbGJ1YXhnZnp2eG9zYXR3Y3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjI2MTAsImV4cCI6MjEwNDAzODYxMH0.ecoI2ClOQY9VKTcaMc1NoFTTvo0L-sadqfqHyDwxDTA';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const APP_ROOT = '/minera-app/';
function irPara(pagina) {
    const p = String(pagina || '').replace(/^\.\//, '').replace(/^\//, '');
    window.location.replace(APP_ROOT + p);
}

/** Google Maps (opcional). Mapa padrão é Leaflet+OSM gratuito — chave vazia NÃO bloqueia.
 *  Veja docs/google-maps-key.md. Alternativa: window.MINERA_GOOGLE_MAPS_KEY. */
const GOOGLE_MAPS_API_KEY = '';
