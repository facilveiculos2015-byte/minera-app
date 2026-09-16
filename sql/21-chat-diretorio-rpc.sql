-- =====================================================================
-- MINERA APP - 21 RPC seguro para diretório de chat
-- Incremental. Idempotente. NÃO wipe. Rodar após 18/19/20.
-- Bypassa o RLS isolado de usuarios, retornando apenas campos públicos.
-- =====================================================================

-- Diretório completo para usuários autenticados (exceto o próprio usuário).
-- Remover a assinatura antiga com busca evita ambiguidade no endpoint RPC.
DROP FUNCTION IF EXISTS public.chat_diretorio(text);
CREATE OR REPLACE FUNCTION public.chat_diretorio()
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
  FROM public.usuarios AS u
  WHERE u.auth_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND u.auth_id <> auth.uid()
  ORDER BY COALESCE(u.nome, u.email, 'Usuário'), u.email;
$$;

REVOKE ALL ON FUNCTION public.chat_diretorio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_diretorio() TO authenticated;

-- Busca exata por e-mail, sem expor senha, PIN ou qualquer outro campo.
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
  FROM public.usuarios AS u
  WHERE u.auth_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND u.auth_id <> auth.uid()
    AND lower(trim(u.email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.chat_buscar_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_buscar_email(text) TO authenticated;
