-- =====================================================================
-- MINERA PARÁ — 59 Storage "chat-midia" PRIVADO
-- Transacional · idempotente · não apaga nenhum arquivo nem mensagem.
--
-- APLICAR SÓ DEPOIS que o app com build 20261004a (ou mais novo) estiver no ar:
-- o app novo abre fotos/áudios/vídeos/documentos por link assinado (válido por horas),
-- e funciona tanto antes quanto depois deste SQL.
--
-- Depois deste SQL:
--  - O link público antigo (/object/public/chat-midia/...) deixa de abrir para qualquer um.
--  - Mídia do CHAT (pastas imagens/, audios/, videos/, docs/): só quem enviou, quem recebeu
--    (DM), membros do grupo e o admin conseguem abrir. Mensagens antigas continuam funcionando
--    (o app troca o link antigo por um assinado na hora).
--  - Fotos/vídeos de ANÚNCIOS (pasta lotes/) e imagens de BANNER do Início (pasta banners/):
--    qualquer usuário logado abre (são públicas dentro do app).
--  - Para voltar atrás: UPDATE storage.buckets SET public = true WHERE id = 'chat-midia';
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.chat_midia_pode_ler(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_dono text := split_part(COALESCE(p_name, ''), '/', 1);
  v_pasta text := split_part(COALESCE(p_name, ''), '/', 2);
  v_dono_uuid uuid;
BEGIN
  IF uid IS NULL OR p_name IS NULL OR p_name = '' THEN
    RETURN false;
  END IF;
  IF v_dono = uid::text THEN
    RETURN true;                                  -- quem enviou
  END IF;
  IF v_pasta IN ('lotes', 'banners') THEN
    RETURN true;                                  -- mídia de anúncio / banner do Início
  END IF;
  IF public.is_admin() THEN
    RETURN true;
  END IF;
  BEGIN
    v_dono_uuid := v_dono::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN EXISTS (
    SELECT 1
      FROM public.chat_mensagens m
     WHERE m.de_auth_id = v_dono_uuid
       AND m.midia_url IS NOT NULL
       AND position(('/chat-midia/' || p_name) IN m.midia_url) > 0
       AND (
             m.para_auth_id = uid
          OR (m.grupo_id IS NOT NULL AND public.chat_grupo_ve_msg(m.grupo_id, m.criado_em))
       )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_midia_pode_ler(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_midia_pode_ler(text) TO authenticated, service_role;

-- Leitura: troca a policy pública por participantes/admin
DROP POLICY IF EXISTS chat_midia_public_select ON storage.objects;
DROP POLICY IF EXISTS chat_midia_select_participantes ON storage.objects;
CREATE POLICY chat_midia_select_participantes ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-midia' AND public.chat_midia_pode_ler(name));

-- Bucket privado (o link /object/public/ para de funcionar)
UPDATE storage.buckets SET public = false WHERE id = 'chat-midia';

COMMIT;

-- Conferir:
-- SELECT id, public FROM storage.buckets WHERE id = 'chat-midia';
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'chat_midia%';
