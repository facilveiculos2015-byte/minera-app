/**
 * geo.js — Minera Pará: geolocalização com permissão pedida UMA vez.
 *
 * Regras:
 *  - Nunca pede permissão sozinho no carregamento da página.
 *  - permissions.query 'granted'  → pega posição em silêncio.
 *  - 'denied'                     → não chama a API; devolve cache (ou null).
 *  - 'prompt' / desconhecido      → só chama quando a feature pede (interativo: true,
 *                                   ex.: botão "Perto de mim" / "Minha localização").
 *  - iOS Safari/PWA: permissions.query pouco confiável → usa flag + cache; nunca auto-prompt.
 *  - Cache: localStorage minera_geo_last {lat,lng,acc,ts} (fresco por 30 min).
 *  - Flag:  localStorage minera_geo_decidido = 'granted' | 'denied'.
 *  - O hard reset de build (pwa.js) só limpa Cache Storage + SW, NUNCA localStorage.
 */
(function (global) {
  'use strict';

  var LS_LAST = 'minera_geo_last';
  var LS_DECIDIDO = 'minera_geo_decidido';
  var FRESCO_MS = 30 * 60 * 1000;
  var emVoo = null; // evita 2 prompts simultâneos
  var stats = { chamadasApi: 0, cacheHits: 0, bloqueadas: 0 };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function lerCache() {
    try {
      var j = JSON.parse(lsGet(LS_LAST) || 'null');
      if (j && typeof j.lat === 'number' && typeof j.lng === 'number' && j.ts) return j;
    } catch (e) { /* ignore */ }
    return null;
  }

  function salvarCache(pos) {
    var c = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: pos.coords.accuracy || null,
      ts: Date.now()
    };
    lsSet(LS_LAST, JSON.stringify(c));
    return c;
  }

  function decidido() { return lsGet(LS_DECIDIDO) || ''; }

  /** 'granted' | 'denied' | 'prompt' | 'unknown' — nunca dispara prompt. */
  function estadoPermissao() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve('unknown');
      return navigator.permissions.query({ name: 'geolocation' })
        .then(function (st) {
          var s = st && st.state;
          if (s === 'granted' || s === 'denied' || s === 'prompt') {
            if (s === 'granted') lsSet(LS_DECIDIDO, 'granted');
            if (s === 'denied') lsSet(LS_DECIDIDO, 'denied');
            return s;
          }
          return 'unknown';
        })
        .catch(function () { return 'unknown'; });
    } catch (e) {
      return Promise.resolve('unknown');
    }
  }

  function chamarApi(opts) {
    if (emVoo) return emVoo;
    stats.chamadasApi++;
    emVoo = new Promise(function (resolve) {
      try {
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            lsSet(LS_DECIDIDO, 'granted');
            var c = salvarCache(pos);
            resolve(Object.assign({ cached: false }, c));
          },
          function (err) {
            if (err && err.code === 1) lsSet(LS_DECIDIDO, 'denied');
            global.MineraGeo.ultimoErro = err ? (err.code === 1 ? 'denied' : (err.code === 3 ? 'timeout' : 'unavailable')) : 'unavailable';
            resolve(null);
          },
          {
            enableHighAccuracy: !!opts.highAccuracy,
            timeout: opts.timeout || 12000,
            maximumAge: 5 * 60 * 1000
          }
        );
      } catch (e) {
        resolve(null);
      }
    }).then(function (r) { emVoo = null; return r; });
    return emVoo;
  }

  /**
   * @param {{motivo?:string, interativo?:boolean, highAccuracy?:boolean, timeout?:number, fresco?:boolean}} opts
   *   interativo: true só quando o usuário tocou num botão que precisa de localização.
   *   fresco: true ignora cache fresco (ex.: botão "Minha localização" no mapa).
   * @returns {Promise<{lat,lng,acc,ts,cached}|null>}
   */
  function obterLocalizacao(opts) {
    opts = opts || {};
    global.MineraGeo.ultimoErro = null;
    var cache = lerCache();
    var fresco = cache && (Date.now() - cache.ts < FRESCO_MS);
    if (fresco && !opts.fresco) {
      stats.cacheHits++;
      return Promise.resolve(Object.assign({ cached: true }, cache));
    }
    if (!navigator.geolocation) {
      global.MineraGeo.ultimoErro = 'unsupported';
      return Promise.resolve(cache ? Object.assign({ cached: true }, cache) : null);
    }
    return estadoPermissao().then(function (st) {
      if (st === 'denied') {
        stats.bloqueadas++;
        global.MineraGeo.ultimoErro = 'denied';
        return cache ? Object.assign({ cached: true }, cache) : null;
      }
      if (st === 'granted') return chamarApi(opts).then(function (r) { return r || (cache ? Object.assign({ cached: true }, cache) : null); });
      // 'prompt' ou 'unknown' (iOS): só com gesto do usuário
      if (!opts.interativo) {
        stats.bloqueadas++;
        if (cache) { stats.cacheHits++; return Object.assign({ cached: true }, cache); }
        return null;
      }
      return chamarApi(opts).then(function (r) { return r || (cache ? Object.assign({ cached: true }, cache) : null); });
    });
  }

  global.MineraGeo = {
    obterLocalizacao: obterLocalizacao,
    estadoPermissao: estadoPermissao,
    lerCache: lerCache,
    decidido: decidido,
    stats: stats,
    ultimoErro: null,
    KEYS: { LAST: LS_LAST, DECIDIDO: LS_DECIDIDO }
  };
  global.obterLocalizacao = obterLocalizacao;
})(typeof window !== 'undefined' ? window : this);
