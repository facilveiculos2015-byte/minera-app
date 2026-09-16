-- =====================================================================
-- MINERA APP - 28 Chat message actions (reply / hide / soft-delete)
-- Incremental. Idempotente. NÃO wipe.
-- Rodar após 27-chat-audio-fix.sql.
-- =====================================================================

-- 1) Reply + per-user hide array
ALTER TABLE chat_mensagens
  ADD COLUMN IF NOT EXISTS resposta_a_id INT;

ALTER TABLE chat_mensagens
  ADD COLUMN IF NOT EXISTS apagada_para UUID[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_chat_resposta_a
  ON chat_mensagens(resposta_a_id)
  WHERE resposta_a_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_apagada_para
  ON chat_mensagens USING GIN (apagada_para);

COMMENT ON COLUMN chat_mensagens.resposta_a_id IS
  'ID da mensagem citada (Responder / quote).';
COMMENT ON COLUMN chat_mensagens.apagada_para IS
  'auth_ids que apagaram esta mensagem só para si (Apagar para mim).';

-- 2) Hide whole DM thread for current user
CREATE TABLE IF NOT EXISTS chat_conversas_ocultas (
  auth_id UUID NOT NULL,
  outro_auth_id UUID NOT NULL,
  oculto_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (auth_id, outro_auth_id),
  CONSTRAINT chat_conversas_ocultas_no_self CHECK (auth_id <> outro_auth_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_ocultas_auth
  ON chat_conversas_ocultas(auth_id);

ALTER TABLE chat_conversas_ocultas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_conv_ocultas_select_own" ON chat_conversas_ocultas;
DROP POLICY IF EXISTS "chat_conv_ocultas_insert_own" ON chat_conversas_ocultas;
DROP POLICY IF EXISTS "chat_conv_ocultas_update_own" ON chat_conversas_ocultas;
DROP POLICY IF EXISTS "chat_conv_ocultas_delete_own" ON chat_conversas_ocultas;

CREATE POLICY "chat_conv_ocultas_select_own" ON chat_conversas_ocultas
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

CREATE POLICY "chat_conv_ocultas_insert_own" ON chat_conversas_ocultas
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "chat_conv_ocultas_update_own" ON chat_conversas_ocultas
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "chat_conv_ocultas_delete_own" ON chat_conversas_ocultas
  FOR DELETE TO authenticated
  USING (auth_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_conversas_ocultas TO authenticated;

-- 3) SELECT: participante/admin; oculta só se uid ∈ apagada_para
--    deleted_at permanece visível → UI mostra “Mensagem apagada”
DROP POLICY IF EXISTS "chat_select_participant_or_admin" ON chat_mensagens;

CREATE POLICY "chat_select_participant_or_admin" ON chat_mensagens
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      (
        de_auth_id = auth.uid()
        OR (
          para_auth_id = auth.uid()
          AND COALESCE(status, 'enviada') IS DISTINCT FROM 'agendada'
        )
      )
      AND NOT (auth.uid() = ANY (COALESCE(apagada_para, '{}'::uuid[])))
    )
  );

-- 4) UPDATE: remetente/admin OU participante (trigger restringe destinatário)
DROP POLICY IF EXISTS "chat_update_own_or_admin" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_update_participant_soft" ON chat_mensagens;

CREATE POLICY "chat_update_participant_soft" ON chat_mensagens
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR de_auth_id = auth.uid()
    OR para_auth_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR de_auth_id = auth.uid()
    OR para_auth_id = auth.uid()
  );

