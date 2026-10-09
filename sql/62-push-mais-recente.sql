-- =====================================================================
-- MINERA PARA - 62 Push: principal = inscricao MAIS RECENTE do aparelho
--  Falha do teste real (09/10/2026 00:5x, build 20261009d, SQL 61):
--  iPhone da 'Le' so com o Minera Para na Tela de Inicio; inscricoes:
--  app (aberto 00:48) e chat (00:27, icone do Chat Minera ja apagado).
--  O SQL 61 dava ao Chat Minera 3 dias de vantagem -> escolheu o chat;
--  a Apple ACEITA (201) push para app da Tela de Inicio apagado -> sem
--  erro, sem reserva, nenhum aviso.
--  Correcao: em cada aparelho a principal e ESTRITAMENTE a inscricao com
--  atualizado_em mais recente (o site regrava ao abrir/voltar, no max.
--  1x a cada 10 min por app); as outras so como reserva se der erro.
--  Requer o SQL 61. Nao muda tabela nem push_registrar nem send-push.
--  Transacional. Idempotente. ASCII. Desfazer: rodar de novo o sql/61.
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'aparelho') THEN
    RAISE EXCEPTION 'Rode antes o sql/61-push-por-aparelho.sql';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.chat_push_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_sec text;
  v_nome text;
  v_gnome text;
  v_dest uuid[];
  v_subs jsonb;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR coalesce(NEW.status, 'enviada') = 'agendada'
     OR coalesce(NEW.tipo, '') = 'sistema' OR coalesce(NEW.moderacao, '') = 'removida' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.status, 'enviada') <> 'agendada' THEN RETURN NEW; END IF;
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_fn_url' LIMIT 1;
    SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets WHERE name = 'push_hook_secret' LIMIT 1;
    IF v_url IS NULL OR v_sec IS NULL THEN RETURN NEW; END IF;

    IF NEW.grupo_id IS NOT NULL THEN
      SELECT array_agg(DISTINCT gm.auth_id) INTO v_dest
        FROM public.chat_grupo_membros gm
       WHERE gm.grupo_id = NEW.grupo_id AND gm.saiu_em IS NULL;
      SELECT g.nome INTO v_gnome FROM public.chat_grupos g WHERE g.id = NEW.grupo_id;
    ELSIF NEW.para_auth_id IS NOT NULL THEN
      v_dest := ARRAY[NEW.para_auth_id];
    END IF;
    IF NEW.de_auth_id IS NOT NULL THEN v_dest := array_remove(v_dest, NEW.de_auth_id); END IF;
    IF v_dest IS NULL OR cardinality(v_dest) = 0 THEN RETURN NEW; END IF;

    -- POR APARELHO (SQL 61/62): g = pessoa+aparelho; r = 1 (principal), 2, 3 (reservas, so se a anterior der erro).
    -- SQL 62: principal = ESTRITAMENTE a inscricao gravada por ultimo (o app aberto por ultimo).
    -- O iPhone aceita (201) push para app da Tela de Inicio ja apagado, entao a preferencia
    -- pelo Chat Minera fazia o aviso sumir. Sem preferencia, sem janela de empate.
    WITH base AS (
      SELECT s.id, s.auth_id, s.endpoint, s.p256dh, s.auth, s.atualizado_em,
             coalesce(s.origem, 'app') AS o,
             CASE
               WHEN split_part(s.endpoint, '/', 3) = 'web.push.apple.com' AND coalesce(s.user_agent, '') <> ''
                 THEN 'ua:' || md5(s.auth_id::text || s.user_agent)
               WHEN s.aparelho IS NOT NULL THEN 'ap:' || md5(s.auth_id::text || s.aparelho)
               ELSE 'id:' || s.id::text
             END AS g
        FROM public.push_subscriptions s
       WHERE s.auth_id = ANY (v_dest)
         AND NOT (s.auth_id = ANY (coalesce(NEW.apagada_para, '{}'::uuid[])))
         AND s.endpoint ~ '^https://(fcm[.]googleapis[.]com|android[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/'
    ), ordem AS (
      SELECT b.*, row_number() OVER (
               PARTITION BY b.g
               ORDER BY b.atualizado_em DESC, b.id DESC  -- SQL62_estrito: so a mais recente, sem preferencia do Chat
             ) AS r
        FROM base b
    ), lista AS (
      SELECT o.* FROM ordem o WHERE o.r <= 3 ORDER BY o.g, o.r LIMIT 1000
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'endpoint', l.endpoint, 'p256dh', l.p256dh, 'auth', l.auth,
                                                  'o', l.o, 'g', left(md5(l.g), 12), 'r', l.r) ORDER BY l.g, l.r), '[]'::jsonb)
      INTO v_subs
      FROM lista l;
    IF jsonb_array_length(v_subs) = 0 THEN RETURN NEW; END IF;

    v_nome := nullif(btrim(coalesce(NEW.de_nome, '')), '');
    IF v_nome IS NULL OR position('@' IN v_nome) > 0 THEN
      SELECT coalesce(nullif(btrim(u.apelido), ''), nullif(btrim(u.nome), '')) INTO v_nome
        FROM public.usuarios u WHERE u.auth_id = NEW.de_auth_id LIMIT 1;
    END IF;
    IF v_nome IS NOT NULL AND position('@' IN v_nome) > 0 THEN v_nome := NULL; END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
      body := jsonb_build_object(
        'v', 2,
        'reserva', true,
        'id', NEW.id,
        'de', NEW.de_auth_id,
        'de_nome', v_nome,
        'grupo_id', NEW.grupo_id,
        'grupo_nome', v_gnome,
        'tipo', coalesce(NEW.tipo, 'text'),
        'texto', left(coalesce(NEW.texto, ''), 200),
        'subs', v_subs
      ),
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat_push_notificar: %', SQLERRM;  -- nunca bloqueia a mensagem
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM anon;
REVOKE ALL ON FUNCTION public.chat_push_notificar() FROM authenticated;

DROP TRIGGER IF EXISTS trg_chat_push_ins ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_ins AFTER INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();
DROP TRIGGER IF EXISTS trg_chat_push_upd ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_upd AFTER UPDATE OF status ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Conferir (esperado: gatilhos=2, gatilho_62_estrito=true, sem_preferencia_chat=true)
SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_chat_push_ins', 'trg_chat_push_upd')) AS gatilhos,
  (position('SQL62_estrito' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) > 0) AS gatilho_62_estrito,
  (position('3 days' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) = 0) AS sem_preferencia_chat;
