// Minera Pará — Edge Function "send-push" (Web Push com o app FECHADO).
// Chamada SÓ pelo gatilho do SQL 54 (pg_net) com o cabeçalho x-push-secret.
// Recebe { id } da mensagem, lê com service_role, acha os destinatários
// (DM: para_auth_id · grupo: membros ativos do SQL 55), exceto o remetente,
// e envia o push para todos os aparelhos inscritos (push_subscriptions).
// Inscrições expiradas (404/410) são apagadas.
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

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const sb = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

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
  let id: number | null = null;
  try { id = Number((await req.json())?.id) || null; } catch { /* corpo inválido */ }
  if (!id) return resp({ ok: false, erro: "id" }, 400);

  const { data: m, error } = await sb.from("chat_mensagens").select("*").eq("id", id).maybeSingle();
  if (error || !m) return resp({ ok: false, erro: "mensagem não encontrada" }, 200);
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

  const { data: subs } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth")
    .in("auth_id", destinos);
  const payload = JSON.stringify({ title: "Minera Pará — " + title, body, url, tag });

  let enviados = 0, removidos = 0, falhas = 0;
  await Promise.all((subs ?? []).map(async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 86400, urgency: "high", topic: tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) },
      );
      enviados++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode ?? 0;
      if (code === 404 || code === 410) {
        await sb.from("push_subscriptions").delete().eq("id", s.id);
        removidos++;
      } else {
        falhas++;
        console.warn("push falhou", code, (e as Error)?.message);
      }
    }
  }));
  return resp({ ok: true, enviados, removidos, falhas });
});
