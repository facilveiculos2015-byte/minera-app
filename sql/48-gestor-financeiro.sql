-- =====================================================================
-- MINERA PARÁ - 48 Gestor financeiro (caderno pessoal de carradas e despesas)
-- Incremental. Idempotente (pode rodar 2x). NÃO wipe. NÃO DROP de tabelas.
-- Rodar no SQL Editor após 44a. Testado em PostgreSQL 17 + shim do Supabase.
--
-- "Gestor (só anotação)": NÃO mexe no saldo do Minera Bank (caixa_*).
--  * Dados 100% PRIVADOS do dono: RLS auth_id = auth.uid(). Admin NÃO lê.
--  * auth_id forçado = auth.uid() por trigger (cliente não "spoofa").
--  * Carrada: cálculo (peso líquido, peso seco, preço por ponto de teor, frete, lucro)
--    por trigger → banco é a fonte da verdade; o front só mostra prévia.
--    Modelo simples: peso seco = líquido × (1 − umidade/100); preço SEMPRE no peso seco.
--  * Tabelas de preço (teor % → R$ por ponto ou R$ por tonelada), várias por usuário;
--    a carrada guarda o preço usado (snapshot) + qual tabela/linha foi usada.
--  * Lucro POR CARRADA: venda − custo minério − frete − carregamento − impostos
--    − outros custos − despesas vinculadas (gf_lancamentos.carrada_id).
--  * id/client_id gerados no celular → fila offline idempotente (upsert por id).
--  * Soft delete (deleted_at) p/ "Desfazer" e sync offline.
--  * Storage PRIVADO gestor-docs/{auth.uid()}/… (fotos de comprovante).
-- Tabelas: gf_categorias, gf_tabelas_preco, gf_tabelas_preco_linhas, gf_carradas, gf_lancamentos
-- RPCs:   gf_tabela_preco_salvar(tabela, linhas), gf_preco_lookup(tabela, teor)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- 0) Helper: dono + timestamps
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gf_set_owner_ts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN
      -- SQL Editor / service_role (presets, manutenção): mantém auth_id informado
      IF current_user IN ('postgres','supabase_admin','service_role') THEN
        NEW.criado_em := COALESCE(NEW.criado_em, now());
        NEW.atualizado_em := now();
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'gestor: sessão obrigatória';
    END IF;
    NEW.auth_id := auth.uid();           -- ignora o que o cliente mandou
    NEW.criado_em := now();
  ELSE
    IF NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
      RAISE EXCEPTION 'gestor: auth_id não pode mudar';
    END IF;
    NEW.criado_em := OLD.criado_em;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 1) Categorias (presets globais auth_id NULL, só leitura + do usuário)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gf_categorias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       UUID,                      -- NULL = preset do sistema
  slug          TEXT,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  icone         TEXT,
  ordem         INT  DEFAULT 100,
  arquivada     BOOLEAN DEFAULT false,
  criado_em     TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gf_categorias_preset_slug_uq
  ON public.gf_categorias (slug) WHERE auth_id IS NULL;
-- arquivada = "excluída" (soft delete → Desfazer); nome livre de novo depois de excluir
DROP INDEX IF EXISTS public.gf_categorias_user_nome_uq;
CREATE UNIQUE INDEX IF NOT EXISTS gf_categorias_user_nome_uq2
  ON public.gf_categorias (auth_id, tipo, lower(nome)) WHERE auth_id IS NOT NULL AND NOT arquivada;

