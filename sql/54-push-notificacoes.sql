-- =====================================================================
-- MINERA PARA - 54 Web Push (notificacao com o app FECHADO / tela travada)
--  1) push_subscriptions: inscricoes de push de cada usuario (RLS: cada um
--     ve/grava/apaga so as proprias; a Edge Function usa service_role).
--  2) Gatilho em chat_mensagens: a cada mensagem nova (ou agendada que foi
--     enviada) chama a Edge Function send-push via pg_net, mandando SO o id.
--     A funcao le a mensagem com service_role, acha o(s) destinatario(s)
--     (DM: para_auth_id; grupo: membros, se o SQL 55 existir), exceto o
--     remetente, e envia o push. Falha no push NUNCA bloqueia o envio.
--  A URL da funcao e o segredo ficam no Vault (nao neste arquivo):
--    select vault.create_secret('https://eelbuaxgfzvxosatwcxk.supabase.co/functions/v1/send-push', 'push_fn_url');
--    select vault.create_secret('<mesmo valor de PUSH_HOOK_SECRET>', 'push_hook_secret');
--  Idempotente.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id bigserial PRIMARY KEY,
  auth_id uuid NOT NULL DEFAULT auth.uid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_auth ON public.push_subscriptions(auth_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subs_sel ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subs_ins ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subs_upd ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subs_del ON public.push_subscriptions;
CREATE POLICY push_subs_sel ON public.push_subscriptions FOR SELECT TO authenticated USING (auth_id = auth.uid());
CREATE POLICY push_subs_ins ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid());
CREATE POLICY push_subs_upd ON public.push_subscriptions FOR UPDATE TO authenticated USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid());
CREATE POLICY push_subs_del ON public.push_subscriptions FOR DELETE TO authenticated USING (auth_id = auth.uid());
REVOKE ALL ON TABLE public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.push_subscriptions_id_seq TO authenticated;

-- Mesmo aparelho trocando de conta: o endpoint e unico; o usuario logado
-- "assume" a inscricao (apaga a do outro dono e grava a sua).
CREATE OR REPLACE FUNCTION public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(p_endpoint, '') = '' THEN RETURN; END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND auth_id <> auth.uid();
  INSERT INTO public.push_subscriptions (auth_id, endpoint, p256dh, auth, user_agent)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent, atualizado_em = now();
END;
$$;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.push_registrar(text, text, text, text) TO authenticated;

-- Gatilho -> Edge Function
CREATE OR REPLACE FUNCTION public.chat_push_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_sec text;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR coalesce(NEW.status, 'enviada') = 'agendada' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status, 'enviada') <> 'agendada' THEN RETURN NEW; END IF;
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_fn_url' LIMIT 1;
    SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets WHERE name = 'push_hook_secret' LIMIT 1;
    IF v_url IS NULL OR v_sec IS NULL THEN RETURN NEW; END IF;
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
      body := jsonb_build_object('id', NEW.id),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat_push_notificar: %', SQLERRM;  -- nunca bloqueia a mensagem
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_chat_push_ins ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_ins AFTER INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();
DROP TRIGGER IF EXISTS trg_chat_push_upd ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_upd AFTER UPDATE OF status ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();

NOTIFY pgrst, 'reload schema';

SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_chat_push_ins', 'trg_chat_push_upd')) AS gatilhos,
  (SELECT count(*) FROM vault.secrets WHERE name IN ('push_fn_url', 'push_hook_secret')) AS segredos_no_vault,
  has_table_privilege('anon', 'public.push_subscriptions', 'SELECT') AS anon_select;
