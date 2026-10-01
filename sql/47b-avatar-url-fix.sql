-- 47b — corrige o CHECK usuarios_avatar_url_chk do SQL 47.
-- Na aplicação do 47 o padrão ficou com barra invertida dobrada ("\\.") e passou a
-- exigir uma barra literal na URL: nenhuma foto/logo enviada era aceita (23514).
-- Este padrão não usa barra invertida ([.] no lugar de \.), então não sofre com cópia/cola.
-- Idempotente: pode rodar mais de uma vez.
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_avatar_url_chk;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_avatar_url_chk
  CHECK (
    avatar_url IS NULL
    OR (length(avatar_url) <= 400 AND (
          avatar_url ~ '^preset:[a-z0-9_-]{1,32}$'
       OR avatar_url ~ '^https://eelbuaxgfzvxosatwcxk[.]supabase[.]co/storage/v1/object/public/avatares/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'
    ))
  );
NOTIFY pgrst, 'reload schema';

-- Verificação: deve retornar ok_foto = true, ok_preset = true, ok_externa = false
SELECT
  ('https://eelbuaxgfzvxosatwcxk.supabase.co/storage/v1/object/public/avatares/a1875012-645a-4a14-90db-5d1ff42c2c9b/foto-1.webp'
     ~ '^https://eelbuaxgfzvxosatwcxk[.]supabase[.]co/storage/v1/object/public/avatares/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$') AS ok_foto,
  ('preset:capacete' ~ '^preset:[a-z0-9_-]{1,32}$') AS ok_preset,
  ('https://evil.example/x.png'
     ~ '^https://eelbuaxgfzvxosatwcxk[.]supabase[.]co/storage/v1/object/public/avatares/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$') AS ok_externa,
  pg_get_constraintdef(c.oid) AS definicao
FROM pg_constraint c
WHERE c.conname = 'usuarios_avatar_url_chk';
