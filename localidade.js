/**
 * localidade.js — estados/cidades IBGE + DDD + reverse-geocode (browser).
 *
 * Reverse geocode (escolha documentada):
 *   BigDataCloud free client API
 *   https://api.bigdatacloud.net/data/reverse-geocode-client
 *   — sem chave, CORS liberado no browser, localityLanguage=pt.
 *   Fallback: Nominatim OSM via api.allorigins.win (proxy) se BigDataCloud falhar.
 *   User-Agent / app id: MineraApp/1.0 (contato via repositório).
 *
 * IBGE (sem chave):
 *   Estados: /api/v1/localidades/estados?orderBy=nome
 *   Cidades: /api/v1/localidades/estados/{UF}/municipios
 * Cache: memória + localStorage (TTL ~7 dias).
 */
(function (global) {
  'use strict';

  const IBGE_ESTADOS =
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome';
  const IBGE_MUNICS = function (uf) {
    return 'https://servicodados.ibge.gov.br/api/v1/localidades/estados/' +
      encodeURIComponent(uf) + '/municipios';
  };

  const LS_ESTADOS = 'minera_ibge_estados_v1';
  const LS_MUNICS_PREFIX = 'minera_ibge_munics_';
  const LS_PREF = 'minera_local_pref_v1';
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const mem = { estados: null, munics: {} };

  /** Capitals + major cities → DDD (chave: "Cidade|UF" normalizada). */
  const CIDADE_DDD = {
    // Capitais
    'rio branco|ac': '68', 'maceio|al': '82', 'macapa|ap': '96', 'manaus|am': '92',
    'salvador|ba': '71', 'fortaleza|ce': '85', 'brasilia|df': '61', 'vitoria|es': '27',
    'goiania|go': '62', 'sao luis|ma': '98', 'cuiaba|mt': '65', 'campo grande|ms': '67',
    'belo horizonte|mg': '31', 'belem|pa': '91', 'joao pessoa|pb': '83', 'curitiba|pr': '41',
    'recife|pe': '81', 'teresina|pi': '86', 'rio de janeiro|rj': '21', 'natal|rn': '84',
    'porto alegre|rs': '51', 'porto velho|ro': '69', 'boa vista|rr': '95',
    'florianopolis|sc': '48', 'sao paulo|sp': '11', 'aracaju|se': '79', 'palmas|to': '63',
    // PA (garimpo / norte)
    'maraba|pa': '94', 'parauapebas|pa': '94', 'carajas|pa': '94', 'santana do araguaia|pa': '94',
    'redencao|pa': '94', 'xinguara|pa': '94', 'tucurui|pa': '94', 'altamira|pa': '93',
    'santarem|pa': '93', 'itaituba|pa': '93', 'oriximina|pa': '93', 'castanhal|pa': '91',
    'ananindeua|pa': '91', 'barcarena|pa': '91', 'paragominas|pa': '91',
    // AM / RO / RR / AC / AP
    'parintins|am': '92', 'manacapuru|am': '92', 'tefe|am': '97', 'humaita|am': '97',
    'ariquemes|ro': '69', 'ji-parana|ro': '69', 'cacoal|ro': '69', 'vilhena|ro': '69',
    'cruzeiro do sul|ac': '68', 'santana|ap': '96',
    // MT / MS / TO / GO / DF
    'rondonopolis|mt': '66', 'sinop|mt': '66', 'sorriso|mt': '66', 'alta floresta|mt': '66',
    'varzea grande|mt': '65', 'dourados|ms': '67', 'tres lagoas|ms': '67',
    'araguaina|to': '63', 'gurupi|to': '63', 'anapolis|go': '62', 'rio verde|go': '64',
    'catalao|go': '64', 'luziania|go': '61',
    // MG mineração
    'uberlandia|mg': '34', 'uberaba|mg': '34', 'juiz de fora|mg': '32', 'governador valadares|mg': '33',
    'ipatinga|mg': '31', 'contagem|mg': '31', 'betim|mg': '31', 'montes claros|mg': '38',
    'divinopolis|mg': '37', 'pouso alegre|mg': '35', 'varginha|mg': '35', 'itabira|mg': '31',
    'nova lima|mg': '31', 'ouro preto|mg': '31', 'mariana|mg': '31',
    // SP
    'campinas|sp': '19', 'santos|sp': '13', 'sao jose dos campos|sp': '12', 'ribeirao preto|sp': '16',
    'sorocaba|sp': '15', 'bauru|sp': '14', 'sao jose do rio preto|sp': '17', 'presidente prudente|sp': '18',
    'guarulhos|sp': '11', 'osasco|sp': '11', 'santo andre|sp': '11', 'sao bernardo do campo|sp': '11',
    // RJ / ES
    'niteroi|rj': '21', 'duque de caxias|rj': '21', 'nova iguacu|rj': '21', 'petropolis|rj': '24',
    'campos dos goytacazes|rj': '22', 'macae|rj': '22', 'volta redonda|rj': '24',
    'vila velha|es': '27', 'serra|es': '27', 'cachoeiro de itapemirim|es': '28', 'linhares|es': '27',
    // BA / NE
    'feira de santana|ba': '75', 'vitoria da conquista|ba': '77', 'ilheus|ba': '73', 'itabuna|ba': '73',
    'juazeiro|ba': '74', 'barra|ba': '74', 'porto seguro|ba': '73',
    'juazeiro do norte|ce': '88', 'sobral|ce': '88', 'caucaia|ce': '85',
    'petrolina|pe': '87', 'caruaru|pe': '81', 'olinda|pe': '81', 'jaboatao dos guararapes|pe': '81',
    'campina grande|pb': '83', 'mossoro|rn': '84', 'imperatriz|ma': '99', 'caxias|ma': '99',
    'parnaiba|pi': '86', 'picos|pi': '89',
    // Sul
    'londrina|pr': '43', 'maringa|pr': '44', 'ponta grossa|pr': '42', 'foz do iguacu|pr': '45',
    'cascavel|pr': '45', 'guarapuava|pr': '42',
    'joinville|sc': '47', 'blumenau|sc': '47', 'chapeco|sc': '49', 'criciuma|sc': '48',
    'caxias do sul|rs': '54', 'pelotas|rs': '53', 'santa maria|rs': '55', 'passos fundo|rs': '54',
    'novo hamburgo|rs': '51'
  };

  /** DDD principal (capital) por UF — fallback. */
  const DDD_CAPITAL_UF = {
    AC: '68', AL: '82', AP: '96', AM: '92', BA: '71', CE: '85', DF: '61', ES: '27',
    GO: '62', MA: '98', MT: '65', MS: '67', MG: '31', PA: '91', PB: '83', PR: '41',
    PE: '81', PI: '86', RJ: '21', RN: '84', RS: '51', RO: '69', RR: '95', SC: '48',
    SP: '11', SE: '79', TO: '63'
  };

  /** DDDs conhecidos por UF (filtro Marketplace). */
  const DDDS_POR_UF = {
    AC: ['68'], AL: ['82'], AP: ['96'], AM: ['92', '97'], BA: ['71', '73', '74', '75', '77'],
    CE: ['85', '88'], DF: ['61'], ES: ['27', '28'], GO: ['62', '64'], MA: ['98', '99'],
    MT: ['65', '66'], MS: ['67'], MG: ['31', '32', '33', '34', '35', '37', '38'],
    PA: ['91', '93', '94'], PB: ['83'], PR: ['41', '42', '43', '44', '45', '46'],
    PE: ['81', '87'], PI: ['86', '89'], RJ: ['21', '22', '24'], RN: ['84'],
    RS: ['51', '53', '54', '55'], RO: ['69'], RR: ['95'], SC: ['47', '48', '49'],
    SP: ['11', '12', '13', '14', '15', '16', '17', '18', '19'], SE: ['79'], TO: ['63']
  };

  const TODOS_DDDS = (function () {
    const s = {};
    Object.keys(DDDS_POR_UF).forEach(function (uf) {
      DDDS_POR_UF[uf].forEach(function (d) { s[d] = true; });
    });
    return Object.keys(s).sort();
  })();

  function norm(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  function lsGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.ts || !obj.data) return null;
      if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
      return obj.data;
    } catch (e) { return null; }
  }

  function lsSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) { /* quota */ }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'default' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function listarEstados() {
    if (mem.estados) return mem.estados;
    const cached = lsGet(LS_ESTADOS);
    if (cached && cached.length) {
      mem.estados = cached;
      return cached;
    }
    const data = await fetchJson(IBGE_ESTADOS);
    const list = (data || []).map(function (e) {
      return { sigla: String(e.sigla || '').toUpperCase(), nome: e.nome || e.sigla };
    }).filter(function (e) { return e.sigla.length === 2; });
    mem.estados = list;
    lsSet(LS_ESTADOS, list);
    return list;
  }

  async function listarCidades(uf) {
    const u = String(uf || '').toUpperCase();
    if (!u || u.length !== 2) return [];
    if (mem.munics[u]) return mem.munics[u];
    const key = LS_MUNICS_PREFIX + u;
    const cached = lsGet(key);
    if (cached && cached.length) {
      mem.munics[u] = cached;
      return cached;
    }
    const data = await fetchJson(IBGE_MUNICS(u));
    const list = (data || []).map(function (m) {
      return { id: m.id, nome: m.nome };
    }).filter(function (m) { return m.nome; });
    list.sort(function (a, b) {
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    mem.munics[u] = list;
    lsSet(key, list);
    return list;
  }

  function dddDeCidade(cidade, uf) {
    const u = String(uf || '').toUpperCase();
    const key = norm(cidade) + '|' + norm(u);
    if (CIDADE_DDD[key]) return CIDADE_DDD[key];
    // tenta só pelo nome (quando único na tabela)
    const only = norm(cidade);
    let hit = null;
    let count = 0;
    Object.keys(CIDADE_DDD).forEach(function (k) {
      if (k.indexOf('|') < 0) return;
      const parts = k.split('|');
      if (parts[0] === only) {
        hit = CIDADE_DDD[k];
        count++;
      }
    });
    if (count === 1) return hit;
    return DDD_CAPITAL_UF[u] || '';
  }

  function dddsDoEstado(uf) {
    const u = String(uf || '').toUpperCase();
    return (DDDS_POR_UF[u] || []).slice();
  }

  function todosDdds() {
    return TODOS_DDDS.slice();
  }

  function lerPreferencia() {
    try {
      const raw = localStorage.getItem(LS_PREF);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function salvarPreferencia(pref) {
    try {
      localStorage.setItem(LS_PREF, JSON.stringify(pref || {}));
    } catch (e) { /* ignore */ }
  }

  /**
   * Reverse geocode lat/lng → { cidade, estado, ddd }.
   * Primary: BigDataCloud (CORS OK). Fallback: Nominatim via allorigins.
   */
  async function reverseGeocode(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      throw new Error('coords inválidas');
    }

    // 1) BigDataCloud
    try {
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
        + '?latitude=' + encodeURIComponent(la)
        + '&longitude=' + encodeURIComponent(ln)
        + '&localityLanguage=pt';
      const data = await fetchJson(url);
      const cidade = data.city || data.locality || data.principalSubdivision || '';
      let estado = '';
      // BigDataCloud BR: principalSubdivisionCode like "BR-PA"
      const code = String(data.principalSubdivisionCode || '');
      const m = code.match(/BR-([A-Z]{2})/i);
      if (m) estado = m[1].toUpperCase();
      if (!estado && data.principalSubdivision) {
        // tenta casar nome do estado com IBGE
        const estados = await listarEstados();
        const n = norm(data.principalSubdivision);
        const found = estados.find(function (e) { return norm(e.nome) === n || norm(e.sigla) === n; });
        if (found) estado = found.sigla;
      }
      if (cidade && estado) {
        return {
          cidade: String(cidade),
          estado: estado,
          ddd: dddDeCidade(cidade, estado),
          fonte: 'bigdatacloud'
        };
      }
    } catch (e) {
      console.warn('BigDataCloud reverse-geocode:', e);
    }

    // 2) Nominatim via CORS proxy
    try {
      const nomUrl = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2'
        + '&lat=' + encodeURIComponent(la)
        + '&lon=' + encodeURIComponent(ln)
        + '&accept-language=pt-BR';
      const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(nomUrl);
      const data = await fetchJson(proxied);
      const addr = (data && data.address) || {};
      const cidade = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
      let estado = '';
      if (addr['ISO3166-2-lvl4']) {
        const m2 = String(addr['ISO3166-2-lvl4']).match(/BR-([A-Z]{2})/i);
        if (m2) estado = m2[1].toUpperCase();
      }
      if (!estado && addr.state) {
        const estados = await listarEstados();
        const n = norm(addr.state);
        const found = estados.find(function (e) { return norm(e.nome) === n; });
        if (found) estado = found.sigla;
      }
      if (cidade && estado) {
        return {
          cidade: String(cidade),
          estado: estado,
          ddd: dddDeCidade(cidade, estado),
          fonte: 'nominatim'
        };
      }
    } catch (e) {
      console.warn('Nominatim reverse-geocode:', e);
    }

    throw new Error('reverse-geocode falhou');
  }

  var LS_GEO_CIDADE = 'minera_geo_cidade';

  /**
   * Localização → cidade/UF via MineraGeo (geo.js). NUNCA pede permissão sozinho:
   * opts.interativo=true só quando o usuário tocou em "Perto de mim".
   * @returns {Promise<{cidade,estado,ddd,lat,lng}|null>}
   */
  async function obterLocalizacaoUsuario(opts) {
    opts = opts || {};
    if (!global.MineraGeo || !global.MineraGeo.obterLocalizacao) return null; // sem helper → não chama a API
    const pos = await global.MineraGeo.obterLocalizacao({
      motivo: opts.motivo || 'cidade',
      interativo: !!opts.interativo,
      timeout: opts.timeout || 12000
    });
    if (!pos) return null;
    // Reusa cidade já geocodificada perto (~5 km) — evita Nominatim a cada abertura
    try {
      const c = JSON.parse(localStorage.getItem(LS_GEO_CIDADE) || 'null');
      if (c && c.cidade && c.estado && Math.abs(c.lat - pos.lat) < 0.05 && Math.abs(c.lng - pos.lng) < 0.05) {
        return { cidade: c.cidade, estado: c.estado, ddd: c.ddd, lat: pos.lat, lng: pos.lng, fonte: c.fonte || 'cache' };
      }
    } catch (e) { /* ignore */ }
    try {
      const geo = await reverseGeocode(pos.lat, pos.lng);
      const out = { cidade: geo.cidade, estado: geo.estado, ddd: geo.ddd, lat: pos.lat, lng: pos.lng, fonte: geo.fonte };
      try { localStorage.setItem(LS_GEO_CIDADE, JSON.stringify(out)); } catch (e) { /* ignore */ }
      return out;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  /** Preenche <select> de estados (value=UF). */
  async function preencherSelectEstados(selectEl, selectedUf) {
    if (!selectEl) return;
    const estados = await listarEstados();
    const cur = selectedUf ? String(selectedUf).toUpperCase() : (selectEl.value || '');
    selectEl.innerHTML = '<option value="">Estado (UF)</option>' +
      estados.map(function (e) {
        return '<option value="' + e.sigla + '">' + e.sigla + ' — ' + e.nome + '</option>';
      }).join('');
    if (cur) selectEl.value = cur;
  }

  /** Preenche <select> de cidades para UF. */
  async function preencherSelectCidades(selectEl, uf, selectedCidade) {
    if (!selectEl) return;
    const u = String(uf || '').toUpperCase();
    if (!u) {
      selectEl.innerHTML = '<option value="">Cidade</option>';
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = true;
    selectEl.innerHTML = '<option value="">Carregando…</option>';
    try {
      const cidades = await listarCidades(u);
      selectEl.innerHTML = '<option value="">Cidade</option>' +
        cidades.map(function (c) {
          return '<option value="' + String(c.nome).replace(/"/g, '&quot;') + '">' + c.nome + '</option>';
        }).join('');
      selectEl.disabled = false;
      if (selectedCidade) {
        selectEl.value = selectedCidade;
        // match case-insensitive se necessário
        if (selectEl.value !== selectedCidade) {
          const n = norm(selectedCidade);
          const opt = Array.from(selectEl.options).find(function (o) {
            return norm(o.value) === n;
          });
          if (opt) selectEl.value = opt.value;
        }
      }
    } catch (e) {
      console.warn(e);
      selectEl.innerHTML = '<option value="">Falha ao carregar cidades</option>';
      selectEl.disabled = false;
    }
  }

  /** Preenche select de DDD (opcionalmente filtrado por UF). */
  function preencherSelectDdd(selectEl, uf, selected) {
    if (!selectEl) return;
    const list = uf ? dddsDoEstado(uf) : todosDdds();
    const cur = selected != null ? String(selected) : (selectEl.value || '');
    selectEl.innerHTML = '<option value="">DDD</option>' +
      list.map(function (d) {
        return '<option value="' + d + '">' + d + '</option>';
      }).join('');
    if (cur) selectEl.value = cur;
  }

  global.LocalidadeBR = {
    listarEstados: listarEstados,
    listarCidades: listarCidades,
    dddDeCidade: dddDeCidade,
    dddsDoEstado: dddsDoEstado,
    todosDdds: todosDdds,
    reverseGeocode: reverseGeocode,
    obterLocalizacaoUsuario: obterLocalizacaoUsuario,
    lerPreferencia: lerPreferencia,
    salvarPreferencia: salvarPreferencia,
    preencherSelectEstados: preencherSelectEstados,
    preencherSelectCidades: preencherSelectCidades,
    preencherSelectDdd: preencherSelectDdd,
    DDD_CAPITAL_UF: DDD_CAPITAL_UF,
    norm: norm
  };
})(typeof window !== 'undefined' ? window : this);
