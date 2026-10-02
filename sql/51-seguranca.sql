-- =====================================================================
-- MINERA PARA - 51 Seguranca (auditoria 2026-10-02)
-- Incremental. Idempotente. NAO faz wipe. Rodar por ultimo (apos 50).
-- Sem barras invertidas neste arquivo (usa [.] onde seria ponto literal).
--
-- Corrige achados da auditoria (RLS / privilegios / storage):
--   A) Limpa linhas de teste deixadas pela auditoria.
--   B) usuarios: trigger BEFORE INSERT/UPDATE impede nao-admin de virar
--      admin (tipo / papeis) e de adulterar campos sensiveis
--      (pontos_saldo, bloqueio, auth_id, email, senha_hash, codigo e
--      indicado_por, data_criacao). Perfil normal continua funcionando.
--   C) processar_indicacao: credita pontos so 1 vez por indicado e no
--      maximo 100 pontos (antes: qualquer valor, quantas vezes quisesse).
--   D) pix_pagamentos / emprestimos / comissoes: nao-admin nao forja
--      status (confirmado / aprovado / pago).
--   E) Storage chat-midia: escrita so na pasta do proprio usuario
--      (primeiro segmento do caminho = auth.uid()). Remove QUALQUER policy
--      de escrita antiga do bucket (a producao tinha uma permissiva).
--   F) logs_sistema: SELECT so admin (ou as proprias linhas); INSERT so
--      com usuario_id proprio ou nulo; anon sem acesso.
--   G) Funcoes admin_*: sem EXECUTE para anon.
-- Bypass das travas: chamadas que nao sejam dos papeis da API
-- (anon / authenticated), ou seja SQL Editor, service_role e RPCs
-- SECURITY DEFINER (owner postgres). Admin (is_admin()) tambem passa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) LIMPEZA das linhas de teste da auditoria
-- ---------------------------------------------------------------------
DELETE FROM public.logs_sistema
 WHERE acao = 'x' AND usuario_id IS NULL AND detalhes IS NULL;
DELETE FROM public.pix_pagamentos WHERE usuario_nome = '__audit__';
DELETE FROM public.emprestimos    WHERE nome = '__audit__';

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_usuario_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT u.id FROM public.usuarios u WHERE u.auth_id = auth.uid() LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.meu_usuario_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meu_usuario_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.meu_usuario_id() TO authenticated;

