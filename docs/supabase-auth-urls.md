# Supabase Auth — URL Configuration (minerapara.com.br)

Projeto `eelbuaxgfzvxosatwcxk` → Dashboard → **Authentication** → **URL Configuration**.

O front usa `window.location.origin + APP_ROOT + 'index.html'` como `redirectTo`
(Esqueci minha senha) e `emailRedirectTo` (confirmação de cadastro). `APP_ROOT` é `/` em
minerapara.com.br e `/minera-app/` se a página ainda abrir no github.io.

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
3. Teste: Esqueci minha senha → link do e-mail abre `https://minerapara.com.br/index.html#…type=recovery` → Definir nova senha.

Sessões já logadas no github.io **não** passam para o domínio novo (localStorage é por origem):
cada usuário entra de novo uma vez.
