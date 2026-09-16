# Localidade Brasil — Marketplace

## Fontes de dados

| Uso | Fonte | Auth | CORS |
|-----|-------|------|------|
| Estados / municípios | [IBGE Localidades](https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome) | nenhuma | OK no browser |
| Reverse geocode (primário) | [BigDataCloud reverse-geocode-client](https://api.bigdatacloud.net/data/reverse-geocode-client) | nenhuma (client) | OK no browser |
| Reverse geocode (fallback) | Nominatim OSM via `api.allorigins.win` proxy | nenhuma | via proxy |

Escolha do reverse-geocode: **BigDataCloud** porque funciona direto do browser (CORS), não exige chave e retorna `principalSubdivisionCode` no formato `BR-UF`, permitindo mapear cidade + estado. Nominatim exige User-Agent e costuma bloquear CORS; fica só como fallback via proxy.

## Colunas em `lotes` (SQL 29)

- `estado` CHAR(2) — UF
- `cidade` TEXT — município
- `ddd` TEXT — DDD (2 dígitos), derivado da cidade quando possível
- `lat` / `lng` — já em SQL 11

## Cache

IBGE estados/municípios: memória + `localStorage` (TTL 7 dias). Preferência de filtro do usuário: `minera_local_pref_v1`.

## DDD

Tabela estática capital/cidades principais → DDD em `localidade.js`. Fallback: DDD da capital da UF.
