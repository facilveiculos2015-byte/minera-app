-- =====================================================================
-- MINERA APP - 30 Admin Crédito / KYC / Alertas de vencimento
-- Incremental. Idempotente. NÃO wipe. Rodar após 29-lotes-localidade.sql.
-- Depende de public.is_admin() (SQL 17) e emprestimos (SQL 14/23).
-- =====================================================================

-- 1) Colunas KYC / docs / vencimento em emprestimos
ALTER TABLE public.emprestimos
  ADD COLUMN IF NOT EXISTS endereco text,
  ADD COLUMN IF NOT EXISTS empresa text,
  ADD COLUMN IF NOT EXISTS anos_empresa numeric,
  ADD COLUMN IF NOT EXISTS comprova_renda boolean,
  ADD COLUMN IF NOT EXISTS doc_energia_url text,
  ADD COLUMN IF NOT EXISTS doc_identidade_url text,
  ADD COLUMN IF NOT EXISTS doc_cpf_url text,
  ADD COLUMN IF NOT EXISTS doc_selfie_url text,
  ADD COLUMN IF NOT EXISTS doc_extrato_url text,
  ADD COLUMN IF NOT EXISTS vencimento date,
  ADD COLUMN IF NOT EXISTS pago_em timestamptz,
  ADD COLUMN IF NOT EXISTS questionario jsonb;

CREATE INDEX IF NOT EXISTS idx_emprestimos_vencimento
  ON public.emprestimos (vencimento)
  WHERE status = 'aprovado';

COMMENT ON COLUMN public.emprestimos.endereco IS 'Endereço completo (KYC bot)';
COMMENT ON COLUMN public.emprestimos.vencimento IS 'Data de vencimento do empréstimo aprovado';
COMMENT ON COLUMN public.emprestimos.pago_em IS 'Quando foi marcado quitado';

-- 2) Tabela admin_alertas (crédito a vencer / atraso)
CREATE TABLE IF NOT EXISTS public.admin_alertas (
  id bigserial PRIMARY KEY,
  tipo text NOT NULL, -- emprestimo_a_vencer | emprestimo_atraso | emprestimo_analise
  emprestimo_id integer REFERENCES public.emprestimos(id) ON DELETE CASCADE,
  auth_id uuid,
  titulo text NOT NULL,
  corpo text,
  dias integer,
  lido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  chave text UNIQUE -- evita duplicar o mesmo alerta no mesmo dia
);

CREATE INDEX IF NOT EXISTS idx_admin_alertas_lido_em
  ON public.admin_alertas (lido, criado_em DESC);

ALTER TABLE public.admin_alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_alertas_select_admin" ON public.admin_alertas;
DROP POLICY IF EXISTS "admin_alertas_update_admin" ON public.admin_alertas;
DROP POLICY IF EXISTS "admin_alertas_all_admin" ON public.admin_alertas;

CREATE POLICY "admin_alertas_select_admin" ON public.admin_alertas
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "admin_alertas_update_admin" ON public.admin_alertas
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, UPDATE ON TABLE public.admin_alertas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.admin_alertas_id_seq TO authenticated;

-- 3) Storage bucket emprestimo-docs (privado; dono sobe na pasta própria; admin lê)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'emprestimo-docs',
  'emprestimo-docs',
  false,
  10485760 -- 10 MB
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = COALESCE(storage.buckets.file_size_limit, 10485760);

DROP POLICY IF EXISTS "emp_docs_select_own_or_admin" ON storage.objects;
DROP POLICY IF EXISTS "emp_docs_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "emp_docs_update_own" ON storage.objects;
DROP POLICY IF EXISTS "emp_docs_delete_own" ON storage.objects;

-- Path: {auth_uid}/arquivo.ext
CREATE POLICY "emp_docs_select_own_or_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'emprestimo-docs'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

