-- Testes do SQL 48 — rode DEPOIS do 48 (SQL Editor ou psql). Tudo em BEGIN … ROLLBACK: não grava nada.
-- Saída esperada: tabela com 25 PASS e 0 FAIL. Verificado em PostgreSQL 17 + shim do Supabase (auth.uid, storage).
BEGIN;
CREATE TEMP TABLE r (n serial, teste text, ok boolean, detalhe text);
GRANT ALL ON r TO authenticated, anon; GRANT ALL ON SEQUENCE r_n_seq TO authenticated, anon;
CREATE OR REPLACE FUNCTION pg_temp.chk(t text, cond boolean, d text DEFAULT '') RETURNS void LANGUAGE sql AS
$$ INSERT INTO r (teste, ok, detalhe) VALUES (t, COALESCE(cond,false), d) $$;

-- usuário A
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- T1 exemplo embutido (por ponto, base TMS)
INSERT INTO gf_carradas (id, minerio, placa, peso_bruto_kg, tara_kg, umidade_pct, teor, preco_modo, peso_base, preco_ponto, frete_unit, carregamento_unit, auth_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Manganês','qwe 1a23',45000,15000,8,40,'ponto','tms',10,60,8,
        '99999999-9999-9999-9999-999999999999');  -- tenta spoofar dono
SELECT pg_temp.chk('T1 exemplo: TU/TMS/preço/venda/frete/carreg/lucro',
  (peso_umido_t, peso_seco_t, preco_t, valor_venda, frete_total, carregamento_total, lucro)
  = (30.0000, 27.6000, 400.0000, 11040.00, 1800.00, 240.00, 9000.00),
  format('%s TU %s TMS %s R$/t venda %s frete %s carreg %s lucro %s', peso_umido_t, peso_seco_t, preco_t, valor_venda, frete_total, carregamento_total, lucro))
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

-- T5 base TU, franquia, preço por tonelada, total, frete por viagem, ajuste
INSERT INTO gf_carradas (id, peso_liquido_kg, umidade_pct, teor, preco_ponto, peso_base) VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 30000, 8, 40, 10, 'tu');
SELECT pg_temp.chk('T5a base TU: 30 t × 400 = 12000', peso_pago_t=30 AND valor_venda=12000, valor_venda::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
UPDATE gf_carradas SET umidade_franquia_pct=6 WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
SELECT pg_temp.chk('T5b franquia 6 %: 30×(1−0,02)=29,4 t × 400 = 11760', peso_pago_t=29.4 AND valor_venda=11760, valor_venda::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
UPDATE gf_carradas SET umidade_franquia_pct=NULL, preco_modo='tonelada', preco_t_informado=350, peso_base='tms', ajuste=-100, frete_base='viagem', frete_unit=1500 WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
SELECT pg_temp.chk('T5c por tonelada 27,6×350−100 = 9560; frete viagem 1500; lucro 8060', valor_venda=9560 AND frete_total=1500 AND lucro=8060, format('%s %s %s', valor_venda, frete_total, lucro)) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
UPDATE gf_carradas SET preco_modo='total', valor_informado=10000, ajuste=0 WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
SELECT pg_temp.chk('T5d valor total 10000', valor_venda=10000 AND preco_t IS NULL, valor_venda::text) FROM gf_carradas WHERE id='aaaaaaaa-0000-0000-0000-000000000002';

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
UPDATE gf_carradas SET lucro=1 WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
DO $$ BEGIN
  BEGIN INSERT INTO gf_lancamentos (tipo, valor, carrada_id) VALUES ('saida', 10, 'aaaaaaaa-0000-0000-0000-000000000001');
        PERFORM pg_temp.chk('T9c B não vincula despesa à carrada de A', false);
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.chk('T9c B não vincula despesa à carrada de A', true, SQLERRM); END;
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
SELECT pg_temp.chk('T12 bucket privado', NOT public) FROM storage.buckets WHERE id='gestor-docs';

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS res, teste, detalhe FROM r ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail FROM r;
ROLLBACK;
