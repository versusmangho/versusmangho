/* 자동 방장 봇 — 로비로 돌아와 봇이 방장(맨 윗칸)이 되면, 다음 차례 사람에게 방장을 넘기고
   레디를 누르고 채팅으로 다음 순서를 알린다. script.js · auto-room.js · scan/app.js 다음에 읽혀야 한다.

   하는 일은 둘이고, 한 바퀴의 반씩이다
     봇이 방장이다        → 1순위에게 넘긴다 (아래 '한 사이클')
     방장이 남에게 있다   → 판이 끝난 그 한 번만 "방장을 넘겨 달라"고 채팅으로 알린다 (askHost).
                            봇이 방장이어야 다음 판도 넘길 수 있으므로 이게 없으면 한 판만 돌고 끝난다
   그 밖에 로비에서는 늘 봇의 자리를 본다 — 2픽이면 레디를 끄고 다른 사람을 골라 달라고 한 번 알리고(watchP2),
   3픽~8픽이면 레디를 켜 둔다(maybeReady). 방이 터지면 같은 방을 다시 만든다(recreate)

   한 사이클
     로비 확정 · 0번 칸이 YOU · 0번 칸에 HOST 뱃지  (여기가 에지 트리거. 방장에서 내려올 때까지 한 번만)
       F9            → 방장 메뉴인지 확인 (방장이 아닐 때 뜨는 보기 전용 창에는 탭이 없다)
       ↓ × (k-1)     → 노란 점이 한 칸씩 내려갔는지 매번 확인   (k = 1순위의 로비 칸 번호. 메뉴 목록은 나를 빼므로 k-1줄)
       →  한 번      → 노란 칠이 PLAYER 1 (HOST)인지 확인       ★ 옆의 KICK 오발을 막는 유일한 방벽
       Enter         → 지정하면 창이 저절로 닫힌다 → 로비에서 내가 0번 칸을 벗어났는지 확인 (같은 칸을 두 번 봐야 믿는다)
       F5            → 봇이 PLAYER 1도 PLAYER 2도 아니고, 아직 비레디일 때만
       채팅          → 클립보드에 한 줄 넣고 Enter(입력칸 주황 테두리 확인) → Ctrl+V → Enter.
                       라운드 직후엔 채팅이 몇 초간 잠기므로 열릴 때까지 Enter를 다시 친다 (openChat)

   지켜야 하는 것
     - 상하 이동이 언제나 좌우보다 먼저다. 위아래로 움직이면 포커스가 맨 왼쪽(PROFILE)으로 되돌아간다.
     - F5는 방장에게는 '시작'이다. 지정이 실패해 봇이 아직 PLAYER 1이면 누르는 순간 판이 시작된다 — 그래서
       0번 칸을 벗어난 것을 눈으로 확인하기 전에는 절대 누르지 않는다.
     - Esc는 창이 아직 열려 있을 때만. 닫힌 뒤에 치면 게임 메뉴가 열린다.
     - 공유가 멈춘 프레임(같은 그림만 반복해서 오는 것)은 쓰지 않는다. 다른 창이 게임을 덮으면 게임이 화면을
       새로 그리지 않아 옛 화면이 계속 온다 — 그걸 보고 누르면 그새 바뀐 자리에 키를 넣게 된다.
     - 한 걸음이라도 화면이 기대와 다르면 되돌리려 하지 않고 그 자리에서 멈춘다 (되돌리기가 더 위험하다). */
