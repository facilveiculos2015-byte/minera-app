-- =====================================================================
-- MINERA PARÁ - 35 Admin promos + Minera Bank kill switch + privacy
-- Incremental. Idempotente. NÃO DROP de tabelas de negócio. NÃO wipe.
-- Rodar no Supabase SQL Editor APÓS 32/33/34.
-- Depende de public.is_admin() (SQL 17/32).
--
-- PRIVACY / RLS NOTES (auth.uid() JWT — inclusive admin-as-user):
-- * caixa_*, emprestimos, pix_pagamentos, suporte: own OR is_admin() (já em 17/32).
-- * chat_mensagens: participante (de/para) OR is_admin() — reafirmado abaixo.
-- * lotes: marketplace SELECT só não-ocultos (ou próprio / admin).
-- * app_promos: SELECT ativos; ALL admin.
-- * app_flags / app_bank_block_logs: SELECT autenticado (flags públicas de UX);
--   mutação somente is_admin().
-- * Nenhum policy usa e-mail/id de outro usuário hardcoded — sempre auth.uid().
-- =====================================================================

-- ---------------------------------------------------------------------
-- LOTES: coluna oculto (esconder irregular no marketplace)
-- ---------------------------------------------------------------------
ALTER TABLE public.lotes ADD COLUMN IF NOT EXISTS oculto boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lotes') THEN
    EXECUTE 'DROP POLICY IF EXISTS "lotes_select_marketplace" ON lotes';
    EXECUTE 'DROP POLICY IF EXISTS "lotes_select_auth" ON lotes';
    EXECUTE $p$
      CREATE POLICY "lotes_select_marketplace" ON lotes
        FOR SELECT TO authenticated
        USING (
          public.is_admin()
          OR criado_por_id = auth.uid()
          OR COALESCE(oculto, false) = false
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- CHAT: reafirma isolamento participante (não quebra se já aplicado em 18/32)
-- ---------------------------------------------------------------------
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
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- APP_PROMOS (banners & ofertas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_promos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('banner','oferta')),
  titulo text,
  texto text,
  imagem_url text,
  link text,
  ativo boolean NOT NULL DEFAULT true,
  ordem int NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_promos_ativo_ordem ON public.app_promos (ativo, ordem);

ALTER TABLE public.app_promos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_promos_select_ativos" ON public.app_promos;
DROP POLICY IF EXISTS "app_promos_select_auth_ativos" ON public.app_promos;
DROP POLICY IF EXISTS "app_promos_admin_all" ON public.app_promos;

CREATE POLICY "app_promos_select_ativos" ON public.app_promos
  FOR SELECT TO authenticated
  USING (ativo = true OR public.is_admin());

CREATE POLICY "app_promos_admin_all" ON public.app_promos
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.app_promos FROM anon;
GRANT SELECT ON TABLE public.app_promos TO authenticated;
GRANT ALL ON TABLE public.app_promos TO authenticated;

-- Seed 1 sample banner if empty (inactive by default — safe)
INSERT INTO public.app_promos (tipo, titulo, texto, imagem_url, link, ativo, ordem)
SELECT 'banner', 'Bem-vindo ao Minera Pará', 'Negocie lotes com segurança na região.', NULL, NULL, false, 0
WHERE NOT EXISTS (SELECT 1 FROM public.app_promos LIMIT 1);

-- ---------------------------------------------------------------------
-- APP_FLAGS (Minera Bank kill switch + motivo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_flags (
  key text PRIMARY KEY,
  value_bool boolean,
  value_text text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_flags_select_auth" ON public.app_flags;
DROP POLICY IF EXISTS "app_flags_admin_all" ON public.app_flags;

CREATE POLICY "app_flags_select_auth" ON public.app_flags
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "app_flags_admin_all" ON public.app_flags
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.app_flags FROM anon;
GRANT SELECT ON TABLE public.app_flags TO authenticated;
GRANT ALL ON TABLE public.app_flags TO authenticated;

INSERT INTO public.app_flags (key, value_bool, value_text)
VALUES ('minera_bank_enabled', true, NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_flags (key, value_bool, value_text)
VALUES ('minera_bank_block_motivo', NULL, NULL)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- APP_BANK_BLOCK_LOGS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_bank_block_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL,
  motivo text,
  by_auth_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_bank_block_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_bank_block_logs_select_admin" ON public.app_bank_block_logs;
DROP POLICY IF EXISTS "app_bank_block_logs_insert_admin" ON public.app_bank_block_logs;

CREATE POLICY "app_bank_block_logs_select_admin" ON public.app_bank_block_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "app_bank_block_logs_insert_admin" ON public.app_bank_block_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.app_bank_block_logs FROM anon;
GRANT SELECT, INSERT ON TABLE public.app_bank_block_logs TO authenticated;

-- Fim 35