-- ---------------------------------------------------------------------
-- 1b) Tabelas de preço (cabeçalho + linhas teor → valor)
--   modo 'ponto'    : valor = R$ por ponto (1 % de teor) por tonelada seca
--   modo 'tonelada' : valor = R$ por tonelada seca para aquela faixa de teor
--   Faixa: usa a MAIOR linha com teor <= teor da carga.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gf_tabelas_preco (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       UUID NOT NULL,
  client_id     UUID,
  nome          TEXT NOT NULL,
  minerio       TEXT,
  comprador     TEXT,
  modo          TEXT NOT NULL DEFAULT 'ponto' CHECK (modo IN ('ponto','tonelada')),
  observacao    TEXT,
  deleted_at    TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gf_tabelas_auth_idx ON public.gf_tabelas_preco (auth_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gf_tabelas_client_uq ON public.gf_tabelas_preco (auth_id, client_id);

CREATE TABLE IF NOT EXISTS public.gf_tabelas_preco_linhas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       UUID NOT NULL,
  tabela_id     UUID NOT NULL REFERENCES public.gf_tabelas_preco(id) ON DELETE CASCADE,
  teor          NUMERIC(10,4) NOT NULL CHECK (teor >= 0 AND teor <= 100),
  valor         NUMERIC(14,4) NOT NULL CHECK (valor >= 0),
  criado_em     TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gf_tab_linhas_teor_uq ON public.gf_tabelas_preco_linhas (tabela_id, teor);

-- ---------------------------------------------------------------------
-- 2) Carradas (uma viagem de caminhão / ticket de balança)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gf_carradas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id              UUID NOT NULL,
  client_id            UUID,
  data                 DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Belem')::date,
  minerio              TEXT,                 -- Ferro, Manganês, Cobre… (= lotes.tipo_minerio)
  comprador            TEXT,
  placa                TEXT,                 -- normalizada (trigger)
  motorista            TEXT,
  ticket_numero        TEXT,
  nf_numero            TEXT,
  -- balança (kg)
  peso_bruto_kg        NUMERIC(14,2) CHECK (peso_bruto_kg IS NULL OR peso_bruto_kg >= 0),
  tara_kg              NUMERIC(14,2) CHECK (tara_kg IS NULL OR tara_kg >= 0),
  peso_liquido_kg      NUMERIC(14,2) CHECK (peso_liquido_kg IS NULL OR peso_liquido_kg >= 0),
  umidade_pct          NUMERIC(6,3)  CHECK (umidade_pct IS NULL OR (umidade_pct >= 0 AND umidade_pct < 100)),
  umidade_franquia_pct NUMERIC(6,3),         -- LEGADO (ignorado no cálculo)
  teor                 NUMERIC(10,4) CHECK (teor IS NULL OR (teor >= 0 AND teor <= 100)),  -- % do minério
  -- preço: 'ponto' (padrão) = R$ por 1 % de teor por tonelada
  preco_modo           TEXT NOT NULL DEFAULT 'ponto' CHECK (preco_modo IN ('ponto','tonelada','total')),
  peso_base            TEXT NOT NULL DEFAULT 'tms'   CHECK (peso_base IN ('tms','tu')),  -- LEGADO (preço sempre no peso seco)
  preco_ponto          NUMERIC(14,4),        -- modo ponto
  preco_t_informado    NUMERIC(14,4),        -- modo tonelada (R$/t)
  valor_informado      NUMERIC(14,2),        -- modo total (R$)
  ajuste               NUMERIC(14,2) DEFAULT 0,  -- ± manual (bônus/penalidade)
  tabela_id            UUID REFERENCES public.gf_tabelas_preco(id) ON DELETE SET NULL,  -- tabela usada
  tabela_teor_ref      NUMERIC(10,4),        -- linha (teor) da tabela que deu o preço
  preco_manual         BOOLEAN DEFAULT false,-- usuário digitou o preço (ignorou a tabela)
  -- custos da carrada
  custo_minerio        NUMERIC(14,2) DEFAULT 0,
  frete_base           TEXT NOT NULL DEFAULT 'por_t' CHECK (frete_base IN ('por_t','viagem')),
  frete_unit           NUMERIC(14,4),        -- R$ por tonelada (peso líquido) ou R$/viagem
  carregamento_base    TEXT NOT NULL DEFAULT 'por_t' CHECK (carregamento_base IN ('por_t','viagem')),
  carregamento_unit    NUMERIC(14,4),
  impostos_pct         NUMERIC(6,3)  DEFAULT 0,  -- estimativa (ex.: CFEM)
  outros_custos        NUMERIC(14,2) DEFAULT 0,
  -- CALCULADOS (trigger; o que o cliente mandar é sobrescrito)
  peso_umido_t         NUMERIC(14,4),        -- peso líquido em t (= líquido_kg/1000)
  peso_seco_t          NUMERIC(14,4),        -- peso seco t = líquido × (1 − umidade/100)
  peso_pago_t          NUMERIC(14,4),        -- = peso seco (onde o preço é aplicado)
  preco_t              NUMERIC(14,4),        -- R$/t usado
  valor_venda          NUMERIC(14,2),
  frete_total          NUMERIC(14,2),
  carregamento_total   NUMERIC(14,2),
  impostos_total       NUMERIC(14,2),
  despesas_total       NUMERIC(14,2) DEFAULT 0,  -- soma das despesas vinculadas
  lucro                NUMERIC(14,2),
  -- status
  status               TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','finalizada','cancelada')),
  finalizada_em        TIMESTAMPTZ,
  ticket_foto_path     TEXT,                 -- gestor-docs/{uid}/…
  observacao           TEXT,
  deleted_at           TIMESTAMPTZ,
  criado_em            TIMESTAMPTZ DEFAULT now(),
  atualizado_em        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gf_carradas_auth_data_idx ON public.gf_carradas (auth_id, data DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gf_carradas_client_uq ON public.gf_carradas (auth_id, client_id);
-- compat: bancos que rodaram uma versão anterior deste arquivo
ALTER TABLE public.gf_carradas ADD COLUMN IF NOT EXISTS tabela_id UUID REFERENCES public.gf_tabelas_preco(id) ON DELETE SET NULL;
ALTER TABLE public.gf_carradas ADD COLUMN IF NOT EXISTS tabela_teor_ref NUMERIC(10,4);
ALTER TABLE public.gf_carradas ADD COLUMN IF NOT EXISTS preco_manual BOOLEAN DEFAULT false;
ALTER TABLE public.gf_carradas DROP CONSTRAINT IF EXISTS gf_carradas_umidade_franquia_pct_check;

-- ---------------------------------------------------------------------
-- 3) Lançamentos (despesas e entradas avulsas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gf_lancamentos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id          UUID NOT NULL,
  client_id        UUID,
  data             DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Belem')::date,
  tipo             TEXT NOT NULL DEFAULT 'saida' CHECK (tipo IN ('entrada','saida')),
  valor            NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  categoria_id     UUID REFERENCES public.gf_categorias(id) ON DELETE SET NULL,
  descricao        TEXT,
  observacao       TEXT,
  forma_pagto      TEXT DEFAULT 'pix'
                   CHECK (forma_pagto IN ('pix','dinheiro','transferencia','boleto','cartao','cheque','outro')),
  status           TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente')),
  vencimento       DATE,
  carrada_id       UUID REFERENCES public.gf_carradas(id) ON DELETE SET NULL,
  comprovante_path TEXT,                      -- gestor-docs/{uid}/…
  deleted_at       TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ DEFAULT now(),
  atualizado_em    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gf_lanc_auth_data_idx ON public.gf_lancamentos (auth_id, data DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS gf_lanc_carrada_idx   ON public.gf_lancamentos (carrada_id);
CREATE UNIQUE INDEX IF NOT EXISTS gf_lanc_client_uq ON public.gf_lancamentos (auth_id, client_id);

-- ---------------------------------------------------------------------
-- 4) Cálculo da carrada
--   peso líquido = bruto − tara (ou digitado)        → t = kg/1000
--   peso seco    = líquido × (1 − umidade/100)       (umidade = desconto)
--   preço/t: ponto → preço_ponto × teor; tonelada → informado
--   venda   = peso seco × preço/t + ajuste   (modo total: valor informado + ajuste)
--   frete/carregamento: por tonelada (peso líquido) ou por viagem
--   lucro   = venda − custo − frete − carregamento − impostos − outros − despesas
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gf_carradas_calc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  u     NUMERIC;
  bruto NUMERIC;
BEGIN
  u := COALESCE(NEW.umidade_pct, 0);
  IF NEW.placa IS NOT NULL THEN
    NEW.placa := nullif(upper(regexp_replace(NEW.placa, '[^A-Za-z0-9]', '', 'g')), '');
  END IF;
  -- fotos só na pasta do próprio dono
  IF NEW.ticket_foto_path IS NOT NULL AND NEW.ticket_foto_path NOT LIKE NEW.auth_id::text || '/%' THEN
    RAISE EXCEPTION 'gestor: caminho de foto inválido';
  END IF;

  IF NEW.peso_bruto_kg IS NOT NULL AND NEW.tara_kg IS NOT NULL THEN
    IF NEW.tara_kg > NEW.peso_bruto_kg THEN
      RAISE EXCEPTION 'Tara maior que o peso bruto';
    END IF;
    NEW.peso_liquido_kg := NEW.peso_bruto_kg - NEW.tara_kg;
  END IF;

  NEW.peso_umido_t := round(NEW.peso_liquido_kg / 1000.0, 4);
  NEW.peso_seco_t  := round(NEW.peso_umido_t * (1 - u / 100.0), 4);
  NEW.peso_pago_t  := NEW.peso_seco_t;      -- preço sempre no peso seco
  NEW.peso_base    := 'tms';
  NEW.umidade_franquia_pct := NULL;
  -- tabela de preço precisa ser do mesmo dono
  IF NEW.tabela_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM gf_tabelas_preco t WHERE t.id = NEW.tabela_id AND t.auth_id = NEW.auth_id) THEN
    RAISE EXCEPTION 'tabela de preço inválida';
  END IF;

  NEW.preco_t := CASE NEW.preco_modo
      WHEN 'ponto'    THEN round(COALESCE(NEW.preco_ponto, 0) * COALESCE(NEW.teor, 0), 4)
      WHEN 'tonelada' THEN NEW.preco_t_informado
      ELSE NULL END;
  bruto := CASE WHEN NEW.preco_modo = 'total' THEN NEW.valor_informado
                ELSE NEW.peso_pago_t * NEW.preco_t END;
  NEW.valor_venda := round(COALESCE(bruto, 0) + COALESCE(NEW.ajuste, 0), 2);

  NEW.frete_total := round(CASE NEW.frete_base
      WHEN 'viagem' THEN COALESCE(NEW.frete_unit, 0)
      ELSE COALESCE(NEW.peso_umido_t, 0) * COALESCE(NEW.frete_unit, 0) END, 2);
  NEW.carregamento_total := round(CASE NEW.carregamento_base
      WHEN 'viagem' THEN COALESCE(NEW.carregamento_unit, 0)
      ELSE COALESCE(NEW.peso_umido_t, 0) * COALESCE(NEW.carregamento_unit, 0) END, 2);
  NEW.impostos_total := round(GREATEST(NEW.valor_venda, 0) * COALESCE(NEW.impostos_pct, 0) / 100.0, 2);

  -- despesas vinculadas (RLS: só as do dono)
  IF TG_OP = 'INSERT' THEN
    NEW.despesas_total := 0;
  ELSE
    SELECT COALESCE(SUM(l.valor), 0) INTO NEW.despesas_total
      FROM gf_lancamentos l
     WHERE l.carrada_id = NEW.id AND l.auth_id = NEW.auth_id
       AND l.tipo = 'saida' AND l.deleted_at IS NULL;
  END IF;

  NEW.lucro := NEW.valor_venda - COALESCE(NEW.custo_minerio, 0) - NEW.frete_total
             - NEW.carregamento_total - NEW.impostos_total - COALESCE(NEW.outros_custos, 0)
             - NEW.despesas_total;

  -- Finalizar: carimba a hora; reabrir limpa
  IF NEW.status = 'finalizada' THEN
    NEW.finalizada_em := CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'finalizada'
                              THEN COALESCE(OLD.finalizada_em, now()) ELSE now() END;
  ELSE
    NEW.finalizada_em := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Lançamento: refs do mesmo dono + caminho de foto
CREATE OR REPLACE FUNCTION public.gf_lanc_check_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.categoria_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM gf_categorias c
       WHERE c.id = NEW.categoria_id AND (c.auth_id IS NULL OR c.auth_id = NEW.auth_id)) THEN
    RAISE EXCEPTION 'categoria inválida';
  END IF;
  IF NEW.carrada_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM gf_carradas g WHERE g.id = NEW.carrada_id AND g.auth_id = NEW.auth_id) THEN
    RAISE EXCEPTION 'carrada inválida';
  END IF;
  IF NEW.comprovante_path IS NOT NULL AND NEW.comprovante_path NOT LIKE NEW.auth_id::text || '/%' THEN
    RAISE EXCEPTION 'gestor: caminho de foto inválido';
  END IF;
  RETURN NEW;
