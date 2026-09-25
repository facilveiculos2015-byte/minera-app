-- =====================================================================
-- MINERA PARÁ - 44 Chat: base de tempo real + correções (BUILD 1 "Fluidez")
-- Incremental. Idempotente (pode rodar 2x). NÃO wipe. NÃO altera dados
-- existentes (só adiciona colunas/índices/funções/policies). Rodar após 43
-- (ou após 44a, se o hotfix já foi aplicado — 44 inclui o 44a inteiro).
--
-- COMPATIBILIDADE COM O APP JÁ PUBLICADO (≤ 20260925b) — testado numa
-- réplica local (PostgREST + supabase-js reproduzindo as chamadas exatas
-- do chat.js/nav.js/admin.js antigos):
--   * insert antigo {de_auth_id,de_nome,texto,tipo,midia_url,para_auth_id,
--     status,agendado_para,resposta_a_id} continua passando. O limite de
--     4000 caracteres vale SÓ para `texto`; `midia_url` (inclusive
--     data: URL de fallback antigo) NÃO é limitado aqui.
--   * "Apagar para todos" (RPC chat_apagar_para_todos) funciona a QUALQUER
--     momento (a janela de 15 min vale só para EDITAR texto). Soft-delete
--     direto pelo remetente (deleted_at + texto '' + midia_url NULL) também.
--   * "Apagar para mim" (RPC chat_apagar_para_mim) funciona p/ remetente e
--     destinatário; ocultar/desocultar/apagar histórico idem.
--   * Promover agendada (update status→enviada pelo remetente) ok.
--   * Moderação admin (update deleted_at/moderacao) ok.
--   * upsert antigo em chat_leituras {auth_id,com_auth_id,ultima_lida_id,
--     lido_em} ok.
--   O app 20260925c+ detecta este SQL sozinho (RPC chat_inbox_v1) e passa a
--   usar RPCs + Realtime; sem ele, usa as consultas legadas corrigidas.
--
-- O que faz:
--  1) Corrige regressão de RLS: SQL 32/35 recriaram o SELECT de
--     chat_mensagens SEM esconder 'agendada' do destinatário e SEM
--     respeitar apagada_para (regras do SQL 19/28). Restaura as duas.
--  2) client_id (uuid gerado no aparelho) + índice único → envio
--     idempotente (retry offline não duplica mensagem).
--  3) Trigger BEFORE INSERT: criado_em e de_nome definidos pelo servidor
--     (anti-falsificação de nome/horário), zera campos de moderação no
--     insert, limita tamanho do TEXTO (4000).
--  3b) CRÍTICO: trigger chat_mensagens_lock_ids (SQL 28) é SECURITY
--     DEFINER → dentro dele current_user é sempre 'postgres' e o
--     "IF current_user IN ('postgres',...) RETURN NEW" libera TUDO.
--     Resultado: o DESTINATÁRIO consegue reescrever texto/mídia/status
--     de mensagens que recebeu (reproduzido em réplica local). Recriado
--     como SECURITY INVOKER + regras de edição do remetente (15 min).
--  4) Índices para abrir conversa por par (DM) com paginação por id.
--  5) chat_leituras: ultima_entregue_id + policy p/ o outro lado ler
--     (ticks entregue/lida).
--  6) RPCs: chat_inbox_v1 (lista de conversas em 1 chamada),
--     chat_dm_pagina (histórico paginado), chat_marcar_lido,
--     chat_marcar_entregue_tudo.
--  7) Publicação supabase_realtime: chat_mensagens + chat_leituras
--     (hoje NENHUMA tabela está publicada — testado em 25/09/2026).
--  8) Policies em realtime.messages p/ canais PRIVADOS:
--       dm:<uuidMenor>:<uuidMaior>  (digitando/gravando entre 2 pessoas)
--       minera:online               (presença global, só autenticados)
--
-- Observação: CREATE INDEX sem CONCURRENTLY (SQL Editor roda em transação);
-- a tabela é pequena → lock de poucos ms.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) SELECT correto (participante; destinatário não vê 'agendada';
--    quem apagou "para mim" não vê mais). Admin continua vendo tudo.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_select_participant_or_admin" ON public.chat_mensagens;
CREATE POLICY "chat_select_participant_or_admin" ON public.chat_mensagens
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      (
        de_auth_id = (SELECT auth.uid())
        OR (
          para_auth_id = (SELECT auth.uid())
          AND COALESCE(status, 'enviada') IS DISTINCT FROM 'agendada'
        )
      )
      AND NOT ((SELECT auth.uid()) = ANY (COALESCE(apagada_para, '{}'::uuid[])))
    )
  );

