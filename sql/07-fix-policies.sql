-- =====================================================================
-- MINERA APP - 07 fix policies restantes (após falha em proc_update_auth)
-- Idempotente
-- =====================================================================

DROP POLICY IF EXISTS "proc_update_auth" ON processamento;
DROP POLICY IF EXISTS "estoque_select_auth" ON estoque;
DROP POLICY IF EXISTS "estoque_insert_auth" ON estoque;
DROP POLICY IF EXISTS "estoque_update_auth" ON estoque;
DROP POLICY IF EXISTS "expedicao_select_auth" ON expedicao;
DROP POLICY IF EXISTS "expedicao_insert_auth" ON expedicao;
DROP POLICY IF EXISTS "logs_select_auth" ON logs_sistema;
DROP POLICY IF EXISTS "logs_insert_auth" ON logs_sistema;
DROP POLICY IF EXISTS "chat_select_auth" ON chat_mensagens;
DROP POLICY IF EXISTS "chat_insert_auth" ON chat_mensagens;

CREATE POLICY "proc_update_auth" ON processamento
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "estoque_select_auth" ON estoque
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "estoque_insert_auth" ON estoque
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "estoque_update_auth" ON estoque
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "expedicao_select_auth" ON expedicao
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "expedicao_insert_auth" ON expedicao
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "logs_select_auth" ON logs_sistema
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "logs_insert_auth" ON logs_sistema
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "chat_select_auth" ON chat_mensagens
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "chat_insert_auth" ON chat_mensagens
  FOR INSERT TO authenticated WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE usuarios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE lotes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE processamento TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE estoque TO authenticated;
GRANT SELECT, INSERT ON TABLE expedicao TO authenticated;
GRANT SELECT, INSERT ON TABLE logs_sistema TO authenticated;
GRANT SELECT, INSERT ON TABLE chat_mensagens TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE chat_mensagens_id_seq TO authenticated;
