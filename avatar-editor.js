/* Minera Pará — escolher/enviar foto de perfil (Perfil). Depende de avatar.js + supabaseClient.
 * Fluxo: [Avatares prontos] [Foto pessoal] [Logo da empresa] [Remover foto]
 * Foto/logo: recorte quadrado (arrastar + zoom) → 512×512 WebP/JPEG → bucket 'avatares/<uid>/'. */
(function () {
    'use strict';
    if (window.MineraAvatarEditor) return;
    var LADO = 512, VIEW = 260;
    var st = null; // estado do recorte

    function $(id) { return document.getElementById(id); }
    function toast(t) { if (typeof toastMsg === 'function') toastMsg(t); }
    function msg(t, ok) { var el = $('av-ed-msg'); if (el) { el.textContent = t || ''; el.className = 'msg ' + (t ? (ok === 'info' ? 'av-info' : (ok ? 'ok' : 'erro')) : ''); } }

    function montar() {
        if ($('av-editor')) return;
        var presets = MineraAvatar.PRESETS.map(function (p) {
            return '<button type="button" class="av-preset" data-preset="' + p.id + '" aria-label="' + p.nome + '"><img alt="" src="' + p.data + '"><span>' + p.nome + '</span></button>';
        }).join('');
        var el = document.createElement('div');
        el.id = 'av-editor';
        el.className = 'av-editor oculto';
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'av-ed-titulo');
        el.innerHTML =
            '<div class="av-ed-backdrop" data-av-fechar="1"></div>' +
            '<div class="av-ed-panel">' +
            '  <div class="av-ed-head"><h3 id="av-ed-titulo">Foto do perfil</h3><button type="button" class="av-ed-x" data-av-fechar="1" aria-label="Fechar">×</button></div>' +
            '  <div id="av-ed-escolha">' +
            '    <div class="av-ed-acoes">' +
            '      <label class="av-ed-acao" for="av-ed-foto"><span class="ai">📷</span>Foto pessoal</label>' +
            '      <label class="av-ed-acao" for="av-ed-logo"><span class="ai">🏢</span>Logo da empresa</label>' +
            '      <button type="button" class="av-ed-acao" id="av-ed-remover"><span class="ai">🔤</span>Remover foto</button>' +
            '    </div>' +
            '    <input type="file" id="av-ed-foto" accept="image/*" class="oculto">' +
            '    <input type="file" id="av-ed-logo" accept="image/*" class="oculto">' +
            '    <p class="av-ed-sub">Ou escolha um avatar pronto</p>' +
            '    <div class="av-ed-grade">' + presets + '</div>' +
            '  </div>' +
            '  <div id="av-ed-recorte" class="oculto">' +
            '    <p class="av-ed-sub">Arraste para posicionar e use o zoom</p>' +
            '    <div class="av-ed-area" id="av-ed-area"><canvas id="av-ed-canvas" width="' + VIEW * 2 + '" height="' + VIEW * 2 + '"></canvas><div class="av-ed-mascara" aria-hidden="true"></div></div>' +
            '    <label class="av-ed-zoom">➖<input type="range" id="av-ed-zoom" min="100" max="400" value="100" aria-label="Zoom">➕</label>' +
            '    <div class="av-ed-botoes"><button type="button" class="btn-ghost" id="av-ed-voltar">Voltar</button><button type="button" class="btn-ok" id="av-ed-salvar">Salvar foto</button></div>' +
            '  </div>' +
            '  <p id="av-ed-msg" class="msg"></p>' +
            '</div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (e) {
            if (e.target.getAttribute && e.target.getAttribute('data-av-fechar')) { fechar(); return; }
            var b = e.target.closest && e.target.closest('[data-preset]');
            if (b) salvarPreset(b.getAttribute('data-preset'));
        });
        $('av-ed-remover').addEventListener('click', remover);
        $('av-ed-foto').addEventListener('change', function (e) { arquivo(e, 'foto'); });
        $('av-ed-logo').addEventListener('change', function (e) { arquivo(e, 'empresa'); });
        $('av-ed-voltar').addEventListener('click', function () { mostrar('escolha'); });
        $('av-ed-salvar').addEventListener('click', salvarRecorte);
        // Toque direto no "Salvar": em alguns Android/WebView o Chrome não gera o
        // "click" depois de um arrasto no recorte (QA: touchend chegava, click não).
        // Tratamos o toque curto aqui; preventDefault evita o click duplicado.
        (function () {
            var b = $('av-ed-salvar'), t0 = null;
            b.addEventListener('touchstart', function (e) { var t = e.changedTouches && e.changedTouches[0]; t0 = t ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
            b.addEventListener('touchend', function (e) {
                var t = e.changedTouches && e.changedTouches[0], s0 = t0; t0 = null;
                if (!s0 || !t || Math.abs(t.clientX - s0.x) > 12 || Math.abs(t.clientY - s0.y) > 12) return;
                e.preventDefault(); salvarRecorte();
            });
        })();
        $('av-ed-zoom').addEventListener('input', function () { if (!st) return; zoomPara(Number(this.value) / 100); });
        bindArrasto($('av-ed-area'));
    }
    function mostrar(qual) {
        $('av-ed-escolha').classList.toggle('oculto', qual !== 'escolha');
        $('av-ed-recorte').classList.toggle('oculto', qual !== 'recorte');
        msg('');
    }
    function abrir() {
        montar();
        mostrar('escolha');
        $('av-editor').classList.remove('oculto');
        document.body.classList.add('av-editor-aberto');
        var me = uid(); var c = me && MineraAvatar.info(me);
        document.querySelectorAll('#av-editor .av-preset').forEach(function (b) { b.classList.toggle('on', !!(c && c.u === 'preset:' + b.getAttribute('data-preset'))); });
        if (MineraAvatar.semSql()) msg('A foto de perfil ainda está sendo ativada no servidor. Por enquanto aparecem suas iniciais.', 'info');
    }
    function fechar() { var e = $('av-editor'); if (e) e.classList.add('oculto'); document.body.classList.remove('av-editor-aberto'); st = null; }
    function uid() { try { return (typeof perfilAtual !== 'undefined' && perfilAtual && perfilAtual.auth_id) || null; } catch (e) { return null; } }

    async function gravar(url, tipo) {
        var me = uid();
        if (!me) { msg('Entre novamente.'); return false; }
        var r = await supabaseClient.from('usuarios').update({ avatar_url: url, avatar_tipo: tipo }).eq('auth_id', me).select('auth_id,avatar_url,avatar_tipo');
        if (r.error) {
            var cod = String(r.error.code || '');
            var semColuna = cod === 'PGRST204' || cod === '42703' || /does not exist|schema cache/i.test(r.error.message || '');
            if (cod !== '23514' && cod !== '42501' && !semColuna) console.warn('avatar: gravar', cod, r.error.message);
            msg(semColuna ? 'Foto de perfil ainda não ativada no servidor (falta o SQL 47). Suas iniciais continuam aparecendo.'
                : cod === '23514' ? 'O servidor recusou esta foto agora. Tente um avatar pronto ou tente de novo mais tarde.'
                : cod === '42501' ? 'Sem permissão para usar esta foto.'
                : 'Não foi possível salvar. Tente de novo.');
            return false;
        }
        if (!r.data || !r.data.length) { msg('Não foi possível salvar (sem permissão).'); return false; }
        MineraAvatar.esquecerSemSql();
        MineraAvatar.registrar(me, url, tipo);
        try { perfilAtual.avatar_url = url; perfilAtual.avatar_tipo = tipo; } catch (e) { /* ignore */ }
        document.querySelectorAll('[data-av-id="' + me + '"]').forEach(function (el) { el._avChave = null; MineraAvatar.pintar(el); });
        return true;
    }
    async function salvarPreset(id) {
        msg('Salvando…', true);
        if (await gravar('preset:' + id, 'avatar')) { toast('Avatar atualizado!'); fechar(); }
    }
    async function remover() {
        msg('Removendo…', true);
        var antes = MineraAvatar.info(uid());
        if (await gravar(null, 'iniciais')) { apagarArquivo(antes && antes.u); toast('Foto removida — mostrando suas iniciais.'); fechar(); }
    }
    function apagarArquivo(url) {
        var m = url && /\/object\/public\/avatares\/(.+)$/.exec(url);
        if (m) { try { supabaseClient.storage.from('avatares').remove([decodeURIComponent(m[1])]).then(function () {}, function () {}); } catch (e) { /* ignore */ } }
    }

    /* ---------- recorte ---------- */
    function arquivo(e, tipo) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (!/^image\//.test(f.type)) { msg('Escolha uma imagem.'); return; }
        if (f.size > 25 * 1024 * 1024) { msg('Imagem grande demais (máx. 25 MB).'); return; }
        var url = URL.createObjectURL(f);
        var img = new Image();
        img.onload = function () {
            var w = img.naturalWidth, h = img.naturalHeight;
            // foto: preenche o círculo (cover). logo: cabe inteira (contain) com fundo branco
            var cover = Math.max(VIEW / w, VIEW / h), contain = Math.min(VIEW / w, VIEW / h);
            var base = tipo === 'empresa' ? contain * 0.9 : cover;
            st = { img: img, url: url, tipo: tipo, base: base, z: 1, x: 0, y: 0, w: w, h: h };
            $('av-ed-zoom').value = 100;
            mostrar('recorte');
            desenhar();
        };
        img.onerror = function () { URL.revokeObjectURL(url); msg('Não foi possível abrir esta imagem.'); };
        img.src = url;
    }
    function limitar() {
        var s = st.base * st.z, mw = st.w * s, mh = st.h * s;
        var lx = Math.max(0, (mw - VIEW) / 2), ly = Math.max(0, (mh - VIEW) / 2);
        if (st.tipo === 'empresa') { lx = Math.max(lx, VIEW / 2); ly = Math.max(ly, VIEW / 2); }
        st.x = Math.max(-lx, Math.min(lx, st.x)); st.y = Math.max(-ly, Math.min(ly, st.y));
    }
    function desenharEm(ctx, lado) {
        var k = lado / VIEW, s = st.base * st.z * k;
        ctx.clearRect(0, 0, lado, lado);
        if (st.tipo === 'empresa') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, lado, lado); }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(st.img, lado / 2 + st.x * k - st.w * s / 2, lado / 2 + st.y * k - st.h * s / 2, st.w * s, st.h * s);
    }
    function desenhar() { limitar(); var c = $('av-ed-canvas'); desenharEm(c.getContext('2d'), c.width); }
    function zoomPara(z) { if (!st) return; st.z = Math.max(1, Math.min(4, z)); $('av-ed-zoom').value = Math.round(st.z * 100); desenhar(); }
    function bindArrasto(area) {
        var pts = {}, ini = null;
        area.addEventListener('pointerdown', function (e) {
            if (!st) return; area.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY };
            ini = { x: st.x, y: st.y, z: st.z, p: Object.assign({}, pts) };
        });
        area.addEventListener('pointermove', function (e) {
            if (!st || !pts[e.pointerId] || !ini) return;
            pts[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(pts);
            if (ids.length >= 2 && ini.p[ids[0]] && ini.p[ids[1]]) { // pinça
                var d0 = Math.hypot(ini.p[ids[0]].x - ini.p[ids[1]].x, ini.p[ids[0]].y - ini.p[ids[1]].y);
                var d1 = Math.hypot(pts[ids[0]].x - pts[ids[1]].x, pts[ids[0]].y - pts[ids[1]].y);
                if (d0 > 10) { st.z = Math.max(1, Math.min(4, ini.z * d1 / d0)); $('av-ed-zoom').value = Math.round(st.z * 100); }
            } else if (ini.p[e.pointerId]) {
                st.x = ini.x + (e.clientX - ini.p[e.pointerId].x); st.y = ini.y + (e.clientY - ini.p[e.pointerId].y);
            }
            desenhar();
        });
        var fim = function (e) { delete pts[e.pointerId]; ini = st ? { x: st.x, y: st.y, z: st.z, p: Object.assign({}, pts) } : null; };
        area.addEventListener('pointerup', fim); area.addEventListener('pointercancel', fim);
        area.addEventListener('wheel', function (e) { if (!st) return; e.preventDefault(); zoomPara(st.z * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
    }
    function blobDe(canvas) {
        return new Promise(function (res) {
            canvas.toBlob(function (b) {
                if (b && b.type === 'image/webp') return res(b);
                canvas.toBlob(function (j) { res(j); }, 'image/jpeg', 0.86);
            }, 'image/webp', 0.86);
        });
    }
    async function salvarRecorte() {
        if (!st) return;
        var me = uid(); if (!me) { msg('Entre novamente.'); return; }
        var btn = $('av-ed-salvar'); if (btn.disabled) return; btn.disabled = true;
        msg('Enviando…', true);
        try {
            var c = document.createElement('canvas'); c.width = LADO; c.height = LADO;
            desenharEm(c.getContext('2d'), LADO);
            var blob = await blobDe(c);
            if (!blob) throw new Error('Falha ao gerar a imagem');
            var ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
            var nome = (st.tipo === 'empresa' ? 'logo-' : 'foto-') + Date.now() + '.' + ext;
            var up = await supabaseClient.storage.from('avatares').upload(me + '/' + nome, blob, { upsert: false, contentType: blob.type, cacheControl: '31536000' });
            if (up.error) {
                var semBucket = /bucket|not found|row-level|policy|Unauthorized|403/i.test(up.error.message || '');
                throw new Error(semBucket ? 'Envio de foto ainda não ativado no servidor (falta o SQL 47).' : up.error.message);
            }
            var pub = supabaseClient.storage.from('avatares').getPublicUrl(up.data.path || (me + '/' + nome));
            var url = pub && pub.data && pub.data.publicUrl;
            window.__avatarPerf = { bytes: blob.size, tipo: blob.type, lado: LADO };
            var antes = MineraAvatar.info(me);
            if (await gravar(url, st.tipo)) {
                if (antes && antes.u && antes.u !== url) apagarArquivo(antes.u);
                URL.revokeObjectURL(st.url);
                toast(st.tipo === 'empresa' ? 'Logo salva!' : 'Foto salva!');
                fechar();
            } else {
                apagarArquivo(url);
            }
        } catch (e) {
            msg(e.message || 'Não foi possível enviar.');
        } finally { btn.disabled = false; }
    }

    window.MineraAvatarEditor = { abrir: abrir, fechar: fechar };

    document.addEventListener('click', function (ev) {
        var t = ev.target && ev.target.closest && ev.target.closest('#btn-perfil-foto, #btn-perfil-foto-link, [data-abrir-avatar]');
        if (!t) return;
        ev.preventDefault();
        abrir();
    });
})();
