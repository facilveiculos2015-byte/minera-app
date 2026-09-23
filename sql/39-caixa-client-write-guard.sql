-- =====================================================================
-- MINERA PARÁ - 39 Caixa client write guard (recomendado pré-lançamento)
-- Incremental. Idempotente. NÃO wipe. NÃO DROP de tabelas.
-- Rodar no SQL Editor APÓS 32/35. Fortalece RLS sem enfraquecer nada.
--
-- Riscos mitigados (audit 2026-09-23):
-- 1) Cliente autenticado podia UPDATE caixa_saldos.saldo (policy coluna-aberta).
-- 2) Cliente podia UPDATE depósito/saque para status=confirmado.
-- 3) Cliente podia INSERT caixa_movimentos com tipos de crédito.
-- Admin (is_admin) permanece irrestrito.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.caixa_guard_saldo_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.saldo IS DISTINCT FROM OLD.saldo THEN
    RAISE EXCEPTION 'caixa_saldos: saldo só pode ser alterado pelo admin';
  END IF;
  IF NEW.taxa_mensal IS DISTINCT FROM OLD.taxa_mensal THEN
    RAISE EXCEPTION 'caixa_saldos: taxa_mensal só admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caixa_guard_saldo_update ON public.caixa_saldos;
CREATE TRIGGER trg_caixa_guard_saldo_update
  BEFORE UPDATE ON public.caixa_saldos
  FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_saldo_update();

CREATE OR REPLACE FUNCTION public.caixa_guard_pedido_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'pendente' AND NEW.status = 'cancelado') THEN
      RAISE EXCEPTION 'status de pedido: cliente só cancela pendente; confirmação é admin';
    END IF;
  END IF;
  IF NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
    RAISE EXCEPTION 'auth_id imutável';
  END IF;
  IF NEW.valor IS DISTINCT FROM OLD.valor THEN
    RAISE EXCEPTION 'valor do pedido imutável após criação';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caixa_dep_status_guard ON public.caixa_deposito_pedidos;
DROP TRIGGER IF EXISTS trg_caixa_saque_status_guard ON public.caixa_saque_pedidos;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_deposito_pedidos') THEN
    EXECUTE 'CREATE TRIGGER trg_caixa_dep_status_guard BEFORE UPDATE ON public.caixa_deposito_pedidos FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_pedido_status()';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_saque_pedidos') THEN
    EXECUTE 'CREATE TRIGGER trg_caixa_saque_status_guard BEFORE UPDATE ON public.caixa_saque_pedidos FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_pedido_status()';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.caixa_guard_movimento_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok_tipos text[] := ARRAY['deposito_pendente','saque_pendente','info','ajuste_info'];
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
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
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='caixa_movimentos') THEN
    EXECUTE 'CREATE TRIGGER trg_caixa_mov_insert_guard BEFORE INSERT ON public.caixa_movimentos FOR EACH ROW EXECUTE FUNCTION public.caixa_guard_movimento_insert()';
  END IF;
END $$;

COMMENT ON FUNCTION public.caixa_guard_saldo_update() IS
  'SQL 39: impede cliente de credit/debit saldo via UPDATE direto.';
