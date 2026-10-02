/* Admin — Banners pagos (SQL 50): filtros com contadores, liberar/bloquear/recusar, preço, totais por mês. */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : window.supabaseClient);
    const brl = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
    const dt = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const DIA = 86400000;
    let dados = [], filtro = 'pendentes', precoAtual = 99.9;

    const FILTROS = [
        ['pendentes', 'Aguardando pagamento'],
        ['comprovante', 'Comprovante enviado'],
        ['ativos', 'Ativos'],
        ['vencendo', 'Vencendo (≤3 dias)'],
        ['vencidos', 'Vencidos / p/ bloquear'],
        ['bloqueados', 'Bloqueados / Recusados'],
        ['todos', 'Todos']
    ];
    function grupo(b) {
        const ate = b.ativo_ate ? new Date(b.ativo_ate).getTime() : 0, agora = Date.now();
        const g = new Set(['todos']);
        if (b.status === 'aguardando_pagamento') g.add('pendentes');
        if (b.status === 'comprovante_enviado') g.add('comprovante');
        if (b.status === 'ativo' && ate > agora) {
            g.add('ativos');
            if (ate - agora <= 3 * DIA) g.add('vencendo');
            if (b.renovacao_pedida_em) g.add(b.comprovante_em ? 'comprovante' : 'pendentes');
        }
        if (b.status === 'ativo' && ate <= agora) g.add('vencidos');
        if (b.status === 'bloqueado' || b.status === 'recusado') g.add('bloqueados');
        return g;
    }
    function rotulo(b) {
        const ate = b.ativo_ate ? new Date(b.ativo_ate).getTime() : 0, agora = Date.now();
        if (b.status === 'ativo' && ate > agora) {
            const d = Math.ceil((ate - agora) / DIA);
            return ['ativo' + (d <= 3 ? ' vencendo' : ''), 'Ativo · ' + d + (d === 1 ? ' dia' : ' dias') + (b.renovacao_pedida_em ? ' · renovação ' + (b.comprovante_em ? 'c/ comprovante' : 'pedida') : '')];
        }
        if (b.status === 'ativo') return ['vencido', 'Vencido há ' + Math.max(1, Math.floor((agora - ate) / DIA)) + 'd'];
        return ({
            aguardando_pagamento: ['aguardando', 'Aguardando pagamento'],
            comprovante_enviado: ['comprovante', 'Comprovante enviado'],
            bloqueado: ['bloqueado', 'Bloqueado'],
            recusado: ['recusado', 'Recusado']
        })[b.status] || ['', b.status];
    }

    function renderFiltros() {
        const box = $('abp-filtros'); if (!box) return;
        const cont = {}; FILTROS.forEach(([k]) => { cont[k] = 0; });
        dados.forEach(b => grupo(b).forEach(k => { cont[k] = (cont[k] || 0) + 1; }));
        box.innerHTML = FILTROS.map(([k, t]) => '<button type="button" role="tab" class="abp-chip' + (k === filtro ? ' on' : '') + (cont[k] && (k === 'pendentes' || k === 'comprovante' || k === 'vencidos') ? ' alerta' : '') + '" data-f="' + k + '">' + esc(t) + ' <span>' + cont[k] + '</span></button>').join('');
        box.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filtro = b.getAttribute('data-f'); renderFiltros(); renderLista(); }));
        const badge = $('badge-banners-pend');
        const n = cont.pendentes + cont.comprovante;
        if (badge) { badge.textContent = String(cont.comprovante || n); badge.classList.toggle('oculto', !n); }
    }
    function renderLista() {
        const box = $('abp-lista'); if (!box) return;
        const lista = dados.filter(b => grupo(b).has(filtro));
        if (!lista.length) { box.innerHTML = '<p class="sub">Nenhum banner neste filtro.</p>'; return; }
        const MB = window.MineraBanners;
        box.innerHTML = lista.map(b => {
            const [cls, txt] = rotulo(b);
            const contato = [b.dono_email, b.dono_telefone].filter(Boolean).map(esc).join(' · ');
            const destino = b.link ? '<a href="' + esc(b.link) + '" target="_blank" rel="noopener">' + esc(b.link.slice(0, 48)) + '</a>' : (b.whatsapp ? 'WhatsApp ' + esc(b.whatsapp) : '—');
            return '<article class="abp-item" data-id="' + esc(b.id) + '">' +
                '<div class="olx-banner bp-prev bp-prev-sm"><div class="olx-banner-track">' + (MB ? MB.slideHtml(b, { preview: true }) : '<img src="' + esc(b.imagem_url) + '" alt="">') + '</div></div>' +
                '<div class="abp-info">' +
                '<div class="abp-linha1"><strong>#' + esc(b.id) + ' · ' + esc(b.dono_nome || b.dono_apelido || 'Usuário') + '</strong><span class="bp-chip bp-chip-' + esc(cls.split(' ')[0]) + (cls.indexOf('vencendo') >= 0 ? ' bp-chip-vencendo' : '') + '">' + esc(txt) + '</span></div>' +
                (b.titulo ? '<div class="abp-tit">' + esc(b.titulo) + '</div>' : '') +
                '<dl class="abp-dl">' +
                '<dt>Contato</dt><dd>' + (contato || '—') + (b.dono_apelido ? ' · @' + esc(b.dono_apelido) : '') + '</dd>' +
                '<dt>Destino</dt><dd>' + destino + '</dd>' +
                '<dt>Pago</dt><dd>' + (Number(b.n_pagamentos) ? esc(brl(b.ultimo_valor)) + ' (último) · total ' + esc(brl(b.total_pago)) + ' · ' + esc(b.n_pagamentos) + ' pagamento(s)' : 'nenhum') + '</dd>' +
                '<dt>Último pagto.</dt><dd>' + esc(dt(b.ultimo_pagamento_em)) + '</dd>' +
                '<dt>Liberado em</dt><dd>' + esc(dt(b.liberado_em)) + '</dd>' +
                '<dt>Vence em</dt><dd>' + esc(dt(b.ativo_ate)) + '</dd>' +
                '<dt>Criado</dt><dd>' + esc(dt(b.criado_em)) + (b.comprovante_em ? ' · comprovante ' + esc(dt(b.comprovante_em)) : '') + '</dd>' +
                (b.motivo ? '<dt>Motivo</dt><dd>' + esc(b.motivo) + '</dd>' : '') +
                '</dl>' +
                '<div class="abp-acoes">' +
                '<button type="button" class="btn-sm btn-ok" data-a="liberar">Liberar +30d</button>' +
                '<button type="button" class="btn-sm" data-a="comprovante">Ver comprovante</button>' +
                (b.status !== 'bloqueado' ? '<button type="button" class="btn-sm btn-danger" data-a="bloquear">Bloquear</button>' : '') +
                (b.status !== 'recusado' && b.status !== 'ativo' ? '<button type="button" class="btn-sm btn-danger" data-a="recusar">Recusar</button>' : '') +
                '</div></div></article>';
        }).join('');
        box.querySelectorAll('[data-a]').forEach(btn => btn.addEventListener('click', () => acao(btn.getAttribute('data-a'), Number(btn.closest('[data-id]').getAttribute('data-id')), btn)));
    }
    async function acao(a, id, btn) {
        const b = dados.find(x => Number(x.id) === id); if (!b) return;
        if (a === 'comprovante') return abrirComprovante(b.auth_id);
        let r;
        if (a === 'liberar') {
            const v = prompt('Valor recebido (R$) para 30 dias do banner #' + id + ':', String(precoAtual.toFixed(2)).replace('.', ','));
            if (v == null) return;
            const num = Number(String(v).replace(/[^0-9,.]/g, '').replace(',', '.'));
            if (!(num > 0)) { alert('Valor inválido'); return; }
            btn.disabled = true;
            r = await sb().rpc('banner_admin_liberar', { p_id: id, p_valor: num, p_dias: 30 });
            if (!r.error) toastA('Banner #' + id + ' liberado até ' + dt(r.data));
        } else {
            const motivo = prompt((a === 'bloquear' ? 'Bloquear' : 'Recusar') + ' banner #' + id + ' — motivo (opcional, o dono vê):', '');
            if (motivo == null) return;
            btn.disabled = true;
            r = await sb().rpc('banner_admin_status', { p_id: id, p_status: a === 'bloquear' ? 'bloqueado' : 'recusado', p_motivo: motivo });
            if (!r.error) toastA('Banner #' + id + (a === 'bloquear' ? ' bloqueado' : ' recusado'));
        }
        if (r && r.error) { alert('Erro: ' + r.error.message); btn.disabled = false; return; }
        carregar();
    }
    function toastA(t) { if (typeof window.toastMsg === 'function') window.toastMsg(t); }
    /** Abre a conversa do dono no "Suporte — Fale conosco" (aba Chat). */
    function abrirComprovante(authId) {
        const tab = document.querySelector('.admin-tab[data-tab="chat"]'); if (tab) tab.click();
        let n = 0;
        (function achar() {
            const th = document.querySelector('.suporte-thread[data-tid="' + CSS.escape(String(authId)) + '"]');
            if (th) {
                const head = th.querySelector('[data-act="toggle-thread"]');
                const body = th.querySelector('.suporte-thread-body');
                if (head && body && body.classList.contains('oculto')) head.click();
                th.scrollIntoView({ behavior: 'smooth', block: 'start' });
                th.classList.add('abp-destaque'); setTimeout(() => th.classList.remove('abp-destaque'), 2500);
                return;
            }
            if (++n < 20) return setTimeout(achar, 300);
            toastA('Nenhuma conversa de suporte deste usuário ainda.');
        })();
    }
    async function carregarTotais() {
        const box = $('abp-totais'); if (!box) return;
        const r = await sb().rpc('banner_admin_totais_mes');
        if (r.error || !r.data || !r.data.length) { box.textContent = r.error ? '—' : 'Nenhum pagamento registrado ainda.'; return; }
        box.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Mês</th><th>Pagamentos</th><th>Total</th></tr></thead><tbody>' +
            r.data.map(m => '<tr><td>' + esc(m.mes.slice(5) + '/' + m.mes.slice(0, 4)) + '</td><td>' + esc(m.n) + '</td><td><strong>' + esc(brl(m.total)) + '</strong></td></tr>').join('') + '</tbody></table></div>';
    }
    async function carregarPreco() {
        const r = await sb().rpc('banner_preco');
        if (!r.error) { precoAtual = Number(r.data) || 99.9; const i = $('abp-preco-in'); if (i && !i.value) i.value = precoAtual.toFixed(2).replace('.', ','); }
    }
    async function carregar() {
        const box = $('abp-lista'); if (!box) return;
        const r = await sb().rpc('banner_admin_lista');
        if (r.error) {
            const sem = /PGRST202|Could not find|does not exist/.test((r.error.code || '') + ' ' + (r.error.message || ''));
            box.innerHTML = '<p class="erro">' + esc(sem ? 'Aplique sql/50-banners-pagos.sql no Supabase.' : r.error.message) + '</p>';
            return;
        }
        dados = r.data || [];
        renderFiltros(); renderLista();
        carregarTotais(); carregarPreco();
    }
    function bind() {
        const s = $('abp-preco-salvar');
        if (s && !s._b) {
            s._b = true;
            s.addEventListener('click', async () => {
                const msg = $('abp-preco-msg');
                const v = Number(String(($('abp-preco-in') || {}).value || '').replace(/[^0-9,.]/g, '').replace(',', '.'));
                if (!(v > 0 && v < 100000)) { msg.textContent = 'Preço inválido'; msg.className = 'msg erro'; return; }
                const { data: u } = await sb().auth.getUser();
                const r = await sb().from('app_flags').upsert([{ key: 'banner_preco_mensal', value_text: v.toFixed(2), updated_by: u && u.user && u.user.id, updated_at: new Date().toISOString() }], { onConflict: 'key' });
                msg.textContent = r.error ? 'Erro: ' + r.error.message : 'Preço salvo: ' + brl(v);
                msg.className = 'msg ' + (r.error ? 'erro' : 'ok');
                if (!r.error) { precoAtual = v; ($('abp-preco-in') || {}).value = v.toFixed(2).replace('.', ','); }
            });
        }
        const tab = document.querySelector('.admin-tab[data-tab="banners"]');
        if (tab && !tab._abp) { tab._abp = true; tab.addEventListener('click', carregar); }
    }
    function iniciar() { bind(); setTimeout(carregar, 1200); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
    window.AdminBanners = { carregar };
})();
