-- =====================================================================
-- MINERA PARÁ - 36 Share flags (frase padrão + OG image URL)
-- Incremental. Idempotente. Sem DROP. Prefere app_flags (SQL 35).
-- Rodar no Supabase SQL Editor APÓS 35.
-- =====================================================================

INSERT INTO public.app_flags (key, value_bool, value_text)
VALUES (
  'share_frase_padrao',
  NULL,
  'Cadastre-se no Minera Pará para negociar com mais segurança — cada um vê só a própria conta. Sem misturar perfis: o que é seu fica na sua área.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_flags (key, value_bool, value_text)
VALUES (
  'share_og_image_url',
  NULL,
  'https://facilveiculos2015-byte.github.io/minera-app/og-familia.png'
)
ON CONFLICT (key) DO NOTHING;

-- Fim 36
