-- =====================================================================
-- MINERA PARÁ - 44a Chat: HOTFIX de segurança (subconjunto do SQL 44)
-- Incremental. Idempotente. NÃO wipe. Pode ser aplicado ANTES do 44
-- (o 44 recria exatamente os mesmos objetos; rodar 44 depois é seguro).
--
-- Contém SÓ:
--  (1)  SELECT de chat_mensagens correto (destinatário não vê 'agendada';
--       quem apagou "para mim" não vê mais; admin vê tudo).
--  (3b) Trigger de UPDATE chat_mensagens_lock_ids como SECURITY INVOKER
--       (hoje é DEFINER → o destinatário consegue reescrever mensagens
--       recebidas). Remetente: "apagar para todos" a qualquer hora; editar
--       texto só até 15 min. Destinatário: só se adicionar em apagada_para.
--       RPCs SECURITY DEFINER (apagar p/ mim/todos, histórico) e admin
--       continuam passando.
--  Colunas novas (nulas, sem efeito no app atual) exigidas pelo trigger:
--       chat_mensagens.editado_em, chat_mensagens.client_id.
--
-- Compatível com o app publicado (≤ 20260925b) e com 20260925c+.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) SELECT correto (participante; destinatário não vê 'agendada';
--    quem apagou "para mim" não vê mais). Admin continua vendo tudo.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_select_participant_or_admin" ON public.chat_mensagens;
CREATE POLICY "chat_select_participant_or_admin" ON public.chat_mensagens
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      (
        de_auth_id = (SELECT auth.uid())
        OR (
          para_auth_id = (SELECT auth.uid())
          AND COALESCE(status, 'enviada') IS DISTINCT FROM 'agendada'
        )
      )
      AND NOT ((SELECT auth.uid()) = ANY (COALESCE(apagada_para, '{}'::uuid[])))
    )
  );

-- ---------------------------------------------------------------------
-- Colunas referenciadas pelo trigger (o 44 adiciona o índice único)
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_mensagens ADD COLUMN IF NOT EXISTS client_id uuid;

-- ---------------------------------------------------------------------
-- 3b) Trigger de UPDATE corrigido (SECURITY INVOKER!)
-- ---------------------------------------------------------------------
ALTER TABLE public.chat_mensagens ADD COLUMN IF NOT EXISTS editado_em timestamptz;

CREATE OR REPLACE FUNCTION public.chat_mensagens_lock_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER            -- <<< antes era DEFINER (bug)
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_adm boolean;
BEGIN
  IF NEW.de_auth_id IS DISTINCT FROM OLD.de_auth_id THEN
    RAISE EXCEPTION 'chat: de_auth_id imutável';
  END IF;
  IF NEW.para_auth_id IS DISTINCT FROM OLD.para_auth_id THEN
    RAISE EXCEPTION 'chat: para_auth_id imutável';
  END IF;

  -- RPCs SECURITY DEFINER (owner postgres) e SQL Editor passam
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR uid IS NULL THEN
    RETURN NEW;
  END IF;

  is_adm := public.is_admin();
  IF is_adm THEN
    RETURN NEW;
  END IF;

  -- Campos que ninguém (cliente) altera
  IF NEW.criado_em IS DISTINCT FROM OLD.criado_em
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.de_nome IS DISTINCT FROM OLD.de_nome
     OR NEW.moderacao IS DISTINCT FROM OLD.moderacao THEN
    RAISE EXCEPTION 'chat: campo imutável';
  END IF;

  IF OLD.de_auth_id IS DISTINCT FROM uid THEN
    -- Não-remetente (destinatário): só pode se adicionar em apagada_para
    IF NEW.texto IS DISTINCT FROM OLD.texto
      OR NEW.tipo IS DISTINCT FROM OLD.tipo
      OR NEW.midia_url IS DISTINCT FROM OLD.midia_url
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.agendado_para IS DISTINCT FROM OLD.agendado_para
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.resposta_a_id IS DISTINCT FROM OLD.resposta_a_id
      OR NEW.editado_em IS DISTINCT FROM OLD.editado_em
    THEN
      RAISE EXCEPTION 'chat: destinatário só pode ocultar (apagada_para)';
    END IF;
    IF NOT (uid = ANY (COALESCE(NEW.apagada_para, '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'chat: apagada_para deve incluir o próprio usuário';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(COALESCE(OLD.apagada_para, '{}'::uuid[])) AS x(u)
       WHERE NOT (x.u = ANY (COALESCE(NEW.apagada_para, '{}'::uuid[])))
    ) OR EXISTS (
      SELECT 1 FROM unnest(COALESCE(NEW.apagada_para, '{}'::uuid[])) AS y(u)
       WHERE y.u <> uid AND NOT (y.u = ANY (COALESCE(OLD.apagada_para, '{}'::uuid[])))
    ) THEN
      RAISE EXCEPTION 'chat: só pode adicionar a si mesmo em apagada_para';
    END IF;
    RETURN NEW;
  END IF;

  -- Remetente
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'chat: não restaure mensagem apagada';
  END IF;
  IF NEW.texto IS DISTINCT FROM OLD.texto AND NEW.deleted_at IS NULL THEN
    IF COALESCE(OLD.status, 'enviada') <> 'agendada' THEN
      IF COALESCE(OLD.tipo, 'text') NOT IN ('text', 'agendada') THEN
        RAISE EXCEPTION 'chat: só mensagens de texto podem ser editadas';
      END IF;
      IF OLD.criado_em < now() - interval '15 minutes' THEN
        RAISE EXCEPTION 'chat: prazo de edição (15 min) expirou';
      END IF;
    END IF;
    NEW.editado_em := now();
  END IF;
  IF NEW.midia_url IS DISTINCT FROM OLD.midia_url AND NEW.midia_url IS NOT NULL THEN
    RAISE EXCEPTION 'chat: mídia não pode ser trocada';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mensagens_lock_ids ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_lock_ids
  BEFORE UPDATE ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_lock_ids();

