-- =====================================================================
-- MINERA APP - 20 Limpeza de dados de teste
-- Mantém: facilveiculos2015@gmail.com (admin) e teste.operador.minera@gmail.com
-- Preserva: schema, pix_admin (chave JeL), britagem_config
-- NÃO wipe de estrutura. Rodar após 18/19.
-- =====================================================================

-- Auth ids a manter (se existirem em usuarios)
CREATE TEMP TABLE keep_emails (email text);
INSERT INTO keep_emails VALUES
  ('facilveiculos2015@gmail.com'),
  ('teste.operador.minera@gmail.com');

-- Zerar dados operacionais / teste (ordem por FKs)
TRUNCATE TABLE chat_leituras RESTART IDENTITY CASCADE;
TRUNCATE TABLE chat_contatos RESTART IDENTITY CASCADE;
TRUNCATE TABLE chat_mensagens RESTART IDENTITY CASCADE;
TRUNCATE TABLE suporte_mensagens RESTART IDENTITY CASCADE;
TRUNCATE TABLE indicacao_pontos RESTART IDENTITY CASCADE;
TRUNCATE TABLE comissoes RESTART IDENTITY CASCADE;
TRUNCATE TABLE caixa_deposito_pedidos RESTART IDENTITY CASCADE;
TRUNCATE TABLE caixa_saque_pedidos RESTART IDENTITY CASCADE;
TRUNCATE TABLE caixa_movimentos RESTART IDENTITY CASCADE;
TRUNCATE TABLE emprestimos RESTART IDENTITY CASCADE;
TRUNCATE TABLE fretes RESTART IDENTITY CASCADE;
TRUNCATE TABLE processamento RESTART IDENTITY CASCADE;
TRUNCATE TABLE expedicao RESTART IDENTITY CASCADE;
TRUNCATE TABLE estoque RESTART IDENTITY CASCADE;
TRUNCATE TABLE logs_sistema RESTART IDENTITY CASCADE;
TRUNCATE TABLE cotacoes_historico RESTART IDENTITY CASCADE;
TRUNCATE TABLE lotes RESTART IDENTITY CASCADE;
TRUNCATE TABLE pix_pagamentos RESTART IDENTITY CASCADE;

-- Caixa: zerar saldos dos que ficam; apagar dos demais
DELETE FROM caixa_saldos
WHERE auth_id NOT IN (
  SELECT auth_id FROM usuarios WHERE lower(email) IN (SELECT lower(email) FROM keep_emails) AND auth_id IS NOT NULL
);
UPDATE caixa_saldos SET saldo = 0, atualizado_em = now();

-- Remover usuarios de teste (mantém os dois e-mails)
DELETE FROM usuarios
WHERE lower(email) NOT IN (SELECT lower(email) FROM keep_emails);

-- Reset pontos dos que ficam
UPDATE usuarios SET pontos_saldo = 0 WHERE lower(email) IN (SELECT lower(email) FROM keep_emails);

-- Nota: contas em auth.users dos testes podem sobrar no Auth;
-- apagar no Dashboard Authentication se quiser liberar e-mails.
-- pix_admin e britagem_config NÃO são tocados.

DROP TABLE IF EXISTS keep_emails;
