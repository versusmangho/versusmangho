/* DJMAX VERSUS MATCH 화면 읽기 — 로비의 8칸 명패와 라운드·결과 화면의 좌·우 명패.
   좌표는 모두 2560x1440 기준 비율이라 16:9면 해상도가 달라도 그대로 쓴다.
   (게임 화면만 잘라낸 프레임을 받는다는 전제 — lib/screen-capture.js가 보장한다)

   사람을 가리는 기준은 명패 왼쪽 아바타 칸이다. 닉네임 글자를 읽지(OCR) 않는다.
   왜 아바타 칸인가: READY가 되면 명패 배경이 통째로 주황으로 덮여서 명패 전체로 해시하면
   같은 사람이 남남이 된다(실측 동일인 42~69 / 타인 31~45로 역전). 아바타 칸만 이 덮개를 안 받는다.
   실측(스샷 17명 · READY 토글 · 로비↔결과 교차, 528쌍): 동일인 최대 8.8 / 타인 최소 31.3.
   아바타·명패 그림까지 같은 사람은 아바타로 추린 뒤 닉네임 줄의 글자 모양으로 가른다(nameMaskOf). */
(function (global) {
    'use strict';

    const IH = global.VMH.ImgHash;
    const BASE_W = 2560, BASE_H = 1440;

    /* ── 화면 속 자리 (2560x1440 기준 픽셀) ───────────────── */
    const LOBBY_ROW = { x: 1956, y: 233, w: 436, h: 94, step: 106.5 };   // PLAYERS 패널 8칸
    const LOBBY_ROWS = 8;
    const RESULT_PLATE = { y: 1152, w: 432, h: 93, xLeft: 263, xRight: 1863 };
    const ROUND_PLATE_Y = 1045;   // 라운드(곡 시작 전) 화면 — 결과 화면과 같은 명패가 107px 위에 있다 (스샷 7장 확인)
    // 명패 안에서 아바타 칸이 차지하는 자리 — 명패 높이에 대한 비율(해상도·화면별 크기 차이를 흡수)
    const ICON_INSET = 6 / 94, ICON_SIZE = 82 / 94;

    /* 화면 종류를 가르는 색 표본 자리 (2560x1440 기준) */
    const PROBE = {
        p1Badge: { x: 1805, y: 250, w: 86, h: 60 },   // 로비 PLAYER 1 뱃지 — 주황
        p2Badge: { x: 1805, y: 360, w: 86, h: 60 },   // 로비 PLAYER 2 뱃지 — 청록
        r1Band:  { x: 1075, y: 272, w: 400, h: 24 },  // 결과 화면 ROUND 1 빨간 띠
        roundBar: { x: 1180, y: 2, w: 200, h: 10 }    // 라운드 화면 맨 위 타이머 막대 — 시간이 갈수록 가운데로 줄어들므로 가운데만 본다
    };
    const RESULT_BAND_RGB = [252, 95, 84];
    const RESULT_BAND_TOL = 40;   // 실측: 결과 화면 0~1, 라운드 화면·로비는 130 이상
    const ROUND_BAR_RGB = [254, 27, 59];   // 실측: 라운드 화면 7장 모두 이 색(±1), 결과·로비·밴픽은 거리 200 이상

    /* 프로필이 안 뜬 기본 명패(분홍 실루엣)의 아바타 칸 색 배치.
       모든 사람에게 똑같이 보이므로 이게 걸리면 구분을 포기해야 한다 (실측 서로 11.0 — 동일인 임계값 안쪽) */
    const DEFAULT_ICON_GRID = [194,176,216,194,168,227,178,136,198,172,126,188,188,157,218,202,180,228,195,164,226,188,128,214,150,50,139,145,42,132,171,94,181,204,168,240,202,162,220,190,94,180,170,43,131,170,44,131,185,82,169,212,164,236,206,154,214,210,96,184,197,51,139,197,50,138,212,108,193,220,162,234,214,154,216,238,134,218,222,50,138,226,76,162,240,158,239,230,158,230,212,155,206,240,94,173,236,55,136,236,62,142,241,130,206,229,162,223];

    /* ── 같은 사람인지 가르는 기준 (모두 실측 마진 안에서 잡은 값) ───────────────── */
    const GRID_SEGMENTS = 6;      // 4x4보다 6x6이 마진이 넓다 (2.7배 → 3.6배)
    const SAME_MAX_COLOR = 18;    // 동일인 최대 8.8 / 타인 최소 31.3 의 사이
    const SAME_MAX_HAM = 140;     // 동일인 최대 73 / 타인 최소 212 의 사이
    const AMBIGUOUS_RATIO = 1.6;  // 1위가 2위보다 이만큼 가깝지 않으면 판단을 미룬다
    const EMPTY_MAX_SD = 20;      // 빈 칸은 명암 편차가 거의 없다 (실측 빈칸 4.4 / 사람 45~90)

    /* ── 닉네임 글자 지문 ─────────────────
       아바타·명패 그림이 같은 두 사람은 닉네임으로만 갈린다. 글자를 읽지(OCR) 않고 글자 픽셀만 남긴 모양을 비교한다.
       평소엔 흰 글자, READY 때는 주황 배경 위 검은 글자라 명패마다 배경이 주황인지 먼저 보고 밝은 쪽/어두운 쪽을 글자로 잡는다.
       아래 줄의 레벨은 판마다 오를 수 있으므로 쓰지 않는다.
       명패를 높이 94px로 맞춘 뒤 **고정된 자리**(닉네임 줄)를 잘라 읽는다 — 글자 픽셀로 시작점을 찾으면
       배경 그림 부스러기가 글자보다 앞·위에 있을 때 모양 전체가 밀려 같은 사람이 남이 된다.

       READY와 평소는 따로 보관한다(fp.names.ready / .normal). 평소 모양엔 밝은 배경 그림이 조금씩 섞이지만
       같은 사람이면 섞이는 것도 똑같으니 같은 상태끼리는 늘 맞는다. 상태가 다르면 섞인 부스러기만큼 어긋나서
       못 알아볼 수 있는데, 그건 로비에서 "한 명이 빠지고 아바타가 같은 명패가 하나 생겼다"로 이어 준다(auto-room.js).
       (READY 글자가 평소 모양 안에 들어 있는지만 보는 한쪽 비교는 쓰지 않는다 — 획 많은 '달래' 안에 '도기'가 거의 다 들어간다) */
    const NAME_NORM_H = 94;       // 명패를 이 높이로 늘리거나 줄여서 읽는다 → 아래 픽셀 값은 모두 이 크기 기준
    const NAME_X0 = 96;           // 닉네임 칸 왼쪽 — 아바타(~88)와 READY 때 어둡게 잡히는 경계선(88~91) 오른쪽. 글자는 ~100에서 시작
    const NAME_X1 = 0.72;         // 명패 너비 비율 — 오른쪽 캐릭터 그림 앞까지만
    const NAME_Y0 = 10;           // 닉네임 줄 위 — 그 위는 명패 테두리 (실측 글자 꼭대기 12~16)
    const NAME_ROWS = 27;         // 닉네임 줄 높이(10~36, 'y' 같은 내림 획 포함) — 세로줄 하나를 정수 하나에 담는다. 37~38부터 'LV.'
    const BORDER_ROW_SHARE = 0.8; // 이보다 넓게 찬 가로줄은 명패 테두리 (READY 땐 테두리도 어둡게 잡힌다)
    const BADGE_W = 12;           // 닉네임 뒤 '+' 뱃지 폭(≈18px) 중 이만큼을 훑어 절반 넘게 분홍이면 뱃지
    const BLOB_MAX = 2;           // 5x5가 꽉 찬 픽셀이 이보다 많으면 배경 그림이 크게 섞인 것(noisy)
    const NAME_GAP = 24;          // 글자 없는 폭이 이만큼 이어지면 닉네임이 끝난 것 (뒤의 배경 티끌을 자른다)
    const NAME_CHUNK = 16;        // 따로 맞추는 조각 폭 (글자 하나 ≈ 20px)
    const NAME_START_SHIFT = 3;   // 첫 조각을 좌우로 미는 범위 — 둘 다 같은 자리에서 잘랐으므로 작다
    const NAME_DRIFT = 2;         // 다음 조각이 앞 조각보다 더 밀릴 수 있는 폭
    const TEXT_MIN = 130;         // 평소: min(R,G,B)가 이 이상이면 흰 글자 픽셀 (축소돼 번진 가는 획까지 남긴다)
    const TEXT_TINT_MAX = 60;     // 평소: 채널 차이가 이보다 크면 색이 있는 배경 그림이지 흰 글자가 아니다
    const DARK_TEXT_MAX = 155;    // READY: R이 이 이하면 검은 글자 픽셀. 주황(R 255)과 검정(R 18)이 가장 크게 갈리는 채널이
                                  // R이라 축소돼 주황과 섞인 가는 획도 남는다. 획이 차지하는 비율로 흰 글자 기준(130)과 맞춘 값(≈42%)
    const READY_PROBE_W = 40;     // READY인지는 닉네임 칸 왼쪽 이만큼만 본다 — 오른쪽은 명패 그림이라 노란 그림에 속는다
    const READY_ORANGE_SHARE = 0.4;   // 그 안의 이만큼이 READY 주황(실측 253,123,74 ~ 255,175,47)이면 READY
    // 같은 사람 기준 = 짝 없는 픽셀 수 ÷ 글자 픽셀 수. 긴 닉네임일수록 흔들림도 커지므로 비율로 본다.
    // 한 획 차이 닉네임은 실제 스샷에 없어 합성(맑은 고딕)으로 쟀다: 동일인 최대 0.022 / 도기↔모기 0.042
    const NAME_SAME_RATIO = 0.03;      // 같은 캡처 크기
    const NAME_SAME_RATIO_XRES = 0.08; // 명패 크기가 다를 때(공유 해상도를 바꿈): 동일인 최대 0.049 / 획 하나 차이 0.04~0.066 — 겹친다.
                                       // 그 밖은 0.10 이상이라 여기선 느슨하게 받고, 맞으면 지금 크기의 지문으로 바꿔 둔다
    const NAME_SCALE_TOL = 0.05;  // 명패 높이가 이 비율 안이면 같은 크기로 본다 (로비 94 ↔ 결과 93)
    const NAME_AMBIGUOUS_GAP = 6; // 닉네임이 맞는 후보가 둘일 때, 1·2위 거리(픽셀 수) 차이가 이보다 작으면 판단을 미룬다

    const px = (v, size, base) => v * size / base;

    function rectOf(r, W, H) {
        return { x: px(r.x, W, BASE_W), y: px(r.y, H, BASE_H), w: px(r.w, W, BASE_W), h: px(r.h, H, BASE_H) };
    }

    function lobbyRowRect(i, W, H) {
        return rectOf({ x: LOBBY_ROW.x, y: LOBBY_ROW.y + LOBBY_ROW.step * i, w: LOBBY_ROW.w, h: LOBBY_ROW.h }, W, H);
    }

    function resultPlateRect(side, W, H, y = RESULT_PLATE.y) {
        const x = side === 'left' ? RESULT_PLATE.xLeft : RESULT_PLATE.xRight;
        return rectOf({ x, y, w: RESULT_PLATE.w, h: RESULT_PLATE.h }, W, H);
    }

    function roundPlateRect(side, W, H) { return resultPlateRect(side, W, H, ROUND_PLATE_Y); }

    /* 명패 캔버스에서 아바타 칸만 잘라낸다 */
    function iconOf(plateCanvas) {
        const h = plateCanvas.height, inset = h * ICON_INSET, size = h * ICON_SIZE;
        return IH.cropToCanvas(plateCanvas, inset, inset, size, size);
    }

    function avgColor(src, r) {
        const c = IH.cropToCanvas(src, r.x, r.y, r.w, r.h);
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        let sum = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
        const n = d.length / 4;
        return [sum[0] / n, sum[1] / n, sum[2] / n];
    }

    /* 밝기 표준편차 — 빈 칸(거의 단색)을 가려낸다 */
    function lumSd(canvas) {
        const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0, sq = 0, n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
            const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
            sum += l; sq += l * l;
        }
        const mean = sum / n;
        return Math.sqrt(Math.max(0, sq / n - mean * mean));
    }

    /* 닉네임 줄을 이진화한 모양 → { m: 세로줄마다 정수 하나(비트 r = 닉네임 줄 위에서 r번째 픽셀), ready }.
       글자를 못 찾거나 배경 그림이 크게 섞였으면 null */
    function nameMaskOf(plateCanvas) {
        const k = NAME_NORM_H / plateCanvas.height;
        const sx0 = NAME_X0 / k, sw = plateCanvas.width * NAME_X1 - sx0;
        const rw = Math.round(sw * k), rh = NAME_Y0 + NAME_ROWS;
        if (rw < NAME_GAP) return null;
        const c = document.createElement('canvas'); c.width = rw; c.height = rh;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(plateCanvas, sx0, 0, sw, rh / k, 0, 0, rw, rh);
        const d = ctx.getImageData(0, 0, rw, rh).data;
        const on = new Uint8Array(rw * rh);
        // READY면 배경이 주황으로 덮이고 글자가 검게 바뀐다 → 어두운 픽셀이 글자
        let orange = 0;
        const probeW = Math.min(rw, READY_PROBE_W);
        for (let y = NAME_Y0; y < rh; y++) {
            for (let x = 0; x < probeW; x++) {
                const i = (y * rw + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
                if (r >= 220 && g >= 90 && g <= 200 && b <= 110) orange++;
            }
        }
        const ready = orange >= probeW * NAME_ROWS * READY_ORANGE_SHARE;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            on[p] = ready ? (r <= DARK_TEXT_MAX ? 1 : 0)
                : (Math.min(r, g, b) >= TEXT_MIN && Math.max(r, g, b) - Math.min(r, g, b) <= TEXT_TINT_MAX ? 1 : 0);
        }

        // 가로로 거의 꽉 찬 줄은 명패 테두리다 — 글자가 아니므로 지운다
        for (let y = 0; y < rh; y++) {
            let n = 0;
            for (let x = 0; x < rw; x++) n += on[y * rw + x];
            if (n > rw * BORDER_ROW_SHARE) on.fill(0, y * rw, (y + 1) * rw);
        }

        const column = (x) => {
            let bits = 0;
            for (let y = NAME_Y0; y < rh; y++) if (on[y * rw + x]) bits |= 1 << (y - NAME_Y0);
            return bits;
        };
        // 닉네임 뒤의 '+' 뱃지(분홍 네모 안 노란 별) — 여기서 닉네임이 끝난다.
        // 분홍 배경 그림에 속지 않도록 노란 별까지 있어야 뱃지로 본다
        const colorIn = (x, test) => {
            let n = 0;
            for (let y = NAME_Y0; y < rh; y++) {
                const i = (y * rw + x) * 4;
                if (test(d[i], d[i + 1], d[i + 2])) n++;
            }
            return n;
        };
        const magenta = (r, g, b) => r >= 170 && b >= 150 && g <= 100;
        const yellow = (r, g, b) => r >= 200 && g >= 170 && b <= 100;
        // 뱃지는 반짝이는 애니메이션이 있어 번쩍일 때는 아래쪽 분홍이 희게 뜬다(흰 글자로 잡힌다).
        // 그때도 가운데 노란 별은 남으므로 분홍+노랑 픽셀로 칸을 센다 (21:9 라운드 화면 스샷에서 확인)
        const badgeAt = (x) => {
            let pink = 0, star = 0;
            for (let j = x; j < Math.min(rw, x + BADGE_W); j++) {
                const y = colorIn(j, yellow);
                if (colorIn(j, magenta) + y >= 4) pink++;
                star += y;
            }
            return pink >= BADGE_W / 2 && star >= 3;
        };

        // 칸 왼쪽 끝(고정)부터, 뱃지나 NAME_GAP만큼의 빈 폭이 나오기 전까지
        const mask = [];
        let last = -1;
        for (let x = 0; x < rw; x++) {
            if (last >= 0 && colorIn(x, magenta) >= 4 && badgeAt(x)) break;
            const bits = column(x);
            if (!bits && last >= 0 && x - last > NAME_GAP) break;
            mask.push(bits);
            if (bits) last = x;
        }
        if (last < 0) return null;
        mask.length = last + 1;

        // 글자 획은 2~3px 두께다. 5x5가 통째로 찬 곳이 있으면 밝은 배경 그림이 크게 섞인 것(noisy).
        // 버리지 않는다 — 같은 사람이면 섞이는 그림도 똑같아서 같은 상태끼리는 여전히 비교된다.
        // 다만 READY(그림이 가려짐)와는 비교할 수 없다
        let blobs = 0;
        for (let i = 2; i < mask.length - 2; i++) {
            const v = mask[i - 2] & mask[i - 1] & mask[i] & mask[i + 1] & mask[i + 2];
            blobs += IH.popcnt32(v & (v >> 1) & (v >> 2) & (v >> 3) & (v >> 4));
        }
        return { m: mask, ready, noisy: blobs > BLOB_MAX };
    }

    /* 1px 번진 모양 — 안티앨리어싱·반올림으로 획이 한 칸 밀려도 짝을 찾게 한다 */
    function dilate(m) {
        const full = (1 << NAME_ROWS) - 1, out = new Array(m.length);
        for (let i = 0; i < m.length; i++) {
            const v = (m[i - 1] || 0) | m[i] | (m[i + 1] || 0);
            out[i] = (v | (v << 1) | (v >> 1)) & full;
        }
        return out;
    }
    const dilated = (m) => m._dil || (m._dil = dilate(m));   // JSON에는 안 실리는 캐시

    /* a의 글자 픽셀 중 b(번진 모양)에서 1px 안에 짝이 없는 수.
       a를 글자 하나 폭(NAME_CHUNK)씩 끊어 조각마다 따로 맞춘다 — 캡처 해상도가 다르면 닉네임 뒤로 갈수록
       폭이 조금씩 밀리는데(900p↔1440p에서 네 글자 끝이 3px 넘게), 한 번에 맞추면 그게 전부 틀린 픽셀로 잡힌다.
       조각 사이의 밀림은 NAME_DRIFT까지만 허용해서 조각이 엉뚱한 글자에 붙지 못하게 한다. */
    function unmatched(a, db) {
        const full = (1 << NAME_ROWS) - 1;
        const sh = (v, dy) => (dy >= 0 ? v << dy : v >> -dy) & full;
        let total = 0, prevDx = 0;
        for (let s = 0; s < a.length; s += NAME_CHUNK) {
            const e = Math.min(a.length, s + NAME_CHUNK);
            const range = s ? NAME_DRIFT : NAME_START_SHIFT;
            let best = Infinity, bestDx = prevDx;
            for (let dx = prevDx - range; dx <= prevDx + range; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    let miss = 0;
                    for (let i = s; i < e && miss < best; i++) miss += IH.popcnt32(a[i] & ~sh(db[i - dx] || 0, dy));
                    if (miss < best || (miss === best && Math.abs(dx - prevDx) < Math.abs(bestDx - prevDx))) { best = miss; bestDx = dx; }
                }
            }
            total += best;
            prevDx = bestDx;
        }
        return total;
    }

    /* 두 닉네임 모양의 거리 = 서로 짝이 없는 글자 픽셀 수의 합 (0이면 같은 모양) */
    function nameDist(a, b) {
        if (!a || !b || !a.length || !b.length) return Infinity;
        return unmatched(a, dilated(b)) + unmatched(b, dilated(a));
    }

    function textPixels(m) {
        if (m._px === undefined) m._px = m.reduce((n, v) => n + IH.popcnt32(v), 0);
        return m._px;
    }

    const otherState = (st) => st === 'ready' ? 'normal' : 'ready';

    /* 명패 한 칸의 지문. 아바타 칸(grid·해시)으로 먼저 추리고, 닉네임 모양(names)으로 가른다.
       nameState: 이 명패를 읽은 상태('ready' | 'normal'), 닉네임을 못 읽었으면 null */
    function makeFingerprint(plateCanvas) {
        const icon = iconOf(plateCanvas);
        const nm = nameMaskOf(plateCanvas);
        const nameState = nm ? (nm.ready ? 'ready' : 'normal') : null;
        const names = {};
        if (nm) names[nameState] = { m: nm.m, h: plateCanvas.height, noisy: nm.noisy };
        return {
            grid: IH.getColorGridFromCanvas(icon, GRID_SEGMENTS),
            aHash: IH.aHashFromCanvas(icon),
            dHash: IH.dHashFromCanvas(icon),
            names, nameState
        };
    }

    function sameScale(a, b) {
        return Math.abs(a.h - b.h) <= NAME_SCALE_TOL * Math.max(a.h, b.h);
    }
    const ratioOf = (a, b) => sameScale(a, b) ? NAME_SAME_RATIO : NAME_SAME_RATIO_XRES;

    /* 방금 읽은 명패(p)의 닉네임을 다른 지문(e)과 비교
       → { d, limit } | { uncomparable: true }(상태가 다르고 한쪽에 배경 그림이 섞임) | null(닉네임 모양이 아예 없음).
       같은 상태 모양이 있으면 그것과, 없으면 다른 상태 모양과 비교한다 (흰 글자·검은 글자 두께는 맞춰 뒀다) */
    function nameCompare(p, e) {
        const st = p.nameState;
        const en = e.names;
        if (!st || !en) return null;
        const pm = p.names[st];
        let em = en[st];
        if (!em) {
            em = en[otherState(st)];
            if (!em) return null;
            if (pm.noisy || em.noisy) return { uncomparable: true };
        }
        return { d: nameDist(pm.m, em.m), limit: ratioOf(pm, em) * Math.min(textPixels(pm.m), textPixels(em.m)) };
    }
    const nameOk = (c) => c && !c.uncomparable && c.d <= c.limit;

    /* 장부 지문(e)에 방금 읽은 상태의 닉네임 모양이 없거나 다른 크기에서 뜬 것인가 */
    function needsNameRefresh(p, e) {
        const st = p.nameState;
        if (!st) return false;
        const em = e.names && e.names[st];
        return !em || !sameScale(p.names[st], em);
    }

    /* 장부 지문에 방금 읽은 상태의 닉네임 모양을 넣어 둔다 (다른 상태 것은 그대로) */
    function mergeName(e, p) {
        const st = p.nameState;
        if (!st) return;
        e.names = Object.assign({}, e.names, { [st]: p.names[st] });
        delete e.name; delete e.nameH;   // 상태를 가리지 않던 옛 형식
    }

    /* 0에 가까울수록 같은 사람. 색 배치가 먼저고, 무늬(a/dHash)는 확인용 */
    function fpColorDist(a, b) { return IH.colorDist(a.grid, b.grid); }
    function fpHamDist(a, b) { return IH.hamDist(a.aHash, b.aHash) + IH.hamDist(a.dHash, b.dHash); }
    function fpAvatarSame(a, b) { return fpColorDist(a, b) <= SAME_MAX_COLOR && fpHamDist(a, b) <= SAME_MAX_HAM; }
    function fpNameSame(a, b) { const c = nameCompare(a, b); return !c || c.uncomparable || c.d <= c.limit; }
    function fpSame(a, b) { return fpAvatarSame(a, b) && fpNameSame(a, b); }

    /* 프로필이 안 뜬 기본 명패인가 — 맞으면 누구인지 가릴 수 없다 */
    function isDefaultPlate(fp) {
        return IH.colorDist(fp.grid, DEFAULT_ICON_GRID) <= SAME_MAX_COLOR;
    }

    /* 후보 목록에서 같은 사람 찾기.
       → { match, dist, refreshName } | null(없음) | { ambiguous: true, candidates }(엇비슷해 판단 보류)
       refreshName: 장부에 지금 상태의 닉네임 모양이 없거나 다른 크기에서 뜬 것 — 호출부가 mergeName으로 넣어 둘 것
       opts.loose: 닉네임을 비교할 수 없는 후보(상태가 다르고 배경이 섞임)도 아바타만으로 받는다.
         후보를 "지금 방에 있는 사람"처럼 좁혀서 부를 때만 쓴다 — 장부 전체에 쓰면 아바타가 같은 남과 이어진다 */
    function findMatch(fp, candidates, getFp, opts = {}) {
        const all = [];
        for (const cand of candidates) {
            const cfp = getFp ? getFp(cand) : cand;
            if (cfp) all.push({ cand, fp: cfp, d: fpColorDist(fp, cfp) });
        }
        let pool = all;

        if (fp.nameState) {
            // 아바타가 같은 사람이 여럿일 수 있다 — 아바타로 추린 뒤 닉네임으로 가른다
            const near = all.filter(n => fpAvatarSame(fp, n.fp));
            for (const n of near) n.nc = nameCompare(fp, n.fp);
            const named = near.filter(n => nameOk(n.nc)).sort((x, y) => x.nc.d - y.nc.d);
            if (named.length) {
                if (named.length > 1 && named[1].nc.d - named[0].nc.d < NAME_AMBIGUOUS_GAP) {
                    return { ambiguous: true, candidates: named.map(n => n.cand) };
                }
                return { match: named[0].cand, dist: named[0].d, refreshName: needsNameRefresh(fp, named[0].fp) };
            }
            // 닉네임이 맞는 사람이 없다 → 비교할 닉네임 모양이 아예 없는 항목만 아바타로 이어 줄 수 있다
            // (상태가 달라 비교가 안 되는 항목은 opts.loose일 때만)
            pool = all.filter(n => {
                const c = n.nc !== undefined ? n.nc : nameCompare(fp, n.fp);
                return !c || (opts.loose && c.uncomparable);
            });
        }

        const near = pool.filter(n => fpAvatarSame(fp, n.fp)).sort((x, y) => x.d - y.d);
        if (!near.length) return null;
        let secondD = Infinity;
        for (const n of pool) if (n !== near[0] && n.d < secondD) secondD = n.d;
        if (secondD < Infinity && near[0].d * AMBIGUOUS_RATIO > secondD) {
            return { ambiguous: true, candidates: near.map(n => n.cand) };
        }
        return { match: near[0].cand, dist: near[0].d, refreshName: needsNameRefresh(fp, near[0].fp) };
    }

    /* 표시용 명패 이미지 (localStorage에 넣으므로 JPEG로 줄여서).
       표에 40px 높이로 그려지므로(2배 화면 기준 80px) 그보다 크게 잡아 둔다 */
    function plateThumb(plateCanvas) {
        const w = 360, h = Math.round(w * plateCanvas.height / plateCanvas.width);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(plateCanvas, 0, 0, w, h);
        return c.toDataURL('image/jpeg', 0.72);
    }

    /* ── 화면 종류 ───────────────── */
    function isLobbyScreen(frame, W, H) {
        // PLAYER 1(주황) · PLAYER 2(청록) 뱃지가 같이 보이면 버서스 로비.
        // 프리매치 로비에는 이 뱃지가 없어서 자연스럽게 걸러진다.
        const p1 = avgColor(frame, rectOf(PROBE.p1Badge, W, H));
        const p2 = avgColor(frame, rectOf(PROBE.p2Badge, W, H));
        return (p1[0] - p1[1] > 50 && p1[1] - p1[2] > 30) && (p2[1] - p2[0] > 60 && p2[2] - p2[0] > 60);
    }

    function colorNear(frame, probe, rgb, W, H) {
        const c = avgColor(frame, rectOf(probe, W, H));
        return Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]) <= RESULT_BAND_TOL;
    }

    function isResultScreen(frame, W, H) {
        // ROUND 1 빨간 띠의 색이 딱 맞을 때만. 라운드 진행 화면에는 이 띠가 회색/파랑으로 깔린다
        return colorNear(frame, PROBE.r1Band, RESULT_BAND_RGB, W, H);
    }

    /* 라운드 화면(곡 고르고 시작하기 전) — 여기가 뜨면 두 사람의 대결이 성사된 것이다 */
    function isRoundScreen(frame, W, H) {
        return colorNear(frame, PROBE.roundBar, ROUND_BAR_RGB, W, H);
    }

    /* 명패 한 칸 읽기 → { empty, unknown, fp, thumb, canvas } */
    function readPlate(frame, rect) {
        const canvas = IH.cropToCanvas(frame, rect.x, rect.y, rect.w, rect.h);
        const icon = iconOf(canvas);
        if (lumSd(icon) < EMPTY_MAX_SD) return { empty: true };
        const fp = makeFingerprint(canvas);
        return { empty: false, unknown: isDefaultPlate(fp), fp, canvas, thumb: () => plateThumb(canvas) };
    }

    /* 로비 화면 → 8칸. PLAYER 1·2는 늘 0·1번 칸이다 (스샷 4종 전부 확인) */
    function readLobby(frame, W, H) {
        const rows = [];
        for (let i = 0; i < LOBBY_ROWS; i++) rows.push(Object.assign({ index: i }, readPlate(frame, lobbyRowRect(i, W, H))));
        return { rows, pair: [rows[0], rows[1]] };
    }

    /* 결과 화면 → 맞붙은 두 명 */
    function readResult(frame, W, H) {
        return {
            left: readPlate(frame, resultPlateRect('left', W, H)),
            right: readPlate(frame, resultPlateRect('right', W, H))
        };
    }

    /* 라운드 화면 → 맞붙은 두 명 */
    function readRound(frame, W, H) {
        return {
            left: readPlate(frame, roundPlateRect('left', W, H)),
            right: readPlate(frame, roundPlateRect('right', W, H))
        };
    }

    global.VMH = global.VMH || {};
    global.VMH.Room = {
        LOBBY_ROWS, BASE_W, BASE_H,
        lobbyRowRect, resultPlateRect, roundPlateRect,
        makeFingerprint, fpColorDist, fpHamDist, fpAvatarSame, fpSame, findMatch, isDefaultPlate, plateThumb,
        nameMaskOf, nameDist, nameCompare, mergeName,
        isLobbyScreen, isResultScreen, isRoundScreen, readPlate, readLobby, readResult, readRound,
        SAME_MAX_COLOR, SAME_MAX_HAM
    };
})(window);
