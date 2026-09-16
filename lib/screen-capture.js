/* 게임 화면 받아오기 — 화면 공유(getDisplayMedia) 루프와 창 테두리 보정.
   층수 측정기와 버망호 도우미가 함께 쓴다. 게임 화면(16:9)만 잘라서 넘겨주므로
   호출부는 언제나 "게임 화면 전체"를 기준으로 좌표를 계산하면 된다. */
(function (global) {
    'use strict';

    const cropToCanvas = (...a) => global.VMH.ImgHash.cropToCanvas(...a);

    /* setInterval은 탭이 백그라운드로 가면 1초까지 느려진다. Worker 타이머는 그대로 돈다 */
    function createTicker(ms, fn) {
        try {
            const src = 'setInterval(() => postMessage(0), ' + ms + ');';
            const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
            w.onmessage = fn;
            return () => w.terminate();
        } catch (e) {
            const id = setInterval(fn, ms);
            return () => clearInterval(id);
        }
    }

    /* ── 창 테두리 제외 ─────────────────
       창 모드 게임을 '창'으로 공유하거나 Alt+PrintScreen으로 찍으면 제목 표시줄과 창 테두리가 같이 들어와 16:9가 아니게 된다.
       게임 화면(16:9)만 잘라 넘기면 이후 좌표 계산은 그대로 쓸 수 있다.
       Windows 창 테두리는 좌·우·아래 두께가 같고 제목 표시줄은 위에만 있으므로,
       좌우 끝의 한 색 세로줄 두께(= 테두리)만 재면 게임 화면 자리가 정해진다. */
    const GAME_RATIO = 16 / 9, GAME_RATIO_TOL = 0.02;
    const FRAME_MAX_BORDER = 12;    // 이보다 두꺼운 창 테두리는 없다고 본다
    const FRAME_MAX_TITLE = 0.1;    // 제목 표시줄은 게임 화면 높이의 10% 이하 (배율 200%의 720p 창까지 들어온다)
    const FRAME_CORNER = 16;        // Windows 11 창은 모서리가 둥글어 빈 픽셀로 잡히므로 아래 테두리는 양 끝을 빼고 본다
    const LINE_MAX_RANGE = 16;      // 한 줄 안의 밝기 차이가 이하면 한 색 줄(테두리)
    const LINE_MAX_STEP = 24;       // 옆 줄과 색이 이만큼 다르면 거기서 게임 화면이 시작된 것
    const MIN_MEASURABLE_W = 320, MIN_MEASURABLE_H = 180;   // 이보다 작은 그림은 테두리를 잴 수 없다

    const isFullRect = (r, W, H) => r.x === 0 && r.y === 0 && r.w === W && r.h === H;

    // 캔버스 데이터의 한 줄(세로 또는 가로)이 한 색이면 평균 색 [r,g,b], 아니면 null
    function uniformLine(d, cw, ch, index, vertical) {
        const n = vertical ? ch : cw, min = [255, 255, 255], max = [0, 0, 0], sum = [0, 0, 0];
        for (let k = 0; k < n; k++) {
            const i = (vertical ? k * cw + index : index * cw + k) * 4;
            for (let c = 0; c < 3; c++) { const v = d[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; sum[c] += v; }
        }
        for (let c = 0; c < 3; c++) if (max[c] - min[c] > LINE_MAX_RANGE) return null;
        return sum.map(s => s / n);
    }

    // 가장자리에서 안쪽으로 같은 색 한 색 줄이 몇 개 이어지는지 (= 테두리 두께)
    function borderDepth(src, x, y, w, h, vertical, fromEnd) {
        const c = cropToCanvas(src, x, y, w, h);
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        const n = vertical ? c.width : c.height;
        let depth = 0, prev = null;
        for (; depth < n; depth++) {
            const line = uniformLine(d, c.width, c.height, fromEnd ? n - 1 - depth : depth, vertical);
            if (!line || (prev && line.some((v, k) => Math.abs(v - prev[k]) > LINE_MAX_STEP))) break;
            prev = line;
        }
        return depth;
    }

    /* 화면 안의 게임 화면(16:9) 자리. 16:9면 전체, 창 테두리가 붙은 모양이면 테두리를 뺀 자리, 그 외엔 null.
       sure: 좌·우·아래 테두리가 서로 맞아떨어졌는지 — 암전처럼 온통 한 색인 화면에서는 테두리를 잘못 잴 수 있다 */
    function findGameRect(src, W, H) {
        if (!W || !H) return null;
        if (Math.abs(W / H - GAME_RATIO) <= GAME_RATIO_TOL) return { x: 0, y: 0, w: W, h: H, sure: true };
        // 게임 화면이라고 보기엔 너무 작다 — 테두리를 재려다 빈 영역을 읽게 된다
        if (W < MIN_MEASURABLE_W || H < MIN_MEASURABLE_H) return null;
        if (W / H > GAME_RATIO) return null; // 제목 표시줄은 세로만 늘린다 — 가로로 긴 화면은 창 테두리 모양이 아니다
        const n = FRAME_MAX_BORDER + 1, y0 = Math.round(H * 0.2), sh = Math.round(H * 0.6); // 제목 표시줄·둥근 모서리를 피해 가운데만 본다
        const left = borderDepth(src, 0, y0, n, sh, true, false), right = borderDepth(src, W - n, y0, n, sh, true, true);
        const b = Math.min(left, right);
        if (b > FRAME_MAX_BORDER) return null; // 좌우 끝이 온통 한 색 — 테두리를 잴 수 없다
        const w = W - 2 * b, h = w / GAME_RATIO, y = H - b - h;
        if (y < 0 || y > h * FRAME_MAX_TITLE) return null;
        const bottom = b ? borderDepth(src, b + FRAME_CORNER, H - n, w - 2 * FRAME_CORNER, n, false, true) : 0;
        return { x: b, y, w, h, sure: left === right && bottom >= b };
    }

    function frameToImage(frame, W, H) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        c.getContext('2d').drawImage(frame, 0, 0, W, H);
        return new Promise((resolve, reject) => c.toBlob(blob => {
            if (!blob) return reject(new Error('toBlob failed'));
            const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = URL.createObjectURL(blob);
        }, 'image/png'));
    }

    /* 붙여넣은 스샷에서 게임 화면만 남긴다. 창 테두리 모양이 아니면 예전처럼 전체를 쓴다 */
    async function fitGameArea(img, onNotice) {
        const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, r = findGameRect(img, W, H);
        if (!r || isFullRect(r, W, H)) return img;
        const cut = cropToCanvas(img, r.x, r.y, r.w, r.h), out = await frameToImage(cut, cut.width, cut.height);
        URL.revokeObjectURL(img.src);
        if (onNotice) onNotice('창 테두리 제외 (' + W + '×' + H + ' → ' + cut.width + '×' + cut.height + ')');
        return out;
    }

    /* 화면 공유 세션 하나.
       onFrame(frame, W, H)은 게임 화면만 잘라낸 프레임으로 intervalMs마다 불린다(앞 호출이 끝난 뒤에만).
       onStatus(text, tone)로 상태를 알리고, onStop()은 사용자가 브라우저의 '공유 중지'를 눌렀을 때도 불린다. */
    function createSession(opts) {
        const { intervalMs = 500, onFrame, onStatus = () => {}, onStop = () => {} } = opts || {};
        const state = { stream: null, video: null, imageCapture: null, stopTicker: null, busy: false, rectKey: null, rect: null, cropped: false };

        const isRunning = () => !!state.stream;
        const areaNote = () => state.cropped ? ' · 창 테두리 제외' : '';

        // 해상도가 같으면 확실히 잰 자리를 다시 쓴다 (매번 재지 않고, 암전 화면에서 잘못 잰 값은 굳히지 않는다)
        function gameRect(frame, W, H) {
            const key = W + 'x' + H;
            if (state.rectKey === key) return state.rect;
            const r = findGameRect(frame, W, H);
            if (r && r.sure) { state.rectKey = key; state.rect = r; }
            return r;
        }

        async function grabFrame() {
            if (state.imageCapture) { try { return await state.imageCapture.grabFrame(); } catch (e) { /* 비디오 요소로 대신 받는다 */ } }
            const v = state.video;
            return (v && v.videoWidth) ? v : null;
        }

        async function tick() {
            if (state.busy || !state.stream) return;
            state.busy = true;
            let raw = null;
            try {
                raw = await grabFrame(); if (!raw || !state.stream) return;
                const rawW = raw.videoWidth || raw.width, rawH = raw.videoHeight || raw.height;
                if (!rawW || !rawH) return;
                const rect = gameRect(raw, rawW, rawH);
                if (!rect) { onStatus('게임 화면을 찾지 못했습니다 (' + rawW + '×' + rawH + ') — 16:9 화면이나 게임 창을 공유하세요', 'warn'); return; }
                // 창 테두리가 붙어 있으면 게임 화면만 잘라서 본다 — 이후 좌표는 모두 잘라낸 화면 기준
                state.cropped = !isFullRect(rect, rawW, rawH);
                const frame = state.cropped ? cropToCanvas(raw, rect.x, rect.y, rect.w, rect.h) : raw;
                await onFrame(frame, state.cropped ? frame.width : rawW, state.cropped ? frame.height : rawH);
            } catch (e) {
                console.error('[ScreenCapture]', e);
            } finally {
                if (raw && typeof ImageBitmap !== 'undefined' && raw instanceof ImageBitmap) raw.close();
                state.busy = false;
            }
        }

        async function start() {
            // getDisplayMedia는 보안 컨텍스트(https 또는 localhost)에서만 쓸 수 있다 — file://로 열면 아예 없다
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                onStatus('이 브라우저/주소에서는 화면 공유를 쓸 수 없습니다 (localhost나 https로 열어주세요)', 'warn');
                return false;
            }
            let stream;
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 5, max: 10 } }, audio: false, selfBrowserSurface: 'exclude' });
            } catch (e) { onStatus('화면 연결이 취소되었습니다', 'warn'); return false; }

            const track = stream.getVideoTracks()[0];
            track.addEventListener('ended', stop); // 브라우저의 '공유 중지'를 누른 경우
            const video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.srcObject = stream;
            try { await video.play(); } catch (e) { /* ImageCapture로 대신 받는다 */ }

            Object.assign(state, {
                stream: stream, video: video,
                imageCapture: ('ImageCapture' in window) ? new ImageCapture(track) : null,
                busy: false, rectKey: null, rect: null, cropped: false
            });
            state.stopTicker = createTicker(intervalMs, tick);
            return true;
        }

        function stop() {
            if (!state.stream && !state.stopTicker) return;
            if (state.stopTicker) state.stopTicker();
            if (state.stream) state.stream.getTracks().forEach(t => t.stop());
            if (state.video) state.video.srcObject = null;
            Object.assign(state, { stream: null, video: null, imageCapture: null, stopTicker: null });
            onStop();
        }

        return { start, stop, isRunning, areaNote };
    }

    global.VMH = global.VMH || {};
    global.VMH.ScreenCapture = {
        createTicker, createSession,
        findGameRect, isFullRect, fitGameArea, frameToImage,
        GAME_RATIO
    };
})(window);
