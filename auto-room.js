/* 게임 화면 자동 인식 — 화면 공유 하나로 입·퇴장과 대진을 방에 그대로 반영한다.
   script.js 다음에 읽혀야 한다 (room / addPlayer / recordMatch / refreshUI 를 쓴다).

   흐름:
     로비 화면       → 8칸 명패를 읽어 지금 방에 누가 있는지 맞춘다 → 입·퇴장 반영
     라운드 화면     → 대결이 성사된 것 — 맞붙은 두 명을 명패로 가려 매치 한 판 기록
     결과 화면       → 같은 판이면 넘어가고, 라운드 화면을 놓쳤으면 여기서 기록
     한 판은 로비로 돌아와야 끝난다 (라운드 → 플레이 → 다음 라운드 → 결과 사이엔 다시 기록하지 않는다)

   사람은 닉네임이 아니라 명패로 구분한다. 자세한 근거는 lib/djmax-room.js 주석 참고.
   원디골(누가 상대를 지목했는지)은 게임 화면에 나오지 않는다. 그래서 자동 기록할 때는
   둘 중 우선순위가 높은 쪽(= 지목할 차례였던 쪽)을 원디골로 둔다. 다르면 로그에서 바꾸면 된다. */
(function () {
    'use strict';

    const Hub = window.VMH.CaptureHub;
    const Room = window.VMH.Room;

    const ROSTER_STABLE_TICKS = 3;   // 로비 명단이 이만큼 연속으로 같아야 반영 (화면 전환 중 오인식 방지)
    const PAIR_STABLE_TICKS = 2;     // 라운드·결과 화면도 등장 연출 중에 읽히면 어긋나므로 두 번 확인
    const MATCH_CLEAR_TICKS = 4;     // 로비가 이만큼 보여야 판이 끝난 것으로 보고 다음 판을 받는다
    const ACTIVITY_MAX = 12;

    const state = {
        rosterKey: null, rosterCount: 0,     // 연속으로 같은 명단이 보인 횟수
        pairPrev: null, pairCount: 0,        // 직전 라운드·결과 화면의 두 명패 / 연속으로 같은 두 명이 보인 횟수
        matchLocked: false, lobbyCount: 0,   // 이번 판을 이미 기록했다 — 로비로 돌아와야 풀린다
        pairFailed: false,                   // 이 화면에서 누구인지 못 가렸다고 이미 알렸다
        lastPair: null,                      // 가장 최근 로비에서 본 PLAYER 1·2 (명패를 못 읽었을 때의 대비책)
        activity: []
    };

    /* ── 명패 장부 ─────────────────
       사람마다 id를 하나 붙여두고 명패 지문을 보관한다. 나갔다 들어와도 같은 id로 돌아오므로
       playerHistory(전적)가 자동으로 이어진다. */
    function book() {
        if (!room.plateBook) room.plateBook = {};
        if (typeof room.autoSeq !== 'number') room.autoSeq = 0;
        return room.plateBook;
    }

    function bookEntries() {
        const b = book();
        return Object.keys(b).map(id => ({ id, fp: b[id].fp, thumb: b[id].thumb }));
    }

    /* 명패 지문 → 이미 아는 사람 id. 장부에 없거나 애매하면 null (장부를 건드리지 않는다).
       화면이 넘어가는 중의 프레임으로 장부가 더러워지지 않도록, 등록은 확정된 뒤에만 한다. */
    function lookupHit(plate) {
        if (!plate || plate.empty || plate.unknown) return null;
        const hit = Room.findMatch(plate.fp, bookEntries(), e => e.fp);
        return (hit && hit.match) ? hit : null;
    }

    function lookupId(plate) {
        const hit = lookupHit(plate);
        return hit ? hit.match.id : null;
    }

    /* 장부에 지금 상태(READY/평소)의 닉네임 모양이 없거나 다른 해상도에서 뜬 것 —
       확정된 지금 것을 넣어 둬야 다음부터 같은 상태끼리 엄격하게 비교된다 */
    function refreshName(plate, hit) {
        if (hit.refreshName) Room.mergeName(book()[hit.match.id].fp, plate.fp);
    }

    /* 아는 사람이면 그 id, 처음 보는 명패면 새 id를 만들어 장부에 올린다 */
    function resolveId(plate) {
        if (!plate || plate.empty || plate.unknown) return null;
        const b = book();
        const hit = lookupHit(plate);
        if (hit) {
            refreshName(plate, hit);
            return hit.match.id;
        }
        const id = '명패' + (++room.autoSeq);
        b[id] = { fp: plate.fp, thumb: plate.thumb() };
        return id;
    }

    /* ── 화면 처리 ───────────────── */

    /* READY를 켜고 끈 사람 잇기.
       밝은 배경 그림 위 흰 글자는 그림 부스러기가 섞여, READY(주황이 그림을 가림) 때 모양과 어긋날 수 있다.
       그러면 로비에선 "한 명이 빠지고 처음 보는 명패가 하나 생긴" 것처럼 보인다. 빠진 사람과 아바타가 같고
       그 사람의 장부에 지금 상태(READY/평소)의 닉네임 모양이 아직 없으면 — 한 사람씩 딱 맞을 때만 — 같은 사람으로 잇는다.
       → Map(명패 → id) */
    function relinkStateChanges(unknownPlates, knownIds) {
        const b = book();
        const vanished = room.players
            .filter(p => p.auto && !knownIds.includes(p.nickname) && b[p.nickname])
            .map(p => p.nickname);
        const pick = new Map();
        for (const row of unknownPlates) {
            const st = row.fp.nameState;
            if (!st) continue;
            const c = vanished.filter(id => Room.fpAvatarSame(row.fp, b[id].fp) && !(b[id].fp.names || {})[st]);
            if (c.length === 1) pick.set(row, c[0]);
        }
        // 두 명패가 같은 사람을 고르면 어느 쪽도 잇지 않는다
        const claims = {};
        for (const id of pick.values()) claims[id] = (claims[id] || 0) + 1;
        const out = new Map();
        for (const [row, id] of pick) {
            if (claims[id] !== 1) continue;
            Room.mergeName(b[id].fp, row.fp);
            out.set(row, id);
        }
        return out;
    }

    /* 로비: 지금 보이는 8칸과 방 명단을 맞춘다 */
    function syncRoster(lobby) {
        const occupied = lobby.rows.filter(r => !r.empty && !r.unknown);
        const unreadable = lobby.rows.filter(r => !r.empty && r.unknown).length;

        // 같은 명단이 연속으로 보여야 반영한다. 아직 모르는 명패는 'new'로만 세어
        // (등록은 확정된 뒤에 하므로) 화면 전환 중 프레임이 장부에 끼어들지 않게 한다
        const knownIds = [], knownHits = [], unknownPlates = [];
        for (const row of occupied) {
            const hit = lookupHit(row);
            if (hit) { knownIds.push(hit.match.id); knownHits.push([row, hit]); } else unknownPlates.push(row);
        }
        const key = knownIds.slice().sort().join('|') + '/new:' + unknownPlates.length + '/x:' + unreadable;
        if (key !== state.rosterKey) { state.rosterKey = key; state.rosterCount = 1; return { pending: true }; }
        state.rosterCount++;
        if (state.rosterCount !== ROSTER_STABLE_TICKS) return { pending: true }; // 반영은 딱 한 번만

        // 여기서부터 확정 — 아는 사람의 닉네임 지문을 채우고, READY를 바꾼 사람을 잇고, 처음 보는 명패를 장부에 올린다
        for (const [row, hit] of knownHits) refreshName(row, hit);
        const relinked = relinkStateChanges(unknownPlates, knownIds);
        const seen = knownIds.concat(unknownPlates.map(row => relinked.get(row) || resolveId(row)).filter(Boolean));

        // PLAYER 1·2 자리를 기억해 둔다 (결과 화면에서 명패를 못 읽었을 때 쓴다)
        const p1 = lobby.pair[0], p2 = lobby.pair[1];
        if (p1 && !p1.empty && !p1.unknown && p2 && !p2.empty && !p2.unknown) {
            const a = resolveId(p1), b = resolveId(p2);
            if (a && b && a !== b) state.lastPair = [a, b];
        }

        const present = new Set(seen);
        const autoNow = room.players.filter(p => p.auto);
        const leaving = autoNow.filter(p => !present.has(p.nickname));
        const joining = seen.filter(id => !room.players.some(p => p.nickname === id));
        if (!leaving.length && !joining.length) return { changed: false, unreadable };

        pushUndo();
        for (const p of leaving) {
            room.players = room.players.filter(x => x.nickname !== p.nickname);
            selected = selected.filter(x => x !== p.nickname);
            room.eventLog.push({ type: 'leave', round: room.round, nickname: p.nickname });
        }
        const added = [];
        for (const id of joining) {
            if (addPlayer(id, { auto: true, silent: true })) added.push(id);
        }
        refreshUI();
        return { changed: true, left: leaving.map(p => p.nickname), joined: added, unreadable };
    }

    function samePlate(p, q) {
        if (p.empty || q.empty) return p.empty === q.empty;
        if (p.unknown || q.unknown) return p.unknown === q.unknown;
        return Room.fpSame(p.fp, q.fp);
    }

    /* 라운드·결과 화면: 맞붙은 두 명을 가려 한 판 기록한다 */
    function syncPair(pair) {
        const left = pair.left, right = pair.right;
        // 직전 프레임과 같은 두 명패인지 — 영상은 프레임마다 픽셀 값이 조금씩 흔들리므로
        // 지문 숫자를 그대로 비교하면 영영 안 맞는다. 같은 사람 판정 기준으로 비교한다
        const prev = state.pairPrev;
        state.pairPrev = { left, right };
        if (!prev || !samePlate(prev.left, left) || !samePlate(prev.right, right)) { state.pairCount = 1; return { pending: true }; }
        state.pairCount++;
        if (state.pairCount < PAIR_STABLE_TICKS) return { pending: true };
        if (state.matchLocked) return { already: true };

        let a = resolveId(left), b = resolveId(right);

        // 명패를 못 읽었으면(기본 명패 등) 로비에서 본 PLAYER 1·2로 메운다
        if ((!a || !b) && state.lastPair) {
            const [p1, p2] = state.lastPair;
            if (!a && b) a = (b === p1) ? p2 : p1;
            else if (a && !b) b = (a === p1) ? p2 : p1;
            else if (!a && !b) { a = p1; b = p2; }
        }
        if (!a || !b || a === b) return { failed: true };

        // 원디골은 화면에 안 나온다 — 우선순위가 높은(지목할 차례였던) 쪽을 기본값으로 둔다.
        // 아직 방에 없는 사람이면(로비를 한 번도 못 본 경우) 명단에 먼저 올려야 점수를 낼 수 있다
        pushUndo();
        for (const id of [a, b]) {
            if (!room.players.some(p => p.nickname === id)) addPlayer(id, { auto: true, silent: true, force: true });
        }
        const pa = room.players.find(p => p.nickname === a), pb = room.players.find(p => p.nickname === b);
        if (!pa || !pb) { room = undoStack.pop(); return { failed: true }; }
        const [chooser, opponent] = calculateScore(pa).score >= calculateScore(pb).score ? [a, b] : [b, a];

        if (!recordMatch(chooser, opponent)) { room = undoStack.pop(); return { failed: true }; }
        state.matchLocked = true;
        state.lobbyCount = 0;
        refreshUI();
        return { recorded: true, chooser, opponent };
    }

    const areaNote = () => Hub.areaNote();

    function leavePairScreen() {
        state.pairPrev = null; state.pairCount = 0; state.pairFailed = false;
    }

    /* ── 프레임 한 장 ───────────────── */
    async function onFrame(frame, W, H) {
        if (Room.isLobbyScreen(frame, W, H)) {
            leavePairScreen();
            if (state.matchLocked && ++state.lobbyCount >= MATCH_CLEAR_TICKS) state.matchLocked = false;

            const r = syncRoster(Room.readLobby(frame, W, H));
            if (r.pending) return;
            if (r.changed) {
                const bits = [];
                if (r.joined.length) bits.push('입장 ' + r.joined.length + '명');
                if (r.left.length) bits.push('퇴장 ' + r.left.length + '명');
                log(bits.join(' · '), 'hit');
            }
            const note = r.unreadable ? ` (기본 명패 ${r.unreadable}칸은 구분 불가)` : '';
            setStatus('● 로비 인식 중 — ' + room.players.filter(p => p.auto).length + '명' + note + areaNote(), 'live');
            return;
        }
        state.rosterKey = null; state.rosterCount = 0;
        state.lobbyCount = 0;

        const kind = Room.isResultScreen(frame, W, H) ? 'result' : Room.isRoundScreen(frame, W, H) ? 'round' : null;
        if (!kind) {
            leavePairScreen();
            setStatus('● 자동 인식 중 — ' + (state.matchLocked ? '대결 진행 중' : '로비/라운드/결과 화면 대기') + areaNote(), 'live');
            return;
        }

        const label = kind === 'round' ? '라운드 화면' : '결과 화면';
        const r = syncPair(kind === 'round' ? Room.readRound(frame, W, H) : Room.readResult(frame, W, H));
        if (r.recorded) {
            log('매치 기록 — 라운드 ' + room.round + ' (' + label + ')', 'hit');
            setStatus('● 매치 기록됨 (라운드 ' + room.round + ')', 'hit');
        } else if (r.already) {
            setStatus('● ' + label + ' — 이번 판은 기록됨 (라운드 ' + room.round + ')' + areaNote(), 'live');
        } else if (r.failed && !state.pairFailed) {
            state.pairFailed = true;
            log(label + '을 읽었지만 누구인지 못 가렸습니다', 'warn');
            setStatus('● ' + label + ' — 대상을 못 가림', 'warn');
        }
    }

    /* ── 화면에 상태 보여주기 ───────────────── */
    const $ = (id) => document.getElementById(id);

    function setStatus(text, tone) {
        const el = $('auto-status');
        if (!el) return;
        el.textContent = text;
        el.className = 'auto-status ' + (tone || 'idle');
    }

    function log(text, tone) {
        state.activity.unshift({ text, tone, at: new Date() });
        if (state.activity.length > ACTIVITY_MAX) state.activity.length = ACTIVITY_MAX;
        const el = $('auto-activity');
        if (!el) return;
        el.innerHTML = state.activity.map(a =>
            `<div class="auto-act ${a.tone || ''}"><span class="auto-act-time">${a.at.toLocaleTimeString('ko-KR')}</span>${escapeHtml(a.text)}</div>`
        ).join('');
        const count = $('auto-log-count');
        if (count) count.textContent = state.activity.length ? ' (' + state.activity.length + ')' : '';
    }

    /* 인식 기록은 접어둔다 — 평소엔 상태 한 줄이면 충분하고, 뭘 읽었는지 궁금할 때만 펼친다.
       (기록 자체가 화면에만 남는 것이라 접힘 상태도 굳이 저장하지 않는다) */
    function initActivityToggle() {
        const head = $('auto-log-toggle'), body = $('auto-activity'), icon = $('auto-log-icon');
        if (!head || !body || !icon) return;
        const toggle = () => {
            const open = body.style.display === 'none';
            body.style.display = open ? 'flex' : 'none';
            icon.textContent = open ? '▲' : '▼';
            head.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
    }

    /* 화면 공유를 켜면 손으로 하는 입력을 잠근다 —
       자동 인식과 수동 입력이 같은 명단을 서로 다르게 건드리면 어긋나기 때문. */
    function applyLock(on) {
        document.body.classList.toggle('sharing', on);
        ['nickname-input', 'add-btn'].forEach(id => { const el = $(id); if (el) el.disabled = on; });
    }

    function onHubChange() {
        const on = Hub.isRunning();
        const btn = $('auto-capture-btn');
        if (btn) {
            btn.textContent = on ? '연결 해제' : '🎮 게임 화면 연결';
            btn.classList.toggle('danger', on);
            btn.classList.toggle('secondary', !on);
        }
        applyLock(on);
        if (!on) {
            Object.assign(state, { rosterKey: null, rosterCount: 0, pairPrev: null, pairCount: 0, matchLocked: false, pairFailed: false });
            setStatus('게임 화면을 연결하면 입·퇴장과 대진이 자동으로 기록됩니다', 'idle');
        } else {
            log('게임 화면 연결됨', 'hit');
        }
    }

    let inited = false;
    function init() {
        if (inited) return;
        inited = true;

        initActivityToggle();
        Hub.subscribe('room', onFrame);
        Hub.onChange(onHubChange);
        Hub.onStatus((text, tone) => { if (tone === 'warn') setStatus(text, 'warn'); });

        const btn = $('auto-capture-btn');
        if (btn) btn.onclick = () => Hub.toggle();
        if (!Hub.available() && btn) {
            btn.disabled = true;
            setStatus('이 주소에서는 화면 공유를 쓸 수 없습니다 — localhost나 https로 열어주세요', 'warn');
            return;
        }
        onHubChange();
    }

    document.addEventListener('DOMContentLoaded', init);
    if (document.readyState !== 'loading') init();

    // 콘솔에서 상태를 들여다보거나, 화면 공유 없이 스샷 한 장을 그대로 먹여볼 수 있게 열어둔다
    window.VMH.AutoRoom = { state, lookupId, resolveId, book, feed: onFrame };
})();
