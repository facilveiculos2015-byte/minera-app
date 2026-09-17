# Chave Google Maps (Minera App)

O mapa do app usa a **Google Maps JavaScript API** (ruas, satélite, marcador, rota e envio no chat).

## 1. Criar a chave

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou selecione um projeto.
3. Ative as APIs:
   - **Maps JavaScript API** (obrigatória)
   - **Geocoding API** (endereço reverso do pino — recomendada)
   - **Directions API** (rotas — recomendada)
   - **Places API** (opcional; carregada no script)
4. Em **APIs e serviços → Credenciais → Criar credenciais → Chave de API**.

## 2. Restringir a chave (HTTP referrer)

Para GitHub Pages do Minera:

- Tipo de restrição da aplicação: **Referenciadores HTTP (sites)**
- Referrers sugeridos:
  - `https://facilveiculos2015-byte.github.io/minera-app/*`
  - `https://facilveiculos2015-byte.github.io/*`
  - Em desenvolvimento local (se precisar): `http://localhost/*` e `http://127.0.0.1/*`

Restrição de API: limite às APIs listadas acima.

## 3. Colocar no `config.js`

```js
const GOOGLE_MAPS_API_KEY = 'SUA_CHAVE_AQUI';
```

Alternativa (sem editar o const):

```js
window.MINERA_GOOGLE_MAPS_KEY = 'SUA_CHAVE_AQUI';
```

**Não** faça commit de uma chave de produção sem restrição de referrer. O placeholder no repositório permanece `''`.

## 4. Faturamento / limites

- Contas Google Cloud exigem faturamento ativo para Maps em produção.
- Sem chave, billing ou API ativada: o app mostra o painel “Configure a chave Google Maps no config”.
- Sem Geocoding: o pino ainda funciona (só lat/lng).
- Sem Directions: botões de rota falham com aviso; mapa e envio no chat continuam ok.

## 5. Enviar localização no chat

1. Abra **Mapa**.
2. Toque no mapa (**Marcar ponto**) ou use **Minha localização**.
3. Toque **Enviar no chat**.
4. Se já houver `?com=` (DM), abre a conversa com o texto pré-preenchido; senão, escolha o contato e envie a mensagem (texto + link `https://maps.google.com/?q=lat,lng`).
