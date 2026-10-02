-- =====================================================================
-- MINERA PARA - 52 admin_listar_emprestimos: corrige erro 42804
-- "Returned type character varying(100) does not match expected type text
--  in column 15" (usuarios.nome e varchar(100)). Cada coluna do SELECT
-- recebe cast explicito para o tipo do RETURNS TABLE. Mesma assinatura,
-- mesma logica, mesma checagem is_admin(). Idempotente.
-- =====================================================================

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
    (e.id)::integer AS id,
    (e.auth_id)::uuid AS auth_id,
    (e.nome)::text AS nome,
    (e.telefone)::text AS telefone,
    (e.valor)::numeric AS valor,
    (e.prazo_dias)::integer AS prazo_dias,
    (e.finalidade)::text AS finalidade,
    (e.renda_declarada)::numeric AS renda_declarada,
    (e.observacoes)::text AS observacoes,
    (e.juros_pct)::numeric AS juros_pct,
    (e.total_previsto)::numeric AS total_previsto,
    (e.status)::text AS status,
    (e.criado_em)::timestamptz AS criado_em,
    (e.atualizado_em)::timestamptz AS atualizado_em,
    (u.nome)::text AS usuario_nome,
    (COALESCE(u.tipo, 'operador'))::text AS usuario_tipo,
    (COALESCE(u.papeis, '{}'::text[]))::text[] AS usuario_papeis,
    (e.endereco)::text AS endereco,
    (e.empresa)::text AS empresa,
    (e.anos_empresa)::numeric AS anos_empresa,
    (e.comprova_renda)::boolean AS comprova_renda,
    (e.doc_energia_url)::text AS doc_energia_url,
    (e.doc_identidade_url)::text AS doc_identidade_url,
    (e.doc_cpf_url)::text AS doc_cpf_url,
    (e.doc_selfie_url)::text AS doc_selfie_url,
    (e.doc_extrato_url)::text AS doc_extrato_url,
    (e.vencimento)::date AS vencimento,
    (e.pago_em)::timestamptz AS pago_em,
    (e.questionario)::jsonb AS questionario,
    (CASE
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento >= CURRENT_DATE
        THEN (e.vencimento - CURRENT_DATE)::integer
      ELSE NULL
    END)::integer AS dias_restantes,
    (CASE
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento < CURRENT_DATE
        THEN (CURRENT_DATE - e.vencimento)::integer
      ELSE NULL
    END)::integer AS dias_atraso,
    (CASE
      WHEN e.status = 'analise' THEN 'analise'
      WHEN e.status = 'rejeitado' THEN 'recusados'
      WHEN e.status = 'pago' THEN 'quitados'
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento < CURRENT_DATE THEN 'atraso'
      WHEN e.status = 'aprovado' AND e.vencimento IS NOT NULL AND e.vencimento <= (CURRENT_DATE + 3) THEN 'a_vencer'
      WHEN e.status = 'aprovado' THEN 'ativos'
      ELSE COALESCE(e.status, 'analise')
    END)::text AS fila
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
REVOKE ALL ON FUNCTION public.admin_listar_emprestimos(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_emprestimos(integer) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Verificacao (no SQL Editor roda como postgres: is_admin() = false -> esperado
-- o erro 'apenas admin', NAO o 42804). Checagem estatica:
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'admin_listar_emprestimos'
     AND pronamespace = 'public'::regnamespace) AS funcoes,
  (SELECT bool_and(prosrc ILIKE '%(u.nome)::text AS usuario_nome%') FROM pg_proc
    WHERE proname = 'admin_listar_emprestimos' AND pronamespace = 'public'::regnamespace) AS cast_ok,
  has_function_privilege('anon', 'public.admin_listar_emprestimos(integer)', 'EXECUTE') AS anon_exec;
