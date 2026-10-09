// Minera Pará — Edge Function "send-push" (Web Push com o app FECHADO).
// Chamada SÓ pelo gatilho do banco (pg_net) com o cabeçalho x-push-secret.
//
// v2 (SQL 57, 08/10/2026): o gatilho já manda TUDO o que precisa — remetente,
// tipo/trecho, grupo e as inscrições (endpoint/chaves) dos destinatários —
// então a função NÃO depende de ler o banco para entregar. Antes (v1, SQL 54)
// ela recebia só { id } e lia chat_mensagens; essa leitura voltava vazia em
// produção ("mensagem não encontrada") e nenhum aviso saía.
// v1 continua aceito (corpo só com { id }): lê com a chave secreta nova
// (SUPABASE_SECRET_KEYS) ou a legada (SUPABASE_SERVICE_ROLE_KEY), com novas
// tentativas, e devolve o motivo exato se não achar.
// Inscrições expiradas (404/410) são apagadas (melhor esforço).
//
// v3 (SQL 61, 09/10/2026): com { reserva: true } cada inscrição vem com
// g (aparelho) e r (ordem: 1 = principal, 2/3 = reservas). Por aparelho a
// função tenta a principal; se falhar (404/410/erro) tenta a próxima — UM
// aviso por aparelho e nunca zero (antes, um 'chat' velho/apagado engolia o
// aviso do app). Sem g/r (SQL 57/58) manda para todas, como antes.
// Mesmo 'tag' (conversa) em todas: o aparelho junta avisos repetidos.
// Segurança mantida: segredo x-push-secret (Verify JWT desligado de propósito,
// quem chama é o gatilho), só servidores de push reais, máx. 1000 por chamada.
//
// Segredos (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto:...), PUSH_HOOK_SECRET.  SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.
// Deploy: supabase functions deploy send-push --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:minerapara@gmail.com";
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") ?? "";

try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch (e) { console.error("VAPID inválido", (e as Error)?.message); }

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
function chavesAdmin(): { nome: string; valor: string }[] {
  const out: { nome: string; valor: string }[] = [];
  try {
    const novas = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    if (novas && typeof novas === "object") {
      if (novas["default"]) out.push({ nome: "secret:default", valor: String(novas["default"]) });
      for (const [k, v] of Object.entries(novas)) if (k !== "default" && v) out.push({ nome: "secret:" + k, valor: String(v) });
    }
  } catch { /* sem chaves novas */ }
  const legada = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (legada) out.push({ nome: "service_role", valor: legada });
  return out;
}
const CLIENTES = chavesAdmin().map((k) => ({
  nome: k.nome,
  sb: createClient(SB_URL, k.valor, { auth: { persistSession: false, autoRefreshToken: false } }),
}));
// cliente para tarefas de apoio (nome do remetente, limpeza de inscrição expirada)
const sb = CLIENTES[0]?.sb ?? createClient(SB_URL, "sem-chave", { auth: { persistSession: false, autoRefreshToken: false } });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** v1: lê a mensagem com cada chave, com novas tentativas (0 · 0,6 s · 1,8 s). */
// deno-lint-ignore no-explicit-any
async function lerMensagem(id: number): Promise<{ m: Record<string, any> | null; motivo: string }> {
  const motivos: string[] = [];
  if (!CLIENTES.length) return { m: null, motivo: "sem chave de serviço no ambiente da função" };
  for (const atraso of [0, 600, 1800]) {
    if (atraso) await esperar(atraso);
    for (const c of CLIENTES) {
      const { data, error } = await c.sb.from("chat_mensagens").select("*").eq("id", id).maybeSingle();
      // deno-lint-ignore no-explicit-any
      if (data) return { m: data as Record<string, any>, motivo: "" };
      motivos.push(c.nome + ": " + (error ? (error.code ?? "") + " " + (error.message ?? "erro") : "0 linhas"));
    }
  }
  return { m: null, motivo: [...new Set(motivos)].join(" | ").slice(0, 400) };
}

