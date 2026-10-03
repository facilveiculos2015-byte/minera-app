-- =====================================================================
-- MINERA PARA - 55 Chat: GRUPOS (conversa com 3 ou mais pessoas)
--  - chat_grupos (nome) + chat_grupo_membros (quem participa; saiu_em = saiu)
--  - chat_mensagens.grupo_id: mensagem de grupo (para_auth_id fica NULL)
--  - RLS: so MEMBRO ATIVO le e escreve mensagens do grupo; cada membro ve as
--    mensagens a partir de quando entrou. Nao-membro nao ve nada.
--  - Qualquer membro adiciona pessoas, renomeia e pode sair.
--  - RPCs: chat_grupo_criar, chat_grupo_adicionar, chat_grupo_sair,
--    chat_grupo_renomear, chat_grupo_membros_listar, chat_grupo_pagina,
--    chat_grupo_marcar_lido, chat_grupos_inbox
--  - Realtime: chat_mensagens ja esta na publicacao (SQL 44); o app assina
--    grupo_id=in.(...) e o RLS filtra. Canal conv:<grupo> (SQL 44/49) passa
--    a valer com chat_eh_membro.
--  - Push (SQL 54 + send-push): manda para todos os membros menos quem enviou.
--  Idempotente. Sem barras invertidas.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.chat_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_grupos_nome_ok CHECK (char_length(btrim(nome)) BETWEEN 1 AND 60)
);