-- 5) Trigger: trava de_/para + destinatário só apagada_para
CREATE OR REPLACE FUNCTION public.chat_mensagens_lock_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_adm boolean := public.is_admin();
BEGIN
  IF NEW.de_auth_id IS DISTINCT FROM OLD.de_auth_id THEN
    RAISE EXCEPTION 'chat: de_auth_id imutável';
  END IF;
  IF NEW.para_auth_id IS DISTINCT FROM OLD.para_auth_id THEN
    RAISE EXCEPTION 'chat: para_auth_id imutável';
  END IF;

  -- RPCs SECURITY DEFINER (owner postgres) podem soft-delete em massa
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NOT is_adm AND uid IS NOT NULL AND OLD.de_auth_id IS DISTINCT FROM uid THEN
    IF NEW.texto IS DISTINCT FROM OLD.texto
      OR NEW.tipo IS DISTINCT FROM OLD.tipo
      OR NEW.midia_url IS DISTINCT FROM OLD.midia_url
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.agendado_para IS DISTINCT FROM OLD.agendado_para
      OR NEW.moderacao IS DISTINCT FROM OLD.moderacao
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.resposta_a_id IS DISTINCT FROM OLD.resposta_a_id
      OR NEW.de_nome IS DISTINCT FROM OLD.de_nome
    THEN
      RAISE EXCEPTION 'chat: destinatário só pode ocultar (apagada_para)';
    END IF;
    IF NOT (uid = ANY (COALESCE(NEW.apagada_para, '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'chat: apagada_para deve incluir o próprio usuário';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(COALESCE(OLD.apagada_para, '{}'::uuid[])) AS x(u)
      WHERE NOT (x.u = ANY (COALESCE(NEW.apagada_para, '{}'::uuid[])))
    ) THEN
      RAISE EXCEPTION 'chat: não remova entradas de apagada_para';
    END IF;
  END IF;

  IF NOT is_adm AND uid IS NOT NULL AND OLD.de_auth_id = uid THEN
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'chat: não restaure mensagem apagada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mensagens_lock_ids ON chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_lock_ids
  BEFORE UPDATE ON chat_mensagens
  FOR EACH ROW
  EXECUTE PROCEDURE public.chat_mensagens_lock_ids();

-- 6) RPCs
CREATE OR REPLACE FUNCTION public.chat_apagar_para_mim(p_msg_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m chat_mensagens%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  SELECT * INTO m FROM chat_mensagens WHERE id = p_msg_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'mensagem não encontrada'; END IF;
  IF m.de_auth_id IS DISTINCT FROM uid AND m.para_auth_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;
  UPDATE chat_mensagens
  SET apagada_para = CASE
    WHEN uid = ANY (COALESCE(apagada_para, '{}'::uuid[])) THEN apagada_para
    ELSE array_append(COALESCE(apagada_para, '{}'::uuid[]), uid)
  END
  WHERE id = p_msg_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_apagar_para_todos(p_msg_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m chat_mensagens%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  SELECT * INTO m FROM chat_mensagens WHERE id = p_msg_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'mensagem não encontrada'; END IF;
  IF m.de_auth_id IS DISTINCT FROM uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'só o remetente pode apagar para todos';
  END IF;
  UPDATE chat_mensagens
  SET deleted_at = COALESCE(deleted_at, now()),
      texto = '',
      midia_url = NULL
  WHERE id = p_msg_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_ocultar_conversa(p_outro uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF p_outro IS NULL OR p_outro = uid THEN RAISE EXCEPTION 'contato inválido'; END IF;
  INSERT INTO chat_conversas_ocultas (auth_id, outro_auth_id, oculto_em)
  VALUES (uid, p_outro, now())
  ON CONFLICT (auth_id, outro_auth_id) DO UPDATE SET oculto_em = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_apagar_historico_para_todos(p_outro uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF p_outro IS NULL OR p_outro = uid THEN RAISE EXCEPTION 'contato inválido'; END IF;
  -- Soft-delete + esconde dos dois (apagada_para)
  UPDATE chat_mensagens
  SET deleted_at = COALESCE(deleted_at, now()),
      texto = '',
      midia_url = NULL,
      apagada_para = (
        SELECT ARRAY(
          SELECT DISTINCT u
          FROM unnest(
            COALESCE(apagada_para, '{}'::uuid[]) || ARRAY[uid, p_outro]
          ) AS u
        )
      )
  WHERE deleted_at IS NULL
    AND (
      (de_auth_id = uid AND para_auth_id = p_outro)
      OR (de_auth_id = p_outro AND para_auth_id = uid)
    );
  INSERT INTO chat_conversas_ocultas (auth_id, outro_auth_id, oculto_em)
  VALUES (uid, p_outro, now()), (p_outro, uid, now())
  ON CONFLICT (auth_id, outro_auth_id) DO UPDATE SET oculto_em = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_desocultar_conversa(p_outro uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  DELETE FROM chat_conversas_ocultas
  WHERE auth_id = auth.uid() AND outro_auth_id = p_outro;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_apagar_para_mim(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_apagar_para_todos(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_ocultar_conversa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_apagar_historico_para_todos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_desocultar_conversa(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.chat_apagar_para_mim(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_apagar_para_todos(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ocultar_conversa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_apagar_historico_para_todos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_desocultar_conversa(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE chat_mensagens TO authenticated;

COMMENT ON FUNCTION public.chat_apagar_para_mim(int) IS
  'Oculta mensagem só para o usuário atual (apagada_para).';
COMMENT ON FUNCTION public.chat_apagar_para_todos(int) IS
  'Soft-delete (deleted_at) — só remetente/admin; UI mostra Mensagem apagada.';
COMMENT ON FUNCTION public.chat_ocultar_conversa(uuid) IS
  'Apagar conversa para mim (some da lista).';
COMMENT ON FUNCTION public.chat_apagar_historico_para_todos(uuid) IS
  'Apaga histórico do DM para os dois lados.';