CREATE POLICY "emp_docs_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'emprestimo-docs'
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
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- 4) RPC admin_listar_emprestimos — estende com KYC / docs / vencimento / dias
DROP FUNCTION IF EXISTS public.admin_listar_emprestimos(integer);
DROP FUNCTION IF EXISTS public.admin_listar_emprestimos(int);

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
  usuario_papeis text[],
  endereco text,
  empresa text,
  anos_empresa numeric,
  comprova_renda boolean,
  doc_energia_url text,
  doc_identidade_url text,
  doc_cpf_url text,
  doc_selfie_url text,
  doc_extrato_url text,
  vencimento date,
  pago_em timestamptz,
  questionario jsonb,
  dias_restantes integer,
  dias_atraso integer,
  fila text
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
    COALESCE(u.papeis, '{}'::text[]) AS usuario_papeis,
    e.endereco,
    e.empresa,
    e.anos_empresa,
    e.comprova_renda,
    e.doc_energia_url,
    e.doc_identidade_url,
    e.doc_cpf_url,
    e.doc_selfie_url,
    e.doc_extrato_url,
    e.vencimento,
    e.pago_em,
    e.questionario,
    CASE
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento >= CURRENT_DATE
        THEN (e.vencimento - CURRENT_DATE)::integer
      ELSE NULL
    END AS dias_restantes,
    CASE
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento < CURRENT_DATE
        THEN (CURRENT_DATE - e.vencimento)::integer
      ELSE NULL
    END AS dias_atraso,
    CASE
      WHEN e.status = 'analise' THEN 'analise'
      WHEN e.status = 'rejeitado' THEN 'recusados'
      WHEN e.status = 'pago' THEN 'quitados'
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento < CURRENT_DATE THEN 'atraso'
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento <= (CURRENT_DATE + 3) THEN 'a_vencer'
      WHEN e.status = 'aprovado' THEN 'ativos'
      ELSE COALESCE(e.status, 'analise')
    END AS fila
  FROM public.emprestimos e
  LEFT JOIN public.usuarios u ON u.auth_id = e.auth_id
  ORDER BY
    CASE
      WHEN e.status = 'analise' THEN 0
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento < CURRENT_DATE THEN 1
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento <= (CURRENT_DATE + 3) THEN 2
      WHEN e.status = 'aprovado' THEN 3
      WHEN e.status = 'pago' THEN 4
      ELSE 5
    END,
    e.criado_em DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_emprestimos(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_emprestimos(integer) TO authenticated;

-- 5) KPIs crédito (admin)
CREATE OR REPLACE FUNCTION public.admin_credito_kpis()
RETURNS TABLE (
  em_analise integer,
  a_vencer_3d integer,
  atrasados integer,
  total_em_aberto numeric,
  total_quitado_mes numeric
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
    (SELECT COUNT(*)::integer FROM emprestimos WHERE status = 'analise'),
    (SELECT COUNT(*)::integer FROM emprestimos
      WHERE status = 'aprovado' AND vencimento IS NOT NULL
        AND vencimento >= CURRENT_DATE AND vencimento <= (CURRENT_DATE + 3)),
    (SELECT COUNT(*)::integer FROM emprestimos
      WHERE status = 'aprovado' AND vencimento IS NOT NULL AND vencimento < CURRENT_DATE),
    (SELECT COALESCE(SUM(valor), 0) FROM emprestimos WHERE status = 'aprovado'),
    (SELECT COALESCE(SUM(valor), 0) FROM emprestimos
      WHERE status = 'pago'
        AND COALESCE(pago_em, atualizado_em) >= date_trunc('month', now()));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credito_kpis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credito_kpis() TO authenticated;

-- 6) Gera alertas a vencer / atraso (idempotente por chave dia+tipo+emp)
CREATE OR REPLACE FUNCTION public.admin_gerar_alertas_credito()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  r record;
  k text;
  t text;
  tit text;
  cor text;
  d integer;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT e.id, e.auth_id, e.nome, e.valor, e.vencimento, e.status,
           CASE
             WHEN e.vencimento < CURRENT_DATE THEN (CURRENT_DATE - e.vencimento)
             ELSE (e.vencimento - CURRENT_DATE)
           END AS dias
    FROM emprestimos e
    WHERE e.status = 'aprovado'
      AND e.vencimento IS NOT NULL
      AND e.vencimento <= (CURRENT_DATE + 3)
  LOOP
    IF r.vencimento < CURRENT_DATE THEN
      t := 'emprestimo_atraso';
      d := r.dias::integer;
      tit := 'Empréstimo em atraso';
      cor := COALESCE(r.nome, 'Cliente') || ' · R$ ' || trim(to_char(r.valor, '999999990.00'))
             || ' · ' || d || ' dia(s) de atraso · venc. ' || to_char(r.vencimento, 'DD/MM/YYYY');
      k := 'atraso:' || r.id::text || ':' || to_char(CURRENT_DATE, 'YYYY-MM-DD');
    ELSE
      t := 'emprestimo_a_vencer';
      d := r.dias::integer;
      tit := 'Empréstimo a vencer';
      cor := COALESCE(r.nome, 'Cliente') || ' · R$ ' || trim(to_char(r.valor, '999999990.00'))
             || ' · vence em ' || d || ' dia(s) · ' || to_char(r.vencimento, 'DD/MM/YYYY');
      k := 'vencer:' || r.id::text || ':' || to_char(CURRENT_DATE, 'YYYY-MM-DD');
    END IF;

    INSERT INTO admin_alertas (tipo, emprestimo_id, auth_id, titulo, corpo, dias, chave)
    VALUES (t, r.id, r.auth_id, tit, cor, d, k)
    ON CONFLICT (chave) DO NOTHING;
    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_gerar_alertas_credito() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_gerar_alertas_credito() TO authenticated;

-- Contagem de alertas não lidos (badge)
CREATE OR REPLACE FUNCTION public.admin_contar_alertas_nao_lidos()
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
  SELECT COUNT(*)::integer INTO n FROM admin_alertas WHERE lido = false;
  RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_contar_alertas_nao_lidos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_contar_alertas_nao_lidos() TO authenticated;

-- Marcar alerta lido
CREATE OR REPLACE FUNCTION public.admin_marcar_alerta_lido(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas admin';
  END IF;
  UPDATE admin_alertas SET lido = true WHERE id = p_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_marcar_alerta_lido(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_marcar_alerta_lido(bigint) TO authenticated;

-- Listar alertas
CREATE OR REPLACE FUNCTION public.admin_listar_alertas(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id bigint,
  tipo text,
  emprestimo_id integer,
  auth_id uuid,
  titulo text,
  corpo text,
  dias integer,
  lido boolean,
  criado_em timestamptz
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
  SELECT a.id, a.tipo, a.emprestimo_id, a.auth_id, a.titulo, a.corpo, a.dias, a.lido, a.criado_em
  FROM admin_alertas a
  ORDER BY a.lido ASC, a.criado_em DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_alertas(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_alertas(integer) TO authenticated;

-- Contagem pendentes agora inclui alertas de vencimento (mantém nome antigo + novo helper)
DROP FUNCTION IF EXISTS public.admin_contar_emprestimos_pendentes();

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

COMMENT ON FUNCTION public.admin_listar_emprestimos(integer) IS
  'Admin: lista empréstimos com KYC/docs/vencimento/fila (SQL 30).';
COMMENT ON FUNCTION public.admin_gerar_alertas_credito() IS
  'Admin: cria alertas a vencer (≤3d) e em atraso (idempotente por dia).';
COMMENT ON FUNCTION public.admin_credito_kpis() IS
  'Admin: KPIs da mesa de crédito.';
