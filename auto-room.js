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
    // 입·퇴장 딜레이 — 명패를 잠깐 잘못 읽으면 같은 사람이 퇴장→입장을 반복하므로, 한 사람씩 이만큼 연속으로 봐야 반영한다.
    // 로비 프레임 수 기준(500ms 간격). 퇴장이 더 길다 — READY를 바꾼 사람을 잇는 일(relink)이 입장 쪽에서 먼저 일어나야 한다
    const JOIN_DELAY_TICKS = 6;      // 3초 — 방에 없던 명패가 이만큼 연속으로 보여야 입장
    const LEAVE_DELAY_TICKS = 10;    // 5초 — 방에 있던 사람이 이만큼 연속으로 안 보여야 퇴장
    // 로비 칸 하나의 명패가 이만큼 연속으로 같은 모양이어야 믿는다(1초). READY를 켜고 끌 때 주황이 명패를 쓸고
    // 지나가는 동안 닉네임이 반쯤 가려지는데, 그 프레임이 장부에 그 사람 모양으로 들어가면 이후 멀쩡한 명패가 남이 된다
    const ROW_STABLE_TICKS = 3;
    // 그림이 움직이는 명패는 칸이 영영 '같은 모양'이 되지 않는다(sameReading이 그림을 본다) — 그러면 그 칸이
    // 통째로 빠져 안 보이는 사람이 되고 퇴장이 찍힌다. 아바타·상태가 이만큼 이어지면 안정된 것으로 친다.
    // READY를 켜고 끄는 중의 쓸기 프레임은 그 사이 상태가 뒤집히므로 여기 걸리지 않는다
    const ROW_ANIM_TICKS = 4;
    const ANIM_WINDOW = 5;           // 최근 이만큼의 로비 프레임 중
    const ANIM_HITS = 3;             // 이만큼에서 그림이 튀면 '움직이는 명패'로 본다
    const PAIR_STABLE_TICKS = 2;     // 라운드·결과 화면도 등장 연출 중에 읽히면 어긋나므로 두 번 확인
    const MATCH_CLEAR_TICKS = 4;     // 로비가 이만큼 보여야 판이 끝난 것으로 보고 다음 판을 받는다
    const LOBBY_TAB_TICKS = 2;       // 로비가 이만큼 연속으로 보이면 매칭 탭으로 넘긴다 (화면 자동 전환 옵션)
    // 로비가 아닌 화면이 이만큼(10초) 이어진 뒤에 로비가 보이면 '판이 끝나고 돌아온 것'으로 보고 알린다 (로비 복귀 알림 옵션).
    // 로비에 앉아 있는 동안 몇 프레임 잘못 읽히는 것과 가르는 값이다 — 곡 고르기·플레이는 언제나 이보다 훨씬 길다
    const NOTIFY_AWAY_TICKS = 20;
    // 자리(칸)로 이어 붙인 사람의 지금 모양을 장부에 넣기까지 기다리는 프레임 수 —
    // 한두 프레임 잘못 읽은 것으로 장부가 더러워지지 않게 한다
    const CARRY_MERGE_TICKS = 3;
    const ACTIVITY_MAX = 12;

    const state = {
        rosterKey: null, rosterCount: 0,     // 연속으로 같은 명단이 보인 횟수
        absent: {}, present: {}, newStreak: 0, // 입·퇴장 딜레이: id별 연속으로 안 보인/보인 로비 프레임 수, 처음 보는 명패가 연속으로 있던 수
        rows: [],                            // 로비 칸별 { last: 직전 프레임 명패, streak: 같은 모양이 이어진 수, avStreak: 아바타·상태만 같은 수, held: 마지막으로 안정됐던 명패 }
        rowArt: [],                          // 칸별 그림 이력 { win: 최근 그림들, hits: 최근 프레임의 튐 여부, animated: 움직이는 명패로 판명 }
        slots: [],                           // 직전 로비 프레임에서 칸마다 누가 있었는지 { id, fp } (자리로 사람을 잇는 데 쓴다)
        carryStreak: {},                     // id별 자리로 이어 붙인 프레임 수 (장부에 새 모양을 넣기 전 확인용)
        pairPrev: null, pairCount: 0,        // 직전 라운드·결과 화면의 두 명패 / 연속으로 같은 두 명이 보인 횟수
        pairArt: {},                         // 라운드·결과 화면 좌우의 그림 이력 (rowArt와 같은 것)
        matchLocked: false, lobbyCount: 0,   // 이번 판을 이미 기록했다 — 로비로 돌아와야 풀린다
        lobbyStreak: 0,                      // 로비가 연속으로 보인 횟수 (탭 자동 전환용)
        awayStreak: 0,                       // 로비가 아닌 화면이 이어진 횟수 (로비 복귀 알림용)
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

    /* 명패 지문 → 장부 조회 결과 그대로 ({ match } | { ambiguous, candidates } | null). 장부를 건드리지 않는다.
       화면이 넘어가는 중의 프레임으로 장부가 더러워지지 않도록, 등록은 확정된 뒤에만 한다.
       ids를 주면 그 사람들 안에서만 찾는다 (opts는 Room.findMatch로 넘어간다) */
    function lookupRaw(plate, ids, opts) {
        if (!plate || plate.empty || plate.unknown) return null;
        const entries = ids ? bookEntries().filter(e => ids.includes(e.id)) : bookEntries();
        return Room.findMatch(plate.fp, entries, e => e.fp, opts);
    }

    function lookupHit(plate) {
        const hit = lookupRaw(plate);
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

    /* 아는 사람이면 그 id, 처음 보는 명패면 새 id를 만들어 장부에 올린다.
       누구인지 엇비슷하면(아바타가 같은 사람이 둘 이상) 새로 만들지 않고 null — 만들면 같은 사람이 계속 불어난다 */
    function resolveId(plate) {
        if (!plate || plate.empty || plate.unknown) return null;
        const b = book();
        const hit = lookupRaw(plate);
        if (hit && hit.match) {
            refreshName(plate, hit);
            return hit.match.id;
        }
        if (hit && hit.ambiguous) return null;
        const id = '명패' + (++room.autoSeq);
        b[id] = { fp: Room.bookFp(plate.fp), thumb: plate.thumb() };
        return id;
    }

    /* ── 화면 처리 ───────────────── */

    /* 모양이 조금 달라진 사람 잇기 — 로비에선 "한 명이 빠지고 처음 보는 명패가 하나 생긴" 것처럼 보이는 경우.
       - READY를 켜고 끔: 밝은 배경 그림 위 흰 글자는 그림 부스러기가 섞여 READY(주황이 그림을 가림) 때 모양과 어긋난다
       - 칸이 바뀜: 같은 사람도 칸마다 글자가 1~2px 밀리고 획 두께가 달라진다 (PLAYER 1 칸이 특히)
       - READY를 한 번도 안 한 사람: 닉네임 폭을 몰라 뒤의 명패 그림까지 비교되는데, 그 그림이 프레임마다 흔들린다
       빠진 사람과 아바타가 같고, 명패 그림이 다르지 않고(둘 다 평소 명패를 봤을 때), 닉네임이 느슨하게 맞으면(Room.nameClose)
       — 한 사람씩 딱 맞을 때만 — 같은 사람으로 잇고,
       장부의 그 상태 모양을 지금 것으로 바꾼다.
       → Map(명패 → id) */
    function relinkStateChanges(unknownPlates, knownIds) {
        const b = book();
        const vanished = room.players
            .filter(p => p.auto && !knownIds.includes(p.nickname) && b[p.nickname])
            .map(p => p.nickname);
        const pick = new Map();
        for (const row of unknownPlates) {
            if (!row.fp.nameState) continue;
            // 이중 검증: 아바타가 같고, 명패 쪽(평소끼리면 그림도)이 맞아야 한다
            const c = vanished.filter(id => {
                const e = b[id].fp;
                return Room.fpCurrent(e) && Room.fpAvatarSame(row.fp, e) && !Room.fpArtDiffers(row.fp, e) && Room.nameClose(row.fp, e);
            });
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

    function sameReading(p, q) {
        if (p.empty || q.empty) return p.empty === q.empty;
        if (p.unknown || q.unknown) return p.unknown === q.unknown;
        return Room.sameReading(p.fp, q.fp);
    }

    const usableRow = (row) => !!row && !row.empty && !row.unknown && !!row.fp;

    /* 아바타와 상태만 같은가 — 움직이는 명패에서 '이 칸은 계속 같은 사람이다'를 보는 느슨한 기준 */
    function sameAvatarReading(p, q) {
        if (!usableRow(p) || !usableRow(q)) return false;
        return Room.fpAvatarSame(p.fp, q.fp) && p.fp.nameState === q.fp.nameState;
    }

    /* ── 칸별 그림 이력 ─────────────────
       명패 그림이 애니메이션이면 한 장씩 비교해 봐야 위상이 어긋나 매번 남이 된다(실측 최대 49.9).
       대신 그 칸에서 본 최근 그림들의 **색을 평균**내 지문에 붙여 둔다 — 평균은 애니메이션 내내 거의 안 변한다
       (실측 4장 평균: 동일인 최대 18.9 / 타인 최소 30.4). 아바타가 바뀌면(= 사람이 바뀌면) 버린다.
       READY 프레임은 그림이 주황에 덮이므로 평균에 넣지 않되, 쌓아 둔 것은 그대로 둔다. */
    function trackArt(kept, fp, prevFp) {
        // 쌓아 둔 것은 그 자리에 있던 아바타의 것이다 — 아바타가 바뀌면 사람이 바뀐 것이니 버린다
        let a = (kept && Room.fpAvatarSame(fp, kept.av)) ? kept : { win: [], hits: [], animated: false };
        a.av = fp;
        // 직전 프레임과 견줘 그림이 튀었나 — 같은 아바타·같은 상태일 때만 뜻이 있다
        if (prevFp && Room.fpAvatarSame(fp, prevFp) && fp.nameState === prevFp.nameState && fp.art && prevFp.art) {
            const d = Room.fpArtDist(fp, prevFp);
            a.hits.push(d !== null && d > Room.ART_DIFF_MIN);
            if (a.hits.length > ANIM_WINDOW) a.hits.shift();
            if (a.hits.filter(Boolean).length >= ANIM_HITS) a.animated = true;
        }
        if (fp.art) {
            a.win.push(fp.art);
            if (a.win.length > Room.ART_AVG_CAP) a.win.shift();
        }
        // READY 프레임에도 붙여 준다 — 그림은 가려졌지만 여기서 쌓은 색 평균은 그 사람 것이다
        if (a.win.length) {
            const avg = new Array(a.win[0].length).fill(0);
            for (const g of a.win) for (let k = 0; k < avg.length; k++) avg[k] += g[k] / a.win.length;
            fp.artAvg = avg.map(Math.round);
            fp.artN = a.win.length;
        }
        if (a.animated) fp.animated = true;
        return a;
    }

    function trackRowArt(i, row, prev) {
        if (!usableRow(row)) { state.rowArt[i] = null; return; }
        state.rowArt[i] = trackArt(state.rowArt[i], row.fp, usableRow(prev) ? prev.fp : null);
    }

    /* 칸마다 ROW_STABLE_TICKS 연속으로 같은 모양이 보였을 때의 명패만 쓰고, 그 사이엔 마지막으로 안정됐던 명패를 쓴다.
       움직이는 명패는 그 기준에 영영 못 드니, 아바타·상태가 ROW_ANIM_TICKS 이어지면 안정된 것으로 본다.
       한 번도 안정된 적 없는 칸은 null (연결 직후 잠깐) */
    function steadyRows(rows) {
        return rows.map((row, i) => {
            const s = state.rows[i];
            trackRowArt(i, row, s && s.last);
            const streak = s && sameReading(s.last, row) ? s.streak + 1 : 1;
            const avStreak = s && sameAvatarReading(s.last, row) ? s.avStreak + 1 : 1;
            const steady = streak >= ROW_STABLE_TICKS
                || (usableRow(row) && row.fp.animated && avStreak >= ROW_ANIM_TICKS);
            const held = steady ? row : s ? s.held : null;
            state.rows[i] = { last: row, streak, avStreak, held };
            // 이전 프레임에서 붙인 id가 남지 않게 복사해서 넘긴다
            return held && Object.assign({}, held, { id: undefined });
        });
    }

    /* ── 자리(칸)로 사람 잇기 ─────────────────
       로비는 칸이 8개뿐이고 프레임은 0.5초 간격이다. 그래서 "직전 프레임에 이 칸에 있던 사람"은
       명패 그림만큼이나 확실한 단서다 — 0.5초 사이에 한 사람이 나가고 다른 사람이 같은 칸에
       들어앉는 일은 없다시피 하다.

       명패 모양만으로는 끊기는 순간이 있다. READY를 켜면 명패가 통째로 주황으로 덮이고 닉네임
       글자가 검게 뒤집히는데, 밝은 그림 위에 흰 닉네임이 얹힌 사람은 평소 모양이 글자 대신 그림
       덩어리로 잡혀(noisy) READY 모양과 이어지지 않는다. 그러면 퇴장→입장이 한 번 찍힌다.

       그래서 아바타가 같고 칸이 같으면 일단 같은 사람으로 본다. 닉네임은 같은 상태(READY끼리 ·
       평소끼리)로 견줄 수 있을 때만 거부권을 갖는다 — 레디한 채로 사람이 바뀐 경우를 가른다.
       칸이 바뀌었으면 직전 프레임에 비어난 자리의 사람 중 아바타가 같은 한 명과 잇는다(자리 이동).

       그리고 배치 전체도 단서다. 로비 목록은 누가 빠지면 아래가 위로 당겨지므로, 다른 칸이 전부
       제자리라는 것은 아무도 나가지도 자리를 옮기지도 않았다는 뜻이다. 그런데도 못 이은 칸이 딱 하나,
       비어난 사람도 딱 하나, 게다가 같은 칸이라면 — 그 사람이 그대로 앉아 있는 것이다. 이때만 그림
       판정을 빼고 잇는다(3번). 움직이는 명패는 색 평균으로도 가끔 남으로 읽힐 수 있어서, 배치로 그걸
       보정하는 것이다. 아바타와 닉네임은 그대로 따진다 — 아바타 칸은 애니메이션에도 움직이지 않고,
       닉네임 거부권은 '레디한 채 사람이 바뀐 경우'를 막는다.

       이건 화면에 드러내지 않는다 — 사용자가 보는 결과는 그냥 '아무 일도 없었다'가 된다. */
    function slotSame(cur, prev, ignoreArt) {
        if (!cur || !prev || !Room.fpCurrent(prev) || !Room.fpAvatarSame(cur, prev)) return false;
        if (!ignoreArt && Room.fpArtDiffers(cur, prev)) return false;   // 둘 다 평소 명패인데 그림이 다르면 남
        const st = cur.nameState;
        // 같은 상태의 닉네임 모양이 양쪽에 있을 때만 닉네임을 따진다.
        // READY를 막 켰다/껐다면 모양이 통째로 달라진 것이라 여기서 따져봐야 틀린다
        if (st && prev.names && prev.names[st]) return Room.nameClose(cur, prev);
        return true;
    }

    /* 직전 프레임의 칸 정보로 이번 프레임의 칸을 잇는다 → Map(명패 → id).
       taken: 이미 다른 칸이 명패 모양으로 차지한 사람 (그 사람을 자리로 또 집지 않게) */
    function carryFromSlots(steady, taken) {
        const prev = state.slots || [];
        const carry = new Map();
        const used = new Set(taken);
        const held = new Array(prev.length).fill(false);
        const usable = (row) => row && !row.empty && !row.unknown && !row.id;

        // 1) 같은 칸 — 직전 프레임에 이 칸에 있던 사람
        steady.forEach((row, i) => {
            if (!usable(row)) { if (row && row.id && prev[i] && prev[i].id === row.id) held[i] = true; return; }
            const p = prev[i];
            if (p && !used.has(p.id) && slotSame(row.fp, p.fp)) {
                carry.set(row, p.id); used.add(p.id); held[i] = true;
            }
        });
        const inPlace = held.slice();   // 1)에서 제자리로 확인된 칸 (2)의 자리 이동과 구별해야 한다)

        // 2) 자리 이동 — 직전 프레임에 사람이 있었다가 비어난 칸 중 아바타가 맞는 한 명.
        //    둘 이상이면 어느 쪽도 잇지 않는다 (자리를 맞바꾼 두 사람을 뒤섞지 않게)
        steady.forEach((row, i) => {
            if (!usable(row) || carry.has(row)) return;
            const cands = [];
            prev.forEach((p, j) => {
                if (!p || held[j] || used.has(p.id) || !slotSame(row.fp, p.fp)) return;
                cands.push({ j, id: p.id });
            });
            if (cands.length === 1) { carry.set(row, cands[0].id); used.add(cands[0].id); held[cands[0].j] = true; }
        });

        // 3) 배치가 그대로면 남은 칸도 그 사람들이다 (위 주석 참고) — 움직이는 명패의 그림 판정을
        //    자리로 보정한다. 못 이은 칸과 아직 못 찾은 사람이 '같은 칸에서 하나씩' 맞아떨어질 때만.
        let quiet = true;
        const free = [];
        prev.forEach((p, j) => {
            if (!p || inPlace[j]) return;
            if (used.has(p.id)) { quiet = false; return; }   // 딴 칸에서 찾아냈다 = 배치가 바뀌었다
            free.push(j);
        });
        const left = [];
        steady.forEach((row, i) => { if (usable(row) && !carry.has(row)) left.push(i); });
        // 둘 다 칸 번호 순서라 하나씩 견주면 된다. 빈자리가 더 있거나(= 누가 나갔다) 처음 보는 칸이
        // 더 있으면(= 누가 들어왔다) 배치가 바뀐 것이니 이 단서는 쓰지 않는다
        if (quiet && free.length && free.length === left.length && free.every((j, k) => j === left[k])) {
            for (const i of left) {
                const row = steady[i], p = prev[i];
                if (slotSame(row.fp, p.fp, true)) { carry.set(row, p.id); used.add(p.id); held[i] = true; }
            }
        }
        return carry;
    }

    /* 이번 프레임의 칸 상태를 기억해 둔다 (다음 프레임의 자리 잇기용) */
    function rememberSlots(steady) {
        state.slots = steady.map(row =>
            row && !row.empty && !row.unknown && row.id ? { id: row.id, fp: row.fp } : null);
    }

    /* 자리로 이어 붙인 사람이 CARRY_MERGE_TICKS 동안 이어지면 지금 모양을 장부에 넣어 둔다 —
       다음 로비나 라운드·결과 화면에서 명패 모양만으로도 알아보게 */
    function mergeCarried(carried) {
        const b = book(), streak = {};
        for (const [row, id] of carried) {
            const n = (state.carryStreak[id] || 0) + 1;
            streak[id] = n;
            if (n === CARRY_MERGE_TICKS && b[id] && Room.fpCurrent(b[id].fp)) Room.mergeName(b[id].fp, row.fp);
        }
        state.carryStreak = streak;
    }

    /* 로비: 지금 보이는 8칸과 방 명단을 맞춘다 */
    function syncRoster(lobby) {
        const steady = steadyRows(lobby.rows);
        lobby = { rows: steady.filter(Boolean), pair: [steady[0], steady[1]] };
        const occupied = lobby.rows.filter(r => !r.empty && !r.unknown);
        const unreadable = lobby.rows.filter(r => !r.empty && r.unknown).length;

        // 같은 명단이 연속으로 보여야 반영한다. 아직 모르는 명패는 'new'로만 세어
        // (등록은 확정된 뒤에 하므로) 화면 전환 중 프레임이 장부에 끼어들지 않게 한다
        const knownIds = [], knownHits = [], unknownPlates = [], ambiguousRows = [];
        for (const row of occupied) {
            const hit = lookupRaw(row);
            if (hit && hit.match) { row.id = hit.match.id; knownIds.push(hit.match.id); knownHits.push([row, hit]); }
            else if (hit && hit.ambiguous) ambiguousRows.push([row, hit.candidates.map(c => c.id)]);
            else unknownPlates.push(row);
        }
        // 누구인지 엇비슷한 칸: 다른 칸이 이미 차지한 사람을 빼고 한 명만 남으면 그 사람이다
        for (const [row, ids] of ambiguousRows) {
            const left = ids.filter(id => !knownIds.includes(id));
            if (left.length === 1) { knownIds.push(left[0]); row.id = left[0]; }
        }

        // 명패 모양으로 못 가린 칸은 자리로 잇는다 — 직전 프레임에 그 칸(또는 비어난 칸)에 있던 사람.
        // 이어 붙인 사람은 '아는 사람'으로 쳐서 입·퇴장이 아예 일어나지 않게 한다
        const carry = carryFromSlots(steady, knownIds);
        const carried = [];
        const takeCarry = (row, only) => {
            const id = carry.get(row);
            if (!id || knownIds.includes(id) || (only && !only.includes(id))) return false;
            row.id = id; knownIds.push(id); carried.push([row, id]);
            return true;
        };
        for (let i = unknownPlates.length - 1; i >= 0; i--) {
            if (takeCarry(unknownPlates[i])) unknownPlates.splice(i, 1);
        }
        // 엇비슷한 칸은 후보 안에 있을 때만 (자리가 엉뚱한 사람을 끌어오지 않게)
        for (const [row, ids] of ambiguousRows) if (!row.id) takeCarry(row, ids);
        mergeCarried(carried);
        rememberSlots(steady);

        const stillAmbiguous = ambiguousRows.filter(([row]) => !row.id).length;

        // 입·퇴장 딜레이 카운터 — 명단이 흔들리는 프레임에서도 센다. 한 번이라도 보이면(엇비슷한 후보여도) 퇴장 카운트는 0으로
        const seenNow = new Set(knownIds);
        for (const [row, ids] of ambiguousRows) if (!row.id) ids.forEach(id => seenNow.add(id));
        const absent = {}, present = {};
        for (const p of room.players) {
            if (p.auto && !seenNow.has(p.nickname)) absent[p.nickname] = (state.absent[p.nickname] || 0) + 1;
        }
        for (const id of knownIds) {
            if (!room.players.some(p => p.nickname === id)) present[id] = (state.present[id] || 0) + 1;
        }
        state.absent = absent; state.present = present;
        state.newStreak = unknownPlates.length ? state.newStreak + 1 : 0;

        const key = knownIds.slice().sort().join('|') + '/new:' + unknownPlates.length + '/x:' + unreadable + '/a:' + stillAmbiguous;
        if (key !== state.rosterKey) { state.rosterKey = key; state.rosterCount = 1; return { pending: true }; }
        state.rosterCount++;
        if (state.rosterCount < ROSTER_STABLE_TICKS) return { pending: true };

        // 명단은 안정됐지만 딜레이가 덜 찬 입·퇴장이 있으면 다음 프레임에 다시 본다
        const first = state.rosterCount === ROSTER_STABLE_TICKS;
        const newDue = unknownPlates.length > 0 && state.newStreak >= JOIN_DELAY_TICKS;
        const due = newDue
            || Object.values(absent).some(n => n >= LEAVE_DELAY_TICKS)
            || Object.values(present).some(n => n >= JOIN_DELAY_TICKS);
        if (!first && !due) return { changed: false, unreadable, waiting: waitingCount(absent, present, unknownPlates.length) };

        // 여기서부터 확정 — 아는 사람의 닉네임 지문을 채우고, READY를 바꾼 사람을 잇고, 처음 보는 명패를 장부에 올린다.
        // 처음 보는 명패는 입장 딜레이가 찬 뒤에만 장부에 올린다 (잘못 읽은 명패가 유령으로 남지 않게)
        if (first) for (const [row, hit] of knownHits) refreshName(row, hit);
        if (newDue) {
            const relinked = relinkStateChanges(unknownPlates, knownIds);
            for (const row of unknownPlates) row.id = relinked.get(row) || resolveId(row);
            // 이어 붙인 사람은 이번 프레임에 보인 것으로 친다
            for (const id of relinked.values()) delete absent[id];
            rememberSlots(steady);   // 새로 올린 사람도 다음 프레임부터 자리로 이어진다
        }
        const seen = knownIds.concat(unknownPlates.map(row => row.id).filter(Boolean));

        // PLAYER 1·2 자리를 기억해 둔다 (라운드·결과 화면에서 누구인지 헷갈릴 때 쓴다)
        const a = lobby.pair[0] && lobby.pair[0].id, b = lobby.pair[1] && lobby.pair[1].id;
        if (a && b && a !== b) state.lastPair = [a, b];

        // 누구인지 못 가린 칸이 남아 있으면, 방에 있던 사람을 그 칸 때문에 내보내지 않는다
        if (stillAmbiguous) {
            const inRoom = (id) => room.players.some(p => p.nickname === id);
            for (const [row, ids] of ambiguousRows) {
                if (!row.id) ids.forEach(id => { if (inRoom(id) && !seen.includes(id)) seen.push(id); });
            }
        }

        const inView = new Set(seen);
        const autoNow = room.players.filter(p => p.auto);
        const leaving = autoNow.filter(p => !inView.has(p.nickname) && (absent[p.nickname] || 0) >= LEAVE_DELAY_TICKS);
        // 이번에 장부에 올린/이어 붙인 명패는 이미 딜레이를 채웠다 (newStreak)
        const fresh = new Set(unknownPlates.map(row => row.id).filter(Boolean));
        const joining = seen.filter(id => !room.players.some(p => p.nickname === id)
                                          && (fresh.has(id) || (present[id] || 0) >= JOIN_DELAY_TICKS));
        for (const p of leaving) delete state.absent[p.nickname];
        for (const id of joining) delete state.present[id];
        if (fresh.size) state.newStreak = 0;
        const waiting = waitingCount(state.absent, state.present, 0);
        if (!leaving.length && !joining.length) return { changed: false, unreadable, waiting };

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
        return { changed: true, left: leaving.map(p => p.nickname), joined: added, unreadable, waiting };
    }

    // 딜레이가 걸려 아직 반영 안 된 입·퇴장 수 (상태 표시용)
    function waitingCount(absent, present, unknown) {
        return Object.keys(absent).length + Object.keys(present).length + unknown;
    }

    function resetDelays() {
        state.absent = {}; state.present = {}; state.newStreak = 0; state.rows = []; state.rowArt = [];
        // 로비가 아닌 화면을 거치면 칸 배치가 바뀔 수 있다 — 자리 단서는 로비가 끈기지 않고 이어질 때만 쓴다
        state.slots = []; state.carryStreak = {};
    }

    function samePlate(p, q) {
        if (p.empty || q.empty) return p.empty === q.empty;
        if (p.unknown || q.unknown) return p.unknown === q.unknown;
        // 움직이는 명패는 프레임마다 그림도, 그림에 묻힌 닉네임 모양도 흔들린다 —
        // '두 프레임 연속 같은 두 사람인가'만 보면 되므로 아바타와 색 평균으로 본다
        if (p.fp.animated || q.fp.animated) return Room.fpAvatarSame(p.fp, q.fp) && !Room.fpArtDiffers(p.fp, q.fp);
        return Room.fpSame(p.fp, q.fp);
    }

    /* 라운드·결과 화면의 명패 → id.
       맞붙은 사람은 방금까지 로비에 있던 사람이다. 그래서 먼저 방 안에서만 느슨하게 찾는다 —
       로비에서 내내 READY였던 사람은 장부에 READY 모양밖에 없는데, 여기선 평소 명패로 나오기 때문이다.
       방 안에 아바타가 같은 사람이 둘이면 로비의 PLAYER 1·2 쪽을 고른다.
       여기선 새 사람을 장부에 올리지 않는다 — 방 안 사람을 못 알아본 것뿐인데 새로 만들면 한 사람이 둘로 쪼개진다
       (READY로만 봤던 사람이 평소 명패로 나와 새로 입장한 적 있음). 못 가리면 null → 로비의 PLAYER 1·2로 채운다 */
    function pairId(plate) {
        if (!plate || plate.empty || plate.unknown) return null;
        const inRoom = room.players.filter(p => p.auto).map(p => p.nickname);
        const hit = lookupRaw(plate, inRoom, { loose: true });
        if (hit && hit.match) { refreshName(plate, hit); return hit.match.id; }
        if (hit && hit.ambiguous) {
            const c = hit.candidates.map(x => x.id).filter(id => (state.lastPair || []).includes(id));
            return c.length === 1 ? c[0] : null;
        }
        return lookupId(plate);   // 방엔 없지만 장부에 확실히 있는 사람 (로비를 못 보고 연결한 경우)
    }

    /* 라운드·결과 화면: 맞붙은 두 명을 가려 한 판 기록한다 */
    function syncPair(pair) {
        const left = pair.left, right = pair.right;
        // 직전 프레임과 같은 두 명패인지 — 영상은 프레임마다 픽셀 값이 조금씩 흔들리므로
        // 지문 숫자를 그대로 비교하면 영영 안 맞는다. 같은 사람 판정 기준으로 비교한다
        const prev = state.pairPrev;
        // 라운드·결과 화면의 좌우도 로비 칸과 같은 자리다 — 그림 이력을 이어서 쌓는다
        // (움직이는 명패면 여기서도 그림이 프레임마다 튀어, 안 해두면 같은 두 명으로 확정되지 않아 한 판이 안 찍힌다)
        for (const side of ['left', 'right']) {
            const plate = side === 'left' ? left : right;
            if (!plate || plate.empty || plate.unknown || !plate.fp) { state.pairArt[side] = null; continue; }
            const before = prev && prev[side];
            state.pairArt[side] = trackArt(state.pairArt[side], plate.fp,
                (before && !before.empty && !before.unknown) ? before.fp : null);
        }
        state.pairPrev = { left, right };
        if (!prev || !samePlate(prev.left, left) || !samePlate(prev.right, right)) { state.pairCount = 1; return { pending: true }; }
        state.pairCount++;
        if (state.pairCount < PAIR_STABLE_TICKS) return { pending: true };
        if (state.matchLocked) return { already: true };

        let a = pairId(left), b = pairId(right);
        if (a && a === b) a = b = null;

        // 명패를 못 읽었으면(기본 명패, 누구인지 엇비슷함) 로비에서 본 PLAYER 1·2로 메운다.
        // 한쪽만 알면, 그 사람이 PLAYER 1·2 중 하나일 때만 나머지를 채운다
        if ((!a || !b) && state.lastPair) {
            const [p1, p2] = state.lastPair;
            const other = (id) => id === p1 ? p2 : id === p2 ? p1 : null;
            if (!a && b) a = other(b);
            else if (a && !b) b = other(a);
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
        state.pairPrev = null; state.pairCount = 0; state.pairFailed = false; state.pairArt = {};
    }

    /* ── 프레임 한 장 ───────────────── */
    async function onFrame(frame, W, H) {
        if (Room.isLobbyScreen(frame, W, H)) {
            leavePairScreen();
            if (++state.lobbyStreak >= LOBBY_TAB_TICKS) {
                window.VMH.Tabs.follow('match');
                // 판이 끝나고 돌아온 것이면 한 번만 알린다. 로비가 확실해진 뒤에 세기를 접으므로
                // 로비 한가운데의 오인식 한두 프레임으로 알림이 울리지는 않는다
                if (state.awayStreak >= NOTIFY_AWAY_TICKS && window.VMH.Notify.lobbyBack()) log('로비로 돌아옴 — 알림', 'hit');
                state.awayStreak = 0;
            }
            if (state.matchLocked && ++state.lobbyCount >= MATCH_CLEAR_TICKS) state.matchLocked = false;

            const r = syncRoster(Room.readLobby(frame, W, H));
            if (r.pending) return;
            if (r.changed) {
                const bits = [];
                if (r.joined.length) bits.push('입장 ' + r.joined.length + '명');
                if (r.left.length) bits.push('퇴장 ' + r.left.length + '명');
                log(bits.join(' · '), 'hit');
            }
            const note = (r.unreadable ? ` (기본 명패 ${r.unreadable}칸은 구분 불가)` : '')
                       + (r.waiting ? ` · 입·퇴장 확인 중 ${r.waiting}명` : '');
            setStatus('● 로비 인식 중 — ' + room.players.filter(p => p.auto).length + '명' + note + areaNote(), 'live');
            return;
        }
        state.rosterKey = null; state.rosterCount = 0;
        state.lobbyCount = 0; state.lobbyStreak = 0; state.awayStreak++;
        resetDelays();   // 로비가 아닌 화면에선 명단이 안 보인다 — 딜레이는 로비가 끊기지 않고 이어질 때만 센다

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

    /* 연결·해제, 그리고 옵션 탭에서 화면 공유를 줄 곳을 바꿨을 때 불린다.
       매칭 쪽이 프레임을 안 받으면(층수 측정기만 받음) 손 입력을 잠그지 않는다 — 명단을 건드리는 경로가 하나뿐이니까 */
    let wasReceiving = false;
    function onHubChange() {
        const running = Hub.isRunning(), on = Hub.receiving('room');
        const btn = $('auto-capture-btn');
        if (btn) {
            btn.textContent = running ? '연결 해제' : '🎮 게임 화면 연결';
            btn.classList.toggle('danger', running);
            btn.classList.toggle('secondary', !running);
        }
        applyLock(on);
        if (!running) window.VMH.Tabs.forgetScene();
        if (!on) {
            Object.assign(state, { rosterKey: null, rosterCount: 0, pairPrev: null, pairCount: 0, pairArt: {}, matchLocked: false, pairFailed: false, lobbyStreak: 0, awayStreak: 0 });
            resetDelays();
            setStatus(running ? '화면 공유를 층수 측정기에만 주는 중 — 옵션 탭에서 바꿀 수 있습니다'
                              : '게임 화면을 연결하면 입·퇴장과 대진이 자동으로 기록됩니다', 'idle');
        } else if (!wasReceiving) {
            log('게임 화면 연결됨', 'hit');
            setStatus('● 자동 인식 중 — 로비/라운드/결과 화면 대기' + areaNote(), 'live');
        }
        wasReceiving = on;
    }

    let inited = false;
    function init() {
        if (inited) return;
        inited = true;

        initActivityToggle();
        Hub.subscribe('room', onFrame);
        Hub.onChange(onHubChange);
        Hub.onStatus((text, tone) => { if (tone === 'warn' && Hub.isTarget('room')) setStatus(text, 'warn'); });

        // 옵션 탭: 화면 공유를 줄 곳 (둘 다 / 매칭 도우미만 / 층수 측정기만)
        document.querySelectorAll('input[name="capture-target"]').forEach(r => {
            r.checked = r.value === Hub.target;
            r.addEventListener('change', () => { if (r.checked) Hub.setTarget(r.value); });
        });

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
