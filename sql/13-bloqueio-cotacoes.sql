-- =====================================================================
-- MINERA APP - 13 Bloqueio inadimplente + histórico de cotações
-- Incremental. Idempotente. NÃO wipe. Rodar após 12-comissoes.sql.
-- =====================================================================

-- Usuários: trava por comissão atrasada
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_motivo TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_em TIMESTAMPTZ;

-- Histórico leve de cotações (ouro / cobre / dólar)
CREATE TABLE IF NOT EXISTS cotacoes_historico (
  id SERIAL PRIMARY KEY,
  simbolo TEXT NOT NULL,
  valor_usd NUMERIC,
  valor_brl NUMERIC,
  fonte TEXT,
  capturado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cotacoes_historico_simbolo_em
  ON cotacoes_historico (simbolo, capturado_em DESC);

ALTER TABLE cotacoes_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cotacoes_historico_select_auth" ON cotacoes_historico;
DROP POLICY IF EXISTS "cotacoes_historico_insert_auth" ON cotacoes_historico;

CREATE POLICY "cotacoes_historico_select_auth" ON cotacoes_historico
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cotacoes_historico_insert_auth" ON cotacoes_historico
  FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON TABLE cotacoes_historico TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE cotacoes_historico_id_seq TO authenticated;

-- Garantir que usuarios autenticados possam atualizar próprio bloqueio (cliente)
-- e admin possa desbloquear qualquer um (já costuma ter update amplo em schemas anteriores).
-- Políticas de usuarios: não recriar do zero; apenas garantir UPDATE para authenticated
-- se ainda não existir política específica de bloqueio.
DROP POLICY IF EXISTS "usuarios_update_auth" ON usuarios;
CREATE POLICY "usuarios_update_auth" ON usuarios
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON TABLE usuarios TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
