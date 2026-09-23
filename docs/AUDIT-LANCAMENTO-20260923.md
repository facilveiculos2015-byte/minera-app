# Audit de lançamento — Minera Pará — 2026-09-23

**Repo:** `meu-projeto-mineracao`  
**Live:** https://facilveiculos2015-byte.github.io/minera-app/  
**Supabase:** `https://eelbuaxgfzvxosatwcxk.supabase.co` (apenas chave **anon** em `config.js`)  
**Cache build:** `20260923v` (após fixes deste audit; sticky admin já estava em `20260923u`)  
**Método:** auditoria estática de `*.js` / `*.html` / `sql/32–38` (+ `39` recomendado); sem credenciais de service role; sem DELETE destrutivo.

---

## Resumo executivo

| Área | Resultado |
|------|-----------|
| Admin «Ver como usuário» → sticky «Voltar ao Admin» | **PASS** (build `u`, mantido em `v`) |
| onclick → funções inexistentes | **PASS** (0 missing) |
| `href="#"` / `javascript:void` mortos | **PASS** (0) |
| Service role no front | **PASS** (só anon) |
| Botões mortos Bank/Chat | **FAIL→FIXED** (P1) |
| Filtro chat «Não lidas» | **FAIL→FIXED** (P1) |
| RLS Caixa (saldo/status self-write) | **RISCO P0 documentado** + SQL `39` recomendado (não aplicado remoto) |

---

## Checklist PASS/FAIL

| # | Item | Sev | Status | file:line | Fix aplicado / recomendado |
|---|------|-----|--------|-----------|----------------------------|
| 1 | Sticky «Voltar ao Admin» sempre no modo usuário (`emModoUsuarioUi`) | P0 | **PASS** | `nav.js:417-517`, `auth-guard.js:388-390`, `style.css:3063+` | Já em `57d1ebd` / build `u`. Sticky independente de `header.header-row`; `body.modo-ui-usuario` + z-index 9999. |
| 2 | Botão header «Voltar ao Admin» + sticky bind | P0 | **PASS** | `nav.js:407-432`, `490-517` | `bindVoltarAdmin` → `gravarModoUi('admin')` + `irPara('admin.html')`. |
| 3 | «Ver como usuário» no modo admin | P0 | **PASS** | `nav.js:444-487` | Grava `usuario` e vai a `inicio.html`. |
| 4 | Sair só no Perfil | P1 | **PASS** | `nav.js:527-542`, `599-601` | `garantirBtnSair` oculta `#btn-sair` fora de `perfil`; remove Sair do sheet Mais. |
| 5 | onclick HTML → fn ausente | P0 | **PASS** | — | Scan: 0 handlers órfãos. |
| 6 | `href="#"` mortos | P1 | **PASS** | — | 0 ocorrências. |
| 7 | TODO/FIXME bloqueantes | P2 | **PASS** | `chat.html` / `financeiro.html` | Só «em breve» explícitos (vídeo/voz/boleto/arquivadas) com toast — não silent. |
| 8 | Tema claro/escuro (convite + perfil) | P1 | **PASS** | `auth-guard.js:492-575`, `perfil.js:189-196`, `index.html` tema-opt | `bindTemaPicker` + `data-tema`; ids `btn-tema-claro/escuro` via classe. |
| 9 | Share WhatsApp (Família Mineira) | P1 | **PASS** | `suporte.js:575+`, `perfil.js:69-80` | `compartilharNoWhatsApp` → `wa.me/?text=`. |
| 10 | Lotes salvar + erros | P1 | **PASS** | `lotes.js:487-668`, `806` | Submit `#form-lote`; toasts/hints SQL 24/26/37. |
| 11 | Bank PIN lock (set/unlock/forgot) | P1 | **PASS** | `financeiro.js:93-286`, `545+` | sessionStorage unlock; hash PIN; UI lock overlay. |
| 12 | Bank kill-switch `minera_bank_enabled` | P1 | **PASS** | `financeiro.js:16-56`, `financeiro.html:21-27` | Overlay + `guardBankAction`. Fail-open se flag ausente (P2). |
| 13 | Nav chips vs páginas | P1 | **PASS** | `nav.js:3-18` | Primários: inicio/lotes/novo/chat/perfil. Sec: mapa/britagem/frete/admin. `estoque`/`expedicao`/`relatorios` HTML legados ocultos do chrome (OK). |
| 14 | `btn-saldo-goto` sem listener | P1 | **FIXED** | `financeiro.html` `#btn-saldo-goto` | `data-view="extrato"`. |
| 15 | `nb-menu` / `nb-shortcut` mortos | P1 | **FIXED** | `financeiro.html` | `data-view="ajuda"` / `data-view="extrato"`. |
| 16 | `pix-copia-info` morto | P1 | **FIXED** | `financeiro.html` inline script | Toast explicando Pix admin JeL (sem PII admin além do titular já público na UI). |
| 17 | `btn-chat-menu-list` morto | P1 | **FIXED** | `chat.html` waChrome | Clique → `#btn-add-contato` (nova conversa). |
| 18 | Chips Todas/Não lidas/Favoritos só CSS | P1 | **FIXED** | `chat.js` `aplicarFiltroListaChat`, `carregarContatos` | `nao_lidas` filtra `unread>0`; Favoritos toast «em breve». |
| 19 | Câmera na lista sem thread | P1 | **FIXED** | `chat.html` `openCameraCapture`; `chat.js` `pickMidiaArquivo` | Toast «Abra uma conversa…» / «Selecione um contato…». |
| 20 | Chamadas vídeo/voz / Arquivadas | P2 | **PASS** | `chat.html:184-185,287` | Toast «em breve» (não silent). |
| 21 | Boleto / cartão virtual | P2 | **PASS** | `financeiro.html` | Copy «em breve» explícito. |
| 22 | config.js só anon | P0 | **PASS** | `config.js:1-3` | Sem service role no repo. |
| 23 | RLS lotes marketplace + oculto | P1 | **PASS** | `sql/32`, `sql/35` | SELECT: admin / own / `oculto=false`. Mutação own/admin. |
| 24 | RLS chat participante | P0 | **PASS** | `sql/32`, `sql/35` | SELECT/INSERT de/para; diretório sem e-mail (`sql/22`). |
| 25 | RLS storage paths | P1 | **PASS** | `sql/33` | Upload só pasta `{auth.uid()}/`. |
| 26 | RLS share/promos/flags | P1 | **PASS** | `sql/35`, `sql/36` | Mutação admin; SELECT flags/promos autenticado. |
| 27 | SQL 38 limpeza | P2 | **N/A código** | `sql/38*` | Script manual SQL Editor; **não executar** sem confirmação. Preserva só admin listado no SQL. |
| 28 | **Caixa: cliente pode UPDATE `saldo`** | P0 | **RISCO** | `sql/32:67-71` | Policy UPDATE own coluna-aberta. App só grava PIN, mas API direta permitiria credit. **Recomendado:** aplicar `sql/39-caixa-client-write-guard.sql` no Supabase. |
| 29 | **Caixa: cliente UPDATE status pedido → confirmado** | P0 | **RISCO** | `sql/32:96` | Mesmo guard em `sql/39` (só `pendente→cancelado` p/ cliente). |
| 30 | **Caixa: INSERT movimentos tipos livres** | P1 | **RISCO** | `sql/32:82` | App usa `deposito_pendente`; tipos de crédito bloqueados em `sql/39`. |
| 31 | chat-midia SELECT público (playback) | P2 | **ACEITO** | `sql/33` comentário | URLs guessable; mutação isolada. Mitigar depois com signed URLs se necessário. |
| 32 | Cache bust pós-fix | P1 | **FIXED** | todos `?v=` / `pwa.js` / `sw.js` | Bump `20260923u` → **`20260923v`**. |

