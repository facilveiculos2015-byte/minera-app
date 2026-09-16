-- =====================================================================
-- MINERA APP - 15 Caixa: depósitos Pix, saques, PIN, yield até 5%
-- Incremental. Idempotente. NÃO wipe. Rodar após 14-caixa-emprestimos.sql.
-- =====================================================================

-- PIN + yield (até 5% a.m. conforme cotação / config)
ALTER TABLE caixa_saldos ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE caixa_saldos ADD COLUMN IF NOT EXISTS pin_salt TEXT;
ALTER TABLE caixa_saldos ADD COLUMN IF NOT EXISTS taxa_yield_max NUMERIC DEFAULT 5;
ALTER TABLE caixa_saldos ALTER COLUMN taxa_mensal SET DEFAULT 5;

-- Pedidos de depósito (Pix → comprovante → admin confirma)
CREATE TABLE IF NOT EXISTS caixa_deposito_pedidos (
  id SERIAL PRIMARY KEY,
  auth_id UUID NOT NULL,
  valor NUMERIC NOT NULL,
  comprovante_url TEXT,
  pix_chave_usada TEXT,
  pix_titular TEXT,
  status TEXT DEFAULT 'pendente', -- pendente|confirmado|rejeitado
  admin_auth_id UUID,
  observacao TEXT,
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_dep_auth ON caixa_deposito_pedidos(auth_id);
CREATE INDEX IF NOT EXISTS idx_caixa_dep_status ON caixa_deposito_pedidos(status);

-- Pedidos de saque (valor + chave Pix destino → admin processa)
CREATE TABLE IF NOT EXISTS caixa_saque_pedidos (
  id SERIAL PRIMARY KEY,
  auth_id UUID NOT NULL,
  valor NUMERIC NOT NULL,
  chave_pix_destino TEXT NOT NULL,
  status TEXT DEFAULT 'pendente', -- pendente|pago|processado|rejeitado
  admin_auth_id UUID,
  observacao TEXT,
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caixa_saque_auth ON caixa_saque_pedidos(auth_id);
CREATE INDEX IF NOT EXISTS idx_caixa_saque_status ON caixa_saque_pedidos(status);

ALTER TABLE caixa_deposito_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_saque_pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caixa_dep_select_auth" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_insert_auth" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_update_auth" ON caixa_deposito_pedidos;
CREATE POLICY "caixa_dep_select_auth" ON caixa_deposito_pedidos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "caixa_dep_insert_auth" ON caixa_deposito_pedidos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "caixa_dep_update_auth" ON caixa_deposito_pedidos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "caixa_saque_select_auth" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_insert_auth" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_update_auth" ON caixa_saque_pedidos;
CREATE POLICY "caixa_saque_select_auth" ON caixa_saque_pedidos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "caixa_saque_insert_auth" ON caixa_saque_pedidos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "caixa_saque_update_auth" ON caixa_saque_pedidos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE caixa_deposito_pedidos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE caixa_deposito_pedidos_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE caixa_saque_pedidos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE caixa_saque_pedidos_id_seq TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
