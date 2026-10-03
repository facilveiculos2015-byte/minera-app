-- =====================================================================
-- MINERA PARA - 53 admin_contar_mensagens: contador "Mensagens" do
-- painel admin (Visao geral) conta SO mensagens que ainda existem.
-- Antes o app contava chat_mensagens inteiro (count exact), incluindo:
--   - apagadas para todos / pelo admin (deleted_at preenchido, soft-delete)
--   - removidas pela moderacao (moderacao = 'removida')
--   - agendadas ainda nao enviadas (status = 'agendada')
--   - conversas apagadas pelos DOIS lados (SQL 49: corte por id em
--     chat_conversas_limpas.limpo_ate_id) ou mensagem apagada "para mim"
--     pelos dois (apagada_para contem remetente e destinatario).
-- Regra: conta a mensagem se ela ainda aparece para PELO MENOS UM dos
-- dois participantes (mesmos filtros do chat_dm_pagina do SQL 49).
-- So admin (is_admin()). Somente leitura. Idempotente.
-- Obs.: a correcao do admin_listar_emprestimos (varchar(100) x text,
-- coluna 15) esta no sql/52-admin-listar-emprestimos-fix.sql - aplique
-- o 52 tambem, se ainda nao aplicou.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_contar_mensagens()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'apenas admin';
  END IF;
  SELECT count(*) INTO v_n
    FROM public.chat_mensagens m
   WHERE m.deleted_at IS NULL
     AND COALESCE(m.moderacao, '') <> 'removida'
     AND COALESCE(m.status, 'enviada') <> 'agendada'
     AND (
           ( -- ainda visivel para o remetente
             NOT (m.de_auth_id = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
             AND m.id > COALESCE((SELECT l.limpo_ate_id FROM public.chat_conversas_limpas l
                                   WHERE l.auth_id = m.de_auth_id
                                     AND l.outro_auth_id = m.para_auth_id), 0)
           )
        OR ( -- ainda visivel para o destinatario
             NOT (m.para_auth_id = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
             AND m.id > COALESCE((SELECT l.limpo_ate_id FROM public.chat_conversas_limpas l
                                   WHERE l.auth_id = m.para_auth_id
                                     AND l.outro_auth_id = m.de_auth_id), 0)
           )
         );
  RETURN COALESCE(v_n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_contar_mensagens() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_contar_mensagens() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_contar_mensagens() TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Verificacao (SQL Editor roda como postgres: is_admin() = false, entao
-- chamar a funcao aqui da 'apenas admin' - esperado). Comparativo direto:
SELECT
  (SELECT count(*) FROM public.chat_mensagens) AS total_bruto,
  (SELECT count(*) FROM public.chat_mensagens WHERE deleted_at IS NULL) AS sem_soft_delete,
  has_function_privilege('anon', 'public.admin_contar_mensagens()', 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', 'public.admin_contar_mensagens()', 'EXECUTE') AS auth_exec;
