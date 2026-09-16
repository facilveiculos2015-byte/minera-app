-- =====================================================================
-- MINERA APP - 29 lotes localidade (estado / cidade / ddd)
-- Incremental. Idempotente. NÃO wipe.
-- Rodar no Supabase SQL Editor após 28-chat-msg-acoes.sql (ou qualquer 11+).
-- lat/lng já existem em 11-mapa-coords.sql — não recria.
-- RLS: inalterado em espírito (feed público de lotes disponíveis continua legível).
-- =====================================================================

-- Localidade Brasil (filtros Marketplace + formulário de lote)
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS estado CHAR(2);
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS ddd TEXT;

COMMENT ON COLUMN lotes.estado IS 'UF (2 letras) — IBGE / filtro Marketplace';
COMMENT ON COLUMN lotes.cidade IS 'Município — IBGE / filtro Marketplace';
COMMENT ON COLUMN lotes.ddd IS 'DDD (2 dígitos) derivado da cidade quando possível';

-- Normaliza UF em maiúsculas se já houver dados
UPDATE lotes SET estado = UPPER(TRIM(estado))
WHERE estado IS NOT NULL AND estado <> UPPER(TRIM(estado));

-- Índices para filtros (estado / cidade / ddd)
CREATE INDEX IF NOT EXISTS lotes_estado_idx ON lotes (estado)
  WHERE estado IS NOT NULL;

CREATE INDEX IF NOT EXISTS lotes_cidade_idx ON lotes (cidade)
  WHERE cidade IS NOT NULL;

CREATE INDEX IF NOT EXISTS lotes_ddd_idx ON lotes (ddd)
  WHERE ddd IS NOT NULL;

CREATE INDEX IF NOT EXISTS lotes_estado_cidade_idx ON lotes (estado, cidade)
  WHERE estado IS NOT NULL AND cidade IS NOT NULL;

-- Grants já cobertos por policies existentes de lotes; reforço idempotente
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lotes TO authenticated;
GRANT SELECT ON TABLE lotes TO anon;
