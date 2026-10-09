-- =====================================================================
-- MINERA PARÁ — 58 Segurança dos dados (RLS, gatilhos de proteção, permissões)
-- Transacional · idempotente · sem DROP de dados · pode rodar mais de uma vez.
-- Aplicar no SQL Editor (Run) DEPOIS do 56 e do 57-indicacao-bonus. Se der erro, nada é gravado.
-- Gatilhos de proteção são SECURITY INVOKER: valem para o app/API (roles anon/authenticated);
-- funções do servidor (SECURITY DEFINER, ex.: bônus de indicação, banner pago com saldo) passam.
--
-- O que faz:
--  1) Banco/Caixa: cliente não cria saldo com dinheiro nem pedido já "confirmado/pago".
--  2) Pontos de indicação: cliente só registra DÉBITO (uso de pontos); crédito é do servidor/admin.
--  3) Britagem/estoque/expedição/cotações: escrita só para admin (ou dono de britador onde o app usa).
--  4) Fretes: dono obrigatório (o próprio usuário).
--  5) Suporte: usuário não escreve "como admin" nem como outra pessoa.
--  6) Chat: mídia só pode apontar para a pasta do próprio usuário no Storage (bloqueia javascript: e links falsos).
--  7) Anúncios: fotos/vídeo só com https:// (bloqueia javascript:/data:).
--  8) Permissões: anon (sem login) perde acesso a tabelas e RPCs internas; ninguém faz TRUNCATE pela API.
--  9) avatares_publicos exige login.
-- =====================================================================
BEGIN;

-- ---------- helper: papel do usuário ----------
CREATE OR REPLACE FUNCTION public.tem_papel(p_papel text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.auth_id = auth.uid()
       AND p_papel = ANY (COALESCE(u.papeis, '{}'::text[]))
  );
$$;

-- ---------- 1) Caixa / Banco ----------
CREATE OR REPLACE FUNCTION public.caixa_guard_saldo_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;                        -- SQL Editor / service_role / funções do servidor / admin
  END IF;
  IF NEW.auth_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'caixa_saldos: só a própria conta' USING ERRCODE = '42501';
  END IF;
  NEW.saldo := 0;
  NEW.taxa_mensal := 5;
  NEW.taxa_yield_max := 5;
  NEW.last_yield_at := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_caixa_guard_saldo_insert ON public.caixa_saldos;
CREATE TRIGGER trg_caixa_guard_saldo_insert
  BEFORE INSERT ON public.caixa_saldos
  FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_saldo_insert();

CREATE OR REPLACE FUNCTION public.caixa_guard_saldo_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.saldo IS DISTINCT FROM OLD.saldo THEN
    RAISE EXCEPTION 'caixa_saldos: saldo só pode ser alterado pelo admin';
  END IF;
  IF NEW.taxa_mensal IS DISTINCT FROM OLD.taxa_mensal THEN
    RAISE EXCEPTION 'caixa_saldos: taxa_mensal só admin';
  END IF;
  NEW.auth_id := OLD.auth_id;
  NEW.taxa_yield_max := OLD.taxa_yield_max;
  NEW.last_yield_at := OLD.last_yield_at;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_caixa_guard_saldo_update ON public.caixa_saldos;
CREATE TRIGGER trg_caixa_guard_saldo_update
  BEFORE UPDATE ON public.caixa_saldos
  FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_saldo_update();

CREATE OR REPLACE FUNCTION public.caixa_guard_movimento_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  ok_tipos text[] := ARRAY['deposito_pendente','saque_pendente','info','ajuste_info'];
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;                        -- admin / funções do servidor (bônus, banner com saldo)
  END IF;
  IF NEW.auth_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'movimento: auth_id deve ser o próprio usuário';
  END IF;
  IF NOT (NEW.tipo = ANY (ok_tipos)) THEN
    RAISE EXCEPTION 'movimento: tipo % não permitido ao cliente', NEW.tipo;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_caixa_mov_insert_guard ON public.caixa_movimentos;
CREATE TRIGGER trg_caixa_mov_insert_guard
  BEFORE INSERT ON public.caixa_movimentos
  FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_movimento_insert();

