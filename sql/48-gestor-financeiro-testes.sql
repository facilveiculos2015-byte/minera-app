-- Testes do SQL 48 — rode DEPOIS do 48 (SQL Editor ou psql). Tudo em BEGIN … ROLLBACK: não grava nada.
-- Saída esperada: todas as linhas PASS e 0 FAIL. Verificado em PostgreSQL 17 + shim do Supabase (auth.uid, storage).
BEGIN;
CREATE TEMP TABLE r (n serial, teste text, ok boolean, detalhe text);
GRANT ALL ON r TO authenticated, anon; GRANT ALL ON SEQUENCE r_n_seq TO authenticated, anon;
CREATE OR REPLACE FUNCTION pg_temp.chk(t text, cond boolean, d text DEFAULT '') RETURNS void LANGUAGE sql AS
$$ INSERT INTO r (teste, ok, detalhe) VALUES (t, COALESCE(cond,false), d) $$;

-- usuário A
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- T1 exemplo embutido (por ponto, base TMS)
INSERT INTO gf_carradas (id, minerio, placa, peso_bruto_kg, tara_kg, umidade_pct, teor, preco_modo, preco_ponto, frete_unit, carregamento_unit, auth_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Manganês','qwe 1a23',45000,15000,8,40,'ponto',10,60,8,
        '99999999-9999-9999-9999-999999999999');  -- tenta spoofar dono
SELECT pg_temp.chk('T1 exemplo: líquido/seco/preço/venda/frete/carreg/lucro',
  (peso_umido_t, peso_seco_t, preco_t, valor_venda, frete_total, carregamento_total, lucro)
  = (30.0000, 27.6000, 400.0000, 11040.00, 1800.00, 240.00, 9000.00),
  format('%s t líq %s t seco %s R$/t venda %s frete %s carreg %s lucro %s', peso_umido_t, peso_seco_t, preco_t, valor_venda, frete_total, carregamento_total, lucro))
FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.chk('T2 auth_id forçado = auth.uid() (spoof ignorado) + placa normalizada',
  auth_id = '11111111-1111-1111-1111-111111111111' AND placa='QWE1A23', auth_id::text||' '||placa)
FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';

