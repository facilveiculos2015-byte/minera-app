-- =====================================================================
-- MINERA APP - 16 Suporte (Fale conosco) + Indicação / pontos
-- Incremental. Idempotente. NÃO wipe. Rodar após 15-caixa-depositos-saques-pin.sql.
-- =====================================================================

-- Mensagens do painel Fale conosco (Robô Minera + humano)
CREATE TABLE IF NOT EXISTS suporte_mensagens (
  id SERIAL PRIMARY KEY,
  de_auth_id UUID,
  de_nome TEXT,
  texto TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'user', -- user|bot|admin
  thread_auth_id UUID NOT NULL,
  lido_admin BOOLEAN DEFAULT false,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suporte_thread ON suporte_mensagens(thread_auth_id);
CREATE INDEX IF NOT EXISTS idx_suporte_criado ON suporte_mensagens(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_suporte_origem ON suporte_mensagens(origem);

ALTER TABLE suporte_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suporte_select_auth" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_insert_auth" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_update_auth" ON suporte_mensagens;
CREATE POLICY "suporte_select_auth" ON suporte_mensagens
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "suporte_insert_auth" ON suporte_mensagens
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "suporte_update_auth" ON suporte_mensagens
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE suporte_mensagens TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE suporte_mensagens_id_seq TO authenticated;

-- Indicação / Família Mineira
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_indicacao TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS indicado_por TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pontos_saldo NUMERIC DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_codigo_indicacao_uidx
  ON usuarios (codigo_indicacao) WHERE codigo_indicacao IS NOT NULL;

CREATE TABLE IF NOT EXISTS indicacao_pontos (
  id SERIAL PRIMARY KEY,
  auth_id UUID NOT NULL,
  pontos NUMERIC NOT NULL,
  motivo TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_indicacao_pontos_auth ON indicacao_pontos(auth_id);

ALTER TABLE indicacao_pontos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "indicacao_pontos_select_auth" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_insert_auth" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_update_auth" ON indicacao_pontos;
CREATE POLICY "indicacao_pontos_select_auth" ON indicacao_pontos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "indicacao_pontos_insert_auth" ON indicacao_pontos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "indicacao_pontos_update_auth" ON indicacao_pontos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE indicacao_pontos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE indicacao_pontos_id_seq TO authenticated;

-- Comissão: desconto por pontos (1 ponto = R$ 0,10)
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS desconto_pontos NUMERIC DEFAULT 0;
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS valor_comissao_original NUMERIC;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
