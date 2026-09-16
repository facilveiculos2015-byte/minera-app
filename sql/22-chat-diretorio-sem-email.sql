-- =====================================================================
-- MINERA APP - 22 chat_diretorio SEM e-mail (nome/apelido anti-golpe)
-- Incremental. Idempotente. NÃO wipe. Rodar após 21-chat-diretorio-rpc.sql.
-- Nunca expõe e-mail de outros usuários via RPC de chat/diretório.
-- =====================================================================

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS apelido TEXT;

COMMENT ON COLUMN public.usuarios.apelido IS
  'Apelido público (nickname). Visível no chat; e-mail permanece privado (só no próprio Perfil).';

-- Assinaturas antigas (com email / com p_busca) — dropar para trocar RETURNS
DROP FUNCTION IF EXISTS public.chat_diretorio();
DROP FUNCTION IF EXISTS public.chat_diretorio(text);
DROP FUNCTION IF EXISTS public.chat_buscar_email(text);
DROP FUNCTION IF EXISTS public.chat_buscar_nome(text);
DROP FUNCTION IF EXISTS public.chat_perfis_publicos(uuid[]);

-- Diretório: auth_id, nome, papeis, tipo, apelido — NO email
CREATE OR REPLACE FUNCTION public.chat_diretorio()
RETURNS TABLE (
  auth_id uuid,
  nome text,
  papeis text[],
  tipo text,
  apelido text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id,
    COALESCE(NULLIF(trim(u.nome), ''), 'Usuário') AS nome,
    COALESCE(u.papeis, '{}'::text[]) AS papeis,
    COALESCE(u.tipo, 'operador') AS tipo,
    NULLIF(trim(u.apelido), '') AS apelido
  FROM public.usuarios AS u
  WHERE u.auth_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND u.auth_id <> auth.uid()
  ORDER BY COALESCE(NULLIF(trim(u.apelido), ''), NULLIF(trim(u.nome), ''), 'Usuário');
$$;

REVOKE ALL ON FUNCTION public.chat_diretorio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_diretorio() TO authenticated;

-- Busca por nome / apelido (ILIKE) — sem email
CREATE OR REPLACE FUNCTION public.chat_buscar_nome(p_nome text)
RETURNS TABLE (
  auth_id uuid,
  nome text,
  papeis text[],
  tipo text,
  apelido text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id,
    COALESCE(NULLIF(trim(u.nome), ''), 'Usuário') AS nome,
    COALESCE(u.papeis, '{}'::text[]) AS papeis,
    COALESCE(u.tipo, 'operador') AS tipo,
    NULLIF(trim(u.apelido), '') AS apelido
  FROM public.usuarios AS u
  WHERE u.auth_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND u.auth_id <> auth.uid()
    AND length(trim(COALESCE(p_nome, ''))) >= 1
    AND (
      u.nome ILIKE '%' || trim(p_nome) || '%'
      OR COALESCE(u.apelido, '') ILIKE '%' || trim(p_nome) || '%'
    )
  ORDER BY COALESCE(NULLIF(trim(u.apelido), ''), NULLIF(trim(u.nome), ''), 'Usuário')
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.chat_buscar_nome(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_buscar_nome(text) TO authenticated;

-- chat_buscar_email foi removida: contatos são encontrados apenas por nome/apelido.

-- Perfis públicos por ids (contatos / previews) — sem email
CREATE OR REPLACE FUNCTION public.chat_perfis_publicos(p_ids uuid[])
RETURNS TABLE (
  auth_id uuid,
  nome text,
  papeis text[],
  tipo text,
  apelido text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.auth_id,
    COALESCE(NULLIF(trim(u.nome), ''), 'Usuário') AS nome,
    COALESCE(u.papeis, '{}'::text[]) AS papeis,
    COALESCE(u.tipo, 'operador') AS tipo,
    NULLIF(trim(u.apelido), '') AS apelido
  FROM public.usuarios AS u
  WHERE u.auth_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_ids IS NOT NULL
    AND u.auth_id = ANY (p_ids);
$$;

REVOKE ALL ON FUNCTION public.chat_perfis_publicos(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_perfis_publicos(uuid[]) TO authenticated;