-- Pode o proprio usuario tirar o bloqueio? So se o bloqueio for de
-- comissao e (comissao pausada OU sem comissao vencida) - mesma regra
-- do app (auth-guard.js verificarInadimplencia).
CREATE OR REPLACE FUNCTION public.seg_pode_autodesbloquear(p_auth uuid, p_motivo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_auth IS NOT NULL
     AND p_auth = auth.uid()
     AND coalesce(p_motivo, '') ~* '(comiss|atraso|inadimpl)'
     AND (
           NOT coalesce((SELECT f.value_bool FROM public.app_flags f
                          WHERE f.key = 'comissao_1pct_ativa'), false)
        OR NOT EXISTS (SELECT 1 FROM public.comissoes c
                        WHERE c.vendedor_auth_id = p_auth
                          AND (c.status = 'atrasado'
                               OR (c.status = 'pendente' AND c.vencimento < now())))
         );
$fn$;
REVOKE ALL ON FUNCTION public.seg_pode_autodesbloquear(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seg_pode_autodesbloquear(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.seg_pode_autodesbloquear(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- B) USUARIOS: trava de privilegio / campos sensiveis
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usuarios_guard_privilegios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER  -- INVOKER: current_user = chamador (DEFINER anularia a trava)
SET search_path = public
AS $fn$
DECLARE
  v_email text := nullif(trim(coalesce(auth.jwt() ->> 'email', '')), '');
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;                      -- SQL Editor / service_role / RPC DEFINER
  END IF;
  IF public.is_admin() THEN          -- avaliado no estado ATUAL (antes do UPDATE)
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.auth_id          := coalesce(auth.uid(), NEW.auth_id);
    NEW.tipo             := 'operador';
    NEW.papeis           := array_remove(coalesce(NEW.papeis, '{}'::text[]), 'admin');
    NEW.bloqueado        := false;
    NEW.bloqueado_motivo := NULL;
    NEW.bloqueado_em     := NULL;
    NEW.pontos_saldo     := 0;
    NEW.indicado_por     := NULL;   -- so via RPC processar_indicacao
    NEW.senha_hash       := 'supabase-auth';
    NEW.data_criacao     := now();
    IF NEW.codigo_indicacao IS NOT NULL
       AND NEW.codigo_indicacao !~ '^[A-Z0-9]{4,16}$' THEN
      NEW.codigo_indicacao := NULL;
    END IF;
    IF v_email IS NOT NULL THEN
      NEW.email := v_email;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE por nao-admin
  NEW.id           := OLD.id;
  NEW.auth_id      := OLD.auth_id;
  NEW.data_criacao := OLD.data_criacao;
  NEW.senha_hash   := OLD.senha_hash;
  NEW.indicado_por := OLD.indicado_por;
  NEW.tipo         := OLD.tipo;      -- app so manda tipo derivado de papeis
  NEW.papeis       := array_remove(coalesce(NEW.papeis, '{}'::text[]), 'admin');

  -- email: so pode sincronizar com o email do proprio login (JWT)
  IF NEW.email IS DISTINCT FROM OLD.email
     AND (v_email IS NULL OR lower(coalesce(NEW.email, '')) <> lower(v_email)) THEN
    NEW.email := OLD.email;
  END IF;

  -- pontos: so pode GASTAR (diminuir, nunca abaixo de 0)
  IF NEW.pontos_saldo IS DISTINCT FROM OLD.pontos_saldo
     AND (NEW.pontos_saldo IS NULL OR NEW.pontos_saldo < 0
          OR NEW.pontos_saldo > coalesce(OLD.pontos_saldo, 0)) THEN
    NEW.pontos_saldo := OLD.pontos_saldo;
  END IF;

  -- codigo de indicacao: so define uma vez (quando vazio)
  IF NEW.codigo_indicacao IS DISTINCT FROM OLD.codigo_indicacao
     AND (coalesce(OLD.codigo_indicacao, '') <> ''
          OR NEW.codigo_indicacao IS NULL
          OR NEW.codigo_indicacao !~ '^[A-Z0-9]{4,16}$') THEN
    NEW.codigo_indicacao := OLD.codigo_indicacao;
  END IF;

  -- bloqueio: pode se auto-bloquear; desbloquear so bloqueio de comissao quitada
  IF NEW.bloqueado IS DISTINCT FROM OLD.bloqueado
     OR NEW.bloqueado_motivo IS DISTINCT FROM OLD.bloqueado_motivo
     OR NEW.bloqueado_em IS DISTINCT FROM OLD.bloqueado_em THEN
    IF coalesce(NEW.bloqueado, false) AND NOT coalesce(OLD.bloqueado, false) THEN
      NULL;  -- auto-bloqueio por comissao em atraso (app)
    ELSIF NOT coalesce(NEW.bloqueado, false) AND coalesce(OLD.bloqueado, false)
          AND public.seg_pode_autodesbloquear(OLD.auth_id, OLD.bloqueado_motivo) THEN
      NULL;  -- auto-desbloqueio permitido
    ELSE
      NEW.bloqueado        := OLD.bloqueado;
      NEW.bloqueado_motivo := OLD.bloqueado_motivo;
      NEW.bloqueado_em     := OLD.bloqueado_em;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_usuarios_guard_privilegios ON public.usuarios;
CREATE TRIGGER trg_usuarios_guard_privilegios
  BEFORE INSERT OR UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_guard_privilegios();

-- ---------------------------------------------------------------------
-- C) processar_indicacao: 1 credito por indicado, max 100 pontos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.processar_indicacao(
  p_codigo text,
  p_pontos numeric DEFAULT 10,
  p_motivo text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_ref uuid;
  v_n integer;
  v_pts numeric;
BEGIN
  IF v_uid IS NULL OR p_codigo IS NULL OR length(trim(p_codigo)) = 0 THEN
    RETURN false;
  END IF;
  IF p_pontos IS NULL OR p_pontos <= 0 THEN
    RETURN false;
  END IF;
  v_pts := LEAST(p_pontos, 100);  -- SUPORTE_REF_PREMIO do app = 100

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
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN false;                    -- ja foi indicado antes: nao credita de novo
  END IF;

  UPDATE public.usuarios
     SET pontos_saldo = round((coalesce(pontos_saldo, 0) + v_pts)::numeric, 2)
   WHERE auth_id = v_ref;

  INSERT INTO public.indicacao_pontos (auth_id, pontos, motivo)
  VALUES (v_ref, v_pts,
          coalesce(left(p_motivo, 300), 'Indicacao (codigo ' || upper(trim(p_codigo)) || ')'));
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.processar_indicacao(text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.processar_indicacao(text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.processar_indicacao(text, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------
-- D) Status forjado por nao-admin
-- ---------------------------------------------------------------------
-- pix_pagamentos: cliente so cria "pendente"; so admin altera.
CREATE OR REPLACE FUNCTION public.pix_pag_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pendente';
    RETURN NEW;
  END IF;
  RETURN OLD;                        -- UPDATE de nao-admin: sem efeito
END;
$fn$;
DROP TRIGGER IF EXISTS trg_pix_pag_guard_status ON public.pix_pagamentos;
CREATE TRIGGER trg_pix_pag_guard_status
  BEFORE INSERT OR UPDATE ON public.pix_pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.pix_pag_guard_status();

-- emprestimos: pedido do cliente entra "analise"; so admin altera.
CREATE OR REPLACE FUNCTION public.emprestimos_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'analise';
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_emprestimos_guard_status ON public.emprestimos;
CREATE TRIGGER trg_emprestimos_guard_status
  BEFORE INSERT OR UPDATE ON public.emprestimos
  FOR EACH ROW EXECUTE FUNCTION public.emprestimos_guard_status();

-- comissoes: cliente cria "pendente" e so pode marcar pendente -> atrasado.
CREATE OR REPLACE FUNCTION public.comissoes_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_novo text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pendente';
    NEW.pix_pagamento_id := NULL;
    RETURN NEW;
  END IF;
  v_novo := NEW.status;
  NEW := OLD;
  IF OLD.status = 'pendente' AND v_novo = 'atrasado' THEN
    NEW.status := 'atrasado';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_comissoes_guard_status ON public.comissoes;
CREATE TRIGGER trg_comissoes_guard_status
  BEFORE INSERT OR UPDATE ON public.comissoes
  FOR EACH ROW EXECUTE FUNCTION public.comissoes_guard_status();

-- ---------------------------------------------------------------------
-- E) STORAGE chat-midia: escrita so em <auth.uid()>/...
--    App: chat-midia.js uid/pasta/arquivo, lotes.js uid/lotes/...,
--    admin.js uid/banners/... (todos com uid no 1o segmento).
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects ausente - pulando E';
    RETURN;
  END IF;
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%chat-midia%'
  LOOP
    RAISE NOTICE 'removendo policy de escrita chat-midia: %', r.policyname;
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;

  -- leitura publica (playback no chat) - recria caso estivesse numa policy ALL
  EXECUTE 'DROP POLICY IF EXISTS "chat_midia_public_select" ON storage.objects';
  EXECUTE 'CREATE POLICY "chat_midia_public_select" ON storage.objects
    FOR SELECT USING (bucket_id = ''chat-midia'')';

  EXECUTE 'CREATE POLICY "chat_midia_insert_own_folder" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = ''chat-midia''
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text)';
  EXECUTE 'CREATE POLICY "chat_midia_update_own_folder" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = ''chat-midia''
      AND auth.uid() IS NOT NULL
      AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = ''chat-midia''
      AND (storage.foldername(name))[1] = auth.uid()::text)';
  EXECUTE 'CREATE POLICY "chat_midia_delete_own_folder" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = ''chat-midia''
      AND auth.uid() IS NOT NULL
      AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()))';