(function () {
    'use strict';

    const Hub = window.VMH.CaptureHub;
    const Room = window.VMH.Room;
    const sleep = window.VMH.ScreenCapture.sleep;

    const OPT_KEY = 'autoHostV1';
    // 봇이 굴러가는 데 꼭 있어야 하는 것(방장 넘기기·레디·2픽 안내·방장 요청·방 다시 만들기·게임 창 불러오기)은
    // 끌 수 없다 — 하나라도 빠지면 봇 순환이 끊긴다. 끌 수 있는 것은 부가 안내 둘뿐이다
    const DEFAULTS = {
        on: false,        // 전체 스위치 — 기본 꺼짐
        chat: true,       // 넘긴 뒤 다음 순서 채팅 안내
        song: true,       // 대결 중 이번 곡의 난이도 안내
        text: '다음 순서: {목록}',
        textP2: '{봇}픽은 봇입니다 — 다른 분을 골라주세요. 다음 순서: {목록}',
        textAsk: '게임이 종료되었습니다. 제게 방장을 넘겨주십시오',
        textSong: '{라운드} {곡} {패턴} {층수} {태그}',
        roomName: '버망호',   // 다시 만들 방 이름 (비우면 게임이 지어 주는 이름 그대로 둔다)
        roomPw: '{날짜}'      // 비밀번호 — {날짜}는 그날 날짜(MMDD)다. 비우면 잠그지 않는다
    };
    const opts = Object.assign({}, DEFAULTS);

    const HOLD_MS = 40;        // 키를 누르고 있는 시간
    const STEP_MS = 160;       // 키 한 번 뒤 화면이 따라올 때까지 한 번 기다리는 시간
    const STEP_TRIES = 6;      // 그렇게 이만큼까지 다시 본다 (약 1초)
    const CLOSE_TRIES = 16;    // 창이 닫히고 로비가 돌아오는 것은 연출이 있어 더 기다린다 (약 2.5초.
                               // 넘긴 뒤 자리는 같은 칸을 두 번 봐야 믿으므로 최소 두 번은 써야 한다)
    const RANKS = 2;           // 채팅에 적는 사람 수 (2순위 · 3순위)
    // 라운드가 막 시작한 몇 초 동안은 채팅이 잠겨 있어 Enter가 먹지 않는다 — 열릴 때까지 다시 친다
    const OPEN_TRIES = 16;     // 이만큼까지 (한 번에 0.5초 남짓 → 8초쯤)
    const OPEN_WAIT = 3;       // 한 번 치고 이만큼 프레임을 보고 다시 친다
    const VS_TICKS = 3;        // 대결 화면이 이만큼 이어져야 곡 안내 (1.5초 — 화면 전환 중 오인식 방지)
    const READY_TICKS = 4;     // 비레디가 이만큼 이어져야 F5 (2초 — 목록이 다시 정렬되며 스쳐 가는 칸으로 누르지 않는다)
    const DISBAND_TICKS = 2;   // 해체 알림이 이만큼 이어져야 방을 다시 만든다
    const LIST_TRIES = 40;     // 화면이 통째로 바뀌는 걸음(목록·창 열기·방 만들기)은 오래 기다린다 (약 7초)
    const CLEAR_ROUNDS = 5, CLEAR_KEYS = 8;   // 입력칸 지우기 — Backspace를 8번씩 최대 5번 (기본 방 이름이 길어야 20자 남짓)
    const BUSY_FPS = 30, IDLE_FPS = 5;
    const FOCUS_RETRY_MS = 2000;
    // 방장 넘기기는 입·퇴장이 다 반영된 뒤에 한다 (입장 3초·퇴장 5초 늦게 room에 들어간다 — 그 전의 매칭 순서는 옛 명단이다).
    // 누가 들락날락해서 끝내 안 가라앉으면 이만큼 기다린 뒤 그냥 넘긴다 (봇이 방장을 쥔 채 판이 멈추지 않게)
    const SETTLE_MAX_MS = 15000;   // 게임 창이 앞에 없어 멈췄으면 이만큼 뒤에 같은 일을 다시 해 본다
    const READY_RETRY_MS = 3000;   // 레디를 눌렀는데 안 바뀌었으면 이만큼 뒤에 다시 본다
    const HANDOFF_RETRY_MS = 8000; // 방장 넘기기가 멈췄으면 이만큼 뒤에 처음부터 다시 해 본다 (봇이 방장을 쥔 채 방이 서지 않게)
    // 방장 요청 채팅이 멈췄으면(채팅칸이 안 열렸다 등) 이만큼 뒤에 다시 — 이게 빠지면 방장이 안 돌아와 봇 순환이 끊긴다.
    // 채팅이라 끝없이 되풀이하지는 않는다
    const ASK_RETRY_MS = 8000, ASK_TRIES = 3;
    // 방 다시 만들기가 중간에 멈췄으면 이만큼 뒤에 이어서 — 방이 없으니 로비를 볼 일이 없어, 그냥 두면 영영 다시 안 한다
    const RESTART_RETRY_MS = 10000, RESTART_TRIES = 3;
    const HELPER_PROBE_MS = 10000; // 도우미를 못 찾았으면 이만큼마다 다시 찾아본다

    const state = { busy: false, latched: false, note: '', at: null,
                    vsStreak: 0, songDone: false,
                    unready: 0, readyRetryAt: 0, p2Streak: 0, p2Ready: 0, p2Told: false,
                    disbandStreak: 0, restartDone: false, handoffRetryAt: 0, lastFail: '',
                    restartPending: false, restartTries: 0, restartRetryAt: 0,
                    askPending: false, askTries: 0, askRetryAt: 0,
                    focusLost: false, retryAt: 0, settleSince: 0 };

    /* ── 설정 ───────────────── */
    function load() {
        try {
            const raw = localStorage.getItem(OPT_KEY);
            if (raw) Object.assign(opts, JSON.parse(raw));
            for (const k of ['handoff', 'ready', 'ask', 'restart', 'focus']) delete opts[k];   // 예전에 끌 수 있던 것 — 이제 늘 켜져 있다
        } catch { /* 사생활 보호 모드 등 — 기본값으로 */ }
    }
    function save() {
        try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch { /* 무시 */ }
    }

    /* ── 도우미 프로그램 ───────────────── */
    // 성과 스캔이 이미 찾아 둔 도우미를 그대로 쓴다 — 주소를 따로 두드리면 브라우저가 로컬 접근 권한을 또 묻는다
    const Scan = () => window.VMH.Scan;
    function stop(reason, focus) { const e = new Error(reason); e.quiet = true; e.focus = !!focus; throw e; }

    async function helper(path, body) {
        let r;
        try { r = await Scan().helperCall(path, body); }
        catch {
            // 도우미가 꺼졌다 — 찾은 것을 지워 두면 ensureHelper가 다시 켜질 때까지 찾아본다
            if (Scan()) Scan().state.helper = null;
            stop('도우미 프로그램에 연결하지 못했습니다');
        }
        if (!r || !r.ok) {
            // 게임 창이 앞에 없다 (불러오기를 껐거나, 윈도우가 불러오기를 막았거나, 게임이 꺼져 있다) —
            // 이것만은 멈추지 않고 run()이 잠시 뒤 같은 일을 다시 시킨다
            if (r && r.error === 'focus') stop('게임 창이 앞에 없습니다' + (r.foreground ? ' — ' + r.foreground : ''), true);
            // 모르는 키 = 그 키가 없던 옛 도우미다 (F3·Backspace는 방 다시 만들기에서 처음 쓴다)
            if (r && r.error === 'bad key') stop('도우미 프로그램이 오래되었습니다 — 성과 스캔 탭에서 새로 받아주세요');
            stop('도우미가 거절했습니다 (' + ((r && r.error) || '알 수 없음') + ')');
        }
        return r;
    }
    // activate — 게임 창이 뒤에 있으면 도우미(v7)가 앞으로 불러와서 누른다. 옛 도우미는 이 칸을 모르고 그냥 거절한다
    const key = (name) => helper('/helper/key', { key: name, hold: HOLD_MS, activate: true });
    const clip = (text) => helper('/helper/clipboard', { text, activate: true });

    /* ── 화면 ───────────────── */
    /* 지금 화면 한 장. 공유가 멈춰 있으면 받지 않는다 — 다른 창이 게임을 덮으면 게임이 화면을 새로 그리지 않아
       같은 그림이 계속 온다. 그 옛 화면을 보고 키를 누르면 엉뚱한 줄을 고르거나(자리 번호가 그새 바뀐다)
       이미 지나간 상태를 보고 판단한다. 멈춘 동안은 그냥 아무것도 안 하고, 다시 그려지면 이어서 한다 */
    async function frame() {
        const g = await Hub.grab();
        if (!g || g.stale) return null;
        return g;
    }

    /* 키를 누른 뒤 화면이 기대대로 될 때까지 본다. check가 값을 돌려주면 그 값, 끝내 아니면 null */
    async function waitFor(check, tries = STEP_TRIES) {
        for (let i = 0; i < tries; i++) {
            await sleep(STEP_MS);
            const g = await frame();
            if (!g) continue;
            const r = check(g.frame, g.W, g.H, g);
            if (r) return r;
        }
        return null;
    }

    /* 지금 로비의 칸 번호 → 사람. 명단은 room에서 가져오지만 자리 번호는 늘 방금 읽은 화면에서 센다 —
       퇴장은 room에 5초 늦게 반영되므로, 화면에 없는 사람은 이렇게 해야 후보에서 저절로 빠진다.
       누구인지는 표와 같은 판단(AutoRoom.identifyRows — 자리 잇기 포함)으로 가린다. 한 장만 보고 장부를 뒤지면
       표에는 멀쩡히 있는 1순위를 놓쳐 2순위에게 넘기게 된다.
       sameSlots — 방장을 넘겨 목록이 다시 정렬된 뒤에는 false (직전 칸 배치가 더는 맞지 않는다) */
    function seatsOf(frm, W, H, sameSlots = true) {
        if (!Room.isLobbyScreen(frm, W, H)) return null;
        return window.VMH.AutoRoom.identifyRows(Room.readLobby(frm, W, H).rows, { sameSlots });
    }

    /* 매칭 순서에서 봇 자신을 뺀 것. 봇은 게임을 치지 않아 대기가 끝없이 쌓이므로 보류로 빠져 있지 않으면
       금세 1순위(세이프가드)가 된다 — 봇 지정을 안 했거나, 봇 명패가 새 id로 잡혔거나, 다른 사람을 봇으로 지정했을 때.
       그러면 봇이 자기에게 방장을 넘기려다 멈추기를 8초마다 되풀이했다. 봇은 YOU 꼬리표로 늘 알 수 있으니
       room.botId와 상관없이 그 칸의 사람을 뺀다 */
    function queueOf(seats, youRow) {
        const me = youRow >= 0 ? seats.find(s => s.row === youRow) : null;
        return priorityOrder().map(p => p.nickname).filter(id => !me || id !== me.id);
    }

    /* 넘겨받을 사람이 지금 화면에 있는가. 없으면 사이클을 아예 시작하지 않는다 —
       시작해 버리면 '넘길 사람을 못 찾았습니다'로 멈추면서 래치가 걸려, 그 뒤에 사람이 들어와도
       다시 넘기지 않는다. 방을 막 다시 만들어 봇 혼자인 때가 바로 그 경우다 */
    function hasTarget(frm, W, H, youRow) {
        const seats = seatsOf(frm, W, H);
        if (!seats) return false;
        const order = queueOf(seats, youRow);
        return seats.some(s => s.row >= 1 && s.row !== youRow && order.indexOf(s.id) >= 0);
    }

    /* 한 칸의 READY 상태 — true/false, 닉네임을 못 읽어 모르면 null (모를 때는 F5를 누르지 않는다.
       레디는 토글이라, 이미 레디인데 누르면 오히려 풀린다) */
    function rowReady(frm, W, H, row) {
        const p = Room.readPlate(frm, Room.lobbyRowRect(row, W, H));
        if (!p || p.empty || !p.fp || !p.fp.nameState) return null;
        return p.fp.nameState === 'ready';
    }

    /* 열어 둔 창을 닫는다 — 창이 아직 덮고 있을 때만. 로비로 돌아온 뒤에 Esc를 치면 게임 메뉴가 열린다.
       방장 메뉴뿐 아니라 방장이 아닐 때 뜨는 보기 전용 창도 닫아야 해서, "로비가 안 보인다"를 기준으로 삼는다
       (실측: 방장 메뉴도 보기 전용 창도 로비 판별의 PLAYER 1·2 뱃지 자리를 덮는다) */
    async function closeMenu() {
        try {
            const g = await frame();
            if (!g) return;
            const covered = !Room.isLobbyScreen(g.frame, g.W, g.H)
                && !Room.isRoundScreen(g.frame, g.W, g.H) && !Room.isResultScreen(g.frame, g.W, g.H);
            if (covered) await key('esc');
        } catch { /* 이미 멈추는 중이다 */ }
    }

    /* 방장을 넘긴 뒤 내 자리를 읽는 검사기 — 같은 칸이 두 번 연속 보여야 답한다.
       자리는 곧바로 정해지지 않는다: 목록이 다시 정렬되는 동안 명패가 미끄러지며 지나가는 칸이 있다.
       이 칸 하나로 F5를 누를지(PLAYER 2면 누르면 안 된다)와 채팅의 n픽이 함께 정해지므로,
       스쳐 지나가는 칸을 받으면 둘 다 틀린다 */
    function settledYouRow() {
        let seen = -1;
        return (f, W, H) => {
            if (!Room.isLobbyScreen(f, W, H)) { seen = -1; return null; }
            const row = Room.lobbyMarks(f, W, H).youRow;
            if (!(row > 0)) { seen = -1; return null; }
            if (row !== seen) { seen = row; return null; }
            return { youRow: row, f, W, H };
        };
    }

    /* 채팅을 어디서 치는가 — 로비와 대결 화면은 입력칸 자리도, "지금 그 화면인가"도 다르다 */
    const LOBBY_CHAT = { open: (f, W, H) => Room.isChatOpen(f, W, H), on: (f, W, H) => Room.isLobbyScreen(f, W, H) };
    const VERSUS_CHAT = { open: (f, W, H) => Room.isVersusChatOpen(f, W, H), on: (f, W, H) => Room.isVersusScreen(f, W, H) };

    /* 채팅칸을 연다. 라운드가 막 시작한 몇 초 동안은 채팅이 잠겨 Enter가 아예 안 먹으므로 열릴 때까지 다시 친다.
       두 가지를 매번 확인하고서야 다시 친다:
         - 이미 열려 있으면 치지 않는다 (열린 채로 Enter는 빈 줄을 보내고 칸을 닫는다)
         - 기대한 화면이 아니면 그 자리에서 그만둔다 — 모르는 화면에서 Enter를 연타하는 것이 이 기능의 유일한 위험이다 */
    async function openChat(chat) {
        for (let i = 0; i < OPEN_TRIES; i++) {
            const g = await frame();
            if (!g) { await sleep(STEP_MS); continue; }   // 공유가 멈췄다 — 안 보이는 동안은 치지 않는다
            if (chat.open(g.frame, g.W, g.H)) return true;
            if (!chat.on(g.frame, g.W, g.H)) return false;
            await key('enter');
            if (await waitFor((f, W, H) => chat.open(f, W, H) || null, OPEN_WAIT)) return true;
        }
        return false;
    }

    /* 한 줄 보내기 — 클립보드에 넣고 붙여넣는다. 한 글자씩 치면 한글 입력기를 거쳐야 하고 훨씬 느리다.
       채팅칸이 열린 것을 눈으로 본 뒤에만 붙여넣는다 (안 열렸는데 치면 엉뚱한 곳에 들어간다) */
    async function sendChat(text, chat) {
        await clip(text);
        if (!await openChat(chat)) stop('채팅칸이 열리지 않았습니다');
        await key('paste');
        await sleep(STEP_MS);
        await key('enter');
    }

    /* ── 채팅 문구 ─────────────────
       n픽 — 맨 위가 1픽, 맨 아래가 8픽. 방장이 넘어가면 PLAYER 1·2가 맞바뀌고 목록이 다시 정렬되므로
       자리 번호는 반드시 넘긴 **뒤에** 읽은 화면에서 센다 */
    // skip — 목록에서 뺄 사람 = 지금 방장 (넘긴 직후면 넘겨받은 사람). 순위 번호는 매칭 순서 그대로 적는다
    function chatText(order, seats, youRow, skip = order[0]) {
        const pickOf = (id) => { const s = seats.find(x => x.id === id); return s ? s.row + 1 : 0; };
        const parts = [];
        for (let i = 0; i < order.length && parts.length < RANKS; i++) {
            if (order[i] === skip) continue;
            const n = pickOf(order[i]);
            if (n) parts.push((i + 1) + '순위 ' + n + '픽');
        }
        if (!parts.length) return null;
        const tpl = youRow === 1 ? opts.textP2 : opts.text;
        return tpl.replace(/\{목록\}/g, parts.join(' · ')).replace(/\{봇\}/g, String(youRow + 1));
    }

    /* ── 한 사이클 ───────────────── */
    async function cycle() {
        // 1. 지금 로비에서 1순위가 몇 번째 칸인지
        const g0 = await frame();
        if (!g0) stop('화면을 못 받았습니다 (공유가 멈춰 있을 수 있습니다)');
        const seats = seatsOf(g0.frame, g0.W, g0.H);
        if (!seats) stop('로비가 아닙니다');
        if (Room.lobbyMarks(g0.frame, g0.W, g0.H).youRow !== 0) stop('봇이 방장 자리(맨 윗칸)에 없습니다');
        // 봇(0번 칸)은 빼고, 1번 칸부터 앉아 있는 사람 중 1순위
        const order = queueOf(seats, 0);
        const target = order.find(id => seats.some(s => s.id === id && s.row >= 1));
        if (!target) stop('넘길 사람을 못 찾았습니다');
        const k = seats.find(s => s.id === target).row;

        // 2. F9 — 방장 메뉴가 맞는지. 방장이 아닐 때 뜨는 보기 전용 창에는 ROOM/PLAYER 탭이 없어 null이 나온다
        await key('f9');
        let menu = await waitFor((f, W, H) => Room.hostMenu(f, W, H));
        if (!menu) { await closeMenu(); stop('F9를 눌렀는데 방장 메뉴가 아닙니다'); }
        if (menu.tab === 'room') {
            await key('shift');
            menu = await waitFor((f, W, H) => { const m = Room.hostMenu(f, W, H); return m && m.tab === 'player' ? m : null; });
            if (!menu) { await closeMenu(); stop('PLAYER 탭으로 넘어가지 않았습니다'); }
        }
        if (menu.row !== 0) { await closeMenu(); stop('메뉴가 첫 줄에서 시작하지 않습니다 (' + menu.row + '번째 줄)'); }

        // 3. ↓ — 메뉴 목록은 나를 빼고 로비 순서 그대로다. 로비 k번 칸 = 메뉴 k-1번 줄
        for (let i = 1; i <= k - 1; i++) {
            await key('down');
            menu = await waitFor((f, W, H) => { const m = Room.hostMenu(f, W, H); return m && m.row === i ? m : null; });
            if (!menu) { await closeMenu(); stop('메뉴 줄이 ' + (i + 1) + '번째로 내려가지 않았습니다'); }
        }

        // 4. → 한 번. 노란 칠이 PLAYER 1 (HOST) 칸으로 옮겨간 것을 눈으로 확인한 뒤에만 Enter를 친다
        await key('right');
        menu = await waitFor((f, W, H) => {
            const m = Room.hostMenu(f, W, H);
            return m && m.row === k - 1 && m.button === Room.BTN_HOST ? m : null;
        });
        if (!menu) { await closeMenu(); stop('PLAYER 1 (HOST) 칸이 안 잡혔습니다'); }

        // 5. Enter — 방장으로 지정하면 창이 저절로 닫힌다. 로비에서 내가 맨 윗칸을 벗어났는지로 확인한다.
        //    자리가 가라앉을 때까지 본다 (settledYouRow 주석 참고)
        await key('enter');
        const after = await waitFor(settledYouRow(), CLOSE_TRIES);
        if (!after) { await closeMenu(); stop('방장이 넘어갔는지 확인하지 못했습니다'); }

        const seats2 = seatsOf(after.f, after.W, after.H, false) || [];
        const isP2 = after.youRow === 1;
        let done = '방장을 ' + target + '에게 넘김';

        // 6. F5 — 봇이 PLAYER 2면 누르지 않는다 (누르면 봇이 대결에 들어간다). 이미 레디여도, 레디인지 모르겠어도 누르지 않는다
        if (isP2) {
            done += ' · 봇이 PLAYER 2라 레디는 건너뜀';
        } else if (rowReady(after.f, after.W, after.H, after.youRow) === false) {
            await key('f5');
            const ok = await waitFor((f, W, H) => rowReady(f, W, H, after.youRow) || null);
            done += ok ? ' · 레디' : ' · 레디는 확인 못 함';
        }

        // 7. 채팅 — 여기까지 온 것은 지켜야 하므로, 채팅이 어긋나도 넘긴 것까지는 남긴다.
        //    2픽 안내는 끌 수 없다 (안 알리면 방장이 봇을 고른 채 판이 안 시작된다)
        if (opts.chat || isP2) {
            const text = chatText(order, seats2, after.youRow, target);
            if (text) {
                try { await sendChat(text, LOBBY_CHAT); } catch (e) { stop(done + ' — ' + e.message); }
                done += ' · 채팅 안내';
                if (isP2) state.p2Told = true;   // 2픽 안내를 이미 했다 — watchP2가 한 번 더 하지 않게
            }
        }
        return done;
    }

    /* 판이 끝났는데 방장이 남에게 있다 — 도로 달라고 채팅으로 알린다.
       봇이 방장이어야 다음 판도 1순위에게 넘겨줄 수 있으므로, 이게 한 바퀴의 나머지 반이다 */
    async function askHost() {
        await sendChat(opts.textAsk, LOBBY_CHAT);
        return '방장을 넘겨 달라고 알림';
    }

    /* ── 대결이 도는 동안 ─────────────────
       이번 곡의 난이도 문구 — 곡은 층수 측정기가 라운드·결과 화면에서 자켓으로 가려 둔 것을 그대로 쓴다.
       대결 화면에 곡 제목이 글자로 떠 있지만 읽지 않는다: 층수·태그는 어차피 층수 탭에만 있고,
       같은 것을 두 경로로 알아내면 어긋난다. 그래서 층수 탭도 화면 공유를 받고 있어야 한다
       (옵션 '화면 공유를 줄 곳'이 '둘 다'여야 한다는 뜻이다) */
    function songText() {
        const F = window.VMH.Floor;
        const s = F && F.playingSong();
        if (!s || !s.title) return null;
        const t = opts.textSong
            .replace(/\{라운드\}/g, 'R' + s.round).replace(/\{곡\}/g, s.title)
            .replace(/\{패턴\}/g, s.pattern).replace(/\{층수\}/g, s.floor).replace(/\{태그\}/g, s.tags);
        return t.replace(/\s+/g, ' ').trim() || null;
    }

    async function tellSong(text) {
        await sendChat(text, VERSUS_CHAT);
        return '이번 곡 안내 — ' + text;
    }

    /* ── 자리마다 할 일 — 로비 프레임마다 본다 ─────────────────
         1픽(방장)       → 1순위에게 넘긴다 (onLobby → cycle)
         2픽(PLAYER 2)   → 레디하지 않는다. 레디가 켜져 있으면 끈다. 다른 사람을 골라 달라고 채팅 한 번 (watchP2)
         3~8픽           → 레디를 켜 둔다 (maybeReady)
       넘긴 그 순간에만 봐서는 모자란다 — 그 뒤에 사람이 들고 나거나 남이 봇을 PLAYER 2로 고르면 자리가 바뀌는데,
       아무도 다시 보지 않아 영영 비레디로 남거나 2픽에서 말없이 앉아 있었다. 그래서 어떤 길로 그 자리에 왔든 늘 본다.
       공통으로 지키는 것:
         - 방이 놀고 있을 때만 (HOST 뱃지가 보인다 = 대결 중이 아니다). 대결 중에는 명패에 덮개가 깔려
           레디인지도 제대로 안 읽힌다
         - 같은 상태가 READY_TICKS 프레임 이어져야 누른다 (목록이 다시 정렬되며 스쳐 가는 칸으로 누르지 않는다)
         - 레디인지 모르면(null) 누르지 않는다 — F5는 토글이다
         - 눌렀는데 안 바뀌었으면 READY_RETRY_MS 뒤에 다시 본다 (영영 포기하지 않는다. 상태를 다시 읽고서야
           누르므로, 잘못 읽어 한 번 뒤집혀도 다음 번에 바로잡힌다) */
    function maybeReady(frm, W, H, marks) {
        const row = marks.youRow;
        if (row < 2 || !marks.hostBadge) { state.unready = 0; return; }
        const on = rowReady(frm, W, H, row);   // null = 명패를 못 읽었다 → 누르지 않는다
        if (on !== false) { state.unready = 0; return; }
        if (++state.unready < READY_TICKS || Date.now() < state.readyRetryAt || !ready()) return;
        state.unready = 0; state.readyRetryAt = Date.now() + READY_RETRY_MS;
        run(() => pressReady(row, true), '레디 누르는 중…', () => { state.readyRetryAt = 0; });
    }

    // want — 켜려는가(true) 끄려는가(false)
    async function pressReady(row, want) {
        await key('f5');
        const ok = await waitFor((f, W, H) => rowReady(f, W, H, row) === want || null);
        return (row + 1) + '픽 — ' + (want ? '레디' : '레디 풀기') + (ok ? '' : ' (바뀌었는지 확인 못 함)');
    }

    /* 2픽(PLAYER 2) — 봇이 레디하면 대결에 들어가 버린다. 그래서
         - 레디가 켜져 있으면 끈다 (3픽에서 레디해 둔 채 윗사람이 나가 2픽으로 올라온 경우)
         - 다른 사람을 골라 달라고 채팅을 **한 번** 한다 (p2Told — 2픽을 벗어나면 풀린다).
           알릴 다음 순서가 아직 없으면(방에 방장과 봇뿐) 사람이 들어올 때까지 미룬다 */
    function watchP2(frm, W, H, marks) {
        if (marks.youRow !== 1) {
            if (marks.youRow >= 0) state.p2Told = false;   // 2픽을 벗어났다 — 다시 오면 또 알린다 (-1은 나를 못 찾은 것뿐)
            state.p2Streak = 0; state.p2Ready = 0;
            return;
        }
        if (!marks.hostBadge) { state.p2Streak = 0; state.p2Ready = 0; return; }
        state.p2Streak++;
        // 레디 풀기 — 레디가 이어질 때만 (모르면 안 누른다)
        if (rowReady(frm, W, H, 1) === true) {
            if (++state.p2Ready >= READY_TICKS && Date.now() >= state.readyRetryAt && ready()) {
                state.p2Ready = 0; state.readyRetryAt = Date.now() + READY_RETRY_MS;
                run(() => pressReady(1, false), '2픽이라 레디 푸는 중…', () => { state.readyRetryAt = 0; });
            }
            return;   // 레디부터 푼 뒤에 알린다
        }
        state.p2Ready = 0;
        if (state.p2Told || state.p2Streak < READY_TICKS || !ready()) return;
        const seats = seatsOf(frm, W, H);
        if (!seats) return;
        const host = seats.find(s => s.row === 0);
        const text = chatText(queueOf(seats, 1), seats, 1, host ? host.id : null);
        if (!text) return;
        state.p2Told = true;
        run(async () => { await sendChat(text, LOBBY_CHAT); return '2픽이라 다른 분을 골라 달라고 알림'; },
            '2픽 안내 중…', () => { state.p2Told = false; });
    }

    /* ── 방이 터졌을 때 다시 만들기 ─────────────────
       '방이 해체되었습니다' 알림 → Enter(종료) → 방 목록 → F3(생성) → CREATE ROOM 창 → VERSUS·이름·비밀번호 → 생성.
       걸음마다 화면을 보고 기대와 다르면 그 자리에서 멈춘다. 여기서 어긋난 채로 계속 치면
       엉뚱한 이름·모드의 방을 만들어 버리고, 그건 사람이 손으로 지워야 한다. */
    const CR_NAME = { mode: '모드', name: '방 이름', pw: '비밀번호', cap: '최대 인원', cancel: '취소', create: '생성' };

    /* 지금 CREATE ROOM 창 한 장. want를 주면 그 칸이 잡혀 있는지까지 본다 */
    async function createBox(want) {
        const g = await frame();
        if (!g) stop('화면을 못 받았습니다 (공유가 멈춰 있을 수 있습니다)');
        const b = Room.createRoom(g.frame, g.W, g.H);
        if (!b) stop('CREATE ROOM 창이 보이지 않습니다');
        if (want && b.focus !== want) stop(CR_NAME[want] + ' 칸이 아니라 ' + CR_NAME[b.focus] + ' 칸에 있습니다');
        return b;
    }

    /* ↓ 한 번 — 다음 칸이 잡힌 것을 보고서야 넘어간다 */
    async function downTo(want) {
        await key('down');
        const b = await waitFor((f, W, H) => { const x = Room.createRoom(f, W, H); return x && x.focus === want ? x : null; });
        if (!b) stop(CR_NAME[want] + ' 칸으로 내려가지 않았습니다');
        return b;
    }

    /* 한 화면에서 다음 화면으로 넘어갈 때까지 같은 키를 다시 친다.
       해체 알림은 뜨자마자 몇 초간 Enter가 먹지 않고, 그 뒤 전환 연출도 있다. 그래서 한 번 치고 끝내면 안 된다.
       ★ 치는 것은 **지금 그 화면(from)이 보이는 프레임**에서만이다 — 넘어가는 동안(둘 다 아닌 프레임)은 기다리기만 하고,
         모르는 화면에서는 한 번도 안 친다. 채팅칸의 openChat과 같은 모양이고, 같은 이유다 */
    async function pressUntil(name, from, to) {
        for (let i = 0; i < OPEN_TRIES; i++) {
            const g = await frame();
            if (g) {
                const done = to(g.frame, g.W, g.H);
                if (done) return done;
                if (from(g.frame, g.W, g.H)) await key(name);
            }
            const done = await waitFor(to, OPEN_WAIT);
            if (done) return done;
        }
        return null;
    }

    /* 방 이름·비밀번호의 {날짜}는 오늘 날짜로 바꾼다 — 버망호는 그날 날짜(MMDD)를 방 비밀번호로 쓴다 */
    function roomText(tpl) {
        const d = new Date(), p2 = (n) => (n < 10 ? '0' : '') + n;
        const mm = p2(d.getMonth() + 1), dd = p2(d.getDate());
        return tpl.replace(/\{날짜\}/g, mm + dd).replace(/\{월\}/g, mm).replace(/\{일\}/g, dd).trim();
    }

    /* 글자칸 채우기 — Backspace로 비우고 클립보드에서 붙여넣는다.
       빈 것·채워진 것을 눈으로 확인한다 (게임이 붙여넣기를 안 받으면 이름 없는 방이 만들어진다) */
    async function fillField(which, text) {
        await clip(text);
        for (let i = 0; i < CLEAR_ROUNDS; i++) {
            if (!(await createBox(which))[which]) break;
            for (let k = 0; k < CLEAR_KEYS; k++) await key('backspace');
        }
        if ((await createBox(which))[which]) stop(CR_NAME[which] + ' 칸을 비우지 못했습니다');
        await key('paste');
        if (!await waitFor((f, W, H) => { const x = Room.createRoom(f, W, H); return x && x[which] ? x : null; }))
            stop(CR_NAME[which] + ' 칸에 붙여넣지 못했습니다');
    }

    // 알림을 닫은 뒤 — 방 목록, 또는 (멈췄다가 이어서 하는 중이면) 이미 열려 있는 CREATE ROOM 창
    const seenList = (f, W, H) => Room.isRoomList(f, W, H) || Room.createRoom(f, W, H) || null;

    /* 중간에 멈췄다가 이어서 하는 것도 이 함수 하나다 — 걸음마다 '이미 그 화면이면 건너뛴다'라서
       해체 알림·방 목록·CREATE ROOM 창 어디서 시작해도 된다 */
    async function recreate() {
        // 1. 알림 닫기 — 단추가 '종료' 하나뿐이라 Enter가 곧 그것이다.
        //    막 뜬 동안은 Enter가 안 먹으므로 방 목록이 보일 때까지 다시 친다
        if (!await pressUntil('enter', Room.isDisbandBox, seenList))
            stop('방 목록으로 돌아오지 않았습니다');

        // 2. F3 = 생성 — 여기도 방 목록이 보이는 프레임에서만 치고, 창이 열릴 때까지 다시 친다
        if (!await pressUntil('f3', Room.isRoomList, Room.createRoom))
            stop('CREATE ROOM 창이 열리지 않았습니다');

        // 이어서 하는 중이면 포커스가 아래 칸에 남아 있을 수 있다 — ↑로 모드 줄까지 올린다
        // (↑는 아무것도 확정하지 않는다. 처음 연 창은 이미 모드 줄이라 한 번도 안 친다)
        for (let i = 0; i < 5 && (await createBox()).focus !== 'mode'; i++) {
            await key('up');
            await sleep(STEP_MS);
        }

        // 3. VERSUS MATCH — 창이 열리면 포커스는 모드 줄에 있다. →로 옮겨 보라색이 되는 것을 본다.
        //    최대 인원은 건드리지 않는다: 모드를 고르면 그 모드의 최대치가 저절로 들어간다 (VERSUS는 8)
        for (let i = 0; i < 3; i++) {
            if ((await createBox('mode')).versus) break;
            await key('right');
            await sleep(STEP_MS);
        }
        if (!(await createBox('mode')).versus) stop('VERSUS MATCH가 안 골라졌습니다');

        // 4. 방 이름 · 비밀번호 (비워 둔 것은 손대지 않는다)
        const roomName = roomText(opts.roomName), roomPw = roomText(opts.roomPw);
        await downTo('name');
        if (roomName) await fillField('name', roomName);
        await downTo('pw');
        if (roomPw) await fillField('pw', roomPw);
        await downTo('cap');   // 최대 인원은 지나가기만 한다

        // 5. 생성 — ↓로 내려가면 취소·생성 중 어느 쪽이 잡힐지 모르니 보고서 →를 친다
        await key('down');
        const btn = await waitFor((f, W, H) => {
            const x = Room.createRoom(f, W, H);
            return x && (x.focus === 'create' || x.focus === 'cancel') ? x : null;
        });
        if (!btn) stop('취소·생성 줄로 내려가지 않았습니다');
        if (btn.focus === 'cancel') {
            await key('right');
            if (!await waitFor((f, W, H) => { const x = Room.createRoom(f, W, H); return x && x.focus === 'create' ? x : null; }))
                stop('생성 칸이 안 잡혔습니다');
        }
        await key('enter');
        const ok = await waitFor((f, W, H) => Room.isLobbyScreen(f, W, H) || null, LIST_TRIES);
        return '방을 다시 만듦' + (roomName ? ' — ' + roomName : '')
             + (roomPw ? ' (비밀번호 ' + roomPw + ')' : '') + (ok ? '' : ' · 로비는 확인 못 함');
    }

    /* ── 바깥 ───────────────── */
    function ready() {
        if (!opts.on) return false;
        if (state.busy || !Hub.isRunning() || Hub.isStale()) return false;   // 멈춘 화면을 보고 시작하지 않는다
        if (Date.now() < state.retryAt) return false;   // 게임 창이 앞에 없어 멈춘 직후 — 조금 쉬고 다시 해 본다
        const S = Scan();
        if (!S || !S.state.helper) { ensureHelper(); return false; }
        if (!S.state.helper.windows) return false;
        return !S.state.running;   // 성과 스캔과 같이 돌지 않는다 — 둘 다 게임에 키를 보낸다
    }

    /* 도우미 찾기 — 성과 스캔 탭은 그 탭을 열 때만 찾는다(웹에서 127.0.0.1을 부르면 브라우저가 권한을 물을 수 있어서,
       매칭만 쓰는 사람에게 묻지 않으려고). 그래서 스캔 탭을 한 번도 안 열면 봇이 영영 움직이지 않았다.
       봇을 켠 사람은 도우미를 쓰겠다는 것이니, 켜져 있는 동안 못 찾았으면 여기서 찾는다 (HELPER_PROBE_MS마다) */
    let probing = false, probeAt = 0;
    function ensureHelper(now) {
        const S = Scan();
        if (!opts.on || !S || !S.checkHelper || S.state.helper || S.state.running || S.state.launching || probing) return;
        if (!now && Date.now() < probeAt) return;
        probing = true; probeAt = Date.now() + HELPER_PROBE_MS;
        Promise.resolve().then(() => S.checkHelper()).catch(() => {}).finally(() => { probing = false; render(); });
    }

    /* auto-room.js가 로비 명단을 확정할 때마다 부른다 (명단이 흔들리는 프레임에서는 불리지 않는다).
       back = 판이 끝나고 로비로 돌아온 첫 프레임 — 한 판에 한 번만 true다.
       waiting = 딜레이가 덜 찬 입·퇴장 수 (0이면 room이 화면과 같다) */
    function onLobby(frm, W, H, back, waiting = 0) {
        // 판이 끝났다 — 로비가 아닐 때만 쓰는 표시는 여기서 모두 접는다
        state.vsStreak = 0; state.songDone = false;
        state.disbandStreak = 0; state.restartDone = false;
        state.restartPending = false; state.restartTries = 0; state.restartRetryAt = 0;   // 방이 있다 — 다시 만들던 것은 끝났다
        if (back) state.readyRetryAt = 0;   // 새 판 — 레디를 곧바로 다시 볼 수 있게
        const marks = Room.lobbyMarks(frm, W, H);
        if (marks.youRow === 0 && marks.hostBadge) {
            // 봇이 방장이다 — 1순위에게 넘긴다. 한 번 시작하면 방장에서 내려올 때까지 다시 시작하지 않지만(latched),
            // 사이클이 멈추면(화면이 기대와 달랐다) HANDOFF_RETRY_MS 뒤에 처음부터 다시 해 본다 — 한 번 어긋났다고
            // 봇이 방장을 쥔 채 방이 서 버리면 안 된다. 넘겨받을 사람이 아직 없으면 시작조차 하지 않는다 (hasTarget)
            if (!state.latched && Date.now() >= state.handoffRetryAt
                && ready() && hasTarget(frm, W, H, 0) && settled(waiting)) {
                state.latched = true;
                run(cycle, '방장 넘기는 중…', () => { state.latched = false; },
                    () => { state.latched = false; state.handoffRetryAt = Date.now() + HANDOFF_RETRY_MS; });
            }
            state.unready = 0; state.p2Streak = 0; state.p2Ready = 0; state.askPending = false;
            return;
        }
        state.latched = false; state.settleSince = 0; state.handoffRetryAt = 0;
        // 방장이 남에게 있다 — 판이 끝난 그 한 번만 도로 달라고 알린다.
        // 0번 칸이면 움직이지 않는다(대결 덮개에 HOST 뱃지가 가려진 것일 수 있다). 나를 못 찾아도(-1) 마찬가지다
        // (게임 창이 앞에 없어 못 보냈으면 askPending으로 남겨 두고 다음 로비 프레임에 다시 한다)
        // 채팅칸이 안 열려 멈췄으면 ASK_RETRY_MS 뒤에 다시 (ASK_TRIES번까지) — 이 한 번이 빠지면 방장이 안 돌아와
        // 봇 순환이 여기서 끊긴다
        if (back) { state.askPending = true; state.askTries = 0; state.askRetryAt = 0; }
        if (state.askPending && marks.youRow > 0 && Date.now() >= state.askRetryAt && ready()) {
            state.askPending = false;
            run(askHost, '방장을 넘겨 달라고 알리는 중…', () => { state.askPending = true; }, () => {
                if (++state.askTries >= ASK_TRIES) return false;
                state.askPending = true; state.askRetryAt = Date.now() + ASK_RETRY_MS;
            });
        }
        watchP2(frm, W, H, marks);
        maybeReady(frm, W, H, marks);
    }

    /* 입·퇴장이 다 끝났는가 — 아직이면 기다린다고 한 번 적어 두고 false.
       SETTLE_MAX_MS 넘게 안 끝나면 지금 명단으로 넘긴다 */
    function settled(waiting) {
        if (!waiting) { state.settleSince = 0; return true; }
        const now = Date.now();
        if (!state.settleSince) {
            state.settleSince = now;
            state.note = '입·퇴장 ' + waiting + '명이 끝나기를 기다렸다가 넘깁니다'; state.at = new Date(); render();
            return false;
        }
        if (now - state.settleSince < SETTLE_MAX_MS) return false;
        state.settleSince = 0;
        log('입·퇴장이 ' + Math.round(SETTLE_MAX_MS / 1000) + '초 넘게 안 끝나 지금 명단으로 넘깁니다', 'warn');
        return true;
    }

    /* 로비가 아닌 화면 — auto-room.js가 종류를 가린 뒤에 부른다 (kind: 'round' | 'result' | null).
       결과 화면에서는 아무것도 누르지 않는다 — 기다리면 게임이 저절로 로비로 넘어간다 */
    function onScreen(frm, W, H, kind) {
        if (kind === 'round') {   // 새 라운드가 시작됐다 — 곡 안내를 한 번 더 할 차례
            state.vsStreak = 0; state.songDone = false;
            return;
        }
        if (kind === 'result') { state.vsStreak = 0; return; }
        // 방이 터졌다 — 해체 알림이 뜨면 같은 방을 다시 만든다. 한 판에 한 번만 (로비를 다시 보면 풀린다)
        if (!state.restartDone && Room.isDisbandBox(frm, W, H)) {
            state.vsStreak = 0;
            if (++state.disbandStreak >= DISBAND_TICKS && ready()) {
                state.disbandStreak = 0; state.restartTries = 0;
                startRecreate();
            }
            return;
        }
        state.disbandStreak = 0;
        // 다시 만들다 멈췄다 — 알림은 이미 닫혀 방 목록이나 CREATE ROOM 창에 있다. 잠시 뒤 거기서 이어서 한다.
        // restartPending일 때만이다: 사람이 봇 계정으로 방을 나와 목록에 있는 것까지 방을 만들면 안 된다
        if (state.restartPending && !state.restartDone && Date.now() >= state.restartRetryAt
            && (Room.isRoomList(frm, W, H) || Room.createRoom(frm, W, H))) {
            state.vsStreak = 0;
            if (ready()) startRecreate();
            return;
        }
        if (!Room.isVersusScreen(frm, W, H)) { state.vsStreak = 0; return; }
        if (++state.vsStreak < VS_TICKS || !opts.song || state.songDone) return;
        // 층수 탭이 아직 곡을 못 가렸으면 다음 프레임에 다시 본다 (대결은 길다)
        const text = songText();
        if (!text || !ready()) return;
        state.songDone = true;
        run(() => tellSong(text), '이번 곡 안내 중…', () => { state.songDone = false; });
    }

    /* 방 다시 만들기 한 번. 멈추면 RESTART_RETRY_MS 뒤에 이어서(RESTART_TRIES번까지), 끝나면 접는다 */
    function startRecreate() {
        state.restartDone = true; state.restartPending = true;
        run(async () => { const note = await recreate(); state.restartPending = false; return note; },
            '방을 다시 만드는 중…',
            () => { state.restartDone = false; },
            () => {
                state.restartDone = false;
                if (++state.restartTries >= RESTART_TRIES) { state.restartPending = false; return false; }
                state.restartRetryAt = Date.now() + RESTART_RETRY_MS;
            });
    }

    /* retry — 게임 창이 앞에 없어서 멈췄을 때 그 일을 다시 할 수 있게 걸쇠를 풀어 주는 것.
       그 경우는 '중단'이 아니라 '기다림'이다: 기록은 처음 한 번만 남기고(프레임마다 쌓이지 않게),
       FOCUS_RETRY_MS 뒤에 같은 일을 다시 해 보고, 되면 '재개'를 남긴다 */
    /* onFail — 그 밖의 이유로 멈췄을 때 (방장 넘기기·방장 요청·방 다시 만들기가 잠시 뒤 다시 해 보게 한다).
       false를 돌려주면 이제 그만한다는 뜻이다 */
    async function run(job, startNote, retry, onFail) {
        state.busy = true;
        state.note = startNote; state.at = new Date(); render();
        let note;
        try {
            await Hub.setFrameRate(BUSY_FPS);
            note = await job();
            if (state.focusLost) { state.focusLost = false; log('게임 창에 다시 입력할 수 있어 재개합니다', 'hit'); }
            log(note, 'hit');
            state.lastFail = '';
        } catch (e) {
            if (e.focus && retry) {
                retry();
                state.retryAt = Date.now() + FOCUS_RETRY_MS;
                note = '기다리는 중 — ' + e.message;
                if (!state.focusLost) log(note + ' (게임 창을 앞으로 불러오지 못했습니다) — 게임 창을 누르면 이어서 합니다', 'warn');
                state.focusLost = true;
            } else {
                note = '중단 — ' + e.message;
                // 다시 해 보다가 같은 이유로 또 멈추면 기록을 쌓지 않는다
                // onFail이 false를 돌려주면 다시 해 볼 횟수를 다 쓴 것이다
                const again = onFail ? onFail() !== false : false;
                if (note !== state.lastFail) log('자동 방장 ' + note + (again ? ' — 잠시 뒤 다시 해 봅니다' : ''), 'warn');
                state.lastFail = note;
            }
        } finally {
            // 게임을 불러왔으면 원래 쓰던 창으로 돌려놓는다 (그새 직접 다른 창으로 옮겼으면 도우미가 그대로 둔다)
            try { await Scan().helperCall('/helper/restore', {}); } catch { /* 옛 도우미 */ }
            await Hub.setFrameRate(IDLE_FPS);
            state.busy = false; state.note = note; state.at = new Date(); render();
        }
    }

    function log(text, tone) {
        const A = window.VMH.AutoRoom;
        if (A && A.log) A.log('자동 방장 — ' + text, tone);
    }

    /* ── 옵션 UI ───────────────── */
    const $ = (id) => document.getElementById(id);

    // 준비 목록 — 성과 스캔 탭처럼 도우미(켜기·받기·다시 확인은 그 탭과 같은 줄)와 게임 화면 연결. 봇을 켜기 전에도 보인다
    function renderChecks() {
        const el = $('auto-host-helper'), S = Scan();
        if (!el || !S || !S.helperHtml) return;
        const ok = (b) => b ? '<span class="ok">●</span>' : '<span class="no">●</span>';
        const running = Hub.isRunning(), seen = Hub.receiving('room');
        const screen = !running ? '게임 화면이 연결되지 않았습니다 — 오른쪽 위 <b>게임 화면 연결</b>'
                     : !seen ? '게임 화면을 층수 측정기에만 주고 있어 봇이 로비를 못 봅니다 — 옵션 탭의 <b>화면 공유를 줄 곳</b>'
                     : '게임 화면 연결됨' + (opts.song && Hub.target !== 'both'
                         ? ' — 곡 안내는 옵션 탭의 <b>화면 공유를 줄 곳</b>이 <b>둘 다</b>여야 합니다' : '');
        el.innerHTML = [
            ok(!!S.state.helper) + S.helperHtml('봇이 게임에 키를 누르려면 필요합니다.'),
            ok(seen) + screen
        ].map(x => '<li>' + x + '</li>').join('');
    }

    function render() {
        renderChecks();
        const el = $('auto-host-note');
        if (!el) return;
        if (!opts.on) { el.textContent = ''; return; }
        const S = Scan();
        const why = !Hub.isRunning() ? '게임 화면이 연결되지 않았습니다'
                  : !(S && S.state.helper) ? '도우미 프로그램이 켜져 있지 않습니다 — 위의 "도우미 켜기"로 켜세요'
                  : !S.state.helper.windows ? '도우미가 Windows가 아니라 키를 보낼 수 없습니다'
                  : null;
        const last = state.note ? ' · 마지막: ' + state.note + (state.at ? ' (' + state.at.toLocaleTimeString() + ')' : '') : '';
        const what = '대기 중' + (opts.chat ? ' · 순서 안내' : '') + (opts.song ? ' · 곡 안내' : '');
        el.textContent = (why ? '켜져 있지만 지금은 못 움직입니다 — ' + why : what) + last;
    }

    function bind() {
        load();
        const map = { 'auto-host-toggle': 'on', 'auto-host-chat': 'chat', 'auto-host-song': 'song' };
        for (const [id, k] of Object.entries(map)) {
            const el = $(id);
            if (!el) continue;
            el.checked = !!opts[k];
            el.addEventListener('change', () => {
                opts[k] = el.checked;
                state.latched = false; state.retryAt = 0; state.handoffRetryAt = 0; state.readyRetryAt = 0;   // 껐다 켜면 곧바로 다시 해 본다 (멈춘 뒤 손으로 다시 시키는 길)
                save(); render();
                if (k === 'on' && el.checked) ensureHelper(true);   // 켠 그 클릭에서 도우미를 찾는다 (스캔 탭을 안 열어도)
                if (k === 'on' && typeof refreshUI === 'function') refreshUI();   // 표의 보류 ↔ 봇 지정 버튼
            });
        }
        for (const [id, k] of [['auto-host-text', 'text'], ['auto-host-text-p2', 'textP2'],
                               ['auto-host-text-ask', 'textAsk'], ['auto-host-text-song', 'textSong']]) {
            const el = $(id);
            if (!el) continue;
            el.value = opts[k];
            el.addEventListener('change', () => { opts[k] = el.value.trim() || DEFAULTS[k]; el.value = opts[k]; save(); });
        }
        // 방 이름·비밀번호는 비워 두는 것도 뜻이 있다 (이름은 게임이 지어 주는 대로, 비밀번호는 안 걸기) —
        // 그래서 빈 칸을 기본값으로 되돌리지 않는다
        for (const [id, k] of [['auto-host-room-name', 'roomName'], ['auto-host-room-pw', 'roomPw']]) {
            const el = $(id);
            if (!el) continue;
            el.value = opts[k];
            el.addEventListener('change', () => { opts[k] = el.value.trim(); el.value = opts[k]; save(); });
        }
        Hub.onChange(render);
        const S = Scan();
        if (S && S.onHelper) {
            S.onHelper(render);
            const box = $('auto-host-helper');
            if (box) box.addEventListener('click', S.onHelperClick);
            // 성과 스캔 탭처럼 이 탭을 열 때·브라우저로 돌아올 때 찾는다 (웹에서 127.0.0.1을 부르면 권한을 물을 수 있어,
            // 봇을 안 쓰는 사람에게는 묻지 않는다)
            const look = () => { if (VMH.Tabs.active === 'bot' && !S.state.helper && !S.state.running && !S.state.launching) S.checkHelper(); };
            VMH.Tabs.onChange(look);
            window.addEventListener('focus', look);
            look();
        }
        ensureHelper(true);   // 켜 둔 채로 페이지를 열었으면 곧바로 도우미를 찾는다
        render();
        if (typeof refreshUI === 'function') refreshUI();   // 표는 이 설정을 읽기 전에 한 번 그려졌다 (봇 보류도 여기서 맞춘다)
    }

    window.VMH = window.VMH || {};
    window.VMH.AutoHost = { opts, state, onLobby, onScreen, busy: () => state.busy,
                            _cycle: cycle, _askHost: askHost, _tellSong: tellSong,
                            _recreate: recreate, _roomText: roomText, _songText: songText, _chatText: chatText, _settledYouRow: settledYouRow };
    // 붙인 뒤에 bind — bind가 부르는 refreshUI(봇 보류 맞추기)가 VMH.AutoHost를 본다
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})();
