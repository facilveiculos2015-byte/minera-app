-- =====================================================================
-- MINERA PARÁ — 38 Limpeza total para LANÇAMENTO
-- Mantém APENAS: facilveiculos2015@gmail.com (admin)
-- Apaga: demais usuários (public + auth), lotes, chats, caixa, empréstimos,
--        fretes, suporte, comissões, logs, estoque/expedição/processamento
-- Preserva: schema/RLS, pix_admin, britagem_config, app_flags, app_promos
-- NÃO DROP de tabelas. Rodar no Supabase SQL Editor (role postgres).
-- =====================================================================

DO $$
DECLARE
  keep_email text := 'facilveiculos2015@gmail.com';
  keep_auth uuid;
  t text;
  wipe_tables text[] := ARRAY[
    'chat_leituras',
    'chat_contatos',
    'chat_conversas_ocultas',
    'chat_mensagens',
    'suporte_mensagens',
    'indicacao_pontos',
    'comissoes',
    'caixa_deposito_pedidos',
    'caixa_saque_pedidos',
    'caixa_movimentos',
    'emprestimos',
    'fretes',
    'processamento',
    'expedicao',
    'estoque',
    'logs_sistema',
    'cotacoes_historico',
    'lotes',
    'pix_pagamentos',
    'admin_alertas',
    'app_bank_block_logs'
  ];
BEGIN
  SELECT id INTO keep_auth
  FROM auth.users
  WHERE lower(trim(email)) = keep_email
  LIMIT 1;

  IF keep_auth IS NULL THEN
    RAISE EXCEPTION
      'ABORT: admin % não existe em auth.users. Faça login/cadastro dessa conta antes.',
      keep_email;
  END IF;

  FOREACH t IN ARRAY wipe_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'TRUNCATED %', t;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'caixa_saldos'
  ) THEN
    DELETE FROM public.caixa_saldos
    WHERE auth_id IS DISTINCT FROM keep_auth;
    UPDATE public.caixa_saldos
    SET saldo = 0, atualizado_em = now()
    WHERE auth_id = keep_auth;
  END IF;

  DELETE FROM public.usuarios
  WHERE lower(trim(email)) IS DISTINCT FROM keep_email
    AND (auth_id IS NULL OR auth_id IS DISTINCT FROM keep_auth);

  INSERT INTO public.usuarios (auth_id, email, nome, tipo, papeis, senha_hash)
  SELECT
    keep_auth,
    keep_email,
    COALESCE(
      NULLIF(trim(au.raw_user_meta_data->>'nome'), ''),
      NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
      'Admin'
    ),
    'admin',
    ARRAY['admin']::text[],
    'supabase-auth'
  FROM auth.users au
  WHERE au.id = keep_auth
  ON CONFLICT (auth_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    tipo = 'admin',
    papeis = ARRAY['admin']::text[];

  -- Zera pontos se a coluna existir
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='usuarios' AND column_name='pontos_saldo'
  ) THEN
    EXECUTE $u$
      UPDATE public.usuarios
      SET tipo = 'admin',
          papeis = ARRAY['admin']::text[],
          email = $1,
          pontos_saldo = 0
      WHERE auth_id = $2 OR lower(trim(email)) = $1
    $u$ USING keep_email, keep_auth;
  ELSE
    UPDATE public.usuarios
    SET tipo = 'admin',
        papeis = ARRAY['admin']::text[],
        email = keep_email
    WHERE auth_id = keep_auth OR lower(trim(email)) = keep_email;
  END IF;

  DELETE FROM auth.users
  WHERE id IS DISTINCT FROM keep_auth;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    DELETE FROM storage.objects o
    WHERE (storage.foldername(o.name))[1] IS DISTINCT FROM keep_auth::text;
  END IF;

  RAISE NOTICE 'OK limpeza lançamento. keep_auth=% keep_email=%', keep_auth, keep_email;
END $$;

SELECT 'auth.users' AS onde, count(*)::int AS qtd FROM auth.users
UNION ALL
SELECT 'usuarios', count(*)::int FROM public.usuarios
UNION ALL
SELECT 'lotes', count(*)::int FROM public.lotes
UNION ALL
SELECT 'chat_mensagens', count(*)::int FROM public.chat_mensagens
UNION ALL
SELECT 'caixa_saldos', count(*)::int FROM public.caixa_saldos;

SELECT id, email, tipo, papeis, auth_id
FROM public.usuarios
ORDER BY email;
