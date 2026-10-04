-- =====================================================================
-- MINERA APP — 56 Chat: contatos de fora LIBERADOS / TRANCADOS (flag do admin)
-- Incremental · idempotente · sem DROP de dados.
--
-- Usa a tabela public.app_flags (SQL 35): SELECT para autenticados,
-- escrita só para admin (policy app_flags_admin_all → public.is_admin()).
--
--   chave: chat_contatos_liberados
--     true  (ou sem linha) = LIBERADO  → telefone/WhatsApp/e-mail/links podem ir no chat
--     false                = TRANCADO  → app bloqueia o envio e mascara; o gatilho abaixo
--                                        também barra no banco (quem tentar pela API)
--
-- O admin muda no app: Admin → Chat → "Contatos de fora no chat".
-- Aplicar no SQL Editor de cada projeto (teste ldzefbwdghqiudafqjar: aplicado; produção eelbuaxgfzvxosatwcxk: aplicar).
-- =====================================================================

-- 1) Flag (padrão do lançamento: LIBERADO)
INSERT INTO public.app_flags (key, value_bool, value_text)
VALUES ('chat_contatos_liberados', true, NULL)
ON CONFLICT (key) DO NOTHING;

-- 2) Barreira no banco quando TRANCADO (só mensagens de texto; admin e SQL Editor passam)
CREATE OR REPLACE FUNCTION public.chat_mensagens_contatos_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lib boolean;
  t text;
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  SELECT f.value_bool INTO v_lib FROM public.app_flags f WHERE f.key = 'chat_contatos_liberados';
  IF COALESCE(v_lib, true) THEN
    RETURN NEW;                                   -- liberado (padrão)
  END IF;
  IF COALESCE(NEW.tipo, 'text') NOT IN ('text', 'agendada') THEN
    RETURN NEW;                                   -- mídia/documento: texto é legenda/nome de arquivo
  END IF;
  t := lower(COALESCE(NEW.texto, ''));
  IF t ~ '(wa\.me|whatsapp\.com|t\.me/|telegram\.me|instagram\.com|facebook\.com|https?://)'
     OR t ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
     OR t ~ '(\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}'
     OR t ~ '\d{8,13}' THEN
    RAISE EXCEPTION 'Contatos de fora estão trancados no chat. Negocie por aqui mesmo.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mensagens_contatos_flag ON public.chat_mensagens;
CREATE TRIGGER trg_chat_mensagens_contatos_flag
  BEFORE INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_mensagens_contatos_flag();

-- Conferir:
-- SELECT key, value_bool, updated_at FROM public.app_flags WHERE key = 'chat_contatos_liberados';
