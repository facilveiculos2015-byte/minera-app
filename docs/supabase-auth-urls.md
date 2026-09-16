# Supabase Auth — URL Configuration (GitHub Pages)

O fluxo **Esqueci minha senha** depende do Dashboard. O front já usa
`resetPasswordForEmail` com `redirectTo` apontando para o `index.html` do Pages
(`origin + APP_ROOT + 'index.html'`) e trata o hash `type=recovery` /
evento `PASSWORD_RECOVERY` com o formulário **Definir nova senha**.

Sem as URLs abaixo no projeto Supabase, o link do e-mail abre com erro
(redirect bloqueado / Site URL errada).

## Onde configurar

Supabase Dashboard → **Authentication** → **URL Configuration**
(projeto `eelbuaxgfzvxosatwcxk` / Minera App).

## Valores exatos

**Site URL**

```
https://facilveiculos2015-byte.github.io/minera-app/
```

**Redirect URLs** (uma por linha; wildcards aceitos)

```
https://facilveiculos2015-byte.github.io/minera-app/**
https://facilveiculos2015-byte.github.io/minera-app/index.html
```

## Depois de salvar

1. Pedir novo e-mail em **Esqueci minha senha** no app.
2. Abrir o link: deve carregar o `index.html` do Pages e mostrar **Definir nova senha**.
3. Após salvar, o app limpa o hash e vai para `inicio.html` (sessão ativa).

## Nota

Não é possível alterar Site URL / Redirect URLs só pelo código do repositório;
o parent (ou dono do projeto) precisa aplicar no Dashboard.
