-- =====================================================================
-- MINERA PARÁ - 42 Comissão 1% pause + vaquinha Pix voluntária
-- Incremental. Idempotente. NÃO DROP. NÃO wipe.
-- Seed ONLY if missing (ON CONFLICT DO NOTHING) — admin toggles persist.
-- Flags:
--   comissao_1pct_ativa  default false (pausada no lançamento)
--   vaquinha_ativa       default true  (Pix voluntário Perfil)
-- Depende de public.app_flags (SQL 35).
-- =====================================================================

INSERT INTO public.app_flags (key, value_bool, value_text)
VALUES
  ('comissao_1pct_ativa', false, 'Pausada no lançamento — religar no Admin'),
  ('vaquinha_ativa', true, 'Pix voluntário de qualquer valor')
ON CONFLICT (key) DO NOTHING;
