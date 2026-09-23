-- =====================================================================
-- MINERAR PARÁ - 33 Storage paths by user_id (isolation harden)
-- Incremental. Idempotente. NÃO wipe. Rodar após 32-security-hardening.sql.
-- Paths: chat-midia/{auth.uid()}/... e emprestimo-docs/{auth.uid()}/...
-- Admin-as-user mode: policies usam auth.uid() (JWT), não “modo UI”.
-- =====================================================================

-- chat-midia: INSERT/UPDATE/DELETE só na própria pasta (primeiro segmento = auth.uid())
DROP POLICY IF EXISTS "chat_midia_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_update_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "chat_midia_delete_own_folder" ON storage.objects;

-- SELECT público permanece (playback no chat); mutação restrita à pasta do usuário
CREATE POLICY "chat_midia_insert_own_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-midia'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat_midia_update_own_folder" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-midia'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'chat-midia'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat_midia_delete_own_folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-midia'
    AND auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- emprestimo-docs: reafirma pasta = auth.uid()
DROP POLICY IF EXISTS "emp_docs_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "emp_docs_select_own_or_admin" ON storage.objects;
DROP POLICY IF EXISTS "emp_docs_update_own" ON storage.objects;
DROP POLICY IF EXISTS "emp_docs_delete_own" ON storage.objects;

CREATE POLICY "emp_docs_select_own_or_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'emprestimo-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

CREATE POLICY "emp_docs_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'emprestimo-docs'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "emp_docs_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'emprestimo-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'emprestimo-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "emp_docs_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'emprestimo-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

COMMENT ON POLICY "chat_midia_insert_own_folder" ON storage.objects IS
  'Upload chat-midia somente em {auth.uid()}/... (SQL 33).';
