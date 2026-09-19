/* 게임 화면 받아오기 — 화면 공유(getDisplayMedia) 루프와 창 테두리·21:9 여백 보정.
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

    /* 백그라운드에서도 제시간에 깨는 sleep — 게임이 앞에 있는 동안 도는 루프(성과 스캔)가 쓴다.
       setTimeout은 가려진 탭에서 1초 이상으로 늘어진다 */
    let sleepWorker = null, sleepSeq = 0;
    const sleepWaits = new Map();
    function sleep(ms) {
        if (!sleepWorker) {
            try {
                const src = 'onmessage = e => setTimeout(() => postMessage(e.data.id), e.data.ms);';
                sleepWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
                sleepWorker.onmessage = e => { const r = sleepWaits.get(e.data); sleepWaits.delete(e.data); if (r) r(); };
            } catch (e) { sleepWorker = false; }
        }
        if (!sleepWorker) return new Promise(r => setTimeout(r, ms));
        const id = ++sleepSeq;
        return new Promise(r => { sleepWaits.set(id, r); sleepWorker.postMessage({ id, ms: Math.max(0, ms) }); });
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

    /* ── 21:9 같은 가로로 긴 화면 ─────────────────
       게임은 창(또는 모니터)이 16:9보다 넓으면 높이를 꽉 채운 16:9 화면을 가운데 그리고, 양옆은 흐린 배경으로 채운다
       (검은 띠가 아니다). 실측(2558×1048 스샷 5장): 게임 화면은 x 348~2210 = 1863px = 1048×16/9, 가운데 정렬.
       여백이 없는 공유(테두리 없는 창·전체 화면)면 비율만으로 자리가 정해지지만, 일반 창을 '창'으로 공유하면
       위에 제목 표시줄이 붙어 게임 화면 높이를 모른다. 그래서 흐린 여백과 게임 화면이 만나는 세로 경계를 찾는다 —
       경계 열에서는 옆 열과의 색 차이가 줄 전체에 걸쳐 튀고(실측 96~442), 여백·게임 화면 안은 1~3이다.
       경계는 좌우 대칭이라 왼쪽 x와 오른쪽 W-x가 함께 튀는 자리만 받는다. */
    const SEAM_MIN = 40;            // 경계 열의 평균 색 차이(R+G+B)가 이 이상 (실측 최소 96)
    const SEAM_NOISE_RATIO = 8;     // 그리고 주변 열 차이의 중앙값보다 이만큼 커야 한다 (실측 30배 이상)

    // 세로 띠(x0부터 sw열)의 열 사이 색 차이 — d[i] = i열과 i-1열의 평균 차이 (i ≥ 1)
    function columnSteps(src, x0, y0, sw, sh) {
        const c = cropToCanvas(src, x0, y0, sw, sh), cw = c.width, ch = c.height;
        const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cw, ch).data;
        const d = new Float32Array(cw);
        for (let y = 0; y < ch; y++) {
            for (let x = 1; x < cw; x++) {
                const i = (y * cw + x) * 4;
                d[x] += Math.abs(px[i] - px[i - 4]) + Math.abs(px[i + 1] - px[i - 3]) + Math.abs(px[i + 2] - px[i - 2]);
            }
        }
        for (let x = 1; x < cw; x++) d[x] /= ch;
        return d;
    }

    /* 가로로 긴 화면에서 가운데 16:9 자리. b = 좌우 창 테두리 두께(없으면 0).
       x는 제목 표시줄이 없을 때(가장 바깥) ~ 제목 표시줄이 FRAME_MAX_TITLE만큼 있을 때 사이에서 찾는다 */
    function findWideRect(src, W, H, b) {
        const y0 = Math.round(H * 0.2), sh = Math.round(H * 0.6);  // 제목 표시줄을 피해 가운데만 본다
        const hMax = H - b, hMin = hMax / (1 + FRAME_MAX_TITLE);
        const xMin = Math.floor((W - hMax * GAME_RATIO) / 2) - 2, xMax = Math.ceil((W - hMin * GAME_RATIO) / 2) + 2;
        if (xMin < 1 || xMax <= xMin) return null;
        const sw = xMax - xMin + 2;
        const L = columnSteps(src, xMin - 1, y0, sw, sh);      // L[i] ↔ (xMin-1+i)열
        const R = columnSteps(src, W - xMax - 1, y0, sw, sh);  // R[i] ↔ (W-xMax-1+i)열
        const at = (d, i) => (i >= 1 && i < d.length) ? d[i] : 0;
        const edge = (d, i) => Math.max(at(d, i - 1), at(d, i), at(d, i + 1));  // 축소된 화면에선 경계가 두 열에 걸친다
        let best = null;
        for (let x = xMin; x <= xMax; x++) {
            const li = x - (xMin - 1), ri = (W - x) - (W - xMax - 1);  // 오른쪽 경계 = 여백이 시작되는 W-x열
            const score = Math.min(edge(L, li), edge(R, ri));
            if (!best || score > best.score) best = { x, score };
        }
        const all = Array.from(L).slice(1).concat(Array.from(R).slice(1)).sort((a, b2) => a - b2);
        const noise = all[all.length >> 1] || 0;
        if (!best || best.score < SEAM_MIN || best.score < noise * SEAM_NOISE_RATIO) return null;
        const w = W - 2 * best.x, h = w / GAME_RATIO;
        return { x: best.x, w, h, y: H - b - h };
    }

    /* 화면 안의 게임 화면(16:9) 자리. 16:9면 전체, 창 테두리가 붙은 모양이면 테두리를 뺀 자리,
       21:9처럼 넓으면 양옆 여백(과 창 테두리)을 뺀 가운데 자리, 그 외엔 null.
       sure: 좌·우·아래 테두리가 서로 맞아떨어졌는지 — 암전처럼 온통 한 색인 화면에서는 테두리를 잘못 잴 수 있다
       wide: 양옆 여백을 잘라냈는지 (상태 표시용) */
    function findGameRect(src, W, H) {
        if (!W || !H) return null;
        if (Math.abs(W / H - GAME_RATIO) <= GAME_RATIO_TOL) return { x: 0, y: 0, w: W, h: H, sure: true };
        // 게임 화면이라고 보기엔 너무 작다 — 테두리를 재려다 빈 영역을 읽게 된다
        if (W < MIN_MEASURABLE_W || H < MIN_MEASURABLE_H) return null;
        const n = FRAME_MAX_BORDER + 1, y0 = Math.round(H * 0.2), sh = Math.round(H * 0.6); // 제목 표시줄·둥근 모서리를 피해 가운데만 본다
        const left = borderDepth(src, 0, y0, n, sh, true, false), right = borderDepth(src, W - n, y0, n, sh, true, true);
        const b = Math.min(left, right);
        // 아래 테두리가 좌우 테두리만큼 두꺼운지 — 창 테두리를 제대로 쟀다는 확인
        const bottomOk = () => !b || borderDepth(src, b + FRAME_CORNER, H - n, W - 2 * b - 2 * FRAME_CORNER, n, false, true) >= b;
        // 넓은 화면에서 좌우 끝이 온통 한 색이면 흐린 여백이 어두운 것 — 창 테두리가 없는 것으로 본다
        if (W / H > GAME_RATIO) {
            const flat = b > FRAME_MAX_BORDER;
            return wideRect(src, W, H, flat ? 0 : b, !flat && left === right && bottomOk());
        }
        if (b > FRAME_MAX_BORDER) return null; // 좌우 끝이 온통 한 색 — 테두리를 잴 수 없다
        const w = W - 2 * b, h = w / GAME_RATIO, y = H - b - h;
        if (y < 0 || y > h * FRAME_MAX_TITLE) return null;
        return { x: b, y, w, h, sure: left === right && bottomOk() };
    }

    // y0 ±1 가운데 윗줄과 색이 가장 크게 달라지는 줄 (창 안쪽 폭 전체로 잰다)
    function titleEdge(src, W, b, y0) {
        const c = cropToCanvas(src, b, y0 - 2, W - 2 * b, 4), cw = c.width;
        const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cw, 4).data;
        let best = y0, bestD = -1;
        for (let k = 1; k <= 3; k++) {   // k행 = y0-2+k
            let d = 0;
            for (let x = 0; x < cw; x++) {
                const i = (k * cw + x) * 4, j = i - cw * 4;
                d += Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]);
            }
            if (d > bestD) { bestD = d; best = y0 - 2 + k; }
        }
        return best;
    }

    /* 가로로 긴 화면. 경계를 찾으면 그 자리, 못 찾았으면(암전처럼 여백과 게임 화면이 같은 색) —
       창 테두리가 없을 땐 높이를 꽉 채운 가운데 16:9로 두되 굳히지 않고, 테두리가 있으면 제목 표시줄 높이를 몰라 null */
    function wideRect(src, W, H, b, frameOk) {
        const r = findWideRect(src, W, H, b);
        if (!r) {
            if (b) return null;
            const w = H * GAME_RATIO;
            return { x: (W - w) / 2, y: 0, w, h: H, sure: false, wide: true };
        }
        if (r.y < -2 || r.y > r.h * FRAME_MAX_TITLE) return null;
        // 경계로 잰 너비는 1px쯤 흔들려 높이도 그만큼 흔들린다. 1~2px 차이면 제목 표시줄이 없는 것이고,
        // 아니면 그 근처에서 제목 표시줄과 게임 화면이 만나는 가로줄(위아래 색 차이가 가장 큰 줄)을 찾아 비율로 다시 맞춘다
        const y = r.y <= 2 ? 0 : titleEdge(src, W, b, Math.round(r.y)), h = H - b - y, w = h * GAME_RATIO;
        return { x: (W - w) / 2, y, w, h, sure: frameOk, wide: true };
    }

    function frameToImage(frame, W, H) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        c.getContext('2d').drawImage(frame, 0, 0, W, H);
        return new Promise((resolve, reject) => c.toBlob(blob => {
            if (!blob) return reject(new Error('toBlob failed'));
            const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = URL.createObjectURL(blob);
        }, 'image/png'));
    }

    const cropNote = r => r.wide ? '21:9 양옆 여백 제외' : '창 테두리 제외';

    /* 붙여넣은 스샷에서 게임 화면만 남긴다. 창 테두리·양옆 여백 모양이 아니면 예전처럼 전체를 쓴다 */
    async function fitGameArea(img, onNotice) {
        const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, r = findGameRect(img, W, H);
        if (!r || isFullRect(r, W, H)) return img;
        const cut = cropToCanvas(img, r.x, r.y, r.w, r.h), out = await frameToImage(cut, cut.width, cut.height);
        URL.revokeObjectURL(img.src);
        if (onNotice) onNotice(cropNote(r) + ' (' + W + '×' + H + ' → ' + cut.width + '×' + cut.height + ')');
        return out;
    }

    /* 화면 공유 세션 하나.
       onFrame(frame, W, H)은 게임 화면만 잘라낸 프레임으로 intervalMs마다 불린다(앞 호출이 끝난 뒤에만).
       onStatus(text, tone)로 상태를 알리고, onStop()은 사용자가 브라우저의 '공유 중지'를 눌렀을 때도 불린다. */
    function createSession(opts) {
        const { intervalMs = 500, onFrame, onStatus = () => {}, onStop = () => {} } = opts || {};
        const state = { stream: null, video: null, imageCapture: null, stopTicker: null, busy: false, rectKey: null, rect: null, cropped: null };

        const isRunning = () => !!state.stream;
        const areaNote = () => state.cropped ? ' · ' + cropNote(state.cropped) : '';

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
                if (!rect) { onStatus('게임 화면을 찾지 못했습니다 (' + rawW + '×' + rawH + ') — 16:9·21:9 화면이나 게임 창을 공유하세요', 'warn'); return; }
                // 창 테두리나 양옆 여백이 붙어 있으면 게임 화면만 잘라서 본다 — 이후 좌표는 모두 잘라낸 화면 기준
                state.cropped = isFullRect(rect, rawW, rawH) ? null : rect;
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
                busy: false, rectKey: null, rect: null, cropped: null
            });
            state.stopTicker = createTicker(intervalMs, tick);
            return true;
        }

        /* 지금 프레임 한 장을 바로 받는다 — { frame(캔버스, 게임 화면만), W, H } 또는 null.
           틱과 겹치면 틱이 끝나길 기다린다 (ImageCapture.grabFrame을 동시에 두 번 부르지 않는다) */
        async function grab() {
            while (state.busy && state.stream) await sleep(5);
            if (!state.stream) return null;
            state.busy = true;
            let raw = null;
            try {
                raw = await grabFrame(); if (!raw || !state.stream) return null;
                const rawW = raw.videoWidth || raw.width, rawH = raw.videoHeight || raw.height;
                if (!rawW || !rawH) return null;
                const rect = gameRect(raw, rawW, rawH);
                if (!rect) return null;
                const frame = cropToCanvas(raw, rect.x, rect.y, rect.w, rect.h);   // ImageBitmap은 곧 닫으니 늘 캔버스로 옮긴다
                return { frame, W: frame.width, H: frame.height };
            } finally {
                if (raw && typeof ImageBitmap !== 'undefined' && raw instanceof ImageBitmap) raw.close();
                state.busy = false;
            }
        }

        /* 공유 프레임률. 평소엔 5fps면 충분하지만, 곡을 빠르게 넘기며 읽는 동안은 올려야 방금 화면을 받는다 */
        async function setFrameRate(fps) {
            const track = state.stream && state.stream.getVideoTracks()[0];
            if (!track) return;
            try { await track.applyConstraints({ frameRate: { ideal: fps, max: Math.max(fps, 10) } }); } catch (e) { /* 못 바꿔도 읽기는 된다 */ }
        }

        function stop() {
            if (!state.stream && !state.stopTicker) return;
            if (state.stopTicker) state.stopTicker();
            if (state.stream) state.stream.getTracks().forEach(t => t.stop());
            if (state.video) state.video.srcObject = null;
            Object.assign(state, { stream: null, video: null, imageCapture: null, stopTicker: null });
            onStop();
        }

        return { start, stop, isRunning, areaNote, grab, setFrameRate };
    }

    global.VMH = global.VMH || {};
    global.VMH.ScreenCapture = {
        createTicker, createSession, sleep,
        findGameRect, isFullRect, fitGameArea, frameToImage,
        GAME_RATIO
    };
})(window);
