/**
 * Pix Copia e Cola (EMV BR Code) — Bacen static payload + CRC16-CCITT.
 * Pure JS, no npm. Exposes window.gerarPixCopiaCola / PixBrCode.
 */
(function (global) {
  'use strict';

  function tlv(id, value) {
    var v = String(value == null ? '' : value);
    var len = v.length;
    if (len > 99) {
      v = v.slice(0, 99);
      len = 99;
    }
    return id + String(len).padStart(2, '0') + v;
  }

  /** Remove accents / keep printable ASCII-ish for EMV fields */
  function sanitizeEmv(str, max) {
    var s = String(str == null ? '' : str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 .,&\/\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if (max && s.length > max) s = s.slice(0, max).trim();
    return s || '';
  }

  function formatValor(valor) {
    if (valor == null || valor === '') return null;
    var n = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    return n.toFixed(2);
  }

  /** CRC16-CCITT (poly 0x1021, init 0xFFFF) — Bacen Pix */
  function crc16Ccitt(payload) {
    var crc = 0xffff;
    for (var i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (var b = 0; b < 8; b++) {
        if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
        else crc = (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * @param {{ chave: string, nome?: string, cidade?: string, valor?: number|string|null, txid?: string }} opts
   * @returns {string} EMV payload (Copia e Cola)
   */
  function gerarPixCopiaCola(opts) {
    opts = opts || {};
    var chave = String(opts.chave || '').trim();
    if (!chave) throw new Error('chave Pix obrigatória');

    var nome = sanitizeEmv(opts.nome || 'JeL empreendimentos', 25) || 'JEL EMPREENDIMENTOS';
    var cidade = sanitizeEmv(opts.cidade || 'BELEM', 15) || 'BELEM';
    var txid = String(opts.txid != null ? opts.txid : '***')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 25) || '***';
    var amount = formatValor(opts.valor);

    // Merchant Account Information (GUI + chave)
    var mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);

    var payload =
      tlv('00', '01') + // Payload Format Indicator
      tlv('01', amount ? '12' : '11') + // 11 static / 12 with amount
      tlv('26', mai) +
      tlv('52', '0000') +
      tlv('53', '986');

    if (amount) payload += tlv('54', amount);

    payload +=
      tlv('58', 'BR') +
      tlv('59', nome) +
      tlv('60', cidade) +
      tlv('62', tlv('05', txid));

    payload += '6304';
    payload += crc16Ccitt(payload);
    return payload;
  }

  function copiarTexto(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Render QR into container using qrcodejs (global QRCode) if available.
   * @param {HTMLElement} el
   * @param {string} payload
   * @param {number} [size]
   */
  function renderQr(el, payload, size) {
    if (!el) return;
    el.innerHTML = '';
    size = size || 200;
    if (typeof QRCode === 'undefined') {
      el.innerHTML = '<p class="sub">QR indisponível (CDN qrcodejs).</p>';
      return;
    }
    // qrcodejs clears and draws into el
    // eslint-disable-next-line no-new
    new QRCode(el, {
      text: payload,
      width: size,
      height: size,
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  global.gerarPixCopiaCola = gerarPixCopiaCola;
  global.PixBrCode = {
    gerar: gerarPixCopiaCola,
    sanitizeEmv: sanitizeEmv,
    crc16Ccitt: crc16Ccitt,
    copiarTexto: copiarTexto,
    renderQr: renderQr,
    FALLBACK_CHAVE: '', // prefer DB; set only if needed
    FALLBACK_NOME: 'JeL empreendimentos',
    FALLBACK_CIDADE: 'BELEM'
  };
})(typeof window !== 'undefined' ? window : globalThis);
