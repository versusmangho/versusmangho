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
    const LV_STABLE_TICKS = 3;
    const BOUNCE_MS = 60000;         // 퇴장한 사람이 이 안에 다시 들어오면 의심 장면으로 남긴다       // 로비 칸의 레벨이 이만큼 같은 숫자로 이어져야 판정·장부에 쓴다
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
        backPending: false,                  // 판이 끝나고 로비로 돌아왔다 — 명단이 확정되면 자동 방장 봇에게 한 번 건넨다
        pairFailed: false,                   // 이 화면에서 누구인지 못 가렸다고 이미 알렸다
        lastPair: null,                      // 가장 최근 로비에서 본 PLAYER 1·2 (명패를 못 읽었을 때의 대비책)
        leftAt: {},                          // id별 마지막으로 퇴장이 찍힌 시각 (곧바로 돌아오면 의심 장면)
        mergeStreak: {},
        merges: [],                          // 이번 세션에 합친 [남은 id, 없어진 id] (확인용)
        takeover: {},                        // 칸별 { from: 앉아 있던 방 안 id, to: 지금 명패가 찾은 방 밖 id, n } (합치기 ②)                     // "새id>옛id"별 — 지금 명패가 옛 id를 확실히 찾은 로비 프레임 수 (둘로 갈린 사람 합치기)
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
            // 레벨도 같은 숫자가 이어져야 믿는다 — 한 장짜리 오독이 장부에 박히면 그 사람이 영영 남이 된다
            const lv = usableRow(row) ? row.fp.lv : null;
            const lvStreak = lv != null && s && usableRow(s.last) && s.last.fp.lv === lv ? s.lvStreak + 1 : lv != null ? 1 : 0;
            const steady = streak >= ROW_STABLE_TICKS
                || (usableRow(row) && row.fp.animated && avStreak >= ROW_ANIM_TICKS);
            const held = steady ? row : s ? s.held : null;
            state.rows[i] = { last: row, streak, avStreak, lvStreak, held };
            // 이전 프레임에서 붙인 id가 남지 않게 복사해서 넘긴다
            const out = held && Object.assign({}, held, { id: undefined });
            if (usableRow(out)) {
                // 레벨은 지금 프레임이 안정된 칸이고 같은 숫자가 LV_STABLE_TICKS 이어졌을 때만 싣는다
                const stable = held === row && lvStreak >= LV_STABLE_TICKS;
                out.fp = Object.assign({}, out.fp, { lv: stable ? lv : null, lvStable: stable });
            }
            return out;
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

    /* ── 칸마다 누구인지 한 번에 정하기 ─────────────────
       명패 모양으로 확실히 안 칸(장부 찾기)은 그대로 두고, 남은 칸과 남은 사람을 **한 번에** 짝짓는다.
       예전에는 칸 하나씩 규칙을 차례로 돌렸다(엇비슷한 칸 소거 → 같은 칸 → 자리 이동 → 배치 → 입장 딜레이 뒤 READY 다시 잇기).
       규칙마다 "딱 하나로 맞을 때만"을 따로 지켰고, 규칙 사이의 순서가 결과를 바꿨다. 이제 규칙은 짝 하나의 **비용**이 되고
       (싸다 = 단서가 확실하다), 전체 비용이 가장 적은 짝을 고른다. 한 사람이 두 칸에 잡히지 않는 것과 소거법은 저절로 된다.

         단서(비용)                                        예전의 어느 규칙인가
         엇비슷한 칸의 후보 (아바타·닉네임이 맞는 둘 이상)  1.5 소거법 (다른 칸이 차지한 사람을 빼면 하나)
           — 같은 칸 단서(1)보다 비싸다: 후보 둘이 다 맞으면 자리가 가른다
         직전 프레임에 같은 칸에 있던 사람                  1   자리 잇기 1번
         직전 프레임에 다른 칸에 있던 사람 (자리 이동)      2   자리 잇기 2번
         방에 있는데 안 보이는 사람 — 아바타 + 닉네임 느슨 3   READY 다시 잇기 (relinkStateChanges)
           (레벨 숫자까지 같으면 닉네임을 견줄 수 없어도)
         배치가 그대로일 때 같은 칸 사람 — 그림 판정 없이  4   자리 잇기 3번
         레벨 숫자가 같으면 −0.5, 레벨이 어긋나면(내려감 · 숨김↔숫자) 어떤 단서로도 잇지 않는다.
         아무와도 안 이으면 NEW_COST — 처음 보는 명패로 남는다(입장 딜레이 뒤에 새로 올린다).

       **하나로 맞아떨어질 때만 잇는다.** 고른 짝 하나를 금지해도 전체 비용이 같게 나오면(두 사람이 서로 바뀔 수 있다)
       그 칸은 비워 둔다 — 예전 규칙들이 "둘 이상이면 어느 쪽도 잇지 않는다"로 지키던 것이다.
       READY 다시 잇기는 예전엔 입장 딜레이(3초)가 찬 뒤에만 했는데, 이제 매 프레임 한다 — 퇴장·입장이 아예 안 생긴다.
       장부에는 곧바로 넣지 않고 CARRY_MERGE_TICKS 이어진 뒤에 넣는다(자리로 이은 사람과 같게) */
    const NEW_COST = 10;
    const LEVEL_BONUS = 0.5;

    /* 명패 한 칸(o: { row, cands })을 사람 id에 잇는 비용 — 못 이으면 Infinity */
    function linkCost(o, id, ctx) {
        const fp = o.row.fp, idx = o.row.index;
        if (o.cands && !o.cands.includes(id)) return Infinity;   // 엇비슷한 칸은 그 후보 안에서만 (엉뚱한 사람을 끌어오지 않게)
        const entry = book()[id];
        const e = entry && Room.fpCurrent(entry.fp) ? entry.fp : null;
        const j = ctx.prevAt[id];
        const pfp = j !== undefined ? ctx.prev[j].fp : null;
        // 레벨이 어긋나면 어떤 단서로도 잇지 않는다 (직전 칸의 것 · 장부의 것 어느 쪽과든)
        if ((pfp && Room.fpLevelDiffers(fp, pfp)) || (e && Room.fpLevelDiffers(fp, e))) return Infinity;
        let c = Infinity;
        if (o.cands) c = 1.5;
        if (pfp) {
            if (j === idx && slotSame(fp, pfp)) c = Math.min(c, 1);
            else if (j !== idx && slotSame(fp, pfp)) c = Math.min(c, 2);
            if (ctx.quiet && j === idx && slotSame(fp, pfp, true)) c = Math.min(c, 4);
        }
        if (e && fp.nameState && ctx.inRoom.has(id) && Room.fpAvatarSame(fp, e) && !Room.fpArtDiffers(fp, e)
            && (Room.nameClose(fp, e) || (Room.fpLevelSame(fp, e) && !(e.names && e.names[fp.nameState])))) c = Math.min(c, 3);
        if (c < Infinity && ((pfp && Room.fpLevelSame(fp, pfp)) || (e && Room.fpLevelSame(fp, e)))) c -= LEVEL_BONUS;
        return c;
    }

    /* 비용표 → 가장 싼 짝 { total, pick: 칸마다 사람 번호(−1 = 아무도) }. 칸은 8개뿐이고 이을 수 있는 짝은
       아바타로 이미 추려져 몇 개 안 되므로 다 훑어도 된다. forbid = [칸, 사람] 이 짝은 쓰지 않는다 */
    function cheapest(cost, forbid) {
        const R = cost.length, pick = new Array(R).fill(-1), used = new Set();
        let best = { total: Infinity, pick: pick.slice() };
        (function go(r, total) {
            if (total >= best.total) return;
            if (r === R) { best = { total, pick: pick.slice() }; return; }
            for (let c = 0; c < cost[r].length; c++) {
                if (used.has(c) || cost[r][c] === Infinity || (forbid && forbid[0] === r && forbid[1] === c)) continue;
                used.add(c); pick[r] = c;
                go(r + 1, total + cost[r][c]);
                used.delete(c); pick[r] = -1;
            }
            go(r + 1, total + NEW_COST);
        })(0, 0);
        return best;
    }

    /* 칸들 → { placed: Map(칸 → { id, hit?, how }), open: [{ row, cands }] (못 정한 칸) }. 장부·상태를 건드리지 않는다.
       slots: 직전 로비 프레임의 칸 배치. sameSlots — 목록이 다시 정렬된 뒤(방장을 넘긴 직후)에는 false (칸 위치를 단서로 안 쓴다) */
    function placeRows(rows, { slots = state.slots || [], sameSlots = true } = {}) {
        const placed = new Map(), known = new Set(), open = [];
        for (const row of rows) {
            if (!usableRow(row)) continue;
            const hit = lookupRaw(row);
            if (hit && hit.match && !known.has(hit.match.id)) { placed.set(row, { id: hit.match.id, hit, how: 'plate' }); known.add(hit.match.id); }
            else open.push({ row, cands: hit && hit.ambiguous ? hit.candidates.map(c => c.id) : null });
        }
        if (!open.length) return { placed, open };

        const prev = sameSlots ? slots : [];
        const prevAt = {};
        prev.forEach((p, j) => { if (p) prevAt[p.id] = j; });
        // 배치가 그대로인가 (자리 잇기 3번) — 명패로 알아본 사람이 모두 제 칸에 있고, 못 정한 칸 = 못 찾은 사람이 있던 칸
        let quiet = true;
        for (const [row, pl] of placed) if (prevAt[pl.id] !== undefined && prevAt[pl.id] !== row.index) quiet = false;
        const freeIdx = [];
        prev.forEach((p, j) => { if (p && !known.has(p.id)) freeIdx.push(j); });
        const openIdx = open.map(o => o.row.index).sort((x, y) => x - y);
        quiet = quiet && freeIdx.length > 0 && freeIdx.length === openIdx.length && freeIdx.every((j, k) => j === openIdx[k]);

        // 이을 수 있는 사람: 직전 칸에 있던 사람 · 방에 있는 사람 · 엇비슷한 칸의 후보 (명패로 이미 정한 사람은 뺀다)
        const inRoom = new Set(room.players.filter(p => p.auto).map(p => p.nickname));
        const people = new Set();
        for (const p of prev) if (p && !known.has(p.id)) people.add(p.id);
        for (const id of inRoom) if (!known.has(id) && book()[id]) people.add(id);
        for (const o of open) if (o.cands) for (const id of o.cands) if (!known.has(id)) people.add(id);
        const ids = [...people];
        if (!ids.length) return { placed, open };

        const ctx = { prev, prevAt, quiet, inRoom };
        const cost = open.map(o => ids.map(id => linkCost(o, id, ctx)));
        const best = cheapest(cost);
        const still = [];
        open.forEach((o, r) => {
            const c = best.pick[r];
            // 이 짝을 빼도 전체 비용이 같다 = 다른 사람으로도 똑같이 맞는다 → 비워 둔다
            if (c < 0 || cheapest(cost, [r, c]).total <= best.total + 1e-9) { still.push(o); return; }
            placed.set(o.row, { id: ids[c], how: 'link' });
        });
        return { placed, open: still };
    }

    /* 자동 방장 봇용 — 화면의 로비 칸마다 누구인지 → [{ row, id }]. 표와 똑같이 placeRows로 가린다
       (장부 전체 조회만 보면 표가 자리·READY 다시 잇기로 알아보는 사람이 빈칸이 되고, 그 사람이 1순위면 봇이
       말없이 2순위에게 방장을 넘겼다). 장부·상태를 건드리지 않는다.
       sameSlots — 목록이 다시 정렬된 뒤(방장을 넘긴 직후)에는 false로 부른다 */
    function identifyRows(rows, { sameSlots = true } = {}) {
        const out = [];
        for (const [row, pl] of placeRows(rows, { sameSlots }).placed) out.push({ row: row.index, id: pl.id });
        return out.sort((a, b) => a.row - b.row);
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
        // (등록은 확정된 뒤에 하므로) 화면 전환 중 프레임이 장부에 끼어들지 않게 한다.
        // 누구인지는 placeRows가 한 번에 정한다 — 명패로 확실한 칸 + 자리·엇비슷한 후보·READY 다시 잇기로 이은 칸.
        // 이어 붙인 사람은 '아는 사람'으로 쳐서 입·퇴장이 아예 일어나지 않게 한다
        const { placed, open } = placeRows(occupied);
        const knownIds = [], knownHits = [], carried = [];
        for (const [row, pl] of placed) {
            row.id = pl.id; knownIds.push(pl.id);
            if (pl.hit) knownHits.push([row, pl.hit]); else carried.push([row, pl.id]);
        }
        const ambiguousRows = open.filter(o => o.cands).map(o => [o.row, o.cands]);
        const unknownPlates = open.filter(o => !o.cands).map(o => o.row);
        mergeCarried(carried);
        const prevSlots = state.slots || [];
        rememberSlots(steady);
        // 둘로 갈렸던 한 사람이 이제 드러났으면 합친다 — 합쳤으면 id가 바뀌었으니 명단을 처음부터 다시 센다
        if (checkMerges(placed, prevSlots).length) { state.rosterKey = null; state.rosterCount = 0; return { pending: true }; }

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

        // 여기서부터 확정 — 아는 사람의 닉네임 지문을 채우고, 처음 보는 명패를 장부에 올린다.
        // 처음 보는 명패는 입장 딜레이가 찬 뒤에만 장부에 올린다 (잘못 읽은 명패가 유령으로 남지 않게)
        if (first) for (const [row, hit] of knownHits) refreshName(row, hit);
        const suspects = [];
        if (newDue) {
            // (READY를 바꾼 사람 잇기는 placeRows가 매 프레임 이미 했다 — 여기 남은 것은 정말 처음 보는 명패다)
            for (const row of unknownPlates) {
                const seq = room.autoSeq;
                row.id = resolveId(row);
                // 새 id를 만들었는데 장부에 아바타가 같은 사람이 있다 — 한 사람이 둘로 갈렸을 수 있다 (의심 장면)
                if (row.id && room.autoSeq !== seq) {
                    const like = lookalikes(row, row.id, knownIds);
                    if (like.length) suspects.push({ kind: 'split', note: '새 ' + row.id + ' — 장부에 비슷한 명패 ' + like.join(', '), ids: like.concat(row.id) });
                }
            }
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
        // 처음 보는 명패는 이번에 장부에 올렸으면 끝난 것이고, 아니면(딜레이가 덜 찼다) 아직 기다리는 중이다
        const waiting = waitingCount(state.absent, state.present, newDue ? 0 : unknownPlates.length);
        if (!leaving.length && !joining.length) return { changed: false, unreadable, waiting, suspects };

        pushUndo();
        for (const p of leaving) {
            room.players = room.players.filter(x => x.nickname !== p.nickname);
            selected = selected.filter(x => x !== p.nickname);
            room.eventLog.push({ type: 'leave', round: room.round, nickname: p.nickname });
            state.leftAt[p.nickname] = Date.now();
        }
        const added = [];
        for (const id of joining) {
            if (addPlayer(id, { auto: true, silent: true })) added.push(id);
            // 방금 퇴장으로 찍힌 사람이 곧바로 돌아왔다 — 잘못 읽어 퇴장→입장이 찍혔을 수 있다 (의심 장면)
            const left = state.leftAt[id];
            if (left && Date.now() - left < BOUNCE_MS) suspects.push({ kind: 'bounce', note: id + ' 퇴장 ' + Math.round((Date.now() - left) / 1000) + '초 만에 다시 입장', ids: [id] });
        }
        refreshUI();
        return { changed: true, left: leaving.map(p => p.nickname), joined: added, unreadable, waiting, suspects };
    }

    /* ── 둘로 갈린 사람 합치기 ─────────────────
       한 사람이 장부에 두 id로 올라가는 일이 있다 — 나갔다가 READY인 채로 돌아왔는데 장부엔 그림에 묻힌 평소 명패뿐이고
       레벨도 못 읽으면, 돌아온 순간에는 그 사람인지 알 길이 없어 새 id가 된다(나는핵을써개못핵, replay-test.js).
       그 뒤 READY를 풀거나 레벨이 읽혀 **지금 명패가 옛 id를 장부에서 확실히 찾으면**(자기 id를 빼고 찾아서 그 사람 하나가
       나오면 — 돌아온 순간에 봤다면 그 id로 이어졌을 기준이다) 그게 같은 사람이라는 증거다. MERGE_TICKS(3초) 이어지면 합친다.
       - 옛 id는 지금 방에 없어야 한다 (둘 다 방에 있으면 두 사람이다)
       - **한 로비 화면에 같이 앉아 있던 적이 있는 두 id는 절대 합치지 않는다** — 아바타가 같은 두 사람이 한 번이라도
         같이 보이면 장부에 서로를 적어 둔다(fp가 아니라 장부 항목의 apart). 아바타가 다른 사람끼리는 애초에 찾아지지 않는다
       - 남는 id는 먼저 만든 쪽(번호가 작은 쪽)이다 — 전적·로그가 거기 쌓여 있다. 전적은 더하고, 로그의 id는 바꾸고,
         명패 모양은 지금 방에 있는 쪽 것을 앞세워 합친다
       손으로 합치는 버튼은 두지 않는다(2026-09-22에 걷어냈다) — 이건 같은 판단을 자동으로 하는 것이다 */
    const MERGE_TICKS = 6;

    const seqOf = (id) => { const m = /(\d+)$/.exec(id); return m ? +m[1] : Infinity; };

    /* 이번 로비에 같이 앉은, 아바타가 같은 사람들 — 서로를 '다른 사람'으로 적어 둔다 */
    function markApart(ids) {
        const b = book();
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const x = b[ids[i]], y = b[ids[j]];
                if (!x || !y || !Room.fpCurrent(x.fp) || !Room.fpCurrent(y.fp) || !Room.fpAvatarSame(x.fp, y.fp)) continue;
                x.apart = x.apart || []; y.apart = y.apart || [];
                if (!x.apart.includes(ids[j])) x.apart.push(ids[j]);
                if (!y.apart.includes(ids[i])) y.apart.push(ids[i]);
            }
        }
    }

    /* placed: Map(칸 → { id }) — 이번 로비에서 누구로 정해졌는지. prevSlots — 직전 로비 프레임의 칸 배치.
       두 갈래로 드러난다:
         ① 방에 있는 id(B)의 칸 명패가, B를 빼고 찾으면 방에 없는 옛 id(A)를 확실히 찾는다
         ② 명패가 곧바로 옛 id(A)로 찾아졌는데(장부에 그 상태 모양이 A에게만 있다) 그 칸에 직전까지 앉아 있던 건 B다 —
            B는 이번에 안 보인다. 가만두면 B 퇴장 · A 입장이 찍힌다. 칸별로 '누가 누구로 바뀌었나'를 이어서 센다(state.takeover)
       합친 [남는 id, 없어지는 id] 목록 */
    function checkMerges(placed, prevSlots) {
        const b = book();
        const seated = [...placed.values()].map(p => p.id);
        markApart(seated);
        const inRoom = new Set(room.players.map(p => p.nickname));
        const streak = {}, due = [];
        for (const [row, pl] of placed) {
            const B = pl.id;
            if (!usableRow(row) || !inRoom.has(B) || !b[B]) continue;
            const apart = b[B].apart || [];
            const ids = Object.keys(b).filter(id => id !== B && !inRoom.has(id) && !seated.includes(id) && !apart.includes(id));
            if (!ids.length) continue;
            const hit = lookupRaw(row, ids);   // 엄격한 찾기 (loose 아님) — 새로 온 사람을 옛 사람으로 잇는 것과 같은 기준
            if (!hit || !hit.match) continue;
            const key = B + '>' + hit.match.id;
            streak[key] = (state.mergeStreak[key] || 0) + 1;
            if (streak[key] >= MERGE_TICKS) due.push([B, hit.match.id]);
        }
        state.mergeStreak = streak;
        // ② 칸을 이어받은 경우
        const takeover = {};
        for (const [row, pl] of placed) {
            const A = pl.id, i = row.index;
            if (!usableRow(row) || inRoom.has(A) || !b[A]) continue;
            const was = state.takeover[i];
            const prevId = prevSlots[i] && prevSlots[i].id;
            let from = was && was.to === A ? was.from : (prevId && prevId !== A ? prevId : null);
            if (!from || !inRoom.has(from) || seated.includes(from) || !b[from]) continue;
            const f = b[from];
            if ((f.apart || []).includes(A) || !Room.fpCurrent(f.fp) || !Room.fpAvatarSame(row.fp, f.fp) || Room.fpLevelDiffers(row.fp, f.fp)) continue;
            const n = (was && was.to === A && was.from === from ? was.n : 0) + 1;
            takeover[i] = { from, to: A, n };
            if (n >= MERGE_TICKS) due.push([from, A]);
        }
        state.takeover = takeover;
        const done = [];
        for (const [B, A] of due) {
            if (!b[A] || !b[B]) continue;   // 같은 프레임에 앞의 합치기로 이미 없어졌다
            const keep = seqOf(A) <= seqOf(B) ? A : B, drop = keep === A ? B : A;
            mergeIds(keep, drop, B);
            done.push([keep, drop]);
        }
        return done;
    }

    /* drop을 keep으로 합친다. live = 지금 방에 있는 쪽 id (그쪽 명패 모양·플레이어 칸이 지금 것이다) */
    function mergeIds(keep, drop, live) {
        pushUndo();
        const b = book();
        const K = b[keep], D = b[drop], L = live === keep ? K : D, O = live === keep ? D : K;
        // 명패 장부 — 지금 방에 있는 쪽 모양을 앞세운다 (상태별 닉네임 모양·그림·움직이는 명패 평균·레벨)
        const fp = Object.assign({}, O.fp, L.fp);
        fp.names = Object.assign({}, O.fp.names, L.fp.names);
        if (!L.fp.art && O.fp.art) fp.art = O.fp.art;
        if (O.fp.animated || L.fp.animated) fp.animated = true;
        if (!fp.artAvg && O.fp.artAvg) { fp.artAvg = O.fp.artAvg; fp.artN = O.fp.artN; }
        const lvs = [K.fp, D.fp].filter(f => f.lv != null).sort((x, y) => (y.lvAt || 0) - (x.lvAt || 0));
        if (lvs.length) { fp.lv = lvs[0].lv; fp.lvAt = lvs[0].lvAt; } else { delete fp.lv; delete fp.lvAt; }
        const apart = [...new Set([...(K.apart || []), ...(D.apart || [])])].filter(id => id !== keep && id !== drop);
        b[keep] = { fp, thumb: L.thumb || O.thumb };
        if (apart.length) b[keep].apart = apart;
        delete b[drop];
        for (const id of Object.keys(b)) {
            const a = b[id].apart;
            if (a && a.includes(drop)) b[id].apart = [...new Set(a.map(x => x === drop ? keep : x))].filter(x => x !== id);
        }

        // 플레이어 — 방에 있는 칸(live)을 keep 이름으로. 전적은 두 id의 것을 더한다
        const p = room.players.find(x => x.nickname === live);
        const other = live === keep ? drop : keep;
        const hist = room.playerHistory[other] || { matchCount: 0, chooserCount: 0, waitSum: 0 };
        if (p) {
            const sinceJoin = p.matchCount || 0;
            p.matchCount = (p.matchCount || 0) + (hist.matchCount || 0);
            p.chooserCount = (p.chooserCount || 0) + (hist.chooserCount || 0);
            p.waitSum = (p.waitSum || 0) + (hist.waitSum || 0);
            // 옛 id가 전에 있던 사람이면, 새 id로 들어온 것은 실은 재입장이다 (한 판 치면 딱지가 떨어진다 — recordMatch)
            if (live === drop && !sinceJoin) p.rejoined = true;
            const iKeep = room.seen.indexOf(keep), iDrop = room.seen.indexOf(drop);
            if (iKeep >= 0 || iDrop >= 0) p.joinOrder = Math.min(...[iKeep, iDrop].filter(i => i >= 0));
            p.nickname = keep;
            room.playerHistory[keep] = { matchCount: p.matchCount, chooserCount: p.chooserCount, waitSum: p.waitSum };
        }
        delete room.playerHistory[drop];
        room.seen = room.seen.filter(x => x !== drop);
        if (!room.seen.includes(keep)) room.seen.push(keep);
        const ren = (x) => x === drop ? keep : x;
        for (const ev of room.eventLog) {
            if (ev.nickname !== undefined) ev.nickname = ren(ev.nickname);
            if (ev.chooser !== undefined) ev.chooser = ren(ev.chooser);
            if (ev.opponent !== undefined) ev.opponent = ren(ev.opponent);
        }
        selected = selected.map(ren);
        if (room.botId === drop) room.botId = keep;

        // 인식 쪽 상태의 id도
        state.slots = (state.slots || []).map(s => s ? Object.assign({}, s, { id: ren(s.id) }) : s);
        for (const k of ['present', 'absent', 'carryStreak', 'leftAt']) {
            if (state[k] && state[k][drop] !== undefined) { if (state[k][keep] === undefined) state[k][keep] = state[k][drop]; delete state[k][drop]; }
        }
        if (state.lastPair) state.lastPair = state.lastPair.map(ren);
        state.mergeStreak = {}; state.takeover = {};
        state.merges.push([keep, drop]);
        log('같은 사람으로 합침 — ' + drop + ' → ' + keep + ' (전적·기록을 이어 붙였습니다)', 'hit');
        refreshUI();
    }

    /* 장부에서 이 명패와 아바타가 같고 그림·레벨도 어긋나지 않는 다른 사람 (지금 다른 칸에 앉아 있는 사람은 뺀다 — 그건 확실히 남이다) */
    function lookalikes(row, self, seated) {
        const b = book(), out = [];
        for (const id of Object.keys(b)) {
            if (id === self || seated.includes(id)) continue;
            const e = b[id].fp;
            if (Room.fpCurrent(e) && Room.fpAvatarSame(row.fp, e) && !Room.fpArtDiffers(row.fp, e) && !Room.fpLevelDiffers(row.fp, e)) out.push(id);
        }
        return out;
    }

    // 딜레이가 걸려 아직 반영 안 된 입·퇴장 수 (상태 표시용)
    function waitingCount(absent, present, unknown) {
        return Object.keys(absent).length + Object.keys(present).length + unknown;
    }

    function resetDelays() {
        state.absent = {}; state.present = {}; state.newStreak = 0; state.rows = []; state.rowArt = [];
        // 로비가 아닌 화면을 거치면 칸 배치가 바뀔 수 있다 — 자리 단서는 로비가 끈기지 않고 이어질 때만 쓴다
        state.slots = []; state.carryStreak = {}; state.takeover = {}; state.mergeStreak = {};
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
    async function onFrame(frame, W, H, info) {
        // 자동 방장 봇이 메뉴를 움직이는 동안은 화면이 우리 것이 아니다 — 그 사이 프레임은 보지 않는다
        if (window.VMH.AutoHost && window.VMH.AutoHost.busy()) return;
        // 공유가 멈췄다 — 다른 창이 게임을 덮으면 게임이 화면을 새로 그리지 않아 같은 그림이 계속 온다.
        // 그 옛 프레임으로 입·퇴장을 정하면 안 되고, '로비가 아닌 화면'으로 세도 안 된다(로비 복귀 알림이 잘못 울린다).
        // 눈을 감고 있던 셈이니 세던 것은 모두 접는다 — 다시 그려지기 시작하면 저절로 이어서 읽는다
        if (info && info.stale) {
            state.rosterKey = null; state.rosterCount = 0;
            leavePairScreen();
            resetDelays();
            if (window.VMH.Incidents) window.VMH.Incidents.forget();
            setStatus('● 화면이 멈춰 있습니다 (' + Math.round(info.age / 1000) + '초) — 게임 창을 앞으로 가져오면 다시 읽습니다', 'warn');
            return;
        }
        if (Room.isLobbyScreen(frame, W, H)) {
            leavePairScreen();
            if (++state.lobbyStreak >= LOBBY_TAB_TICKS) {
                window.VMH.Tabs.follow('match');
                // 판이 끝나고 돌아온 것이면 한 번만 알린다. 로비가 확실해진 뒤에 세기를 접으므로
                // 로비 한가운데의 오인식 한두 프레임으로 알림이 울리지는 않는다
                if (state.awayStreak >= NOTIFY_AWAY_TICKS) {
                    if (window.VMH.Notify.lobbyBack()) log('로비로 돌아옴 — 알림', 'hit');
                    // 자동 방장 봇에게도 알려야 하는데, 이 프레임에서는 명단이 아직 안 굳었을 수 있다
                    // (로비 2프레임 vs 명단 3프레임). 그래서 걸어 두고 명단이 확정된 첫 프레임에 건넨다
                    state.backPending = true;
                }
                state.awayStreak = 0;
            }
            if (state.matchLocked && ++state.lobbyCount >= MATCH_CLEAR_TICKS) state.matchLocked = false;

            if (window.VMH.Incidents) window.VMH.Incidents.remember(frame, W, H);
            const r = syncRoster(Room.readLobby(frame, W, H));
            if (r.pending) return;
            if (r.suspects && r.suspects.length) saveSuspects(r.suspects, frame, W, H);
            if (r.changed) {
                const bits = [];
                if (r.joined.length) bits.push('입장 ' + r.joined.length + '명');
                if (r.left.length) bits.push('퇴장 ' + r.left.length + '명');
                log(bits.join(' · '), 'hit');
            }
            const note = (r.unreadable ? ` (기본 명패 ${r.unreadable}칸은 구분 불가)` : '')
                       + (r.waiting ? ` · 입·퇴장 확인 중 ${r.waiting}명` : '');
            setStatus('● 로비 인식 중 — ' + room.players.filter(p => p.auto).length + '명' + note + areaNote(), 'live');
            // 명단이 확정된 로비 프레임에서만 자동 방장 봇에게 기회를 준다 (봇이 방장이 됐을 때 한 번).
            // 판이 끝나고 돌아온 것인지도 여기서 한 번만 건넨다 — 봇이 쓰든 말든 건네면 접는다.
            // r.waiting = 딜레이가 덜 찬 입·퇴장 수 — 봇은 이게 0이 될 때까지 방장을 넘기지 않는다
            const back = state.backPending;
            state.backPending = false;
            if (window.VMH.AutoHost) window.VMH.AutoHost.onLobby(frame, W, H, back, r.waiting || 0);
            return;
        }
        state.rosterKey = null; state.rosterCount = 0;
        state.lobbyCount = 0; state.lobbyStreak = 0; state.awayStreak++;
        if (window.VMH.Incidents) window.VMH.Incidents.forget();
        resetDelays();   // 로비가 아닌 화면에선 명단이 안 보인다 — 딜레이는 로비가 끊기지 않고 이어질 때만 센다

        const kind = Room.isResultScreen(frame, W, H) ? 'result' : Room.isRoundScreen(frame, W, H) ? 'round' : null;
        if (!kind) {
            leavePairScreen();
            setStatus('● 자동 인식 중 — ' + (state.matchLocked ? '대결 진행 중' : '로비/라운드/결과 화면 대기') + areaNote(), 'live');
            // 대결 플레이 화면인지는 자동 방장 봇이 알아서 본다 (여기서는 그냥 모르는 화면이다)
            if (window.VMH.AutoHost) window.VMH.AutoHost.onScreen(frame, W, H, null);
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
        // 봇에게도 알린다 — 라운드 화면이면 곡 안내를 한 번 더 할 차례다
        if (window.VMH.AutoHost) window.VMH.AutoHost.onScreen(frame, W, H, kind);
    }

    /* 의심 장면을 남긴다 (lib/incidents.js) — 인식 기록에도 한 줄 */
    function saveSuspects(list, frame, W, H) {
        const I = window.VMH.Incidents;
        if (!I) return;
        const b = book();
        for (const s of list) {
            log('의심 장면 저장 — ' + s.note, 'warn');
            I.record(s.kind, s.note, frame, W, H, (s.ids || []).filter(id => b[id]).map(id => ({ id, dataUrl: b[id].thumb })));
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

    /* 의심 장면 막대 — 모인 게 있을 때만 보인다 */
    function initIncidents() {
        const I = window.VMH.Incidents, bar = $('incident-bar');
        if (!I || !bar) return;
        const render = () => { bar.hidden = !I.count(); const n = $('incident-count'); if (n) n.textContent = I.count(); };
        I.onChange(render);
        const dl = $('incident-dl'), clr = $('incident-clear');
        if (dl) dl.addEventListener('click', () => I.download());
        if (clr) clr.addEventListener('click', () => I.clear());
        render();
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
            Object.assign(state, { rosterKey: null, rosterCount: 0, pairPrev: null, pairCount: 0, pairArt: {}, matchLocked: false, pairFailed: false, lobbyStreak: 0, awayStreak: 0, backPending: false });
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
        initIncidents();
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
    window.VMH.AutoRoom = { state, lookupId, resolveId, identifyRows, book, feed: onFrame, log };
})();
