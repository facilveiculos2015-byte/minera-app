-- 11-mapa-coords.sql
-- Incremental / idempotent: coordenadas opcionais em lotes para o Mapa de Satélite.
-- NÃO wipe. Aplicar no Supabase SQL Editor após 10-chat-pix-admin.sql.

ALTER TABLE lotes ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS lng NUMERIC;

COMMENT ON COLUMN lotes.lat IS 'Latitude WGS84 (opcional) — Mapa de Satélite';
COMMENT ON COLUMN lotes.lng IS 'Longitude WGS84 (opcional) — Mapa de Satélite';

-- Índice parcial para consultas do mapa (só linhas com coords)
CREATE INDEX IF NOT EXISTS lotes_lat_lng_idx ON lotes (lat, lng)
    WHERE lat IS NOT NULL AND lng IS NOT NULL;
