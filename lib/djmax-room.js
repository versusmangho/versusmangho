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
        p1Tag: { x: 960, y: 999, w: 110, h: 10 },     // 가운데 PLAYERS 칸의 PLAYER 1 꼬리표 윗부분(글자 위) — 주황
        p2Tag: { x: 960, y: 1146, w: 110, h: 10 },    // 가운데 PLAYERS 칸의 PLAYER 2 꼬리표 윗부분 — 청록
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
    /* ── 움직이는 명패 ─────────────────
       그림이 애니메이션인 명패가 있다. 한 장씩 비교하면 같은 사람도 위상이 어긋나 남이 된다 —
       실측(images/moving_plate, 명패 보관함 25장 · 격자 한 칸 336x83 ≈ 로비 명패의 그림 칸 330x80):
       같은 명패의 위상 간 거리가 최대 49.9 로, 아바타가 같은 타인 최소(30.5)를 넘는다.
       문턱을 넓혀서는 못 가르고, 위상을 여러 장 저장해 둬도 안 된다 (한 장 빼고 가장 가까운 나머지와 최대 44.4).
       대신 **여러 장의 그림 색을 평균**내면 '이 명패가 무슨 색으로 이뤄졌나'가 남고, 그건 애니메이션 내내 안 변한다.
       실측(겹치지 않는 창끼리): 4장 평균에서 동일인 최대 18.9 / 타인 최소 30.4 — 그 사이에 문턱을 둔다.
       (1장 49.9/11.5 · 2장 32.6/12.8 · 3장 19.8/16.7 — 4장이 처음으로 완전히 갈린다) */
    const ART_AVG_MIN_N = 4;      // 양쪽에 이만큼(로비 프레임 4장 = 2초) 쌓여야 평균을 비교한다
    const ART_AVG_SAME = 20;      // 평균 거리가 이 이하면 같은 명패 (동일인 최대 18.9 바로 위)
    const ART_AVG_DIFF = 25;      // 이보다 멀면 남 (타인 최소 30.4 아래). 사이는 판단 보류
    const ART_AVG_CAP = 8;        // 평균에 담아 두는 최대 장수
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
        const art = nameState === 'normal' ? artOf(plateCanvas) : null;
        const lvr = nameState ? readLevel(plateCanvas, nameState === 'ready') : null;
        return {
            v: FP_VERSION,
            // 레벨 — 확신하고 읽은 것만 (숫자, 숨김이면 'h'). 한 장짜리라 장부에는 로비에서 여러 장 이어진 것만 넣는다(lvStable)
            lv: lvr && lvr.sure ? (lvr.hidden ? 'h' : lvr.lv) : null,
            grid: IH.getColorGridFromCanvas(icon, GRID_SEGMENTS),
            aHash: IH.aHashFromCanvas(icon),
            dHash: IH.dHashFromCanvas(icon),
            art,
            // 움직이는 명패용 — 한 장짜리 평균으로 시작한다. 여러 장을 본 쪽(auto-room.js의 칸별 누적)이 덮어쓴다
            artAvg: art ? art.slice() : null,
            artN: art ? 1 : 0,
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

    /* ── 레벨 숫자 ─────────────────
       닉네임 아래 'LV. 639'. 명패 높이 80 기준 영역을 잘라 '글자다움'(0~1)으로 바꾼다.
       평소엔 흰 글자(가는 획), READY 때는 주황 위 검은 글자 — 닉네임과 같은 갈래 */
    const LV_X0 = 95, LV_X1 = 245, LV_Y0 = 24, LV_Y1 = 80;

    function levelInk(plateCanvas, ready) {
        const k = NAME_NORM_H / plateCanvas.height;
        const w = LV_X1 - LV_X0, h = LV_Y1 - LV_Y0;
        if (plateCanvas.width * k < LV_X1) return null;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(plateCanvas, LV_X0 / k, LV_Y0 / k, w / k, h / k, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const v = new Float32Array(w * h);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            let x;
            if (ready) x = (190 - r) / 110;
            else {
                const mn = Math.min(r, g, b), tint = Math.max(r, g, b) - mn;
                x = (mn - 120) / 100 * Math.min(1, Math.max(0, (90 - tint) / 30));
            }
            v[p] = x < 0 ? 0 : x > 1 ? 1 : x;
        }
        return { w, h, v };
    }

    /* 레벨 숫자 읽기 — 성과 스캔(scan/reader.js)과 같은 틀 대조(NCC). 숫자는 고정 간격이다(410의 1도 같은 폭 칸).
       실측(images/plates, level-measure.js geo): 영역 기준 숫자 칸 x 16~42 · 48~72 · 76~103 (간격 30.5), y 7~44.
       21:9 화면은 3px 왼쪽 — 흔들어 맞추는 폭(±4px)이 덮는다. 반으로 줄여(15x21) 비교한다 */
    const LV_PITCH = 30.5, LV_BX0 = 14, LV_BY0 = 4, LV_FULL_W = 30, LV_FULL_H = 42;
    const LV_BOX_W = LV_FULL_W / 2, LV_BOX_H = LV_FULL_H / 2;
    const LV_DIGITS_MAX = 3;
    const LV_INK_MIN = 0.06;    // 칸 평균 잉크가 이보다 적으면 빈칸 (숫자는 0.12~0.25)
    const LV_INK_MAX = 0.5;     // 이보다 많으면 밝은 그림에 묻힌 칸 — 확신하지 않는다 (실측: 그림 위 흰 글자로 맞게 읽은 칸 0.42까지)
    const LV_DIST_MAX = 0.30;   // 1 − NCC가 이보다 크면 숫자가 아니다
    const LV_SURE_RATIO = 0.6;  // 1위/2위 거리비가 이보다 크면 확신하지 않는다
    // 숫자 틀 (0~9, 15x21 · 0~255) — level-measure.js templates가 images/plate-levels.json(손으로 확인한 정답)으로 만든다
    const LV_TEMPLATES_B64 =
'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';

    function makeLevelTemplates(bin) {
        const n = LV_BOX_W * LV_BOX_H, out = [];
        if (!bin || bin.length < n * 10) return out;
        for (let d = 0; d < 10; d++) {
            const t = new Float32Array(n);
            let mean = 0;
            for (let i = 0; i < n; i++) { t[i] = bin.charCodeAt(d * n + i) / 255; mean += t[i]; }
            mean /= n;
            let norm = 0;
            for (let i = 0; i < n; i++) { t[i] -= mean; norm += t[i] * t[i]; }
            out.push({ digit: d, t, norm: Math.sqrt(norm) });
        }
        return out;
    }
    const LV_TEMPLATES = makeLevelTemplates(LV_TEMPLATES_B64 && atob(LV_TEMPLATES_B64));

    /* 영역을 반으로 줄인 것 (2x2 평균) */
    function levelHalf(g) {
        const w = g.w >> 1, h = g.h >> 1, v = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = 2 * y * g.w + 2 * x;
            v[y * w + x] = (g.v[i] + g.v[i + 1] + g.v[i + g.w] + g.v[i + g.w + 1]) / 4;
        }
        return { w, h, v };
    }

    /* k번째 숫자 칸 (반 크기, 흔들어 맞추기 전 기본 자리) → { v, ink } | null */
    function levelBox(g, k, dx = 0, dy = 0) {
        const hg = g._half || (g._half = levelHalf(g));
        const x0 = Math.round((LV_BX0 + LV_PITCH * k) / 2) + dx, y0 = (LV_BY0 >> 1) + dy;
        if (x0 + LV_BOX_W > hg.w + 2) return null;
        const v = new Float32Array(LV_BOX_W * LV_BOX_H);
        let ink = 0;
        for (let y = 0; y < LV_BOX_H; y++) for (let x = 0; x < LV_BOX_W; x++) {
            const sx = x0 + x, sy = y0 + y;
            const val = (sx >= 0 && sx < hg.w && sy >= 0 && sy < hg.h) ? hg.v[sy * hg.w + sx] : 0;
            v[y * LV_BOX_W + x] = val; ink += val;
        }
        return { v, ink: ink / v.length };
    }

    function ncc(v, tpl) {
        let mean = 0;
        for (let i = 0; i < v.length; i++) mean += v[i];
        mean /= v.length;
        let dot = 0, norm = 0;
        for (let i = 0; i < v.length; i++) { const a = v[i] - mean; dot += a * tpl.t[i]; norm += a * a; }
        return (norm > 0 && tpl.norm > 0) ? dot / (Math.sqrt(norm) * tpl.norm) : 0;
    }

    /* 숫자 한 칸 → { d, dist, ratio, dx } — ±2칸(원래 크기 ±4px) · 위아래 ±1칸 흔든 것 중 가장 맞는 것.
       dxHint: 앞 칸에서 맞은 밀림 (숫자는 한 줄이라 같이 밀린다) */
    function readLevelDigit(g, k, tpls, dxHint) {
        const best = new Array(10).fill(Infinity), at = new Array(10).fill(0);
        const range = dxHint === undefined ? [-2, 2] : [dxHint - 1, dxHint + 1];
        let ink = 0;
        for (let dx = range[0]; dx <= range[1]; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const box = levelBox(g, k, dx, dy);
                if (!box) continue;
                if (dx === (dxHint || 0) && dy === 0) ink = box.ink;
                for (const t of tpls) {
                    const dist = 1 - ncc(box.v, t);
                    if (dist < best[t.digit]) { best[t.digit] = dist; at[t.digit] = dx; }
                }
            }
        }
        const order = best.map((dist, d) => ({ d, dist })).sort((a, b) => a.dist - b.dist);
        const [a, b] = order;
        return { d: a.d, dist: a.dist, ratio: b.dist > 0 ? a.dist / b.dist : 1, dx: at[a.d], ink };
    }

    /* '---'(레벨 숨김) — 가는 가로줄 셋. 숫자 칸과 간격이 다르다(17).
       실측(영역 기준): x 17~27 · 34~44 · 51~61, y 27~29. 줄 말고 다른 잉크가 있으면(그림) 아니라고 한다 → 못 읽음 */
    const LV_DASH_X = 17, LV_DASH_P = 17, LV_DASH_TOL = 5, LV_DASH_Y = [18, 36], LV_SCAN_X1 = 110;
    function levelHidden(g) {
        const cols = new Uint8Array(g.w);
        let top = g.h, bot = -1;
        for (let y = LV_BY0 + 3; y < Math.min(g.h, LV_BY0 + LV_FULL_H); y++) {
            for (let x = LV_BX0; x < Math.min(g.w, LV_SCAN_X1); x++) {
                if (g.v[y * g.w + x] > 0.5) { cols[x] = 1; top = Math.min(top, y); bot = Math.max(bot, y); }
            }
        }
        if (bot < 0 || bot - top > 4 || top < LV_DASH_Y[0] || bot > LV_DASH_Y[1]) return false;
        const runs = [];
        let st = -1;
        for (let x = LV_BX0; x <= LV_SCAN_X1; x++) {
            const on = x < LV_SCAN_X1 && cols[x];
            if (on && st < 0) st = x;
            if (!on && st >= 0) { runs.push([st, x - 1]); st = -1; }
        }
        return runs.length === 3 && runs.every(([x0, x1], k) =>
            x1 - x0 >= 7 && x1 - x0 <= 15 && Math.abs(x0 - (LV_DASH_X + LV_DASH_P * k)) <= LV_DASH_TOL);
    }

    /* 명패 → { lv, sure, ratio, ink } | { hidden: true } | null(못 읽음).
       sure: 숫자 칸마다 1위가 뚜렷하고(LV_SURE_RATIO) 그림에 묻히지 않았다 — 사람을 가르는 데는 sure만 쓴다 */
    function readLevel(plateCanvas, ready, tpls = LV_TEMPLATES) {
        if (!tpls.length) return null;
        const g = levelInk(plateCanvas, ready);
        if (!g) return null;
        if (levelHidden(g)) return { hidden: true, sure: true };
        let text = '', worst = 0, dx, maxInk = 0, sure = true;
        for (let k = 0; k < LV_DIGITS_MAX; k++) {
            const r = readLevelDigit(g, k, tpls, dx);
            if (r.ink < LV_INK_MIN) break;
            if (r.dist > LV_DIST_MAX) { if (!text) return null; sure = false; }
            text += r.d;
            dx = r.dx;
            worst = Math.max(worst, r.ratio);
            maxInk = Math.max(maxInk, r.ink);
        }
        if (!text) return null;
        if (worst > LV_SURE_RATIO || maxInk > LV_INK_MAX) sure = false;
        return { lv: +text, sure, ratio: worst, ink: maxInk };
    }

    /* ── 레벨로 가르기 ─────────────────
       레벨은 오르기만 하고 한 번에 조금씩 오른다(실측: 도기 638 → 639 하루 사이, DabihVega 543 → 544).
       READY든 평소든 같은 숫자라, 닉네임 모양이 가장 약한 READY↔평소 비교를 받쳐 준다.
       '---'(숨김)은 계정 설정이라 한 사람이 숨김↔숫자로 오가지 않는다고 본다 (스샷에서 그런 사람 없음).
       늘 p = 새로 본 것, e = 예전 것(장부·직전 칸)의 순서로 부른다 — 내려가면 남이다 */
    const LV_RISE_MAX = 10;                   // 최근에 본 사람이면 이보다 많이 오를 수 없다
    const LV_RISE_WINDOW_MS = 12 * 3600e3;    // '최근' = 12시간 (그보다 오래전 장부는 오른 폭을 따지지 않는다)
    function fpLevelDiffers(p, e) {
        if (p.lv == null || e.lv == null) return false;
        if (p.lv === 'h' || e.lv === 'h') return p.lv !== e.lv;
        if (p.lv < e.lv) return true;
        return !!e.lvAt && Date.now() - e.lvAt < LV_RISE_WINDOW_MS && p.lv - e.lv > LV_RISE_MAX;
    }
    /* 같은 숫자 레벨 — 숨김('h')은 흔해서 '같다'의 근거로 쓰지 않는다 */
    function fpLevelSame(p, e) {
        return typeof p.lv === 'number' && p.lv === e.lv;
    }

    /* 장부 지문(e)에 방금 읽은 상태의 닉네임 모양이 없거나 다른 크기에서 뜬 것인가 (그림 색 평균이 덜 찬 것도 포함) */
    function needsNameRefresh(p, e) {
        if (artAvgStale(p, e)) return true;
        if (p.lvStable && p.lv != null && p.lv !== e.lv) return true;   // 레벨이 올랐다 — 장부도 올려 둔다
        const st = p.nameState;
        if (!st) return false;
        const em = e.names && e.names[st];
        return !em || !sameScale(p.names[st], em) || (!!p.art && !e.art);
    }

    /* 움직이는 명패인데 장부의 색 평균이 비었거나 아직 덜 찬 것 — 채워 둬야 다음에 그림으로 가릴 수 있다 */
    function artAvgStale(p, e) {
        if (p.animated && !e.animated) return true;
        if (!e.animated || !p.artAvg || (p.artN || 0) < ART_AVG_MIN_N) return false;
        return !e.artAvg || (e.artN || 0) < ART_AVG_CAP;
    }

    /* 장부 지문에 방금 읽은 상태의 닉네임 모양을 넣어 둔다 (다른 상태 것은 그대로). 평소 명패면 명패 그림도 */
    function mergeName(e, p) {
        mergeArt(e, p);
        // 레벨은 로비에서 여러 장 이어진 것만 (한 장짜리 오독이 장부에 박히면 그 사람이 영영 남이 된다).
        // 덮어쓴다 — 여기까지 온 것은 이미 같은 사람으로 이어진 것이라, 장부 쪽이 틀렸으면 이걸로 바로잡힌다
        if (p.lvStable && p.lv != null) { e.lv = p.lv; e.lvAt = Date.now(); }
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
    /* 움직이는 명패용 — 여러 장을 평균낸 색끼리. 양쪽에 ART_AVG_MIN_N 장씩 쌓였을 때만 뜻이 있다 */
    function fpArtAvgDist(a, b) {
        if (!a.artAvg || !b.artAvg) return null;
        if ((a.artN || 0) < ART_AVG_MIN_N || (b.artN || 0) < ART_AVG_MIN_N) return null;
        return IH.colorDist(a.artAvg, b.artAvg);
    }
    /* 그림 판정 → 'same' | 'differ' | 'unknown'(판단 보류) | null(비교할 그림이 없다 — READY 등).
       정지 명패는 예전 그대로 한 장끼리 본다. 한쪽이라도 움직이는 명패면 한 장 비교는 뜻이 없으므로
       (같은 명패의 위상 간 거리가 최대 49.9) 평균끼리 보고, 평균이 아직 안 쌓였으면 보류한다.
       보류 = 그림이 거부권을 갖지 않는다는 뜻이라, 아바타·자리·닉네임으로 넘어간다 */
    function artVerdict(a, b) {
        if (!(a.animated || b.animated)) {
            const d = fpArtDist(a, b);
            return d === null ? null : (d <= ART_DIFF_MIN ? 'same' : 'differ');
        }
        const d = fpArtAvgDist(a, b);
        if (d === null) return 'unknown';
        return d <= ART_AVG_SAME ? 'same' : d > ART_AVG_DIFF ? 'differ' : 'unknown';
    }
    function fpArtDiffers(a, b) { return artVerdict(a, b) === 'differ'; }
    function fpArtSame(a, b) { return artVerdict(a, b) === 'same'; }

    /* 장부에 새로 올릴 지문 — 움직이는 명패가 아니면 색 평균은 빼고 넣는다 (LocalStorage) */
    function bookFp(fp) {
        const out = Object.assign({}, fp);
        if (!fp.animated) { delete out.artAvg; delete out.artN; }
        // 레벨은 여러 장 이어진 것만 장부에 (mergeName과 같은 이유)
        if (out.lvStable && out.lv != null) out.lvAt = Date.now(); else delete out.lv;
        delete out.lvStable;
        return out;
    }

    /* 장부 지문(e)에 방금 본 명패(p)의 그림 색 평균을 섞어 둔다 — 움직이는 명패일 때만 보관한다.
       (정지 명패는 한 장 비교로 충분한데 평균까지 넣으면 LocalStorage만 두 배가 된다) */
    function mergeArt(e, p) {
        if (p.animated) e.animated = true;
        if (!e.animated) { delete e.artAvg; delete e.artN; return; }
        // 장부에는 여러 장을 본 평균만 넣는다 — 한두 장짜리 평균은 위상 한 컷이라 장부를 흐린다
        if (!p.artAvg || (p.artN || 0) < ART_AVG_MIN_N) return;
        const n = Math.min(p.artN, ART_AVG_CAP);
        if (!e.artAvg || !e.artN) { e.artAvg = p.artAvg.slice(); e.artN = n; return; }
        const w = Math.min(e.artN, ART_AVG_CAP), t = w + n;
        for (let i = 0; i < e.artAvg.length; i++) e.artAvg[i] = Math.round((e.artAvg[i] * w + p.artAvg[i] * n) / t);
        e.artN = Math.min(t, ART_AVG_CAP);
    }
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
            // 명패 그림이 다르거나 레벨이 안 맞으면(내려갔다 · 숨김↔숫자) 아바타·닉네임이 어떻든 남이다
            if (fpCurrent(cfp) && !fpArtDiffers(fp, cfp) && !fpLevelDiffers(fp, cfp)) all.push({ cand, fp: cfp, d: fpColorDist(fp, cfp) });
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
            // 레벨(숫자)까지 같은 사람 — READY↔평소인데 한쪽이 밝은 그림에 묻혀 닉네임을 견줄 수 없을 때(manaori)도 잇는다.
            // 아바타·그림이 같고 레벨 숫자까지 같은 타인은 드물다. 닉네임을 견줄 수 있으면 여전히 느슨한 기준은 넘어야 한다
            const lvl = near.filter(n => fpLevelSame(fp, n.fp) && ((n.nc && n.nc.uncomparable) || nameClose(fp, n.fp)));
            if (lvl.length > 1) return { ambiguous: true, candidates: lvl.map(n => n.cand) };
            if (lvl.length) return { match: lvl[0].cand, dist: lvl[0].d, refreshName: true };
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
        // 오른쪽 목록의 PLAYER 1 뱃지(주황) + 가운데 PLAYERS 칸의 PLAYER 1(주황)·PLAYER 2(청록) 꼬리표가 다 보이면 버서스 로비.
        // 프리매치 로비에는 이것들이 없어서 자연스럽게 걸러진다.
        // 오른쪽 PLAYER 2 뱃지는 보지 않는다 — 방에 혼자면 그 칸이 비어 뱃지가 꺼진다(실측 69,88,42,
        // images/chat/20260923123321_1.jpg). 가운데 꼬리표는 자리가 비어도 그대로 켜져 있다.
        // 실측: 로비 꼬리표 P1 ≈ 207,88,24 · P2 ≈ 22,181,190 / 로비가 아닌 화면은 어느 쪽도 문턱 근처에 안 온다
        const p1 = avgColor(frame, rectOf(PROBE.p1Badge, W, H));
        const t1 = avgColor(frame, rectOf(PROBE.p1Tag, W, H));
        const t2 = avgColor(frame, rectOf(PROBE.p2Tag, W, H));
        return (p1[0] - p1[1] > 50 && p1[1] - p1[2] > 30)
            && (t1[0] - t1[1] > 80 && t1[1] - t1[2] > 40)
            && (t2[1] - t2[0] > 100 && t2[2] - t2[0] > 100);
    }

    /* 자리 하나의 평균색이 기대색에서 얼마나 떨어져 있는가 (채널 차의 합) */
    function colorDist(frame, probe, rgb, W, H) {
        const c = avgColor(frame, rectOf(probe, W, H));
        return Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]);
    }
    function colorNear(frame, probe, rgb, W, H) {
        return colorDist(frame, probe, rgb, W, H) <= RESULT_BAND_TOL;
    }

    function isResultScreen(frame, W, H) {
        // ROUND 1 빨간 띠의 색이 딱 맞을 때만. 라운드 진행 화면에는 이 띠가 회색/파랑으로 깔린다
        return colorNear(frame, PROBE.r1Band, RESULT_BAND_RGB, W, H);
    }

    /* 라운드 화면(곡 고르고 시작하기 전) — 여기가 뜨면 두 사람의 대결이 성사된 것이다 */
    function isRoundScreen(frame, W, H) {
        return colorNear(frame, PROBE.roundBar, ROUND_BAR_RGB, W, H);
    }

    /* ── 자동 방장 봇이 보는 표식 (auto-host.js) ─────────────────
       전부 색과 자리만 본다 — 명패 인식(아바타·닉네임)은 하나도 건드리지 않는다.
       실측: images/auto_versus/ 10장 + images/lobby_00*.png 5장, 2560x1440 */
    const YOU_TAG = { x: 1748, y: 270, w: 38, h: 18 };     // 로비 칸 왼쪽의 분홍 'YOU' 꼬리표
    const HOST_BADGE = { x: 2318, y: 298, w: 62, h: 20 };  // 0번 칸 명패 오른쪽 아래의 'HOST' 뱃지
    const MENU_TAB = { y: 327, h: 5, room: { x: 840, w: 420 }, player: { x: 1300, w: 420 } };   // 탭 밑줄
    const MENU_ROW0_Y = 440;              // 첫 줄 가운데. 줄 간격은 로비와 같다 (LOBBY_PLATE.step)
    const MENU_ROWS = 8;
    const MENU_DOT = { x: 774, w: 22, h: 16 };             // 줄 왼쪽의 노란 점 = 지금 고른 줄
    const MENU_BTN_X = [1257, 1396, 1534, 1673];           // PROFILE · PLAYER 1 (HOST) · PLAYER 2 · KICK
    const MENU_BTN = { w: 126, h: 50 };
    const CHAT_BOX = { x: 120, y: 1201, w: 660, h: 6 };    // 채팅 입력칸 위쪽 테두리 — 켜지면 주황
    const BTN_PROFILE = 0, BTN_HOST = 1, BTN_PLAYER2 = 2, BTN_KICK = 3;

    // 문턱 — 모두 실측 사이에서 잡았다
    const YOU_MIN = 0.5;        // 있는 칸 0.79~0.82 / 없는 칸 최대 0.23 (옆 칸의 금색 테두리가 조금 든다)
    const HOST_MIN = 0.4;       // 뱃지 0.64~0.65 / 대결 중(PLAYING 덮개가 가림) 0.00
    const TAB_ON_MIN = 0.9;     // 방장 메뉴 1.00 / 비방장 창 0.51 / 로비 0.19~0.20
    const TAB_OFF_MAX = 0.4;
    const DOT_MIN = 0.4;        // 고른 줄 0.69~0.70 / 나머지 0.00
    const BTN_MIN = 0.45;       // 노랗게 칠해진 칸 0.83~0.84 / 나머지 0.00
    const CHAT_MIN = 0.5;       // 채팅 열림 1.00 / 닫힘 0.00

    const isYellow = (r, g, b) => r > 170 && g > 130 && b < 110 && r - b > 80 && g - b > 60;
    const isPink = (r, g, b) => r > 150 && r - g > 60 && r - b > 20 && b - g > -20;

    function colorRatio(src, r, test) {
        const c = IH.cropToCanvas(src, r.x, r.y, r.w, r.h);
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2])) n++;
        return d.length ? n / (d.length / 4) : 0;
    }

    const shiftY = (r, dy) => ({ x: r.x, y: r.y + dy, w: r.w, h: r.h });

    /* 로비의 두 표식 → { youRow, hostBadge }.
       youRow: 분홍 YOU 꼬리표가 붙은 칸 (없으면 -1).
       hostBadge: 0번 칸에 HOST 뱃지가 보이는가. 방장은 언제나 PLAYER 1 = 0번 칸이라 0번만 본다 —
         READY 명패도 같은 자리가 주황이라 0.76으로 읽히므로(실측) 다른 칸을 훑으면 오히려 틀린다.
         대결이 진행 중이면 PLAYING 덮개가 뱃지를 가려 false가 된다 — 방이 놀고 있는지까지 같이 본다는 뜻이다. */
    function lobbyMarks(frame, W, H) {
        let youRow = -1;
        for (let i = 0; i < LOBBY_ROWS; i++) {
            if (colorRatio(frame, rectOf(shiftY(YOU_TAG, LOBBY_PLATE.step * i), W, H), isPink) >= YOU_MIN) { youRow = i; break; }
        }
        const hostBadge = colorRatio(frame, rectOf(HOST_BADGE, W, H), isYellow) >= HOST_MIN;
        return { youRow, hostBadge };
    }

    /* F9로 뜨는 창 → 방장 메뉴면 { tab, row, button }, 아니면 null.
       방장이 아닐 때 F9를 누르면 PROFILE만 있는 보기 전용 창이 뜨는데, 그 창에는 ROOM/PLAYER 탭이 없다.
       tab: 'player' | 'room' (Shift로 넘긴다) · row: 노란 점이 있는 줄 (없으면 -1)
       button: 그 줄에서 노랗게 칠해진 단추 (없거나 둘 이상이면 -1) — KICK 오발을 막는 유일한 방벽이라
               "가장 노란 칸 하나가 뚜렷할 때"만 답한다. */
    function hostMenu(frame, W, H) {
        const under = (t) => colorRatio(frame, rectOf({ x: t.x, y: MENU_TAB.y, w: t.w, h: MENU_TAB.h }, W, H), isYellow);
        const player = under(MENU_TAB.player), room = under(MENU_TAB.room);
        const tab = (player >= TAB_ON_MIN && room <= TAB_OFF_MAX) ? 'player'
                  : (room >= TAB_ON_MIN && player <= TAB_OFF_MAX) ? 'room' : null;
        if (!tab) return null;
        for (let i = 0; i < MENU_ROWS; i++) {
            const cy = MENU_ROW0_Y + LOBBY_PLATE.step * i;
            if (colorRatio(frame, rectOf({ x: MENU_DOT.x, y: cy - MENU_DOT.h / 2, w: MENU_DOT.w, h: MENU_DOT.h }, W, H), isYellow) < DOT_MIN) continue;
            const fills = MENU_BTN_X.map(x => colorRatio(frame, rectOf({ x, y: cy - MENU_BTN.h / 2, w: MENU_BTN.w, h: MENU_BTN.h }, W, H), isYellow));
            const top = fills.indexOf(Math.max.apply(null, fills));
            const only = fills[top] >= BTN_MIN && fills.every((v, j) => j === top || v < BTN_MIN / 3);
            return { tab, row: i, button: only ? top : -1, fills };
        }
        return { tab, row: -1, button: -1, fills: null };
    }

    /* 채팅 입력칸이 열려 있는가 — 열리면 왼쪽 아래 입력칸에 주황 테두리가 생긴다 */
    function isChatOpen(frame, W, H) {
        return colorRatio(frame, rectOf(CHAT_BOX, W, H), isYellow) >= CHAT_MIN;
    }

    /* ── 대결(관전) 플레이 화면 ─────────────────
       두 사람이 곡을 치는 동안 가운데에 뜨는 패널. 맨 위가 빨간 'ROUND n' 띠인데 가운데는 흰 글씨라
       양옆만 본다 — 양쪽이 다 맞아야 하므로 어쩌다 빨간 것 하나에는 안 걸린다.
       실측(images/auto_versus/ 4장, 2560x1440): 대결 화면 0~1 / 로비·라운드·결과·밴픽·방장 메뉴 167 이상.
       채팅 입력칸은 로비와 자리가 아예 다르다(가운데 아래) — 로비 것으로 보면 영영 안 열린 줄 안다.
       실측: 열림 1.00 / 닫힘 0.00 */
    const VS_BAND = [{ x: 1000, y: 56, w: 120, h: 10 }, { x: 1440, y: 56, w: 120, h: 10 }];
    const VS_BAND_RGB = [224, 38, 61];
    const VS_CHAT_BOX = { x: 960, y: 1338, w: 600, h: 4 };

    function isVersusScreen(frame, W, H) {
        return VS_BAND.every(r => colorNear(frame, r, VS_BAND_RGB, W, H));
    }

    function isVersusChatOpen(frame, W, H) {
        return colorRatio(frame, rectOf(VS_CHAT_BOX, W, H), isYellow) >= CHAT_MIN;
    }

    /* ── 방이 터졌을 때 다시 만드는 길 ─────────────────
       '방이 해체되었습니다' 알림 → (Enter) 방 목록 → (F3) CREATE ROOM 창.
       실측: images/auto_restart/ 8장, 2560x1440 */
    const QUIT_BTN = { x: 1050, y: 902, w: 436, h: 90 };   // 알림 아래의 노란 '종료' 단추 (단추가 이것 하나뿐이다)
    // 방 목록 맨 아래 안내줄의 밝은 회색 키 칩 두 개 (F2 빠른 입장 · F3 생성). 둘 다 맞아야 한다
    const LIST_CHIPS = [{ x: 1548, y: 1363, w: 28, h: 20 }, { x: 1764, y: 1363, w: 28, h: 20 }];
    const CHIP_RGB = [155, 155, 155];
    const CHIP_TOL = 60;        // 실측: 방 목록 0~2 / 다른 화면 163 이상
    // CREATE ROOM 창 — 갈색 입력칸 셋과 그 오른쪽 여백(어두운 창 바탕)으로 가린다
    const CR_FIELD = { x: 1125, w: 600, h: 46, name: 652, pw: 724, cap: 796 };
    const CR_FIELD_RGB = [99, 81, 68];
    const CR_MARGIN = { x: 1748, y: 650, w: 60, h: 196 };
    const CR_MARGIN_RGB = [12, 12, 12];
    // 노란 테두리 = 지금 고른 칸. 각 칸 위 테두리 한 줄만 본다 (칸 안쪽 그림에 안 걸린다)
    const CR_EDGE_H = 6;
    const CR_EDGES = { name: { x: 1200, y: 643, w: 450 }, pw: { x: 1200, y: 715, w: 450 },
                       cap: { x: 1200, y: 787, w: 450 }, cancel: { x: 900, y: 867, w: 280 },
                       create: { x: 1350, y: 867, w: 330 } };
    const CR_EDGE_MIN = 0.5;
    const CR_VERSUS = { x: 1450, y: 525, w: 250, h: 76 };   // VERSUS MATCH 단추 속 — 골랐으면 보라, 아니면 회색
    const CR_VERSUS_RGB = [147, 108, 195];
    const CR_VERSUS_TOL = 60;   // 실측: 골랐을 때 0 / 안 골랐을 때(회색 87,83,80) 200
    // 입력칸에 글자가 있는가 — 밝은 픽셀 비율. 실측: 빈 칸 0.000 / '0923' 0.023 / 기본 방 이름 0.043
    const CR_TEXT = { x: 1150, w: 580, h: 40, name: 655, pw: 727 };
    const CR_TEXT_MIN = 0.004;
    const isBright = (r, g, b) => Math.min(r, g, b) > 140;

    /* 방이 터졌다는 알림창인가 — 노란 '종료' 단추 하나로 본다. 실측: 0.95 / 다른 화면 최대 0.07 */
    function isDisbandBox(frame, W, H) {
        return colorRatio(frame, rectOf(QUIT_BTN, W, H), isYellow) >= 0.5;
    }

    /* 방 목록(OPEN MATCH) 화면인가 — 아래 안내줄의 키 칩 두 개로 본다.
       목록 내용·정렬과 무관한 자리라 방이 몇 개든 같게 읽힌다 */
    function isRoomList(frame, W, H) {
        return LIST_CHIPS.every(r => colorDist(frame, r, CHIP_RGB, W, H) <= CHIP_TOL);
    }

    /* CREATE ROOM 창 → { versus, focus, name, pw }, 창이 아니면 null.
       focus: 'name' | 'pw' | 'cap' | 'cancel' | 'create' | 'mode'
         — 모드 줄은 고른 단추 자체가 칠해져 있어 테두리만으로는 가리기 어렵다.
           그래서 아래 다섯 칸 중 아무 데도 테두리가 없으면 모드 줄로 본다.
       name·pw: 그 칸에 글자가 있는가 (지웠는지·붙여넣었는지 확인용) */
    function createRoom(frame, W, H) {
        const field = (y) => colorDist(frame, { x: CR_FIELD.x, y, w: CR_FIELD.w, h: CR_FIELD.h }, CR_FIELD_RGB, W, H);
        if (field(CR_FIELD.name) > RESULT_BAND_TOL || field(CR_FIELD.pw) > RESULT_BAND_TOL
            || field(CR_FIELD.cap) > RESULT_BAND_TOL) return null;
        if (colorDist(frame, CR_MARGIN, CR_MARGIN_RGB, W, H) > RESULT_BAND_TOL) return null;
        let focus = 'mode';
        for (const [k, e] of Object.entries(CR_EDGES)) {
            if (colorRatio(frame, rectOf({ x: e.x, y: e.y, w: e.w, h: CR_EDGE_H }, W, H), isYellow) >= CR_EDGE_MIN) { focus = k; break; }
        }
        const text = (y) => colorRatio(frame, rectOf({ x: CR_TEXT.x, y, w: CR_TEXT.w, h: CR_TEXT.h }, W, H), isBright);
        return {
            versus: colorDist(frame, CR_VERSUS, CR_VERSUS_RGB, W, H) <= CR_VERSUS_TOL,
            focus,
            name: text(CR_TEXT.name) >= CR_TEXT_MIN,
            pw: text(CR_TEXT.pw) >= CR_TEXT_MIN
        };
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
        makeFingerprint, fpColorDist, fpHamDist, fpAvatarSame, fpArtDist, fpArtAvgDist, fpArtDiffers, fpArtSame,
        artVerdict, mergeArt, bookFp, fpCurrent, fpSame,
        findMatch, isDefaultPlate, plateThumb,
        nameMaskOf, nameDist, nameCompare, nameMayBeSame, nameClose, sameReading, mergeName, readLevel,
        fpLevelDiffers, fpLevelSame,
        isLobbyScreen, isResultScreen, isRoundScreen, readPlate, readLobby, readResult, readRound,
        // 자동 방장 봇(auto-host.js)이 보는 표식
        lobbyMarks, hostMenu, isChatOpen, isVersusScreen, isVersusChatOpen,
        isDisbandBox, isRoomList, createRoom,
        BTN_PROFILE, BTN_HOST, BTN_PLAYER2, BTN_KICK,
        SAME_MAX_COLOR, SAME_MAX_HAM, ART_DIFF_MIN, ART_AVG_MIN_N, ART_AVG_CAP,
        // 명패 테스트(plate-test.js)가 판정 여유를 재는 데 쓴다
        _internal: { unmatched, dilated, textPixels, prefixRatio, nameSpan, cutTo, ratioOf, NAME_SPAN_TAIL,
                     levelInk, levelBox, makeLevelTemplates, LV_BOX_W, LV_BOX_H, LV_INK_MAX }
    };
})(window);
