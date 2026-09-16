-- =====================================================================
-- MINERA APP - 24 Storage bucket chat-midia (áudio/imagem/vídeo do chat)
-- Incremental. Idempotente. NÃO wipe. Rodar após 23-admin-emprestimos.sql.
-- Cria/atualiza bucket público + policies de Storage para upload autenticado.
-- =====================================================================

-- Bucket público (URLs getPublicUrl precisam ser legíveis por outros usuários)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'chat-midia',
  'chat-midia',
  true,
  10485760 -- 10 MB
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = COALESCE(storage.buckets.file_size_limit, 10485760);

-- Policies (drop + recreate idempotente)
DROP POLICY IF EXISTS "chat_midia_public_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_insert" ON storage.objects;

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
  'Leitura pública do bucket chat-midia (playback de áudio/imagem/vídeo no chat).';