CREATE OR REPLACE FUNCTION public.caixa_guard_pedido_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.auth_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'pedido: só em nome da própria conta' USING ERRCODE = '42501';
  END IF;
  IF NEW.valor IS NULL OR NEW.valor <= 0 THEN
    RAISE EXCEPTION 'pedido: valor inválido' USING ERRCODE = '22023';
  END IF;
  NEW.status := 'pendente';
  NEW.admin_auth_id := NULL;
  NEW.criado_em := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_caixa_dep_insert_guard ON public.caixa_deposito_pedidos;
CREATE TRIGGER trg_caixa_dep_insert_guard
  BEFORE INSERT ON public.caixa_deposito_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_pedido_insert();
DROP TRIGGER IF EXISTS trg_caixa_saque_insert_guard ON public.caixa_saque_pedidos;
CREATE TRIGGER trg_caixa_saque_insert_guard
  BEFORE INSERT ON public.caixa_saque_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_pedido_insert();

-- ---------- helper: troca as policies de escrita de uma tabela ----------
CREATE OR REPLACE FUNCTION public.seg_drop_write_policies(p_tabela text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = p_tabela
              AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, p_tabela);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.seg_drop_write_policies(text) FROM PUBLIC, anon, authenticated;

-- ---------- 2) Pontos de indicação ----------
SELECT public.seg_drop_write_policies('indicacao_pontos');
CREATE POLICY indicacao_pontos_insert_debito_ou_admin ON public.indicacao_pontos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR (auth_id = auth.uid() AND COALESCE(pontos, 0) <= 0));
CREATE POLICY indicacao_pontos_update_admin ON public.indicacao_pontos
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- 3) Britagem / estoque / expedição / cotações ----------
SELECT public.seg_drop_write_policies('processamento');
CREATE POLICY proc_insert_britador_ou_admin ON public.processamento
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.tem_papel('dono_britador'));
CREATE POLICY proc_update_admin ON public.processamento
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

SELECT public.seg_drop_write_policies('estoque');
CREATE POLICY estoque_insert_britador_ou_admin ON public.estoque
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.tem_papel('dono_britador'));
CREATE POLICY estoque_update_admin ON public.estoque
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

SELECT public.seg_drop_write_policies('expedicao');
CREATE POLICY expedicao_insert_britador_ou_admin ON public.expedicao
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.tem_papel('dono_britador'));
CREATE POLICY expedicao_update_admin ON public.expedicao
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

SELECT public.seg_drop_write_policies('britagem_config');
CREATE POLICY britagem_config_insert_admin ON public.britagem_config
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY britagem_config_update_admin ON public.britagem_config
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

SELECT public.seg_drop_write_policies('cotacoes_historico');
CREATE POLICY cotacoes_historico_insert_admin ON public.cotacoes_historico
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- ---------- 4) Fretes: dono obrigatório ----------
DROP POLICY IF EXISTS fretes_insert_own ON public.fretes;
DROP POLICY IF EXISTS fretes_insert_auth ON public.fretes;
CREATE POLICY fretes_insert_own ON public.fretes
  FOR INSERT TO authenticated
  WITH CHECK (criado_por_id = auth.uid() OR public.is_admin());

-- ---------- 5) Suporte: sem se passar por admin/outro ----------
CREATE OR REPLACE FUNCTION public.suporte_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.de_auth_id IS NOT NULL AND NEW.de_auth_id IS DISTINCT FROM auth.uid() THEN
    NEW.de_auth_id := auth.uid();
  END IF;
  IF COALESCE(NEW.origem, 'user') NOT IN ('user', 'bot') THEN
    NEW.origem := 'user';
  END IF;
  IF NEW.origem = 'user' THEN
    NEW.de_auth_id := auth.uid();
  END IF;
  NEW.thread_auth_id := auth.uid();
  NEW.lido_admin := false;
  NEW.deleted_at := NULL;
  NEW.arquivado := false;
  NEW.atendido_em := NULL;
  NEW.criado_em := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_suporte_guard_insert ON public.suporte_mensagens;
CREATE TRIGGER trg_suporte_guard_insert
  BEFORE INSERT ON public.suporte_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.suporte_guard_insert();