CREATE TABLE IF NOT EXISTS public.chat_grupo_membros (
  grupo_id uuid NOT NULL REFERENCES public.chat_grupos(id) ON DELETE CASCADE,
  auth_id uuid NOT NULL,
  adicionado_por uuid,
  entrou_em timestamptz NOT NULL DEFAULT now(),
  saiu_em timestamptz,
  ultima_lida_id int NOT NULL DEFAULT 0,
  PRIMARY KEY (grupo_id, auth_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_grupo_membros_auth ON public.chat_grupo_membros (auth_id) WHERE saiu_em IS NULL;

ALTER TABLE public.chat_mensagens ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES public.chat_grupos(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_grupo_id ON public.chat_mensagens (grupo_id, id DESC) WHERE grupo_id IS NOT NULL;

-- Mensagem e de grupo OU de DM, nunca as duas coisas
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_msg_grupo_ou_dm') THEN
    ALTER TABLE public.chat_mensagens ADD CONSTRAINT chat_msg_grupo_ou_dm CHECK (grupo_id IS NULL OR para_auth_id IS NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Funcoes de apoio (SECURITY DEFINER: usadas dentro das politicas)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_eh_membro(p_grupo uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_grupo_membros
                  WHERE grupo_id = p_grupo AND auth_id = p_uid AND saiu_em IS NULL);
$$;
REVOKE ALL ON FUNCTION public.chat_eh_membro(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_eh_membro(uuid, uuid) TO authenticated;

-- Membro ativo e a mensagem e de depois que ele entrou
CREATE OR REPLACE FUNCTION public.chat_grupo_ve_msg(p_grupo uuid, p_criado timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_grupo_membros
                  WHERE grupo_id = p_grupo AND auth_id = auth.uid() AND saiu_em IS NULL
                    AND p_criado >= entrou_em);
$$;
REVOKE ALL ON FUNCTION public.chat_grupo_ve_msg(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_grupo_ve_msg(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_grupo_membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_grupos_sel ON public.chat_grupos;
CREATE POLICY chat_grupos_sel ON public.chat_grupos FOR SELECT TO authenticated
  USING (public.chat_eh_membro(id, auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS chat_grupo_membros_sel ON public.chat_grupo_membros;
CREATE POLICY chat_grupo_membros_sel ON public.chat_grupo_membros FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.chat_eh_membro(grupo_id, auth.uid()) OR public.is_admin());

-- escrita nas duas tabelas: so pelas RPCs abaixo
REVOKE ALL ON TABLE public.chat_grupos FROM anon;
REVOKE ALL ON TABLE public.chat_grupo_membros FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.chat_grupos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.chat_grupo_membros FROM authenticated;
GRANT SELECT ON TABLE public.chat_grupos TO authenticated;
GRANT SELECT ON TABLE public.chat_grupo_membros TO authenticated;

-- Mensagens de grupo: ler (membro ativo, desde que entrou) e enviar (membro ativo)
DROP POLICY IF EXISTS chat_select_grupo ON public.chat_mensagens;
CREATE POLICY chat_select_grupo ON public.chat_mensagens FOR SELECT TO authenticated
  USING (
    grupo_id IS NOT NULL
    AND public.chat_grupo_ve_msg(grupo_id, criado_em)
    AND NOT ((SELECT auth.uid()) = ANY (COALESCE(apagada_para, '{}'::uuid[])))
    AND (de_auth_id = (SELECT auth.uid()) OR COALESCE(status, 'enviada') <> 'agendada')
  );

DROP POLICY IF EXISTS chat_insert_grupo ON public.chat_mensagens;
CREATE POLICY chat_insert_grupo ON public.chat_mensagens FOR INSERT TO authenticated
  WITH CHECK (
    de_auth_id = (SELECT auth.uid())
    AND grupo_id IS NOT NULL
    AND para_auth_id IS NULL
    AND public.chat_eh_membro(grupo_id, (SELECT auth.uid()))
  );

-- grupo_id nunca muda depois de enviada
CREATE OR REPLACE FUNCTION public.chat_mensagens_grupo_fixo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.grupo_id IS DISTINCT FROM OLD.grupo_id THEN
    RAISE EXCEPTION 'chat: grupo_id imutavel';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chat_mensagens_grupo_fixo ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_grupo_fixo BEFORE UPDATE OF grupo_id ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_grupo_fixo();

-- "Apagar para mim" tambem para membro de grupo
CREATE OR REPLACE FUNCTION public.chat_apagar_para_mim(p_msg_id int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m chat_mensagens%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  SELECT * INTO m FROM chat_mensagens WHERE id = p_msg_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'mensagem não encontrada'; END IF;
  IF m.de_auth_id IS DISTINCT FROM uid AND m.para_auth_id IS DISTINCT FROM uid
     AND NOT (m.grupo_id IS NOT NULL AND public.chat_eh_membro(m.grupo_id, uid)) THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;
  UPDATE chat_mensagens
  SET apagada_para = CASE
    WHEN uid = ANY (COALESCE(apagada_para, '{}'::uuid[])) THEN apagada_para
    ELSE array_append(COALESCE(apagada_para, '{}'::uuid[]), uid)
  END
  WHERE id = p_msg_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_apagar_para_mim(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_apagar_para_mim(int) TO authenticated;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_grupo_nome_de(p_uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(NULLIF(btrim(u.apelido), ''), NULLIF(btrim(u.nome), ''))
       FROM public.usuarios u WHERE u.auth_id = p_uid LIMIT 1), 'Usuário');
$$;
REVOKE ALL ON FUNCTION public.chat_grupo_nome_de(uuid) FROM PUBLIC;

-- aviso dentro do grupo ("Ana adicionou Joao"); tipo sistema nao gera push
CREATE OR REPLACE FUNCTION public.chat_grupo_aviso(p_grupo uuid, p_texto text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.chat_mensagens (de_auth_id, de_nome, texto, tipo, grupo_id, status)
  VALUES (auth.uid(), public.chat_grupo_nome_de(auth.uid()), left(p_texto, 400), 'sistema', p_grupo, 'enviada');
$$;
REVOKE ALL ON FUNCTION public.chat_grupo_aviso(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.chat_grupo_criar(p_nome text, p_membros uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  g uuid;
  outros uuid[];
  v_nome text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  SELECT array_agg(DISTINCT x) INTO outros
    FROM unnest(COALESCE(p_membros, '{}'::uuid[])) AS x
   WHERE x IS NOT NULL AND x <> uid
     AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_id = x);
  IF outros IS NULL OR array_length(outros, 1) < 1 THEN
    RAISE EXCEPTION 'escolha pelo menos 1 pessoa para o grupo';
  END IF;
  IF array_length(outros, 1) > 99 THEN RAISE EXCEPTION 'grupo com no máximo 100 pessoas'; END IF;
  IF to_regprocedure('public.chat_ha_bloqueio(uuid,uuid)') IS NOT NULL THEN
    SELECT array_agg(x) INTO outros FROM unnest(outros) AS x WHERE NOT public.chat_ha_bloqueio(uid, x);
    IF outros IS NULL THEN RAISE EXCEPTION 'não é possível criar grupo com usuário bloqueado'; END IF;
  END IF;
  v_nome := left(COALESCE(NULLIF(btrim(p_nome), ''), 'Grupo'), 60);
  INSERT INTO public.chat_grupos (nome, criado_por) VALUES (v_nome, uid) RETURNING id INTO g;
  INSERT INTO public.chat_grupo_membros (grupo_id, auth_id, adicionado_por) VALUES (g, uid, uid);
  INSERT INTO public.chat_grupo_membros (grupo_id, auth_id, adicionado_por)
  SELECT g, x, uid FROM unnest(outros) AS x;
  PERFORM public.chat_grupo_aviso(g, public.chat_grupo_nome_de(uid) || ' criou o grupo "' || v_nome || '"');
  RETURN g;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_grupo_adicionar(p_grupo uuid, p_membros uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  novos uuid[];
  n int;
  nomes text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.chat_eh_membro(p_grupo, uid) THEN RAISE EXCEPTION 'você não participa deste grupo'; END IF;
  SELECT array_agg(DISTINCT x) INTO novos
    FROM unnest(COALESCE(p_membros, '{}'::uuid[])) AS x
   WHERE x IS NOT NULL AND x <> uid
     AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_id = x)
     AND NOT public.chat_eh_membro(p_grupo, x);
  IF novos IS NULL THEN RETURN 0; END IF;
  IF to_regprocedure('public.chat_ha_bloqueio(uuid,uuid)') IS NOT NULL THEN
    SELECT array_agg(x) INTO novos FROM unnest(novos) AS x WHERE NOT public.chat_ha_bloqueio(uid, x);
    IF novos IS NULL THEN RETURN 0; END IF;
  END IF;
  IF (SELECT count(*) FROM public.chat_grupo_membros WHERE grupo_id = p_grupo AND saiu_em IS NULL) + array_length(novos, 1) > 100 THEN
    RAISE EXCEPTION 'grupo com no máximo 100 pessoas';
  END IF;
  INSERT INTO public.chat_grupo_membros AS gm (grupo_id, auth_id, adicionado_por)
  SELECT p_grupo, x, uid FROM unnest(novos) AS x
  ON CONFLICT (grupo_id, auth_id) DO UPDATE
     SET saiu_em = NULL, entrou_em = now(), adicionado_por = EXCLUDED.adicionado_por, ultima_lida_id = 0;
  n := array_length(novos, 1);
  SELECT string_agg(public.chat_grupo_nome_de(x), ', ') INTO nomes FROM unnest(novos) AS x;
  UPDATE public.chat_grupos SET atualizado_em = now() WHERE id = p_grupo;
  PERFORM public.chat_grupo_aviso(p_grupo, public.chat_grupo_nome_de(uid) || ' adicionou ' || nomes);
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_grupo_sair(p_grupo uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.chat_eh_membro(p_grupo, uid) THEN RETURN; END IF;
  PERFORM public.chat_grupo_aviso(p_grupo, public.chat_grupo_nome_de(uid) || ' saiu do grupo');
  UPDATE public.chat_grupo_membros SET saiu_em = now() WHERE grupo_id = p_grupo AND auth_id = uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_grupo_renomear(p_grupo uuid, p_nome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_nome text := left(btrim(COALESCE(p_nome, '')), 60);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.chat_eh_membro(p_grupo, uid) THEN RAISE EXCEPTION 'você não participa deste grupo'; END IF;
  IF v_nome = '' THEN RAISE EXCEPTION 'nome vazio'; END IF;
  UPDATE public.chat_grupos SET nome = v_nome, atualizado_em = now() WHERE id = p_grupo;
  PERFORM public.chat_grupo_aviso(p_grupo, public.chat_grupo_nome_de(uid) || ' mudou o nome do grupo para "' || v_nome || '"');
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_grupo_membros_listar(p_grupo uuid)
RETURNS TABLE (auth_id uuid, nome text, apelido text, papeis text[], tipo text, adicionado_por uuid, entrou_em timestamptz, ultima_lida_id int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.auth_id,
         COALESCE(NULLIF(btrim(u.nome), ''), 'Usuário'),
         NULLIF(btrim(u.apelido), ''),
         COALESCE(u.papeis, '{}'::text[]),
         COALESCE(u.tipo, ''),
         m.adicionado_por, m.entrou_em, m.ultima_lida_id
    FROM public.chat_grupo_membros m
    LEFT JOIN public.usuarios u ON u.auth_id = m.auth_id
   WHERE m.grupo_id = p_grupo AND m.saiu_em IS NULL
     AND public.chat_eh_membro(p_grupo, auth.uid())
   ORDER BY m.entrou_em, m.auth_id;
$$;

CREATE OR REPLACE FUNCTION public.chat_grupo_pagina(p_grupo uuid, p_antes_id int DEFAULT NULL, p_limit int DEFAULT 40)
RETURNS SETOF public.chat_mensagens
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.*
    FROM public.chat_mensagens m
   WHERE m.grupo_id = p_grupo
     AND (p_antes_id IS NULL OR m.id < p_antes_id)
     AND NOT (COALESCE(m.moderacao, '') = 'removida' AND m.deleted_at IS NULL)
   ORDER BY m.id DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 40), 200));
$$;

CREATE OR REPLACE FUNCTION public.chat_grupo_marcar_lido(p_grupo uuid, p_ate_id int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.chat_grupo_membros
     SET ultima_lida_id = GREATEST(ultima_lida_id, COALESCE(p_ate_id, 0))
   WHERE grupo_id = p_grupo AND auth_id = auth.uid() AND saiu_em IS NULL
     AND ultima_lida_id < COALESCE(p_ate_id, 0);
$$;

CREATE OR REPLACE FUNCTION public.chat_grupos_inbox()
RETURNS TABLE (
  grupo_id uuid, nome text, membros int,
  last_id int, last_de_auth_id uuid, last_de_nome text, last_texto text, last_tipo text,
  last_criado_em timestamptz, last_deleted boolean, nao_lidas int, ultima_lida_id int, entrou_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  meus AS (
    SELECT gm.grupo_id, gm.ultima_lida_id, gm.entrou_em
      FROM public.chat_grupo_membros gm, me
     WHERE gm.auth_id = me.uid AND gm.saiu_em IS NULL
  ),
  vis AS (
    SELECT m.*
      FROM public.chat_mensagens m
      JOIN meus g ON g.grupo_id = m.grupo_id
     WHERE m.criado_em >= g.entrou_em
       AND NOT ((SELECT uid FROM me) = ANY (COALESCE(m.apagada_para, '{}'::uuid[])))
       AND (m.de_auth_id = (SELECT uid FROM me) OR COALESCE(m.status, 'enviada') <> 'agendada')
       AND NOT (COALESCE(m.moderacao, '') = 'removida' AND m.deleted_at IS NULL)
  ),
  ult AS (
    SELECT DISTINCT ON (v.grupo_id) v.grupo_id, v.id, v.de_auth_id, v.de_nome, v.texto, v.tipo, v.criado_em, v.deleted_at
      FROM vis v ORDER BY v.grupo_id, v.id DESC
  )
  SELECT g.grupo_id, gr.nome,
         (SELECT count(*)::int FROM public.chat_grupo_membros x WHERE x.grupo_id = g.grupo_id AND x.saiu_em IS NULL),
         l.id, l.de_auth_id, l.de_nome,
         CASE WHEN l.deleted_at IS NOT NULL THEN '' ELSE left(COALESCE(l.texto, ''), 140) END,
         l.tipo, l.criado_em, (l.deleted_at IS NOT NULL),
         (SELECT count(*)::int FROM vis v
           WHERE v.grupo_id = g.grupo_id AND v.de_auth_id <> (SELECT uid FROM me)
             AND v.deleted_at IS NULL AND COALESCE(v.tipo, '') <> 'sistema'
             AND v.id > g.ultima_lida_id),
         g.ultima_lida_id, g.entrou_em
    FROM meus g
    JOIN public.chat_grupos gr ON gr.id = g.grupo_id
    LEFT JOIN ult l ON l.grupo_id = g.grupo_id
   ORDER BY COALESCE(l.id, 0) DESC;
$$;

REVOKE ALL ON FUNCTION public.chat_grupo_aviso(uuid, text) FROM authenticated;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.chat_grupo_criar(text, uuid[])',
    'public.chat_grupo_adicionar(uuid, uuid[])',
    'public.chat_grupo_sair(uuid)',
    'public.chat_grupo_renomear(uuid, text)',
    'public.chat_grupo_membros_listar(uuid)',
    'public.chat_grupo_pagina(uuid, int, int)',
    'public.chat_grupo_marcar_lido(uuid, int)',
    'public.chat_grupos_inbox()'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verificacao: tabelas=2, rpcs=8, politicas=2 (+2 das tabelas novas)
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
     AND table_name IN ('chat_grupos', 'chat_grupo_membros')) AS tabelas,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('chat_grupo_criar', 'chat_grupo_adicionar', 'chat_grupo_sair',
      'chat_grupo_renomear', 'chat_grupo_membros_listar', 'chat_grupo_pagina', 'chat_grupo_marcar_lido', 'chat_grupos_inbox')) AS rpcs,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_mensagens'
     AND policyname IN ('chat_select_grupo', 'chat_insert_grupo')) AS politicas_msg,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('chat_grupos', 'chat_grupo_membros')) AS politicas_grupo;
