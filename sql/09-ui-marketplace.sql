-- =====================================================================
-- MINERA APP - 09 UI Marketplace (preço, imagem, britagem_config, DELETE)
-- Idempotente. NÃO wipe. Rodar no SQL Editor após 08.
-- =====================================================================

-- Documentação papéis (usuarios.papeis TEXT[] já existe):
--   minerador
--   comprador
--   transportador_mina_britador
--   transportador_britador_porto
--   dono_britador
--   carregamento
--   admin
-- Legado: "transportador" no app mapeia para ambas as pernas de frete.

-- 1) lotes: preço + imagem_url
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS preco NUMERIC;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS imagem_url TEXT;

-- 2) britagem_config (single-row config preferida)
CREATE TABLE IF NOT EXISTS britagem_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    preco_por_ton NUMERIC DEFAULT 50,
    tempo_horas_lote NUMERIC DEFAULT 4,
    prazo_retirada_dias INT DEFAULT 3,
    atualizado_em TIMESTAMPTZ DEFAULT now()
);

INSERT INTO britagem_config (id, preco_por_ton, tempo_horas_lote, prazo_retirada_dias)
VALUES (1, 50, 4, 3)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE britagem_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "britagem_config_select_auth" ON britagem_config;
DROP POLICY IF EXISTS "britagem_config_insert_auth" ON britagem_config;
DROP POLICY IF EXISTS "britagem_config_update_auth" ON britagem_config;

CREATE POLICY "britagem_config_select_auth" ON britagem_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "britagem_config_insert_auth" ON britagem_config
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "britagem_config_update_auth" ON britagem_config
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3) lotes DELETE para autenticados
DROP POLICY IF EXISTS "lotes_delete_auth" ON lotes;
CREATE POLICY "lotes_delete_auth" ON lotes
  FOR DELETE TO authenticated USING (true);

-- 4) Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lotes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE britagem_config TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE usuarios TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Nota app:
-- - Feed mapeia: Disponível≈pendente, Em trânsito≈em_processo, Vendido≈expedido
-- - processado continua válido no DB; UI trata como necessário
-- - Meus Lotes filtra por criado_por_id / criado_por
