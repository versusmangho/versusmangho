/* DJMAX VERSUS MATCH 화면 읽기 — 로비의 8칸 명패와 라운드·결과 화면의 좌·우 명패.
   좌표는 모두 2560x1440 기준 비율이라 16:9면 해상도가 달라도 그대로 쓴다.
   (게임 화면만 잘라낸 프레임을 받는다는 전제 — lib/screen-capture.js가 보장한다)

   사람을 가리는 기준은 명패 왼쪽 아바타 칸이다. 닉네임 글자를 읽지(OCR) 않는다.
   왜 아바타 칸인가: READY가 되면 명패 배경이 통째로 주황으로 덮여서 명패 전체로 해시하면
   같은 사람이 남남이 된다(실측 동일인 42~69 / 타인 31~45로 역전). 아바타 칸만 이 덮개를 안 받는다.
   실측(images/plates 37명 175장 · READY 토글 · 칸 이동 · 로비↔라운드↔결과 · 21:9): 동일인 최대 6.3 / 타인 최소 26.2.

   이중 검증 — 아바타가 같아도, 명패 쪽이 따로 맞아야 같은 사람이다:
     아바타 칸(grid·해시)  +  평소 명패면 명패 그림(artOf)이 다르지 않고 닉네임 모양이 맞을 것 / READY면 닉네임 모양(nameMaskOf).
   명패 그림은 여럿이 같은 걸 쓰기도 해서(묘묘·정관영 2.9) "다르면 남"으로만 쓴다 — 아바타가 같은 타인 넷 중 셋
   (오뎅·정관영, 묘묘·플로롱, 가을바람·ㄴㄷㅌ)이 그림에서 30 넘게 갈린다. 그림까지 같으면(달래·hyang) 닉네임이 가른다.
   그림이 맞으면 닉네임은 느슨한 기준(nameClose)으로 받는다 — 칸이 바뀌어 글자가 1~2px 밀린 것까지. */
