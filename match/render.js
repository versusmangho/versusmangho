/* 매칭 탭 — 화면 그리기: 플레이어 표, 매칭 로그, 팝업의 '매칭 순서' 칸. */

const ui = {
    input: document.getElementById("nickname-input"),
    imgOld: document.getElementById("img-old"),
    imgNew: document.getElementById("img-new"),
    phOld: document.querySelector("#zone-old .placeholder"),
    phNew: document.querySelector("#zone-new .placeholder"),
    anaToggle: document.getElementById("analysis-toggle-btn"),
    anaContent: document.getElementById("analysis-content"),
    round: document.getElementById("round-info"),
    pTable: document.getElementById("player-table-body"),
    logContainer: document.getElementById("log-container"),
    manageMsg: document.getElementById("manage-msg"),
    addBtn: document.getElementById("add-btn"),
    undoBtn: document.getElementById("undo-btn"),
    redoBtn: document.getElementById("redo-btn"),
    resetBtn: document.getElementById("reset-btn")
};

/* 명패 이미지는 room.plateBook 한 곳에만 둔다 (플레이어·로그에 복사하면 저장 용량이 몇 배가 된다).
   방을 나간 뒤에도 장부에는 남으므로 퇴장 로그도 명패로 그려진다. */
function thumbFor(nickname) {
    return (room.plateBook && room.plateBook[nickname] && room.plateBook[nickname].thumb) || null;
}

/* 플레이어를 화면에 나타내는 조각. 화면 자동 인식으로 들어온 사람은 닉네임을 모르므로
   게임 안의 명패 이미지를 그대로 보여준다(닉네임 입력이 필요 없는 이유). */
function plateHtml(nickname, extraClass) {
    const t = thumbFor(nickname);
    if (!t) return escapeHtml(nickname);
    return `<img class="plate-thumb ${extraClass || ''}" src="${t}" alt="${escapeHtml(nickname)}" title="${escapeHtml(nickname)}">`;
}
const playerLabelHtml = (p) => plateHtml(p ? p.nickname : '');
const logLabelHtml = (nickname) => plateHtml(nickname, 'plate-thumb-sm');

// escapeHtml(innerHTML 삽입 시 사용자 입력 escape)은 lib/util.js에 있다 — 층수 측정기와 같은 것을 쓴다

function refreshUI() {
    // [FIX] room 객체 안전 확인
    if (!room) return;
    syncBotHold();

    updateAverageWaitersStat();

    if (room.eventLog && room.eventLog.length > 100) {
        room.eventLog.splice(0, room.eventLog.length - 100);
    }
    if (Array.isArray(room.players)) room.players.forEach(normalizePlayer);
    if(ui.round) ui.round.textContent = `라운드: ${room.round}`;
    if(ui.pTable) ui.pTable.innerHTML = "";

    if(ui.manageMsg) ui.manageMsg.style.display = "none";
    if(document.getElementById("match-msg")) document.getElementById("match-msg").style.display = "none";

    const sorted = getSortedPlayers(currentSort);

    // Update header visuals
    document.querySelector("#player-table-body")?.parentElement.querySelectorAll('thead th').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sortKey === currentSort.key) {
            th.classList.add(currentSort.order === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });

    sorted.forEach(p => {
        const tr = document.createElement("tr");
        const hold = !!p.onHold;
        const stats = calculateScore(p);
        
        // 누적 보류 라운드(현재 보류 중이면 진행 중인 분량까지 합산)
        const ongoingHold = (hold && p.holdStart !== null) ? Math.max(0, room.round - p.holdStart) : 0;
        const heldTotal = (p.heldRounds || 0) + ongoingHold;

        // 자동 방장 봇이 켜져 있으면 보류 대신 '봇 지정'을 단다. 봇은 한 명뿐이라, 방에 봇이 있으면 남의 줄에는 아무것도 안 단다
        const isBot = autoHostOn() && p.nickname === room.botId;   // 기능이 꺼져 있으면 봇도 그냥 한 사람이다
        const holdBtn = !autoHostOn() ? `<button class="small-hold">${hold?"복귀":"보류"}</button>`
            : isBot ? '<button class="small-bot">봇 해제</button>'
            : !botInRoom() ? '<button class="small-bot">봇 지정</button>' : '';

        tr.innerHTML = `
            <td>${stats.score.toFixed(2)}</td>
            <td>${playerLabelHtml(p)} ${p.rejoined?'<span class="tag danger">재입장</span>':''} ${!hold && p.matchCount===0?'<span class="tag tag-new">신입</span>':''} ${isBot?'<span class="tag tag-bot">봇</span>':hold?'<span class="tag danger">보류</span>':''}
                ${holdBtn}<button class="small-delete">×</button>
            </td>
            <td class="extra-col">${p.chooserCount||0}</td>
            <td>${stats.W_curr}</td>
            <td>${stats.W_avg.toFixed(2)}</td>
            <td class="extra-col">${p.matchCount||0}</td>
            <td class="extra-col">${p.waitSum||0}</td>
            <td class="extra-col">${heldTotal}</td>
            <td class="extra-col">R${p.joinedAt||0}</td>
        `;
        tr.dataset.nickname = p.nickname;
        if(selected.includes(p.nickname)) tr.classList.add("highlight");
        if (!hold && stats.W_curr >= safeguardThreshold()) tr.classList.add("urgent");
        ui.pTable.appendChild(tr);
    });
    
    renderLog();
    saveState();
    VMH.Popup.update();
}

