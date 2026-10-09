-- =====================================================================
-- MINERA PARA - 61 Push POR APARELHO, com reserva (corrige o SQL 58)
--  Bug (09/10/2026): celular B so com o app Minera Para (sem Chat Minera)
--  nao recebia aviso. O SQL 58 escolhia POR PESSOA: se a conta tinha
--  QUALQUER inscricao 'chat' (outro aparelho, icone apagado, /chat/ aberto
--  no navegador, linha velha), as inscricoes 'app' eram descartadas, e nao
--  havia reserva quando o 'chat' falhava (404/410).
--  Agora:
--   - push_subscriptions.aparelho = id aleatorio do aparelho (localStorage;
--     no Android o app e o Chat Minera dividem o mesmo -> mesmo aparelho).
--     iPhone (web.push.apple.com): cada app da Tela de Inicio tem armazenamento
--     proprio, entao o aparelho e o user_agent (igual nos dois apps do iPhone).
--   - gatilho: agrupa por PESSOA + APARELHO. Em cada aparelho manda em ordem:
--     1o = a inscricao aberta mais recentemente (Chat Minera ganha empate de
--     ate 3 dias); 2o e 3o = reservas. A Edge Function send-push (v3) tenta a
--     1a; se falhar (404/410/erro) tenta a proxima -> UM aviso por aparelho e
--     nunca zero. Aparelhos diferentes recebem todos.
--   - push_registrar(..., p_aparelho): grava o aparelho (mesmas regras do
--     SQL 59: so servidores de push reais, tamanhos, max 10 por pessoa).
--  Ordem segura: publicar a send-push v3 ANTES (ela aceita o corpo antigo).
--  Se rodar este SQL com a send-push antiga, ela manda para TODAS as
--  inscricoes listadas (pode repetir aviso no iPhone, mas nunca perde).
--  Nao mexe em Auth/CAPTCHA. Transacional. Idempotente. ASCII.
-- =====================================================================
BEGIN;

ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS origem text;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS aparelho text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subs_aparelho_chk') THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subs_aparelho_chk CHECK (aparelho IS NULL OR aparelho ~ '^[A-Za-z0-9-]{8,64}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_push_subs_auth ON public.push_subscriptions(auth_id);

-- inscricao com origem + aparelho (site novo). Valida como o SQL 59.
CREATE OR REPLACE FUNCTION public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_origem text, p_aparelho text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_origem text := CASE WHEN p_origem IN ('app', 'chat') THEN p_origem ELSE NULL END;
  v_ap text := CASE WHEN p_aparelho ~ '^[A-Za-z0-9-]{8,64}$' THEN p_aparelho ELSE NULL END;
BEGIN
  IF v_uid IS NULL OR coalesce(p_endpoint, '') = '' THEN RETURN; END IF;
  IF length(p_endpoint) NOT BETWEEN 20 AND 1000
     OR p_endpoint !~ '^https://(fcm[.]googleapis[.]com|android[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^[:space:]]+$'
     OR length(coalesce(p_p256dh, '')) NOT BETWEEN 20 AND 200
     OR length(coalesce(p_auth, '')) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'push: inscricao invalida' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND auth_id <> v_uid;
  INSERT INTO public.push_subscriptions (auth_id, endpoint, p256dh, auth, user_agent, origem, aparelho)
  VALUES (v_uid, p_endpoint, p_p256dh, p_auth, left(p_ua, 300), v_origem, v_ap)
  ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    origem = coalesce(EXCLUDED.origem, public.push_subscriptions.origem),
    aparelho = coalesce(EXCLUDED.aparelho, public.push_subscriptions.aparelho),
    atualizado_em = now();
  -- mesma origem no mesmo aparelho = inscricao antiga substituida (o navegador trocou o endpoint)
  IF v_ap IS NOT NULL AND v_origem IS NOT NULL THEN
    DELETE FROM public.push_subscriptions
     WHERE auth_id = v_uid AND aparelho = v_ap AND coalesce(origem, 'app') = v_origem AND endpoint <> p_endpoint;
  END IF;
  -- no maximo 10 inscricoes por pessoa (as mais recentes ficam)
  DELETE FROM public.push_subscriptions s
   WHERE s.auth_id = v_uid
     AND s.id NOT IN (SELECT id FROM public.push_subscriptions
                       WHERE auth_id = v_uid ORDER BY atualizado_em DESC, id DESC LIMIT 10);
END;
$$;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.push_registrar(text, text, text, text, text, text) TO authenticated;

