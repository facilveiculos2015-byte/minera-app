-- =====================================================================
-- MINERA APP - 23 Admin: Empréstimos (listar / liberar / recusar)
-- Incremental. Idempotente. NÃO wipe. Rodar após 22-chat-diretorio-sem-email.sql.
-- Depende de public.is_admin() (SQL 17).
-- =====================================================================

-- 1) Reafirma RLS: usuário vê/cria os próprios; só admin UPDATE (aprovar/recusar)
DROP POLICY IF EXISTS "emprestimos_select_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_insert_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_update_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_select_own_or_admin" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_insert_own" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_update_own_or_admin" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_update_admin" ON emprestimos;

CREATE POLICY "emprestimos_select_own_or_admin" ON emprestimos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

CREATE POLICY "emprestimos_insert_own" ON emprestimos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

-- Somente admin altera status (Liberar crédito / Recusar / Marcar pago)
CREATE POLICY "emprestimos_update_admin" ON emprestimos
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE emprestimos TO authenticated;

-- 2) RPC admin: lista pedidos com papéis do solicitante (bypassa join RLS)
CREATE OR REPLACE FUNCTION public.admin_listar_emprestimos(p_limit integer DEFAULT 80)
RETURNS TABLE (
  id integer,
  auth_id uuid,
  nome text,
  telefone text,
  valor numeric,
  prazo_dias integer,
  finalidade text,
  renda_declarada numeric,
  observacoes text,
  juros_pct numeric,
  total_previsto numeric,
  status text,
  criado_em timestamptz,
  atualizado_em timestamptz,
  usuario_nome text,
  usuario_tipo text,
  usuario_papeis text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas admin';
  END IF;
  RETURN QUERY
  SELECT
    e.id,
    e.auth_id,
    e.nome,
    e.telefone,
    e.valor,
    e.prazo_dias,
    e.finalidade,
    e.renda_declarada,
    e.observacoes,
    e.juros_pct,
    e.total_previsto,
    e.status,
    e.criado_em,
    e.atualizado_em,
    u.nome AS usuario_nome,
    COALESCE(u.tipo, 'operador') AS usuario_tipo,
    COALESCE(u.papeis, '{}'::text[]) AS usuario_papeis
  FROM public.emprestimos e
  LEFT JOIN public.usuarios u ON u.auth_id = e.auth_id
  ORDER BY
    CASE WHEN e.status = 'analise' THEN 0 ELSE 1 END,
    e.criado_em DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_emprestimos(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_emprestimos(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_contar_emprestimos_pendentes()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN 0;
  END IF;
  SELECT COUNT(*)::integer INTO n
  FROM public.emprestimos
  WHERE status = 'analise';
  RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_contar_emprestimos_pendentes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_contar_emprestimos_pendentes() TO authenticated;

COMMENT ON FUNCTION public.admin_listar_emprestimos(integer) IS
  'Admin: lista empréstimos (pendentes primeiro) com nome/papéis do solicitante.';
COMMENT ON FUNCTION public.admin_contar_emprestimos_pendentes() IS
  'Admin: contagem de empréstimos em análise (badge/notificação).';
