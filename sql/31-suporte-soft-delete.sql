-- =====================================================================
-- MINERA APP - 31 Suporte soft-delete / arquivar / atendido
-- Incremental. Idempotente. NÃO wipe.
-- Rodar após 30-admin-credito.sql.
-- =====================================================================

-- Soft-delete + arquivar + marca de atendimento (admin inbox)
ALTER TABLE suporte_mensagens
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE suporte_mensagens
  ADD COLUMN IF NOT EXISTS arquivado BOOLEAN DEFAULT false;

ALTER TABLE suporte_mensagens
  ADD COLUMN IF NOT EXISTS atendido_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_suporte_deleted
  ON suporte_mensagens(deleted_at);

CREATE INDEX IF NOT EXISTS idx_suporte_arquivado
  ON suporte_mensagens(arquivado)
  WHERE COALESCE(arquivado, false) = true;

CREATE INDEX IF NOT EXISTS idx_suporte_ativo_thread
  ON suporte_mensagens(thread_auth_id, criado_em DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN suporte_mensagens.deleted_at IS
  'Soft-delete admin (Apagar no monitor). Mensagens com deleted_at não aparecem no Fale conosco.';
COMMENT ON COLUMN suporte_mensagens.arquivado IS
  'Arquivado / salvo pelo admin (some da inbox ativa).';
COMMENT ON COLUMN suporte_mensagens.atendido_em IS
  'Quando o admin marcou o pedido como atendido.';

-- UPDATE já é admin-only (suporte_update_admin em 17). Garante GRANT.
GRANT SELECT, INSERT, UPDATE ON TABLE suporte_mensagens TO authenticated;

-- Sem DELETE hard: soft-delete via UPDATE.deleted_at (RLS admin).
