-- =====================================================================
-- MINERA APP - 26 lotes.publicado_como + midia via chat-midia/lotes/
-- Incremental. Idempotente. NÃO wipe.
-- Rodar após 24-chat-midia-storage.sql (bucket chat-midia já usado para fotos).
-- =====================================================================

-- Categoria/papel escolhido ao publicar o lote (ex.: minerador, comprador…)
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS publicado_como TEXT;

COMMENT ON COLUMN lotes.publicado_como IS
  'Papel ativo do autor no momento da publicação (Publicar como).';

-- Garante bucket chat-midia (fotos de lote sob pasta lotes/). Idempotente.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'chat-midia',
  'chat-midia',
  true,
  10485760 -- 10 MB
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = GREATEST(
    COALESCE(storage.buckets.file_size_limit, 0),
    10485760
  );
