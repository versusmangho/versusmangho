/* 성과 스캔 — 컬렉션 → PLAY INFO → MUSIC DATA 화면 한 장을 읽는다.
   무엇을: 선택된 곡(목록의 자켓), 4버튼 × 4패턴의 최고 점수(HIGH SCORE 칸), MAX 콤보 마크(BEST COMBO 칸).
   제목은 읽지 않는다 — 곡은 자켓으로 알고(층수 탭과 같은 sig), 정확도는 점수에서 나온다: floor(점수/100)/100.

   좌표는 모두 2560×1440(QHD) 기준이다. 다른 해상도는 필요한 부분만 QHD 크기로 늘려(줄여) 그린 뒤 같은 좌표로 읽는다.
   격자 좌표는 VArchiveMacro의 FHD 좌표표 × 4/3과 같고, images/collection/ 10장으로 잰 값들이다:
     - 자켓: 목록에서 선택된 줄의 썸네일(80×80, x 1980)만 쓸 수 있다. 선택 안 된 줄은 어둡게 칠해져 DB와 안 맞는다(거리 22~33).
       선택 줄의 y는 스크롤에 따라 472~1134로 움직이고 강조 막대 색도 곡마다 달라서, x를 고정하고 y를 훑어 가장 맞는 자리를 고른다.
       기준값과 실측은 아래 JACKET_* 참고. DB 안에서 가장 가까운 두 자켓은 Permutation Part.1↔Part.2(10.1) — 이 쌍은 확인 필요로 넘긴다.
     - 숫자: 흰 글자, 칸 왼쪽 +18px부터 12px 고정 폭. 이웃 숫자가 붙기도 해서('44') 덩어리가 아니라 12px 칸으로 자른다.
       min(R,G,B)를 120~230 구간에서 0~1로 펴서 0~9 템플릿과 정규화 상관(±1px 흔들기)으로 비교한다.
       실측(한 장씩 빼고 템플릿을 만들어 그 장 읽기, 421글자): 틀린 글자 0, 1위/2위 거리비 최악 0.46.
     - MAX: BEST COMBO 칸 오른쪽 아이콘 자리의 파란 픽셀 비율. MAX 0.31~0.35 / 아니면 0.00. */