(function (global) {
    'use strict';

    const IH = global.VMH.ImgHash;
    const BASE_W = 2560, BASE_H = 1440;

    /* ── 화면 속 자리 (2560x1440 기준 픽셀) ───────────────── */
    // 명패는 테두리 **안쪽만** 자른다. 테두리 색은 칸마다 다르다(PLAYER 1 주황 · PLAYER 2 청록 · 나머지 회색) —
    // 예전엔 테두리와 바깥 여백까지 잘라 아바타 칸 왼쪽에 테두리가 3px 섞였고, 같은 사람도 칸 종류가 바뀌면
    // 아바타 거리가 2.8 → 12까지 뛰었다(기준 18). 어두운 아바타는 넘어가서 PLAYER 1·2로 옮길 때마다 남이 됐다.
    // 실측(images/ 1440p): 로비 안쪽 x 1965.5~2380.5, 칸 윗변 239.7 + 106.63×칸(게임이 1080p 기준 80px 간격으로 그린다),
    // 결과 x 272~688 · 1872~2288, y 1160~1240, 라운드는 107px 위. 높이는 모두 80
    const LOBBY_PLATE = { x: 1966, y: 239.75, w: 414, h: 80, step: 320 / 3 };   // PLAYERS 패널 8칸
    const LOBBY_ROWS = 8;
    const RESULT_PLATE = { y: 1160, w: 416, h: 80, xLeft: 272, xRight: 1872 };
    const ROUND_PLATE_Y = 1053;   // 라운드(곡 시작 전) 화면 — 결과 화면과 같은 명패가 107px 위에 있다 (스샷 7장 확인)
    // 명패 안에서 아바타 칸이 차지하는 자리 — 명패 높이에 대한 비율(해상도·화면별 크기 차이를 흡수).
    // 아바타는 안쪽 왼쪽 79x80. 1px 어긋나도 테두리·경계선이 안 들어오게 3px 들여 자른다
    const ICON_INSET = 3 / 80, ICON_SIZE = 74 / 80;
    // 명패 그림(아바타 오른쪽 경계선 뒤) — 평소 명패에서만 보인다(READY는 주황이 통째로 덮는다).
    // 오른쪽 아래 HOST 뱃지 자리(x 333~, y 53~)는 방장만 달리므로 뺀다
    const ART_X0 = 84 / 80;             // 명패 높이에 대한 비율
    const ART_COLS = 8, ART_ROWS = 4;
    // 실측(images/lobby_00*.png): HOST 뱃지는 명패 안 x 334~413 · y 53~79 — 이 칸(x ≥ 332 · y ≥ 40)이 여유를 두고 덮는다.
    // 닉네임 칸도 x 302에서 끝난다(NAME_X1) — HOST는 어느 비교에도 들어오지 않는다
    const ART_SKIP = (cx, cy) => cx >= 6 && cy >= 2;   // HOST 뱃지가 걸치는 칸

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
       모든 사람에게 똑같이 보이므로 이게 걸리면 구분을 포기해야 한다 (실측 로비·라운드 3장 서로 1.8 이하 — images/lobby_001 8번 칸) */
    const DEFAULT_ICON_GRID = [196,165,237,192,155,232,166,105,186,163,98,180,184,141,219,198,165,237,201,157,237,177,102,187,151,48,136,152,48,136,167,81,167,201,157,237,212,157,237,181,71,157,172,48,135,172,48,136,182,76,161,212,157,237,221,148,228,202,73,160,196,49,136,197,51,138,210,100,185,225,157,238,236,157,237,231,129,210,218,49,137,224,87,171,237,156,236,236,157,238,244,157,234,240,65,153,238,48,136,238,51,140,244,136,218,245,158,236];

    /* ── 같은 사람인지 가르는 기준 (모두 실측 마진 안에서 잡은 값) ───────────────── */
    const GRID_SEGMENTS = 6;      // 4x4보다 6x6이 마진이 넓다 (2.7배 → 3.6배)
    const SAME_MAX_COLOR = 14;    // 동일인 최대 6.3 / 타인 최소 26.2 의 사이 (테두리를 빼고 자른 뒤. 전엔 동일인 12.3이라 18이었다)
    const SAME_MAX_HAM = 140;     // 동일인 최대 108 / 타인 최소 212 의 사이
    const ART_DIFF_MIN = 10;      // 명패 그림 거리가 이보다 크면 다른 사람. 동일인 최대 3.3(HOST 뱃지·칸 이동·21:9 포함) /
                                  // 아바타가 같은 타인 30.5~ (그림을 같이 쓰는 타인은 2.9 — 그래서 '같다'로는 안 쓴다)
    const AMBIGUOUS_RATIO = 1.6;  // 1위가 2위보다 이만큼 가깝지 않으면 판단을 미룬다
    const EMPTY_MAX_SD = 20;      // 빈 칸은 명암 편차가 거의 없다 (실측 빈칸 4.4 / 사람 45~90)
    // 지문 형식. 자르는 자리가 바뀌면 올린다 — 다른 형식끼리는 값이 안 맞으니 장부의 옛 지문은 비교하지 않는다
    // (2: 테두리 안쪽만 자름 + 명패 그림)
    const FP_VERSION = 2;

    /* ── 닉네임 글자 지문 ─────────────────
       아바타·명패 그림이 같은 두 사람은 닉네임으로만 갈린다. 글자를 읽지(OCR) 않고 글자 픽셀만 남긴 모양을 비교한다.
       평소엔 흰 글자, READY 때는 주황 배경 위 검은 글자라 명패마다 배경이 주황인지 먼저 보고 밝은 쪽/어두운 쪽을 글자로 잡는다.
       아래 줄의 레벨은 판마다 오를 수 있으므로 쓰지 않는다.
       명패(테두리 안쪽)를 높이 80px로 맞춘 뒤 **고정된 자리**(닉네임 줄)를 잘라 읽는다 — 글자 픽셀로 시작점을 찾으면
       배경 그림 부스러기가 글자보다 앞·위에 있을 때 모양 전체가 밀려 같은 사람이 남이 된다.

       READY와 평소는 따로 보관한다(fp.names.ready / .normal). 평소 모양엔 밝은 배경 그림이 조금씩 섞이지만
       같은 사람이면 섞이는 것도 똑같으니 같은 상태끼리는 늘 맞는다. 상태가 다르면 섞인 부스러기만큼 어긋나서
       못 알아볼 수 있는데, 그건 로비에서 "한 명이 빠지고 아바타가 같은 명패가 하나 생겼다"로, 라운드·결과 화면에선
       "방 안에서 아바타가 같은 사람"으로 이어 준다(auto-room.js).
       (READY 글자가 평소 모양 안에 들어 있는지 보는 한쪽 비교(nameMayBeSame)는 그렇게 추린 후보를 거르는 데만 쓴다 —
       그것만으로 같은 사람이라 하면 획 많은 '달래' 안에 '도기'가 거의 다 들어간다) */
    // 아래 픽셀 값은 테두리 안쪽만 자른 명패 기준 (예전 여백 포함 자리에서 x −10, y −7 옮긴 같은 자리)
    const NAME_NORM_H = 80;       // 명패를 이 높이로 늘리거나 줄여서 읽는다 → 아래 픽셀 값은 모두 이 크기 기준 (1440p에선 1:1)
    const NAME_X0 = 86;           // 닉네임 칸 왼쪽 — 아바타(~79)와 경계선(79~82) 오른쪽. 글자는 ~90에서 시작
    const NAME_X1 = 0.73;         // 명패 너비 비율 — 오른쪽 캐릭터 그림 앞까지만
    const NAME_Y0 = 3;            // 닉네임 줄 위 (실측 글자 꼭대기 5~9)
    const NAME_ROWS = 27;         // 닉네임 줄 높이(3~29, 'y' 같은 내림 획 포함) — 세로줄 하나를 정수 하나에 담는다. 30~31부터 'LV.'
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
    const NAME_SCALE_TOL = 0.05;  // 명패 높이가 이 비율 안이면 같은 크기로 본다 (로비·결과 모두 80 — 해상도를 바꾸면 달라진다)
    const NAME_AMBIGUOUS_GAP = 6; // 닉네임이 맞는 후보가 둘일 때, 1·2위 거리(픽셀 수) 차이가 이보다 작으면 판단을 미룬다
    // READY↔평소 포함 검사(nameMayBeSame)에서 평소 모양에 남아도 되는 픽셀 — READY 글자 수 대비.
    // 실측(images/): 동일인(배경 안 섞임) 최대 0.002. 포함되는 타인은 누락(0.03 넘음)에서 이미 걸렀다.
    // 배경 부스러기 몫으로 넉넉히 두되, 글자 수가 1.5배인 이름이 적은 이름을 품는 건 막는다
    const COVER_EXCESS_MAX = 0.5;
    // 배경 그림이 크게 섞인(noisy) 평소 모양의 남는 픽셀 한도 — 그림 몫이 커서 따로 둔다.
    // 실측(images/plates): 동일인 최대 0.71(나는핵을써개못핵) / 타인 1.44(두 글자 '샤코'의 READY가 긴 이름의 평소 모양에 들어감)
    const NOISY_EXCESS_MAX = 1.0;
    // 같은 검사에서 READY 글자 중 평소 모양에 짝이 없어도 되는 몫. 칸이 바뀌면 글자가 1~2px 밀려 엄격한 기준(0.03)에 걸친다
    // (tla8405: 7번 칸 READY ↔ 8번 칸 평소 0.030). 실측(images/plates, 아바타가 같은 READY×평소):
    // 동일인 최대 0.031(21:9 라운드 화면 ↔ 로비) / 타인 최소 0.076(오뎅 READY ↔ 정관영 평소, noisy)
    const COVER_MISS_MAX = 0.05;
    // 평소 모양을 닉네임 폭(READY 모양 폭)까지만 비교할 때 뒤로 더 보는 칸 — 평소 흰 글자가 READY 검은 글자보다
    // 조금 넓게 잡히고, 조각 맞춤이 NAME_DRIFT씩 밀릴 수 있다
    const NAME_SPAN_TAIL = 6;
    // 닉네임 앞부분만 볼 때의 폭 (한글 세 글자쯤) — READY 폭을 모르는 평소 모양은 뒤에 명패 그림이 붙어 있을 수 있다
    const NAME_PREFIX_W = 64;
    // 이어 주기(nameClose)의 기준 — 아바타가 같고 "한 명이 빠지고 한 명이 생긴" 때만 쓰는 느슨한 값.
    // 같은 사람도 칸이 바뀌면 글자가 1~2px 밀리고 획 두께가 달라진다(PLAYER 1 칸이 특히 — Litra 0.041).
    // 실측(images/ 150장, 앞부분 비교): 동일인 최대 0.041 / 아바타가 같은 타인 최소 0.305
    const NAME_RELINK_RATIO = 0.15;

    const px = (v, size, base) => v * size / base;

    function rectOf(r, W, H) {
        return { x: px(r.x, W, BASE_W), y: px(r.y, H, BASE_H), w: px(r.w, W, BASE_W), h: px(r.h, H, BASE_H) };
    }

    function lobbyRowRect(i, W, H) {
        return rectOf({ x: LOBBY_PLATE.x, y: LOBBY_PLATE.y + LOBBY_PLATE.step * i, w: LOBBY_PLATE.w, h: LOBBY_PLATE.h }, W, H);
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

    /* 명패 그림의 색 배치 (ART_COLS x ART_ROWS, HOST 뱃지 칸은 뺀다) — 평소 명패에서만 의미가 있다 */
    function artOf(plateCanvas) {
        const h = plateCanvas.height, x0 = Math.round(h * ART_X0), w = plateCanvas.width - x0;
        if (w < ART_COLS) return null;
        const d = plateCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, 0, w, h).data;
        const out = [];
        for (let cy = 0; cy < ART_ROWS; cy++) {
            for (let cx = 0; cx < ART_COLS; cx++) {
                if (ART_SKIP(cx, cy)) continue;
                const xa = Math.round(cx * w / ART_COLS), xb = Math.round((cx + 1) * w / ART_COLS);
                const ya = Math.round(cy * h / ART_ROWS), yb = Math.round((cy + 1) * h / ART_ROWS);
                let r = 0, g = 0, b = 0, n = 0;
                for (let y = ya; y < yb; y++) {
                    for (let x = xa; x < xb; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
                }
                out.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
            }
        }
        return out;
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
        let last = -1, badge = false;
        for (let x = 0; x < rw; x++) {
            if (last >= 0 && colorIn(x, magenta) >= 4 && badgeAt(x)) { badge = true; break; }
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
        // badge: 뱃지에서 끝났다 = 모양이 닉네임뿐이다 (아니면 뒤에 명패 그림이 붙어 있을 수 있다)
        return { m: mask, ready, noisy: blobs > BLOB_MAX, badge };
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
        if (nm) names[nameState] = { m: nm.m, h: plateCanvas.height, noisy: nm.noisy, badge: nm.badge };
        return {
            v: FP_VERSION,
            grid: IH.getColorGridFromCanvas(icon, GRID_SEGMENTS),
            aHash: IH.aHashFromCanvas(icon),
            dHash: IH.dHashFromCanvas(icon),
            art: nameState === 'normal' ? artOf(plateCanvas) : null,
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
        // 평소 모양끼리는 닉네임 폭까지만 — 그 뒤는 명패 그림이다.
        // 둘 중 하나라도 '+' 뱃지에서 끝났으면 모양이 닉네임뿐이니 자르지 않는다
        // (자르면 '도기2'가 앞부분만으로 '도기'와 맞는다)
        const w = st === 'normal' && em === en.normal && !pm.badge && !em.badge ? nameSpan(e) : 0;
        const a = cutTo(pm.m, w), b = cutTo(em.m, w);
        return { d: nameDist(a, b), limit: ratioOf(pm, em) * Math.min(textPixels(a), textPixels(b)) };
    }

    /* 닉네임이 차지하는 폭 — READY 모양에서 안다(주황이 명패 그림을 가려 글자만 남는다). 모르면 0.
       평소 모양은 닉네임 바로 뒤에 밝은 명패 그림이 이어지면('+' 뱃지가 없는 사람) 그림까지 한 덩어리로 잡힌다.
       그 그림은 화면(로비·라운드)·프레임마다 조금씩 달리 이진화돼, 픽셀이 많은 만큼 같은 사람끼리도 어긋난다
       (오빠차: 평소 1836픽셀 중 닉네임은 앞 75칸뿐). 그래서 평소 모양은 READY 폭까지만 비교한다 */
    function nameSpan(e) {
        const r = e.names && e.names.ready;
        return r && r.m.length ? r.m.length + NAME_SPAN_TAIL : 0;
    }
    /* 모양을 앞 w칸으로 자른 것 (w가 0이거나 이미 짧으면 그대로). 비교마다 새로 자르지 않게 붙여 둔다 (JSON에는 안 실리는 캐시) */
    function cutTo(m, w) {
        if (!w || m.length <= w) return m;
        if (m._cutW !== w) { m._cut = m.slice(0, w); m._cutW = w; }
        return m._cut;
    }
    const nameOk = (c) => c && !c.uncomparable && c.d <= c.limit;

    /* READY↔평소 — 방금 읽은 명패(p)가 장부 지문(e)의 다른 상태 모양과 같은 사람일 수 있는가.
       READY 글자는 깔끔하게 뽑히고 평소 모양엔 배경 부스러기가 더해질 뿐이니, READY 글자가 평소 모양 안에 다 들어가야 한다.
       한쪽 포함이라 획 많은 이름('달래')이 적은 이름('도기')을 품는다 — 그래서 이것만으로 같은 사람이라 하지 않고,
       아바타·방 안·상태 모양 없음으로 이미 추린 후보를 걸러내는 데만 쓴다. 비교할 모양이 없으면 반박할 수 없으니 true */
    function nameMayBeSame(p, e) {
        const st = p.nameState;
        const em = st && e.names && e.names[otherState(st)];
        if (!em) return true;
        const pm = p.names[st];
        const [r, n] = st === 'ready' ? [pm, em] : [em, pm];
        const rp = textPixels(r.m);
        if (!rp || unmatched(r.m, dilated(n.m)) > Math.max(COVER_MISS_MAX, ratioOf(r, n)) * rp) return false;
        // 남는 픽셀은 닉네임 폭(READY 폭) 안에서만 센다 — 그 뒤의 명패 그림은 닉네임과 상관없다.
        // 배경 그림이 크게 섞인(noisy) 평소 모양은 그림 몫만큼 넉넉히 — 그래도 짧은 이름이 긴 이름 안에 들어가는 건 막는다
        const excess = unmatched(cutTo(n.m, r.m.length + NAME_SPAN_TAIL), dilated(r.m));
        return excess <= (n.noisy ? NOISY_EXCESS_MAX : COVER_EXCESS_MAX) * rp;
    }
    /* 같은 상태 모양 둘을 닉네임 앞부분만 비교한 거리 비율 (짝 없는 픽셀 ÷ 글자 픽셀). 폭은 READY 폭을 알면 그것,
       모르면 짧은 쪽(최대 NAME_PREFIX_W)에 NAME_SPAN_TAIL을 더한다 — 자리가 조금 밀려도 끝 글자가 잘리지 않게 */
    function prefixRatio(pm, em, span) {
        const w = span || Math.min(pm.m.length, em.m.length, NAME_PREFIX_W) + NAME_SPAN_TAIL;
        const a = cutTo(pm.m, w), b = cutTo(em.m, w);
        const n = Math.min(textPixels(a), textPixels(b));
        return n ? nameDist(a, b) / n : Infinity;
    }

    /* 느슨한 "같은 사람일 수 있다" — 이미 아바타·방 안·"빠진 사람 하나 + 생긴 명패 하나"로 추린 후보를 잇거나 거를 때만 쓴다.
       상태가 다르면 nameMayBeSame(READY 글자가 평소 모양 안에), 같으면 닉네임 앞부분이 NAME_RELINK_RATIO 안.
       같은 상태인데 엄격한 비교(nameCompare)에서 떨어지는 경우: 칸이 바뀌어 글자가 밀림, 평소 모양 뒤에 붙은 명패 그림의 흔들림 */
    function nameClose(p, e) {
        const st = p.nameState;
        if (!st || !e.names) return true;
        const em = e.names[st];
        if (!em) return nameMayBeSame(p, e);
        return prefixRatio(p.names[st], em, st === 'normal' ? nameSpan(e) : 0) <= NAME_RELINK_RATIO;
    }

    /* 같은 칸을 연달아 읽은 두 명패가 같은 모양인가 (로비 칸이 안정됐는지 보는 데 쓴다).
       READY를 켜고 끌 때 주황이 명패를 비스듬히 쓸고 지나가는 동안은 닉네임 앞 글자가 반쯤 가려진다(Gyuro 'G' — 0.063).
       그 프레임을 사람으로 믿지 않도록 엄격한 기준(NAME_SAME_RATIO)으로 보되, 명패 그림은 빼고 앞부분만 본다 */
    function sameReading(p, q) {
        if (!fpAvatarSame(p, q) || fpArtDiffers(p, q) || p.nameState !== q.nameState) return false;
        const st = p.nameState;
        return !st || prefixRatio(p.names[st], q.names[st], 0) <= NAME_SAME_RATIO;
    }

    /* 장부 지문(e)에 방금 읽은 상태의 닉네임 모양이 없거나 다른 크기에서 뜬 것인가 */
    function needsNameRefresh(p, e) {
        const st = p.nameState;
        if (!st) return false;
        const em = e.names && e.names[st];
        return !em || !sameScale(p.names[st], em) || (!!p.art && !e.art);
    }

    /* 장부 지문에 방금 읽은 상태의 닉네임 모양을 넣어 둔다 (다른 상태 것은 그대로). 평소 명패면 명패 그림도 */
    function mergeName(e, p) {
        const st = p.nameState;
        if (!st) return;
        e.names = Object.assign({}, e.names, { [st]: p.names[st] });
        if (p.art) e.art = p.art;
        delete e.name; delete e.nameH;   // 상태를 가리지 않던 옛 형식
    }

    /* 0에 가까울수록 같은 사람. 색 배치가 먼저고, 무늬(a/dHash)는 확인용 */
    function fpColorDist(a, b) { return IH.colorDist(a.grid, b.grid); }
    function fpHamDist(a, b) { return IH.hamDist(a.aHash, b.aHash) + IH.hamDist(a.dHash, b.dHash); }
    function fpAvatarSame(a, b) { return fpColorDist(a, b) <= SAME_MAX_COLOR && fpHamDist(a, b) <= SAME_MAX_HAM; }
    function fpNameSame(a, b) { const c = nameCompare(a, b); return !c || c.uncomparable || c.d <= c.limit; }
    function fpSame(a, b) { return fpAvatarSame(a, b) && !fpArtDiffers(a, b) && fpNameSame(a, b); }
    /* 명패 그림 — 둘 다 평소 명패를 본 적 있을 때만 비교된다. 다르면 확실히 남, 같다고 같은 사람은 아니다 */
    function fpArtDist(a, b) { return a.art && b.art ? IH.colorDist(a.art, b.art) : null; }
    function fpArtDiffers(a, b) { const d = fpArtDist(a, b); return d !== null && d > ART_DIFF_MIN; }
    function fpArtSame(a, b) { const d = fpArtDist(a, b); return d !== null && d <= ART_DIFF_MIN; }
    /* 지금 형식의 지문인가 — 자르는 자리가 바뀌기 전 장부 지문은 값이 안 맞아 비교하지 않는다 */
    function fpCurrent(fp) { return !!fp && fp.v === FP_VERSION; }

    /* 프로필이 안 뜬 기본 명패인가 — 맞으면 누구인지 가릴 수 없다 */
    function isDefaultPlate(fp) {
        return IH.colorDist(fp.grid, DEFAULT_ICON_GRID) <= SAME_MAX_COLOR;
    }

    /* 후보 목록에서 같은 사람 찾기.
       → { match, dist, refreshName } | null(없음) | { ambiguous: true, candidates }(엇비슷해 판단 보류)
       refreshName: 장부에 지금 상태의 닉네임 모양이 없거나 다른 크기에서 뜬 것 — 호출부가 mergeName으로 넣어 둘 것
       opts.loose: 닉네임이 엄격하게는 안 맞은 후보도 nameClose가 받으면 받는다 — 상태가 달라 평소 모양에 섞인
         배경 부스러기만큼 어긋났거나, 라운드·결과 화면이라 글자가 조금 밀린 것일 수 있다.
         후보를 "지금 방에 있는 사람"처럼 좁혀서 부를 때만 쓴다 — 장부 전체에 쓰면 아바타가 같은 남과 이어진다 */
    function findMatch(fp, candidates, getFp, opts = {}) {
        const all = [];
        for (const cand of candidates) {
            const cfp = getFp ? getFp(cand) : cand;
            // 명패 그림이 다르면 아바타·닉네임이 어떻든 남이다 (이중 검증의 한쪽)
            if (fpCurrent(cfp) && !fpArtDiffers(fp, cfp)) all.push({ cand, fp: cfp, d: fpColorDist(fp, cfp) });
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
            // 명패 그림까지 맞는 사람은 닉네임을 느슨하게(nameClose) 본다 — 칸이 바뀌어 글자가 밀려도 잇는다.
            // 아바타·그림이 같은 타인(달래·hyang)은 닉네임 앞부분에서 0.3 넘게 갈린다
            const art = near.filter(n => fpArtSame(fp, n.fp) && nameClose(fp, n.fp));
            if (art.length > 1) return { ambiguous: true, candidates: art.map(n => n.cand) };
            if (art.length) return { match: art[0].cand, dist: art[0].d, refreshName: true };
            // 닉네임이 맞는 사람이 없다 → 비교할 닉네임 모양이 아예 없는 항목만 아바타로 이어 줄 수 있다
            // (opts.loose면 엄격한 비교에서 떨어진 항목도 — nameClose가 받을 때만)
            pool = all.filter(n => {
                const c = n.nc !== undefined ? n.nc : nameCompare(fp, n.fp);
                return !c || (opts.loose && nameClose(fp, n.fp));
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

    /* 명패 한 칸 읽기 → { empty, unknown, fp, thumb, canvas }.
       픽셀 경계에 맞춰 자른다 — 소수점 자리에서 자르면 칸마다 다르게 보간돼 같은 글자도 획 두께가 달라진다 */
    function readPlate(frame, rect) {
        const x = Math.round(rect.x), y = Math.round(rect.y);
        const canvas = IH.cropToCanvas(frame, x, y, Math.round(rect.x + rect.w) - x, Math.round(rect.y + rect.h) - y);
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
        makeFingerprint, fpColorDist, fpHamDist, fpAvatarSame, fpArtDist, fpArtDiffers, fpArtSame, fpCurrent, fpSame,
        findMatch, isDefaultPlate, plateThumb,
        nameMaskOf, nameDist, nameCompare, nameMayBeSame, nameClose, sameReading, mergeName,
        isLobbyScreen, isResultScreen, isRoundScreen, readPlate, readLobby, readResult, readRound,
        SAME_MAX_COLOR, SAME_MAX_HAM,
        // 명패 테스트(plate-test.js)가 판정 여유를 재는 데 쓴다
        _internal: { unmatched, dilated, textPixels, prefixRatio, nameSpan, cutTo, ratioOf, NAME_SPAN_TAIL }
    };
})(window);
