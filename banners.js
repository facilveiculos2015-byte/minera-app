/* Banners pagos de empresas (SQL 50) — carrossel do Início, fluxo "Anuncie sua empresa", Pix, Meus banners.
 * window.MineraBanners = { disponivel(), preco(), ativos(), slideHtml(b), slideAnuncieHtml(), abrirCriar(), abrirPix(b), renderMeus(el) }
 * Sem SQL 50 → disponivel() = false (Início/Perfil escondem tudo). */
(function () {
    'use strict';
    const BUCKET = 'banners';
    const W = 1600, H = 600; // moldura 16:6 do carrossel
    const LS_SEM = 'minera_banners_sem50';
    const DIAS = 30;
    let precoCache = null, dispCache = null, pixCache = null;

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // config.js declara 'const supabaseClient' (global léxico, não fica em window)
    const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : window.supabaseClient);
    const toast = (t) => { if (typeof window.toastMsg === 'function') window.toastMsg(t); else console.log(t); };
    const brl = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
    function ausente(err) {
        const c = (err && err.code) || '', m = (err && err.message) || '';
        return c === 'PGRST202' || c === 'PGRST205' || c === '42883' || c === '42P01' || /Could not find the (function|table)|does not exist|schema cache/i.test(m);
    }
    function semLer() { try { const t = Number(localStorage.getItem(LS_SEM) || 0); return !!t && Date.now() - t < 15 * 60e3; } catch (e) { return false; } }
    function semGravar(v) { try { if (v) localStorage.setItem(LS_SEM, String(Date.now())); else localStorage.removeItem(LS_SEM); } catch (e) { /* ignore */ } }

    async function uid() {
        try { const { data } = await sb().auth.getSession(); return (data && data.session && data.session.user && data.session.user.id) || null; } catch (e) { return null; }
    }
    /** Sonda o SQL 50 (banner_preco). Cache 15 min quando ausente. */
    async function disponivel() {
        if (dispCache != null) return dispCache;
        if (!sb() || semLer()) return (dispCache = false);
        try {
            const r = await sb().rpc('banner_preco');
            if (r.error) { if (ausente(r.error)) semGravar(true); return (dispCache = false); }
            semGravar(false);
            precoCache = Number(r.data) || 99.9;
            return (dispCache = true);
        } catch (e) { return (dispCache = false); }
    }
    async function preco(forcar) {
        if (precoCache != null && !forcar) return precoCache;
        try { const r = await sb().rpc('banner_preco'); if (!r.error) precoCache = Number(r.data) || 99.9; } catch (e) { /* ignore */ }
        return precoCache || 99.9;
    }
    async function ativos() {
        if (!(await disponivel())) return [];
        try { const r = await sb().rpc('banners_pagos_ativos'); return r.error ? [] : (r.data || []); } catch (e) { return []; }
    }
    function waLink(w) { const d = String(w || '').replace(/[^0-9]/g, ''); if (!d) return ''; return 'https://wa.me/' + (d.length <= 11 ? '55' + d : d); }
    function hrefDe(b) { return (b.link && /^https?:[/][/]/i.test(b.link)) ? b.link : waLink(b.whatsapp); }

    /** Slide do carrossel (mesmo HTML usado na prévia). */
    function slideHtml(b, opts) {
        opts = opts || {};
        const img = '<img src="' + esc(b.imagem_url) + '" alt="' + esc(b.titulo || 'Anúncio') + '" class="olx-banner-fullimg" loading="lazy">';
        const tag = '<span class="bp-tag">Patrocinado</span>';
        const tit = b.titulo ? '<span class="bp-tit">' + esc(b.titulo) + '</span>' : '';
        const inner = img + tag + tit;
        const href = hrefDe(b);
        if (href && !opts.preview) return '<a class="olx-banner-slide olx-banner-slide--full bp-slide" href="' + esc((typeof mineraSafeUrl === 'function' ? mineraSafeUrl : String)(href)) + '" target="_blank" rel="noopener sponsored">' + inner + '</a>';
        return '<div class="olx-banner-slide olx-banner-slide--full bp-slide">' + inner + '</div>';
    }
    function slideAnuncieHtml() {
        return '<button type="button" class="olx-banner-slide bp-anuncie" data-bp-anuncie="1">' +
            '<span class="bp-anuncie-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></g></svg></span>' +
            '<span class="bp-anuncie-txt"><strong>Anuncie sua empresa aqui</strong><span>Seu banner para todo o Minera Pará</span></span>' +
            '<span class="bp-anuncie-cta">Anunciar</span></button>';
    }

    /* ---------------- imagem: encaixe 16:6 + WebP ---------------- */
    function lerImagem(file) {
        return new Promise((res, rej) => {
            const url = URL.createObjectURL(file); const img = new Image();
            img.onload = () => res({ img, url });
            img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Não foi possível ler a imagem.')); };
            img.src = url;
        });
    }
    /** modo 'cobrir' (preenche, corta as sobras; pos 0..100 desloca) ou 'inteira' (logo, sem cortar, com fundo). */
    function desenhar(canvas, img, o) {
        canvas.width = W; canvas.height = H;
        const g = canvas.getContext('2d');
        const sw = img.naturalWidth, sh = img.naturalHeight;
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        if (o.modo === 'inteira') {
            g.fillStyle = o.fundo || '#0b1220'; g.fillRect(0, 0, W, H);
            const pad = 0.08;
            const s = Math.min(W * (1 - pad) / sw, H * (1 - pad * 2) / sh);
            const dw = sw * s, dh = sh * s;
            g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } else {
            const s = Math.max(W / sw, H / sh);
            const dw = sw * s, dh = sh * s;
            const f = (o.pos == null ? 50 : o.pos) / 100;
            g.drawImage(img, (W - dw) * (dw > W ? f : 0.5), (H - dh) * (dh > H ? f : 0.5), dw, dh);
        }
    }
    function canvasBlob(canvas) {
        return new Promise((res) => {
            canvas.toBlob((b) => {
                if (b && b.type === 'image/webp' && b.size < 1900000) return res(b);
                canvas.toBlob((j) => res(j), 'image/jpeg', 0.86); // Safari antigo: sem WebP
            }, 'image/webp', 0.84);
        });
    }

    /* ---------------- Pix ---------------- */
    function carregarScript(src, teste) {
        return new Promise((res) => {
            if (teste()) return res(true);
            const s = document.createElement('script'); s.src = src; s.async = true;
            s.onload = () => res(teste()); s.onerror = () => res(false);
            document.head.appendChild(s);
        });
    }
    async function pixAtivo() {
        if (pixCache) return pixCache;
        try {
            const { data } = await sb().from('pix_admin').select('*').eq('ativo', true)
                .order('atualizado_em', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(1);
            pixCache = (data && data[0]) || null;
        } catch (e) { pixCache = null; }
        return pixCache;
    }
    async function copiar(t) {
        try { if (window.PixBrCode) await PixBrCode.copiarTexto(t); else await navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
    }

    /* ---------------- modal base ---------------- */
    function modal(html, cls) {
        fechar();
        const m = document.createElement('div');
        m.id = 'bp-modal'; m.className = 'bp-modal ' + (cls || '');
        m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
        m.innerHTML = '<div class="bp-backdrop" data-bp-fechar="1"></div><div class="bp-panel">' +
            '<button type="button" class="bp-x" data-bp-fechar="1" aria-label="Fechar">×</button>' + html + '</div>';
        document.body.appendChild(m);
        document.body.classList.add('bp-aberto');
        m.addEventListener('click', (e) => { if (e.target.closest('[data-bp-fechar]')) fechar(); });
        requestAnimationFrame(() => m.classList.add('aberto'));
        return m;
    }
    function fechar() {
        const m = $('bp-modal'); if (m) m.remove();
        document.body.classList.remove('bp-aberto');
    }

    /* ---------------- fluxo criar ---------------- */
    async function abrirCriar() {
        if (!(await disponivel())) { toast('Anúncios de empresas em breve.'); return; }
        const meu = await uid();
        if (!meu) { toast('Entre na sua conta para anunciar.'); return; }
        const valor = await preco(true);
        const m = modal(
            '<h2 class="bp-h">Anuncie sua empresa</h2>' +
            '<p class="bp-sub">Seu banner no carrossel do Início para todos os usuários. <strong>' + esc(brl(valor)) + ' por mês</strong> (30 dias).</p>' +
            '<div class="bp-prev-wrap"><div class="olx-banner bp-prev" id="bp-prev"><div class="olx-banner-track"><div class="olx-banner-slide bp-vazio"><span>Prévia do banner</span><small>Proporção 16:6 (ex.: 1600 × 600)</small></div></div></div></div>' +
            '<label class="bp-file btn-ok" for="bp-file"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/></g></svg><span id="bp-file-txt">Escolher banner ou logo</span></label>' +
            '<input type="file" id="bp-file" accept="image/*" class="oculto">' +
            '<div class="bp-ajustes oculto" id="bp-ajustes">' +
            '<div class="bp-seg" role="radiogroup" aria-label="Encaixe"><button type="button" class="on" data-bp-modo="cobrir">Preencher</button><button type="button" data-bp-modo="inteira">Logo inteira</button></div>' +
            '<label class="bp-range" id="bp-pos-wrap">Posição<input type="range" id="bp-pos" min="0" max="100" value="50"></label>' +
            '<div class="bp-fundos oculto" id="bp-fundos" aria-label="Cor do fundo">' +
            ['#0b1220', '#ffffff', '#F5A623', '#14532d', '#1e3a8a'].map((c, i) => '<button type="button" class="bp-fundo' + (i ? '' : ' on') + '" data-bp-fundo="' + c + '" style="background:' + c + '" aria-label="Fundo ' + c + '"></button>').join('') +
            '</div></div>' +
            '<label for="bp-titulo">Título <span class="bp-opc">(opcional)</span></label>' +
            '<input type="text" id="bp-titulo" maxlength="60" placeholder="Ex.: Britagem São João — orçamento grátis" autocomplete="off">' +
            '<label for="bp-link">Link do site <span class="bp-opc">(opcional)</span></label>' +
            '<input type="url" id="bp-link" maxlength="300" placeholder="https://suaempresa.com.br" inputmode="url" autocomplete="off">' +
            '<label for="bp-wa">WhatsApp da empresa <span class="bp-opc">(opcional — usado se não houver link)</span></label>' +
            '<input type="tel" id="bp-wa" maxlength="20" placeholder="(91) 9 0000-0000" inputmode="tel" autocomplete="off">' +
            '<p class="bp-msg" id="bp-msg" aria-live="polite"></p>' +
            '<div class="bp-acoes"><button type="button" class="btn-ghost" data-bp-fechar="1">Cancelar</button><button type="button" class="btn-ok" id="bp-confirmar" disabled>Confirmar e pagar</button></div>');
        const st = { img: null, url: null, modo: 'cobrir', pos: 50, fundo: '#0b1220', canvas: document.createElement('canvas') };
        const prev = () => {
            const box = $('bp-prev'); if (!box || !st.img) return;
            desenhar(st.canvas, st.img, st);
            const url = st.canvas.toDataURL('image/jpeg', 0.8);
            const b = { imagem_url: url, titulo: ($('bp-titulo').value || '').trim() };
            box.querySelector('.olx-banner-track').innerHTML = slideHtml(b, { preview: true });
        };
        $('bp-file').addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0]; e.target.value = '';
            if (!f) return;
            if (!/^image[/]/.test(f.type)) { $('bp-msg').textContent = 'Escolha uma imagem.'; return; }
            try {
                if (st.url) URL.revokeObjectURL(st.url);
                const r = await lerImagem(f); st.img = r.img; st.url = r.url;
                // logo quase quadrada → começa em "inteira"
                const ratio = r.img.naturalWidth / r.img.naturalHeight;
                setModo(ratio < 1.6 ? 'inteira' : 'cobrir');
                $('bp-ajustes').classList.remove('oculto');
                $('bp-file-txt').textContent = 'Trocar imagem';
                $('bp-confirmar').disabled = false; $('bp-msg').textContent = '';
                prev();
            } catch (err) { $('bp-msg').textContent = err.message; }
        });
        function setModo(md) {
            st.modo = md;
            m.querySelectorAll('[data-bp-modo]').forEach(b => b.classList.toggle('on', b.getAttribute('data-bp-modo') === md));
            $('bp-pos-wrap').classList.toggle('oculto', md !== 'cobrir');
            $('bp-fundos').classList.toggle('oculto', md !== 'inteira');
        }
        m.querySelectorAll('[data-bp-modo]').forEach(b => b.addEventListener('click', () => { setModo(b.getAttribute('data-bp-modo')); prev(); }));
        m.querySelectorAll('[data-bp-fundo]').forEach(b => b.addEventListener('click', () => {
            st.fundo = b.getAttribute('data-bp-fundo');
            m.querySelectorAll('[data-bp-fundo]').forEach(x => x.classList.toggle('on', x === b)); prev();
        }));
        $('bp-pos').addEventListener('input', (e) => { st.pos = Number(e.target.value); prev(); });
        let tT = 0; $('bp-titulo').addEventListener('input', () => { clearTimeout(tT); tT = setTimeout(prev, 150); });
        $('bp-confirmar').addEventListener('click', async () => {
            const btn = $('bp-confirmar'), msg = $('bp-msg');
            let link = ($('bp-link').value || '').trim();
            if (link && !/^https?:[/][/]/i.test(link)) link = 'https://' + link;
            if (link && !/^https?:[/][/][^ ]+[.][^ ]+/i.test(link)) { msg.textContent = 'Link inválido. Ex.: https://suaempresa.com.br'; return; }
            const wa = ($('bp-wa').value || '').replace(/[^0-9]/g, '');
            if (wa && (wa.length < 10 || wa.length > 13)) { msg.textContent = 'WhatsApp inválido — use DDD + número.'; return; }
            btn.disabled = true; msg.textContent = 'Enviando banner…';
            try {
                desenhar(st.canvas, st.img, st);
                const blob = await canvasBlob(st.canvas);
                const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
                const path = meu + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
                const up = await sb().storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
                if (up.error) throw up.error;
                const pub = sb().storage.from(BUCKET).getPublicUrl(path);
                const url = pub && pub.data && pub.data.publicUrl;
                const ins = await sb().from('banners_pagos').insert([{ auth_id: meu, imagem_url: url, titulo: ($('bp-titulo').value || '').trim() || null, link: link || null, whatsapp: wa || null }]).select('*').single();
                if (ins.error) { try { await sb().storage.from(BUCKET).remove([path]); } catch (e2) { /* ignore */ } throw ins.error; }
                if (st.url) URL.revokeObjectURL(st.url);
                document.dispatchEvent(new CustomEvent('minera:banners-mudou'));
                abrirPix(ins.data, { novo: true });
            } catch (err) {
                console.warn('banner', err);
                msg.textContent = 'Não foi possível criar o banner: ' + ((err && err.message) || err);
                btn.disabled = false;
            }
        });
    }

    /* ---------------- passo Pix ---------------- */
    async function abrirPix(b, opts) {
        opts = opts || {};
        const valor = await preco(true);
        const m = modal(
            '<h2 class="bp-h">' + (opts.renovar ? 'Renovar banner' : 'Pagamento do banner') + '</h2>' +
            '<div class="olx-banner bp-prev bp-prev-sm"><div class="olx-banner-track">' + slideHtml(b, { preview: true }) + '</div></div>' +
            '<p class="bp-status">' + (opts.novo ? 'Banner criado · <strong>aguardando pagamento</strong>' : 'Banner #' + esc(b.id)) + '</p>' +
            '<div class="bp-valor"><span>Valor (30 dias)</span><strong>' + esc(brl(valor)) + '</strong></div>' +
            '<div class="bp-pix" id="bp-pix"><p class="bp-sub">Carregando Pix…</p></div>' +
            '<ol class="bp-passos"><li>Pague o Pix de <strong>' + esc(brl(valor)) + '</strong> (QR ou Copia e Cola).</li>' +
            '<li><strong>Depois de pagar, envie o comprovante no Fale conosco</strong> (banner #' + esc(b.id) + ').</li>' +
            '<li>Toque em <em>Já enviei o comprovante</em>. O banner entra no ar quando o admin confirmar.</li></ol>' +
            '<div class="bp-acoes bp-acoes-col">' +
            '<a class="btn-ok bp-fale" href="perfil.html?banner=' + encodeURIComponent(b.id) + '#fale-conosco">💬 Enviar comprovante no Fale conosco</a>' +
            '<button type="button" class="btn-ghost" id="bp-ja-enviei">Já enviei o comprovante</button></div>' +
            '<p class="bp-msg" id="bp-msg" aria-live="polite"></p>');
        $('bp-ja-enviei').addEventListener('click', async () => {
            const r = await sb().rpc('banner_marcar_comprovante', { p_id: b.id });
            if (r.error) { $('bp-msg').textContent = 'Erro: ' + r.error.message; return; }
            toast('Obrigado! Vamos conferir e liberar seu banner.');
            document.dispatchEvent(new CustomEvent('minera:banners-mudou'));
            fechar();
        });
        const pix = await pixAtivo();
        const chave = (pix && pix.chave_pix) || '';
        const box = $('bp-pix'); if (!box || !m.isConnected) return;
        if (!chave) { box.innerHTML = '<p class="bp-sub">Chave Pix indisponível no momento. Fale conosco para pagar.</p>'; return; }
        await carregarScript('pix-brcode.js', () => typeof window.gerarPixCopiaCola === 'function');
        await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', () => typeof window.QRCode !== 'undefined');
        let payload = '';
        try {
            payload = window.gerarPixCopiaCola({ chave, nome: pix.titular || 'JeL empreendimentos', cidade: 'BELEM', valor: valor, txid: 'BANNER' + b.id });
        } catch (e) { payload = ''; }
        box.innerHTML = (payload ? '<div class="bp-qr" id="bp-qr" aria-label="QR Code Pix"></div>' : '') +
            '<div class="bp-chave"><span>Chave Pix' + (pix.tipo_chave ? ' (' + esc(pix.tipo_chave) + ')' : '') + '</span><strong>' + esc(chave) + '</strong>' +
            (pix.titular ? '<small>' + esc(pix.titular) + '</small>' : '') + '</div>' +
            '<div class="bp-copiar">' + (payload ? '<button type="button" class="btn-ok" id="bp-copiar-pix">Copiar Pix Copia e Cola</button>' : '') +
            '<button type="button" class="btn-ghost" id="bp-copiar-chave">Copiar chave</button></div>' +
            (payload ? '<textarea class="bp-payload" readonly rows="2" aria-label="Pix Copia e Cola">' + esc(payload) + '</textarea>' : '');
        if (payload && window.PixBrCode) PixBrCode.renderQr($('bp-qr'), payload, 180);
        const cp = $('bp-copiar-pix'); if (cp) cp.addEventListener('click', async () => toast((await copiar(payload)) ? 'Pix Copia e Cola copiado' : 'Não deu para copiar — segure o texto'));
        $('bp-copiar-chave').addEventListener('click', async () => toast((await copiar(chave)) ? 'Chave Pix copiada' : 'Não deu para copiar'));
    }

    /* ---------------- Meus banners (Perfil) ---------------- */
    function situacao(b) {
        const agora = Date.now(), ate = b.ativo_ate ? new Date(b.ativo_ate).getTime() : 0;
        const dias = ate ? Math.max(0, Math.ceil((ate - agora) / 86400000)) : 0;
        if (b.status === 'ativo' && ate > agora) {
            if (b.renovacao_pedida_em) return { k: 'ativo', txt: 'Ativo · ' + dias + (dias === 1 ? ' dia' : ' dias') + ' · renovação ' + (b.comprovante_em ? 'com comprovante enviado' : 'aguardando pagamento'), dias, renovando: true };
            return { k: dias <= 3 ? 'vencendo' : 'ativo', txt: 'Ativo · ' + (dias <= 1 ? 'vence em ' + (dias === 1 ? '1 dia' : 'menos de 1 dia') : dias + ' dias restantes'), dias };
        }
        if (b.status === 'ativo') return { k: 'vencido', txt: 'Vencido — não aparece mais no Início' };
        if (b.status === 'aguardando_pagamento') return { k: 'aguardando', txt: 'Aguardando pagamento' };
        if (b.status === 'comprovante_enviado') return { k: 'comprovante', txt: 'Comprovante enviado — aguardando liberação' };
        if (b.status === 'bloqueado') return { k: 'bloqueado', txt: 'Bloqueado' + (b.motivo ? ': ' + b.motivo : '') };
        if (b.status === 'recusado') return { k: 'recusado', txt: 'Recusado' + (b.motivo ? ': ' + b.motivo : '') };
        return { k: '', txt: b.status };
    }
    async function renderMeus(el) {
        if (!el) return;
        if (!(await disponivel())) { el.innerHTML = ''; return false; }
        const meu = await uid(); if (!meu) return false;
        const r = await sb().from('banners_pagos').select('*').eq('auth_id', meu).order('criado_em', { ascending: false });
        if (r.error) { el.innerHTML = '<p class="sub">Não foi possível carregar seus banners.</p>'; return true; }
        const lista = r.data || [];
        if (!lista.length) { el.innerHTML = '<p class="sub bp-vazio-lista">Você ainda não tem banners. Toque em <strong>Anunciar minha empresa</strong>.</p>'; return true; }
        el.innerHTML = lista.map(b => {
            const s = situacao(b);
            const podeRenovar = ['ativo', 'vencendo', 'vencido'].includes(s.k) && !s.renovando;
            const pendente = s.k === 'aguardando' || (s.renovando && !b.comprovante_em);
            return '<div class="bp-item" data-bp-id="' + esc(b.id) + '">' +
                '<div class="olx-banner bp-prev bp-prev-sm"><div class="olx-banner-track">' + slideHtml(b, { preview: true }) + '</div></div>' +
                '<div class="bp-item-info"><span class="bp-chip bp-chip-' + esc(s.k) + '">' + esc(s.txt) + '</span>' +
                (b.ativo_ate ? '<small>Vence em ' + esc(new Date(b.ativo_ate).toLocaleDateString('pt-BR')) + '</small>' : '<small>Criado em ' + esc(new Date(b.criado_em).toLocaleDateString('pt-BR')) + '</small>') + '</div>' +
                '<div class="bp-item-acoes">' +
                (pendente ? '<button type="button" class="btn-sm btn-ok" data-bp-act="pagar">Pagar / Pix</button>' : '') +
                (pendente ? '<button type="button" class="btn-sm" data-bp-act="enviei">Já enviei o comprovante</button>' : '') +
                (podeRenovar ? '<button type="button" class="btn-sm btn-ok" data-bp-act="renovar">Renovar</button>' : '') +
                '<button type="button" class="btn-sm btn-danger" data-bp-act="apagar">Apagar</button></div></div>';
        }).join('');
        el.querySelectorAll('[data-bp-act]').forEach(btn => btn.addEventListener('click', async () => {
            const id = Number(btn.closest('[data-bp-id]').getAttribute('data-bp-id'));
            const b = lista.find(x => Number(x.id) === id); if (!b) return;
            const act = btn.getAttribute('data-bp-act');
            if (act === 'pagar') return abrirPix(b);
            if (act === 'enviei') {
                const x = await sb().rpc('banner_marcar_comprovante', { p_id: id });
                if (x.error) return toast('Erro: ' + x.error.message);
                toast('Comprovante marcado como enviado'); return renderMeus(el);
            }
            if (act === 'renovar') {
                const x = await sb().rpc('banner_pedir_renovacao', { p_id: id });
                if (x.error) return toast('Erro: ' + x.error.message);
                renderMeus(el); return abrirPix(b, { renovar: true });
            }
            if (act === 'apagar') {
                if (!confirm('Apagar este banner? Ele sai do Início e não pode ser recuperado. Dias pagos restantes são perdidos.')) return;
                const x = await sb().from('banners_pagos').delete().eq('id', id);
                if (x.error) return toast('Erro: ' + x.error.message);
                try {
                    const marca = '/object/public/' + BUCKET + '/';
                    const i = String(b.imagem_url || '').indexOf(marca);
                    if (i >= 0) await sb().storage.from(BUCKET).remove([decodeURIComponent(b.imagem_url.slice(i + marca.length).split('?')[0])]);
                } catch (e) { /* ignore */ }
                toast('Banner apagado'); renderMeus(el);
            }
        }));
        return true;
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('bp-modal')) fechar(); });

    window.MineraBanners = { disponivel, preco, ativos, slideHtml, slideAnuncieHtml, abrirCriar, abrirPix, renderMeus, situacao, fechar, DIAS, _reset() { dispCache = null; semGravar(false); } };
})();
