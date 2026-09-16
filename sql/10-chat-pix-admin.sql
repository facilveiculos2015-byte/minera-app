-- =====================================================================
-- MINERA APP - 10 Chat midia/agenda + Pix + Admin (moderacao)
-- Incremental. Idempotente. NÃO wipe. Rodar após 09.
-- =====================================================================

-- 1) chat_mensagens: colunas WhatsApp-like
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'text';
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS midia_url TEXT;
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMPTZ;
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS para_auth_id UUID;
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'enviada';
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS moderacao TEXT;
ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- texto pode ser vazio quando há mídia
ALTER TABLE chat_mensagens ALTER COLUMN texto DROP NOT NULL;
ALTER TABLE chat_mensagens ALTER COLUMN texto SET DEFAULT '';

-- Normaliza linhas antigas
UPDATE chat_mensagens SET tipo = COALESCE(tipo, 'text') WHERE tipo IS NULL;
UPDATE chat_mensagens SET status = COALESCE(status, 'enviada') WHERE status IS NULL;
UPDATE chat_mensagens SET texto = COALESCE(texto, '') WHERE texto IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_status ON chat_mensagens(status);
CREATE INDEX IF NOT EXISTS idx_chat_agendado ON chat_mensagens(agendado_para) WHERE status = 'agendada';
CREATE INDEX IF NOT EXISTS idx_chat_para ON chat_mensagens(para_auth_id);
CREATE INDEX IF NOT EXISTS idx_chat_deleted ON chat_mensagens(deleted_at);

-- UPDATE policy para soft-delete / agendar → enviada / moderacao
DROP POLICY IF EXISTS "chat_select_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_insert_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_update_auth" ON chat_mensagens;

CREATE POLICY "chat_select_auth" ON chat_mensagens
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "chat_insert_auth" ON chat_mensagens
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "chat_update_auth" ON chat_mensagens
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE chat_mensagens TO authenticated;

-- 2) pix_admin (chave Pix do admin)
CREATE TABLE IF NOT EXISTS pix_admin (
    id SERIAL PRIMARY KEY,
    chave_pix TEXT NOT NULL,
    tipo_chave TEXT DEFAULT 'aleatoria',
    titular TEXT,
    instrucoes TEXT,
    ativo BOOLEAN DEFAULT true,
    atualizado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pix_admin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pix_admin_select_auth" ON pix_admin;
DROP POLICY IF EXISTS "pix_admin_insert_auth" ON pix_admin;
DROP POLICY IF EXISTS "pix_admin_update_auth" ON pix_admin;

-- Leitura: autenticados veem só ativos (MVP: app filtra; policy libera SELECT all)
CREATE POLICY "pix_admin_select_auth" ON pix_admin
  FOR SELECT TO authenticated USING (true);
-- MVP: authenticated write (app restringe a ehAdmin)
CREATE POLICY "pix_admin_insert_auth" ON pix_admin
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pix_admin_update_auth" ON pix_admin
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE pix_admin TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE pix_admin_id_seq TO authenticated;

-- 3) pix_pagamentos (comprovantes / claims)
CREATE TABLE IF NOT EXISTS pix_pagamentos (
    id SERIAL PRIMARY KEY,
    usuario_id INT REFERENCES usuarios(id),
    usuario_auth_id UUID,
    usuario_nome TEXT,
    valor NUMERIC,
    comprovante_url TEXT,
    status TEXT DEFAULT 'pendente',
    criado_em TIMESTAMPTZ DEFAULT now(),
    atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pix_pag_status ON pix_pagamentos(status);
CREATE INDEX IF NOT EXISTS idx_pix_pag_user ON pix_pagamentos(usuario_auth_id);

ALTER TABLE pix_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pix_pag_select_auth" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_insert_auth" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_update_auth" ON pix_pagamentos;

CREATE POLICY "pix_pag_select_auth" ON pix_pagamentos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pix_pag_insert_auth" ON pix_pagamentos
  FOR INSERT TO authenticated WITH CHECK (true);
-- MVP: authenticated update (admin marca confirmado/recusado no app)
CREATE POLICY "pix_pag_update_auth" ON pix_pagamentos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE pix_pagamentos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE pix_pagamentos_id_seq TO authenticated;

-- 4) Storage bucket chat-midia
-- NOTA: criar bucket público no Supabase UI (Storage → New bucket → name: chat-midia → Public).
-- Políticas sugeridas (Storage policies no dashboard):
--   SELECT: public / authenticated
--   INSERT: authenticated
-- Se Storage setup for pesado, o app faz fallback para data URL (imagens pequenas) ou campo URL.

-- 5) Promover primeiro admin (rode manualmente substituindo o e-mail):
-- UPDATE usuarios SET tipo = 'admin', papeis = array_append(COALESCE(papeis, '{}'), 'admin')
-- WHERE email = 'seu@email.com';
-- Ou marque Admin em Perfil se já for admin.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
