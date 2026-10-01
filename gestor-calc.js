/* Gestor financeiro — cálculos puros (espelho do trigger gf_carradas_calc do SQL 48),
 * números pt-BR e CSV p/ Excel BR. Sem DOM: testável no Node. */
(function (root) {
    'use strict';

    function r(n, d) { const f = Math.pow(10, d); return Math.round((n + Number.EPSILON) * f) / f; }

    /** "1.234,56" / "1234.56" / "45.000" (milhar) → número; vazio → null */
    function parseBR(v) {
        if (v == null) return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        let s = String(v).trim().replace(/\s|R\$/g, '');
        if (!s) return null;
        if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
        const n = Number(s);
        return isFinite(n) ? n : null;
    }

    function fmtNum(n, dec) {
        if (n == null || !isFinite(n)) return '—';
        return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    function fmtBRL(n) { return n == null || !isFinite(n) ? '—' : 'R$ ' + fmtNum(n, 2); }
    function fmtT(n) { return n == null || !isFinite(n) ? '—' : fmtNum(n, 2) + ' t'; }
    /** número p/ input (sem milhar): 400 → "400"; 10.5 → "10,5" */
    function numInput(n) {
        if (n == null || n === '' || !isFinite(Number(n))) return '';
        return String(Number(n)).replace('.', ',');
    }

    /** Mesmo cálculo do banco. despesas = soma das despesas vinculadas. */
    function calcCarrada(c, despesas) {
        const o = Object.assign({}, c);
        const u = o.umidade_pct || 0;
        if (o.peso_bruto_kg != null && o.tara_kg != null) {
            o.erro = o.tara_kg > o.peso_bruto_kg ? 'Tara maior que o peso bruto' : null;
            o.peso_liquido_kg = o.peso_bruto_kg - o.tara_kg;
        }
        o.peso_umido_t = o.peso_liquido_kg == null ? null : r(o.peso_liquido_kg / 1000, 4);
        o.peso_seco_t = o.peso_umido_t == null ? null : r(o.peso_umido_t * (1 - u / 100), 4);
        if (o.peso_umido_t == null) o.peso_pago_t = null;
        else if (o.umidade_franquia_pct != null) o.peso_pago_t = r(o.peso_umido_t * (1 - Math.max(0, u - o.umidade_franquia_pct) / 100), 4);
        else o.peso_pago_t = o.peso_base === 'tu' ? o.peso_umido_t : o.peso_seco_t;

        const modo = o.preco_modo || 'ponto';
        o.preco_t = modo === 'ponto' ? r((o.preco_ponto || 0) * (o.teor || 0), 4)
            : modo === 'tonelada' ? (o.preco_t_informado == null ? null : o.preco_t_informado) : null;
        const bruto = modo === 'total' ? o.valor_informado
            : (o.peso_pago_t == null || o.preco_t == null ? null : o.peso_pago_t * o.preco_t);
        o.valor_venda = r((bruto || 0) + (o.ajuste || 0), 2);
        const tu = o.peso_umido_t || 0;
        o.frete_total = r(o.frete_base === 'viagem' ? (o.frete_unit || 0) : tu * (o.frete_unit || 0), 2);
        o.carregamento_total = r(o.carregamento_base === 'viagem' ? (o.carregamento_unit || 0) : tu * (o.carregamento_unit || 0), 2);
        o.impostos_total = r(Math.max(o.valor_venda, 0) * (o.impostos_pct || 0) / 100, 2);
        o.despesas_total = r(despesas || 0, 2);
        o.lucro = r(o.valor_venda - (o.custo_minerio || 0) - o.frete_total - o.carregamento_total
            - o.impostos_total - (o.outros_custos || 0) - o.despesas_total, 2);
        return o;
    }

    /** CSV p/ Excel pt-BR: BOM + ";" + vírgula decimal */
    function csv(colunas, linhas) {
        const cel = (v) => {
            if (v == null) return '';
            if (typeof v === 'number') return isFinite(v) ? String(v).replace('.', ',') : '';
            const s = String(v);
            return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const out = [colunas.map((c) => cel(c.titulo)).join(';')];
        linhas.forEach((l) => out.push(colunas.map((c) => cel(c.v(l))).join(';')));
        return '\uFEFF' + out.join('\r\n') + '\r\n';
    }
    function dataBR(iso) {
        if (!iso) return '';
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso);
    }

    const api = { parseBR, fmtNum, fmtBRL, fmtT, numInput, calcCarrada, csv, dataBR };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GestorCalc = api;
})(typeof window !== 'undefined' ? window : this);
