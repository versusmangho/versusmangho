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
    let opening = null, generation = 0;

    const CSS = `
        * { box-sizing: border-box; }
        /* 창 크기를 바꾸면 글자도 같이 커진다 — 가로·세로 중 좁은 쪽에 맞춰 8명이 한 화면에 들어가게 */
        html { font-size: clamp(10px, min(2.2vw, 4.8vh), 24px); }
        body { margin: 0; height: 100vh; padding: .5em .6em; background: #0b0e14; color: #f3f5f8;
               font-family: 'Pretendard Variable', 'Pretendard', 'Noto Sans KR', system-ui, sans-serif;
               letter-spacing: -0.02em; overflow: hidden; user-select: none;
               display: flex; align-items: flex-start; gap: .8em; }
        .sec { min-width: 0; }
        .sec + .sec { padding-left: .8em; border-left: 1px solid rgba(255,255,255,.1); align-self: stretch; }
        .sec h2 { margin: 0 0 .35em; font-size: .82rem; font-weight: 700; letter-spacing: .04em; color: #9ca3af; }
        .num { font-family: 'Orbitron', system-ui, sans-serif; font-weight: 700; }
        .empty { color: #6b7280; font-size: .8rem; margin: .2em 0; }

        .queue { flex: 0 1 17em; }
        .q { display: grid; grid-template-columns: 1.3em minmax(0, 1fr) auto; align-items: center; gap: .45em; padding: .18em 0; }
        .q .rank { font-size: .8rem; color: #6b7280; text-align: right; }
        .q.top .rank { color: #22d3ee; }
        .q .who { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .9rem; font-weight: 600; }
        .q .who img { height: 1.9em; width: auto; max-width: 100%; vertical-align: middle; border-radius: 4px; border: 1px solid #334155; }
        .q .score { font-size: .85rem; }
        .q .wait { font-size: .65rem; color: #94a3b8; margin-left: .3em; }
        .q.urgent .score, .q.urgent .wait { color: #fca5a5; }
        .q .tag { font-family: 'Wanted Sans Variable', 'Wanted Sans', 'Pretendard Variable', sans-serif; font-size: .6rem; font-weight: 700; padding: 0 .4em; border-radius: 999px; border: 1px solid #4ade80; color: #86efac; margin-left: .3em; vertical-align: middle; }

        .songs { flex: 1 1 0; }
        .song-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .5em; }
        .song { min-width: 0; text-align: center; }
        .song.banned { opacity: .3; }
        .song .jacket { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; border: 1px solid #334155; background: #1e293b; }
        .song .jacket.none { display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 1.6rem; font-weight: 900; }
        .song .pat { margin-top: .28em; font-size: .95rem; font-weight: 700; color: #cbd5e1; white-space: nowrap; }
        .song .floor { display: inline-block; margin-top: .2em; font-size: 1.12rem; font-weight: 900; padding: .12em .48em; border-radius: 6px; white-space: nowrap; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.35); }
        .song .myrec { margin-top: .2em; font-family: 'Orbitron', system-ui, sans-serif; font-size: .78rem; font-weight: 700; color: #cbd5e1; white-space: nowrap; }
        .song .myrec.is-mc, .grid .cell .myrec.is-mc { color: #7dd3fc; }
        .song .myrec.is-pp, .grid .cell .myrec.is-pp { color: #fde047; }
        .song .song-tags { display: flex; flex-wrap: wrap; justify-content: center; gap: .2em; margin-top: .24em;
                           font-size: .74rem; line-height: 1.3; }
        .t { display: inline-flex; align-items: center; justify-content: center; height: 1.48em; padding: 0 .38em; line-height: 1;
             font-family: 'Wanted Sans Variable', 'Wanted Sans', 'Pretendard Variable', sans-serif; letter-spacing: -0.01em; font-variant-numeric: tabular-nums;
             border-radius: 4px; background: rgba(0,0,0,.35); font-weight: 700; white-space: nowrap; }
        .t.myrec { background: rgba(15,23,42,.88); color: #f8fafc; box-shadow: inset 0 0 0 1px rgba(203,213,225,.55); }
        .t.myrec.is-mc { color: #7dd3fc; box-shadow: inset 0 0 0 1px rgba(186,230,253,.85); }
        .t.myrec.is-pp { color: #fde047; box-shadow: inset 0 0 0 1px rgba(254,240,138,.85); }
        .t.va { background: rgba(140,108,16,.9); color: #fefce8; box-shadow: inset 0 0 0 1px rgba(254,240,138,.45); }
        .t.lope { background: rgba(158,62,54,.9); color: #fff5f4; box-shadow: inset 0 0 0 1px rgba(255,150,138,.45); }
        .t.memo { background: rgba(14,116,144,.92); color: #ffffff; box-shadow: inset 0 0 0 1px rgba(103,232,249,.5); }

        /* 일망호 층수 표 — 혼자 뜨므로 창을 가득 채운다 */
        .chart { flex: 1 1 0; align-self: stretch; min-height: 0; display: flex; flex-direction: column; }
        .chart h2 { flex: 0 0 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 2.6em repeat(4, minmax(0, 1fr)); grid-template-rows: auto repeat(4, minmax(0, 1fr)); gap: .25em; }
        .grid > div { display: flex; align-items: center; justify-content: center; border-radius: 5px; overflow: hidden; min-height: 0; }
        .grid .hd { font-size: .85rem; font-weight: 900; min-height: 1.6em; color: #fff; white-space: nowrap; }
        .grid .cell { position: relative; flex-direction: column; align-items: center; justify-content: center;
                      padding: .24rem .38rem; font-weight: 900; color: #fff; }
        .grid .cell-main { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 0 0 auto; }
        .grid .cell .val { font-size: 1.32rem; line-height: 1.05; white-space: nowrap; text-shadow: 1px 1px 3px rgba(0,0,0,.45); }
        .grid .cell .myrec { margin-top: .14rem; font-family: 'Orbitron', system-ui, sans-serif;
                             font-size: .66rem; font-weight: 700; line-height: 1.15; padding: 1px 5px; border-radius: 4px;
                             background: rgba(0,0,0,.52); color: #f1f5f9; white-space: nowrap; }
        .grid .cell .lv { font-weight: 400; opacity: .85; margin-right: .14em; }
        /* 태그가 있는 칸은 신문 드롭캡처럼 층수만 왼쪽 위에 띄우고, 태그를 옆→아래 전체 폭으로 줄글처럼 흘린다 */
        .grid .cell.has-tags { display: block; text-align: left; padding: .24rem .36rem; font-size: .74rem; line-height: 1.32; }
        .grid .cell.has-tags .cell-main { float: left; margin: 0 .38rem .1rem 0; align-items: flex-start; }
        .grid .cell.has-tags .tags { display: inline; }
        .grid .cell.has-tags .t { display: inline-flex; margin: 0 .18rem .16rem 0; vertical-align: top; }
        .chart h2 .bpm { margin-left: .6em; color: #22d3ee; letter-spacing: 0; }
        .grid .cell.none { background: #131822; color: #4b5563; font-size: .8rem; }
        .grid .cell.nofloor { background: #262e3c; color: #9ca3af; }
        .grid .cell.nofloor .val { font-size: .85rem; text-shadow: none; }
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
        win.document.documentElement.dataset.theme = global.VMH.Theme?.current || 'dark';
        const html = render();
        if (html === lastHtml) return;
        lastHtml = html;
        win.document.body.innerHTML = html;
    }

    function notifyChange() { changeListeners.forEach(cb => { try { cb(); } catch (e) { console.error('[Popup]', e); } }); }

    function open() {
        if (win) return Promise.resolve(true);
        if (opening) return opening;
        if (!supported()) return Promise.resolve(false);
        const gen = ++generation;
        const pending = openWindow(gen).finally(() => { if (opening === pending) opening = null; });
        opening = pending;
        return pending;
    }

    async function openWindow(gen) {
        let w;
        try { w = await global.documentPictureInPicture.requestWindow({ width: 760, height: 300 }); }
        catch (e) { console.error('[Popup]', e); return false; }
        if (gen !== generation) { w.close(); return false; }
        if (w.closed) return false;
        w.document.title = '버망호 도우미';
        w.document.head.innerHTML = `
            <meta charset="utf-8">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css">
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Noto+Sans+KR:wght@400;600;700;900&display=swap">
            <style>${CSS}
              :root { color-scheme: dark; }
              :root[data-theme="light"] { color-scheme: light; }
              :root[data-theme="light"] body { background: #eef3fa; color: #182942; }
              :root[data-theme="light"] .sec h2 { color: #475b75; }
              :root[data-theme="light"] .sec + .sec { border-color: #cbd5e1; }
              :root[data-theme="light"] .q .rank, :root[data-theme="light"] .q .wait { color: #475b75; }
              :root[data-theme="light"] .q.top .rank { color: #1d4ed8; }
              :root[data-theme="light"] .q.urgent .score, :root[data-theme="light"] .q.urgent .wait { color: #9f1239; }
              :root[data-theme="light"] .q .who img { border-color: #cbd5e1; }
              :root[data-theme="light"] .q .tag { color: #166534; border-color: #15803d; background: #dcfce7; }
              :root[data-theme="light"] .song .jacket { border-color: #cbd5e1; background: #e2e8f0; }
              :root[data-theme="light"] .song .jacket.none { color: #64748b; }
              :root[data-theme="light"] .song .pat { color: #334155; }
              :root[data-theme="light"] .song .myrec { color: #334155; }
              :root[data-theme="light"] .song .myrec.is-mc { color: #0369a1; }
              :root[data-theme="light"] .song .myrec.is-pp { color: #a16207; }
              :root[data-theme="light"] .song .t.va { background: #fef3c7; color: #854d0e; box-shadow: inset 0 0 0 1px #f59e0b; }
              :root[data-theme="light"] .song .t.lope { background: #fee2e2; color: #991b1b; box-shadow: inset 0 0 0 1px #f87171; }
              :root[data-theme="light"] .song .t.memo { background: #0e7490; color: #ffffff; box-shadow: inset 0 0 0 1px #06b6d4; }
              :root[data-theme="light"] .chart h2 .bpm { color: #1d4ed8; }
              :root[data-theme="light"] .grid .cell .val { text-shadow: 0 1px 2px rgba(0,0,0,.25); }
              :root[data-theme="light"] .grid .cell.none { background: #e2e8f0; color: #94a3b8; }
              :root[data-theme="light"] .grid .cell.nofloor { background: #dde6f3; color: #475b75; }
              :root[data-theme="light"] .grid .cell.nofloor .val { text-shadow: none; }
              :root[data-theme="light"] .grid .cell.nofloor .myrec { background: rgba(15,23,42,.08); color: #334155; }
              :root[data-theme="light"] .grid .cell.nofloor .myrec.is-mc { color: #0369a1; }
              :root[data-theme="light"] .grid .cell.nofloor .myrec.is-pp { color: #a16207; }
              :root[data-theme="light"] .empty { color: #475b75; }
            </style>`;
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

    function close() { generation++; opening = null; if (win) win.close(); }

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
