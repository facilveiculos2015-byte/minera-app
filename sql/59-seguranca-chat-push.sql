-- =====================================================================
-- MINERA PARA - 59 Seguranca: chat (tipo/limite) + push (inscricao)
--  PROPOSTA da varredura de 08/10/2026 - NAO aplicado em producao.
--  1) chat_mensagens: cliente comum so manda tipos conhecidos; 'sistema'
--     (aviso cinza sem remetente) so pelo servidor (RPC) ou admin.
--     Fecha o "aviso falso" e o desvio do bloqueio de contatos de fora.
--  2) chat_mensagens: limite de 30 mensagens por minuto por pessoa
--     (anti-spam / anti-enxurrada de avisos push).
--  3) push_subscriptions: so servicos de push reais (Google/Mozilla/Apple/
--     Microsoft), tamanhos limitados, maximo 10 inscricoes por pessoa;
--     gravacao so pela RPC push_registrar (sem INSERT/UPDATE direto).
--  4) chat_eh_membro: so responde sobre grupo do qual quem pergunta participa.
--  Antes de aplicar, conferir tipos e servidores de push que existem hoje:
--    SELECT split_part(endpoint, '/', 3) AS host, count(*) FROM public.push_subscriptions GROUP BY 1;
--    SELECT tipo, count(*) FROM public.chat_mensagens GROUP BY 1 ORDER BY 2 DESC;
--  Transacional. Idempotente. ASCII. Nao apaga dados (so inscricoes de push
--  invalidas/excedentes, que o aparelho recria sozinho).
-- =====================================================================
BEGIN;

-- ---------- 1+2) chat_mensagens: tipo e limite ----------
CREATE OR REPLACE FUNCTION public.chat_envios_ultimo_minuto()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.chat_mensagens
   WHERE de_auth_id = auth.uid() AND criado_em > now() - interval '60 seconds';
$$;
REVOKE ALL ON FUNCTION public.chat_envios_ultimo_minuto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_envios_ultimo_minuto() TO authenticated;

-- INVOKER de proposito: current_user = quem chamou (RPC DEFINER como
-- chat_grupo_aviso roda como dono e passa; app/API = authenticated).
CREATE OR REPLACE FUNCTION public.chat_mensagens_bi_tipo_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.tipo, 'text') NOT IN ('text', 'agendada', 'imagem', 'audio', 'video', 'documento', 'doc', 'pdf') THEN
    RAISE EXCEPTION 'chat: tipo de mensagem invalido' USING ERRCODE = '22023';
  END IF;
  IF public.chat_envios_ultimo_minuto() >= 30 THEN
    RAISE EXCEPTION 'Muitas mensagens em pouco tempo. Espere um minuto.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_mensagens_bi_tipo_guard ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_bi_tipo_guard
  BEFORE INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_bi_tipo_guard();

CREATE INDEX IF NOT EXISTS idx_chat_de_criado ON public.chat_mensagens (de_auth_id, criado_em DESC);

-- ---------- 3) push_subscriptions ----------
CREATE OR REPLACE FUNCTION public.push_endpoint_ok(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p IS NOT NULL AND length(p) BETWEEN 20 AND 1000
     AND p ~ '^https://(fcm[.]googleapis[.]com|android[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/[^[:space:]]+$';
$$;

-- remove inscricoes invalidas antes da regra (o aparelho recria)
DELETE FROM public.push_subscriptions WHERE NOT public.push_endpoint_ok(endpoint);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subs_endpoint_ok') THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subs_endpoint_ok CHECK (public.push_endpoint_ok(endpoint)
        AND length(p256dh) BETWEEN 20 AND 200 AND length(auth) BETWEEN 8 AND 100);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.push_registrar(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_origem text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_origem text := CASE WHEN p_origem IN ('app', 'chat') THEN p_origem ELSE NULL END;
BEGIN
  IF v_uid IS NULL OR coalesce(p_endpoint, '') = '' THEN RETURN; END IF;
  IF NOT public.push_endpoint_ok(p_endpoint)
     OR length(coalesce(p_p256dh, '')) NOT BETWEEN 20 AND 200
     OR length(coalesce(p_auth, '')) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'push: inscricao invalida' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND auth_id <> v_uid;
  INSERT INTO public.push_subscriptions (auth_id, endpoint, p256dh, auth, user_agent, origem)
  VALUES (v_uid, p_endpoint, p_p256dh, p_auth, left(p_ua, 300), v_origem)
  ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent, origem = coalesce(EXCLUDED.origem, public.push_subscriptions.origem),
    atualizado_em = now();
  -- no maximo 10 inscricoes por pessoa (as mais recentes ficam)
  DELETE FROM public.push_subscriptions s
   WHERE s.auth_id = v_uid
     AND s.id NOT IN (SELECT id FROM public.push_subscriptions
                       WHERE auth_id = v_uid ORDER BY atualizado_em DESC, id DESC LIMIT 10);
END;
$$;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_registrar(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.push_registrar(text, text, text, text, text) TO authenticated;

-- gravacao so pela RPC (o app so usa RPC + DELETE da propria inscricao)
REVOKE INSERT, UPDATE ON TABLE public.push_subscriptions FROM authenticated;

-- ---------- 4) chat_eh_membro ----------
CREATE OR REPLACE FUNCTION public.chat_eh_membro(p_grupo uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_grupo_membros
                  WHERE grupo_id = p_grupo AND auth_id = p_uid AND saiu_em IS NULL)
     AND (p_uid = auth.uid() OR auth.uid() IS NULL
          OR EXISTS (SELECT 1 FROM public.chat_grupo_membros
                      WHERE grupo_id = p_grupo AND auth_id = auth.uid() AND saiu_em IS NULL));
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Conferir:
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_chat_mensagens_bi_tipo_guard') AS gatilho_tipo,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'push_subs_endpoint_ok') AS regra_endpoint,
  has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') AS auth_insert_direto;
