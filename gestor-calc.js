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
        // peso líquido (t) e peso seco = líquido × (1 − umidade/100); preço sempre no seco
        o.peso_umido_t = o.peso_liquido_kg == null ? null : r(o.peso_liquido_kg / 1000, 4);
        o.peso_seco_t = o.peso_umido_t == null ? null : r(o.peso_umido_t * (1 - u / 100), 4);
        o.peso_pago_t = o.peso_seco_t;

        const modo = o.preco_modo || 'ponto';
        o.preco_t = modo === 'ponto' ? r((o.preco_ponto || 0) * (o.teor || 0), 4)
            : modo === 'tonelada' ? (o.preco_t_informado == null ? null : o.preco_t_informado) : null;
        const bruto = modo === 'total' ? o.valor_informado
            : (o.peso_pago_t == null || o.preco_t == null ? null : o.peso_pago_t * o.preco_t);
        o.valor_venda = r((bruto || 0) + (o.ajuste || 0), 2);
        const liq = o.peso_umido_t || 0; // frete/carregamento por tonelada = sobre o peso líquido
        o.frete_total = r(o.frete_base === 'viagem' ? (o.frete_unit || 0) : liq * (o.frete_unit || 0), 2);
        o.carregamento_total = r(o.carregamento_base === 'viagem' ? (o.carregamento_unit || 0) : liq * (o.carregamento_unit || 0), 2);
        o.impostos_total = r(Math.max(o.valor_venda, 0) * (o.impostos_pct || 0) / 100, 2);
        o.despesas_total = r(despesas || 0, 2);
        o.lucro = r(o.valor_venda - (o.custo_minerio || 0) - o.frete_total - o.carregamento_total
            - o.impostos_total - (o.outros_custos || 0) - o.despesas_total, 2);
        return o;
    }

    /** Tabela de preço: maior linha com teor <= teor da carga (faixa). null se abaixo da 1ª. */
    function lookupTabela(linhas, teor) {
        if (teor == null || !Array.isArray(linhas)) return null;
        let best = null;
        linhas.forEach((l) => {
            const t = Number(l.teor);
            if (isFinite(t) && t <= teor + 1e-9 && (!best || t > Number(best.teor))) best = l;
        });
        return best ? { teor: Number(best.teor), valor: Number(best.valor), exato: Math.abs(Number(best.teor) - teor) < 1e-9 } : null;
    }
    /** Colar da planilha: "teor<TAB ou ;>valor" por linha; aceita "40%", "R$ 10,00"; ignora cabeçalho */
    function parseTabelaColada(txt) {
        const out = [];
        String(txt || '').split(/\r?\n/).forEach((linha) => {
            const cols = linha.split(/\t|;/).map((c) => c.trim()).filter((c) => c !== '');
            if (cols.length < 2) return;
            const teor = parseBR(cols[0].replace('%', ''));
            const valor = parseBR(cols[1]);
            if (teor == null || valor == null || teor < 0 || teor > 100 || valor < 0) return;
            const i = out.findIndex((x) => x.teor === teor);
            if (i >= 0) out[i].valor = valor; else out.push({ teor, valor });
        });
        return out.sort((a, b) => a.teor - b.teor);
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

    /** Literal PDF (WinAnsi). Acentos pt-BR em U+00A0–U+00FF coincidem com WinAnsi. */
    function pdfLit(str) {
        let out = '';
        const s = String(str == null ? '' : str);
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            const b = c < 128 || (c >= 0xA0 && c <= 0xFF) ? c : 0x3F;
            if (b === 0x28 || b === 0x29 || b === 0x5C) out += '\\' + String.fromCharCode(b);
            else if (b === 0x0D) out += '\\r';
            else if (b === 0x0A) out += '\\n';
            else if (b >= 32 && b < 127) out += String.fromCharCode(b);
            else out += '\\' + ('000' + b.toString(8)).slice(-3);
        }
        return '(' + out + ')';
    }

    /** PDF texto simples (várias páginas A4). Retorna string ASCII pronta para Blob. */
    function pdfSimples(linhas) {
        const per = 46;
        const src = (Array.isArray(linhas) && linhas.length ? linhas : [' ']).map((l) =>
            String(l == null ? '' : l).replace(/[\r\n]+/g, ' ').slice(0, 100));
        const paginas = [];
        for (let i = 0; i < src.length; i += per) paginas.push(src.slice(i, i + per));
        const n = paginas.length;
        const objects = new Array(3 + n * 2);
        objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        const kids = [];
        paginas.forEach((ls, i) => {
            const pageId = 4 + i * 2;
            const contId = pageId + 1;
            kids.push(pageId + ' 0 R');
            const cmds = ['BT', '/F1 11 Tf', '48 800 Td', '14 TL'];
            ls.forEach((line, j) => {
                if (j) cmds.push('T*');
                cmds.push(pdfLit(line) + ' Tj');
            });
            cmds.push('ET');
            const stream = cmds.join('\n');
            objects[pageId - 1] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ' + contId +
                ' 0 R /Resources << /Font << /F1 3 0 R >> >> >>';
            objects[contId - 1] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
        });
        objects[1] = '<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>';

        let pdf = '%PDF-1.4\n';
        const xref = [0];
        objects.forEach((obj, i) => {
            xref.push(pdf.length);
            pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
        });
        const xrefPos = pdf.length;
        pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
        pdf += '0000000000 65535 f \n';
        for (let i = 1; i < xref.length; i++) pdf += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
        pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
        return pdf;
    }

    const api = { parseBR, fmtNum, fmtBRL, fmtT, numInput, calcCarrada, lookupTabela, parseTabelaColada, csv, dataBR, pdfSimples };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GestorCalc = api;
})(typeof window !== 'undefined' ? window : this);