(function (global) {
    'use strict';

    const QW = 2560, QH = 1440, K = 4 / 3;

    // 자켓을 찾는 세로 띠 (선택 줄의 썸네일 자리)
    const JK = { x: 1980, size: 80, y0: 440, y1: 1180, coarse: 4 };
    const STRIP = { x: JK.x - 4, y: JK.y0, w: JK.size + 8, h: JK.y1 - JK.y0 + JK.size };
    // 표 (점수·MAX를 읽고, 검토용 사진도 여기서 자른다) — 버튼·패턴 이름표까지 들어가게
    const TABLE = { x: 1100, y: 600, w: 830, h: 500 };

    // sig — floor/match-screen.js의 jacketSig와 같은 계산 (자켓 가운데 12×8칸 평균 색)
    const SIG_W = 12, SIG_H = 8, SIG_X0 = 0.06, SIG_X1 = 0.94, SIG_Y0 = 0.2, SIG_Y1 = 0.78;
    /* 실측(이 코드, images/collection/ 10장): 정답 거리 1.8~6.2, 1위/2위 0.05~0.15.
       컬렉션이 아닌 화면(로비·결과·라운드·밴픽 11장)에서 가장 맞는 자리: 거리 13.5~23, 1위/2위 0.60 이상.
       Permutation Part.1↔Part.2는 DB에서 10.1 떨어져 있어, 둘 중 하나를 제대로 읽어도 1위/2위가 0.4쯤 → 확인 필요로 간다 */
    const JACKET_SURE = 10, JACKET_SURE_RATIO = 0.35;   // 이 안이면 곡 확실
    const JACKET_MAX = 14, JACKET_MAX_RATIO = 0.5;      // 이 밖이면 선택된 곡 자켓이 없는 것 (다른 화면)

    // 숫자
    const CELL_W = 157, CELL_H = 29, DIGIT_X0 = 18, DIGIT_P = 12, BOX_W = 14;
    const INK_MIN = 165;               // 이보다 밝으면(min(R,G,B)) 글자 — 칸이 비었는지, '-'인지, 몇 자리인지 볼 때
    const SOFT_LO = 120, SOFT_SPAN = 110;
    const DIGIT_MIN_H = 12;            // '-'는 높이가 낮다
    const DIGIT_SURE_RATIO = 0.7;      // 1위/2위 거리비가 이보다 크면 확인 필요 (실측 최악 0.46)
    const MAX_ON = 0.08, MAX_GRAY = [0.03, 0.2];   // 파란 픽셀 비율 (실측 MAX 0.31~0.35 / 아님 0.00)

    const BUTTONS = [4, 5, 6, 8];
    const PATTERNS = ['NM', 'HD', 'MX', 'SC'];

    // 0~9 템플릿: 29×14 (QHD), 0~255. images/collection/ 10장의 421글자 평균 (만든 방법은 위 설명과 같다)
    const DIGIT_TEMPLATES_B64 =
        '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' +
        'AAAAAAAAAAAAAA==';

    // ── 템플릿 준비 (평균을 뺀 값과 크기를 미리 구해 둔다) ─────────────────
    const TEMPLATES = (() => {
        const bin = atob(DIGIT_TEMPLATES_B64), n = CELL_H * BOX_W, out = [];
        for (let d = 0; d < 10; d++) {
            const t = new Float32Array(n);
            let mean = 0;
            for (let i = 0; i < n; i++) { t[i] = bin.charCodeAt(d * n + i) / 255; mean += t[i]; }
            mean /= n;
            let norm = 0;
            for (let i = 0; i < n; i++) { t[i] -= mean; norm += t[i] * t[i]; }
            out.push({ digit: String(d), t, norm: Math.sqrt(norm) });
        }
        return out;
    })();

    // 프레임의 QHD 기준 영역 r을 QHD 크기 캔버스로 그린다
    function regionAtQhd(frame, W, r) {
        const s = W / QW, c = document.createElement('canvas');
        c.width = r.w; c.height = r.h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(frame, r.x * s, r.y * s, r.w * s, r.h * s, 0, 0, r.w, r.h);
        return c;
    }

    // ── 자켓 ─────────────────
    function sigAt(d, dw, x0, y0, size) {
        const rx = x0 + Math.round(size * SIG_X0), ry = y0 + Math.round(size * SIG_Y0);
        const cw = Math.round(size * (SIG_X1 - SIG_X0)), ch = Math.round(size * (SIG_Y1 - SIG_Y0));
        const out = new Float32Array(SIG_W * SIG_H * 3);
        for (let cy = 0; cy < SIG_H; cy++) {
            const ya = Math.floor(cy * ch / SIG_H), yb = Math.max(ya + 1, Math.floor((cy + 1) * ch / SIG_H));
            for (let cx = 0; cx < SIG_W; cx++) {
                const xa = Math.floor(cx * cw / SIG_W), xb = Math.max(xa + 1, Math.floor((cx + 1) * cw / SIG_W));
                let r = 0, g = 0, b = 0, n = 0;
                for (let yy = ya; yy < yb; yy++) {
                    let i = ((ry + yy) * dw + rx + xa) * 4;
                    for (let xx = xa; xx < xb; xx++, i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
                }
                const o = (cy * SIG_W + cx) * 3;
                out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
            }
        }
        return out;
    }

    // DB 전체에서 가장 가까운 두 자켓. 2위보다 멀어지면 바로 그만 센다
    function nearestTwo(sig, table) {
        const n = sig.length;
        let best = null, bestS = Infinity, secondS = Infinity;
        for (const it of table) {
            const ref = it.sig, lim = secondS * n;
            let s = 0;
            for (let i = 0; i < n && s < lim; i++) s += Math.abs(sig[i] - ref[i]);
            if (s < bestS) { secondS = bestS; bestS = s; best = it; } else if (s < secondS) secondS = s;
        }
        return best ? { id: String(best.id), d: bestS / n, second: secondS / n } : null;
    }

    /* hintY(QHD): 직전 곡의 자켓 y. 선택 줄은 한 곡 넘길 때 한 줄(83px) 넘게 움직이지 않으니
       그 근처만 먼저 보고, 거기서 확실히 맞으면 끝낸다 (띠 전체를 훑는 것보다 3배쯤 빠르다) */
    const HINT_RANGE = 100;
    function findJacket(frame, W, table, hintY) {
        const c = regionAtQhd(frame, W, STRIP), dw = c.width;
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        const x0 = JK.x - STRIP.x, maxY = STRIP.h - JK.size;
        const at = (x, y) => { const m = nearestTwo(sigAt(d, dw, x, y, JK.size), table); return m && Object.assign(m, { x, y }); };
        const search = (lo, hi) => {
            let best = null;
            for (let y = lo; y <= hi; y += JK.coarse) { const m = at(x0, y); if (m && (!best || m.d < best.d)) best = m; }
            if (!best) return null;
            // 가장 맞는 자리 주변을 1px 단위로 다시 본다
            const cy = best.y;
            for (let y = Math.max(0, cy - JK.coarse + 1); y <= Math.min(maxY, cy + JK.coarse - 1); y++) {
                for (let x = x0 - 2; x <= x0 + 2; x++) { const m = at(x, y); if (m && m.d < best.d) best = m; }
            }
            return best;
        };
        let best = null;
        if (hintY != null) {
            const h = Math.round(hintY - STRIP.y);
            best = search(Math.max(0, h - HINT_RANGE), Math.min(maxY, h + HINT_RANGE));
            if (best && !(best.d <= JACKET_SURE && best.d <= best.second * JACKET_SURE_RATIO)) best = null;
        }
        if (!best) best = search(0, maxY);
        if (!best) return null;
        // 검토 화면에 보여줄 썸네일
        const thumb = document.createElement('canvas'); thumb.width = thumb.height = JK.size;
        thumb.getContext('2d').drawImage(c, best.x, best.y, JK.size, JK.size, 0, 0, JK.size, JK.size);
        best.ratio = best.second > 0 ? best.d / best.second : 1;
        best.thumb = thumb;
        best.yQhd = STRIP.y + best.y;
        return best;
    }

    // ── 숫자 ─────────────────
    // 칸 하나 → { text, digits: [{ch, ratio}] } / 빈칸·'-'면 null / 모양이 이상하면 { bad }
    function readCell(d, dw, x, y) {
        const minAt = (xx, yy) => { const i = ((y + yy) * dw + x + xx) * 4; return Math.min(d[i], d[i + 1], d[i + 2]); };
        let lastCol = -1, top = CELL_H, bottom = -1;
        for (let xx = 0; xx < CELL_W; xx++) {
            for (let yy = 0; yy < CELL_H; yy++) {
                if (minAt(xx, yy) > INK_MIN) {
                    lastCol = xx;
                    if (xx >= DIGIT_X0 - 2) { if (yy < top) top = yy; if (yy > bottom) bottom = yy; }
                }
            }
        }
        if (lastCol < 0 || bottom < 0) return null;                 // 빈칸 (그 패턴이 없다)
        if (bottom - top < DIGIT_MIN_H) return null;                // '-' (기록 없음)
        const n = Math.ceil((lastCol + 1 - DIGIT_X0) / DIGIT_P);
        if (n < 1 || n > 7) return { bad: 'len' };
        const digits = [];
        for (let k = 0; k < n; k++) digits.push(readDigit(minAt, DIGIT_X0 + DIGIT_P * k - 1));
        return { text: digits.map(g => g.ch).join(''), digits };
    }

    function readDigit(minAt, bx) {
        const g = new Float32Array(CELL_H * BOX_W);
        for (let yy = 0; yy < CELL_H; yy++) {
            for (let xx = 0; xx < BOX_W; xx++) {
                const v = (minAt(bx + xx, yy) - SOFT_LO) / SOFT_SPAN;
                g[yy * BOX_W + xx] = v < 0 ? 0 : v > 1 ? 1 : v;
            }
        }
        const dists = TEMPLATES.map(t => ({ ch: t.digit, dist: bestNcc(g, t) })).sort((a, b) => a.dist - b.dist);
        return { ch: dists[0].ch, ratio: dists[1].dist > 0 ? dists[0].dist / dists[1].dist : 1 };
    }

    // 1 - 정규화 상관, ±1px 흔든 것 중 가장 작은 값 (밀려난 자리는 0으로 채운다)
    function bestNcc(g, tpl) {
        let best = Infinity;
        const s = new Float32Array(g.length);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let mean = 0;
                for (let yy = 0; yy < CELL_H; yy++) {
                    const sy = yy - dy;
                    for (let xx = 0; xx < BOX_W; xx++) {
                        const sx = xx - dx;
                        const v = (sy >= 0 && sy < CELL_H && sx >= 0 && sx < BOX_W) ? g[sy * BOX_W + sx] : 0;
                        s[yy * BOX_W + xx] = v; mean += v;
                    }
                }
                mean /= s.length;
                let dot = 0, norm = 0;
                for (let i = 0; i < s.length; i++) { const v = s[i] - mean; dot += v * tpl.t[i]; norm += v * v; }
                const ncc = (norm > 0 && tpl.norm > 0) ? dot / (Math.sqrt(norm) * tpl.norm) : 0;
                if (1 - ncc < best) best = 1 - ncc;
            }
        }
        return best;
    }

    function maxRatio(d, dw, x, y, w, h) {
        let blue = 0;
        for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
                const i = ((y + yy) * dw + x + xx) * 4;
                if (d[i + 2] > 150 && d[i + 2] - d[i] > 60) blue++;
            }
        }
        return blue / (w * h);
    }

    const rateOf = score => Math.floor(score / 100) / 100;

    /* 표가 있는 화면인지 — 섹션 머리줄(HIGH SCORE · BEST RANK/RATE · BEST COMBO, y 618/778/938)은 거의 검은 띠이고
       바로 아래 칸 줄보다 어둡다. 자켓만 보면 라운드 화면의 큰 자켓이 같은 자리에 걸려 곡으로 잡힌 적이 있다(round2/3.jpg).
       실측: 컬렉션 10장 — 어두운(밝기<70) 픽셀 0.90~0.91, 아래 줄과 밝기 차 33~43 / 다른 화면 15장 — 세 줄 중 하나 이상이 0.65 이하 */
    const HEADER_YS = [618, 778, 938], HEADER_X0 = 1240, HEADER_X1 = 1900;
    const HEADER_DARK = 70, HEADER_DARK_MIN = 0.75, HEADER_STEP_MIN = 12;
    function headersOk(d, dw) {
        const lum = (x, y) => { const i = (y * dw + x) * 4; return (d[i] + d[i + 1] + d[i + 2]) / 3; };
        return HEADER_YS.every(cy => {
            let dark = 0, n = 0, band = 0, below = 0, nb = 0;
            for (let x = HEADER_X0; x < HEADER_X1; x += 2) {
                for (let y = cy - 6; y <= cy + 6; y += 2) { const v = lum(x - TABLE.x, y - TABLE.y); band += v; n++; if (v < HEADER_DARK) dark++; }
                for (let y = cy + 14; y < cy + 24; y += 2) { below += lum(x - TABLE.x, y - TABLE.y); nb++; }
            }
            return dark / n >= HEADER_DARK_MIN && below / nb - band / n >= HEADER_STEP_MIN;
        });
    }

    function readTable(frame, W) {
        const c = regionAtQhd(frame, W, TABLE), dw = c.width;
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        if (!headersOk(d, dw)) return null;
        const cells = [];
        BUTTONS.forEach((button, b) => PATTERNS.forEach((pattern, p) => {
            const x = Math.round((929 + 124 * b) * K) - TABLE.x, y = Math.round((356 + 120 + 24 * p) * K) - TABLE.y;
            const r = readCell(d, dw, x, y);
            if (!r) return;
            const cell = { button, pattern, flags: [] };
            if (r.bad) { cell.flags.push('자리수'); cell.score = null; cells.push(cell); return; }
            cell.text = r.text;
            cell.digitRatio = Math.max(...r.digits.map(g => g.ratio));
            if (cell.digitRatio > DIGIT_SURE_RATIO) cell.flags.push('숫자');
            const v = parseInt(r.text, 10);
            if (r.text.length === 7 ? v !== 1000000 : r.text.length < 6) cell.flags.push('자리수');
            cell.score = (v >= 0 && v <= 1000000) ? v : null;
            if (cell.score === null && !cell.flags.includes('자리수')) cell.flags.push('자리수');
            const mx = Math.round((929 + 124 * b + 88) * K) - TABLE.x, my = Math.round((356 + 360 + 24 * p) * K) - TABLE.y;
            cell.maxRatio = maxRatio(d, dw, mx, my, Math.round(28 * K), Math.round(22 * K));
            cell.max = cell.maxRatio >= MAX_ON;
            if (cell.maxRatio > MAX_GRAY[0] && cell.maxRatio < MAX_GRAY[1]) cell.flags.push('MAX');
            if (cell.score !== null) cell.rate = rateOf(cell.score);
            cells.push(cell);
        }));
        return { cells, canvas: c };
    }

    /* 한 장 읽기. 결과:
       { ok: false, reason }  — 컬렉션 MUSIC DATA 화면이 아니다 ('jacket': 선택된 곡 자켓이 없다, 'table': 기록 표가 없다)
       { ok: true, id, jacket: {d, second, ratio, thumb, y}, sure: 곡 확실?, cells: [...], table: 캔버스, key: 같은 화면인지 비교용 }
       hintY: 직전에 읽은 jacket.y를 주면 그 근처부터 찾는다 */
    function read(frame, W, H, table, hintY) {
        if (!frame || !W || !table || !table.length) return { ok: false, reason: 'no-frame' };
        if (Math.abs(W / H - QW / QH) > 0.02) return { ok: false, reason: 'ratio' };
        const jk = findJacket(frame, W, table, hintY);
        if (!jk || jk.d > JACKET_MAX || jk.ratio > JACKET_MAX_RATIO) return { ok: false, reason: 'jacket', jacket: jk };
        const t = readTable(frame, W);
        if (!t) return { ok: false, reason: 'table', jacket: jk };
        const key = jk.id + '|' + t.cells.map(c => c.button + c.pattern + ':' + (c.text || '?') + (c.max ? '*' : '')).join(',');
        return {
            ok: true, id: jk.id,
            jacket: { d: jk.d, second: jk.second, ratio: jk.ratio, thumb: jk.thumb, y: jk.yQhd },
            sure: jk.d <= JACKET_SURE && jk.ratio <= JACKET_SURE_RATIO,
            cells: t.cells, table: t.canvas, key
        };
    }

    global.VMH = global.VMH || {};
    global.VMH.ScanReader = { read, rateOf, BUTTONS, PATTERNS };
})(window);