type Sub = { id: number; endpoint: string; p256dh: string; auth: string; g?: string; r?: number; o?: string };

// Só serviços de push reais (evita a função fazer POST para qualquer URL).
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/i;
function endpointOk(e: string): boolean {
  try { const u = new URL(e); return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname); } catch { return false; }
}

type Resultado = { ok: boolean; removida: boolean; erro: string };

/** Envia para UMA inscrição. 404/410 = inscrição morta → apaga do banco. */
async function enviarUma(s: Sub, payload: string, tag: string): Promise<Resultado> {
  if (!s || !s.endpoint || !s.p256dh || !s.auth || !endpointOk(s.endpoint)) return { ok: false, removida: false, erro: "" };
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
      { TTL: 86400, urgency: "high", topic: tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) },
    );
    return { ok: true, removida: false, erro: "" };
  } catch (e) {
    const code = (e as { statusCode?: number })?.statusCode ?? 0;
    const host = (() => { try { return new URL(s.endpoint).host; } catch { return "?"; } })();
    if (code === 404 || code === 410) {
      try { await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); } catch { /* melhor esforço */ }
      return { ok: false, removida: true, erro: host + " " + code };
    }
    console.warn("push falhou", host, code, (e as Error)?.message);
    return { ok: false, removida: false, erro: host + " " + code + " " + String((e as Error)?.message ?? "").slice(0, 80) };
  }
}

/**
 * Sem g/r: manda para todas (v2). Com g/r (SQL 61): por aparelho, em ordem,
 * para na 1ª que der certo; se a principal falhar, usa a reserva.
 */
async function enviarPara(subs: Sub[], payload: string, tag: string, comReserva = false) {
  let enviados = 0, removidos = 0, falhas = 0, reserva = 0;
  const erros: string[] = [];
  const conta = (r: Resultado) => {
    if (r.ok) enviados++;
    else if (r.removida) removidos++;
    else if (r.erro) falhas++;
    if (r.erro) erros.push(r.erro);
  };
  const grupos = new Map<string, Sub[]>();
  subs.forEach((s, i) => {
    const g = comReserva && s && typeof s.g === "string" && s.g ? "g:" + s.g : "i:" + i;
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g)!.push(s);
  });
  await Promise.all([...grupos.values()].map(async (lista) => {
    lista.sort((a, b) => (Number(a?.r) || 99) - (Number(b?.r) || 99));
    for (let k = 0; k < Math.min(lista.length, 3); k++) {
      const r = await enviarUma(lista[k], payload, tag);
      conta(r);
      if (r.ok) { if (k > 0) reserva++; break; }
    }
  }));
  return { enviados, removidos, falhas, reserva, aparelhos: grupos.size, erros: erros.slice(0, 3) };
}

