/* 매칭 탭 — 방 상태(room)와 저장·실행 취소.
   script.js를 역할별로 나눈 첫 조각이다. index.html에서 아래 순서로 읽혀야 한다:
     match/state.js → score.js → players.js → render.js → manual-analyzer.js → weight-editor.js → controls.js
   모두 일반 <script>라 최상위 let/const/function은 파일끼리 그대로 공유된다 (auto-room.js 등도 room을 직접 쓴다). */

// [FIX] 전역 상태 변수 'room' 선언 및 기본값 초기화
let room = {
    round: 0,
    players: [],
    eventLog: [],
    seen: [],
    playerHistory: {},
    newcomerPriority: true
};

// 스토리지 및 상태 관리
const SafeStorage={available:false,getItem:function(k){try{return window.localStorage.getItem(k)}catch{return null}},setItem:function(k,v){try{window.localStorage.setItem(k,v);return true}catch{return false}}};
try{const k="__t";window.localStorage.setItem(k,"1");window.localStorage.removeItem(k);SafeStorage.available=true;}catch { /* feature detect */ }
const STORAGE_KEY = "roomStateV3";

// 평균 대기(매치 간 대기) 계산을 위한 필드/헬퍼
function normalizePlayer(p) {
    if (!p) return p;
    if (typeof p.matchCount !== "number") p.matchCount = p.matchCount || 0;
    if (typeof p.chooserCount !== "number") p.chooserCount = p.chooserCount || 0;
    if (typeof p.lastPlay !== "number") p.lastPlay = p.lastPlay || 0;
    if (typeof p.joinedAt !== "number") p.joinedAt = p.joinedAt || 0;
    if (typeof p.waitSum !== "number") p.waitSum = p.waitSum || 0; // 누적 대기 판수
    if (typeof p.heldRounds !== "number") p.heldRounds = p.heldRounds || 0; // 누적 보류 라운드 수
    return p;
}

let undoStack = [], redoStack = [], selected = [];
let currentSort = { key: 'priority', order: 'desc' };

function pushUndo() {
    const snapshot = JSON.parse(JSON.stringify(room));
    undoStack.push(snapshot);
    redoStack = [];
    if (undoStack.length > 50) undoStack.shift();
}
function saveState() {
    // 분석기 상태(이미지 등)는 크기가 매우 크므로 저장하지 않음.
    const uiState = {
        logCollapsed: document.getElementById("log-content")?.style.display === "none",
        analysisCollapsed: document.getElementById("analysis-content")?.style.display === "none",
    };
    const toggles = {
        newcomer: document.getElementById('newcomer-toggle')?.checked,
        safeguard: document.getElementById('safeguard-toggle')?.checked
    };
    const data = { room, uiState, toggles };
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error("Failed to save state:", e);
        // alert("데이터를 저장하는데 실패했습니다. 브라우저 저장 공간이 가득 찼을 수 있습니다.");
    }
}
function loadState() {
    const r = SafeStorage.getItem(STORAGE_KEY);
    if (!r) return null;
    try {
        const parsed = JSON.parse(r);
        if (parsed.room) {
            room = parsed.room;
            if (Array.isArray(room.players)) room.players.forEach(normalizePlayer);
            if (!room.playerHistory) room.playerHistory = {};
            
            // 이전 버전 호환성: matchLog -> eventLog
            if (room.matchLog && !room.eventLog) {
                room.eventLog = room.matchLog.map(log => ({ type: 'match', ...log }));
                delete room.matchLog;
            }
            if (!room.eventLog) room.eventLog = [];
        }
        // 참고: 스크린샷 분석 결과/이미지는 용량이 커서 saveState()에서 저장하지 않으므로
        // 복원하지 않는다(새로고침 시 분석 패널은 초기화됨). 플레이어/라운드 데이터는 정상 유지된다.

        // 접힘/펼침 상태 복원
        if (parsed.uiState) {
            if (typeof parsed.uiState.logCollapsed === "boolean") {
                const logContent = document.getElementById("log-content");
                const logIcon = document.getElementById("log-toggle-icon");
                if (logContent && logIcon) {
                    const hide = parsed.uiState.logCollapsed;
                    logContent.style.display = hide ? "none" : "block";
                    logIcon.innerText = hide ? "▼" : "▲";
                }
            }
            if (typeof parsed.uiState.analysisCollapsed === "boolean") {
                const analysisContent = document.getElementById("analysis-content");
                const analysisIcon = document.querySelector("#analysis-toggle-btn .toggle-icon");
                if (analysisContent && analysisIcon) {
                    const hide = parsed.uiState.analysisCollapsed;
                    analysisContent.style.display = hide ? "none" : "block";
                    analysisIcon.innerText = hide ? "▼" : "▲";
                }
            }
        } else if (typeof parsed.logCollapsed === "boolean") { // 이전 버전 호환성
            const logContent = document.getElementById("log-content");
            const logIcon = document.getElementById("log-toggle-icon");
            if (logContent && logIcon) {
                const hide = parsed.logCollapsed;
                logContent.style.display = hide ? "none" : "block";
                logIcon.innerText = hide ? "▼" : "▲";
            }
        }


        // 토글 상태 복원
        if (parsed.toggles) {
            const newcomerToggle = document.getElementById('newcomer-toggle');
            const safeguardToggle = document.getElementById('safeguard-toggle');
            if (newcomerToggle && typeof parsed.toggles.newcomer === 'boolean') {
                newcomerToggle.checked = parsed.toggles.newcomer;
            }
            if (safeguardToggle && typeof parsed.toggles.safeguard === 'boolean') {
                safeguardToggle.checked = parsed.toggles.safeguard;
            }
        }
        return parsed;
    } catch { return null; }
}
