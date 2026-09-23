-- =====================================================================
-- MINERA PARÁ - 40 Seed banner Família Minera (manageability)
-- Incremental. Idempotente. NÃO DROP. NÃO wipe.
-- Depende de public.app_promos (SQL 35).
-- O app já tem fallback em código se a tabela estiver vazia;
-- este seed só permite admin desativar/apagar/editar o banner padrão.
-- =====================================================================

INSERT INTO public.app_promos (tipo, titulo, texto, imagem_url, link, ativo, ordem)
SELECT
  'banner',
  NULL,
  NULL,
  'media/banner-familia-minera.jpg',
  NULL,
  true,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_promos
  WHERE imagem_url LIKE '%banner-familia-minera.jpg%'
);
