-- =====================================================================
-- MINERA APP - 17 RLS isolamento (sem acesso cross-profile)
-- Incremental. Idempotente. NÃO wipe. Rodar após 16-suporte-indicacao.sql.
-- =====================================================================

-- 1) Helper: admin check (bypassa RLS via SECURITY DEFINER)
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

-- 2) Indicação: crédito no indicador sem o novo user poder UPDATE outros perfis
CREATE OR REPLACE FUNCTION public.processar_indicacao(
  p_codigo text,
  p_pontos numeric DEFAULT 10,
  p_motivo text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ref uuid;
  v_saldo numeric;
BEGIN
  IF v_uid IS NULL OR p_codigo IS NULL OR length(trim(p_codigo)) = 0 THEN
    RETURN false;
  END IF;
  IF p_pontos IS NULL OR p_pontos <= 0 THEN
    RETURN false;
  END IF;

  SELECT u.auth_id INTO v_ref
  FROM public.usuarios u
  WHERE upper(u.codigo_indicacao) = upper(trim(p_codigo))
  LIMIT 1;

  IF v_ref IS NULL OR v_ref = v_uid THEN
    RETURN false;
  END IF;

  UPDATE public.usuarios
  SET indicado_por = upper(trim(p_codigo))
  WHERE auth_id = v_uid
    AND (indicado_por IS NULL OR indicado_por = '');

  SELECT COALESCE(pontos_saldo, 0) INTO v_saldo
  FROM public.usuarios WHERE auth_id = v_ref;

  UPDATE public.usuarios
  SET pontos_saldo = round((COALESCE(v_saldo, 0) + p_pontos)::numeric, 2)
  WHERE auth_id = v_ref;

  INSERT INTO public.indicacao_pontos (auth_id, pontos, motivo)
  VALUES (
    v_ref,
    p_pontos,
    COALESCE(p_motivo, 'Indicação (código ' || upper(trim(p_codigo)) || ')')
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.processar_indicacao(text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.processar_indicacao(text, numeric, text) TO authenticated;

-- =====================================================================
-- USUARIOS
-- =====================================================================
DROP POLICY IF EXISTS "Leitura geral para autenticados" ON usuarios;
DROP POLICY IF EXISTS "usuarios_select_auth" ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert_auth" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_own" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_auth" ON usuarios;
DROP POLICY IF EXISTS "usuarios_select_own_or_admin" ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert_own" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_own_or_admin" ON usuarios;

CREATE POLICY "usuarios_select_own_or_admin" ON usuarios
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

CREATE POLICY "usuarios_insert_own" ON usuarios
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "usuarios_update_own_or_admin" ON usuarios
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE usuarios TO authenticated;

-- =====================================================================
-- LOTES (feed público autenticado; mutação própria / admin)
-- =====================================================================
DROP POLICY IF EXISTS "lotes_select_auth" ON lotes;
DROP POLICY IF EXISTS "lotes_insert_auth" ON lotes;
DROP POLICY IF EXISTS "lotes_update_auth" ON lotes;
DROP POLICY IF EXISTS "lotes_delete_auth" ON lotes;
DROP POLICY IF EXISTS "lotes_select_marketplace" ON lotes;
DROP POLICY IF EXISTS "lotes_insert_own" ON lotes;
DROP POLICY IF EXISTS "lotes_update_own_or_admin" ON lotes;
DROP POLICY IF EXISTS "lotes_delete_own_or_admin" ON lotes;

CREATE POLICY "lotes_select_marketplace" ON lotes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "lotes_insert_own" ON lotes
  FOR INSERT TO authenticated
  WITH CHECK (criado_por_id = auth.uid());

CREATE POLICY "lotes_update_own_or_admin" ON lotes
  FOR UPDATE TO authenticated
  USING (criado_por_id = auth.uid() OR public.is_admin())
  WITH CHECK (criado_por_id = auth.uid() OR public.is_admin());

CREATE POLICY "lotes_delete_own_or_admin" ON lotes
  FOR DELETE TO authenticated
  USING (criado_por_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lotes TO authenticated;

-- =====================================================================
-- CAIXA (saldos, movimentos, depósitos, saques)
-- =====================================================================
DROP POLICY IF EXISTS "caixa_saldos_select_auth" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_insert_auth" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_update_auth" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_select_own_or_admin" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_insert_own_or_admin" ON caixa_saldos;
DROP POLICY IF EXISTS "caixa_saldos_update_own_or_admin" ON caixa_saldos;

CREATE POLICY "caixa_saldos_select_own_or_admin" ON caixa_saldos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "caixa_saldos_insert_own_or_admin" ON caixa_saldos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "caixa_saldos_update_own_or_admin" ON caixa_saldos
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "caixa_movimentos_select_auth" ON caixa_movimentos;
DROP POLICY IF EXISTS "caixa_movimentos_insert_auth" ON caixa_movimentos;
DROP POLICY IF EXISTS "caixa_movimentos_select_own_or_admin" ON caixa_movimentos;
DROP POLICY IF EXISTS "caixa_movimentos_insert_own_or_admin" ON caixa_movimentos;

CREATE POLICY "caixa_movimentos_select_own_or_admin" ON caixa_movimentos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "caixa_movimentos_insert_own_or_admin" ON caixa_movimentos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "caixa_dep_select_auth" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_insert_auth" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_update_auth" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_select_own_or_admin" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_insert_own" ON caixa_deposito_pedidos;
DROP POLICY IF EXISTS "caixa_dep_update_own_or_admin" ON caixa_deposito_pedidos;

CREATE POLICY "caixa_dep_select_own_or_admin" ON caixa_deposito_pedidos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "caixa_dep_insert_own" ON caixa_deposito_pedidos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());
CREATE POLICY "caixa_dep_update_own_or_admin" ON caixa_deposito_pedidos
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "caixa_saque_select_auth" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_insert_auth" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_update_auth" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_select_own_or_admin" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_insert_own" ON caixa_saque_pedidos;
DROP POLICY IF EXISTS "caixa_saque_update_own_or_admin" ON caixa_saque_pedidos;

CREATE POLICY "caixa_saque_select_own_or_admin" ON caixa_saque_pedidos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "caixa_saque_insert_own" ON caixa_saque_pedidos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());
CREATE POLICY "caixa_saque_update_own_or_admin" ON caixa_saque_pedidos
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE caixa_saldos TO authenticated;
GRANT SELECT, INSERT ON TABLE caixa_movimentos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE caixa_deposito_pedidos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE caixa_saque_pedidos TO authenticated;

-- =====================================================================
-- EMPRESTIMOS
-- =====================================================================
DROP POLICY IF EXISTS "emprestimos_select_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_insert_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_update_auth" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_select_own_or_admin" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_insert_own" ON emprestimos;
DROP POLICY IF EXISTS "emprestimos_update_own_or_admin" ON emprestimos;

CREATE POLICY "emprestimos_select_own_or_admin" ON emprestimos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "emprestimos_insert_own" ON emprestimos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());
CREATE POLICY "emprestimos_update_own_or_admin" ON emprestimos
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE emprestimos TO authenticated;

-- =====================================================================
-- COMISSOES
-- =====================================================================
DROP POLICY IF EXISTS "comissoes_select_auth" ON comissoes;
DROP POLICY IF EXISTS "comissoes_insert_auth" ON comissoes;
DROP POLICY IF EXISTS "comissoes_update_auth" ON comissoes;
DROP POLICY IF EXISTS "comissoes_select_own_or_admin" ON comissoes;
DROP POLICY IF EXISTS "comissoes_insert_own" ON comissoes;
DROP POLICY IF EXISTS "comissoes_update_own_or_admin" ON comissoes;

CREATE POLICY "comissoes_select_own_or_admin" ON comissoes
  FOR SELECT TO authenticated
  USING (vendedor_auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "comissoes_insert_own" ON comissoes
  FOR INSERT TO authenticated
  WITH CHECK (vendedor_auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "comissoes_update_own_or_admin" ON comissoes
  FOR UPDATE TO authenticated
  USING (vendedor_auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (vendedor_auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE comissoes TO authenticated;

-- =====================================================================
-- CHAT (equipe: select/insert auth; update soft-delete own/admin)
-- =====================================================================
DROP POLICY IF EXISTS "chat_select_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_insert_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_update_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_update_own_or_admin" ON chat_mensagens;

CREATE POLICY "chat_select_auth" ON chat_mensagens
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "chat_insert_auth" ON chat_mensagens
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "chat_update_own_or_admin" ON chat_mensagens
  FOR UPDATE TO authenticated
  USING (de_auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (de_auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE chat_mensagens TO authenticated;

-- =====================================================================
-- SUPORTE
-- =====================================================================
DROP POLICY IF EXISTS "suporte_select_auth" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_insert_auth" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_update_auth" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_select_own_or_admin" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_insert_own_or_admin" ON suporte_mensagens;
DROP POLICY IF EXISTS "suporte_update_admin" ON suporte_mensagens;

CREATE POLICY "suporte_select_own_or_admin" ON suporte_mensagens
  FOR SELECT TO authenticated
  USING (thread_auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "suporte_insert_own_or_admin" ON suporte_mensagens
  FOR INSERT TO authenticated
  WITH CHECK (thread_auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "suporte_update_admin" ON suporte_mensagens
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE suporte_mensagens TO authenticated;

-- =====================================================================
-- INDICACAO_PONTOS
-- =====================================================================
DROP POLICY IF EXISTS "indicacao_pontos_select_auth" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_insert_auth" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_update_auth" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_select_own_or_admin" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_insert_own_or_admin" ON indicacao_pontos;
DROP POLICY IF EXISTS "indicacao_pontos_update_own_or_admin" ON indicacao_pontos;

CREATE POLICY "indicacao_pontos_select_own_or_admin" ON indicacao_pontos
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "indicacao_pontos_insert_own_or_admin" ON indicacao_pontos
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "indicacao_pontos_update_own_or_admin" ON indicacao_pontos
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE indicacao_pontos TO authenticated;

-- =====================================================================
-- PIX_PAGAMENTOS / PIX_ADMIN
-- =====================================================================
DROP POLICY IF EXISTS "pix_pag_select_auth" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_insert_auth" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_update_auth" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_select_own_or_admin" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_insert_own" ON pix_pagamentos;
DROP POLICY IF EXISTS "pix_pag_update_own_or_admin" ON pix_pagamentos;

CREATE POLICY "pix_pag_select_own_or_admin" ON pix_pagamentos
  FOR SELECT TO authenticated
  USING (usuario_auth_id = auth.uid() OR public.is_admin());
CREATE POLICY "pix_pag_insert_own" ON pix_pagamentos
  FOR INSERT TO authenticated
  WITH CHECK (usuario_auth_id = auth.uid());
CREATE POLICY "pix_pag_update_own_or_admin" ON pix_pagamentos
  FOR UPDATE TO authenticated
  USING (usuario_auth_id = auth.uid() OR public.is_admin())
  WITH CHECK (usuario_auth_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "pix_admin_select_auth" ON pix_admin;
DROP POLICY IF EXISTS "pix_admin_insert_auth" ON pix_admin;
DROP POLICY IF EXISTS "pix_admin_update_auth" ON pix_admin;
DROP POLICY IF EXISTS "pix_admin_insert_admin" ON pix_admin;
DROP POLICY IF EXISTS "pix_admin_update_admin" ON pix_admin;

CREATE POLICY "pix_admin_select_auth" ON pix_admin
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pix_admin_insert_admin" ON pix_admin
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "pix_admin_update_admin" ON pix_admin
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON TABLE pix_pagamentos TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE pix_admin TO authenticated;

-- =====================================================================
-- BRITAGEM_CONFIG / COTACOES_HISTORICO
-- =====================================================================
DROP POLICY IF EXISTS "britagem_config_select_auth" ON britagem_config;
DROP POLICY IF EXISTS "britagem_config_insert_auth" ON britagem_config;
DROP POLICY IF EXISTS "britagem_config_update_auth" ON britagem_config;
DROP POLICY IF EXISTS "britagem_config_update_admin" ON britagem_config;

CREATE POLICY "britagem_config_select_auth" ON britagem_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "britagem_config_insert_auth" ON britagem_config
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "britagem_config_update_admin" ON britagem_config
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "cotacoes_historico_select_auth" ON cotacoes_historico;
DROP POLICY IF EXISTS "cotacoes_historico_insert_auth" ON cotacoes_historico;

CREATE POLICY "cotacoes_historico_select_auth" ON cotacoes_historico
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cotacoes_historico_insert_auth" ON cotacoes_historico
  FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE britagem_config TO authenticated;
GRANT SELECT, INSERT ON TABLE cotacoes_historico TO authenticated;

-- =====================================================================
-- OPERACIONAIS: fretes, processamento, estoque, expedicao, logs
-- select auth; insert auth; update own/admin onde houver criado_por_id
-- =====================================================================
DROP POLICY IF EXISTS "fretes_select_auth" ON fretes;
DROP POLICY IF EXISTS "fretes_insert_auth" ON fretes;
DROP POLICY IF EXISTS "fretes_update_auth" ON fretes;
DROP POLICY IF EXISTS "fretes_insert_own" ON fretes;
DROP POLICY IF EXISTS "fretes_update_own_or_admin" ON fretes;

CREATE POLICY "fretes_select_auth" ON fretes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "fretes_insert_own" ON fretes
  FOR INSERT TO authenticated
  WITH CHECK (criado_por_id = auth.uid() OR criado_por_id IS NULL OR public.is_admin());
CREATE POLICY "fretes_update_own_or_admin" ON fretes
  FOR UPDATE TO authenticated
  USING (criado_por_id = auth.uid() OR public.is_admin())
  WITH CHECK (criado_por_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "proc_select_auth" ON processamento;
DROP POLICY IF EXISTS "proc_insert_auth" ON processamento;
DROP POLICY IF EXISTS "proc_update_auth" ON processamento;
DROP POLICY IF EXISTS "Leitura processamento" ON processamento;
DROP POLICY IF EXISTS "Inserir processamento" ON processamento;

CREATE POLICY "proc_select_auth" ON processamento
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "proc_insert_auth" ON processamento
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "proc_update_auth" ON processamento
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "estoque_select_auth" ON estoque;
DROP POLICY IF EXISTS "estoque_insert_auth" ON estoque;
DROP POLICY IF EXISTS "estoque_update_auth" ON estoque;
DROP POLICY IF EXISTS "Leitura estoque" ON estoque;

CREATE POLICY "estoque_select_auth" ON estoque
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "estoque_insert_auth" ON estoque
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "estoque_update_auth" ON estoque
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "expedicao_select_auth" ON expedicao;
DROP POLICY IF EXISTS "expedicao_insert_auth" ON expedicao;
DROP POLICY IF EXISTS "Leitura expedicao" ON expedicao;

CREATE POLICY "expedicao_select_auth" ON expedicao
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "expedicao_insert_auth" ON expedicao
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "logs_select_auth" ON logs_sistema;
DROP POLICY IF EXISTS "logs_insert_auth" ON logs_sistema;

CREATE POLICY "logs_select_auth" ON logs_sistema
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "logs_insert_auth" ON logs_sistema
  FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON TABLE fretes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE processamento TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE estoque TO authenticated;
GRANT SELECT, INSERT ON TABLE expedicao TO authenticated;
GRANT SELECT, INSERT ON TABLE logs_sistema TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
