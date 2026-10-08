-- =====================================================================
-- MINERA PARA - 58 Push: UM aviso por pessoa (sem duplicar)
--  Problema (08/10/2026): no iPhone, quem tem o Minera Para E o Chat Minera
--  na Tela de Inicio recebia 2 avisos da mesma mensagem (cada app tem a sua
--  inscricao e o aparelho nao compartilha nada entre eles).
--  Correcao no SERVIDOR, na hora do envio:
--   - push_subscriptions.origem = 'chat' (Chat Minera, /chat/) ou 'app'
--     (site/app principal). Linhas antigas ficam NULL e contam como 'app'.
--   - push_registrar(..., p_origem) grava a origem (o site manda a partir
--     do build 20261008f; a versao antiga de 4 argumentos continua valendo).
--   - gatilho: se a pessoa tem inscricao 'chat', manda SO para 'chat';
--     senao SO para 'app'; e so a mais recente de cada aparelho.
--  Requer SQL 57 e a send-push v2 ja publicados (send-push nao muda).
--  Idempotente. ASCII.
-- =====================================================================

ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS origem text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subs_origem_chk') THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subs_origem_chk CHECK (origem IS NULL OR origem IN ('app', 'chat'));
  END IF;
END $$;

-- inscricao com origem (site novo)
CREATE OR REPLACE FUNCTION public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_origem text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text := CASE WHEN p_origem IN ('app', 'chat') THEN p_origem ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL OR coalesce(p_endpoint, '') = '' THEN RETURN; END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND auth_id <> auth.uid();
  INSERT INTO public.push_subscriptions (auth_id, endpoint, p256dh, auth, user_agent, origem)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300), v_origem)
  ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent, origem = coalesce(EXCLUDED.origem, public.push_subscriptions.origem),
    atualizado_em = now();
END;
$$;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.push_registrar(text, text, text, text, text) TO authenticated;

-- versao antiga (4 argumentos, sites ainda em cache): nao apaga a origem ja gravada
CREATE OR REPLACE FUNCTION public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.push_registrar(p_endpoint, p_p256dh, p_auth, p_ua, NULL::text);
END;
$$;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.push_registrar(text, text, text, text) TO authenticated;

-- gatilho (igual ao SQL 57, com a escolha de UMA inscricao por pessoa/aparelho)
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

    -- destinatarios: DM = para_auth_id; grupo = membros ativos (SQL 55)
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

    -- UM aviso por pessoa (SQL 58): se a pessoa tem o Chat Minera inscrito,
    -- manda SO para o Chat Minera; senao, so para o app/site. Nunca os dois.
    -- Dentro do tipo escolhido: so a inscricao mais recente de cada aparelho
    -- (mesmo user_agent), para nao repetir no mesmo celular.
    WITH base AS (
      SELECT s.id, s.auth_id, s.endpoint, s.p256dh, s.auth, s.atualizado_em,
             coalesce(s.origem, 'app') AS o, coalesce(s.user_agent, '') AS ua
        FROM public.push_subscriptions s
       WHERE s.auth_id = ANY (v_dest)
         AND NOT (s.auth_id = ANY (coalesce(NEW.apagada_para, '{}'::uuid[])))
    ), pref AS (
      SELECT b.*, bool_or(b.o = 'chat') OVER (PARTITION BY b.auth_id) AS tem_chat FROM base b
    ), escolha AS (
      SELECT DISTINCT ON (p.auth_id, p.ua) p.*
        FROM pref p
       WHERE (p.tem_chat AND p.o = 'chat') OR (NOT p.tem_chat AND p.o = 'app')
       ORDER BY p.auth_id, p.ua, p.atualizado_em DESC, p.id DESC
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'endpoint', e.endpoint, 'p256dh', e.p256dh, 'auth', e.auth)), '[]'::jsonb)
      INTO v_subs
      FROM escolha e;
    IF jsonb_array_length(v_subs) = 0 THEN RETURN NEW; END IF;

    -- nome de quem mandou (nunca e-mail)
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

SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_chat_push_ins', 'trg_chat_push_upd')) AS gatilhos,
  (position('tem_chat' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) > 0) AS gatilho_dedupe,
  (SELECT count(*) FROM pg_proc WHERE proname = 'push_registrar') AS push_registrar_versoes,
  (SELECT count(*) FILTER (WHERE origem = 'chat') FROM public.push_subscriptions) AS inscricoes_chat,
  (SELECT count(*) FILTER (WHERE origem = 'app') FROM public.push_subscriptions) AS inscricoes_app,
  (SELECT count(*) FILTER (WHERE origem IS NULL) FROM public.push_subscriptions) AS inscricoes_antigas;
