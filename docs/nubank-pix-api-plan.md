# Plano futuro: Nubank Empresas Pix API

**Status:** fora de escopo agora. O app usa Pix **estático** (Copia e Cola / QR gerado no browser a partir de `pix_admin.chave_pix`).

## Objetivo
Automatizar cobrança e confirmação de comissões: criar cobrança (cob), exibir QR dinâmico, receber webhook e marcar `comissoes.status = 'pago'` sem comprovante manual.

## Pré-requisitos (Nubank Empresas / Open Finance / PSP)
- CNPJ da empresa (JeL empreendimentos ou titular operacional)
- Conta Nubank Empresas (ou PSP parceiro) com Pix habilitado
- `client_id` / `client_secret` (OAuth2)
- Certificados mTLS (quando exigidos pelo provedor)
- URL pública de webhook (HTTPS) — ex.: Edge Function / Cloud Function

## Fluxo sugerido
1. Seller clica **Pagar via Pix** numa comissão pendente.
2. Backend cria cobrança Pix (`cob`) com `valor = valor_comissao`, `txid` amarrado a `comissoes.id`.
3. App exibe `pixCopiaECola` / QR retornados pela API (não o EMV estático local).
4. Webhook `pix.payment` / equivalente → valida assinatura → `UPDATE comissoes SET status='pago'` (+ opcional `pix_pagamentos`).
5. UI atualiza lista de pendentes.

## Escopo atual (MVP)
- EMV estático em `pix-brcode.js` + QR no browser (CDN).
- Usuário envia comprovante (URL) em `pix_pagamentos`; admin confirma manualmente.
- Admin marca comissão como paga.

## Não fazer agora
- Armazenar secrets no front.
- Confiar só no client para marcar pago.
- Implementar mTLS / OAuth no GitHub Pages estático.
