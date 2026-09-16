-- =====================================================================
-- MINERA APP - 19 Fixes RLS chat DM (após 18-chat-contatos-dms.sql)
-- Incremental. Idempotente. NÃO wipe.
-- Corrige: INSERT sem destinatário; SELECT de agendada pelo receptor;
-- UPDATE que poderia alterar de_/para_auth_id.
-- =====================================================================

-- 1) SELECT: participante ou admin; destinatário NÃO vê status=agendada
DROP POLICY IF EXISTS "chat_select_participant_or_admin" ON chat_mensagens;

CREATE POLICY "chat_select_participant_or_admin" ON chat_mensagens
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR de_auth_id = auth.uid()
    OR (
      para_auth_id = auth.uid()
      AND COALESCE(status, 'enviada') IS DISTINCT FROM 'agendada'
    )
  );

-- 2) INSERT: obrigatório DM (para_auth_id preenchido e ≠ remetente)
DROP POLICY IF EXISTS "chat_insert_own" ON chat_mensagens;

CREATE POLICY "chat_insert_own" ON chat_mensagens
  FOR INSERT TO authenticated
  WITH CHECK (
    de_auth_id = auth.uid()
    AND para_auth_id IS NOT NULL
    AND para_auth_id <> auth.uid()
  );

-- 3) UPDATE: só remetente/admin; trava identidade da thread via trigger
DROP POLICY IF EXISTS "chat_update_own_or_admin" ON chat_mensagens;

CREATE POLICY "chat_update_own_or_admin" ON chat_mensagens
  FOR UPDATE TO authenticated
  USING (de_auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (de_auth_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.chat_mensagens_lock_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Impede redirecionar DM mudando de_/para
  IF NEW.de_auth_id IS DISTINCT FROM OLD.de_auth_id THEN
    RAISE EXCEPTION 'chat: de_auth_id imutável';
  END IF;
  IF NEW.para_auth_id IS DISTINCT FROM OLD.para_auth_id THEN
    RAISE EXCEPTION 'chat: para_auth_id imutável';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mensagens_lock_ids ON chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_lock_ids
  BEFORE UPDATE ON chat_mensagens
  FOR EACH ROW
  EXECUTE PROCEDURE public.chat_mensagens_lock_ids();

-- 4) Soft-delete / moderação: admin já cobre via UPDATE policy
-- Garantir grants
GRANT SELECT, INSERT, UPDATE ON TABLE chat_mensagens TO authenticated;

-- 5) Índice útil p/ inbox do destinatário (não-agendada)
CREATE INDEX IF NOT EXISTS idx_chat_para_status
  ON chat_mensagens(para_auth_id, id DESC)
  WHERE deleted_at IS NULL;

COMMENT ON FUNCTION public.chat_mensagens_lock_ids() IS
  'Trava de_/para_auth_id em UPDATE — evita redirect de DM.';
