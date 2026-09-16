Ordem de execução no Supabase SQL Editor (incremental, NÃO wipe):
… → 08 → 09-ui-marketplace.sql → 10-chat-pix-admin.sql → 11-mapa-coords.sql → 12-comissoes.sql

## 10-chat-pix-admin.sql
Chat: tipo, midia_url, agendado_para, para_auth_id, status, moderacao, deleted_at.
Pix: pix_admin, pix_pagamentos + RLS.
Criar bucket Storage público `chat-midia` no dashboard se quiser upload.
Primeiro admin: UPDATE usuarios SET tipo='admin', papeis=array_append(COALESCE(papeis,'{}'),'admin') WHERE email='...';

## 11-mapa-coords.sql
lotes.lat / lotes.lng (opcional) para marcadores no Mapa de Satélite. Idempotent.

## 12-comissoes.sql
Tabela `comissoes` (1% venda → pendente/pago) + RLS. Idempotent. NÃO wipe.

## Pix estático (app) + futuro Nubank API
O front gera EMV Copia e Cola + QR (`pix-brcode.js`) a partir de `pix_admin`.
Plano API dinâmica / webhook: ver `docs/nubank-pix-api-plan.md` (fora de escopo agora).