-- ---------- 6) Chat: mídia só da pasta do próprio usuário ----------
CREATE OR REPLACE FUNCTION public.chat_mensagens_midia_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_base text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.midia_url IS NULL OR NEW.midia_url = '' THEN
    NEW.midia_url := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.midia_url IS NOT DISTINCT FROM OLD.midia_url THEN
    RETURN NEW;
  END IF;
  v_base := split_part(split_part(NEW.midia_url, '#', 1), '?', 1);
  IF v_base !~ ('^https://[a-z0-9-]+[.]supabase[.]co/storage/v1/object/public/chat-midia/' || auth.uid()::text || '/[A-Za-z0-9_./-]+$')
     OR position('..' in v_base) > 0 THEN
    RAISE EXCEPTION 'chat: mídia inválida' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_mensagens_midia_guard ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_midia_guard
  BEFORE INSERT OR UPDATE OF midia_url ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_midia_guard();

-- ---------- 7) Anúncios: mídia só https ----------
CREATE OR REPLACE FUNCTION public.lotes_midia_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  f jsonb;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.imagem_url IS DISTINCT FROM OLD.imagem_url)
     AND COALESCE(NEW.imagem_url, '') <> '' AND NEW.imagem_url !~* '^https://[^[:space:]"<>]+$' THEN
    RAISE EXCEPTION 'anúncio: foto inválida (use https)' USING ERRCODE = '22023';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.video_url IS DISTINCT FROM OLD.video_url)
     AND COALESCE(NEW.video_url, '') <> '' AND NEW.video_url !~* '^https://[^[:space:]"<>]+$' THEN
    RAISE EXCEPTION 'anúncio: vídeo inválido (use https)' USING ERRCODE = '22023';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.fotos IS DISTINCT FROM OLD.fotos)
     AND NEW.fotos IS NOT NULL AND jsonb_typeof(NEW.fotos) = 'array' THEN
    FOR f IN SELECT * FROM jsonb_array_elements(NEW.fotos) LOOP
      IF jsonb_typeof(f) <> 'string' OR (f #>> '{}') !~* '^https://[^[:space:]"<>]+$' THEN
        RAISE EXCEPTION 'anúncio: foto inválida (use https)' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lotes_midia_guard ON public.lotes;
CREATE TRIGGER trg_lotes_midia_guard
  BEFORE INSERT OR UPDATE OF imagem_url, video_url, fotos ON public.lotes
  FOR EACH ROW EXECUTE FUNCTION public.lotes_midia_guard();

-- ---------- 8) Permissões ----------
-- Ninguém da API faz TRUNCATE/TRIGGER/REFERENCES (TRUNCATE ignora RLS)
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- Sem login: nenhuma tabela, exceto a vitrine de banners pagos ativos
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.banners_pagos TO anon;
-- RPCs: tira EXECUTE de PUBLIC/anon e devolve para authenticated/service_role SÓ onde já tinham
-- (preserva os REVOKEs explícitos de outros SQL, ex.: 57-indicacao-bonus)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_ok
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.auth_ok THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig); END IF;
    IF r.svc_ok THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig); END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.seg_drop_write_policies(text) FROM authenticated, service_role;
-- Sem login: só o necessário para cadastro, banners e depósito mínimo
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.nome_apelido_disponivel(text,text,uuid)', 'public.banners_pagos_ativos()',
                           'public.banner_preco()', 'public.caixa_deposito_minimo()']
  LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', to_regprocedure(f));
    END IF;
  END LOOP;
END $$;
-- Funções criadas no futuro também nascem fechadas para anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ---------- 9) avatares_publicos só com login ----------
CREATE OR REPLACE FUNCTION public.avatares_publicos(p_ids uuid[])
RETURNS TABLE(auth_id uuid, avatar_url text, avatar_tipo text, avatar_atualizado_em timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.auth_id, u.avatar_url, u.avatar_tipo, u.avatar_atualizado_em
    FROM public.usuarios u
   WHERE auth.uid() IS NOT NULL
     AND u.auth_id = ANY (p_ids[1:300])
     AND u.auth_id IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.avatares_publicos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avatares_publicos(uuid[]) TO authenticated;

COMMIT;

-- Conferir (opcional):
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename IN ('indicacao_pontos','processamento','estoque','expedicao','britagem_config','cotacoes_historico','fretes') ORDER BY 1,3;
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_%guard%' OR tgname LIKE 'trg_%midia%';