-- T3 custo + imposto + despesa vinculada (exemplo 2 mostrado na UI)
UPDATE gf_carradas SET custo_minerio=3000, impostos_pct=2 WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO gf_lancamentos (id, tipo, valor, categoria_id, descricao, observacao, carrada_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','saida',500,(SELECT id FROM gf_categorias WHERE slug='diesel' AND auth_id IS NULL),'Diesel ida','posto km 12','aaaaaaaa-0000-0000-0000-000000000001');
SELECT pg_temp.chk('T3 despesa vinculada entra no lucro (9000−3000−220,80−500 = 5279,20)',
  impostos_total=220.80 AND despesas_total=500 AND lucro=5279.20, format('imp %s desp %s lucro %s', impostos_total, despesas_total, lucro))
FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';

-- T4 finalizar carimba hora; editar despesa recalcula; soft delete tira do lucro
UPDATE gf_carradas SET status='finalizada' WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
UPDATE gf_lancamentos SET valor=600 WHERE id='bbbbbbbb-0000-0000-0000-000000000001';
SELECT pg_temp.chk('T4a finalizada_em + recálculo ao editar despesa', finalizada_em IS NOT NULL AND despesas_total=600 AND lucro=5179.20, format('%s %s', despesas_total, lucro))
FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
UPDATE gf_lancamentos SET deleted_at=now() WHERE id='bbbbbbbb-0000-0000-0000-000000000001';
SELECT pg_temp.chk('T4b soft delete da despesa sai do lucro', despesas_total=0 AND lucro=5779.20, lucro::text)
FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
UPDATE gf_carradas SET status='aberta' WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.chk('T4c reabrir limpa finalizada_em', finalizada_em IS NULL) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';

-- T5 preço sempre no peso seco (colunas legadas ignoradas), tonelada, total, viagem, ajuste
INSERT INTO gf_carradas (id, peso_liquido_kg, umidade_pct, teor, preco_ponto, peso_base, umidade_franquia_pct) VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 30000, 8, 40, 10, 'tu', 6);
SELECT pg_temp.chk('T5a legado peso_base=tu/franquia ignorados: 27,6 t seco × 400 = 11040', peso_pago_t=27.6 AND valor_venda=11040 AND peso_base='tms' AND umidade_franquia_pct IS NULL, valor_venda::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
UPDATE gf_carradas SET umidade_pct=0 WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
SELECT pg_temp.chk('T5b umidade 0 → seco = líquido (30 × 400 = 12000)', peso_seco_t=30 AND valor_venda=12000, valor_venda::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
UPDATE gf_carradas SET umidade_pct=8, preco_modo='tonelada', preco_t_informado=350, ajuste=-100, frete_base='viagem', frete_unit=1500 WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
SELECT pg_temp.chk('T5c por tonelada 27,6×350−100 = 9560; frete viagem 1500; lucro 8060', valor_venda=9560 AND frete_total=1500 AND lucro=8060, format('%s %s %s', valor_venda, frete_total, lucro)) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
UPDATE gf_carradas SET preco_modo='total', valor_informado=10000, ajuste=0 WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
SELECT pg_temp.chk('T5d valor total 10000', valor_venda=10000 AND preco_t IS NULL, valor_venda::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';

-- T13 tabela de preço: salvar (RPC), editar, faixa, carrada usando a tabela
SELECT pg_temp.chk('T13a salvar tabela c/ 4 linhas',
  jsonb_array_length(gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"Siderúrgica X – Mn","minerio":"Manganês","modo":"ponto"}',
    '[{"teor":30,"valor":8},{"teor":35,"valor":9},{"teor":40,"valor":10},{"teor":45,"valor":11}]')->'linhas') = 4);
SELECT pg_temp.chk('T13b salvar de novo (idempotente) e editar linhas: troca p/ 3 linhas',
  jsonb_array_length(gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"Siderúrgica X – Mn","modo":"ponto"}',
    '[{"teor":35,"valor":9},{"teor":40,"valor":10},{"teor":45,"valor":11}]')->'linhas') = 3
  AND (SELECT count(*) FROM gf_tabelas_preco WHERE id='cccccccc-0000-0000-0000-000000000001') = 1
  AND (SELECT auth_id FROM gf_tabelas_preco_linhas LIMIT 1) = auth.uid());
SELECT pg_temp.chk('T13c faixa: teor 42 → linha 40 (R$ 10); 40 exato → 40; 50 → 45; 30 → nada',
  (SELECT teor FROM gf_preco_lookup('cccccccc-0000-0000-0000-000000000001', 42)) = 40
  AND (SELECT valor FROM gf_preco_lookup('cccccccc-0000-0000-0000-000000000001', 40)) = 10
  AND (SELECT teor FROM gf_preco_lookup('cccccccc-0000-0000-0000-000000000001', 50)) = 45
  AND NOT EXISTS (SELECT 1 FROM gf_preco_lookup('cccccccc-0000-0000-0000-000000000001', 30)));
INSERT INTO gf_carradas (id, peso_bruto_kg, tara_kg, umidade_pct, teor, preco_modo, preco_ponto, tabela_id, tabela_teor_ref, frete_unit, carregamento_unit)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 45000, 15000, 8, 42, 'ponto', 10, 'cccccccc-0000-0000-0000-000000000001', 40, 60, 8);
SELECT pg_temp.chk('T13d carrada teor 42 pela tabela: 10 × 42 = 420/t × 27,6 = 11592; lucro 9552', preco_t=420 AND valor_venda=11592 AND lucro=9552, format('%s %s %s', preco_t, valor_venda, lucro)) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000003';
DO $$ BEGIN
  BEGIN PERFORM gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"x"}', '[{"teor":40,"valor":1},{"teor":40,"valor":2}]');
        PERFORM pg_temp.chk('T13e teor repetido rejeitado', false);
  EXCEPTION WHEN unique_violation THEN PERFORM pg_temp.chk('T13e teor repetido rejeitado', true); END;
