-- =====================================================================
-- MINERA PARÁ - 41 Banner Família Minera: fit contain + cache-bust
-- Incremental. Idempotente. NÃO DROP.
-- Arte 1600×600 (16:6) letterbox — sem cortar.
-- Troca JPG local e uploads Admin em Storage (.../banners/...).
-- NÃO mexe em ofertas nem em banners com outras URLs intencionais.
-- =====================================================================

UPDATE public.app_promos
SET
  imagem_url = 'media/banner-familia-minera.jpg?v=20260923ae',
  titulo = NULL,
  texto = NULL,
  updated_at = now()
WHERE tipo = 'banner'
  AND (
    imagem_url LIKE '%banner-familia-minera.jpg%'
    OR imagem_url LIKE '%/banners/%'
    OR imagem_url LIKE '%/storage/v1/object/public/chat-mid%'
  );

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