---

## Detalhe — Admin modo usuário (P0)

`garantirHeaderModoUiBtn`:

1. Se `emModoUsuarioUi(perfil)` → cria `#modo-ui-sticky` no `body` com botão `#btn-modo-ui-sticky` «Voltar ao Admin».
2. Se existe `header.header-row .header-actions`, também espelha `#btn-modo-ui` «Voltar ao Admin».
3. Páginas sem header (ex.: Início) **ainda** mostram o sticky — regressão que o build `u` corrigiu.

Verificado no código commitado + mantido após bump `v`.

---

## Detalhe — SQL/RLS (32–39)

| Script | Papel | Risco residual |
|--------|-------|----------------|
| 32 hardening | Reafirma is_admin + políticas own/admin | Caixa UPDATE/INSERT amplos (itens 28–30) |
| 33 storage | Pastas por uid | SELECT chat-midia amplo (P2) |
| 35 promos/bank flag | Kill-switch + lotes.oculto | OK |
| 36 share flags | Frase/OG | OK |
| 37 lotes midia/teor | Colunas | Depende de storage policies |
| 38 limpeza | Wipe pré-launch | Só admin keep_email; **não** auto-rodar daqui |
| **39** (novo) | Triggers guard Caixa | **Aplicar no SQL Editor antes do go-live** |

Isolamento A≠B: chat, caixa SELECT, contatos, suporte e diretório sem e-mail estão coerentes com auth.uid(). Marketplace de lotes é intencionalmente shared (não ocultos).

---

## Fixes deste audit (código)

1. Bank: `data-view` em saldo / menu / atalho; toast em «Minha área Pix».
2. Chat: menu lista → nova conversa; filtro Não lidas; Favoritos toast; câmera exige thread; toast em mídia sem contato.
3. Cache `20260923v`.
4. `sql/39-caixa-client-write-guard.sql` adicionado (aplicar manualmente no Supabase).

---

## O que NÃO foi feito

- Não aplicado SQL remoto (sem service role / sem Editor daqui).
- Não executado `38` limpeza.
- Favoritos/Arquivadas/Chamadas: permanece «em breve» com feedback (não silent).
- Não enfraquecido RLS.

---

## Go / No-go sugerido

- **Go de UI** após deploy Pages com `20260923v` + smoke: Admin → Ver como usuário → sticky Voltar; Bank saldo→extrato; Chat Não lidas; Perfil WhatsApp; tema.
- **No-go financeiro real** até aplicar **SQL 39** (e confirmar flag `minera_bank_enabled` desejada).
