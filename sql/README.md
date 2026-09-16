Ordem de execução no Supabase SQL Editor (incremental, NÃO wipe):
… → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17-rls-isolamento.sql → 18-chat-contatos-dms.sql → 19-fixes.sql → 20-cleanup-teste.sql → 21-chat-diretorio-rpc.sql

## 10-chat-pix-admin.sql
Chat: tipo, midia_url, agendado_para, para_auth_id, status, moderacao, deleted_at.
Pix: pix_admin, pix_pagamentos + RLS.
Criar bucket Storage público `chat-midia` no dashboard se quiser upload.
Primeiro admin: UPDATE usuarios SET tipo='admin', papeis=array_append(COALESCE(papeis,'{}'),'admin') WHERE email='...';

## 11-mapa-coords.sql
lotes.lat / lotes.lng (opcional) para marcadores no Mapa de Satélite. Idempotent.

## 12-comissoes.sql → 13-bloqueio-cotacoes.sql → 14-caixa-emprestimos.sql → 15-caixa-depositos-saques-pin.sql
Tabela `comissoes` (1% venda → pendente/pago) + RLS. Idempotent. NÃO wipe.

## Pix estático (app) + futuro Nubank API
O front gera EMV Copia e Cola + QR (`pix-brcode.js`) a partir de `pix_admin`.
Plano API dinâmica / webhook: ver `docs/nubank-pix-api-plan.md` (fora de escopo agora).

## 13-bloqueio-cotacoes.sql
Incremental: usuarios.bloqueado / bloqueado_motivo / bloqueado_em; tabela cotacoes_historico + RLS. Idempotente. NÃO wipe.

## 14-caixa-emprestimos.sql
Tabelas `emprestimos`, `caixa_saldos`, `caixa_movimentos` + RLS authenticated (select/insert/update). Idempotente. NÃO wipe.
Caixa Minera (saldo + movimentos) e solicitações de empréstimo (status analise|aprovado|rejeitado|pago, juros 15%).

## 15-caixa-depositos-saques-pin.sql
Incremental após 14: `caixa_deposito_pedidos`, `caixa_saque_pedidos`; `caixa_saldos.pin_hash` / `pin_salt` / `taxa_yield_max` (até 5% a.m.); RLS authenticated. Idempotente. NÃO wipe.
Caixa: depósito Pix (comprovante → admin confirma), saque (chave destino → admin processa/debita), PIN separado do login.

## 17-rls-isolamento.sql
Incremental: `public.is_admin()` + RLS por perfil (usuarios/caixa/comissoes/emprestimos/suporte/pix/indicacao). Lotes feed SELECT auth; mutação own/admin. Chat soft-delete own/admin. `processar_indicacao()` RPC para indicação sem cross-UPDATE. Idempotente. NÃO wipe.
**Parent deve aplicar no Supabase SQL Editor após 16.**


## 18-chat-contatos-dms.sql
Incremental após 17: `chat_contatos`, `chat_leituras`; RLS chat só participante/admin (quebra broadcast); RPCs `chat_diretorio`, `chat_buscar_email`, `chat_perfis_publicos`. Idempotente. NÃO wipe.
**Parent deve aplicar no Supabase SQL Editor após 17.**

## 19-fixes.sql
Incremental após 18: RLS chat INSERT exige `para_auth_id` (DM real); SELECT esconde `agendada` do destinatário; trigger trava `de_auth_id`/`para_auth_id` no UPDATE. Idempotente. NÃO wipe.
**Parent deve aplicar no Supabase SQL Editor após 18.**


## 20-cleanup-teste.sql → 21-chat-diretorio-rpc.sql
O SQL 20 limpa dados de teste e mantém o admin e o operador de teste. O SQL 21 cria os RPCs `chat_diretorio()` e `chat_buscar_email(text)` como `SECURITY DEFINER`, permitindo ao chat consultar os perfis públicos de todos os usuários autenticados (exceto o próprio) mesmo com o isolamento de RLS em `usuarios`.
**Parent deve aplicar o SQL 21 no Supabase SQL Editor após 20.**
