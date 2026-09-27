/* 매칭 탭 — 버튼·표·토글 이벤트 연결, 그리고 시작(저장된 방 불러오기). match/ 중 마지막에 읽힌다. */

// 이벤트 핸들러 바인딩
if(ui.input) ui.input.onkeydown = (e) => { if(e.key === "Enter") addPlayer(ui.input.value); };
if(ui.addBtn) ui.addBtn.onclick = () => addPlayer(ui.input.value);
if(ui.pTable) ui.pTable.onclick = (e) => {
    const nick = e.target.closest("tr")?.dataset.nickname;
    if(!nick) return;
    if(e.target.classList.contains("small-delete")) {
        pushUndo();
        room.players = room.players.filter(p=>p.nickname!==nick);
        selected = selected.filter(x=>x!==nick); // [FIX] 선택 상태 desync 방지
        room.eventLog.push({ type: 'leave', round: room.round, nickname: nick });
        refreshUI();
        return;
    }
    if(e.target.classList.contains("small-hold")) {
        pushUndo();
        const p = room.players.find(x=>x.nickname===nick);
        if(p) {
            if (!p.onHold) { setHold(p, true); p.botHold = false; room.eventLog.push({ type: 'hold', round: room.round, nickname: nick }); }
            else {
                setHold(p, false); p.botHold = false; room.eventLog.push({ type: 'return', round: room.round, nickname: nick });
            }
        }
        refreshUI(); return;
    }
    // 봇 지정/해제 — 봇은 상시 보류와 같다 (매칭 순서에서 빠진다). 게임 속 일이 아니라 설정이라 로그에는 안 남긴다
    if(e.target.classList.contains("small-bot")) {
        const p = room.players.find(x=>x.nickname===nick);
        if(!p) return;
        if(nick !== room.botId && botInRoom()) return;   // 봇은 한 명뿐
        pushUndo();
        if(nick === room.botId) room.botId = null;   // 보류는 syncBotHold가 푼다 (봇 지정이 건 것일 때만)
        else room.botId = nick;                      // 보류는 syncBotHold가 건다
        refreshUI(); return;
    }
    if(room.players.find(p=>p.nickname===nick)?.onHold) return;
    if(selected.includes(nick)) selected = selected.filter(x=>x!==nick); else selected.push(nick);
    if(selected.length === 2) {
        const [cName, oName] = selected;
        pushUndo();
        if(!recordMatch(cName, oName)) undoStack.pop(); // 매칭이 성립 안 하면 스냅샷도 되돌린다
        selected=[];
        refreshUI();
    } else refreshUI();
}
if(ui.resetBtn) ui.resetBtn.onclick = () => {
    if(confirm("전체 초기화하시겠습니까?")) {
        pushUndo(); room = {round:0, players:[], eventLog:[], seen:[], playerHistory: {}, newcomerPriority:true}; selected = [];
        resetAnalyzer();
        refreshUI();
    }
};
if(ui.undoBtn) ui.undoBtn.onclick = () => {
    if (undoStack.length === 0) { alert("되돌릴 기록이 없습니다."); return; }
    redoStack.push(JSON.parse(JSON.stringify(room))); room = undoStack.pop(); selected = []; refreshUI();
};
if(ui.redoBtn) ui.redoBtn.onclick = () => {
    if (redoStack.length === 0) { alert("다시 실행할 기록이 없습니다."); return; }
    undoStack.push(JSON.parse(JSON.stringify(room))); room = redoStack.pop(); selected = []; refreshUI();
};

// 매칭 로그 접기/펼치기
(function initLogToggle(){
    const btn = document.getElementById('log-toggle-btn');
    const content = document.getElementById('log-content');
    const icon = document.getElementById('log-toggle-icon');
    if(!btn || !content || !icon) return;

    const toggle = () => {
        const hide = content.style.display !== 'none' ? true : false;
        content.style.display = hide ? 'none' : 'block';
        icon.innerText = hide ? '▼' : '▲';
        saveState();
    };

    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
})();

// 플레이어 현황 "더 많은 정보 보기" 토글
(function initMoreColumns(){
    const btn = document.getElementById('more-cols-btn');
    const card = document.getElementById('players-card');
    if(!btn || !card) return;

    const apply = (on) => {
        card.classList.toggle('show-extra', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '－ 간략히 보기' : '＋ 더 많은 정보 보기';
        try { SafeStorage.setItem('showExtraColumns', on ? '1' : '0'); } catch {}
    };

    let saved = '0';
    try { saved = SafeStorage.getItem('showExtraColumns') || '0'; } catch {}
    apply(saved === '1');

    btn.addEventListener('click', () => {
        apply(!card.classList.contains('show-extra'));
    });
})();

// 로그 필터 (전체 / 매치 / 입퇴장 / 보류·복귀)
(function initLogFilters(){
    const filters = document.getElementById('log-filters');
    if(!filters) return;
    filters.addEventListener('click', (e) => {
        const btn = e.target.closest('.log-filter-btn');
        if(!btn) return;
        logFilter = btn.dataset.filter || 'all';
        filters.querySelectorAll('.log-filter-btn').forEach(b => {
            b.classList.toggle('active', b === btn);
        });
        renderLog(true); // 필터 변경은 강제 재렌더
    });
})();

document.addEventListener('DOMContentLoaded', function() {
    VMH.Tabs.init();

    // 테이블 헤더 클릭 정렬 이벤트 핸들러
    const pTableHead = document.querySelector("#player-table-body")?.parentElement.querySelector('thead');
    if (pTableHead) {
        pTableHead.addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.sortKey) return;

            const key = th.dataset.sortKey;
            if (currentSort.key === key) {
                currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.key = key;
                currentSort.order = key === 'nickname' ? 'asc' : 'desc';
            }
            refreshUI();
        });
    }

    // 토글 스위치 변경 시 UI 즉시 새로고침
    document.getElementById('newcomer-toggle')?.addEventListener('change', () => refreshUI());
    document.getElementById('safeguard-toggle')?.addEventListener('change', () => refreshUI());
});

// 시작 — 저장된 방을 불러와 그린다 (auto-room.js 등 뒤에 읽히는 파일은 불러온 room을 본다)
loadState();
refreshUI();
