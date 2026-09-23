-- MINERA PARÁ — 37 lotes midia + teor + cobre_tipo
-- Incremental / idempotente. NÃO wipe. Rodar no SQL Editor após 36.
-- Parent: aplicar no Supabase antes de esperar fotos[]/teor no app.

ALTER TABLE public.lotes ADD COLUMN IF NOT EXISTS fotos JSONB;
ALTER TABLE public.lotes ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE public.lotes ADD COLUMN IF NOT EXISTS teor NUMERIC;
ALTER TABLE public.lotes ADD COLUMN IF NOT EXISTS cobre_tipo TEXT;

COMMENT ON COLUMN public.lotes.fotos IS 'Array JSON de URLs públicas (até 5). imagem_url permanece a capa (1ª).';
COMMENT ON COLUMN public.lotes.video_url IS 'URL pública de 1 vídeo do lote (storage).';
COMMENT ON COLUMN public.lotes.teor IS 'Teor/grade do minério (substitui preço no formulário mineral).';
COMMENT ON COLUMN public.lotes.cobre_tipo IS 'Para tipo Cobre: total | soluvel';

-- Backfill capa → fotos quando vazio
UPDATE public.lotes
SET fotos = jsonb_build_array(imagem_url)
WHERE (fotos IS NULL OR fotos = 'null'::jsonb OR fotos = '[]'::jsonb)
  AND imagem_url IS NOT NULL
  AND length(trim(imagem_url)) > 0;

-- Constraint soft (não quebra rows antigas com NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lotes_cobre_tipo_check'
  ) THEN
    ALTER TABLE public.lotes
      ADD CONSTRAINT lotes_cobre_tipo_check
      CHECK (cobre_tipo IS NULL OR cobre_tipo IN ('total', 'soluvel'));
  END IF;
END $$;