-- ---------------------------------------------------------------------
-- 2) Idempotência de envio
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_mensagens ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_client_id
  ON public.chat_mensagens (de_auth_id, client_id)
  WHERE client_id IS NOT NULL;
COMMENT ON COLUMN public.chat_mensagens.client_id IS
  'UUID gerado no aparelho antes do envio. Reenvio com o mesmo client_id falha com 23505 → cliente trata como "já enviado".';

-- ---------------------------------------------------------------------
-- 3) Trigger BEFORE INSERT (defesa em profundidade)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_mensagens_bi_sanear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
BEGIN
  -- Scripts do SQL Editor / service_role passam direto
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.criado_em := now();

  SELECT COALESCE(NULLIF(trim(u.apelido), ''), NULLIF(trim(u.nome), ''), 'Usuário')
    INTO v_nome
    FROM public.usuarios u
   WHERE u.auth_id = auth.uid()
   LIMIT 1;
  NEW.de_nome := COALESCE(v_nome, NEW.de_nome, 'Usuário');

  IF NOT public.is_admin() THEN
    NEW.moderacao := NULL;
    NEW.deleted_at := NULL;
    NEW.apagada_para := '{}'::uuid[];
  END IF;

  IF NEW.texto IS NOT NULL AND length(NEW.texto) > 4000 THEN
    RAISE EXCEPTION 'chat: mensagem muito longa (máx. 4000 caracteres)'
      USING ERRCODE = '22001';
  END IF;

  IF COALESCE(NEW.status, 'enviada') NOT IN ('enviada', 'agendada') THEN
    NEW.status := 'enviada';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mensagens_bi_sanear ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_bi_sanear
  BEFORE INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_bi_sanear();


-- ---------------------------------------------------------------------
-- 3b) Trigger de UPDATE corrigido (SECURITY INVOKER!)
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_mensagens ADD COLUMN IF NOT EXISTS editado_em timestamptz;

