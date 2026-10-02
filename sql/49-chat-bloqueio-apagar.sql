-- =====================================================================
-- MINERA PARÁ - 49 Chat: bloquear usuário + "apagar conversa para mim" de verdade
-- Incremental. Idempotente (pode rodar 2x). NÃO apaga dados. Rodar após 44/44a.
-- Sem barras invertidas (seguro para copiar/colar no SQL Editor).
--
-- 1) chat_bloqueios (quem bloqueou quem) + RLS (cada um só vê/gerencia os seus).
--    Trigger em chat_mensagens: se A bloqueou B, B NÃO consegue enviar para A
--    (e A também não envia para B enquanto o bloqueio existir). Vale também
--    para mensagem agendada sendo promovida. Admin passa (moderação).
--    Canais privados dm:<a>:<b> (digitando/presença) negados se houver bloqueio.
-- 2) chat_conversas_limpas: "apagar conversa para mim" guarda o último id
--    apagado por usuário/conversa. Histórico (chat_dm_pagina) e lista
--    (chat_inbox_v1) passam a esconder, SÓ para quem apagou, tudo até esse id.
--    Mensagens novas aparecem normalmente. O outro lado não é afetado.
-- 3) RPCs: chat_bloqueio_estado, chat_bloquear, chat_desbloquear,
--    chat_apagar_conversa_v2 (retorna o corte anterior p/ "Desfazer"),
--    chat_desfazer_apagar_conversa.
-- =====================================================================

-- 1) Bloqueios ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_bloqueios (
  auth_id uuid NOT NULL,
  bloqueado_auth_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_id, bloqueado_auth_id),
  CONSTRAINT chat_bloqueios_no_self CHECK (auth_id <> bloqueado_auth_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_bloqueios_bloqueado ON public.chat_bloqueios (bloqueado_auth_id);
ALTER TABLE public.chat_bloqueios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_bloqueios_select_own" ON public.chat_bloqueios;
DROP POLICY IF EXISTS "chat_bloqueios_insert_own" ON public.chat_bloqueios;
DROP POLICY IF EXISTS "chat_bloqueios_delete_own" ON public.chat_bloqueios;
CREATE POLICY "chat_bloqueios_select_own" ON public.chat_bloqueios
  FOR SELECT TO authenticated
  USING (auth_id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY "chat_bloqueios_insert_own" ON public.chat_bloqueios
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = (SELECT auth.uid()));
CREATE POLICY "chat_bloqueios_delete_own" ON public.chat_bloqueios
  FOR DELETE TO authenticated
  USING (auth_id = (SELECT auth.uid()));
GRANT SELECT, INSERT, DELETE ON TABLE public.chat_bloqueios TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_ha_bloqueio(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_bloqueios
     WHERE (auth_id = p_a AND bloqueado_auth_id = p_b)
        OR (auth_id = p_b AND bloqueado_auth_id = p_a)
  );
$$;
REVOKE ALL ON FUNCTION public.chat_ha_bloqueio(uuid, uuid) FROM PUBLIC;

-- Trigger: bloqueia envio (INSERT) e promoção de agendada (UPDATE status)
CREATE OR REPLACE FUNCTION public.chat_mensagens_bloqueio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.para_auth_id IS NULL OR NEW.de_auth_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NOT (COALESCE(OLD.status, 'enviada') = 'agendada' AND COALESCE(NEW.status, 'enviada') = 'enviada') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_bloqueios
              WHERE auth_id = NEW.para_auth_id AND bloqueado_auth_id = NEW.de_auth_id) THEN
    RAISE EXCEPTION 'chat_bloqueado: você não pode enviar mensagens para este usuário'
      USING ERRCODE = '42501', HINT = 'me_bloqueou';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_bloqueios
              WHERE auth_id = NEW.de_auth_id AND bloqueado_auth_id = NEW.para_auth_id) THEN
    RAISE EXCEPTION 'chat_bloqueado: desbloqueie este usuário para enviar mensagens'
      USING ERRCODE = '42501', HINT = 'eu_bloqueei';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_mensagens_bloqueio ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_bloqueio
  BEFORE INSERT OR UPDATE OF status ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_bloqueio();

