-- =====================================================================
-- MINERA APP - 32 Security hardening (fortress)
-- Incremental. Idempotente. NÃO wipe. Rodar após 31-suporte-soft-delete.sql.
-- Depende de public.is_admin() (SQL 17) e políticas de chat (18/19) e
-- emprestimos UPDATE admin-only (23).
--
-- ASSUMPTIONS / RLS CONTRACT (documentado para auditoria):
-- 1) usuarios: SELECT/UPDATE own OR is_admin(); INSERT own auth_id.
-- 2) lotes: SELECT authenticated (marketplace feed); INSERT/UPDATE/DELETE own OR admin.
-- 3) caixa_*: SELECT/INSERT/UPDATE own OR admin; movimentos INSERT own (sem UPDATE público).
-- 4) emprestimos: SELECT/INSERT own OR admin; UPDATE somente is_admin() (SQL 23).
-- 5) chat_mensagens: SELECT participante/admin; INSERT de_auth_id=auth.uid() + para_auth_id NOT NULL;
--    UPDATE own/admin. Diretório via RPC SECURITY DEFINER SEM e-mail (SQL 22).
-- 6) suporte_mensagens: SELECT/INSERT own thread OR admin; UPDATE admin.
-- 7) pix_pagamentos: own OR admin; pix_admin: SELECT auth, mutação admin.
-- 8) ANON: sem WRITE em tabelas sensíveis (revoke abaixo).
-- =====================================================================

