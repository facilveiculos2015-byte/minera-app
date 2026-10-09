-- =====================================================================
-- MINERA PARA - 63 DESFAZER: tira a ligacao de voz e volta ao estado do SQL 62
--  - apaga tabela public.chamadas (sai da publicacao supabase_realtime junto)
--  - apaga funcoes chamada_* / chamadas_ativas e o gatilho trg_chamada_push
--  - apaga as policies minera_chamada_rt_* de realtime.messages
--  - gatilho de push de mensagem volta EXATAMENTE ao do SQL 62
--    (AFTER INSERT, sem WHEN). A funcao chat_push_notificar NAO e tocada
--    (o SQL 63 nunca a alterou: regra 'SQL62_estrito' continua igual).
--  - linha app_flags 'chamadas_ativas' (se alguem criou) e removida
--  - os registros "Chamada de voz ..." ja gravados no chat FICAM (viram
--    texto comum nos apps antigos). Para apagar, ver o fim do arquivo.
--  Antes de rodar: promover o site SEM a ligacao (ou deixar: sem o SQL o
--  botao some sozinho, o app pergunta chamada_config()).
--  Transacional. Idempotente (pode rodar 2x). ASCII.
-- =====================================================================
BEGIN;

DROP TRIGGER IF EXISTS trg_chamada_push ON public.chamadas;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'realtime' AND table_name = 'messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS "minera_chamada_rt_select" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "minera_chamada_rt_insert" ON realtime.messages';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chamadas') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.chamadas';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.chamada_iniciar(uuid, text);
DROP FUNCTION IF EXISTS public.chamada_atender(uuid, text);
DROP FUNCTION IF EXISTS public.chamada_encerrar(uuid, text);
DROP FUNCTION IF EXISTS public.chamada_sdp(uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.chamada_ping(uuid);
DROP FUNCTION IF EXISTS public.chamada_pendente();
DROP FUNCTION IF EXISTS public.chamada_config();
DROP FUNCTION IF EXISTS public.chamada_rt_ok(text);
DROP FUNCTION IF EXISTS public.chamada_push_notificar();
DROP FUNCTION IF EXISTS public.chamada_expirar();
DROP FUNCTION IF EXISTS public.chamada_ocupado(uuid);
DROP FUNCTION IF EXISTS public.chamada_ocupado_exceto(uuid, uuid);
DROP FUNCTION IF EXISTS public.chamada_fechar(uuid, text, text, uuid);
DO $$ BEGIN
  IF to_regclass('public.chamadas') IS NOT NULL THEN
    EXECUTE 'DROP FUNCTION IF EXISTS public.chamada_registrar(public.chamadas)';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.chamada_nome(uuid);
DROP FUNCTION IF EXISTS public.chamadas_ativas();
DROP TABLE IF EXISTS public.chamadas CASCADE;

DO $$ BEGIN
  IF to_regclass('public.app_flags') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.app_flags WHERE key = ''chamadas_ativas''';
  END IF;
END $$;

-- gatilho de push de mensagem: identico ao do SQL 62 (sem WHEN)
DO $$ BEGIN
  IF to_regprocedure('public.chat_push_notificar()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_chat_push_ins ON public.chat_mensagens';
    EXECUTE 'CREATE TRIGGER trg_chat_push_ins AFTER INSERT ON public.chat_mensagens
      FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Conferir (esperado: tabela_chamadas=false, funcoes_chamada=0, policies_rt=0, gatilhos_push=2,
--           gatilho_ins_sem_when=true, gatilho_62_estrito=true)
SELECT
  (to_regclass('public.chamadas') IS NOT NULL) AS tabela_chamadas,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (p.proname LIKE 'chamada\_%' OR p.proname = 'chamadas_ativas')) AS funcoes_chamada,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND policyname LIKE 'minera_chamada_rt_%') AS policies_rt,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_chat_push_ins', 'trg_chat_push_upd')) AS gatilhos_push,
  (SELECT position('WHEN' IN pg_get_triggerdef(t.oid)) = 0 FROM pg_trigger t WHERE t.tgname = 'trg_chat_push_ins') AS gatilho_ins_sem_when,
  (position('SQL62_estrito' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) > 0) AS gatilho_62_estrito;

-- Opcional (apaga do chat os registros de ligacao):
--   DELETE FROM public.chat_mensagens WHERE tipo = 'chamada';
