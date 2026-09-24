/* 성과 스캔 탭 — 스캔 루프, 검토 목록, 서버 기록 비교, 업로드.
   읽기 자체는 scan/reader.js. 곡 넘기기(↓)와 업로드는 helper.py(/helper/*)가 한다 — start.bat로 연 페이지는 같은 주소, 웹은 vmh-helper.exe(127.0.0.1:8777).

   스캔 루프: 시작 → 5초 기다림(그 사이 사용자가 게임 창 클릭) → 지금 곡 읽기 → [↓ → 기다림 → 읽기]를 반복.
     - 키는 helper가 맨 앞 창이 DJMAX일 때만 누른다. 그래서 사용자가 브라우저를 클릭하면 다음 키에서 멈춘다.
     - 검증 읽기는 없다: ↓를 누르고 opts.delay(기본 60ms)만 기다렸다가 프레임 한 장을 바로 읽는다.
       못 읽은 프레임(화면이 아님)만 조금 뒤 다시 받아 본다.
     - ↓ 뒤에도 같은 곡이면 바로 끝으로 보지 않고 좀 더 기다린다 (렉). 그래도 같은 곡이 두 번이면 목록 끝.
       맨 끝에서 ↓가 첫 곡으로 돌아가는 경우도 있어서, 이번 스캔의 첫 곡이 다시 나와도 끝이다.
     - 게임이 앞에 있는 동안 이 탭은 가려져 setTimeout이 1초 넘게 늘어진다 — 기다림은 전부 워커 타이머(ScreenCapture.sleep). */
