Ordem de execução no Supabase SQL Editor (incremental, NÃO wipe):
… → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17-rls-isolamento.sql → 18-chat-contatos-dms.sql → 19-fixes.sql → 20-cleanup-teste.sql → 21-chat-diretorio-rpc.sql → 22-chat-diretorio-sem-email.sql → 23-admin-emprestimos.sql → 24-chat-midia-storage.sql → 25-ensure-admin.sql → 26-lotes-publicado-como.sql → 27-chat-audio-fix.sql → 28-chat-msg-acoes.sql

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
O SQL 20 limpa dados de teste e mantém o admin e o operador de teste. O SQL 21 cria os RPCs `chat_diretorio()` e `chat_buscar_nome(text)` como `SECURITY DEFINER` (campos públicos sem e-mail). Se 21 já foi aplicado com e-mail, rode o SQL 22 que sobrescreve.
**Parent deve aplicar o SQL 21 no Supabase SQL Editor após 20, depois o 22.**


## 22-chat-diretorio-sem-email.sql
Incremental após 21: `usuarios.apelido`; RPCs `chat_diretorio()`, `chat_buscar_nome(text)`, `chat_perfis_publicos(uuid[])` **sem e-mail** (anti-golpe). DROP de `chat_buscar_email`. Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 22 no Supabase SQL Editor após 21.**


## 23-admin-emprestimos.sql
Incremental após 22: RLS empréstimos (SELECT own/admin, INSERT own, **UPDATE só admin**); RPCs `admin_listar_emprestimos(limit)` e `admin_contar_emprestimos_pendentes()` (SECURITY DEFINER + `is_admin()`). Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 23 no Supabase SQL Editor após 22.**
Corrige admin sem ver pedidos de outros usuários / sem poder liberar crédito.

## 24-chat-midia-storage.sql
Incremental após 23: cria/atualiza bucket Storage público `chat-midia` + policies SELECT público / INSERT·UPDATE·DELETE authenticated. Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 24 no Supabase SQL Editor após 23.**
Necessário para áudio/imagem/vídeo do chat tocáveis por outros usuários (sem depender só de data-URL).


## 25-ensure-admin.sql
Incremental após 24: garante `tipo='admin'` e `papeis` contendo `'admin'` para `facilveiculos2015@gmail.com` (UPSERT por e-mail/`auth_id` via `auth.users`). Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 25 no Supabase SQL Editor após 24.**
Corrige admin que passa a ser tratado como operador (ex.: upsert de login sem papéis).


## 26-lotes-publicado-como.sql
Incremental após 24/25: `lotes.publicado_como` + garante bucket `chat-midia` (fotos em `lotes/`). Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 26 no Supabase SQL Editor se ainda não rodou.**

## 27-chat-audio-fix.sql
Incremental após 24 (e 26 se aplicável): **repara** bucket Storage `chat-midia` — `public=true`, `allowed_mime_types=NULL`, file_size ≥ 10MB, policies SELECT público + INSERT/UPDATE/DELETE authenticated. Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 27 no Supabase SQL Editor (obrigatório para áudio do chat sem 403).**
Corrige playback 403 (bucket privado), upload rejeitado por MIME, e policies faltando/renomeadas no dashboard.




## 28-chat-msg-acoes.sql
Incremental após 27: colunas `resposta_a_id`, `apagada_para`; tabela `chat_conversas_ocultas`; RLS/trigger; RPCs
`chat_apagar_historico_para_todos`, `chat_apagar_para_mim`, `chat_apagar_para_todos`, `chat_desocultar_conversa`, `chat_ocultar_conversa`.
Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 28 no Supabase SQL Editor após 27.**
Habilita Responder / Apagar para mim / Apagar para todos / Apagar histórico no chat.


## 30-admin-credito.sql
Incremental após 29: estende `emprestimos` com KYC (endereco, empresa, anos_empresa, comprova_renda), URLs de docs, `vencimento`, `pago_em`, `questionario`; bucket Storage privado `emprestimo-docs` (upload na pasta do próprio auth_id; admin lê); RPCs `admin_listar_emprestimos` (filas/dias), `admin_credito_kpis`, `admin_gerar_alertas_credito`, `admin_listar_alertas`, `admin_contar_alertas_nao_lidos`, `admin_marcar_alerta_lido`; tabela `admin_alertas`. Idempotente. NÃO wipe.
**Parent deve aplicar o SQL 30 no Supabase SQL Editor após 29.**
Necessário para mesa de crédito admin, wizard KYC do Caixa e alertas de vencimento/atraso.
