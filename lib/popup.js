/* 팝업 — 게임 위에 떠 있는 작은 창 (Document Picture-in-Picture).
   웹페이지는 다른 프로그램 창 위에 그릴 수 없지만, Chrome·Edge의 문서 PiP 창은 항상 위에 떠 있어서
   게임을 창 모드·테두리 없는 창 모드로 켜 두면 그 위에 보인다. (독점 전체화면에서는 가려질 수 있다)
   창 배경은 투명하게 만들 수 없다 — 그래서 작고 어둡게 그린다.

   내용은 각 탭이 addSection으로 넣는다. 넣은 순서대로 왼쪽부터 놓인다
   (매칭 순서 = script.js → 왼쪽, 이번 판 곡 = floor/app.js → 오른쪽).
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

    const CSS = `
        * { box-sizing: border-box; }
        /* 창 크기를 바꾸면 글자도 같이 커진다 — 가로·세로 중 좁은 쪽에 맞춰 8명이 한 화면에 들어가게 */
        html { font-size: clamp(9px, min(2.1vw, 4.4vh), 24px); }
        body { margin: 0; height: 100vh; padding: .5em .6em; background: #0b1120; color: #f1f5f9;
               font-family: 'Noto Sans KR', system-ui, sans-serif; overflow: hidden; user-select: none;
               display: flex; align-items: flex-start; gap: .8em; }
        .sec { min-width: 0; }
        .sec + .sec { padding-left: .8em; border-left: 1px solid rgba(255,255,255,.1); align-self: stretch; }
        .sec h2 { margin: 0 0 .35em; font-size: .7rem; font-weight: 700; letter-spacing: .08em; color: #94a3b8; }
        .num { font-family: 'Orbitron', system-ui, sans-serif; font-weight: 700; }
        .empty { color: #64748b; font-size: .8rem; margin: .2em 0; }

        .queue { flex: 0 1 17em; }
        .q { display: grid; grid-template-columns: 1.3em minmax(0, 1fr) auto; align-items: center; gap: .45em; padding: .18em 0; }
        .q .rank { font-size: .8rem; color: #64748b; text-align: right; }
        .q.top .rank { color: #60a5fa; }
        .q .who { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .9rem; font-weight: 600; }
        .q .who img { height: 1.9em; width: auto; max-width: 100%; vertical-align: middle; border-radius: 4px; border: 1px solid #334155; }
        .q .score { font-size: .85rem; }
        .q .wait { font-size: .65rem; color: #94a3b8; margin-left: .3em; }
        .q.urgent .score, .q.urgent .wait { color: #fca5a5; }
        .q .tag { font-size: .6rem; padding: 0 .4em; border-radius: 999px; border: 1px solid #4ade80; color: #86efac; margin-left: .3em; vertical-align: middle; }

        .songs { flex: 1 1 0; }
        .song-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .5em; }
        .song { min-width: 0; text-align: center; }
        .song.banned { opacity: .3; }
        .song .jacket { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid #334155; background: #1e293b; }
        .song .jacket.none { display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 1.6rem; font-weight: 900; }
        .song .pat { margin-top: .3em; font-size: .85rem; font-weight: 700; color: #cbd5e1; white-space: nowrap; }
        .song .floor { display: inline-block; margin-top: .2em; font-size: 1rem; font-weight: 900; padding: .1em .45em; border-radius: 6px; white-space: nowrap; }

        /* 일망호 층수 표 — 혼자 뜨므로 창을 가득 채운다 */
        .chart { flex: 1 1 0; align-self: stretch; display: flex; flex-direction: column; }
        .chart h2 { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .grid { flex: 1; display: grid; grid-template-columns: 2.6em repeat(4, minmax(0, 1fr)); grid-template-rows: auto repeat(4, minmax(2.1em, 1fr)); gap: .25em; }
        .grid > div { display: flex; align-items: center; justify-content: center; border-radius: 5px;
                      white-space: nowrap; overflow: hidden; }
        .grid .hd { font-size: .75rem; font-weight: 900; min-height: 1.5em; color: #fff; }
        .grid .cell { flex-direction: column; gap: .15em; padding: .15em .2em; font-size: 1.15rem; font-weight: 900; color: #fff; }
        .grid .cell .lv { font-weight: 400; opacity: .8; margin-right: .2em; }
        /* 태그는 두 줄까지 — 넘치면 잘린다. 내 메모 태그가 앞에 와서 먼저 보인다 */
        .grid .tags { display: flex; flex-wrap: wrap; justify-content: center; gap: .2em; max-width: 100%;
                      max-height: calc(2 * 1.25em + .2em); overflow: hidden; font-size: .65rem; line-height: 1.25; }
        .grid .t { padding: 0 .35em; border-radius: 3px; background: rgba(0,0,0,.35); font-weight: 700; white-space: nowrap; }
        .grid .t.memo { background: rgba(0,0,0,.5); color: #fcd34d; box-shadow: inset 0 0 0 1px rgba(251,191,36,.55); }
        .chart h2 .bpm { margin-left: .6em; color: #93c5fd; letter-spacing: 0; }
        .grid .cell.none { background: #0f172a; color: #334155; font-size: .7rem; }
        .grid .cell.nofloor { background: #334155; color: #94a3b8; font-size: .7rem; }
    `;

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
            <style>${CSS}</style>`;
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