CREATE OR REPLACE FUNCTION public.chat_mensagens_lock_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER            -- <<< antes era DEFINER (bug)
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_adm boolean;
BEGIN
  IF NEW.de_auth_id IS DISTINCT FROM OLD.de_auth_id THEN
    RAISE EXCEPTION 'chat: de_auth_id imutável';
  END IF;
  IF NEW.para_auth_id IS DISTINCT FROM OLD.para_auth_id THEN
    RAISE EXCEPTION 'chat: para_auth_id imutável';
  END IF;

  -- RPCs SECURITY DEFINER (owner postgres) e SQL Editor passam
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR uid IS NULL THEN
    RETURN NEW;
  END IF;

  is_adm := public.is_admin();
  IF is_adm THEN
    RETURN NEW;
  END IF;

  -- Campos que ninguém (cliente) altera
  IF NEW.criado_em IS DISTINCT FROM OLD.criado_em
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.de_nome IS DISTINCT FROM OLD.de_nome
     OR NEW.moderacao IS DISTINCT FROM OLD.moderacao THEN
    RAISE EXCEPTION 'chat: campo imutável';
  END IF;

  IF OLD.de_auth_id IS DISTINCT FROM uid THEN
    -- Não-remetente (destinatário): só pode se adicionar em apagada_para
    IF NEW.texto IS DISTINCT FROM OLD.texto
      OR NEW.tipo IS DISTINCT FROM OLD.tipo
      OR NEW.midia_url IS DISTINCT FROM OLD.midia_url
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.agendado_para IS DISTINCT FROM OLD.agendado_para
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.resposta_a_id IS DISTINCT FROM OLD.resposta_a_id
      OR NEW.editado_em IS DISTINCT FROM OLD.editado_em
    THEN
      RAISE EXCEPTION 'chat: destinatário só pode ocultar (apagada_para)';
    END IF;
    IF NOT (uid = ANY (COALESCE(NEW.apagada_para, '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'chat: apagada_para deve incluir o próprio usuário';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(COALESCE(OLD.apagada_para, '{}'::uuid[])) AS x(u)
       WHERE NOT (x.u = ANY (COALESCE(NEW.apagada_para, '{}'::uuid[])))
    ) OR EXISTS (
      SELECT 1 FROM unnest(COALESCE(NEW.apagada_para, '{}'::uuid[])) AS y(u)
       WHERE y.u <> uid AND NOT (y.u = ANY (COALESCE(OLD.apagada_para, '{}'::uuid[])))
    ) THEN
      RAISE EXCEPTION 'chat: só pode adicionar a si mesmo em apagada_para';
    END IF;
    RETURN NEW;
  END IF;

  -- Remetente
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'chat: não restaure mensagem apagada';
  END IF;
  IF NEW.texto IS DISTINCT FROM OLD.texto AND NEW.deleted_at IS NULL THEN
    IF COALESCE(OLD.status, 'enviada') <> 'agendada' THEN
      IF COALESCE(OLD.tipo, 'text') NOT IN ('text', 'agendada') THEN
        RAISE EXCEPTION 'chat: só mensagens de texto podem ser editadas';
      END IF;
      IF OLD.criado_em < now() - interval '15 minutes' THEN
        RAISE EXCEPTION 'chat: prazo de edição (15 min) expirou';
      END IF;
    END IF;
    NEW.editado_em := now();
  END IF;
  IF NEW.midia_url IS DISTINCT FROM OLD.midia_url AND NEW.midia_url IS NOT NULL THEN
    RAISE EXCEPTION 'chat: mídia não pode ser trocada';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mensagens_lock_ids ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_lock_ids
  BEFORE UPDATE ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_lock_ids();

-- ---------------------------------------------------------------------
-- 4) Índices (abrir DM paginado por id; inbox do remetente)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chat_de_para_id
  ON public.chat_mensagens (de_auth_id, para_auth_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_para_de_id
  ON public.chat_mensagens (para_auth_id, de_auth_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_de_id
  ON public.chat_mensagens (de_auth_id, id DESC);
-- idx_chat_de_para (18) e idx_chat_status (10) ficam redundantes; não
-- removidos aqui por segurança (remover num build futuro após medir).

-- ---------------------------------------------------------------------
-- 5) chat_leituras: entregue + leitura visível ao outro lado (ticks)
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_leituras ADD COLUMN IF NOT EXISTS ultima_entregue_id int;
ALTER TABLE public.chat_leituras ADD COLUMN IF NOT EXISTS entregue_em timestamptz;

DROP POLICY IF EXISTS "chat_leituras_select_peer" ON public.chat_leituras;
CREATE POLICY "chat_leituras_select_peer" ON public.chat_leituras
  FOR SELECT TO authenticated
  USING (com_auth_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_chat_leituras_com ON public.chat_leituras (com_auth_id);

-- ---------------------------------------------------------------------
-- 6) RPCs
-- ---------------------------------------------------------------------

-- 6a) Lista de conversas em UMA chamada (substitui 4–5 requests por poll):
--     último msg por par, não-lidas pelo servidor, perfil público do par,
--     contatos sem mensagens, ocultação (chat_conversas_ocultas).
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
  msgs AS (
    SELECT m.*,
           CASE WHEN m.de_auth_id = me.uid THEN m.para_auth_id ELSE m.de_auth_id END AS peer
      FROM public.chat_mensagens m, me
     WHERE me.uid IS NOT NULL
       AND (m.de_auth_id = me.uid
            OR (m.para_auth_id = me.uid AND COALESCE(m.status,'enviada') <> 'agendada'))
       AND m.para_auth_id IS NOT NULL
       AND NOT (me.uid = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
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

-- 6b) Histórico do DM paginado (keyset por id). SECURITY INVOKER → RLS vale.
--     p_antes_id NULL = mais recentes; retorna em ordem DESC (cliente inverte).
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
     AND NOT (auth.uid() = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
     AND (m.de_auth_id = auth.uid() OR COALESCE(m.status, 'enviada') <> 'agendada')
     AND NOT (COALESCE(m.moderacao, '') = 'removida' AND m.deleted_at IS NULL)
   ORDER BY m.id DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 200));
$$;
REVOKE ALL ON FUNCTION public.chat_dm_pagina(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_dm_pagina(uuid, int, int) TO authenticated;

-- 6c) Marcar lido (só avança; nunca retrocede). Também marca entregue.
CREATE OR REPLACE FUNCTION public.chat_marcar_lido(p_outro uuid, p_ate_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR p_outro IS NULL OR p_outro = uid OR p_ate_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.chat_leituras AS r
         (auth_id, com_auth_id, ultima_lida_id, lido_em, ultima_entregue_id, entregue_em)
  VALUES (uid, p_outro, p_ate_id, now(), p_ate_id, now())
  ON CONFLICT (auth_id, com_auth_id) DO UPDATE
     SET ultima_lida_id     = GREATEST(COALESCE(r.ultima_lida_id, 0), EXCLUDED.ultima_lida_id),
         lido_em            = CASE WHEN EXCLUDED.ultima_lida_id > COALESCE(r.ultima_lida_id, 0)
                                   THEN now() ELSE r.lido_em END,
         ultima_entregue_id = GREATEST(COALESCE(r.ultima_entregue_id, 0), EXCLUDED.ultima_entregue_id),
         entregue_em        = now()
   WHERE COALESCE(r.ultima_lida_id, 0) < EXCLUDED.ultima_lida_id
      OR COALESCE(r.ultima_entregue_id, 0) < EXCLUDED.ultima_entregue_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_marcar_lido(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_marcar_lido(uuid, int) TO authenticated;

-- 6d) Marcar ENTREGUE tudo que chegou (ao abrir o app / ao receber via realtime)
CREATE OR REPLACE FUNCTION public.chat_marcar_entregue_tudo()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.chat_leituras AS r (auth_id, com_auth_id, ultima_lida_id, lido_em, ultima_entregue_id, entregue_em)
  SELECT uid, m.de_auth_id, NULL, NULL, max(m.id), now()
    FROM public.chat_mensagens m
   WHERE m.para_auth_id = uid
     AND m.de_auth_id IS NOT NULL
     AND m.de_auth_id <> uid
     AND COALESCE(m.status, 'enviada') <> 'agendada'
   GROUP BY m.de_auth_id
  ON CONFLICT (auth_id, com_auth_id) DO UPDATE
     SET ultima_entregue_id = GREATEST(COALESCE(r.ultima_entregue_id, 0), EXCLUDED.ultima_entregue_id),
         entregue_em = now()
   WHERE COALESCE(r.ultima_entregue_id, 0) < EXCLUDED.ultima_entregue_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_marcar_entregue_tudo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_marcar_entregue_tudo() TO authenticated;

-- ---------------------------------------------------------------------
-- 7) Realtime: publicar tabelas (idempotente)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'publication supabase_realtime não existe — ative Realtime no dashboard';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['chat_mensagens', 'chat_leituras'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 8) Canais privados (Broadcast/Presence) — autorização por tópico
-- ---------------------------------------------------------------------
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
    RETURN parts[2]::uuid < parts[3]::uuid
       AND (uid = parts[2]::uuid OR uid = parts[3]::uuid);
  END IF;
  -- conv:<uuid> (grupos/anúncios) — ativo quando o SQL 45 existir
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

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'realtime' AND table_name = 'messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS "minera_chat_rt_select" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "minera_chat_rt_insert" ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY "minera_chat_rt_select" ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.messages.extension IN ('broadcast', 'presence')
          AND public.chat_rt_topico_ok((SELECT realtime.topic()))
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "minera_chat_rt_insert" ON realtime.messages
        FOR INSERT TO authenticated
        WITH CHECK (
          realtime.messages.extension IN ('broadcast', 'presence')
          AND public.chat_rt_topico_ok((SELECT realtime.topic()))
        )
    $p$;
  ELSE
    RAISE NOTICE 'realtime.messages não encontrado — canais privados indisponíveis';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_mensagens TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_leituras TO authenticated;