-- gatilho: por aparelho, com reservas em ordem
CREATE OR REPLACE FUNCTION public.chat_push_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_sec text;
  v_nome text;
  v_gnome text;
  v_dest uuid[];
  v_subs jsonb;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR coalesce(NEW.status, 'enviada') = 'agendada'
     OR coalesce(NEW.tipo, '') = 'sistema' OR coalesce(NEW.moderacao, '') = 'removida' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status, 'enviada') <> 'agendada' THEN RETURN NEW; END IF;
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_fn_url' LIMIT 1;
    SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets WHERE name = 'push_hook_secret' LIMIT 1;
    IF v_url IS NULL OR v_sec IS NULL THEN RETURN NEW; END IF;

    IF NEW.grupo_id IS NOT NULL THEN
      SELECT array_agg(DISTINCT gm.auth_id) INTO v_dest
        FROM public.chat_grupo_membros gm
       WHERE gm.grupo_id = NEW.grupo_id AND gm.saiu_em IS NULL;
      SELECT g.nome INTO v_gnome FROM public.chat_grupos g WHERE g.id = NEW.grupo_id;
    ELSIF NEW.para_auth_id IS NOT NULL THEN
      v_dest := ARRAY[NEW.para_auth_id];
    END IF;
    IF NEW.de_auth_id IS NOT NULL THEN v_dest := array_remove(v_dest, NEW.de_auth_id); END IF;
    IF v_dest IS NULL OR cardinality(v_dest) = 0 THEN RETURN NEW; END IF;

    -- POR APARELHO (SQL 61): g = pessoa+aparelho; r = 1 (principal), 2, 3 (reservas).
    -- Principal = aberta mais recentemente; Chat Minera ganha empate de ate 3 dias.
    WITH base AS (
      SELECT s.id, s.auth_id, s.endpoint, s.p256dh, s.auth, s.atualizado_em,
             coalesce(s.origem, 'app') AS o,
             CASE
               WHEN split_part(s.endpoint, '/', 3) = 'web.push.apple.com' AND coalesce(s.user_agent, '') <> ''
                 THEN 'ua:' || md5(s.auth_id::text || s.user_agent)
               WHEN s.aparelho IS NOT NULL THEN 'ap:' || md5(s.auth_id::text || s.aparelho)
               ELSE 'id:' || s.id::text
             END AS g
        FROM public.push_subscriptions s
       WHERE s.auth_id = ANY (v_dest)
         AND NOT (s.auth_id = ANY (coalesce(NEW.apagada_para, '{}'::uuid[])))
         AND s.endpoint ~ '^https://(fcm[.]googleapis[.]com|android[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/'
    ), ordem AS (
      SELECT b.*, row_number() OVER (
               PARTITION BY b.g
               ORDER BY b.atualizado_em + CASE WHEN b.o = 'chat' THEN interval '3 days' ELSE interval '0' END DESC, b.id DESC
             ) AS r
        FROM base b
    ), lista AS (
      SELECT o.* FROM ordem o WHERE o.r <= 3 ORDER BY o.g, o.r LIMIT 1000
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'endpoint', l.endpoint, 'p256dh', l.p256dh, 'auth', l.auth,
                                                  'o', l.o, 'g', left(md5(l.g), 12), 'r', l.r) ORDER BY l.g, l.r), '[]'::jsonb)
      INTO v_subs
      FROM lista l;
    IF jsonb_array_length(v_subs) = 0 THEN RETURN NEW; END IF;

    v_nome := nullif(btrim(coalesce(NEW.de_nome, '')), '');
    IF v_nome IS NULL OR position('@' IN v_nome) > 0 THEN
      SELECT coalesce(nullif(btrim(u.apelido), ''), nullif(btrim(u.nome), '')) INTO v_nome
        FROM public.usuarios u WHERE u.auth_id = NEW.de_auth_id LIMIT 1;
    END IF;
    IF v_nome IS NOT NULL AND position('@' IN v_nome) > 0 THEN v_nome := NULL; END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
      body := jsonb_build_object(
        'v', 2,
        'reserva', true,
        'id', NEW.id,
        'de', NEW.de_auth_id,
        'de_nome', v_nome,
        'grupo_id', NEW.grupo_id,
        'grupo_nome', v_gnome,
        'tipo', coalesce(NEW.tipo, 'text'),
        'texto', left(coalesce(NEW.texto, ''), 200),
        'subs', v_subs
      ),
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat_push_notificar: %', SQLERRM;  -- nunca bloqueia a mensagem
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM anon;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM authenticated;

DROP TRIGGER IF EXISTS trg_chat_push_ins ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_ins AFTER INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();
DROP TRIGGER IF EXISTS trg_chat_push_upd ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_upd AFTER UPDATE OF status ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Conferir (esperado: gatilhos=2, gatilho_61=true, registrar_6_args=1)
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_chat_push_ins', 'trg_chat_push_upd')) AS gatilhos,
  (position('reserva' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) > 0) AS gatilho_61,
  (SELECT count(*) FROM pg_proc WHERE proname = 'push_registrar' AND pronargs = 6) AS registrar_6_args,
  (SELECT count(*) FILTER (WHERE aparelho IS NOT NULL) FROM public.push_subscriptions) AS inscricoes_com_aparelho;

-- DESFAZER (emergencia): rodar de novo o sql/58-push-dedupe.sql (volta o gatilho antigo).
-- A coluna aparelho e a push_registrar de 6 argumentos podem ficar (o site cai para a de 5).
