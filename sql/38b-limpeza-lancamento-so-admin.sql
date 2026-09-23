-- MINERA PARA — 38b limpeza LANCAMENTO (sem storage.objects)
-- Mantem APENAS: facilveiculos2015@gmail.com
-- Preserva: schema/RLS, pix_admin, britagem_config, app_flags, app_promos
-- Storage: limpar no Dashboard se precisar (SQL DELETE em storage e bloqueado)

DO $$
DECLARE
  keep_email text := 'facilveiculos2015@gmail.com';
  keep_auth uuid;
  t text;
  wipe_tables text[] := ARRAY['chat_leituras', 'chat_contatos', 'chat_mensagens', 'suporte_mensagens', 'indicacao_pontos', 'comissoes', 'caixa_deposito_pedidos', 'caixa_saque_pedidos', 'caixa_movimentos', 'emprestimos', 'fretes', 'processamento', 'expedicao', 'estoque', 'logs_sistema', 'cotacoes_historico', 'lotes', 'pix_pagamentos', 'chat_conversas_ocultas', 'admin_alertas', 'app_bank_block_logs'];
BEGIN
  SELECT id INTO keep_auth FROM auth.users WHERE lower(trim(email)) = keep_email LIMIT 1;
  IF keep_auth IS NULL THEN
    RAISE EXCEPTION 'ABORT: admin % nao existe em auth.users', keep_email;
  END IF;

  FOREACH t IN ARRAY wipe_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'TRUNCATED %', t;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_saldos') THEN
    DELETE FROM public.caixa_saldos WHERE auth_id IS DISTINCT FROM keep_auth;
    UPDATE public.caixa_saldos SET saldo = 0, atualizado_em = now() WHERE auth_id = keep_auth;
  END IF;

  DELETE FROM public.usuarios
  WHERE lower(trim(email)) IS DISTINCT FROM keep_email
    AND (auth_id IS NULL OR auth_id IS DISTINCT FROM keep_auth);

  INSERT INTO public.usuarios (auth_id, email, nome, tipo, papeis, senha_hash)
  SELECT keep_auth, keep_email,
    COALESCE(NULLIF(trim(au.raw_user_meta_data->>'nome'),''), NULLIF(trim(au.raw_user_meta_data->>'full_name'),''), 'Admin'),
    'admin', ARRAY['admin']::text[], 'supabase-auth'
  FROM auth.users au WHERE au.id = keep_auth
  ON CONFLICT (auth_id) DO UPDATE
  SET email = EXCLUDED.email, tipo = 'admin', papeis = ARRAY['admin']::text[];

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='usuarios' AND column_name='pontos_saldo') THEN
    UPDATE public.usuarios SET tipo='admin', papeis=ARRAY['admin']::text[], email=keep_email, pontos_saldo=0
    WHERE auth_id = keep_auth OR lower(trim(email)) = keep_email;
  ELSE
    UPDATE public.usuarios SET tipo='admin', papeis=ARRAY['admin']::text[], email=keep_email
    WHERE auth_id = keep_auth OR lower(trim(email)) = keep_email;
  END IF;

  DELETE FROM auth.users WHERE id IS DISTINCT FROM keep_auth;

  RAISE NOTICE 'OK limpeza lancamento sem storage. keep=%', keep_email;
END $$;

SELECT 'auth.users' AS onde, count(*)::int AS qtd FROM auth.users
UNION ALL SELECT 'usuarios', count(*)::int FROM public.usuarios
UNION ALL SELECT 'lotes', count(*)::int FROM public.lotes
UNION ALL SELECT 'chat_mensagens', count(*)::int FROM public.chat_mensagens
UNION ALL SELECT 'caixa_saldos', count(*)::int FROM public.caixa_saldos;

SELECT id, email, tipo, papeis, auth_id FROM public.usuarios ORDER BY email;
