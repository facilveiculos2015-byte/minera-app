-- =====================================================================
-- MINERA PARA - 57 Push v2 (corrige "mensagem nao encontrada")
--  Problema (08/10/2026): o gatilho do SQL 54 mandava so o id da mensagem
--  e a Edge Function send-push tentava ler chat_mensagens pela API com a
--  chave de servico. Essa leitura voltava vazia em producao e a funcao
--  respondia {"ok":false,"erro":"mensagem nao encontrada"} -> nenhum push.
--  Correcao: o gatilho (SECURITY DEFINER, roda como dono do banco) ja
--  monta tudo aqui dentro - remetente, tipo, trecho, grupo e as inscricoes
--  dos destinatarios - e manda pronto para a funcao, que so criptografa e
--  entrega (send-push v2). A funcao nao precisa mais ler o banco.
--  - Falha no push NUNCA bloqueia a mensagem.
--  - Sem inscricao de destino: nem chama a funcao.
--  - URL e segredo continuam no Vault (push_fn_url / push_hook_secret).
--  Rodar DEPOIS de publicar a send-push v2 (ela aceita v1 e v2).
--  Idempotente. ASCII.
-- =====================================================================

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

    -- destinatarios: DM = para_auth_id; grupo = membros ativos (SQL 55)
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

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      INTO v_subs
      FROM public.push_subscriptions s
     WHERE s.auth_id = ANY (v_dest)
       AND NOT (s.auth_id = ANY (coalesce(NEW.apagada_para, '{}'::uuid[])));
    IF jsonb_array_length(v_subs) = 0 THEN RETURN NEW; END IF;

    -- nome de quem mandou (nunca e-mail)
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

-- gatilhos (mesmos do SQL 54; recriados para garantir)
DROP TRIGGER IF EXISTS trg_chat_push_ins ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_ins AFTER INSERT ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();
DROP TRIGGER IF EXISTS trg_chat_push_upd ON public.chat_mensagens;
CREATE TRIGGER trg_chat_push_upd AFTER UPDATE OF status ON public.chat_mensagens
  FOR EACH ROW EXECUTE FUNCTION public.chat_push_notificar();

SELECT
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_chat_push_ins', 'trg_chat_push_upd')) AS gatilhos,
  (SELECT count(*) FROM vault.secrets WHERE name IN ('push_fn_url', 'push_hook_secret')) AS segredos_no_vault,
  (position('''v'', 2' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) > 0) AS gatilho_v2;
