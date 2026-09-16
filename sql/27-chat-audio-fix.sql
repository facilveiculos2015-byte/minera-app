-- =====================================================================
-- MINERA APP - 27 chat audio fix (bucket chat-midia público + policies)
-- Incremental. Idempotente. NÃO wipe.
-- Rodar após 24-chat-midia-storage.sql (e 26 se já aplicado).
-- Repara: bucket privado → 403 no <audio>; MIME restrito; policies faltando.
-- =====================================================================

-- 1) Força bucket público, limite >= 10MB, sem restrição de MIME
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-midia',
  'chat-midia',
  true,
  10485760, -- 10 MB
  NULL      -- permite audio/webm, image/*, video/* etc.
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = GREATEST(
    COALESCE(storage.buckets.file_size_limit, 0),
    10485760
  ),
  allowed_mime_types = NULL;

-- 2) Policies (drop + recreate idempotente; cobre nomes antigos/dashboard)
DROP POLICY IF EXISTS "chat_midia_public_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_delete" ON storage.objects;
DROP POLICY IF EXISTS "Give public access to chat-midia" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads chat-midia" ON storage.objects;

CREATE POLICY "chat_midia_public_select" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'chat-midia');

CREATE POLICY "chat_midia_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-midia' AND auth.uid() IS NOT NULL);

CREATE POLICY "chat_midia_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-midia' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'chat-midia' AND auth.uid() IS NOT NULL);

CREATE POLICY "chat_midia_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-midia' AND auth.uid() IS NOT NULL);

COMMENT ON POLICY "chat_midia_public_select" ON storage.objects IS
  'Leitura pública chat-midia (playback áudio/imagem/vídeo no chat; evita 403).';
