-- =====================================================================
-- MINERA APP - 06 completo (auth_id, chat, RLS MVP)
-- Rodar no SQL Editor do Supabase após 01–05
-- =====================================================================

-- 1) usuarios: vínculo com Supabase Auth
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE;

-- senha_hash: permitir Auth users (nullable + default)
ALTER TABLE usuarios ALTER COLUMN senha_hash DROP NOT NULL;
ALTER TABLE usuarios ALTER COLUMN senha_hash SET DEFAULT 'supabase-auth';
UPDATE usuarios SET senha_hash = 'supabase-auth' WHERE senha_hash IS NULL;

-- tipo default para novos cadastros via app
ALTER TABLE usuarios ALTER COLUMN tipo SET DEFAULT 'operador';

-- 2) lotes: já pode ter criado_por / criado_por_id (05); garante de novo
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS criado_por TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS criado_por_id UUID;

-- 3) chat da equipe
CREATE TABLE IF NOT EXISTS chat_mensagens (
    id SERIAL PRIMARY KEY,
    de_auth_id UUID,
    de_nome TEXT,
    texto TEXT NOT NULL,
    criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_mensagens_criado ON chat_mensagens(criado_em DESC);

-- 4) RLS enable
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE processamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE expedicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mensagens ENABLE ROW LEVEL SECURITY;

-- 5) Drop políticas antigas / conflitantes (safe IF EXISTS)
DROP POLICY IF EXISTS "Leitura geral para autenticados" ON usuarios;
DROP POLICY IF EXISTS "usuarios_select_auth" ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert_auth" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_own" ON usuarios;
DROP POLICY IF EXISTS "Permitir leitura publica de lotes" ON lotes;
DROP POLICY IF EXISTS "Permitir insercao publica de lotes" ON lotes;
DROP POLICY IF EXISTS "Leitura geral lotes" ON lotes;
DROP POLICY IF EXISTS "Inserir lotes equipe" ON lotes;
DROP POLICY IF EXISTS "lotes_select_auth" ON lotes;
DROP POLICY IF EXISTS "lotes_insert_auth" ON lotes;
DROP POLICY IF EXISTS "lotes_update_auth" ON lotes;
DROP POLICY IF EXISTS "Leitura processamento" ON processamento;
DROP POLICY IF EXISTS "Inserir processamento" ON processamento;
DROP POLICY IF EXISTS "proc_select_auth" ON processamento;
DROP POLICY IF EXISTS "proc_insert_auth" ON processamento;
DROP POLICY IF EXISTS "proc_update_auth" ON processamento;
DROP POLICY IF EXISTS "Leitura estoque" ON estoque;
DROP POLICY IF EXISTS "estoque_select_auth" ON estoque;
DROP POLICY IF EXISTS "estoque_insert_auth" ON estoque;
DROP POLICY IF EXISTS "estoque_update_auth" ON estoque;
DROP POLICY IF EXISTS "Leitura expedicao" ON expedicao;
DROP POLICY IF EXISTS "expedicao_select_auth" ON expedicao;
DROP POLICY IF EXISTS "expedicao_insert_auth" ON expedicao;
DROP POLICY IF EXISTS "logs_select_auth" ON logs_sistema;
DROP POLICY IF EXISTS "logs_insert_auth" ON logs_sistema;
DROP POLICY IF EXISTS "chat_select_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_insert_auth" ON chat_mensagens;

-- 6) Políticas MVP (authenticated)
-- usuarios
CREATE POLICY "usuarios_select_auth" ON usuarios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "usuarios_insert_auth" ON usuarios
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "usuarios_update_own" ON usuarios
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR auth_id IS NULL)
  WITH CHECK (auth_id = auth.uid() OR auth_id IS NULL);

-- lotes (feed + CRUD equipe)
CREATE POLICY "lotes_select_auth" ON lotes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "lotes_insert_auth" ON lotes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "lotes_update_auth" ON lotes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- processamento / britagem
CREATE POLICY "proc_select_auth" ON processamento
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "proc_insert_auth" ON processamento
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "proc_update_auth" ON processamento
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- estoque (MVP: authenticated read/insert/update)
CREATE POLICY "estoque_select_auth" ON estoque
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "estoque_insert_auth" ON estoque
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "estoque_update_auth" ON estoque
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- expedicao
CREATE POLICY "expedicao_select_auth" ON expedicao
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "expedicao_insert_auth" ON expedicao
  FOR INSERT TO authenticated WITH CHECK (true);

-- logs (MVP: authenticated read/insert; admin-oriented no app)
CREATE POLICY "logs_select_auth" ON logs_sistema
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "logs_insert_auth" ON logs_sistema
  FOR INSERT TO authenticated WITH CHECK (true);

-- chat
CREATE POLICY "chat_select_auth" ON chat_mensagens
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "chat_insert_auth" ON chat_mensagens
  FOR INSERT TO authenticated WITH CHECK (true);

-- 7) Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE usuarios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE lotes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE processamento TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE estoque TO authenticated;
GRANT SELECT, INSERT ON TABLE expedicao TO authenticated;
GRANT SELECT, INSERT ON TABLE logs_sistema TO authenticated;
GRANT SELECT, INSERT ON TABLE chat_mensagens TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE chat_mensagens_id_seq TO authenticated;

-- 8) Nota: cliente faz upsert em usuarios no signup:
--    auth_id, nome, email, tipo='operador', senha_hash='supabase-auth'
