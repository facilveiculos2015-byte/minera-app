-- =====================================================================
-- MINERA PARÁ - 41 Banner Família Minera: fit contain + cache-bust
-- Incremental. Idempotente. NÃO DROP.
-- Arte 1600×600 (16:6) letterbox — sem cortar.
-- Também troca URL antiga do Storage (upload Admin) pela arte do app.
-- =====================================================================

-- 1) Qualquer promo que já referencie o JPG local
UPDATE public.app_promos
SET
  imagem_url = 'media/banner-familia-minera.jpg?v=20260923ae',
  updated_at = now()
WHERE imagem_url LIKE '%banner-familia-minera.jpg%';

-- 2) Banners ativos ainda no Storage (upload antigo / crop)
UPDATE public.app_promos
SET
  imagem_url = 'media/banner-familia-minera.jpg?v=20260923ae',
  titulo = NULL,
  texto = NULL,
  updated_at = now()
WHERE ativo = true
  AND tipo = 'banner'
  AND (
    imagem_url IS NULL
    OR imagem_url LIKE '%/storage/v1/object/%'
    OR imagem_url NOT LIKE '%banner-familia-minera.jpg%'
  );

-- 3) Garante pelo menos um seed Família Minera
INSERT INTO public.app_promos (tipo, titulo, texto, imagem_url, link, ativo, ordem)
SELECT
  'banner',
  NULL,
  NULL,
  'media/banner-familia-minera.jpg?v=20260923ae',
  NULL,
  true,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_promos
  WHERE imagem_url LIKE '%banner-familia-minera.jpg%'
);
