// Minera Pará — Edge Function "turn-credenciais" (ligação de voz, SQL 63).
// Entrega ao app a lista de servidores ICE (STUN + TURN) com credencial TURN
// CURTA, gerada aqui no servidor. O segredo do TURN nunca vai para o navegador.
//
// Segurança:
//  - Verify JWT LIGADO (padrão) + confere o usuário de novo (auth.getUser).
//  - Só entrega TURN para quem é participante de uma ligação TOCANDO/ATENDIDA
//    (consulta feita com o JWT do próprio usuário → o RLS da tabela chamadas decide).
//  - Credencial expira em TURN_TTL segundos (padrão 7200 = 2 h; mínimo 600, máximo 14400).
//  - CORS só para os endereços do app. Resposta com Cache-Control: no-store.
//
// Provedor (o primeiro configurado vence; sem nenhum → só STUN público, ligação
// funciona na maioria das redes, mas pode falhar em 4G/CGNAT/Wi-Fi corporativo):
//  1) Cloudflare Realtime TURN (recomendado):  CF_TURN_KEY_ID, CF_TURN_API_TOKEN
//  2) coturn próprio (REST "use-auth-secret"):  TURN_SHARED_SECRET, TURN_URLS
//     (ex.: "turn:turn.minerapara.com.br:3478?transport=udp,turns:turn.minerapara.com.br:443?transport=tcp")
// Opcional: TURN_TTL, CHAMADA_ORIGENS (lista extra de origens separadas por vírgula).
// Deploy: supabase functions deploy turn-credenciais   (com Verify JWT ligado)
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CF_KEY_ID = Deno.env.get("CF_TURN_KEY_ID") ?? "";
const CF_TOKEN = Deno.env.get("CF_TURN_API_TOKEN") ?? "";
const TURN_SECRET = Deno.env.get("TURN_SHARED_SECRET") ?? "";
const TURN_URLS = (Deno.env.get("TURN_URLS") ?? "").split(",").map((s) => s.trim()).filter((s) => /^turns?:/.test(s));
const TTL = Math.min(14400, Math.max(600, Number(Deno.env.get("TURN_TTL") ?? "7200") || 7200));

const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const ORIGENS = new Set([
  "https://minerapara.com.br",
  "https://www.minerapara.com.br",
  "https://facilveiculos2015-byte.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8090",
  ...(Deno.env.get("CHAMADA_ORIGENS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (ORIGENS.has(o)) h["Access-Control-Allow-Origin"] = o;
  return h;
}
function resp(req: Request, obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Ice = { urls: string | string[]; username?: string; credential?: string };

/** Cloudflare: POST generate-ice-servers. Tira URLs da porta 53 (navegadores bloqueiam). */
async function cloudflare(): Promise<Ice[] | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);  // o app desiste em 3,5 s e liga só com STUN
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(CF_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL }),
      signal: ctl.signal,
    });
    if (!r.ok) { console.warn("cloudflare turn", r.status); return null; }
    const j = await r.json() as { iceServers?: Ice[] | Ice };
    const lista = Array.isArray(j.iceServers) ? j.iceServers : (j.iceServers ? [j.iceServers] : []);
    return lista.map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(String(u))),
    })).filter((s) => (s.urls as string[]).length > 0);
  } catch (e) {
    console.warn("cloudflare turn erro", (e as Error)?.message);
    return null;
  } finally { clearTimeout(t); }
}

/** coturn "use-auth-secret": usuário = expiração:id, senha = base64(HMAC-SHA1(segredo, usuário)). */
async function coturn(uid: string): Promise<Ice[]> {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  // não manda o id real do usuário para o servidor TURN: só um apelido curto
  const apelido = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid + TURN_SECRET))))
    .slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
  const username = `${exp}:${apelido}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TURN_SECRET), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username)));
  const credential = btoa(String.fromCharCode(...sig));
  return [{ urls: TURN_URLS, username, credential }];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return resp(req, { ok: false, erro: "método" }, 405);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(req, { ok: false, erro: "não autorizado" }, 401);
  let corpo: { chamada_id?: string } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const id = String(corpo?.chamada_id ?? "");
  if (!UUID.test(id)) return resp(req, { ok: false, erro: "chamada_id" }, 400);

  const sb = createClient(SB_URL, SB_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: u, error: eU } = await sb.auth.getUser(jwt);
  if (eU || !u?.user?.id) return resp(req, { ok: false, erro: "não autorizado" }, 401);
  // RLS: só os 2 participantes enxergam a linha
  const { data: c } = await sb.from("chamadas").select("id,estado").eq("id", id).in("estado", ["tocando", "atendida"]).maybeSingle();
  if (!c) return resp(req, { ok: false, erro: "ligação não encontrada ou encerrada" }, 403);

  let turn: Ice[] | null = null, provedor = "stun";
  if (CF_KEY_ID && CF_TOKEN) { turn = await cloudflare(); if (turn) provedor = "cloudflare"; }
  if (!turn && TURN_SECRET && TURN_URLS.length) { turn = await coturn(u.user.id); provedor = "coturn"; }
  const iceServers = turn && turn.length ? turn.concat(provedor === "cloudflare" ? [] : STUN) : STUN;
  return resp(req, { ok: true, provedor, ttl: TTL, iceServers });
});
