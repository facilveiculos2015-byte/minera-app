-- =====================================================================
-- MINERA APP - 12 Comissões 1% sobre venda (status expedido)
-- Incremental. Idempotente. NÃO wipe. Rodar após 11-mapa-coords.sql.
-- =====================================================================

CREATE TABLE IF NOT EXISTS comissoes (
  id SERIAL PRIMARY KEY,
  lote_id INT REFERENCES lotes(id),
  vendedor_auth_id UUID,
  vendedor_nome TEXT,
  valor_venda NUMERIC NOT NULL,
  valor_comissao NUMERIC NOT NULL,
  percentual NUMERIC DEFAULT 1,
  status TEXT DEFAULT 'pendente', -- pendente|pago|atrasado
  vencimento TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  pix_pagamento_id INT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- Uma comissão por lote (idempotência no app + unique)
CREATE UNIQUE INDEX IF NOT EXISTS comissoes_lote_id_uidx ON comissoes (lote_id)
  WHERE lote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comissoes_status ON comissoes(status);
CREATE INDEX IF NOT EXISTS idx_comissoes_vendedor ON comissoes(vendedor_auth_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_vencimento ON comissoes(vencimento);

ALTER TABLE comissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comissoes_select_auth" ON comissoes;
DROP POLICY IF EXISTS "comissoes_insert_auth" ON comissoes;
DROP POLICY IF EXISTS "comissoes_update_auth" ON comissoes;

CREATE POLICY "comissoes_select_auth" ON comissoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "comissoes_insert_auth" ON comissoes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "comissoes_update_auth" ON comissoes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE comissoes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE comissoes_id_seq TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
