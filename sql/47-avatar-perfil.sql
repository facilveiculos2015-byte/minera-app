-- =====================================================================
-- MINERA PARÁ - 47 Foto de perfil (avatar pronto / foto pessoal / logo da empresa)
-- Incremental. IDEMPOTENTE (pode rodar mais de uma vez). NÃO apaga dados.
-- Rodar no SQL Editor do Supabase (projeto eelbuaxgfzvxosatwcxk).
--
--  1) usuarios.avatar_url / avatar_tipo / avatar_atualizado_em (+ CHECKs)
--     avatar_tipo: 'iniciais' | 'avatar' | 'foto' | 'empresa'
--     avatar_url : NULL | 'preset:<id>' (desenho embutido no app)
--                  | URL pública do bucket 'avatares' DESTE projeto (nada externo)
--  2) RPC public.avatares_publicos(uuid[]) → só auth_id + avatar (sem e-mail)
--     (outros usuários não leem a tabela usuarios diretamente por causa da RLS)
--  3) Bucket público 'avatares' (2 MB, jpeg/webp/png) + policies:
--     leitura pública; gravar/trocar/apagar SÓ na pasta auth.uid()/...
--     (admin pode apagar qualquer uma, p/ moderação)
-- O próprio usuário grava avatar_* via UPDATE na própria linha (RLS 32 já
-- permite UPDATE own). O app degrada para iniciais se este SQL não existir.
-- =====================================================================

-- 1) Colunas -----------------------------------------------------------
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS avatar_tipo text NOT NULL DEFAULT 'iniciais';
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS avatar_atualizado_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_avatar_tipo_chk' AND conrelid = 'public.usuarios'::regclass) THEN
    ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_avatar_tipo_chk
      CHECK (avatar_tipo IN ('iniciais', 'avatar', 'foto', 'empresa'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_avatar_url_chk' AND conrelid = 'public.usuarios'::regclass) THEN
    ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_avatar_url_chk
      CHECK (
        avatar_url IS NULL
        OR (length(avatar_url) <= 400 AND (
              avatar_url ~ '^preset:[a-z0-9_-]{1,32}$'
           OR avatar_url ~ '^https://eelbuaxgfzvxosatwcxk\.supabase\.co/storage/v1/object/public/avatares/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'
        ))
      );
  END IF;
  -- coerência: iniciais ⇔ sem URL
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_avatar_coerente_chk' AND conrelid = 'public.usuarios'::regclass) THEN
    ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_avatar_coerente_chk
      CHECK ((avatar_tipo = 'iniciais') = (avatar_url IS NULL));
  END IF;
END $$;

-- Foto enviada só pode apontar para a PRÓPRIA pasta do dono da linha
CREATE OR REPLACE FUNCTION public.tg_usuarios_avatar_dono()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url LIKE 'https://%'
     AND position('/avatares/' || NEW.auth_id::text || '/' IN NEW.avatar_url) = 0 THEN
    RAISE EXCEPTION 'Foto de perfil inválida (pasta de outro usuário).' USING ERRCODE = '42501';
  END IF;
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.avatar_tipo IS DISTINCT FROM OLD.avatar_tipo THEN
    NEW.avatar_atualizado_em := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_usuarios_avatar_dono ON public.usuarios;
CREATE TRIGGER trg_usuarios_avatar_dono
  BEFORE UPDATE OF avatar_url, avatar_tipo ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.tg_usuarios_avatar_dono();

-- 2) Leitura pública mínima (sem e-mail) --------------------------------
CREATE OR REPLACE FUNCTION public.avatares_publicos(p_ids uuid[])
RETURNS TABLE (auth_id uuid, avatar_url text, avatar_tipo text, avatar_atualizado_em timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.auth_id, u.avatar_url, u.avatar_tipo, u.avatar_atualizado_em
    FROM public.usuarios u
   WHERE u.auth_id = ANY (p_ids[1:300])
     AND u.auth_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.avatares_publicos(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avatares_publicos(uuid[]) TO anon, authenticated;

-- 3) Storage ----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatares', 'avatares', true, 2097152, ARRAY['image/jpeg', 'image/webp', 'image/png'])
ON CONFLICT (id) DO UPDATE
   SET public = true,
       file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg', 'image/webp', 'image/png'];

DROP POLICY IF EXISTS "avatares_select_public" ON storage.objects;
DROP POLICY IF EXISTS "avatares_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatares_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatares_delete_own" ON storage.objects;

CREATE POLICY "avatares_select_public" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'avatares');

CREATE POLICY "avatares_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatares'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatares_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatares' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatares' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatares_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatares'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

-- Recarrega o cache do PostgREST (colunas/função novas visíveis na hora)
NOTIFY pgrst, 'reload schema';

-- Conferência rápida (deve listar 3 colunas, 1 função, 1 bucket, 4 policies)
SELECT 'coluna' AS item, column_name AS nome FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name LIKE 'avatar%'
UNION ALL SELECT 'funcao', proname FROM pg_proc WHERE proname = 'avatares_publicos'
UNION ALL SELECT 'bucket', id FROM storage.buckets WHERE id = 'avatares'
UNION ALL SELECT 'policy', policyname FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'avatares_%';
