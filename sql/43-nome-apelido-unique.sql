-- =====================================================================
-- MINERA PARÁ - 43 Unicidade (nome + apelido) case-insensitive
-- Incremental. Idempotente. NÃO DROP de tabelas. NÃO wipe.
-- Motivo: busca/adicionar no chat não pode confundir pessoas.
-- Regra: lower(trim(nome)) + lower(trim(coalesce(apelido,''))) únicos.
-- Mesmo usuário pode manter o próprio par (exclusão por auth_id / id).
-- =====================================================================

-- 0) Garante coluna apelido
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS apelido TEXT;

-- 1) Relatório de duplicatas pré-existentes (NOTICE no SQL Editor)
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  RAISE NOTICE '=== Duplicatas nome+apelido (antes da correção) ===';
  FOR r IN
    SELECT
      lower(trim(u.nome)) AS nkey,
      lower(trim(coalesce(u.apelido, ''))) AS akey,
      count(*) AS qtd,
      array_agg(u.id ORDER BY u.id) AS ids,
      array_agg(u.auth_id::text ORDER BY u.id) AS auth_ids
    FROM public.usuarios u
    WHERE u.nome IS NOT NULL AND length(trim(u.nome)) > 0
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    n := n + 1;
    RAISE NOTICE 'dup #%: nome=% apelido=% qtd=% ids=% auth_ids=%',
      n, r.nkey, r.akey, r.qtd, r.ids, r.auth_ids;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'Nenhuma duplicata encontrada.';
  ELSE
    RAISE NOTICE 'Total de grupos duplicados: %', n;
  END IF;
END $$;

-- 2) Correção segura: mantém o menor id; demais recebem sufixo estável do id
--    Ex.: apelido "João" → "João ·u42" (ou "·u42" se apelido vazio)
UPDATE public.usuarios u
SET apelido = trim(both FROM
  CASE
    WHEN nullif(trim(coalesce(u.apelido, '')), '') IS NULL
      THEN '·u' || u.id::text
    ELSE trim(u.apelido) || ' ·u' || u.id::text
  END
)
FROM (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(trim(nome)), lower(trim(coalesce(apelido, '')))
      ORDER BY id ASC
    ) AS rn
  FROM public.usuarios
  WHERE nome IS NOT NULL AND length(trim(nome)) > 0
) d
WHERE u.id = d.id
  AND d.rn > 1;

-- 3) Índice único case-insensitive em nome+apelido (trim)
--    Não usa CONCURRENTLY (SQL Editor roda em transação)
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_nome_apelido_lower_uidx
  ON public.usuarios (
    lower(trim(nome)),
    lower(trim(coalesce(apelido, '')))
  )
  WHERE nome IS NOT NULL AND length(trim(nome)) > 0;

COMMENT ON INDEX public.usuarios_nome_apelido_lower_uidx IS
  'Unicidade pública nome+apelido (lower/trim) para não confundir no chat.';

-- 4) RPC: disponibilidade (exclui o próprio auth_id no update)
CREATE OR REPLACE FUNCTION public.nome_apelido_disponivel(
  p_nome text,
  p_apelido text DEFAULT NULL,
  p_exclude_auth_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_nome IS NULL OR length(trim(p_nome)) = 0 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.nome IS NOT NULL
        AND length(trim(u.nome)) > 0
        AND lower(trim(u.nome)) = lower(trim(p_nome))
        AND lower(trim(coalesce(u.apelido, ''))) = lower(trim(coalesce(p_apelido, '')))
        AND (p_exclude_auth_id IS NULL OR u.auth_id IS DISTINCT FROM p_exclude_auth_id)
    )
  END;
$$;

COMMENT ON FUNCTION public.nome_apelido_disponivel(text, text, uuid) IS
  'true se o par nome+apelido (case-insensitive, trim) está livre; exclui p_exclude_auth_id.';

REVOKE ALL ON FUNCTION public.nome_apelido_disponivel(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nome_apelido_disponivel(text, text, uuid) TO anon, authenticated;

-- 5) Trigger: mensagem PT amigável antes do índice (defesa em profundidade)
CREATE OR REPLACE FUNCTION public.tg_usuarios_nome_apelido_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.nome IS NULL OR length(trim(NEW.nome)) = 0 THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id IS DISTINCT FROM NEW.id
      AND u.nome IS NOT NULL AND length(trim(u.nome)) > 0
      AND lower(trim(u.nome)) = lower(trim(NEW.nome))
      AND lower(trim(coalesce(u.apelido, ''))) = lower(trim(coalesce(NEW.apelido, '')))
  ) THEN
    RAISE EXCEPTION 'Já existe alguém com este nome e apelido. Escolha outro apelido.'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_nome_apelido_unique ON public.usuarios;
CREATE TRIGGER trg_usuarios_nome_apelido_unique
  BEFORE INSERT OR UPDATE OF nome, apelido ON public.usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_usuarios_nome_apelido_unique();

-- Nota: em PG < 14 use EXECUTE PROCEDURE em vez de EXECUTE FUNCTION se necessário.
-- Supabase (PG15+) aceita EXECUTE FUNCTION.