-- 2) Conversa apagada "para mim" (corte por id) ---------------------------
CREATE TABLE IF NOT EXISTS public.chat_conversas_limpas (
  auth_id uuid NOT NULL,
  outro_auth_id uuid NOT NULL,
  limpo_ate_id int NOT NULL DEFAULT 0,
  limpo_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_id, outro_auth_id),
  CONSTRAINT chat_conversas_limpas_no_self CHECK (auth_id <> outro_auth_id)
);
ALTER TABLE public.chat_conversas_limpas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_conv_limpas_select_own" ON public.chat_conversas_limpas;
CREATE POLICY "chat_conv_limpas_select_own" ON public.chat_conversas_limpas
  FOR SELECT TO authenticated
  USING (auth_id = (SELECT auth.uid()) OR public.is_admin());
-- escrita só pelas RPCs abaixo (SECURITY DEFINER)
GRANT SELECT ON TABLE public.chat_conversas_limpas TO authenticated;

-- 3) RPCs ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_bloqueio_estado(p_outro uuid)
RETURNS TABLE (eu_bloqueei boolean, me_bloqueou boolean, limpo_ate_id int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.chat_bloqueios b WHERE b.auth_id = auth.uid() AND b.bloqueado_auth_id = p_outro),
    EXISTS (SELECT 1 FROM public.chat_bloqueios b WHERE b.auth_id = p_outro AND b.bloqueado_auth_id = auth.uid()),
    COALESCE((SELECT l.limpo_ate_id FROM public.chat_conversas_limpas l
               WHERE l.auth_id = auth.uid() AND l.outro_auth_id = p_outro), 0)
  WHERE auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.chat_bloquear(p_outro uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF p_outro IS NULL OR p_outro = auth.uid() THEN RAISE EXCEPTION 'contato inválido'; END IF;
  INSERT INTO public.chat_bloqueios (auth_id, bloqueado_auth_id) VALUES (auth.uid(), p_outro)
  ON CONFLICT (auth_id, bloqueado_auth_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_desbloquear(p_outro uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  DELETE FROM public.chat_bloqueios WHERE auth_id = auth.uid() AND bloqueado_auth_id = p_outro;
END;
$$;

-- Apaga para mim: corte = maior id da conversa; esconde da lista. Retorna o corte ANTERIOR (p/ desfazer).
CREATE OR REPLACE FUNCTION public.chat_apagar_conversa_v2(p_outro uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_max int;
  v_ant int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF p_outro IS NULL OR p_outro = uid THEN RAISE EXCEPTION 'contato inválido'; END IF;
  SELECT COALESCE(max(id), 0) INTO v_max FROM public.chat_mensagens
   WHERE (de_auth_id = uid AND para_auth_id = p_outro) OR (de_auth_id = p_outro AND para_auth_id = uid);
  SELECT l.limpo_ate_id INTO v_ant FROM public.chat_conversas_limpas l WHERE l.auth_id = uid AND l.outro_auth_id = p_outro;
  INSERT INTO public.chat_conversas_limpas (auth_id, outro_auth_id, limpo_ate_id, limpo_em)
  VALUES (uid, p_outro, v_max, now())
  ON CONFLICT (auth_id, outro_auth_id) DO UPDATE SET limpo_ate_id = GREATEST(public.chat_conversas_limpas.limpo_ate_id, EXCLUDED.limpo_ate_id), limpo_em = now();
  INSERT INTO public.chat_conversas_ocultas (auth_id, outro_auth_id, oculto_em)
  VALUES (uid, p_outro, now())
  ON CONFLICT (auth_id, outro_auth_id) DO UPDATE SET oculto_em = now();
  RETURN COALESCE(v_ant, 0);
END;
$$;

-- Desfazer: volta o corte para o valor anterior (nunca para frente) e reexibe a conversa.
CREATE OR REPLACE FUNCTION public.chat_desfazer_apagar_conversa(p_outro uuid, p_anterior int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF COALESCE(p_anterior, 0) <= 0 THEN
    DELETE FROM public.chat_conversas_limpas WHERE auth_id = uid AND outro_auth_id = p_outro;
  ELSE
    UPDATE public.chat_conversas_limpas SET limpo_ate_id = LEAST(limpo_ate_id, p_anterior), limpo_em = now()
     WHERE auth_id = uid AND outro_auth_id = p_outro;
  END IF;
  DELETE FROM public.chat_conversas_ocultas WHERE auth_id = uid AND outro_auth_id = p_outro;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_bloqueio_estado(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_bloquear(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_desbloquear(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_apagar_conversa_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_desfazer_apagar_conversa(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_bloqueio_estado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_bloquear(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_desbloquear(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_apagar_conversa_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_desfazer_apagar_conversa(uuid, int) TO authenticated;

-- 4) Histórico e lista respeitam o corte ------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dm_pagina(
  p_outro uuid,
  p_antes_id int DEFAULT NULL,
  p_limit int DEFAULT 40
)
RETURNS SETOF public.chat_mensagens
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.*
    FROM public.chat_mensagens m
   WHERE ((m.de_auth_id = auth.uid() AND m.para_auth_id = p_outro)
       OR (m.de_auth_id = p_outro AND m.para_auth_id = auth.uid()))
     AND (p_antes_id IS NULL OR m.id < p_antes_id)
     AND m.id > COALESCE((SELECT l.limpo_ate_id FROM public.chat_conversas_limpas l
                           WHERE l.auth_id = auth.uid() AND l.outro_auth_id = p_outro), 0)
     AND NOT (auth.uid() = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
     AND (m.de_auth_id = auth.uid() OR COALESCE(m.status, 'enviada') <> 'agendada')
     AND NOT (COALESCE(m.moderacao, '') = 'removida' AND m.deleted_at IS NULL)
   ORDER BY m.id DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 200));
$$;
REVOKE ALL ON FUNCTION public.chat_dm_pagina(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_dm_pagina(uuid, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_inbox_v1(p_limit int DEFAULT 200)
RETURNS TABLE (
  peer_auth_id uuid,
  peer_nome text,
  peer_apelido text,
  peer_papeis text[],
  peer_tipo text,
  contato_apelido text,
  last_id int,
  last_de_auth_id uuid,
  last_texto text,
  last_tipo text,
  last_criado_em timestamptz,
  last_deleted boolean,
  nao_lidas int,
  peer_ultima_lida_id int,
  peer_ultima_entregue_id int,
  oculto boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  msgs0 AS (
    SELECT m.*,
           CASE WHEN m.de_auth_id = me.uid THEN m.para_auth_id ELSE m.de_auth_id END AS peer
      FROM public.chat_mensagens m, me
     WHERE me.uid IS NOT NULL
       AND (m.de_auth_id = me.uid
            OR (m.para_auth_id = me.uid AND COALESCE(m.status,'enviada') <> 'agendada'))
       AND m.para_auth_id IS NOT NULL
       AND NOT (me.uid = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
  ),
  msgs AS (
    SELECT x.*
      FROM msgs0 x
      LEFT JOIN public.chat_conversas_limpas cl
        ON cl.auth_id = (SELECT uid FROM me) AND cl.outro_auth_id = x.peer
     WHERE x.id > COALESCE(cl.limpo_ate_id, 0)
  ),
  last_by_peer AS (
    SELECT DISTINCT ON (peer) peer, id, de_auth_id, texto, tipo, criado_em, deleted_at
      FROM msgs
     ORDER BY peer, id DESC
  ),
  peers AS (
    SELECT peer FROM last_by_peer
    UNION
    SELECT c.contato_auth_id FROM public.chat_contatos c, me WHERE c.auth_id = me.uid
  )
  SELECT
    p.peer,
    COALESCE(NULLIF(trim(u.nome), ''), 'Usuário'),
    NULLIF(trim(u.apelido), ''),
    COALESCE(u.papeis, '{}'::text[]),
    COALESCE(u.tipo, 'operador'),
    ct.apelido,
    l.id,
    l.de_auth_id,
    CASE WHEN l.deleted_at IS NOT NULL THEN '' ELSE left(COALESCE(l.texto, ''), 140) END,
    l.tipo,
    l.criado_em,
    (l.deleted_at IS NOT NULL),
    (SELECT count(*)::int
       FROM msgs x
       LEFT JOIN public.chat_leituras r
         ON r.auth_id = (SELECT uid FROM me) AND r.com_auth_id = p.peer
      WHERE x.peer = p.peer
        AND x.de_auth_id = p.peer
        AND x.deleted_at IS NULL
        AND x.id > COALESCE(r.ultima_lida_id, 0)),
    pr.ultima_lida_id,
    pr.ultima_entregue_id,
    (oc.oculto_em IS NOT NULL AND (l.criado_em IS NULL OR l.criado_em <= oc.oculto_em))
  FROM peers p
  LEFT JOIN last_by_peer l ON l.peer = p.peer
  LEFT JOIN public.usuarios u ON u.auth_id = p.peer
  LEFT JOIN public.chat_contatos ct ON ct.auth_id = (SELECT uid FROM me) AND ct.contato_auth_id = p.peer
  LEFT JOIN public.chat_leituras pr ON pr.auth_id = p.peer AND pr.com_auth_id = (SELECT uid FROM me)
  LEFT JOIN public.chat_conversas_ocultas oc ON oc.auth_id = (SELECT uid FROM me) AND oc.outro_auth_id = p.peer
  WHERE p.peer IS NOT NULL
  ORDER BY l.id DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
$$;
REVOKE ALL ON FUNCTION public.chat_inbox_v1(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_inbox_v1(int) TO authenticated;

-- 5) Canais privados: nega dm:<a>:<b> quando há bloqueio entre os dois -------
CREATE OR REPLACE FUNCTION public.chat_rt_topico_ok(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  parts text[];
  ok boolean;
BEGIN
  IF uid IS NULL OR p_topic IS NULL THEN
    RETURN false;
  END IF;
  IF p_topic = 'minera:online' THEN
    RETURN true;
  END IF;
  IF p_topic LIKE 'dm:%' THEN
    parts := string_to_array(p_topic, ':');
    IF array_length(parts, 1) <> 3 THEN RETURN false; END IF;
    IF NOT (parts[2]::uuid < parts[3]::uuid AND (uid = parts[2]::uuid OR uid = parts[3]::uuid)) THEN
      RETURN false;
    END IF;
    RETURN NOT public.chat_ha_bloqueio(parts[2]::uuid, parts[3]::uuid);
  END IF;
  IF p_topic LIKE 'conv:%' AND to_regprocedure('public.chat_eh_membro(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.chat_eh_membro($1, $2)' INTO ok USING substr(p_topic, 6)::uuid, uid;
    RETURN COALESCE(ok, false);
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_rt_topico_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_rt_topico_ok(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verificação: deve retornar tabelas=2, rpcs=5, gatilho=1
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
     AND table_name IN ('chat_bloqueios', 'chat_conversas_limpas')) AS tabelas,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('chat_bloqueio_estado', 'chat_bloquear', 'chat_desbloquear',
          'chat_apagar_conversa_v2', 'chat_desfazer_apagar_conversa')) AS rpcs,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_chat_mensagens_bloqueio') AS gatilho;