function iguais(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function semEmail(s: unknown): string {
  const t = String(s ?? "").trim();
  return !t || t.includes("@") ? "" : t;
}

function previa(m: Record<string, unknown>): string {
  const tipo = String(m.tipo ?? "text").toLowerCase();
  if (tipo === "audio") return "🎤 Mensagem de áudio";
  if (tipo === "imagem") return "📷 Foto";
  if (tipo === "video") return "🎥 Vídeo";
  if (tipo === "documento" || tipo === "doc" || tipo === "pdf") return "📄 Documento";
  const t = String(m.texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Nova mensagem";
  return t.length > 110 ? t.slice(0, 107) + "…" : t;
}

function resp(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp({ ok: false, erro: "método" }, 405);
  if (!HOOK_SECRET || !iguais(req.headers.get("x-push-secret") ?? "", HOOK_SECRET)) {
    return resp({ ok: false, erro: "não autorizado" }, 401);
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return resp({ ok: false, erro: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes nos segredos da função" }, 200);
  let corpo: Record<string, unknown> = {};
  try { corpo = (await req.json()) ?? {}; } catch { /* corpo inválido */ }
  const id = Number(corpo?.id) || null;
  if (!id) return resp({ ok: false, erro: "id" }, 400);

  // ---------- v2: o gatilho (SQL 57) já mandou tudo ----------
  if (Number(corpo.v) === 2) {
    const de = String(corpo.de ?? "");
    const nome = semEmail(corpo.de_nome) || "Alguém";
    const m2 = { tipo: corpo.tipo, texto: corpo.texto };
    let title = nome, body = previa(m2);
    let url = "./chat.html?com=" + encodeURIComponent(de), tag = "dm-" + de;
    if (corpo.grupo_id) {
      title = semEmail(corpo.grupo_nome) || "Grupo";
      body = nome + ": " + body;
      url = "./chat.html?grupo=" + encodeURIComponent(String(corpo.grupo_id));
      tag = "g-" + String(corpo.grupo_id);
    }
    const subs = ((Array.isArray(corpo.subs) ? corpo.subs : []) as unknown as Sub[]).slice(0, 1000);
    if (!subs.length) return resp({ ok: true, v: 2, id, enviados: 0, inscricoes: 0 });
    const payload = JSON.stringify({ title: "Minera Pará — " + title, body, url, tag });
    const r = await enviarPara(subs, payload, tag, corpo.reserva === true);
    return resp({ ok: true, v: corpo.reserva === true ? 3 : 2, id, inscricoes: subs.length, ...r });
  }

  // ---------- v1: só { id } (SQL 54) ----------
  const { m, motivo } = await lerMensagem(id);
  if (!m) {
    console.error("send-push: mensagem não encontrada", id, motivo);
    return resp({ ok: false, erro: "mensagem não encontrada", id, motivo, chaves: CLIENTES.map((c) => c.nome) }, 200);
  }
  if (m.deleted_at || (m.status ?? "enviada") === "agendada" || m.moderacao === "removida") {
    return resp({ ok: true, pulou: "estado" });
  }
  if (String(m.tipo ?? "") === "sistema") return resp({ ok: true, pulou: "sistema" });

  const de = String(m.de_auth_id ?? "");
  let nome = semEmail(m.de_nome);
  if (!nome && de) {
    const { data: u } = await sb.from("usuarios").select("apelido,nome").eq("auth_id", de).maybeSingle();
    nome = semEmail(u?.apelido) || semEmail(u?.nome);
  }
  nome = nome || "Alguém";

  let destinos: string[] = [];
  let title = nome;
  let body = previa(m);
  let url = "./chat.html?com=" + encodeURIComponent(de);
  let tag = "dm-" + de;

  if (m.grupo_id) {
    const { data: g } = await sb.from("chat_grupos").select("nome").eq("id", m.grupo_id).maybeSingle();
    const { data: mem } = await sb.from("chat_grupo_membros").select("auth_id")
      .eq("grupo_id", m.grupo_id).is("saiu_em", null);
    destinos = (mem ?? []).map((x: { auth_id: string }) => String(x.auth_id));
    title = semEmail(g?.nome) || "Grupo";
    body = nome + ": " + body;
    url = "./chat.html?grupo=" + encodeURIComponent(String(m.grupo_id));
    tag = "g-" + m.grupo_id;
  } else if (m.para_auth_id) {
    destinos = [String(m.para_auth_id)];
  }
  const apagadas: string[] = Array.isArray(m.apagada_para) ? m.apagada_para.map(String) : [];
  destinos = [...new Set(destinos)].filter((d) => d && d !== de && !apagadas.includes(d));
  if (!destinos.length) return resp({ ok: true, enviados: 0 });

  const { data: subs, error: eSubs } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth")
    .in("auth_id", destinos);
  if (eSubs) return resp({ ok: false, erro: "não leu push_subscriptions", motivo: (eSubs.code ?? "") + " " + (eSubs.message ?? "") }, 200);
  const payload = JSON.stringify({ title: "Minera Pará — " + title, body, url, tag });
  const r = await enviarPara((subs ?? []) as Sub[], payload, tag);
  return resp({ ok: true, v: 1, id, inscricoes: (subs ?? []).length, ...r });
});
