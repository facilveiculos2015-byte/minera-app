-- =====================================================================
-- MINERA APP - 08 papéis, tipo_minerio, fretes
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- Rodar no SQL Editor do Supabase após 06/07. NÃO wipe.
-- =====================================================================

-- 1) usuarios.papeis (múltiplos papéis)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS papeis TEXT[] DEFAULT '{}';

-- Backfill leve: admin legado → papeis inclui admin; operador vazio fica []
UPDATE usuarios
SET papeis = ARRAY['admin']::TEXT[]
WHERE (tipo = 'admin')
  AND (papeis IS NULL OR papeis = '{}');

-- 2) lotes.tipo_minerio (filtro do feed)
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS tipo_minerio TEXT;

CREATE INDEX IF NOT EXISTS idx_lotes_tipo_minerio ON lotes(tipo_minerio);
CREATE INDEX IF NOT EXISTS idx_lotes_status_tipo ON lotes(status, tipo_minerio);

-- 3) Tabela fretes (duas pernas: mina→britador, britador→porto)
CREATE TABLE IF NOT EXISTS fretes (
    id SERIAL PRIMARY KEY,
    lote_id INT REFERENCES lotes(id),
    perna TEXT CHECK (perna IN ('mina_britador', 'britador_porto')),
    origem TEXT,
    destino TEXT,
    veiculo TEXT,
    motorista TEXT,
    peso_kg NUMERIC,
    status TEXT DEFAULT 'agendado' CHECK (status IN ('agendado', 'em_transito', 'concluido', 'cancelado')),
    observacoes TEXT,
    criado_por TEXT,
    criado_por_id UUID,
    criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fretes_lote ON fretes(lote_id);
CREATE INDEX IF NOT EXISTS idx_fretes_status ON fretes(status);
CREATE INDEX IF NOT EXISTS idx_fretes_criado ON fretes(criado_em DESC);

-- 4) RLS fretes
ALTER TABLE fretes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fretes_select_auth" ON fretes;
DROP POLICY IF EXISTS "fretes_insert_auth" ON fretes;
DROP POLICY IF EXISTS "fretes_update_auth" ON fretes;

CREATE POLICY "fretes_select_auth" ON fretes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "fretes_insert_auth" ON fretes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fretes_update_auth" ON fretes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 5) Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE fretes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE usuarios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE lotes TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE fretes_id_seq TO authenticated;

-- Nota app:
-- - Cadastro/Perfil grava usuarios.papeis (TEXT[])
-- - Lotes/feed usam lotes.tipo_minerio
-- - Tela Frete → tabela fretes
