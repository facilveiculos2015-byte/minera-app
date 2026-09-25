/* Minera Pará — visualizador de fotos em tela cheia (lightbox reutilizável).
 * API: window.MineraLightbox.open(urls, startIndex) / .close() / .isOpen()
 * Delegação: qualquer <img data-lightbox="grupo"> (ou img dentro de [data-lightbox-gallery])
 * abre o visualizador com todas as fotos do mesmo grupo, começando pela tocada.
 * Recursos: object-fit contain, swipe, setas (desktop), contador, pinça/duplo toque
 * para zoom com arrasto, Esc, botão X, toque no fundo e botão Voltar do Android
 * (pushState ao abrir, popstate fecha). Sem bibliotecas externas.
 */
(function () {
    'use strict';
    if (window.MineraLightbox) return;

    var MAX_SCALE = 5;
    var DOUBLE_TAP_SCALE = 2.5;
    var SWIPE_MIN = 50;

    var root, stage, imgEl, spinner, errEl, counter, btnPrev, btnNext, btnClose;
    var urls = [];
    var idx = 0;
    var isOpenFlag = false;
    var pushedState = false;
    var ignoreNextPop = false;
    var lastFocus = null;
    var loadToken = 0;
    var scrollLock = null;

    // zoom / pan
    var scale = 1, tx = 0, ty = 0;
    var pointers = new Map();
    var gesture = null;
    var lastTap = null;
    var suppressClickUntil = 0;

    function build() {
        if (root) return;
        root = document.createElement('div');
        root.className = 'mlb';
        root.id = 'minera-lightbox';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Visualizar foto');
        root.hidden = true;
        root.innerHTML =
            '<div class="mlb-stage">' +
            '<img class="mlb-img" alt="" draggable="false">' +
            '<div class="mlb-spinner" aria-hidden="true"></div>' +
            '<p class="mlb-err" hidden>Não foi possível carregar a imagem</p>' +
            '</div>' +
            '<div class="mlb-counter" aria-live="polite"></div>' +
            '<button type="button" class="mlb-btn mlb-close" aria-label="Fechar">&times;</button>' +
            '<button type="button" class="mlb-btn mlb-nav mlb-prev" aria-label="Foto anterior">&#8249;</button>' +
            '<button type="button" class="mlb-btn mlb-nav mlb-next" aria-label="Próxima foto">&#8250;</button>';
        document.body.appendChild(root);
        stage = root.querySelector('.mlb-stage');
        imgEl = root.querySelector('.mlb-img');
        spinner = root.querySelector('.mlb-spinner');
        errEl = root.querySelector('.mlb-err');
        counter = root.querySelector('.mlb-counter');
        btnClose = root.querySelector('.mlb-close');
        btnPrev = root.querySelector('.mlb-prev');
        btnNext = root.querySelector('.mlb-next');

        btnClose.addEventListener('click', function (e) { e.stopPropagation(); close(); });
        btnPrev.addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
        btnNext.addEventListener('click', function (e) { e.stopPropagation(); go(1); });

        stage.addEventListener('pointerdown', onPointerDown);
        stage.addEventListener('pointermove', onPointerMove);
        stage.addEventListener('pointerup', onPointerUp);
        stage.addEventListener('pointercancel', onPointerUp);
        stage.addEventListener('wheel', onWheel, { passive: false });
        // Safari iOS: impede zoom nativo da página por gesto dentro do overlay
        root.addEventListener('gesturestart', function (e) { e.preventDefault(); });
        root.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
        root.addEventListener('click', onRootClick);
    }

    /* ---------------- abrir / fechar ---------------- */
    function lockScroll() {
        var y = window.scrollY || window.pageYOffset || 0;
        var b = document.body, h = document.documentElement;
        scrollLock = {
            y: y,
            bPos: b.style.position, bTop: b.style.top, bLeft: b.style.left, bRight: b.style.right,
            bWidth: b.style.width, bOverflow: b.style.overflow, hOverflow: h.style.overflow
        };
        h.style.overflow = 'hidden';
        b.style.overflow = 'hidden';
        b.style.position = 'fixed';
        b.style.top = (-y) + 'px';
        b.style.left = '0';
        b.style.right = '0';
        b.style.width = '100%';
        h.classList.add('mlb-open');
    }
    function unlockScroll() {
        if (!scrollLock) return;
        var b = document.body, h = document.documentElement, s = scrollLock;
        b.style.position = s.bPos; b.style.top = s.bTop; b.style.left = s.bLeft; b.style.right = s.bRight;
        b.style.width = s.bWidth; b.style.overflow = s.bOverflow; h.style.overflow = s.hOverflow;
        h.classList.remove('mlb-open');
        try { window.scrollTo({ top: s.y, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, s.y); }
        scrollLock = null;
    }

    function open(list, startIndex) {
        list = (Array.isArray(list) ? list : [list]).map(function (u) { return String(u || '').trim(); }).filter(Boolean);
        if (!list.length) return;
        build();
        urls = list;
        idx = Math.min(Math.max(parseInt(startIndex, 10) || 0, 0), urls.length - 1);
        root.classList.toggle('mlb-single', urls.length < 2);
        if (!isOpenFlag) {
            isOpenFlag = true;
            lastFocus = document.activeElement;
            lockScroll();
            root.hidden = false;
            document.addEventListener('keydown', onKey, true);
            try {
                history.pushState({ mineraLightbox: true }, '');
                pushedState = true;
            } catch (e) { pushedState = false; }
            setTimeout(function () { try { btnClose.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 0);
        }
        show();
    }

    function hideUi() {
        if (!isOpenFlag) return;
        isOpenFlag = false;
        root.hidden = true;
        document.removeEventListener('keydown', onKey, true);
        pointers.clear();
        gesture = null;
        resetZoom(false);
        imgEl.removeAttribute('src');
        loadToken++;
        unlockScroll();
        if (lastFocus && typeof lastFocus.focus === 'function') {
            try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        lastFocus = null;
    }

    /** Fecha por X / fundo / Esc: remove também a entrada de histórico criada ao abrir. */
    function close() {
        if (!isOpenFlag) return;
        hideUi();
        if (pushedState) {
            pushedState = false;
            if (history.state && history.state.mineraLightbox) {
                ignoreNextPop = true;
                history.back();
            }
        }
    }

    window.addEventListener('popstate', function () {
        if (ignoreNextPop) { ignoreNextPop = false; return; }
        if (isOpenFlag) {
            pushedState = false; // a entrada já foi consumida pelo Voltar
            hideUi();
        }
    });

    /* ---------------- navegação entre fotos ---------------- */
    function go(delta) {
        if (urls.length < 2) return;
        var n = idx + delta;
        if (n < 0 || n >= urls.length) { bounce(); return; }
        idx = n;
        show();
    }
    function bounce() {
        setTransform(true);
    }

    function show() {
        resetZoom(false);
        var url = urls[idx];
        var token = ++loadToken;
        counter.textContent = (idx + 1) + ' / ' + urls.length;
        btnPrev.disabled = idx === 0;
        btnNext.disabled = idx === urls.length - 1;
        errEl.hidden = true;
        spinner.hidden = false;
        imgEl.classList.add('mlb-loading');
        imgEl.alt = 'Foto ' + (idx + 1) + ' de ' + urls.length;
        imgEl.onload = function () {
            if (token !== loadToken) return;
            spinner.hidden = true;
            imgEl.classList.remove('mlb-loading');
        };
        imgEl.onerror = function () {
            if (token !== loadToken) return;
            spinner.hidden = true;
            imgEl.classList.add('mlb-loading');
            errEl.hidden = false;
        };
        imgEl.src = url;
        if (imgEl.complete && imgEl.naturalWidth) imgEl.onload();
        // pré-carrega vizinhas
        [idx - 1, idx + 1].forEach(function (i) {
            if (i >= 0 && i < urls.length) { var p = new Image(); p.src = urls[i]; }
        });
    }

    /* ---------------- zoom / pan ---------------- */
    function stageRect() { return stage.getBoundingClientRect(); }
    /** Tamanho da imagem renderizada (contain) em escala 1. */
    function contentSize() {
        var r = stageRect();
        var nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
        if (!nw || !nh) return { w: r.width, h: r.height };
        var k = Math.min(r.width / nw, r.height / nh);
        return { w: nw * k, h: nh * k };
    }
    function clampPan() {
        var r = stageRect(), c = contentSize();
        var mx = Math.max(0, (c.w * scale - r.width) / 2);
        var my = Math.max(0, (c.h * scale - r.height) / 2);
        tx = Math.min(mx, Math.max(-mx, tx));
        ty = Math.min(my, Math.max(-my, ty));
    }
    function setTransform(animate, swipeDx) {
        imgEl.style.transition = animate ? 'transform .22s ease-out' : 'none';
        var x = tx + (swipeDx || 0);
        imgEl.style.transform = 'translate3d(' + x + 'px,' + ty + 'px,0) scale(' + scale + ')';
        root.classList.toggle('mlb-zoomed', scale > 1.01);
    }
    function resetZoom(animate) {
        scale = 1; tx = 0; ty = 0;
        if (imgEl) setTransform(animate);
    }
    /** Zoom para `ns` mantendo o ponto (px,py) — relativo ao centro do palco — fixo. */
    function zoomAt(ns, px, py, animate) {
        ns = Math.min(MAX_SCALE, Math.max(1, ns));
        tx = px - (px - tx) * (ns / scale);
        ty = py - (py - ty) * (ns / scale);
        scale = ns;
        if (scale <= 1.01) { scale = 1; tx = 0; ty = 0; }
        clampPan();
        setTransform(animate);
    }
    function relToCenter(clientX, clientY) {
        var r = stageRect();
        return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
    }
    function insideImage(clientX, clientY) {
        var c = contentSize();
        var p = relToCenter(clientX, clientY);
        return Math.abs(p.x - tx) <= (c.w * scale) / 2 && Math.abs(p.y - ty) <= (c.h * scale) / 2;
    }

    function onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            gesture = { type: 'one', sx: e.clientX, sy: e.clientY, stx: tx, sty: ty, moved: false, t: Date.now() };
        } else if (pointers.size === 2) {
            var pts = Array.from(pointers.values());
            var mid = relToCenter((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
            gesture = {
                type: 'pinch',
                dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
                scale: scale, mx: mid.x, my: mid.y, stx: tx, sty: ty, moved: true
            };
        }
    }
    function onPointerMove(e) {
        if (!pointers.has(e.pointerId) || !gesture) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture.type === 'pinch' && pointers.size >= 2) {
            var pts = Array.from(pointers.values());
            var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            var mid = relToCenter((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
            var ns = Math.min(MAX_SCALE, Math.max(1, gesture.scale * d / gesture.dist));
            var k = ns / gesture.scale;
            scale = ns;
            tx = mid.x - (gesture.mx - gesture.stx) * k;
            ty = mid.y - (gesture.my - gesture.sty) * k;
            clampPan();
            setTransform(false);
            return;
        }
        if (gesture.type !== 'one') return;
        var dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
        if (!gesture.moved && Math.hypot(dx, dy) > 8) gesture.moved = true;
        if (!gesture.moved) return;
        if (scale > 1.01) {
            // com zoom: arrasta (pan) em vez de trocar de foto
            tx = gesture.stx + dx; ty = gesture.sty + dy;
            clampPan();
            setTransform(false);
        } else if (urls.length > 1) {
            gesture.swipe = true;
            var edge = (idx === 0 && dx > 0) || (idx === urls.length - 1 && dx < 0);
            setTransform(false, edge ? dx * 0.3 : dx);
        }
    }
    function onPointerUp(e) {
        if (!pointers.has(e.pointerId)) return;
        var start = pointers.get(e.pointerId);
        pointers.delete(e.pointerId);
        if (!gesture) return;
        if (gesture.type === 'pinch') {
            if (pointers.size === 1) {
                // continua como pan com o dedo restante
                var p = Array.from(pointers.values())[0];
                gesture = { type: 'one', sx: p.x, sy: p.y, stx: tx, sty: ty, moved: true, t: Date.now() };
            } else if (pointers.size === 0) {
                gesture = null;
                if (scale <= 1.05) resetZoom(true);
                suppressClickUntil = Date.now() + 350;
            }
            return;
        }
        if (pointers.size > 0) return;
        var g = gesture;
        gesture = null;
        var dx = e.clientX - g.sx;
        if (g.moved) {
            suppressClickUntil = Date.now() + 350;
            if (g.swipe && scale <= 1.01) {
                if (dx <= -SWIPE_MIN && idx < urls.length - 1) { go(1); return; }
                if (dx >= SWIPE_MIN && idx > 0) { go(-1); return; }
                setTransform(true);
            }
            return;
        }
        // toque simples: detectar duplo toque
        var now = Date.now();
        var onImg = insideImage(e.clientX, e.clientY) && !imgEl.classList.contains('mlb-loading');
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40 && onImg) {
            lastTap = null;
            suppressClickUntil = now + 350;
            if (scale > 1.01) resetZoom(true);
            else {
                var pt = relToCenter(e.clientX, e.clientY);
                zoomAt(DOUBLE_TAP_SCALE, pt.x, pt.y, true);
            }
            return;
        }
        lastTap = { t: now, x: e.clientX, y: e.clientY };
        void start;
    }
    function onWheel(e) {
        if (!isOpenFlag) return;
        e.preventDefault();
        var pt = relToCenter(e.clientX, e.clientY);
        var f = Math.exp(-e.deltaY * 0.0025);
        zoomAt(scale * f, pt.x, pt.y, false);
    }

    function onRootClick(e) {
        if (Date.now() < suppressClickUntil) return;
        if (e.target.closest && e.target.closest('.mlb-btn')) return;
        if (scale > 1.01) return; // com zoom, toque simples não fecha
        var onImg = insideImage(e.clientX, e.clientY) && !imgEl.classList.contains('mlb-loading');
        if (!onImg) close();
    }

    function onKey(e) {
        if (!isOpenFlag) return;
        if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        else if (e.key === 'Tab') {
            // mantém o foco dentro do diálogo
            var f = Array.from(root.querySelectorAll('.mlb-btn')).filter(function (b) {
                return !b.disabled && b.offsetParent !== null;
            });
            if (!f.length) return;
            var i = f.indexOf(document.activeElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
        }
    }

    /* ---------------- delegação ---------------- */
    function srcOf(img) {
        return img.getAttribute('data-lightbox-src') || img.currentSrc || img.getAttribute('src') || '';
    }
    function groupFor(img) {
        var gal = img.closest('[data-lightbox-gallery]');
        var list;
        if (gal) list = Array.from(gal.querySelectorAll('img'));
        else {
            var g = img.getAttribute('data-lightbox');
            list = g
                ? Array.from(document.querySelectorAll('img[data-lightbox]')).filter(function (x) { return x.getAttribute('data-lightbox') === g; })
                : [img];
        }
        list = list.filter(function (x) { return !!srcOf(x); });
        return { urls: list.map(srcOf), index: Math.max(0, list.indexOf(img)) };
    }
    function targetImg(el) {
        if (!el || !el.closest) return null;
        var img = el.closest('img[data-lightbox], [data-lightbox-gallery] img');
        if (!img || img.closest('#minera-lightbox')) return null;
        return img;
    }
    function openFromImg(img) {
        var g = groupFor(img);
        open(g.urls, g.index);
    }
    document.addEventListener('click', function (e) {
        var img = targetImg(e.target);
        if (!img) return;
        e.preventDefault();
        e.stopPropagation();
        openFromImg(img);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var img = targetImg(e.target);
        if (!img) return;
        e.preventDefault();
        openFromImg(img);
    });

    /** Deixa miniaturas acessíveis (foco, papel de botão, rótulo). */
    function enhance(scope) {
        var list = (scope || document).querySelectorAll('img[data-lightbox], [data-lightbox-gallery] img');
        Array.prototype.forEach.call(list, function (img) {
            if (img.getAttribute('data-mlb-ready')) return;
            img.setAttribute('data-mlb-ready', '1');
            if (!img.hasAttribute('tabindex')) img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            if (!img.getAttribute('aria-label')) {
                var g = groupFor(img);
                img.setAttribute('aria-label', 'Ampliar foto' + (g.urls.length > 1 ? ' ' + (g.index + 1) + ' de ' + g.urls.length : ''));
            }
        });
    }
    function startObserver() {
        enhance(document);
        if (!window.MutationObserver) return;
        var pending = false;
        new MutationObserver(function () {
            if (pending) return;
            pending = true;
            (window.requestAnimationFrame || setTimeout)(function () { pending = false; enhance(document); });
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver);

    window.MineraLightbox = {
        open: open,
        close: close,
        isOpen: function () { return isOpenFlag; },
        next: function () { go(1); },
        prev: function () { go(-1); },
        enhance: enhance,
        _state: function () { return { index: idx, total: urls.length, scale: scale, tx: tx, ty: ty }; }
    };
})();
