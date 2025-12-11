// -----------------------
// 로컬 스토리지 저장/로드
// -----------------------
function saveState() {
  localStorage.setItem("roomState", JSON.stringify(room));
}

function loadState() {
  const raw = localStorage.getItem("roomState");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// -----------------------
// 방 데이터 구조
// -----------------------
let room = {
  round: 0,
  players: [],
  history: [],
  matchLog: [],
  seen: [],
  newcomerPriority: true,
};

// -----------------------
// 방 복원
// -----------------------
const saved = loadState();
if (saved) room = saved;

// -----------------------
// UI 요소 캐싱
// -----------------------
const roundInfo = document.getElementById("round-info");
const playerTableBody = document.getElementById("player-table-body");
const logTableBody = document.getElementById("log-table-body");
const nicknameInput = document.getElementById("nickname-input");
const addBtn = document.getElementById("add-btn");
const undoBtn = document.getElementById("undo-btn");
const resetBtn = document.getElementById("reset-btn");
const newcomerToggle = document.getElementById("newcomer-toggle");
const manageMsg = document.getElementById("manage-msg");
const matchMsg = document.getElementById("match-msg");
const matchMsgSuccess = document.getElementById("match-msg-success");
const chooserStatus = document.getElementById("chooser-status");

newcomerToggle.checked = room.newcomerPriority;

// -----------------------
// 유틸
// -----------------------
function showError(el, msg) {
  el.textContent = msg;
  el.style.display = "block";
}
function hideError(el) {
  el.style.display = "none";
}

// -----------------------
// 우선순위 계산
// -----------------------
function computeIdle(p) {
  return room.round - p.lastPlay;
}

function avgWait(p) {
  if (p.matchCount === 0) return computeIdle(p);
  return p.waitSum / p.matchCount;
}

function priorityOf(p) {
  const idle = computeIdle(p);
  const avg = avgWait(p);

  let newcomerFlag = 1;
  if (room.newcomerPriority) {
    const hasLongWait = room.players.some(
      (x) => computeIdle(x) >= 4
    );
    if (!hasLongWait) {
      if (p.matchCount === 0 && idle === 0) newcomerFlag = 0;
    }
  }

  return [
    newcomerFlag,
    -idle,
    -avg,
    p.chooserCount,
    p.joinOrder,
  ];
}

// -----------------------
// UI 갱신
// -----------------------
function refreshUI() {
  roundInfo.textContent = `라운드: ${room.round}`;
  playerTableBody.innerHTML = "";
  logTableBody.innerHTML = "";

  const sorted = [...room.players].sort((a, b) => {
    const A = priorityOf(a);
    const B = priorityOf(b);
    for (let i = 0; i < A.length; i++) {
      if (A[i] < B[i]) return -1;
      if (A[i] > B[i]) return 1;
    }
    return 0;
  });

  sorted.forEach((p, idx) => {
    const tr = document.createElement("tr");
    const idle = computeIdle(p);
    const avg = avgWait(p).toFixed(2);

    const rejoinTag = p.rejoined ? `<span class="tag danger">재입장</span>` : "";

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>
        ${p.nickname} ${rejoinTag}
        <button class="small-delete" data-name="${p.nickname}">×</button>
      </td>
      <td>${p.chooserCount}</td>
      <td>${idle}</td>
      <td>${avg}</td>
      <td><span class="tag">${idx + 1}순위</span></td>
    `;
    tr.dataset.nickname = p.nickname;
    playerTableBody.appendChild(tr);
  });

  room.matchLog.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.round}</td>
      <td>${item.chooser}</td>
      <td>${item.opponent}</td>
    `;
    logTableBody.appendChild(tr);
  });
  applySelectionHighlight();
  saveState();
}
function applySelectionHighlight() {
  const rows = [...playerTableBody.querySelectorAll("tr")];

  // 기존 강조 제거
  rows.forEach((row) => row.classList.remove("highlight"));

  // selected 배열에 있는 닉네임만 다시 강조
  selected.forEach((name) => {
    const row = rows.find((r) => r.dataset.nickname === name);
    if (row) row.classList.add("highlight");
  });
}

// -----------------------
// 플레이어 추가/삭제
// -----------------------
function addPlayer(nick) {
  if (!nick) {
    showError(manageMsg, "닉네임을 입력하세요.");
    return;
  }
  hideError(manageMsg);

  if (room.players.length >= 8) {
    showError(manageMsg, "최대 8명까지 가능합니다.");
    return;
  }
  if (room.players.some((p) => p.nickname === nick)) {
    showError(manageMsg, "이미 존재하는 닉네임입니다.");
    return;
  }

  const isRejoin = room.seen.includes(nick);

  room.players.push({
    nickname: nick,
    chooserCount: 0,
    joinOrder: room.seen.length,
    lastPlay: room.round,
    waitSum: 0,
    matchCount: 0,
    rejoined: isRejoin,
  });

  if (!isRejoin) room.seen.push(nick);

  nicknameInput.value = "";
  refreshUI();
}

function removePlayer(nick) {
  room.players = room.players.filter((p) => p.nickname !== nick);
  refreshUI();
}

// -----------------------
// 매칭 로직
// -----------------------
let selected = [];

function tryMatch() {
  if (selected.length < 2) return;

  const chooser = room.players.find((p) => p.nickname === selected[0]);
  const opponent = room.players.find((p) => p.nickname === selected[1]);

  if (!chooser || !opponent || chooser.nickname === opponent.nickname) {
    selected = [];
    refreshUI();
    return;
  }

  const waitChooser = computeIdle(chooser);
  const waitOpp = computeIdle(opponent);

  room.history.push({
    round: room.round,
    chooserPrev: { ...chooser },
    opponentPrev: { ...opponent },
  });

  chooser.waitSum += waitChooser;
  chooser.matchCount++;
  chooser.chooserCount++;
  chooser.lastPlay = room.round + 1;

  opponent.waitSum += waitOpp;
  opponent.matchCount++;
  opponent.lastPlay = room.round + 1;

  room.round++;

  room.matchLog.push({
    round: room.round,
    chooser: chooser.nickname,
    opponent: opponent.nickname,
  });

  selected = [];
  chooserStatus.textContent = "매칭 완료! 다시 두 명을 선택하세요.";
  refreshUI();
}

// -----------------------
// 되돌리기
// -----------------------
function undoMatch() {
  if (room.history.length === 0) return;

  const last = room.history.pop();

  // 1) 라운드 되돌리기
  room.round = last.round;

  // 2) 직전에 매칭된 두 명의 상태 복원
  const chooser = room.players.find(
    (p) => p.nickname === last.chooserPrev.nickname
  );
  const opponent = room.players.find(
    (p) => p.nickname === last.opponentPrev.nickname
  );

  // 플레이어가 이미 삭제된 경우를 대비해서 안전하게 처리
  if (chooser) Object.assign(chooser, last.chooserPrev);
  if (opponent) Object.assign(opponent, last.opponentPrev);

  // 3) 현재 round보다 lastPlay가 더 큰 플레이어가 있으면 보정
  //    (round를 과거로 돌려도 대기가 음수가 안 나오도록)
  room.players.forEach((p) => {
    if (p.lastPlay > room.round) {
      p.lastPlay = room.round;
    }
  });

  // 4) 매칭 로그에서 마지막 한 줄 제거
  room.matchLog.pop();

  // 5) UI 갱신 + 저장
  refreshUI();
}

// -----------------------
// 초기화
// -----------------------
function resetRoom() {
  if (!confirm("전체 초기화하시겠습니까?")) return;

  room = {
    round: 0,
    players: [],
    history: [],
    matchLog: [],
    seen: [],
    newcomerPriority: true,
  };
  newcomerToggle.checked = true;
  refreshUI();
}

// -----------------------
// 이벤트 바인딩
// -----------------------
addBtn.onclick = () => addPlayer(nicknameInput.value.trim());
nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addPlayer(nicknameInput.value.trim());
  }
});

undoBtn.onclick = undoMatch;
resetBtn.onclick = resetRoom;
newcomerToggle.onchange = () => {
  room.newcomerPriority = newcomerToggle.checked;
  refreshUI();
};

playerTableBody.onclick = (e) => {
  const delBtn = e.target.closest(".small-delete");
  if (delBtn) {
    removePlayer(delBtn.dataset.name);
    return;
  }

  const tr = e.target.closest("tr");
  if (!tr) return;

  const nickname = tr.dataset.nickname;
  selected.push(nickname);

  // 선택 상태에 따라 강조 반영
  applySelectionHighlight();

  if (selected.length === 2) {
    tryMatch();
  }
};


// -----------------------
// 초기 표시
// -----------------------
refreshUI();