(function (global) {
    'use strict';

    const Reader = global.VMH.ScanReader;
    const Hub = global.VMH.CaptureHub;
    const sleep = global.VMH.ScreenCapture.sleep;
    const esc = global.VMH.escapeHtml;
    const $ = (id) => document.getElementById(id);

    const OPT_KEY = 'scanOptionsV1';
    const OPT_DEFAULT = { dj: '', delay: 60, hold: 40 };
    const COUNTDOWN_S = 5;
    const SCAN_FPS = 60;              // 스캔하는 동안만 공유 프레임률을 올린다 (평소 5) — 기다림 뒤에 받는 프레임이 ↓ 뒤 화면이도록
    const IDLE_FPS = 5;
    const DELAY_MIN = 60;             // 곡 넘긴 뒤 기다림의 하한 — 기본값과 같다. 더 줄이면 앞 곡이 읽힌다
    const READ_TRIES = 8;             // 못 읽은 프레임이면 다시 받아 보는 횟수
    const RETRY_GAP_MS = 50;          // 그 간격
    const LAG_WAIT_MS = 1500;         // ↓ 뒤에도 같은 곡이면 이만큼 더 지켜본다
    const END_SAME = 2;               // 그러고도 같은 곡이 이만큼 이어지면 목록 끝
    const UPLOAD_GAP_MS = 150;        // 업로드 사이 간격 (한꺼번에 많이 보내면 V-ARCHIVE가 끊는다)
    const PAT_FULL = { NM: 'NORMAL', HD: 'HARD', MX: 'MAXIMUM', SC: 'SC' };
    const PAT_SHORT = { NORMAL: 'NM', HARD: 'HD', MAXIMUM: 'MX', SC: 'SC', NM: 'NM', HD: 'HD', MX: 'MX' };

    const opts = loadOpts();
    const state = {
        items: [],            // 읽은 곡 (아래 addReading 참고)
        seq: 0,
        running: false, stopAsked: false,
        helper: null,         // /helper/status 결과, 없으면 null
        helperChecked: false, // 한 번이라도 확인했는지 (웹에서는 이 탭을 열 때 처음 확인한다)
        launching: false,     // vmh://로 도우미를 켜고 뜨기를 기다리는 중
        launchFailed: false,  // 켜 봤는데 안 떴다 (= 아직 한 번도 실행한 적이 없을 가능성)
        server: null,         // 'id|button|pattern' → { rate, max } (서버 기록)
        serverDj: '',
        skip: new Set(),      // 올릴 목록에서 사용자가 체크를 뺀 칸
        results: new Map(),   // 칸 → 업로드 결과 { ok, text }
        account: null,        // { userNo, token } — 옵션 탭에서 고른다 (기억해 두기를 켰을 때만 LocalStorage)
        uploading: false
    };

    // ── 옵션 ─────────────────
    function loadOpts() {
        try {
            const o = Object.assign({}, OPT_DEFAULT, JSON.parse(localStorage.getItem(OPT_KEY) || '{}'));
            if (o.delay === 300 || o.delay === 100 || o.delay === 25) o.delay = OPT_DEFAULT.delay;   // 예전 기본값이 저장된 것 — 다른 옵션만 바꿔도 통째로 저장됐다
            if (!(o.delay >= DELAY_MIN)) o.delay = OPT_DEFAULT.delay;   // 하한이 올라가기 전에 저장된 값 (숫자가 아닌 것도 여기서 걸린다)
            return o;
        }
        catch { return Object.assign({}, OPT_DEFAULT); }
    }
    function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch { /* 이번 세션에만 */ } }
    const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

    function bindOptions() {
        const dj = $('scan-dj-input'), delay = $('scan-delay-input'), hold = $('scan-hold-input');
        dj.value = opts.dj; delay.value = opts.delay; hold.value = opts.hold;
        dj.addEventListener('change', () => { opts.dj = dj.value.trim(); dj.value = opts.dj; saveOpts(); });
        delay.addEventListener('change', () => { opts.delay = clampInt(delay.value, DELAY_MIN, 3000, OPT_DEFAULT.delay); delay.value = opts.delay; saveOpts(); });
        hold.addEventListener('change', () => { opts.hold = clampInt(hold.value, 10, 500, OPT_DEFAULT.hold); hold.value = opts.hold; saveOpts(); });
    }

    // ── 도우미 (helper.py / vmh-helper.exe) ─────────────────
    // start.bat로 연 페이지면 같은 주소에 있다. 웹(GitHub Pages·onrender)·다른 개발 서버에서는 사용자가 켠 도우미 프로그램이
    // 127.0.0.1:8777에 있다 (helper.py가 이 사이트에 CORS를 열어 둔다). 먼저 같은 주소, 안 되면 127.0.0.1:8777
    const HELPER_URL = 'http://127.0.0.1:8777';
    const HELPER_DOWNLOAD = 'download/vmh-helper.exe';
    // 도우미를 한 번이라도 실행했으면 이 주소가 그 프로그램 앞으로 등록돼 있다 (helper.py register_scheme)
    const HELPER_SCHEME = 'vmh://start';
    const IS_WIN = /Windows/.test(navigator.userAgent);
    const sameOriginHelper = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const helperBases = sameOriginHelper ? ['', HELPER_URL] : [HELPER_URL];
    let helperBase = helperBases[0];

    async function helperCall(path, body, base = helperBase) {
        const init = { headers: { 'X-VMH': '1' }, cache: 'no-store' };
        if (body) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
        const res = await fetch(base + path, init);
        if (!res.ok && res.status === 404) throw new Error('no-helper');
        return res.json();
    }
    async function probeHelper() {
        for (const base of helperBases) {
            try {
                const s = await helperCall('/helper/status', null, base);
                if (s && s.ok) { helperBase = base; return s; }
            } catch { /* 다음 주소 */ }
        }
        return null;
    }
    async function checkHelper() {
        state.helper = null;
        // 아직 허락을 안 받았으면 브라우저가 권한 창을 띄우고, 누를 때까지 요청이 멈춰 있다 — 그동안 무엇을 누를지 알려 준다
        state.lnaAsking = !sameOriginHelper && (await lnaState()) === 'prompt';
        if (state.lnaAsking) renderChecks();
        state.helper = await probeHelper();
        state.lnaDenied = !state.helper && !sameOriginHelper && (await lnaState()) === 'denied';
        state.lnaAsking = false;
        state.helperChecked = true;
        renderChecks();
        return state.helper;
    }
    // 웹 페이지는 프로그램을 직접 실행할 수 없다 — 대신 도우미가 등록해 둔 vmh:// 주소를 연다.
    // 브라우저가 "여시겠습니까?"를 한 번 묻고(항상 허용을 체크할 수 있다), 떴는지는 알려 주지 않으므로 상태를 되물어 확인한다.
    // 아직 한 번도 실행한 적이 없으면 주소가 등록돼 있지 않아 아무 일도 일어나지 않는다 — 그때는 받아서 한 번 실행하라고 안내한다.
    // 몇 번이 아니라 몇 초로 센다 — 꺼져 있는 주소로 보낸 요청이 몇 ms 만에 끊길지 몇 초를 끌지는 환경마다 다르다
    const LAUNCH_WAIT_MS = 15000, LAUNCH_STEP = 600;
    async function launchHelper() {
        if (state.launching) return null;
        state.launching = true;
        state.launchFailed = false;
        renderChecks();
        const until = Date.now() + LAUNCH_WAIT_MS;
        try {
            location.href = HELPER_SCHEME;
            while (Date.now() < until) {
                await new Promise(r => setTimeout(r, LAUNCH_STEP));
                const s = await probeHelper();
                if (s) { state.helper = s; state.helperChecked = true; return s; }
            }
            state.launchFailed = true;
            return null;
        } finally {
            state.launching = false;
            renderChecks();
        }
    }
    // Chrome 계열(웨일·엣지 포함)은 공개 사이트가 127.0.0.1을 부르려면 허락이 필요하다 — 권한 창 문구는
    // "이 기기의 다른 앱 및 서비스에 액세스". 막아 두면 요청이 나가지도 않아(도우미 로그에 아무것도 안 찍힌다)
    // 꺼진 것과 구별이 안 되므로, 권한 상태를 따로 본다. 권한 이름이 버전마다 다르다 (local-network-access → loopback-network)
    // 'granted' | 'prompt' | 'denied' | null(권한이 없는 브라우저)
    async function lnaState() {
        if (!navigator.permissions) return null;
        for (const name of ['loopback-network', 'local-network-access']) {
            try { return (await navigator.permissions.query({ name })).state; } catch { /* 모르는 이름 */ }
        }
        return null;
    }
    const NO_HELPER = '도우미 프로그램이 꺼져 있습니다 — 위의 "도우미 프로그램 받기"로 받아 켠 뒤 다시 누르세요';

    // ── 곡 DB ─────────────────
    // songDatabase(곡 정보)와 sigTable(자켓)은 층수 측정기가 페이지를 열 때 받아 둔다
    const songOf = (id) => (typeof songDatabase !== 'undefined' && songDatabase[id]) || null;
    const jackets = () => (typeof sigTable !== 'undefined' ? sigTable : []);
    const dbReady = () => jackets().length > 0 && Object.keys(typeof songDatabase !== 'undefined' ? songDatabase : {}).length > 0;
    const jacketUrl = (id) => (typeof VA_IMG_BASE !== 'undefined' ? VA_IMG_BASE : 'https://v-archive.net/s3/images/jackets/') + id + '.jpg';
    // 제목이 같은 곡이 둘 이상이면 업로드 때 작곡가를 같이 보내야 V-ARCHIVE가 가린다 (예: Alone 두 곡)
    let dupNames = null;
    function isDupName(name) {
        if (!dupNames) {
            const count = {};
            Object.values(songDatabase).forEach(s => { count[s.name] = (count[s.name] || 0) + 1; });
            dupNames = new Set(Object.keys(count).filter(k => count[k] > 1));
        }
        return dupNames.has(name);
    }

    // ── 읽은 곡 ─────────────────
    /* item = { seq, id, sure, jd, jratio, thumb(dataURL), table(blob URL), cells: [{button, pattern, score, rate, max, flags}],
                include, checked(사용자가 확인함), edited, dup } */
    const cellKey = (id, c) => id + '|' + c.button + '|' + c.pattern;
    const cellKeyOf = (item, c) => cellKey(item.id, c);

    function itemReasons(item) {
        const out = [];
        if (!songOf(item.id)) out.push('DB에 없는 곡');
        if (!item.sure) out.push('자켓 애매');
        if (item.dup) out.push('같은 곡이 두 번 읽힘');
        item.cells.forEach(c => { if (c.flags.length) out.push(c.button + 'B ' + c.pattern + ' ' + c.flags.join('·')); });
        return out;
    }
    const needsCheck = (item) => !item.edited && !item.checked && itemReasons(item).length > 0;

    function tableBlobUrl(canvas) {
        // 검토 화면용 — 3/4 크기 JPEG면 숫자는 읽히고 800곡이어도 수십 MB 안쪽이다
        const c = document.createElement('canvas');
        c.width = Math.round(canvas.width * 0.75); c.height = Math.round(canvas.height * 0.75);
        const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, c.width, c.height);
        return new Promise(r => c.toBlob(b => r(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
    }

    // 결과: 'added' | 'same'(이미 같은 값으로 있음)
    function addReading(r) {
        const sameId = state.items.filter(it => it.id === r.id);
        if (sameId.some(it => it.key === r.key)) return 'same';
        const item = {
            seq: ++state.seq, id: r.id, key: r.key, sure: r.sure, jd: r.jacket.d, jratio: r.jacket.ratio,
            thumb: r.jacket.thumb.toDataURL('image/png'), table: '',
            cells: r.cells.map(c => ({ button: c.button, pattern: c.pattern, score: c.score, rate: c.rate, max: c.max, flags: c.flags.slice() })),
            include: false, checked: false, edited: false, dup: false
        };
        if (sameId.length) { item.dup = true; sameId.forEach(it => { it.dup = true; it.include = it.edited || it.checked; }); }
        item.include = !needsCheck(item);
        state.items.push(item);
        // JPEG로 굳히는 데 곡당 1초쯤 걸린다 — 스캔이 기다리지 않게 뒤에서 만들고, 펼쳐 둔 줄이 있으면 그때 채운다
        tableBlobUrl(r.table).then(url => {
            item.table = url;
            const img = document.querySelector('.scan-item[data-seq="' + item.seq + '"] .scan-table-img');
            if (img) img.src = url;
        });
        return 'added';
    }

    // ── 화면 읽기 ─────────────────
    let lastJacketY = null;   // 직전에 찾은 선택 줄 자리 — 다음 읽기는 그 근처부터 찾는다
    async function readNow() {
        const g = await Hub.grab();
        if (!g) return { ok: false, reason: 'no-frame' };
        const r = Reader.read(g.frame, g.W, g.H, jackets(), lastJacketY);
        if (r.ok) lastJacketY = r.jacket.y;
        return r;
    }
    // 한 장만 읽는다 — 읽힌 값은 그대로 믿고, 못 읽은 프레임일 때만 조금 뒤 다시 받아 본다
    async function readFrame() {
        let r = await readNow();
        for (let i = 1; i < READ_TRIES && !r.ok && !state.stopAsked; i++) { await sleep(RETRY_GAP_MS); r = await readNow(); }
        return r;
    }

    // ── 스캔 루프 ─────────────────
    function setStatus(text, tone) {
        const el = $('scan-status');
        el.textContent = text;
        el.className = 'auto-status' + (tone ? ' ' + tone : '');
    }
    const baseTitle = document.title;
    const setTitle = (t) => { document.title = t ? t + ' · ' + baseTitle : baseTitle; };

    async function pressDown() {
        try { return await helperCall('/helper/key', { key: 'down', hold: opts.hold }); }
        catch (e) { return { ok: false, error: 'no-helper' }; }
    }

    function stopReason(k) {
        if (k.error === 'focus') return '게임 창이 맨 앞이 아니라 멈췄습니다' + (k.foreground ? ' (지금 맨 앞: ' + k.foreground + ')' : '');
        if (k.error === 'windows-only') return '도우미가 Windows가 아니라 키를 보낼 수 없습니다';
        if (k.error === 'sendinput') return '키 입력이 거부됐습니다 — 게임을 관리자 권한으로 켰다면 도우미 프로그램(또는 start.bat)도 관리자 권한으로 실행하세요';
        return '도우미 프로그램에 연결할 수 없어 멈췄습니다 — 트레이(시계 옆)에 도우미 아이콘이 있는지 확인하세요';
    }

    function readFailText(r) {
        if (r.reason === 'no-frame') return '게임 화면을 받지 못했습니다';
        if (r.reason === 'ratio') return '게임 화면 비율을 알 수 없습니다';
        if (r.reason === 'table') return '컬렉션 MUSIC DATA 화면이 아닌 것 같습니다 (기록 표가 안 보임)';
        return '컬렉션 MUSIC DATA 화면이 아닌 것 같습니다 (선택된 곡의 자켓을 못 찾음)';
    }

    async function runScan() {
        if (state.running) return;
        await checkHelper();
        if (!Hub.isRunning()) { setStatus('먼저 오른쪽 위 "게임 화면 연결"로 게임 화면을 공유하세요', 'warn'); return; }
        if (!dbReady()) { setStatus('곡 정보·자켓 해시를 아직 못 받았습니다 — 층수 측정기 탭의 상태를 확인하세요', 'warn'); return; }
        if (!state.helper) { setStatus(NO_HELPER + '. 스샷 파일로 읽기는 프로그램 없이도 됩니다', 'warn'); return; }
        if (!state.helper.windows) { setStatus('도우미가 Windows가 아니라 키를 보낼 수 없습니다', 'warn'); return; }

        state.running = true; state.stopAsked = false; renderButtons();
        const firstId = state.items.length ? state.items[0].id : null;
        let added = 0, read = 0, endNote = '';
        try {
            await Hub.setFrameRate(SCAN_FPS);
            for (let s = COUNTDOWN_S; s > 0; s--) {
                if (state.stopAsked) throw new Error('stop');
                setStatus(s + '초 안에 게임 창을 클릭하세요', 'live'); setTitle(s + '초');
                await sleep(1000);
            }
            let r = await readFrame();
            if (!r.ok) { endNote = readFailText(r); throw new Error('read'); }
            let prevId = r.id, same = 0;
            const scanFirst = firstId || r.id;
            if (await addReading(r) === 'added') added++;
            read++;
            while (!state.stopAsked) {
                setStatus('읽는 중 — ' + read + '곡 (새로 ' + added + ') · 멈추려면 브라우저를 클릭', 'live'); setTitle(read + '곡');
                const k = await pressDown();
                if (!k.ok) { endNote = stopReason(k); break; }
                await sleep(opts.delay);
                r = await readFrame();
                if (r.ok && r.id === prevId) {
                    // 화면이 늦게 바뀌는 중일 수 있다 — 조금 더 지켜본다
                    const until = performance.now() + LAG_WAIT_MS;
                    while (r.ok && r.id === prevId && performance.now() < until && !state.stopAsked) { await sleep(RETRY_GAP_MS); r = await readFrame(); }
                }
                if (!r.ok) { endNote = readFailText(r) + ' — 멈췄습니다'; break; }
                if (r.id === prevId) {
                    if (++same >= END_SAME) { endNote = '목록 끝'; break; }
                    continue;
                }
                same = 0;
                if (r.id === scanFirst && read > 1) { endNote = '목록 끝 (첫 곡으로 돌아옴)'; break; }
                prevId = r.id;
                if (await addReading(r) === 'added') added++;
                read++;
            }
            if (state.stopAsked && !endNote) endNote = '멈춤';
        } catch (e) {
            if (e.message === 'stop') endNote = '멈춤';
            else if (e.message !== 'read') { console.error('[Scan]', e); endNote = '오류로 멈췄습니다: ' + e.message; }
        } finally {
            await Hub.setFrameRate(IDLE_FPS);
            state.running = false; setTitle('');
            const done = /^목록 끝/.test(endNote);
            setStatus(endNote + ' — 이번에 ' + read + '곡 읽음, 새로 ' + added + '곡. 모두 ' + state.items.length + '곡' +
                (done ? '' : ' (다시 누르면 지금 곡부터 이어서 읽습니다)'), done ? 'hit' : 'warn');
            renderAll();
        }
    }

    // ── 스샷 파일 / 붙여넣기 ─────────────────
    async function readImages(files) {
        if (!dbReady()) { setStatus('곡 정보·자켓 해시를 아직 못 받았습니다 — 층수 측정기 탭의 상태를 확인하세요', 'warn'); return; }
        let added = 0, fail = 0, same = 0;
        for (const f of files) {
            let bmp = null;
            try {
                bmp = await createImageBitmap(f);
                // 창 테두리·21:9 여백이 있으면 게임 화면만 (실시간 공유와 같은 보정)
                const r0 = VMH.ScreenCapture.findGameRect(bmp, bmp.width, bmp.height);
                const src = r0 && !VMH.ScreenCapture.isFullRect(r0, bmp.width, bmp.height) ? VMH.ImgHash.cropToCanvas(bmp, r0.x, r0.y, r0.w, r0.h) : bmp;
                const r = Reader.read(src, src.width, src.height, jackets());
                if (!r.ok) { fail++; continue; }
                (await addReading(r)) === 'added' ? added++ : same++;
            } catch (e) { console.error('[Scan] image', e); fail++; }
            finally { if (bmp) bmp.close(); }
        }
        setStatus('스샷 ' + files.length + '장: 새로 ' + added + '곡' + (same ? ', 이미 있음 ' + same : '') + (fail ? ', 못 읽음 ' + fail + ' (컬렉션 MUSIC DATA 화면이 아님)' : '') +
            ' · 모두 ' + state.items.length + '곡', fail ? 'warn' : 'hit');
        renderAll();
    }

    // ── 검토 목록 ─────────────────
    const filter = () => (document.querySelector('input[name="scan-filter"]:checked') || {}).value || 'check';

    // 도우미 상태 한 줄 (켜기·받기·다시 확인 단추 포함) — 방장 봇 탭도 같은 줄을 쓴다 (auto-host.js).
    // 단추는 data-act="helper-open" | "helper-retry"라, 그 줄을 담은 곳이 onHelperClick으로 넘긴다
    // need = 이 도우미가 어디에 필요한지 (탭마다 다르다)
    function helperHtml(need) {
        const h = state.helper;
        return h
            ? '도우미 연결됨' + (h.exe ? ' (프로그램)' : ' (start.bat)') + (h.windows ? '' : ' — Windows가 아니라 키 입력 불가')
            : state.lnaAsking ? '<span>브라우저 주소창 아래 권한 창에서 <b>"이 기기의 다른 앱 및 서비스에 액세스"</b>를 <b>허용</b>하세요 — 도우미 프로그램에 연결하는 데 필요합니다.</span>'
            : !state.helperChecked ? '도우미 확인 중…'
            : state.lnaDenied ? '<span>브라우저가 이 사이트의 <b>"이 기기의 다른 앱 및 서비스에 액세스"</b>를 막아 두어 도우미 프로그램에 연결할 수 없습니다 — ' +
              '주소창 왼쪽 <b>사이트 설정</b>에서 그 권한(로컬 네트워크 접근)을 <b>허용</b>으로 바꾸고 새로고침하세요. ' +
              '(프로그램이 아직 없으면 <a class="scan-helper-dl" href="' + HELPER_DOWNLOAD + '" download>도우미 프로그램 받기</a>)</span>'
            : state.launching ? '<span>도우미 프로그램을 켜는 중입니다 — 브라우저가 <b>"vmh-helper을(를) 여시겠습니까?"</b>를 물으면 <b>열기</b>를 누르세요. (다음부터 안 묻게 하려면 "항상 허용"을 같이 체크)</span>'
            : '<span>도우미 프로그램이 꺼져 있습니다 — ' +
              (IS_WIN ? '<button type="button" class="secondary scan-inline-btn" data-act="helper-open">도우미 켜기</button> ' : '') +
              '<a class="scan-helper-dl" href="' + HELPER_DOWNLOAD + '" download>도우미 프로그램 받기</a> (vmh-helper.exe, 설치 없음) ' +
              '<button type="button" class="secondary scan-inline-btn" data-act="helper-retry">다시 확인</button>' +
              '<br><small>' + (state.launchFailed
                ? '<b>프로그램이 뜨지 않았습니다.</b> 받은 뒤 <b>한 번은 직접 실행</b>해야 "도우미 켜기"가 동작합니다 — 그때 이 단추가 쓰는 주소가 등록됩니다. 그 뒤로는 여기서 켜면 됩니다. '
                : '') +
              need + ' 켜면 창 없이 트레이(시계 옆)에 아이콘만 생깁니다. 켰는데도 안 되면 주소창 왼쪽 사이트 설정에서 "이 기기의 다른 앱 및 서비스에 액세스"(로컬 네트워크 접근)가 허용인지 확인하세요.</small></span>';
    }
    function onHelperClick(e) {
        if (e.target.dataset.act === 'helper-retry') checkHelper();
        else if (e.target.dataset.act === 'helper-open') launchHelper();
    }
    const helperListeners = [];

    function renderChecks() {
        const ok = (b) => b ? '<span class="ok">●</span>' : '<span class="no">●</span>';
        const h = state.helper;
        helperListeners.forEach(cb => { try { cb(); } catch (e) { console.error('[Scan]', e); } });
        $('scan-checks').innerHTML = [
            ok(!!h) + helperHtml('곡 넘기기·업로드에 필요합니다.'),
            ok(Hub.isRunning()) + (Hub.isRunning() ? '게임 화면 연결됨' : '게임 화면이 연결되지 않았습니다 — 오른쪽 위 <b>게임 화면 연결</b>'),
            ok(dbReady()) + (dbReady() ? '곡 정보 ' + Object.keys(songDatabase).length + '곡 · 자켓 ' + jackets().length + '개' : '곡 정보·자켓 해시를 받는 중 (층수 측정기 탭 상태 참고)'),
            ok(!!opts.dj) + (opts.dj ? 'DJ 이름: ' + esc(opts.dj) : 'DJ 이름이 없습니다 — <b>옵션 탭</b>에서 넣으세요 (서버 기록 비교에 필요)')
        ].map(s => '<li>' + s + '</li>').join('');
    }

    function renderButtons() {
        $('scan-start-btn').disabled = state.running;
        $('scan-start-btn').textContent = state.items.length ? '▶ 이어서 스캔' : '▶ 스캔 시작';
        $('scan-stop-btn').disabled = !state.running;
        $('scan-clear-btn').disabled = state.running || !state.items.length;
        $('scan-files').disabled = state.running;
    }

    function renderList() {
        const f = filter(), items = state.items;
        const checkN = items.filter(needsCheck).length, inc = items.filter(it => it.include).length;
        $('scan-count').textContent = items.length ? '— ' + items.length + '곡 · 확인 필요 ' + checkN + ' · 올릴 대상 ' + inc : '';
        const shown = f === 'all' ? items : items.filter(needsCheck);
        const list = $('scan-list');
        if (!items.length) { list.innerHTML = '<p class="scan-empty">아직 읽은 곡이 없습니다.</p>'; return; }
        if (!shown.length) { list.innerHTML = '<p class="scan-empty">확인이 필요한 곡이 없습니다. 전체를 보려면 위에서 <b>전체</b>를 고르세요.</p>'; return; }
        list.innerHTML = shown.map(itemHtml).join('');
    }

    function itemHtml(item) {
        const s = songOf(item.id), reasons = itemReasons(item), check = needsCheck(item);
        const recN = item.cells.filter(c => c.score !== null).length;
        const badges = item.edited ? '<span class="tag scan-tag-edit">고침</span>'
            : reasons.length ? reasons.map(r => '<span class="tag scan-tag-warn">' + esc(r) + '</span>').join('')
            : '<span class="tag scan-tag-ok">확실</span>';
        return '<div class="scan-item' + (check ? ' need' : '') + '" data-seq="' + item.seq + '">' +
            '<label class="scan-inc" title="올릴 대상에 넣기"><input type="checkbox" data-act="include"' + (item.include ? ' checked' : '') + '></label>' +
            '<img class="scan-thumb" src="' + item.thumb + '" alt="" title="찍힌 자켓">' +
            '<img class="scan-jacket" src="' + esc(jacketUrl(item.id)) + '" alt="" title="맞춘 곡의 자켓" loading="lazy">' +
            '<div class="scan-info"><div class="scan-name">' + esc(s ? s.name : '곡 id ' + item.id) + '</div>' +
            '<div class="scan-sub">' + esc(s ? s.composer || '' : '') + ' · 기록 ' + recN + '칸 · 자켓 거리 ' + item.jd.toFixed(1) + '</div>' +
            '<div class="scan-badges">' + badges + '</div></div>' +
            '<button class="secondary scan-more" data-act="more">자세히</button>' +
            '<div class="scan-detail" hidden></div></div>';
    }

    function detailHtml(item) {
        const byKey = {};
        item.cells.forEach(c => { byKey[c.button + c.pattern] = c; });
        let grid = '<div class="scan-grid"><span></span>' + Reader.BUTTONS.map(b => '<b>' + b + 'B</b>').join('');
        Reader.PATTERNS.forEach(p => {
            grid += '<b>' + p + '</b>';
            Reader.BUTTONS.forEach(b => {
                const c = byKey[b + p];
                if (!c) { grid += '<span class="scan-cell empty">-</span>'; return; }
                grid += '<span class="scan-cell' + (c.flags.length ? ' flag' : '') + '">' +
                    '<input type="text" inputmode="numeric" data-act="score" data-cell="' + b + p + '" value="' + (c.score === null ? '' : c.score) + '">' +
                    '<label><input type="checkbox" data-act="max" data-cell="' + b + p + '"' + (c.max ? ' checked' : '') + '>MAX</label>' +
                    '<small>' + (c.rate !== undefined && c.score !== null ? c.rate.toFixed(2) + '%' : '') + '</small></span>';
            });
        });
        grid += '</div>';
        return '<img class="scan-table-img"' + (item.table ? ' src="' + item.table + '"' : '') + ' alt="찍힌 화면">' + grid +
            '<div class="row scan-song-row"><input type="text" list="scan-song-options" data-act="song" placeholder="곡 바꾸기: 제목을 입력해 고르세요">' +
            '<button class="secondary" data-act="confirm">' + (item.checked ? '확인 취소' : '확인했음') + '</button></div>';
    }

    function renderAll() { renderChecks(); renderButtons(); renderList(); renderDiff(); }

    function itemBySeq(el) {
        const box = el.closest('.scan-item');
        return box ? state.items.find(it => it.seq === Number(box.dataset.seq)) : null;
    }

    // 한 곡의 줄만 다시 그린다 (펼친 상태는 유지)
    function refreshItem(item, keepOpen) {
        const old = document.querySelector('.scan-item[data-seq="' + item.seq + '"]');
        if (!old) return;
        const tmp = document.createElement('div'); tmp.innerHTML = itemHtml(item);
        const box = tmp.firstChild;
        if (keepOpen) { const d = box.querySelector('.scan-detail'); d.innerHTML = detailHtml(item); d.hidden = false; box.querySelector('[data-act="more"]').textContent = '접기'; }
        old.replaceWith(box);
        const items = state.items;
        $('scan-count').textContent = '— ' + items.length + '곡 · 확인 필요 ' + items.filter(needsCheck).length + ' · 올릴 대상 ' + items.filter(it => it.include).length;
        renderDiff();
    }

    let songOptionMap = null;
    function fillSongOptions() {
        if (songOptionMap || !dbReady()) return;
        songOptionMap = new Map();
        const opts2 = Object.values(songDatabase).map(s => {
            const label = s.name + ' — ' + (s.composer || '');
            songOptionMap.set(label, String(s.title));
            return '<option value="' + esc(label) + '"></option>';
        });
        $('scan-song-options').innerHTML = opts2.join('');
    }

    function onListClick(e) {
        const act = e.target.dataset.act, item = itemBySeq(e.target);
        if (!item) return;
        if (act === 'more') {
            const d = e.target.closest('.scan-item').querySelector('.scan-detail');
            if (d.hidden) { fillSongOptions(); d.innerHTML = detailHtml(item); }
            d.hidden = !d.hidden;
            e.target.textContent = d.hidden ? '자세히' : '접기';
        } else if (act === 'confirm') {
            item.checked = !item.checked; item.include = item.checked || !needsCheck(item);
            refreshItem(item, true);
        }
    }

    function onListChange(e) {
        const act = e.target.dataset.act, item = itemBySeq(e.target);
        if (!item) return;
        if (act === 'include') {
            item.include = e.target.checked;
            if (item.include && needsCheck(item)) item.checked = true;   // 체크한 것 자체가 확인했다는 뜻
            refreshItem(item, !e.target.closest('.scan-item').querySelector('.scan-detail').hidden);
        } else if (act === 'score' || act === 'max') {
            const c = item.cells.find(x => x.button + x.pattern === e.target.dataset.cell);
            if (!c) return;
            if (act === 'score') {
                const v = e.target.value.replace(/\D/g, '');
                const n = v === '' ? null : parseInt(v, 10);
                if (n !== null && (n > 1000000)) { e.target.value = c.score === null ? '' : c.score; return; }
                c.score = n; c.rate = n === null ? undefined : Reader.rateOf(n);
            } else c.max = e.target.checked;
            c.flags = [];
            item.edited = true; item.include = true;
            refreshItem(item, true);
        } else if (act === 'song') {
            const id = songOptionMap && songOptionMap.get(e.target.value);
            if (!id) return;
            item.id = id; item.edited = true; item.include = true;
            // 바꾼 곡이 다른 줄과 겹치면 그 줄도 다시 보게 한다
            const others = state.items.filter(it => it !== item && it.id === id);
            item.dup = others.length > 0;
            others.forEach(it => { it.dup = true; it.include = it.edited || it.checked; });
            renderList();
            renderDiff();
        }
    }

    // ── 서버 기록 비교 ─────────────────
    async function loadServer() {
        const dj = opts.dj;
        if (!dj) { $('scan-compare-note').innerHTML = '<b>옵션 탭</b>에서 DJ 이름을 먼저 넣으세요'; return false; }
        $('scan-compare-note').textContent = '서버 기록을 받는 중…';
        const map = new Map();
        try {
            for (const b of Reader.BUTTONS) {
                const res = await fetch('https://v-archive.net/api/v2/archive/' + encodeURIComponent(dj) + '/button/' + b, { cache: 'no-store' });
                const data = await res.json().catch(() => null);
                if (!res.ok || !data || data.success === false) throw new Error((data && data.message) || ('HTTP ' + res.status));
                (data.records || []).forEach(r => {
                    const p = PAT_SHORT[String(r.pattern).toUpperCase()];
                    if (!p) return;
                    map.set(r.title + '|' + b + '|' + p, { rate: Number(r.score) || 0, max: !!r.maxCombo });
                });
            }
        } catch (e) {
            $('scan-compare-note').textContent = '서버 기록을 못 받았습니다: ' + e.message + ' (DJ 이름을 확인하세요)';
            return false;
        }
        state.server = map; state.serverDj = dj; state.results.clear();
        return true;
    }

    // 체크된 곡의 칸 가운데 서버보다 좋아진 것
    function diffRows() {
        const up = [], lower = [];
        if (!state.server) return { up, lower };
        state.items.filter(it => it.include && songOf(it.id)).forEach(item => {
            item.cells.forEach(c => {
                if (c.score === null || c.rate === undefined) return;
                const key = cellKeyOf(item, c), old = state.server.get(key);
                const max = c.max || c.rate >= 100;
                const row = { key, item, cell: c, rate: c.rate, max, old };
                if (!old || c.rate > old.rate + 1e-6 || (Math.abs(c.rate - old.rate) < 1e-6 && max && !old.max)) up.push(row);
                else if (c.rate < old.rate - 1e-6 || (!max && old.max && Math.abs(c.rate - old.rate) < 1e-6)) lower.push(row);
            });
        });
        return { up, lower };
    }

    const fmtRec = (rate, max) => rate.toFixed(2) + '%' + (max ? ' <span class="scan-max">MAX</span>' : '');

    function renderDiff() {
        const box = $('scan-diff');
        if (!state.server) { box.innerHTML = ''; updateUploadBtn([]); return; }
        const { up, lower } = diffRows();
        $('scan-compare-note').textContent = state.serverDj + ' 기록과 비교 — 올라간 칸 ' + up.length + '개' + (lower.length ? ' · 서버보다 낮게 읽힌 칸 ' + lower.length + '개' : '');
        const rowHtml = (r, selectable) => {
            const s = songOf(r.item.id), res = state.results.get(r.key);
            return '<tr data-key="' + esc(r.key) + '">' +
                (selectable ? '<td><input type="checkbox" data-act="pick"' + (state.skip.has(r.key) ? '' : ' checked') + (res && res.ok ? ' disabled' : '') + '></td>' : '<td></td>') +
                '<td>' + esc(s.name) + '</td><td>' + r.cell.button + 'B</td><td>' + r.cell.pattern + '</td>' +
                '<td>' + (r.old ? fmtRec(r.old.rate, r.old.max) : '<span class="scan-dim">없음</span>') + '</td>' +
                '<td>' + fmtRec(r.rate, r.max) + '</td>' +
                '<td class="scan-res' + (res ? (res.ok ? ' ok' : ' fail') : '') + '">' + (res ? esc(res.text) : '') + '</td></tr>';
        };
        const head = (selectable) => '<thead><tr><th>' + (selectable ? '<input type="checkbox" data-act="pick-all" title="모두 선택/해제">' : '') +
            '</th><th>곡</th><th>버튼</th><th>난이도</th><th>서버</th><th>읽은 기록</th><th>결과</th></tr></thead>';
        let html = up.length
            ? '<table class="scan-diff-table">' + head(true) + '<tbody>' + up.map(r => rowHtml(r, true)).join('') + '</tbody></table>'
            : '<p class="scan-empty">서버보다 좋아진 칸이 없습니다.</p>';
        if (lower.length) {
            html += '<details class="scan-lower"><summary>서버 기록보다 낮게 읽힌 칸 ' + lower.length + '개 — 오인식일 수 있으니 해당 곡을 확인해 보세요 (올리지 않습니다)</summary>' +
                '<table class="scan-diff-table">' + head(false) + '<tbody>' + lower.map(r => rowHtml(r, false)).join('') + '</tbody></table></details>';
        }
        box.innerHTML = html;
        updateUploadBtn(up);
    }

    function pickedRows(up) { return up.filter(r => !state.skip.has(r.key) && !(state.results.get(r.key) || {}).ok); }

    function updateUploadBtn(up) {
        const n = pickedRows(up).length, btn = $('scan-upload-btn');
        btn.textContent = '선택한 기록 올리기' + (n ? ' (' + n + ')' : '');
        btn.disabled = state.uploading || !n || !state.account;
    }

    function onDiffChange(e) {
        const act = e.target.dataset.act;
        if (act === 'pick') {
            const key = e.target.closest('tr').dataset.key;
            if (e.target.checked) state.skip.delete(key); else state.skip.add(key);
            updateUploadBtn(diffRows().up);
        } else if (act === 'pick-all') {
            const { up } = diffRows();
            up.forEach(r => { if (e.target.checked) state.skip.delete(r.key); else state.skip.add(r.key); });
            renderDiff();
        }
    }

    // ── 업로드 ─────────────────
    // 계정 파일은 옵션 탭에서 고른다. '기억해 두기'를 켰을 때만 LocalStorage에 남긴다 (끄면 바로 지운다)
    const ACCOUNT_KEY = 'scanAccountV1';
    const parseAccount = (text) => {
        const m = String(text || '').split(/\r?\n/)[0].trim().match(/^(\d+)\s+([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$/);
        return m ? { userNo: Number(m[1]), token: m[2] } : null;
    };
    const remembered = () => { try { return localStorage.getItem(ACCOUNT_KEY); } catch { return null; } };
    function storeAccount() {
        try {
            if ($('scan-account-remember').checked && state.account) localStorage.setItem(ACCOUNT_KEY, state.account.userNo + ' ' + state.account.token);
            else localStorage.removeItem(ACCOUNT_KEY);
        } catch { /* 이번 세션에만 */ }
    }
    function renderAccount(msg) {
        const a = state.account;
        $('scan-account-note').textContent = msg || (a ? '계정 번호 ' + a.userNo + ($('scan-account-remember').checked ? ' — 이 브라우저에 기억함' : ' — 페이지를 닫으면 잊습니다') : '고른 파일이 없습니다');
        $('scan-account-clear').hidden = !a;
        $('scan-account-state').innerHTML = a ? '계정 번호 ' + a.userNo + ' (옵션 탭)' : '올리려면 <b>옵션 탭</b>에서 account.txt를 고르세요';
        updateUploadBtn(diffRows().up);
    }
    function readAccount(file) {
        const reader = new FileReader();
        reader.onload = () => {
            const a = parseAccount(reader.result);
            if (!a) { renderAccount('계정 파일 형식이 아닙니다 (첫 줄: 번호 토큰)' + (state.account ? ' — 먼저 고른 계정 ' + state.account.userNo + '을 그대로 씁니다' : '')); return; }
            state.account = a; storeAccount(); renderAccount();
        };
        reader.readAsText(file);
    }
    function bindAccount() {
        const saved = remembered();
        $('scan-account-remember').checked = !!saved;
        if (saved) state.account = parseAccount(saved);
        $('scan-account-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) readAccount(f); });
        $('scan-account-remember').addEventListener('change', () => { storeAccount(); renderAccount(); });
        $('scan-account-clear').addEventListener('click', () => { state.account = null; storeAccount(); renderAccount(); });
        renderAccount();
    }

    async function upload() {
        if (state.uploading || !state.account) return;
        await checkHelper();
        const st = $('scan-upload-status'); st.hidden = false;
        if (!state.helper) { st.className = 'auto-status warn'; st.textContent = '업로드는 도우미 프로그램이 대신 보냅니다 — ' + NO_HELPER; return; }
        const rows = pickedRows(diffRows().up);
        if (!rows.length) return;
        state.uploading = true; updateUploadBtn([]);
        let ok = 0, fail = 0, same = 0;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i], s = songOf(r.item.id);
            st.className = 'auto-status live'; st.textContent = '올리는 중 ' + (i + 1) + ' / ' + rows.length + ' — ' + s.name + ' ' + r.cell.button + 'B ' + r.cell.pattern;
            const record = { name: s.name, button: r.cell.button, pattern: PAT_FULL[r.cell.pattern], score: r.rate, maxCombo: r.max ? 1 : 0 };
            if (isDupName(s.name)) record.composer = s.composer;
            let res;
            try { res = await helperCall('/helper/upload', { userNo: state.account.userNo, token: state.account.token, record }); }
            catch (e) { res = { ok: false, status: 0, body: '도우미 프로그램 연결 실패' }; }
            let body = null; try { body = JSON.parse(res.body); } catch { /* 글자 그대로 보여준다 */ }
            if (res.ok && body && body.success !== false) {
                const updated = body.update !== false;
                state.results.set(r.key, { ok: true, text: updated ? '갱신됨' : '변화 없음' });
                updated ? ok++ : same++;
            } else {
                state.results.set(r.key, { ok: false, text: '실패: ' + ((body && body.message) || res.body || res.status) });
                fail++;
            }
            await sleep(UPLOAD_GAP_MS);
        }
        state.uploading = false;
        st.className = 'auto-status ' + (fail ? 'warn' : 'hit');
        st.textContent = '끝 — 갱신 ' + ok + (same ? ' · 변화 없음 ' + same : '') + (fail ? ' · 실패 ' + fail + ' (결과 칸 참고)' : '');
        // 올린 칸은 결과와 함께 목록에 남긴다(체크 칸은 잠김). 서버 기록과 비교를 다시 누르면 빠진다
        renderDiff();
    }

    // ── 연결 ─────────────────
    function init() {
        if (!$('scan-card')) return;
        bindOptions();
        $('scan-start-btn').addEventListener('click', runScan);
        $('scan-stop-btn').addEventListener('click', () => { state.stopAsked = true; });
        $('scan-clear-btn').addEventListener('click', () => {
            if (state.running || !state.items.length) return;
            if (!confirm('읽은 곡 ' + state.items.length + '개를 지울까요?')) return;
            state.items.forEach(it => { if (it.table) URL.revokeObjectURL(it.table); });
            state.items = []; state.results.clear(); state.skip.clear();
            setStatus('아직 읽은 곡이 없습니다', '');
            renderAll();
        });
        $('scan-files').addEventListener('change', (e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) readImages(fs); });
        document.querySelectorAll('input[name="scan-filter"]').forEach(r => r.addEventListener('change', renderList));
        $('scan-list').addEventListener('click', onListClick);
        $('scan-list').addEventListener('change', onListChange);
        $('scan-diff').addEventListener('change', onDiffChange);
        $('scan-compare-btn').addEventListener('click', async () => { if (await loadServer()) renderDiff(); });
        $('scan-checks').addEventListener('click', onHelperClick);
        $('scan-upload-btn').addEventListener('click', upload);
        $('scan-dj-input').addEventListener('change', () => { renderChecks(); if (state.server && state.serverDj !== opts.dj) { state.server = null; renderDiff(); $('scan-compare-note').textContent = 'DJ 이름이 바뀌었습니다 — 다시 비교하세요'; } });

        // 이 탭에서 Ctrl+V로 컬렉션 스샷을 붙여넣으면 읽는다 (다른 탭의 붙여넣기는 각자 자기 탭만 본다)
        window.addEventListener('paste', (e) => {
            if (VMH.Tabs.active !== 'scan' || state.running) return;
            if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
            const files = Array.from((e.clipboardData && e.clipboardData.items) || []).filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
            if (files.length) { e.preventDefault(); readImages(files); }
        });
        VMH.Tabs.onChange((tab) => { if (tab === 'scan') { checkHelper(); renderAll(); } });
        Hub.onChange(renderChecks);
        // 올리지 않은 결과가 있으면 새로고침·닫기 전에 한 번 묻는다
        window.addEventListener('beforeunload', (e) => {
            if (state.running || (state.items.length && !state.results.size)) { e.preventDefault(); e.returnValue = ''; }
        });
        // 웹에서는 127.0.0.1을 부르는 순간 브라우저가 "로컬 네트워크 접근"을 물을 수 있다 — 매칭만 쓰는 사람에게 묻지 않게
        // 이 탭을 열었을 때만 확인한다. 프로그램을 켜고 브라우저로 돌아오면(focus) 다시 확인한다
        window.addEventListener('focus', () => { if (VMH.Tabs.active === 'scan' && !state.helper && !state.running && !state.launching) checkHelper(); });
        if (sameOriginHelper || VMH.Tabs.active === 'scan') checkHelper();
        bindAccount();
        renderAll();
        // 곡 정보·자켓 해시는 층수 측정기가 페이지를 연 뒤에 받는다 — 다 받으면 상태 줄을 다시 그린다
        if (!dbReady()) { const t = setInterval(() => { if (dbReady()) { clearInterval(t); renderChecks(); } }, 1000); }
    }

    init();
    global.VMH = global.VMH || {};
    // helperCall·checkHelper는 자동 방장 봇(auto-host.js)도 쓴다 — 도우미 주소를 두 곳에서 따로 두드리면
    // 브라우저가 로컬 접근 권한을 또 묻는다
    // helperHtml·onHelperClick·onHelper는 방장 봇 탭의 도우미 줄 (도우미 상태가 바뀌면 onHelper로 알린다)
    global.VMH.Scan = { state, readImages, readNow, helperCall, checkHelper,
                        helperHtml, onHelperClick, onHelper: (cb) => helperListeners.push(cb) };
})(window);