-- Reafirma helper is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.auth_id = auth.uid()
      AND (
        u.tipo = 'admin'
        OR 'admin' = ANY (COALESCE(u.papeis, '{}'::text[]))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- =====================================================================
-- LOTES — reafirma mutação own/admin; feed SELECT autenticado
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lotes') THEN
    EXECUTE 'DROP POLICY IF EXISTS "lotes_select_marketplace" ON lotes';
    EXECUTE 'DROP POLICY IF EXISTS "lotes_select_auth" ON lotes';
    EXECUTE 'DROP POLICY IF EXISTS "lotes_insert_own" ON lotes';
    EXECUTE 'DROP POLICY IF EXISTS "lotes_update_own_or_admin" ON lotes';
    EXECUTE 'DROP POLICY IF EXISTS "lotes_delete_own_or_admin" ON lotes';
    EXECUTE 'CREATE POLICY "lotes_select_marketplace" ON lotes FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "lotes_insert_own" ON lotes FOR INSERT TO authenticated WITH CHECK (criado_por_id = auth.uid())';
    EXECUTE 'CREATE POLICY "lotes_update_own_or_admin" ON lotes FOR UPDATE TO authenticated USING (criado_por_id = auth.uid() OR public.is_admin()) WITH CHECK (criado_por_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "lotes_delete_own_or_admin" ON lotes FOR DELETE TO authenticated USING (criado_por_id = auth.uid() OR public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE lotes FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lotes TO authenticated';
  END IF;
END $$;

-- =====================================================================
-- CAIXA — isolamento por auth_id; sem UPDATE de movimentos pelo cliente
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_saldos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "caixa_saldos_select_own_or_admin" ON caixa_saldos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_saldos_insert_own_or_admin" ON caixa_saldos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_saldos_update_own_or_admin" ON caixa_saldos';
    EXECUTE 'CREATE POLICY "caixa_saldos_select_own_or_admin" ON caixa_saldos FOR SELECT TO authenticated USING (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "caixa_saldos_insert_own_or_admin" ON caixa_saldos FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "caixa_saldos_update_own_or_admin" ON caixa_saldos FOR UPDATE TO authenticated USING (auth_id = auth.uid() OR public.is_admin()) WITH CHECK (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE caixa_saldos FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE caixa_saldos TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_movimentos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "caixa_movimentos_select_own_or_admin" ON caixa_movimentos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_movimentos_insert_own_or_admin" ON caixa_movimentos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_movimentos_update_admin" ON caixa_movimentos';
    EXECUTE 'CREATE POLICY "caixa_movimentos_select_own_or_admin" ON caixa_movimentos FOR SELECT TO authenticated USING (auth_id = auth.uid() OR public.is_admin())';
    -- Cliente NÃO insere movimentos arbitrários que creditam saldo — só admin (confirmação depósito/saque)
    EXECUTE 'CREATE POLICY "caixa_movimentos_insert_own_or_admin" ON caixa_movimentos FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE caixa_movimentos FROM anon';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE caixa_movimentos TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_deposito_pedidos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "caixa_dep_select_own_or_admin" ON caixa_deposito_pedidos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_dep_insert_own" ON caixa_deposito_pedidos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_dep_update_own_or_admin" ON caixa_deposito_pedidos';
    EXECUTE 'CREATE POLICY "caixa_dep_select_own_or_admin" ON caixa_deposito_pedidos FOR SELECT TO authenticated USING (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "caixa_dep_insert_own" ON caixa_deposito_pedidos FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid())';
    -- Status confirmado só admin; usuário pode cancelar/editar comprovante próprio enquanto pendente
    EXECUTE 'CREATE POLICY "caixa_dep_update_own_or_admin" ON caixa_deposito_pedidos FOR UPDATE TO authenticated USING (auth_id = auth.uid() OR public.is_admin()) WITH CHECK (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE caixa_deposito_pedidos FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE caixa_deposito_pedidos TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_saque_pedidos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "caixa_saque_select_own_or_admin" ON caixa_saque_pedidos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_saque_insert_own" ON caixa_saque_pedidos';
    EXECUTE 'DROP POLICY IF EXISTS "caixa_saque_update_own_or_admin" ON caixa_saque_pedidos';
    EXECUTE 'CREATE POLICY "caixa_saque_select_own_or_admin" ON caixa_saque_pedidos FOR SELECT TO authenticated USING (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "caixa_saque_insert_own" ON caixa_saque_pedidos FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid())';
    EXECUTE 'CREATE POLICY "caixa_saque_update_own_or_admin" ON caixa_saque_pedidos FOR UPDATE TO authenticated USING (auth_id = auth.uid() OR public.is_admin()) WITH CHECK (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE caixa_saque_pedidos FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE caixa_saque_pedidos TO authenticated';
  END IF;
END $$;

-- =====================================================================
-- EMPRESTIMOS — UPDATE somente admin (reafirma SQL 23)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='emprestimos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "emprestimos_select_own_or_admin" ON emprestimos';
    EXECUTE 'DROP POLICY IF EXISTS "emprestimos_insert_own" ON emprestimos';
    EXECUTE 'DROP POLICY IF EXISTS "emprestimos_update_own_or_admin" ON emprestimos';
    EXECUTE 'DROP POLICY IF EXISTS "emprestimos_update_admin" ON emprestimos';
    EXECUTE 'CREATE POLICY "emprestimos_select_own_or_admin" ON emprestimos FOR SELECT TO authenticated USING (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "emprestimos_insert_own" ON emprestimos FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid())';
    EXECUTE 'CREATE POLICY "emprestimos_update_admin" ON emprestimos FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE emprestimos FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE emprestimos TO authenticated';
  END IF;
END $$;

-- =====================================================================
-- CHAT — participante only (reafirma 18/19); sem broadcast SELECT
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chat_mensagens') THEN
    EXECUTE 'DROP POLICY IF EXISTS "chat_select_auth" ON chat_mensagens';
    EXECUTE 'DROP POLICY IF EXISTS "chat_insert_auth" ON chat_mensagens';
    EXECUTE 'DROP POLICY IF EXISTS "chat_select_participant_or_admin" ON chat_mensagens';
    EXECUTE 'DROP POLICY IF EXISTS "chat_insert_own" ON chat_mensagens';
    EXECUTE 'DROP POLICY IF EXISTS "chat_update_own_or_admin" ON chat_mensagens';
    EXECUTE $p$
      CREATE POLICY "chat_select_participant_or_admin" ON chat_mensagens
        FOR SELECT TO authenticated
        USING (
          public.is_admin()
          OR de_auth_id = auth.uid()
          OR para_auth_id = auth.uid()
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "chat_insert_own" ON chat_mensagens
        FOR INSERT TO authenticated
        WITH CHECK (
          de_auth_id = auth.uid()
          AND para_auth_id IS NOT NULL
          AND para_auth_id <> auth.uid()
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "chat_update_own_or_admin" ON chat_mensagens
        FOR UPDATE TO authenticated
        USING (de_auth_id = auth.uid() OR public.is_admin())
        WITH CHECK (de_auth_id = auth.uid() OR public.is_admin())
    $p$;
    EXECUTE 'REVOKE ALL ON TABLE chat_mensagens FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE chat_mensagens TO authenticated';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chat_contatos') THEN
    EXECUTE 'DROP POLICY IF EXISTS "chat_contatos_select_own" ON chat_contatos';
    EXECUTE 'DROP POLICY IF EXISTS "chat_contatos_insert_own" ON chat_contatos';
    EXECUTE 'DROP POLICY IF EXISTS "chat_contatos_update_own" ON chat_contatos';
    EXECUTE 'DROP POLICY IF EXISTS "chat_contatos_delete_own" ON chat_contatos';
    EXECUTE 'CREATE POLICY "chat_contatos_select_own" ON chat_contatos FOR SELECT TO authenticated USING (auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "chat_contatos_insert_own" ON chat_contatos FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid())';
    EXECUTE 'CREATE POLICY "chat_contatos_update_own" ON chat_contatos FOR UPDATE TO authenticated USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid())';
    EXECUTE 'CREATE POLICY "chat_contatos_delete_own" ON chat_contatos FOR DELETE TO authenticated USING (auth_id = auth.uid())';
    EXECUTE 'REVOKE ALL ON TABLE chat_contatos FROM anon';
  END IF;
END $$;

-- =====================================================================
-- SUPORTE — own thread / admin
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='suporte_mensagens') THEN
    EXECUTE 'DROP POLICY IF EXISTS "suporte_select_own_or_admin" ON suporte_mensagens';
    EXECUTE 'DROP POLICY IF EXISTS "suporte_insert_own_or_admin" ON suporte_mensagens';
    EXECUTE 'DROP POLICY IF EXISTS "suporte_update_admin" ON suporte_mensagens';
    EXECUTE 'CREATE POLICY "suporte_select_own_or_admin" ON suporte_mensagens FOR SELECT TO authenticated USING (thread_auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "suporte_insert_own_or_admin" ON suporte_mensagens FOR INSERT TO authenticated WITH CHECK (thread_auth_id = auth.uid() OR public.is_admin())';
    EXECUTE 'CREATE POLICY "suporte_update_admin" ON suporte_mensagens FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
    EXECUTE 'REVOKE ALL ON TABLE suporte_mensagens FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE suporte_mensagens TO authenticated';
  END IF;
END $$;

-- =====================================================================
-- USUARIOS — revoke anon; keep own/admin
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='usuarios') THEN
    EXECUTE 'REVOKE ALL ON TABLE usuarios FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE usuarios TO authenticated';
  END IF;
END $$;

-- Pix / comissoes: revoke anon writes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pix_pagamentos') THEN
    EXECUTE 'REVOKE ALL ON TABLE pix_pagamentos FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pix_admin') THEN
    EXECUTE 'REVOKE ALL ON TABLE pix_admin FROM anon';
    -- SELECT autenticado ok (chave pública da plataforma); mutação admin
    EXECUTE 'DROP POLICY IF EXISTS "pix_admin_insert_admin" ON pix_admin';
    EXECUTE 'DROP POLICY IF EXISTS "pix_admin_update_admin" ON pix_admin';
    EXECUTE 'CREATE POLICY "pix_admin_insert_admin" ON pix_admin FOR INSERT TO authenticated WITH CHECK (public.is_admin())';
    EXECUTE 'CREATE POLICY "pix_admin_update_admin" ON pix_admin FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='comissoes') THEN
    EXECUTE 'REVOKE ALL ON TABLE comissoes FROM anon';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
