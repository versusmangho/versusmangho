/* 매칭 탭 — 플레이어 입장·매치 기록·보류·봇 지정. 수동 클릭과 화면 자동 인식(auto-room.js)이 같은 함수를 쓴다. */

// opts: 자동 인식으로 들어온 경우 { auto:true } — 명패는 room.plateBook에 있으므로 여기 담지 않는다.
//       opts.silent면 pushUndo/refreshUI를 호출부가 직접 묶어서 처리한다(여러 명 한꺼번에 반영).
function addPlayer(n, opts) {
    n = String(n).trim(); if(!n) return false;
    opts = opts || {};
    if(room.players.some(p=>p.nickname===n)) { if(!opts.silent && ui.manageMsg) {ui.manageMsg.textContent="이미 존재함"; ui.manageMsg.style.display="block";} return false; }
    // opts.force: 실제로 끝난 판의 참가자 — 8명 제한 때문에 매치 기록을 통째로 잃는 것보다는
    // 잠깐 초과를 허용하는 편이 낫다(다음 로비 인식에서 명단이 바로잡힌다)
    if(!opts.force && room.players.filter(p=>!p.onHold).length >= 8) { if(!opts.silent && ui.manageMsg) {ui.manageMsg.textContent="최대 8명"; ui.manageMsg.style.display="block";} return false; }
    if(!opts.silent) pushUndo();

    const isRejoin = room.seen.includes(n);
    // 기록이 있으면 가져오고, 없으면 기본값으로 설정
    const history = (isRejoin && room.playerHistory[n]) 
        ? room.playerHistory[n] 
        : { matchCount: 0, chooserCount: 0, waitSum: 0 };

    room.players.push({ 
        nickname: n, 
        joinOrder: room.seen.indexOf(n) === -1 ? room.seen.length : room.seen.indexOf(n), 
        lastPlay: room.round, 
        joinedAt: room.round, 
        matchCount: history.matchCount, 
        chooserCount: history.chooserCount, 
        waitSum: history.waitSum,
        heldRounds: 0,
        onHold: false,   // 봇이 다시 들어오면 syncBotHold가 보류를 건다
        holdStart: null,
        rejoined: isRejoin,
        auto: !!opts.auto
    });

    if(!isRejoin) {
        room.seen.push(n);
    }
    // 플레이어 히스토리가 없는 경우 초기화
    if (!room.playerHistory[n]) {
        room.playerHistory[n] = { matchCount: 0, chooserCount: 0, waitSum: 0 };
    }

    room.eventLog.push({ type: 'join', round: room.round, nickname: n });

    if(!opts.silent) {
        if(ui.input) ui.input.value="";
        refreshUI();
    }
    return true;
}

/* 매치 한 판 기록. 수동 클릭과 화면 자동 인식이 같은 경로를 쓴다.
   chooser가 원디골(먼저 클릭한 쪽 / 자동일 때는 우선순위가 높은 쪽). pushUndo는 호출부 책임. */
function recordMatch(chooserNick, opponentNick) {
    const c = room.players.find(p => p.nickname === chooserNick);
    const o = room.players.find(p => p.nickname === opponentNick);
    if (!c || !o || c === o) return false;

    const nextRound = room.round + 1;

    // 이번 매치에서 실제로 기다린 판수(직전 플레이 이후 공백 라운드)를 누적
    const cWait = Math.max(0, nextRound - (c.lastPlay || 0) - 1);
    const oWait = Math.max(0, nextRound - (o.lastPlay || 0) - 1);
    c.waitSum = (c.waitSum || 0) + cWait;
    o.waitSum = (o.waitSum || 0) + oWait;

    room.round = nextRound;
    c.lastPlay = room.round;
    o.lastPlay = room.round;
    c.matchCount = (c.matchCount || 0) + 1;
    o.matchCount = (o.matchCount || 0) + 1;
    c.chooserCount = (c.chooserCount || 0) + 1;

    // 한 판 플레이하면 재입장 딱지 제거
    c.rejoined = false;
    o.rejoined = false;

    // 영구 기록 업데이트
    room.playerHistory[c.nickname] = { matchCount: c.matchCount, chooserCount: c.chooserCount, waitSum: c.waitSum };
    room.playerHistory[o.nickname] = { matchCount: o.matchCount, chooserCount: o.chooserCount, waitSum: o.waitSum };

    room.eventLog.push({ type: 'match', round: room.round, chooser: c.nickname, opponent: o.nickname });
    return true;
}

/* 보류 켜기/끄기. 끌 때는 보류한 라운드만큼 대기를 보정한다 (보류 버튼과 봇 지정이 같이 쓴다) */
function setHold(p, on) {
    if (on) { p.onHold = true; p.holdStart = room.round; selected = selected.filter(x => x !== p.nickname); return; }
    p.onHold = false;
    if (p.holdStart !== null) { const d = room.round - p.holdStart; if (d > 0) { p.lastPlay += d; p.heldRounds = (p.heldRounds || 0) + d; } p.holdStart = null; }
}

/* 자동 방장 봇(auto-host.js)이 켜져 있으면 표의 보류 버튼 자리에 '봇 지정'이 뜬다 */
const autoHostOn = () => !!(window.VMH.AutoHost && window.VMH.AutoHost.opts.on);
// 지정된 봇이 지금 방에 있는가 — 있으면 다른 사람은 봇으로 지정할 수 없다
const botInRoom = () => !!room.botId && room.players.some(p => p.nickname === room.botId);

/* 봇의 보류를 기능 켜짐/꺼짐에 맞춘다 — 켜져 있으면 봇은 늘 보류, 꺼지면 봇 지정으로 건 보류만 푼다
   (꺼져 있을 때 손으로 건 보류는 그대로 둔다). 봇 지정(room.botId)은 남겨 두므로 다시 켜면 그대로 봇이다.
   p.botHold = 이 보류를 봇 지정이 걸었다는 표시 — room 안에 있으니 되돌리기·새로고침에도 같이 따라온다.
   refreshUI·priorityOrder가 늘 먼저 부르므로 어느 길로 오든(토글·되돌리기·재입장) 화면과 순서가 어긋나지 않는다 */
function syncBotHold() {
    if (!window.VMH.AutoHost) return;   // auto-host.js가 설정을 읽기 전(첫 그리기) — 켜짐/꺼짐을 아직 모른다
    const on = autoHostOn();
    for (const p of room.players) {
        // 표시가 아예 없는(undefined) 보류 중인 봇 = 표시를 달기 전 판이 봇 지정으로 건 보류다 (손으로 건 보류는 false가 붙는다)
        if (p.nickname === room.botId && p.onHold && p.botHold === undefined) p.botHold = true;
        if (on && p.nickname === room.botId) {
            if (!p.onHold) setHold(p, true);
            p.botHold = true;   // 켜져 있는 동안 봇의 보류는 봇 지정의 것이다 — 끄면 칼같이 풀린다
        } else if (p.botHold) {
            if (p.onHold) setHold(p, false);
            p.botHold = false;
        }
    }
}

/* 지금 매칭 순서 (세이프가드 포함, 보류 중인 사람은 뺀다).
   팝업과 자동 방장 봇(auto-host.js)이 같은 것을 봐야 해서 한 군데로 모아 둔다 */
function priorityOrder() {
    syncBotHold();
    updateAverageWaitersStat();
    return getSortedPlayers({ key: 'priority', order: 'desc' }).filter(p => !p.onHold);
}
