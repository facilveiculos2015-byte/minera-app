-- =====================================================================
-- MINERA PARA - 63 Ligacao de voz 1:1 (WebRTC) no chat
--  Estado OFICIAL da ligacao fica no banco (tabela public.chamadas):
--    tocando -> atendida -> encerrada
--    tocando -> recusada | perdida (sem resposta 45 s / quem ligou desistiu) | ocupado
--  - So os 2 participantes leem a linha (RLS). Ninguem grava direto:
--    tudo passa por funcoes SECURITY DEFINER que conferem quem pode o que.
--  - Oferta/resposta WebRTC (SDP) so sao trocadas DEPOIS de atender
--    (quem so liga nao descobre o IP de quem nao atendeu) e sao APAGADAS
--    quando a ligacao termina.
--  - Candidatos ICE ao vivo: canal Realtime PRIVADO chamada:<id>; policy
--    em realtime.messages deixa entrar so os 2 participantes e so enquanto
--    a ligacao esta tocando/atendida.
--  - Aviso no celular (app fechado): gatilho -> Edge Function send-push
--    (tipo 'chamada'). Funciona com a send-push v3 atual (aviso comum
--    "Fulano: Ligacao de voz"); a versao nova (v4) mostra
--    "Fulano esta te ligando" e abre direto a tela de atender.
--  - Registro no chat (tipo 'chamada'): perdida / recusada / ocupado /
--    duracao. So 'perdida' gera push de mensagem.
--  - Limites: 15 ligacoes / 10 min por pessoa; 4 nao atendidas seguidas
--    para a mesma pessoa / 10 min; bloqueio do chat impede ligar.
--  - Interruptor sem desfazer nada: app_flags 'chamadas_ativas' = false
--    esconde o botao em todos os aparelhos (o app pergunta chamada_config())
--    e o banco recusa ligacoes novas. Sem a linha = ligado.
--  - NAO altera a funcao chat_push_notificar (regra 'SQL62_estrito' fica
--    intacta); so recria o gatilho de INSERT dela com uma condicao WHEN.
--  Requer: SQL 44 (realtime), 49 (bloqueio), 61/62 (push por aparelho).
--  Transacional. Idempotente. ASCII. Desfazer: sql/63-chamadas-desfazer.sql
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.chat_ha_bloqueio(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Rode antes o sql/49-chat-bloqueio-apagar.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name = 'aparelho') THEN
    RAISE EXCEPTION 'Rode antes o sql/61-push-por-aparelho.sql';
  END IF;
END $$;

