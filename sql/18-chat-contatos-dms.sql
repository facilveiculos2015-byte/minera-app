-- =====================================================================
-- MINERA APP - 18 Chat contatos + DMs privados + leituras
-- Incremental. Idempotente. NÃO wipe. Rodar após 17-rls-isolamento.sql.
-- Quebra SELECT team-wide no chat (broadcast some) — intencional.
-- =====================================================================

-- 1) Contatos do usuário (WhatsApp-like agenda)
CREATE TABLE IF NOT EXISTS chat_contatos (
    id SERIAL PRIMARY KEY,
    auth_id UUID NOT NULL,
    contato_auth_id UUID NOT NULL,
    apelido TEXT,
    criado_em TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chat_contatos_uniq UNIQUE (auth_id, contato_auth_id),
    CONSTRAINT chat_contatos_no_self CHECK (auth_id <> contato_auth_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_contatos_auth ON chat_contatos(auth_id);
CREATE INDEX IF NOT EXISTS idx_chat_contatos_contato ON chat_contatos(contato_auth_id);

ALTER TABLE chat_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_contatos_select_own" ON chat_contatos;
DROP POLICY IF EXISTS "chat_contatos_insert_own" ON chat_contatos;
DROP POLICY IF EXISTS "chat_contatos_update_own" ON chat_contatos;
DROP POLICY IF EXISTS "chat_contatos_delete_own" ON chat_contatos;

CREATE POLICY "chat_contatos_select_own" ON chat_contatos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

CREATE POLICY "chat_contatos_insert_own" ON chat_contatos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "chat_contatos_update_own" ON chat_contatos
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "chat_contatos_delete_own" ON chat_contatos
  FOR DELETE TO authenticated
  USING (auth_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_contatos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE chat_contatos_id_seq TO authenticated;

-- 2) Leituras por thread (last_read)
CREATE TABLE IF NOT EXISTS chat_leituras (
    auth_id UUID NOT NULL,
    com_auth_id UUID NOT NULL,
    ultima_lida_id INT,
    lido_em TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (auth_id, com_auth_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_leituras_auth ON chat_leituras(auth_id);

ALTER TABLE chat_leituras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_leituras_select_own" ON chat_leituras;
DROP POLICY IF EXISTS "chat_leituras_insert_own" ON chat_leituras;
DROP POLICY IF EXISTS "chat_leituras_update_own" ON chat_leituras;
DROP POLICY IF EXISTS "chat_leituras_delete_own" ON chat_leituras;

CREATE POLICY "chat_leituras_select_own" ON chat_leituras
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

CREATE POLICY "chat_leituras_insert_own" ON chat_leituras
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "chat_leituras_update_own" ON chat_leituras
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "chat_leituras_delete_own" ON chat_leituras
  FOR DELETE TO authenticated
  USING (auth_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_leituras TO authenticated;

-- 3) Índice DM
CREATE INDEX IF NOT EXISTS idx_chat_de_para ON chat_mensagens(de_auth_id, para_auth_id);
CREATE INDEX IF NOT EXISTS idx_chat_para_id ON chat_mensagens(para_auth_id, id);

-- 4) RLS chat_mensagens: só participante ou admin (quebra broadcast)
DROP POLICY IF EXISTS "chat_select_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_insert_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_update_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_update_own_or_admin" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_select_participant_or_admin" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_insert_own" ON chat_mensagens;

CREATE POLICY "chat_select_participant_or_admin" ON chat_mensagens
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR de_auth_id = auth.uid()
    OR para_auth_id = auth.uid()
  );

CREATE POLICY "chat_insert_own" ON chat_mensagens
  FOR INSERT TO authenticated
  WITH CHECK (de_auth_id = auth.uid());

CREATE POLICY "chat_update_own_or_admin" ON chat_mensagens
  FOR UPDATE TO authenticated
  USING (de_auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (de_auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE chat_mensagens TO authenticated;

-- 5) Diretório público limitado (SECURITY DEFINER) — necessário p/ Adicionar contato
-- Retorna só auth_id, nome, email, papeis, tipo (sem dados sensíveis)
CREATE OR REPLACE FUNCTION public.chat_diretorio(p_busca text DEFAULT NULL)
RETURNS TABLE (
  auth_id uuid,
  nome text,
  email text,
  papeis text[],
  tipo text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id,
    COALESCE(u.nome, split_part(COALESCE(u.email, ''), '@', 1), 'Usuário') AS nome,
    u.email,
    COALESCE(u.papeis, '{}'::text[]) AS papeis,
    COALESCE(u.tipo, 'operador') AS tipo
  FROM public.usuarios u
  WHERE u.auth_id IS NOT NULL
    AND u.auth_id <> auth.uid()
    AND (
      p_busca IS NULL
      OR length(trim(p_busca)) = 0
      OR u.nome ILIKE '%' || trim(p_busca) || '%'
      OR u.email ILIKE '%' || trim(p_busca) || '%'
    )
  ORDER BY u.nome NULLS LAST
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.chat_diretorio(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_diretorio(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_buscar_email(p_email text)
RETURNS TABLE (
  auth_id uuid,
  nome text,
  email text,
  papeis text[],
  tipo text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id,
    COALESCE(u.nome, split_part(COALESCE(u.email, ''), '@', 1), 'Usuário') AS nome,
    u.email,
    COALESCE(u.papeis, '{}'::text[]) AS papeis,
    COALESCE(u.tipo, 'operador') AS tipo
  FROM public.usuarios u
  WHERE u.auth_id IS NOT NULL
    AND u.auth_id <> auth.uid()
    AND lower(trim(u.email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.chat_buscar_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_buscar_email(text) TO authenticated;

-- Perfis públicos por lista de auth_ids (para enriquecer contatos / previews)
CREATE OR REPLACE FUNCTION public.chat_perfis_publicos(p_ids uuid[])
RETURNS TABLE (
  auth_id uuid,
  nome text,
  email text,
  papeis text[],
  tipo text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id,
    COALESCE(u.nome, split_part(COALESCE(u.email, ''), '@', 1), 'Usuário') AS nome,
    u.email,
    COALESCE(u.papeis, '{}'::text[]) AS papeis,
    COALESCE(u.tipo, 'operador') AS tipo
  FROM public.usuarios u
  WHERE u.auth_id = ANY (p_ids);
$$;

REVOKE ALL ON FUNCTION public.chat_perfis_publicos(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_perfis_publicos(uuid[]) TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
