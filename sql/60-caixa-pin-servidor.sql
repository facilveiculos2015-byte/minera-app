-- =====================================================================
-- MINERA PARA - 60 Senha do Banco (PIN do Caixa) conferida no SERVIDOR
--  Varredura 08/10/2026 item ALTO 2. Transacional. Idempotente. ASCII.
--  NAO apaga dados. Os PINs atuais continuam valendo (formato antigo
--  SHA-256 salt|pin e conferido aqui e trocado por bcrypt no 1o acerto).
--  1) RPCs: caixa_pin_status, caixa_pin_conferir, caixa_pin_definir,
--     caixa_pedir_saque (valor, chave Pix, PIN).
--  2) Limite: 5 erros seguidos = PIN travado por 15 minutos
--     (vale para desbloquear a tela, trocar a senha e sacar).
--  3) Trocar a senha: precisa da atual OU de login/codigo recente
--     (ate 10 min, claim amr do JWT) - fluxo "Esqueci a senha do Banco".
--  4) Revoga: INSERT direto em caixa_saque_pedidos; leitura/gravacao de
--     pin_hash/pin_salt pelo app (privilegio por coluna).
--  ORDEM: publicar o site com financeiro.js novo (build 20261008i) ANTES
--  (o app velho faz select * em caixa_saldos e quebraria o Banco).
--  Desfazer (emergencia):
--    GRANT SELECT, INSERT, UPDATE ON public.caixa_saldos TO authenticated;
--    GRANT INSERT ON public.caixa_saque_pedidos TO authenticated;
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------- tentativas (sem acesso pelo app) ----------
CREATE TABLE IF NOT EXISTS public.caixa_pin_falhas (
  auth_id uuid PRIMARY KEY,
  tentativas int NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.caixa_pin_falhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.caixa_pin_falhas FROM PUBLIC, anon, authenticated;

-- ---------- confere o PIN (uso interno) ----------
-- retorna: 'ok' | 'sem_pin' | 'bloqueado' | 'errado'
CREATE OR REPLACE FUNCTION public.caixa_pin_checar(p_uid uuid, p_pin text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text; v_salt text; v_ok boolean := false;
  v_f public.caixa_pin_falhas%ROWTYPE;
BEGIN
  SELECT pin_hash, pin_salt INTO v_hash, v_salt FROM public.caixa_saldos WHERE auth_id = p_uid;
  IF coalesce(v_hash, '') = '' THEN RETURN 'sem_pin'; END IF;

  SELECT * INTO v_f FROM public.caixa_pin_falhas WHERE auth_id = p_uid FOR UPDATE;
  IF FOUND AND v_f.bloqueado_ate IS NOT NULL AND v_f.bloqueado_ate > now() THEN
    RETURN 'bloqueado';
  END IF;

  IF p_pin IS NOT NULL AND length(p_pin) BETWEEN 1 AND 72 THEN
    IF left(v_hash, 2) = '$2' THEN
      v_ok := extensions.crypt(p_pin, v_hash) = v_hash;
    ELSIF coalesce(v_salt, '') <> '' THEN
      v_ok := encode(extensions.digest(v_salt || '|' || p_pin, 'sha256'), 'hex') = lower(v_hash);
      IF v_ok THEN  -- formato antigo: troca por bcrypt
        UPDATE public.caixa_saldos
           SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_salt = 'bf'
         WHERE auth_id = p_uid;
      END IF;
    END IF;
  END IF;

  IF v_ok THEN
    DELETE FROM public.caixa_pin_falhas WHERE auth_id = p_uid;
    RETURN 'ok';
  END IF;

  INSERT INTO public.caixa_pin_falhas AS f (auth_id, tentativas, bloqueado_ate, atualizado_em)
  VALUES (p_uid, 1, NULL, now())
  ON CONFLICT (auth_id) DO UPDATE
     SET tentativas = CASE WHEN f.bloqueado_ate IS NOT NULL THEN 1 ELSE f.tentativas + 1 END,
         bloqueado_ate = NULL,
         atualizado_em = now();
  UPDATE public.caixa_pin_falhas
     SET bloqueado_ate = now() + interval '15 minutes', tentativas = 5
   WHERE auth_id = p_uid AND tentativas >= 5;
  RETURN 'errado';
END;
$$;
REVOKE ALL ON FUNCTION public.caixa_pin_checar(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.caixa_pin_info(p_uid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tem_pin', EXISTS (SELECT 1 FROM public.caixa_saldos WHERE auth_id = p_uid AND coalesce(pin_hash, '') <> ''),
    'bloqueado_ate', (SELECT bloqueado_ate FROM public.caixa_pin_falhas
                       WHERE auth_id = p_uid AND bloqueado_ate > now()),
    'restantes', greatest(0, 5 - coalesce((SELECT CASE WHEN bloqueado_ate > now() THEN 5
                                                       WHEN bloqueado_ate IS NOT NULL THEN 0
                                                       ELSE tentativas END
                                             FROM public.caixa_pin_falhas WHERE auth_id = p_uid), 0)));
$$;
REVOKE ALL ON FUNCTION public.caixa_pin_info(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- RPCs do app ----------
CREATE OR REPLACE FUNCTION public.caixa_pin_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login necessario' USING ERRCODE = '42501'; END IF;
  RETURN public.caixa_pin_info(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.caixa_pin_conferir(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_r text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login necessario' USING ERRCODE = '42501'; END IF;
  v_r := public.caixa_pin_checar(v_uid, p_pin);
  RETURN jsonb_build_object('ok', v_r = 'ok', 'motivo', v_r) || public.caixa_pin_info(v_uid);
END;
$$;

-- login/codigo feito ha pouco (claim amr do JWT do Supabase Auth)
CREATE OR REPLACE FUNCTION public.caixa_login_recente(p_minutos int DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE v_amr jsonb; v_ts bigint := 0; e jsonb;
BEGIN
  BEGIN
    v_amr := (nullif(current_setting('request.jwt.claims', true), '')::jsonb) -> 'amr';
  EXCEPTION WHEN others THEN RETURN false;
  END;
  IF v_amr IS NULL OR jsonb_typeof(v_amr) <> 'array' THEN RETURN false; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(v_amr) LOOP
    IF jsonb_typeof(e) = 'object' AND (e ->> 'method') IN ('password', 'otp', 'magiclink', 'email/signup', 'recovery')
       AND (e ->> 'timestamp') ~ '^[0-9]+$' THEN
      v_ts := greatest(v_ts, (e ->> 'timestamp')::bigint);
    END IF;
  END LOOP;
  RETURN v_ts > 0 AND to_timestamp(v_ts) > now() - make_interval(mins => p_minutos);
END;
$$;
REVOKE ALL ON FUNCTION public.caixa_login_recente(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caixa_login_recente(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.caixa_pin_definir(p_novo text, p_atual text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_uid uuid := auth.uid(); v_r text; v_info jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login necessario' USING ERRCODE = '42501'; END IF;
  IF p_novo IS NULL OR length(p_novo) < 6 OR length(p_novo) > 64 THEN
    RAISE EXCEPTION 'A senha do Banco precisa ter de 6 a 64 caracteres' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.caixa_saldos (auth_id, saldo, taxa_mensal, taxa_yield_max) VALUES (v_uid, 0, 5, 5)
    ON CONFLICT (auth_id) DO NOTHING;
  v_info := public.caixa_pin_info(v_uid);
  IF (v_info ->> 'tem_pin')::boolean THEN
    IF coalesce(p_atual, '') <> '' THEN
      v_r := public.caixa_pin_checar(v_uid, p_atual);
      IF v_r <> 'ok' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', v_r) || public.caixa_pin_info(v_uid);
      END IF;
    ELSIF NOT public.caixa_login_recente(10) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'reauth') || v_info;
    END IF;
  END IF;
  UPDATE public.caixa_saldos
     SET pin_hash = extensions.crypt(p_novo, extensions.gen_salt('bf', 10)), pin_salt = 'bf', atualizado_em = now()
   WHERE auth_id = v_uid;
  DELETE FROM public.caixa_pin_falhas WHERE auth_id = v_uid;
  RETURN jsonb_build_object('ok', true, 'motivo', 'ok') || public.caixa_pin_info(v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.caixa_pedir_saque(p_valor numeric, p_chave text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_chave text := btrim(coalesce(p_chave, ''));
  v_r text; v_saldo numeric; v_id bigint; v_on boolean := true;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'login necessario' USING ERRCODE = '42501'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 OR p_valor > 1000000 OR round(p_valor, 2) <> p_valor THEN
    RAISE EXCEPTION 'Informe um valor valido' USING ERRCODE = '22023';
  END IF;
  IF length(v_chave) < 3 OR length(v_chave) > 140 THEN
    RAISE EXCEPTION 'Informe a chave Pix de destino' USING ERRCODE = '22023';
  END IF;
  IF to_regclass('public.app_flags') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce((SELECT value_bool FROM public.app_flags WHERE key = $1), true)'
       INTO v_on USING 'minera_bank_enabled';
    IF NOT coalesce(v_on, true) THEN
      RAISE EXCEPTION 'Minera Bank em manutencao: saque pausado' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_r := public.caixa_pin_checar(v_uid, p_pin);
  IF v_r <> 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', v_r) || public.caixa_pin_info(v_uid);
  END IF;

  SELECT coalesce(saldo, 0) INTO v_saldo FROM public.caixa_saldos WHERE auth_id = v_uid;
  IF p_valor > coalesce(v_saldo, 0) THEN
    RAISE EXCEPTION 'Saldo insuficiente' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.caixa_saque_pedidos (auth_id, valor, chave_pix_destino, status)
  VALUES (v_uid, p_valor, v_chave, 'pendente')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'motivo', 'ok', 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.caixa_pin_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caixa_pin_conferir(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caixa_pin_definir(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caixa_pedir_saque(numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caixa_pin_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_pin_conferir(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_pin_definir(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_pedir_saque(numeric, text, text) TO authenticated;

-- ---------- revogar acesso direto ----------
REVOKE INSERT ON TABLE public.caixa_saque_pedidos FROM authenticated, anon;

-- caixa_saldos: app le/grava todas as colunas MENOS pin_hash/pin_salt
DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'caixa_saldos'
     AND column_name NOT IN ('pin_hash', 'pin_salt');
  EXECUTE 'REVOKE SELECT, INSERT, UPDATE ON TABLE public.caixa_saldos FROM authenticated, anon';
  EXECUTE format('GRANT SELECT (%s), INSERT (%s), UPDATE (%s) ON TABLE public.caixa_saldos TO authenticated',
                 v_cols, v_cols, v_cols);
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Conferir (esperado: rpcs=4, saque_insert_direto=f, pin_hash_leitura=f, saldo_leitura=t, pins_com_hash = quantos ja tinham)
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname IN ('caixa_pin_status','caixa_pin_conferir','caixa_pin_definir','caixa_pedir_saque')) AS rpcs,
  has_table_privilege('authenticated', 'public.caixa_saque_pedidos', 'INSERT') AS saque_insert_direto,
  has_column_privilege('authenticated', 'public.caixa_saldos', 'pin_hash', 'SELECT') AS pin_hash_leitura,
  has_column_privilege('authenticated', 'public.caixa_saldos', 'saldo', 'SELECT') AS saldo_leitura,
  (SELECT count(*) FROM public.caixa_saldos WHERE coalesce(pin_hash, '') <> '') AS pins_com_hash;
