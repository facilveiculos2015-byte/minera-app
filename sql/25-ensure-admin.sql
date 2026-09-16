-- =====================================================================
-- MINERA APP - 25 Garantir admin (facilveiculos2015@gmail.com)
-- Incremental. Idempotente. NÃO wipe.
-- Corrige perfil que perdeu tipo/papeis admin (ex.: upsert de login).
-- Rodar após 24-chat-midia-storage.sql no Supabase SQL Editor.
-- =====================================================================

-- 1) Se já existe linha em public.usuarios com esse e-mail: promove admin
--    (preserva outros papéis; só garante 'admin' em papeis + tipo='admin')
UPDATE public.usuarios u
SET
  tipo = 'admin',
  papeis = (
    SELECT ARRAY(
      SELECT DISTINCT p
      FROM unnest(COALESCE(u.papeis, '{}'::text[]) || ARRAY['admin']::text[]) AS p
      WHERE p IS NOT NULL AND btrim(p) <> ''
    )
  ),
  email = lower(trim(u.email))
WHERE lower(trim(u.email)) = 'facilveiculos2015@gmail.com';

-- 2) Se existe em auth.users mas falta (ou falta auth_id) em usuarios:
--    UPSERT por auth_id — não apaga outras colunas além de tipo/papeis/email/nome mínimo
INSERT INTO public.usuarios (auth_id, email, nome, tipo, papeis, senha_hash)
SELECT
  au.id,
  lower(trim(au.email)),
  COALESCE(
    NULLIF(trim(au.raw_user_meta_data->>'nome'), ''),
    NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
    'Admin'
  ),
  'admin',
  ARRAY['admin']::text[],
  'supabase-auth'
FROM auth.users au
WHERE lower(trim(au.email)) = 'facilveiculos2015@gmail.com'
ON CONFLICT (auth_id) DO UPDATE
SET
  tipo = 'admin',
  email = EXCLUDED.email,
  papeis = (
    SELECT ARRAY(
      SELECT DISTINCT p
      FROM unnest(COALESCE(public.usuarios.papeis, '{}'::text[]) || ARRAY['admin']::text[]) AS p
      WHERE p IS NOT NULL AND btrim(p) <> ''
    )
  );

-- 3) Religa auth_id se a linha existia só por e-mail (sem wipe)
UPDATE public.usuarios u
SET auth_id = au.id
FROM auth.users au
WHERE lower(trim(u.email)) = 'facilveiculos2015@gmail.com'
  AND lower(trim(au.email)) = 'facilveiculos2015@gmail.com'
  AND (u.auth_id IS NULL OR u.auth_id IS DISTINCT FROM au.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.usuarios x
    WHERE x.auth_id = au.id AND x.id IS DISTINCT FROM u.id
  );

-- Conferência (opcional):
-- SELECT id, email, tipo, papeis, auth_id FROM public.usuarios
-- WHERE lower(email) = 'facilveiculos2015@gmail.com';