END $do$;

-- ---------------------------------------------------------------------
-- F) LOGS_SISTEMA
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'logs_sistema'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.logs_sistema', r.policyname);
  END LOOP;
END $do$;

ALTER TABLE public.logs_sistema ENABLE ROW LEVEL SECURITY;

-- Admin le tudo; usuario comum le so as proprias linhas (tela Relatorios).
CREATE POLICY "logs_select_admin_ou_proprio" ON public.logs_sistema
  FOR SELECT TO authenticated
  USING (public.is_admin()
         OR (usuario_id IS NOT NULL AND usuario_id = public.meu_usuario_id()));

-- Insert como o app faz hoje (auth-guard.js registrarLog): usuario_id
-- proprio ou nulo; nunca em nome de outro usuario.
CREATE POLICY "logs_insert_proprio" ON public.logs_sistema
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id IS NULL
              OR usuario_id = public.meu_usuario_id()
              OR public.is_admin());

REVOKE ALL ON TABLE public.logs_sistema FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.logs_sistema FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.logs_sistema TO authenticated;

-- ---------------------------------------------------------------------
-- G) Funcoes admin_*: anon nunca executa (a checagem is_admin continua)
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND left(p.proname, 6) = 'admin_'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $do$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFICACAO FINAL (uma linha; esperado nos comentarios)
-- =====================================================================
SELECT
  -- true: trigger de usuarios ativo em INSERT e UPDATE
  EXISTS (SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid = 'public.usuarios'::regclass
             AND t.tgname = 'trg_usuarios_guard_privilegios'
             AND t.tgenabled <> 'D'
             AND (t.tgtype::int & 4) <> 0 AND (t.tgtype::int & 16) <> 0
        ) AS usuarios_guard_ok,
  -- 3: guards de status (pix, emprestimos, comissoes)
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('trg_pix_pag_guard_status', 'trg_emprestimos_guard_status',
                     'trg_comissoes_guard_status')
      AND tgenabled <> 'D') AS status_guards,
  -- true: processar_indicacao limitada (1x e max 100)
  (SELECT bool_and(prosrc ILIKE '%LEAST(p_pontos, 100)%' AND prosrc ILIKE '%ROW_COUNT%')
     FROM pg_proc WHERE proname = 'processar_indicacao'
      AND pronamespace = 'public'::regnamespace) AS indicacao_limitada,
  -- 3: policies chat-midia de escrita por pasta
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('chat_midia_insert_own_folder', 'chat_midia_update_own_folder',
                         'chat_midia_delete_own_folder')) AS chat_midia_policies_pasta,
  -- 0: policies de escrita em chat-midia SEM checar pasta
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%chat-midia%'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%foldername%'
  ) AS chat_midia_escrita_aberta,
  -- 0: policies de escrita no storage que nao filtram bucket_id
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) NOT ILIKE '%bucket_id%'
  ) AS storage_escrita_sem_bucket,
  -- 0: policies de SELECT em logs_sistema sem is_admin
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'logs_sistema'
      AND cmd IN ('SELECT', 'ALL')
      AND coalesce(qual, 'true') NOT ILIKE '%is_admin%') AS logs_select_aberto,
  -- false: anon le logs_sistema
  has_table_privilege('anon', 'public.logs_sistema', 'SELECT') AS logs_anon_select,
  -- 0: funcoes admin_* executaveis por anon
  (SELECT count(*) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND left(p.proname, 6) = 'admin_'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS admin_fn_anon,
  -- 0: linhas de teste da auditoria restantes
  (SELECT count(*) FROM public.logs_sistema
    WHERE acao = 'x' AND usuario_id IS NULL AND detalhes IS NULL)
  + (SELECT count(*) FROM public.pix_pagamentos WHERE usuario_nome = '__audit__')
  + (SELECT count(*) FROM public.emprestimos WHERE nome = '__audit__') AS audit_linhas_restantes;
