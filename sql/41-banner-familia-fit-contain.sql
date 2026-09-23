-- =====================================================================
-- MINERA PARÁ - 41 Banner Família Minera: URL com cache-bust (fit contain)
-- Incremental. Idempotente. NÃO DROP.
-- Arte regenerada 1600×600 (16:6) com letterbox — sem cortar o conteúdo.
-- =====================================================================

UPDATE public.app_promos
SET
  imagem_url = 'media/banner-familia-minera.jpg?v=20260923ae',
  updated_at = now()
WHERE imagem_url LIKE '%banner-familia-minera.jpg%';

-- Se ainda não existir o seed (SQL 40), cria com a URL nova
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
