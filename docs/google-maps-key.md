# Mapa do Minera App (gratuito + Google opcional)

## Padrão atual: mapa **gratuito** (sem chave)

O app usa **Leaflet** com:

| Camada | Fonte | Chave |
|--------|-------|-------|
| Ruas (padrão) | OpenStreetMap tiles | nenhuma |
| Satélite | Esri World Imagery | nenhuma |
| Busca de cidade | Nominatim OSM (`countrycodes=br`) via fetch + proxy CORS (`api.allorigins.win`) se necessário | nenhuma |
| Minha localização | Geolocalização do navegador | nenhuma |
| Rota simples | Polilinha reta entre localização e marcador (**não** turn-by-turn) | nenhuma |
| Enviar no chat | `chat.html?lat=&lng=&label=` | nenhuma |

**Não é necessário** ativar faturamento Google Cloud nem preencher `GOOGLE_MAPS_API_KEY`.

### Como testar

1. Abra **Mapa** (usuário logado).
2. Confirme que o mapa de ruas carrega (sem painel pedindo chave).
3. Em **Buscar cidade**, digite p.ex. `Parauapebas` → **Buscar cidade** → escolha o resultado (ou o único) → o mapa voa até a cidade e marca o ponto.
4. **Minha localização** (permita GPS) → pino azul.
5. Toque no mapa com **Marcar ponto (on)** → **Enviar no chat** abre o chat com lat/lng/label.
6. Com localização + marcador: **Rota simples** desenha linha reta rotulada “rota simples (sem Google)”.
7. Troque a camada para **Satélite (Esri)**.

## Google Maps (opcional, depois)

Se no futuro houver billing Google Cloud e quiser Maps JS / Directions:

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Ative **Maps JavaScript API** (e opcionalmente Geocoding / Directions / Places).
3. Crie uma chave de API com restrição HTTP referrer:
   - `https://facilveiculos2015-byte.github.io/minera-app/*`
   - `https://facilveiculos2015-byte.github.io/*`
4. Em `config.js`:

```js
const GOOGLE_MAPS_API_KEY = 'SUA_CHAVE_AQUI';
```

ou:

```js
window.MINERA_GOOGLE_MAPS_KEY = 'SUA_CHAVE_AQUI';
```

Enquanto a chave estiver vazia (ou billing recusado), o app **não bloqueia**: continua no mapa gratuito Leaflet.

**Não** faça commit de chave de produção sem restrição de referrer. O placeholder no repositório permanece `''`.

## Enviar localização no chat

1. Abra **Mapa**.
2. Busque uma cidade, toque no mapa (**Marcar ponto**) ou use **Minha localização**.
3. Toque **Enviar no chat**.
4. Se já houver `?com=` (DM), abre a conversa com o texto pré-preenchido; senão, escolha o contato e envie (texto + link OpenStreetMap / coords).