END;
$$;

-- Depois de mexer numa despesa: recalcula a(s) carrada(s) afetada(s)
CREATE OR REPLACE FUNCTION public.gf_lanc_sync_carrada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.carrada_id IS NOT NULL THEN
    UPDATE gf_carradas SET atualizado_em = now() WHERE id = OLD.carrada_id;  -- trigger b_calc recalcula
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.carrada_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.carrada_id IS DISTINCT FROM OLD.carrada_id
          OR NEW.valor IS DISTINCT FROM OLD.valor OR NEW.tipo IS DISTINCT FROM OLD.tipo
          OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    UPDATE gf_carradas SET atualizado_em = now() WHERE id = NEW.carrada_id;
  END IF;
  RETURN NULL;
END;
$$;

-- Linha de tabela: herda o dono da tabela (precisa ser do mesmo dono)
CREATE OR REPLACE FUNCTION public.gf_tab_linha_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gf_tabelas_preco t WHERE t.id = NEW.tabela_id AND t.auth_id = NEW.auth_id) THEN
    RAISE EXCEPTION 'tabela de preço inválida';
  END IF;
  RETURN NEW;
END;
$$;

-- Salvar tabela + TODAS as linhas de uma vez (idempotente; usado pela fila offline).
-- p_tabela: {id, client_id, nome, minerio, comprador, modo, observacao, deleted_at}
-- p_linhas: [{teor, valor}, …]  (substitui as linhas atuais)
CREATE OR REPLACE FUNCTION public.gf_tabela_preco_salvar(p_tabela JSONB, p_linhas JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID := COALESCE(nullif(p_tabela->>'id','')::uuid, gen_random_uuid());
  v_res JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'gestor: sessão obrigatória'; END IF;
  IF COALESCE(trim(p_tabela->>'nome'),'') = '' THEN RAISE EXCEPTION 'Dê um nome para a tabela'; END IF;
  INSERT INTO gf_tabelas_preco (id, client_id, nome, minerio, comprador, modo, observacao, deleted_at, auth_id)
  VALUES (v_id, COALESCE(nullif(p_tabela->>'client_id','')::uuid, v_id), trim(p_tabela->>'nome'),
          nullif(p_tabela->>'minerio',''), nullif(p_tabela->>'comprador',''),
          COALESCE(nullif(p_tabela->>'modo',''),'ponto'), nullif(p_tabela->>'observacao',''),
          nullif(p_tabela->>'deleted_at','')::timestamptz, auth.uid())
  ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, minerio = EXCLUDED.minerio, comprador = EXCLUDED.comprador,
     modo = EXCLUDED.modo, observacao = EXCLUDED.observacao, deleted_at = EXCLUDED.deleted_at;
  IF p_linhas IS NOT NULL THEN
    DELETE FROM gf_tabelas_preco_linhas WHERE tabela_id = v_id;
    INSERT INTO gf_tabelas_preco_linhas (tabela_id, teor, valor, auth_id)
    SELECT v_id, (l->>'teor')::numeric, (l->>'valor')::numeric, auth.uid()
      FROM jsonb_array_elements(p_linhas) l;
  END IF;
  SELECT to_jsonb(t) || jsonb_build_object('linhas', COALESCE((
           SELECT jsonb_agg(jsonb_build_object('teor', x.teor, 'valor', x.valor) ORDER BY x.teor)
             FROM gf_tabelas_preco_linhas x WHERE x.tabela_id = t.id), '[]'::jsonb))
    INTO v_res FROM gf_tabelas_preco t WHERE t.id = v_id;
  IF v_res IS NULL THEN RAISE EXCEPTION 'tabela de preço inválida'; END IF;  -- de outro dono (RLS)
  RETURN v_res;
END;
$$;

-- Faixa: maior linha com teor <= teor da carga (NULL se abaixo da 1ª linha)
CREATE OR REPLACE FUNCTION public.gf_preco_lookup(p_tabela UUID, p_teor NUMERIC)
RETURNS TABLE (teor NUMERIC, valor NUMERIC, modo TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT l.teor, l.valor, t.modo
    FROM gf_tabelas_preco t JOIN gf_tabelas_preco_linhas l ON l.tabela_id = t.id
   WHERE t.id = p_tabela AND t.deleted_at IS NULL AND l.teor <= p_teor
   ORDER BY l.teor DESC LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 5) Triggers (ordem alfabética: a_owner antes de b_*)
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS a_owner ON public.gf_categorias;
CREATE TRIGGER a_owner BEFORE INSERT OR UPDATE ON public.gf_categorias
  FOR EACH ROW EXECUTE FUNCTION public.gf_set_owner_ts();

DROP TRIGGER IF EXISTS a_owner ON public.gf_tabelas_preco;
CREATE TRIGGER a_owner BEFORE INSERT OR UPDATE ON public.gf_tabelas_preco
  FOR EACH ROW EXECUTE FUNCTION public.gf_set_owner_ts();
DROP TRIGGER IF EXISTS a_owner ON public.gf_tabelas_preco_linhas;
CREATE TRIGGER a_owner BEFORE INSERT OR UPDATE ON public.gf_tabelas_preco_linhas
  FOR EACH ROW EXECUTE FUNCTION public.gf_set_owner_ts();
DROP TRIGGER IF EXISTS b_check ON public.gf_tabelas_preco_linhas;
CREATE TRIGGER b_check BEFORE INSERT OR UPDATE ON public.gf_tabelas_preco_linhas
  FOR EACH ROW EXECUTE FUNCTION public.gf_tab_linha_check();

DROP TRIGGER IF EXISTS a_owner ON public.gf_carradas;
CREATE TRIGGER a_owner BEFORE INSERT OR UPDATE ON public.gf_carradas
  FOR EACH ROW EXECUTE FUNCTION public.gf_set_owner_ts();
DROP TRIGGER IF EXISTS b_calc ON public.gf_carradas;
CREATE TRIGGER b_calc BEFORE INSERT OR UPDATE ON public.gf_carradas
  FOR EACH ROW EXECUTE FUNCTION public.gf_carradas_calc();

DROP TRIGGER IF EXISTS a_owner ON public.gf_lancamentos;
CREATE TRIGGER a_owner BEFORE INSERT OR UPDATE ON public.gf_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.gf_set_owner_ts();
DROP TRIGGER IF EXISTS b_refs ON public.gf_lancamentos;
CREATE TRIGGER b_refs BEFORE INSERT OR UPDATE ON public.gf_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.gf_lanc_check_refs();
DROP TRIGGER IF EXISTS c_sync_carrada ON public.gf_lancamentos;
CREATE TRIGGER c_sync_carrada AFTER INSERT OR UPDATE OR DELETE ON public.gf_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.gf_lanc_sync_carrada();

-- presets de categoria (como postgres; trigger mantém auth_id NULL)
INSERT INTO public.gf_categorias (auth_id, slug, nome, tipo, icone, ordem) VALUES
  (NULL,'diesel',          'Diesel / combustível',     'saida',  '⛽', 10),
  (NULL,'frete_pago',      'Frete pago',               'saida',  '🚛', 20),
  (NULL,'carregamento',    'Carregamento pago',        'saida',  '🏗️', 30),
  (NULL,'compra_minerio',  'Compra de minério',        'saida',  '⛏️', 40),
  (NULL,'funcionarios',    'Funcionários / diárias',   'saida',  '👷', 50),
  (NULL,'alimentacao',     'Alimentação / rancho',     'saida',  '🍲', 60),
  (NULL,'manutencao',      'Manutenção / peças',       'saida',  '🔧', 70),
  (NULL,'aluguel_equip',   'Aluguel de máquina',       'saida',  '🚜', 80),
  (NULL,'pedagio_balanca', 'Pedágio / balança',        'saida',  '⚖️', 85),
  (NULL,'impostos',        'Impostos / CFEM / taxas',  'saida',  '🧾', 87),
  (NULL,'analise_teor',    'Análise de teor / laudo',  'saida',  '🧪', 88),
  (NULL,'outras_saidas',   'Outras despesas',          'saida',  '➖', 99),
  (NULL,'venda_minerio',   'Venda de minério',         'entrada','⛏️', 10),
  (NULL,'servico',         'Serviço recebido',         'entrada','🧰', 20),
  (NULL,'outras_entradas', 'Outras entradas',          'entrada','➕', 99)
ON CONFLICT (slug) WHERE auth_id IS NULL DO NOTHING;

-- ---------------------------------------------------------------------
-- 6) RLS — owner-only (presets: só leitura). Sem exceção p/ admin.
-- ---------------------------------------------------------------------
ALTER TABLE public.gf_categorias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gf_carradas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gf_tabelas_preco        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gf_tabelas_preco_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gf_lancamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gf_cat_select ON public.gf_categorias;
DROP POLICY IF EXISTS gf_cat_insert ON public.gf_categorias;
DROP POLICY IF EXISTS gf_cat_update ON public.gf_categorias;
DROP POLICY IF EXISTS gf_cat_delete ON public.gf_categorias;
CREATE POLICY gf_cat_select ON public.gf_categorias FOR SELECT TO authenticated
  USING (auth_id IS NULL OR auth_id = auth.uid());