-- ---------- 1) Tabela ----------
CREATE TABLE IF NOT EXISTS public.chamadas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de                uuid NOT NULL,
  para              uuid NOT NULL,
  de_nome           text,             -- nome publico de quem liga (tela de "esta te ligando"; nunca e-mail)
  estado            text NOT NULL DEFAULT 'tocando'
                    CHECK (estado IN ('tocando', 'atendida', 'recusada', 'perdida', 'ocupado', 'encerrada')),
  motivo            text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atendida_em       timestamptz,
  encerrada_em      timestamptz,
  encerrada_por     uuid,
  de_aparelho       text,
  para_aparelho     text,
  oferta            text,
  oferta_ver        int NOT NULL DEFAULT 0,
  resposta          text,
  resposta_ver      int NOT NULL DEFAULT 0,
  ping_de           timestamptz,
  ping_para         timestamptz,
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  CHECK (de <> para)
);
ALTER TABLE public.chamadas ADD COLUMN IF NOT EXISTS de_nome text;
CREATE INDEX IF NOT EXISTS idx_chamadas_de ON public.chamadas (de, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_chamadas_para ON public.chamadas (para, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_chamadas_ativas ON public.chamadas (estado) WHERE estado IN ('tocando', 'atendida');

ALTER TABLE public.chamadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamadas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chamadas_select_participante ON public.chamadas;
CREATE POLICY chamadas_select_participante ON public.chamadas
  FOR SELECT TO authenticated
  USING (auth.uid() = de OR auth.uid() = para);
-- nenhuma policy de INSERT/UPDATE/DELETE: so pelas funcoes abaixo
REVOKE ALL ON TABLE public.chamadas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chamadas TO authenticated;

-- ---------- 2) Registro no chat + fechamento ----------
CREATE OR REPLACE FUNCTION public.chamada_nome(p_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN n IS NULL OR position('@' IN n) > 0 THEN NULL ELSE n END
    FROM (SELECT coalesce(nullif(btrim(u.apelido), ''), nullif(btrim(u.nome), '')) AS n
            FROM public.usuarios u WHERE u.auth_id = p_uid LIMIT 1) x;
$$;
REVOKE ALL ON FUNCTION public.chamada_nome(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chamada_registrar(c public.chamadas)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txt text;
  v_seg int;
BEGIN
  -- texto do registro (U&: arquivo continua ASCII). 01F4DE = telefone, 00B7 = ponto medio
  IF c.estado = 'encerrada' AND c.atendida_em IS NOT NULL THEN
    v_seg := greatest(0, floor(extract(epoch FROM (c.encerrada_em - c.atendida_em)))::int);
    v_txt := U&'\+01F4DE Chamada de voz \00B7 ' || (v_seg / 60)::text || ':' || lpad((v_seg % 60)::text, 2, '0');
  ELSIF c.estado = 'recusada' THEN
    v_txt := U&'\+01F4DE Chamada de voz recusada';
  ELSIF c.estado = 'ocupado' THEN
    v_txt := U&'\+01F4DE Chamada de voz perdida (ocupado)';
  ELSE
    v_txt := U&'\+01F4DE Chamada de voz perdida';
  END IF;
  BEGIN
    INSERT INTO public.chat_mensagens (de_auth_id, de_nome, para_auth_id, texto, tipo, status)
    VALUES (c.de, public.chamada_nome(c.de), c.para, v_txt, 'chamada', 'enviada');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chamada_registrar: registro no chat falhou: %', SQLERRM;  -- nunca impede fechar a ligacao
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.chamada_registrar(public.chamadas) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chamada_fechar(p_id uuid, p_estado text, p_motivo text, p_por uuid)
RETURNS public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.chamadas;
BEGIN
  SELECT * INTO c FROM public.chamadas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.estado NOT IN ('tocando', 'atendida') THEN RETURN c; END IF;  -- ja fechada: idempotente
  UPDATE public.chamadas
     SET estado = p_estado, motivo = left(p_motivo, 40), encerrada_em = now(), encerrada_por = p_por,
         oferta = NULL, resposta = NULL, atualizado_em = now()   -- SDP (IPs) apagado ao terminar
   WHERE id = p_id
   RETURNING * INTO c;
  PERFORM public.chamada_registrar(c);
  RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public.chamada_fechar(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Fecha ligacoes esquecidas (aparelho sem internet / app morto).
CREATE OR REPLACE FUNCTION public.chamada_expirar()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, estado FROM public.chamadas
            WHERE (estado = 'tocando' AND criado_em < now() - interval '50 seconds')
               OR (estado = 'atendida' AND greatest(coalesce(ping_de, atendida_em), coalesce(ping_para, atendida_em)) < now() - interval '90 seconds')
            ORDER BY criado_em LIMIT 50
            FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.chamada_fechar(r.id, CASE WHEN r.estado = 'tocando' THEN 'perdida' ELSE 'encerrada' END,
                                  CASE WHEN r.estado = 'tocando' THEN 'timeout' ELSE 'sem_sinal' END, NULL);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.chamada_expirar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chamada_ocupado(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.chamadas c
                  WHERE (c.de = p_uid OR c.para = p_uid)
                    AND ((c.estado = 'tocando' AND c.criado_em > now() - interval '50 seconds')
                      OR (c.estado = 'atendida' AND greatest(coalesce(c.ping_de, c.atendida_em), coalesce(c.ping_para, c.atendida_em)) > now() - interval '90 seconds')));
$$;
REVOKE ALL ON FUNCTION public.chamada_ocupado(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 3) Funcoes chamadas pelo app ----------
-- Interruptor (app_flags 'chamadas_ativas'; sem linha = ligado). plpgsql: nao quebra se app_flags nao existir.
CREATE OR REPLACE FUNCTION public.chamadas_ativas()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v boolean;
BEGIN
  SELECT f.value_bool INTO v FROM public.app_flags f WHERE f.key = 'chamadas_ativas';
  RETURN coalesce(v, true);
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.chamadas_ativas() FROM PUBLIC, anon, authenticated;

-- O app so mostra o botao se esta funcao existir E responder ativo=true.
CREATE OR REPLACE FUNCTION public.chamada_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ativo', false, 'v', 1); END IF;
  RETURN jsonb_build_object('ativo', public.chamadas_ativas(), 'v', 1, 'toque_s', 45);
END;
$$;

-- Ligar. Devolve a linha (estado 'tocando', ou 'ocupado' se a outra pessoa esta em ligacao).
-- Se a outra pessoa esta ME ligando agora (ligacao cruzada) devolve a ligacao DELA (para = eu).
CREATE OR REPLACE FUNCTION public.chamada_iniciar(p_para uuid, p_aparelho text DEFAULT NULL)
RETURNS public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_eu uuid := auth.uid();
  c public.chamadas;
BEGIN
  IF v_eu IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para ligar' USING ERRCODE = '42501'; END IF;
  IF NOT public.chamadas_ativas() THEN RAISE EXCEPTION 'Ligacoes desativadas no momento' USING ERRCODE = 'P0001'; END IF;
  IF p_para IS NULL OR p_para = v_eu THEN RAISE EXCEPTION 'Destino invalido' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_id = p_para) THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = '22023';
  END IF;
  IF public.chat_ha_bloqueio(v_eu, p_para) THEN
    RAISE EXCEPTION 'Nao e possivel ligar para este usuario' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chamada_expirar();
  IF (SELECT count(*) FROM public.chamadas WHERE de = v_eu AND criado_em > now() - interval '10 minutes') >= 15 THEN
    RAISE EXCEPTION 'Muitas ligacoes em pouco tempo. Espere alguns minutos.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.chamadas WHERE de = v_eu AND para = p_para AND estado IN ('perdida', 'recusada', 'ocupado')
         AND criado_em > now() - interval '10 minutes') >= 4 THEN
    RAISE EXCEPTION 'Muitas ligacoes sem resposta para esta pessoa. Tente mais tarde ou mande mensagem.' USING ERRCODE = 'P0001';
  END IF;
  -- ligacao cruzada: ela esta me ligando agora
  SELECT * INTO c FROM public.chamadas
   WHERE de = p_para AND para = v_eu AND estado = 'tocando' AND criado_em > now() - interval '45 seconds'
   ORDER BY criado_em DESC LIMIT 1;
  IF FOUND THEN RETURN c; END IF;
  IF public.chamada_ocupado(v_eu) THEN
    RAISE EXCEPTION 'Voce ja esta em uma ligacao' USING ERRCODE = 'P0001';
  END IF;
  IF public.chamada_ocupado(p_para) THEN
    -- a outra pessoa esta em ligacao: nao toca nem manda push; fica o registro "perdida (ocupado)"
    INSERT INTO public.chamadas (de, para, estado, motivo, de_aparelho, encerrada_em)
    VALUES (v_eu, p_para, 'ocupado', 'ocupado', left(p_aparelho, 64), now())
    RETURNING * INTO c;
    PERFORM public.chamada_registrar(c);
    RETURN c;
  END IF;
  INSERT INTO public.chamadas (de, para, de_nome, estado, de_aparelho, ping_de)
  VALUES (v_eu, p_para, public.chamada_nome(v_eu), 'tocando', left(p_aparelho, 64), now())
  RETURNING * INTO c;
  RETURN c;
END;
$$;


-- Atender (so quem recebe; o 1o aparelho que atender fica com a ligacao).
CREATE OR REPLACE FUNCTION public.chamada_atender(p_id uuid, p_aparelho text DEFAULT NULL)
RETURNS public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eu uuid := auth.uid(); c public.chamadas;
BEGIN
  SELECT * INTO c FROM public.chamadas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR c.para IS DISTINCT FROM v_eu THEN RAISE EXCEPTION 'Ligacao nao encontrada' USING ERRCODE = '42501'; END IF;
  IF c.estado <> 'tocando' THEN RETURN c; END IF;
  IF c.criado_em < now() - interval '50 seconds' THEN
    RETURN public.chamada_fechar(p_id, 'perdida', 'timeout', NULL);
  END IF;
  UPDATE public.chamadas
     SET estado = 'atendida', atendida_em = now(), para_aparelho = left(p_aparelho, 64),
         ping_para = now(), ping_de = now(), atualizado_em = now()
   WHERE id = p_id RETURNING * INTO c;
  RETURN c;
END;
$$;

-- Desligar / recusar / desistir / sem resposta. p_motivo: desligou | recusou | timeout | falhou | ocupado
CREATE OR REPLACE FUNCTION public.chamada_encerrar(p_id uuid, p_motivo text DEFAULT 'desligou')
RETURNS public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eu uuid := auth.uid(); c public.chamadas; v_estado text;
BEGIN
  SELECT * INTO c FROM public.chamadas WHERE id = p_id;
  IF NOT FOUND OR (c.de IS DISTINCT FROM v_eu AND c.para IS DISTINCT FROM v_eu) THEN
    RAISE EXCEPTION 'Ligacao nao encontrada' USING ERRCODE = '42501';
  END IF;
  IF c.estado NOT IN ('tocando', 'atendida') THEN RETURN c; END IF;
  p_motivo := coalesce(nullif(p_motivo, ''), 'desligou');
  IF p_motivo NOT IN ('desligou', 'recusou', 'timeout', 'falhou', 'ocupado') THEN p_motivo := 'desligou'; END IF;
  IF c.estado = 'atendida' THEN
    v_estado := 'encerrada';
  ELSIF v_eu = c.para THEN
    v_estado := CASE WHEN p_motivo = 'ocupado' THEN 'ocupado' ELSE 'recusada' END;
  ELSE
    v_estado := 'perdida';  -- quem ligou desistiu ou deu 45 s sem resposta
  END IF;
  RETURN public.chamada_fechar(p_id, v_estado, p_motivo, v_eu);
END;
$$;

-- Oferta (quem ligou) / resposta (quem atendeu). p_ver maior = renegociacao (ICE restart);
-- mesmo p_ver = mesma descricao com mais candidatos ICE.
CREATE OR REPLACE FUNCTION public.chamada_sdp(p_id uuid, p_tipo text, p_sdp text, p_ver int)
RETURNS public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eu uuid := auth.uid(); c public.chamadas;
BEGIN
  IF p_sdp IS NULL OR length(p_sdp) < 10 OR length(p_sdp) > 20000 OR p_ver IS NULL OR p_ver < 1 OR p_ver > 1000 THEN
    RAISE EXCEPTION 'SDP invalido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.chamadas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (c.de IS DISTINCT FROM v_eu AND c.para IS DISTINCT FROM v_eu) THEN
    RAISE EXCEPTION 'Ligacao nao encontrada' USING ERRCODE = '42501';
  END IF;
  IF c.estado <> 'atendida' THEN RETURN c; END IF;
  IF p_tipo = 'oferta' AND v_eu = c.de AND p_ver >= c.oferta_ver THEN
    UPDATE public.chamadas SET oferta = p_sdp, oferta_ver = p_ver, ping_de = now(), atualizado_em = now()
     WHERE id = p_id RETURNING * INTO c;
  ELSIF p_tipo = 'resposta' AND v_eu = c.para AND p_ver >= c.resposta_ver AND p_ver <= c.oferta_ver THEN
    UPDATE public.chamadas SET resposta = p_sdp, resposta_ver = p_ver, ping_para = now(), atualizado_em = now()
     WHERE id = p_id RETURNING * INTO c;
  ELSIF p_tipo NOT IN ('oferta', 'resposta') OR (p_tipo = 'oferta' AND v_eu <> c.de) OR (p_tipo = 'resposta' AND v_eu <> c.para) THEN
    RAISE EXCEPTION 'SDP nao permitido' USING ERRCODE = '42501';
  END IF;
  RETURN c;
END;
$$;

-- "Ainda estou na ligacao" (a cada ~20 s). Devolve a linha (o app ve se o outro desligou).
CREATE OR REPLACE FUNCTION public.chamada_ping(p_id uuid)
RETURNS public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eu uuid := auth.uid(); c public.chamadas;
BEGIN
  UPDATE public.chamadas
     SET ping_de = CASE WHEN de = v_eu THEN now() ELSE ping_de END,
         ping_para = CASE WHEN para = v_eu THEN now() ELSE ping_para END
   WHERE id = p_id AND (de = v_eu OR para = v_eu) AND estado IN ('tocando', 'atendida')
   RETURNING * INTO c;
  IF NOT FOUND THEN
    SELECT * INTO c FROM public.chamadas WHERE id = p_id AND (de = v_eu OR para = v_eu);
  END IF;
  RETURN c;
END;
$$;

-- Ao abrir o app (pelo aviso "esta te ligando"): ligacao tocando para mim agora, se houver.
CREATE OR REPLACE FUNCTION public.chamada_pendente()
RETURNS SETOF public.chamadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eu uuid := auth.uid();
BEGIN
  IF v_eu IS NULL THEN RETURN; END IF;
  PERFORM public.chamada_expirar();
  RETURN QUERY SELECT * FROM public.chamadas
                WHERE para = v_eu AND estado = 'tocando' AND criado_em > now() - interval '45 seconds'
                ORDER BY criado_em DESC LIMIT 1;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.chamada_iniciar(uuid,text)', 'public.chamada_atender(uuid,text)',
                           'public.chamada_encerrar(uuid,text)', 'public.chamada_sdp(uuid,text,text,integer)',
                           'public.chamada_ping(uuid)', 'public.chamada_pendente()', 'public.chamada_config()'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated';
  END LOOP;
END $$;

-- ---------- 4) Canal Realtime PRIVADO chamada:<id> (candidatos ICE) ----------
CREATE OR REPLACE FUNCTION public.chamada_rt_ok(p_topic text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_eu uuid := auth.uid();
BEGIN
  IF v_eu IS NULL OR p_topic IS NULL OR p_topic !~ '^chamada:[0-9a-f-]{36}$' THEN RETURN false; END IF;
  v_id := substring(p_topic FROM 9)::uuid;
  RETURN EXISTS (SELECT 1 FROM public.chamadas c
                  WHERE c.id = v_id AND (c.de = v_eu OR c.para = v_eu) AND c.estado IN ('tocando', 'atendida'));
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.chamada_rt_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamada_rt_ok(text) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'realtime' AND table_name = 'messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS "minera_chamada_rt_select" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "minera_chamada_rt_insert" ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY "minera_chamada_rt_select" ON realtime.messages
        FOR SELECT TO authenticated
        USING (realtime.messages.extension = 'broadcast' AND public.chamada_rt_ok((SELECT realtime.topic())))
    $p$;
    EXECUTE $p$
      CREATE POLICY "minera_chamada_rt_insert" ON realtime.messages
        FOR INSERT TO authenticated
        WITH CHECK (realtime.messages.extension = 'broadcast' AND public.chamada_rt_ok((SELECT realtime.topic())))
    $p$;
  ELSE
    RAISE NOTICE 'realtime.messages nao encontrado - candidatos ICE vao so pelo banco (funciona, um pouco mais lento)';
  END IF;
END $$;

-- postgres_changes: o aparelho de quem recebe toca na hora (RLS filtra: so participantes recebem)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chamadas') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.chamadas';
  END IF;
END $$;

-- ---------- 5) Push "Fulano esta te ligando" ----------
CREATE OR REPLACE FUNCTION public.chamada_push_notificar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_sec text; v_subs jsonb;
BEGIN
  IF NEW.estado <> 'tocando' THEN RETURN NEW; END IF;
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_fn_url' LIMIT 1;
    SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets WHERE name = 'push_hook_secret' LIMIT 1;
    IF v_url IS NULL OR v_sec IS NULL THEN RETURN NEW; END IF;
    -- mesma escolha de inscricao do SQL 62 (por aparelho, principal = mais recente, ate 2 reservas)
    WITH base AS (
      SELECT s.id, s.endpoint, s.p256dh, s.auth, s.atualizado_em, coalesce(s.origem, 'app') AS o,
             CASE
               WHEN split_part(s.endpoint, '/', 3) = 'web.push.apple.com' AND coalesce(s.user_agent, '') <> ''
                 THEN 'ua:' || md5(s.auth_id::text || s.user_agent)
               WHEN s.aparelho IS NOT NULL THEN 'ap:' || md5(s.auth_id::text || s.aparelho)
               ELSE 'id:' || s.id::text
             END AS g
        FROM public.push_subscriptions s
       WHERE s.auth_id = NEW.para
         AND s.endpoint ~ '^https://(fcm[.]googleapis[.]com|android[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/'
    ), ordem AS (
      SELECT b.*, row_number() OVER (PARTITION BY b.g ORDER BY b.atualizado_em DESC, b.id DESC) AS r FROM base b
    ), lista AS (
      SELECT o.* FROM ordem o WHERE o.r <= 3 ORDER BY o.g, o.r LIMIT 50
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'endpoint', l.endpoint, 'p256dh', l.p256dh, 'auth', l.auth,
                                                  'o', l.o, 'g', left(md5(l.g), 12), 'r', l.r) ORDER BY l.g, l.r), '[]'::jsonb)
      INTO v_subs FROM lista l;
    IF jsonb_array_length(v_subs) = 0 THEN RETURN NEW; END IF;
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
      body := jsonb_build_object(
        'v', 2, 'reserva', true,
        'id', (extract(epoch FROM NEW.criado_em) * 1000)::bigint,   -- numerico (send-push v3 exige id)
        'chamada_id', NEW.id,
        'de', NEW.de,
        'de_nome', NEW.de_nome,
        'grupo_id', NULL,
        'tipo', 'chamada',
        'texto', U&'\+01F4DE Liga\00E7\00E3o de voz \2014 toque para atender',
        'subs', v_subs
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chamada_push_notificar: %', SQLERRM;  -- nunca impede a ligacao
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamada_push_notificar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_chamada_push ON public.chamadas;
CREATE TRIGGER trg_chamada_push AFTER INSERT ON public.chamadas
  FOR EACH ROW WHEN (NEW.estado = 'tocando') EXECUTE FUNCTION public.chamada_push_notificar();

-- Push de MENSAGEM: registro de ligacao so avisa quando e 'perdida' (nao avisa "durou 2:35"/"recusada").
-- (mesma funcao do SQL 62; so ganha a condicao WHEN. Rodar o 62 de novo tira a condicao - sem perigo.)
DO $$ BEGIN
  IF to_regprocedure('public.chat_push_notificar()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_chat_push_ins ON public.chat_mensagens';
    EXECUTE $t$CREATE TRIGGER trg_chat_push_ins AFTER INSERT ON public.chat_mensagens
      FOR EACH ROW WHEN (coalesce(NEW.tipo, '') <> 'chamada' OR NEW.texto LIKE '%perdida%')
      EXECUTE FUNCTION public.chat_push_notificar()$t$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Conferir (esperado: tabela=true, rls=true, funcoes=7, policies_rt=2, publicacao=true, gatilho_push=true,
--           push_62_intacto=true, ativo=true)
SELECT
  (to_regclass('public.chamadas') IS NOT NULL) AS tabela,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chamadas'::regclass) AS rls,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('chamada_iniciar', 'chamada_atender', 'chamada_encerrar', 'chamada_sdp', 'chamada_ping', 'chamada_pendente', 'chamada_config')) AS funcoes,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND policyname LIKE 'minera_chamada_rt_%') AS policies_rt,
  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'chamadas') AS publicacao,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chamada_push') AS gatilho_push,
  (position('SQL62_estrito' IN pg_get_functiondef('public.chat_push_notificar()'::regprocedure)) > 0) AS push_62_intacto,
  public.chamadas_ativas() AS ativo;

-- Desfazer: sql/63-chamadas-desfazer.sql
-- Desligar sem desfazer: INSERT INTO public.app_flags (key, value_bool) VALUES ('chamadas_ativas', false)
--   ON CONFLICT (key) DO UPDATE SET value_bool = excluded.value_bool, updated_at = now();
