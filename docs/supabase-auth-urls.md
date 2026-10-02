# Supabase Auth — URL Configuration (minerapara.com.br)

Projeto `eelbuaxgfzvxosatwcxk` → Dashboard → **Authentication** → **URL Configuration**.

O front usa `window.location.origin + APP_ROOT + 'index.html'` como `redirectTo`
(Esqueci minha senha) e `emailRedirectTo` (confirmação de cadastro). `APP_ROOT` é `/` em
minerapara.com.br e `/minera-app/` se a página ainda abrir no github.io.

## Site (landing) x app — desde o build 20261002a

- `/` e `/index.html` = **site de apresentação** (landing). O login do app mudou para **`/entrar.html`**.
- O `redirectTo`/`emailRedirectTo` continua `…/index.html` (já está na lista e e-mails antigos usam ele).
  O site, **antes de carregar qualquer coisa**, encaminha para `entrar.html` mantendo query + hash quando a URL tem
  `access_token`, `refresh_token`, `token_hash`, `type=recovery|signup|invite|magiclink|email_change`,
  `error`/`error_code`/`error_description` ou `code=` — então confirmação de e-mail e “Redefinir senha” caem no
  fluxo do app (Definir nova senha). O mesmo vale se o Supabase cair no Site URL (`/#access_token=…`).
- `entrar.html` já está coberto por `https://minerapara.com.br/**`. Não é preciso mudar nada no painel.
- Também vão direto para o app: app instalado (display-mode standalone / iPhone Tela de Início / APK com
  `utm_source=twa` ou referrer `android-app://`) e convites (`?ref=`, `?c=`, `?welcome=`, `/c/CÓDIGO`).

## Site URL

```
https://minerapara.com.br/
```

## Redirect URLs (uma por linha)

```
https://minerapara.com.br/**
https://minerapara.com.br/index.html
https://www.minerapara.com.br/**
https://facilveiculos2015-byte.github.io/minera-app/**
https://facilveiculos2015-byte.github.io/minera-app/index.html
```

Manter as duas do github.io por algumas semanas: e-mails de recuperação/confirmação já enviados
apontam para lá (o GitHub redireciona para o domínio novo). Remover depois.

## Ordem

1. Adicionar as Redirect URLs novas **antes** do push do domínio (não quebra nada no host antigo).
2. Trocar o Site URL para `https://minerapara.com.br/` **depois** que https://minerapara.com.br abrir com cadeado.
3. Teste: Esqueci minha senha → link do e-mail abre `https://minerapara.com.br/index.html#…type=recovery` → o site encaminha para `entrar.html#…` → Definir nova senha.

Sessões já logadas no github.io **não** passam para o domínio novo (localStorage é por origem):
cada usuário entra de novo uma vez.