END $$;
SELECT gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"Siderúrgica X – Mn","deleted_at":"2026-10-01T12:00:00Z"}', NULL) IS NOT NULL AS excluiu;
SELECT pg_temp.chk('T13f excluir tabela (soft) → lookup vazio; carrada mantém preço',
  (SELECT deleted_at FROM gf_tabelas_preco WHERE id='cccccccc-0000-0000-0000-000000000001') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM gf_preco_lookup('cccccccc-0000-0000-0000-000000000001', 42))
  AND (SELECT valor_venda FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000003') = 11592);
SELECT pg_temp.chk('T13g desfazer exclusão da tabela', (gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"Siderúrgica X – Mn"}', NULL)->>'deleted_at') IS NULL
  AND jsonb_array_length(gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"Siderúrgica X – Mn"}', NULL)->'linhas') = 3);

-- T14 categoria do usuário: editar, excluir (arquivada) e recriar mesmo nome
INSERT INTO gf_categorias (id, nome, tipo, icone) VALUES ('dddddddd-0000-0000-0000-000000000001','Pneus','saida','🛞');
UPDATE gf_categorias SET nome='Pneus e câmaras' WHERE id='dddddddd-0000-0000-0000-000000000001';
UPDATE gf_categorias SET arquivada=true WHERE id='dddddddd-0000-0000-0000-000000000001';
INSERT INTO gf_categorias (nome, tipo) VALUES ('Pneus e câmaras','saida');
SELECT pg_temp.chk('T14 categoria editar/excluir(arquivar)/recriar', (SELECT count(*) FROM gf_categorias WHERE nome='Pneus e câmaras') = 2);

-- T6 erros esperados
DO $$ BEGIN
  BEGIN INSERT INTO gf_carradas (peso_bruto_kg, tara_kg) VALUES (1000, 2000);
        PERFORM pg_temp.chk('T6a tara > bruto rejeitado', false);
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.chk('T6a tara > bruto rejeitado', true, SQLERRM); END;
  BEGIN INSERT INTO gf_lancamentos (tipo, valor, comprovante_path) VALUES ('saida', 10, '22222222-2222-2222-2222-222222222222/x.jpg');
        PERFORM pg_temp.chk('T6b comprovante em pasta alheia rejeitado', false);
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.chk('T6b comprovante em pasta alheia rejeitado', true, SQLERRM); END;
  BEGIN INSERT INTO gf_lancamentos (tipo, valor) VALUES ('saida', 0);
        PERFORM pg_temp.chk('T6c valor 0 rejeitado', false);
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.chk('T6c valor 0 rejeitado', true); END;
  BEGIN UPDATE gf_carradas SET auth_id='22222222-2222-2222-2222-222222222222' WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
        PERFORM pg_temp.chk('T6d troca de dono rejeitada', false);
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN PERFORM pg_temp.chk('T6d troca de dono rejeitada', true, SQLERRM); END;
  BEGIN INSERT INTO gf_categorias (slug, nome, tipo) VALUES ('x','Minha cat','saida');
        PERFORM pg_temp.chk('T6e categoria própria ok', (SELECT auth_id FROM gf_categorias WHERE nome='Minha cat') = auth.uid());
  END;
  BEGIN UPDATE gf_categorias SET nome='hack' WHERE slug='diesel' AND auth_id IS NULL;
        PERFORM pg_temp.chk('T6f preset não editável', (SELECT nome FROM gf_categorias WHERE slug='diesel' AND auth_id IS NULL)='Diesel / combustível');
  END;
END $$;

-- T7 idempotência offline: upsert pelo mesmo id 2x não duplica
INSERT INTO gf_lancamentos (id, client_id, tipo, valor) VALUES ('bbbbbbbb-0000-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-000000000009','saida',50)
ON CONFLICT (id) DO UPDATE SET valor=EXCLUDED.valor;
INSERT INTO gf_lancamentos (id, client_id, tipo, valor) VALUES ('bbbbbbbb-0000-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-000000000009','saida',55)
ON CONFLICT (id) DO UPDATE SET valor=EXCLUDED.valor;
SELECT pg_temp.chk('T7 upsert offline idempotente', count(*)=1 AND max(valor)=55) FROM gf_lancamentos WHERE client_id='bbbbbbbb-0000-0000-0000-000000000009';

-- T8 storage: própria pasta ok
INSERT INTO storage.objects (bucket_id, name) VALUES ('gestor-docs','11111111-1111-1111-1111-111111111111/c1.jpg');
DO $$ BEGIN
  BEGIN INSERT INTO storage.objects (bucket_id, name) VALUES ('gestor-docs','22222222-2222-2222-2222-222222222222/x.jpg');
        PERFORM pg_temp.chk('T8 storage: upload em pasta alheia bloqueado', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk('T8 storage: upload em pasta alheia bloqueado', true, SQLERRM); END;
END $$;

-- usuário B
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SELECT pg_temp.chk('T9a B não vê carradas/lançamentos/fotos de A',
  (SELECT count(*) FROM gf_carradas)=0 AND (SELECT count(*) FROM gf_lancamentos)=0
  AND (SELECT count(*) FROM storage.objects WHERE bucket_id='gestor-docs')=0
  AND (SELECT count(*) FROM gf_categorias WHERE auth_id IS NOT NULL)=0);
SELECT pg_temp.chk('T9b B vê os presets', (SELECT count(*) FROM gf_categorias)=15);
SELECT pg_temp.chk('T9e B não vê tabelas/linhas de A', (SELECT count(*) FROM gf_tabelas_preco)=0 AND (SELECT count(*) FROM gf_tabelas_preco_linhas)=0
  AND NOT EXISTS (SELECT 1 FROM gf_preco_lookup('cccccccc-0000-0000-0000-000000000001', 42)));
UPDATE gf_carradas SET lucro=1 WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
DO $$ BEGIN
  BEGIN INSERT INTO gf_lancamentos (tipo, valor, carrada_id) VALUES ('saida', 10, 'aaaaaaaa-0000-0000-0000-000000000001');
        PERFORM pg_temp.chk('T9c B não vincula despesa à carrada de A', false);
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.chk('T9c B não vincula despesa à carrada de A', true, SQLERRM); END;
  BEGIN PERFORM gf_tabela_preco_salvar('{"id":"cccccccc-0000-0000-0000-000000000001","nome":"hack"}', '[]');
        PERFORM pg_temp.chk('T9f B não sobrescreve tabela de A', false);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN PERFORM pg_temp.chk('T9f B não sobrescreve tabela de A', true, SQLERRM); END;
  BEGIN INSERT INTO gf_carradas (tabela_id) VALUES ('cccccccc-0000-0000-0000-000000000001');
        PERFORM pg_temp.chk('T9g B não usa tabela de A na carrada', false);
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.chk('T9g B não usa tabela de A na carrada', true, SQLERRM); END;
  BEGIN INSERT INTO gf_tabelas_preco_linhas (tabela_id, teor, valor) VALUES ('cccccccc-0000-0000-0000-000000000001', 50, 99);
        PERFORM pg_temp.chk('T9h B não injeta linha na tabela de A', false);
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN PERFORM pg_temp.chk('T9h B não injeta linha na tabela de A', true, SQLERRM); END;
  BEGIN INSERT INTO gf_carradas (id, preco_ponto) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1) ON CONFLICT (id) DO UPDATE SET preco_ponto=1;
        PERFORM pg_temp.chk('T9d B não sobrescreve carrada de A via upsert', false);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN PERFORM pg_temp.chk('T9d B não sobrescreve carrada de A via upsert', true, SQLERRM); END;
END $$;

-- anon
RESET ROLE; SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
DO $$ BEGIN
  BEGIN PERFORM 1 FROM gf_carradas; PERFORM pg_temp.chk('T10 anon sem acesso', false);
  EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.chk('T10 anon sem acesso', true); END;
END $$;
RESET ROLE;
SELECT pg_temp.chk('T11 A continua intacto (lucro não mudou por B)', lucro=5779.20, lucro::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.chk('T15 tabela de A intacta após tentativas de B', (SELECT nome FROM gf_tabelas_preco WHERE id='cccccccc-0000-0000-0000-000000000001')='Siderúrgica X – Mn'
  AND (SELECT count(*) FROM gf_tabelas_preco_linhas WHERE tabela_id='cccccccc-0000-0000-0000-000000000001')=3);
SELECT pg_temp.chk('T12 bucket privado', NOT public) FROM storage.buckets WHERE id='gestor-docs';

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS res, teste, detalhe FROM r ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM r;
ROLLBACK;