CREATE POLICY gf_cat_insert ON public.gf_categorias FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());
CREATE POLICY gf_cat_update ON public.gf_categorias FOR UPDATE TO authenticated
  USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid());
CREATE POLICY gf_cat_delete ON public.gf_categorias FOR DELETE TO authenticated
  USING (auth_id = auth.uid());

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gf_carradas','gf_lancamentos','gf_tabelas_preco','gf_tabelas_preco_linhas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_delete_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth_id = auth.uid())', t||'_select_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid())', t||'_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid())', t||'_update_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth_id = auth.uid())', t||'_delete_own', t);
  END LOOP;
END $$;

REVOKE ALL ON public.gf_categorias, public.gf_carradas, public.gf_lancamentos,
  public.gf_tabelas_preco, public.gf_tabelas_preco_linhas FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.gf_categorias, public.gf_carradas, public.gf_lancamentos,
     public.gf_tabelas_preco, public.gf_tabelas_preco_linhas TO authenticated;
REVOKE ALL ON FUNCTION public.gf_set_owner_ts(), public.gf_carradas_calc(),
  public.gf_lanc_check_refs(), public.gf_lanc_sync_carrada(), public.gf_tab_linha_check() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gf_tabela_preco_salvar(JSONB, JSONB), public.gf_preco_lookup(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gf_tabela_preco_salvar(JSONB, JSONB), public.gf_preco_lookup(UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------
-- 7) Storage PRIVADO p/ foto de comprovante/ticket
--    Caminho: gestor-docs/{auth.uid()}/… · ver com signed URL · admin NÃO lê
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('gestor-docs', 'gestor-docs', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS gestor_docs_select_own ON storage.objects;
DROP POLICY IF EXISTS gestor_docs_insert_own ON storage.objects;
DROP POLICY IF EXISTS gestor_docs_update_own ON storage.objects;
DROP POLICY IF EXISTS gestor_docs_delete_own ON storage.objects;
CREATE POLICY gestor_docs_select_own ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'gestor-docs' AND auth.uid() IS NOT NULL
         AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY gestor_docs_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gestor-docs' AND auth.uid() IS NOT NULL
              AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY gestor_docs_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'gestor-docs' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'gestor-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY gestor_docs_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gestor-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 8) Exemplo / checagem rápida (rodar logado como usuário, dentro de BEGIN … ROLLBACK)
-- ---------------------------------------------------------------------
-- 45.000 − 15.000 kg = 30 t líquido, umidade 8 % → 27,6 t seco; teor 40 %, R$ 10 por ponto;
-- frete 60/t e carregamento 8/t (sobre o líquido):
-- INSERT INTO gf_carradas (minerio, placa, peso_bruto_kg, tara_kg, umidade_pct, teor,
--                          preco_modo, preco_ponto, frete_unit, carregamento_unit)
-- VALUES ('Manganês','qwe 1a23', 45000, 15000, 8, 40, 'ponto', 10, 60, 8)
-- RETURNING peso_umido_t, peso_seco_t, preco_t, valor_venda, frete_total, carregamento_total, lucro;
-- Esperado: 30.0000 líq · 27.6000 seco · 400.0000 R$/t · 11040.00 · 1800.00 · 240.00 · lucro 9000.00
-- Tabela (faixa): linhas 35→9, 40→10, 45→11; carga teor 42 → usa 40 → R$ 10 × 42 = R$ 420/t.
