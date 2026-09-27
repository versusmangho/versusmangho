/* 팝업 — 게임 위에 떠 있는 작은 창 (Document Picture-in-Picture).
   웹페이지는 다른 프로그램 창 위에 그릴 수 없지만, Chrome·Edge의 문서 PiP 창은 항상 위에 떠 있어서
   게임을 창 모드·테두리 없는 창 모드로 켜 두면 그 위에 보인다. (독점 전체화면에서는 가려질 수 있다)
   창 배경은 투명하게 만들 수 없다 — 그래서 작고 어둡게 그린다.

   내용은 각 탭이 addSection으로 넣는다. 넣은 순서대로 왼쪽부터 놓인다
   (매칭 순서 = match/render.js → 왼쪽, 이번 판 곡 = floor/app.js → 오른쪽).
   solo()가 참인 칸이 있으면 그 칸만 그린다 (일망호 모드 → 층수 표만).
   팝업은 같은 페이지의 JS가 직접 그리므로 서버도 동기화도 필요 없다.

   갱신은 팝업 자신의 타이머로 돈다 — 게임을 보고 있으면 원래 탭은 가려진 상태라 타이머가 느려지지만,
   떠 있는 팝업은 보이는 창이라 제때 돈다. 그린 내용이 같으면 건드리지 않아 깜빡이지 않는다. */
(function (global) {
    'use strict';

    const TICK_MS = 500;
    const sections = [];   // { name, render: () => html | '', solo: () => bool }
    const changeListeners = [];
    let win = null, lastHtml = null;

    // 모양은 css/popup.css — 팝업 창은 따로 된 문서라 페이지 주소 기준 절대 경로로 읽힌다
    const CSS_URL = new URL('css/popup.css', document.baseURI).href;

    const supported = () => !!global.isSecureContext && 'documentPictureInPicture' in global;

    function render() {
        const solo = sections.filter(s => { try { return !!(s.solo && s.solo()); } catch { return false; } });
        return (solo.length ? solo : sections).map(s => {
            try { return s.render() || ''; }
            catch (e) { console.error('[Popup:' + s.name + ']', e); return ''; }
        }).join('') || '<p class="empty">표시할 내용이 없습니다</p>';
    }

    function update() {
        if (!win) return;
        const html = render();
        if (html === lastHtml) return;
        lastHtml = html;
        win.document.body.innerHTML = html;
    }

    function notifyChange() { changeListeners.forEach(cb => { try { cb(); } catch (e) { console.error('[Popup]', e); } }); }

    async function open() {
        if (win) return true;
        if (!supported()) return false;
        let w;
        try { w = await global.documentPictureInPicture.requestWindow({ width: 760, height: 300 }); }
        catch (e) { console.error('[Popup]', e); return false; }
        w.document.title = '버망호 도우미';
        w.document.head.innerHTML = `
            <meta charset="utf-8">
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Noto+Sans+KR:wght@400;600;700;900&display=swap">
            <link rel="stylesheet" href="${CSS_URL}">`;
        const timer = w.setInterval(update, TICK_MS);
        w.addEventListener('pagehide', () => {
            w.clearInterval(timer);
            if (win === w) { win = null; lastHtml = null; notifyChange(); }
        });
        win = w; lastHtml = null;
        update();
        notifyChange();
        return true;
    }

    function close() { if (win) win.close(); }

    function initButton() {
        const btn = document.getElementById('popup-btn');
        if (!btn) return;
        const sync = () => {
            btn.textContent = win ? '팝업 닫기' : '🪟 팝업';
            btn.classList.toggle('danger', !!win);
            btn.classList.toggle('secondary', !win);
        };
        changeListeners.push(sync);
        sync();
        if (!supported()) {
            btn.disabled = true;
            btn.title = global.isSecureContext ? 'Chrome·Edge(116 이상)에서만 쓸 수 있습니다' : 'localhost나 https로 열어야 쓸 수 있습니다';
            return;
        }
        btn.title = '매칭 순서와 이번 판 곡을 게임 위에 떠 있는 팝업으로 띄웁니다';
        btn.onclick = async () => {
            if (win) { close(); return; }
            if (await open()) return;
            // 기능은 있는데 창을 못 여는 브라우저(앱 안에 들어간 브라우저 등)가 있다
            btn.textContent = '이 브라우저에서는 띄울 수 없습니다';
            setTimeout(sync, 3000);
        };
    }

    const Popup = {
        /* render() → 이 칸의 HTML(<div class="sec ...">). 보여줄 게 없으면 빈 문자열. 같은 이름으로 다시 넣으면 갈아끼운다.
           opts.solo() → 참이면 다른 칸은 빼고 이 칸만 그린다 */
        addSection(name, renderFn, opts = {}) {
            const sec = { name, render: renderFn, solo: opts.solo || null };
            const i = sections.findIndex(s => s.name === name);
            if (i >= 0) sections[i] = sec;
            else sections.push(sec);
        },
        update,   // 내용이 바뀐 곳에서 바로 부르면 다음 타이머를 기다리지 않는다
        open, close,
        isOpen: () => !!win,
        supported
    };

    global.VMH = global.VMH || {};
    global.VMH.Popup = Popup;

    document.addEventListener('DOMContentLoaded', initButton);
    if (document.readyState !== 'loading') initButton();
})(window);