/* 팝업(lib/popup.js)의 '매칭 순서' 칸(왼쪽).
   표를 어느 열로 정렬해 뒀든 여기는 늘 우선순위 순이다(세이프가드 포함). 보류 중인 사람은 뺀다. */
const POPUP_TOP = 2;     // 위에서 이만큼은 강조 — 다음 판 후보

VMH.Popup.addSection('queue', () => {
    if (!room || !room.players || !room.players.length) return '';
    const list = priorityOrder();
    if (!list.length) return '';
    return `<div class="sec queue"><h2>매칭 순서 · <span class="num">R${room.round}</span></h2>${list.map((p, i) => {
        const st = calculateScore(p);
        const cls = ['q', i < POPUP_TOP ? 'top' : '', st.W_curr >= safeguardThreshold() ? 'urgent' : ''].join(' ');
        return `<div class="${cls}"><span class="rank num">${i + 1}</span><span class="who">${playerLabelHtml(p)}${p.matchCount === 0 ? '<span class="tag">신입</span>' : ''}</span>`
             + `<span><span class="score num">${st.score.toFixed(2)}</span><span class="wait">대기 ${st.W_curr}</span></span></div>`;
    }).join('')}</div>`;
});

// 직전 렌더한 로그 시그니처. eventLog가 바뀌지 않으면 다시 그리지 않아
// 단순 닉네임 클릭 시 로그가 깜빡(재렌더)되는 것을 막는다.
let lastLogSignature = null;
// 로그 필터: 'all' | 'match' | 'inout'(입퇴장) | 'hold'(보류/복귀)
let logFilter = 'all';
const LOG_FILTER_GROUPS = {
    all:   ['match', 'join', 'leave', 'hold', 'return'],
    match: ['match'],
    inout: ['join', 'leave'],
    hold:  ['hold', 'return'],
};

function renderLog(force) {
    const logContainer = document.getElementById("log-container");
    if(!logContainer) return;

    const allowed = LOG_FILTER_GROUPS[logFilter] || LOG_FILTER_GROUPS.all;
    // 알려진 이벤트를 시간순으로 모은 뒤 필터 적용.
    const events = (room.eventLog || []).filter(ev => allowed.includes(ev.type));

    // 내용/필터가 직전과 동일하면 재렌더 생략 (깜빡임 방지)
    const signature = JSON.stringify([logFilter, events.map(ev =>
        ev.type === 'match'
            ? [ev.type, ev.round, ev.chooser, ev.opponent]
            : [ev.type, ev.round, ev.nickname]
    )]);
    if (!force && signature === lastLogSignature) return;
    lastLogSignature = signature;

    logContainer.innerHTML = "";

    if (events.length === 0) {
        const empty = document.createElement("div");
        empty.className = "log-empty";
        empty.textContent = "표시할 로그가 없습니다.";
        logContainer.appendChild(empty);
        return;
    }

    // 최신 이벤트가 좌상단부터 오도록 역순으로 렌더
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const block = document.createElement("div");
        block.className = "log-block log-" + ev.type;

        // 1. 라운드 번호
        const roundSpan = document.createElement("span");
        roundSpan.className = "round";
        roundSpan.textContent = `R${ev.round}`;
        block.appendChild(roundSpan);

        // 2. 이벤트 정보
        const infoDiv = document.createElement("div");
        infoDiv.className = "match-info";
        if (ev.type === 'match') {
            infoDiv.innerHTML = `<span class="chooser">${logLabelHtml(ev.chooser)}</span> vs ${logLabelHtml(ev.opponent)}`;
        } else if (ev.type === 'join') {
            infoDiv.innerHTML = `<span class="ev-enter">▶ 입장</span> ${logLabelHtml(ev.nickname)}`;
        } else if (ev.type === 'leave') {
            infoDiv.innerHTML = `<span class="ev-leave">◀ 퇴장</span> ${logLabelHtml(ev.nickname)}`;
        } else if (ev.type === 'hold') {
            infoDiv.innerHTML = `<span class="ev-hold">⏸ 보류</span> ${logLabelHtml(ev.nickname)}`;
        } else { // return
            infoDiv.innerHTML = `<span class="ev-return">▷ 복귀</span> ${logLabelHtml(ev.nickname)}`;
        }
        block.appendChild(infoDiv);

        logContainer.appendChild(block);
    }
}
