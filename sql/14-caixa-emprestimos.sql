-- =====================================================================
-- MINERA APP - 14 Caixa Minera + Empréstimos
-- Incremental. Idempotente. NÃO wipe. Rodar após 13-bloqueio-cotacoes.sql.
-- =====================================================================

CREATE TABLE IF NOT EXISTS emprestimos (
  id SERIAL PRIMARY KEY,
  auth_id UUID NOT NULL,
  nome TEXT,
  telefone TEXT,
  valor NUMERIC NOT NULL,
  prazo_dias INT NOT NULL,
  finalidade TEXT,
  renda_declarada NUMERIC,
  observacoes TEXT,
  juros_pct NUMERIC DEFAULT 15,
  total_previsto NUMERIC,
  status TEXT DEFAULT 'analise', -- analise|aprovado|rejeitado|pago
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emprestimos_auth ON emprestimos(auth_id);
CREATE INDEX IF NOT EXISTS idx_emprestimos_status ON emprestimos(status);

CREATE TABLE IF NOT EXISTS caixa_saldos (
  id SERIAL PRIMARY KEY,
  auth_id UUID NOT NULL UNIQUE,
  saldo NUMERIC NOT NULL DEFAULT 0,
  taxa_mensal NUMERIC DEFAULT 0.5,
  last_yield_at TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_saldos_auth ON caixa_saldos(auth_id);

CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id SERIAL PRIMARY KEY,
  auth_id UUID NOT NULL,
  tipo TEXT NOT NULL, -- deposito|saque|rendimento|emprestimo
  valor NUMERIC NOT NULL,
  saldo_apos NUMERIC,
  observacao TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_movimentos_auth_em
  ON caixa_movimentos (auth_id, criado_em DESC);

ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_saldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_movimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emprestimos_select_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_insert_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_update_auth" ON emprestimos;
CREATE POLICY "emprestimos_select_auth" ON emprestimos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "emprestimos_insert_auth" ON emprestimos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "emprestimos_update_auth" ON emprestimos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "caixa_saldos_select_auth" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_insert_auth" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_update_auth" ON caixa_saldos;
CREATE POLICY "caixa_saldos_select_auth" ON caixa_saldos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "caixa_saldos_insert_auth" ON caixa_saldos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "caixa_saldos_update_auth" ON caixa_saldos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "caixa_movimentos_select_auth" ON caixa_movimentos;
DROP POLICY IF EXISTS "caixa_movimentos_insert_auth" ON caixa_movimentos;
CREATE POLICY "caixa_movimentos_select_auth" ON caixa_movimentos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "caixa_movimentos_insert_auth" ON caixa_movimentos
  FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE emprestimos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE emprestimos_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE caixa_saldos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE caixa_saldos_id_seq TO authenticated;

GRANT SELECT, INSERT ON TABLE caixa_movimentos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE caixa_movimentos_id_seq TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
