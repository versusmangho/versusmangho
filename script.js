// -----------------------
// ✅ 안전한 Storage 래퍼 (file://, 시크릿 모드, 브라우저 설정 등으로 localStorage가 막힌 경우에도 동작)
// -----------------------
const SafeStorage = (() => {
  let available = false;
  try {
    const k = "__bmho_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }

  return {
    get available() { return available; },
    getItem(key) {
      if (!available) return null;
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    setItem(key, value) {
      if (!available) return false;
      try { window.localStorage.setItem(key, value); return true; } catch { return false; }
    },
    removeItem(key) {
      if (!available) return false;
      try { window.localStorage.removeItem(key); return true; } catch { return false; }
    },
  };
})();

// -----------------------
// 영속 저장(방 상태 + 취소/취소취소 스택)
// -----------------------
const STORAGE_KEY = "roomStateV3";

function deepClone(obj) {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

let room = {
  round: 0,
  players: [],
  matchLog: [],
  seen: [],
  newcomerPriority: true,
};

let undoStack = [];
let redoStack = [];

// ✅ 선택 상태(스냅샷 복원 시에도 접근하므로 TDZ 방지를 위해 var로 먼저 선언)
var selected = [];

function coreSnapshot() {
  return {
    round: room.round,
    players: deepClone(room.players),
    matchLog: deepClone(room.matchLog),
    seen: deepClone(room.seen),
    newcomerPriority: !!room.newcomerPriority,
  };
}

function applySnapshot(snap) {
  room.round = snap.round;
  room.players = deepClone(snap.players);
  room.matchLog = deepClone(snap.matchLog);
  room.seen = deepClone(snap.seen);
  room.newcomerPriority = !!snap.newcomerPriority;

  if (newcomerToggle) newcomerToggle.checked = room.newcomerPriority;
  selected = [];
}

function saveState() {
  const payload = { room: coreSnapshot(), undoStack, redoStack };
  SafeStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadState() {
  const raw = SafeStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.room) return parsed;
    } catch {}
  }
  const rawV2 = SafeStorage.getItem("roomStateV2");
  if (rawV2) {
    try {
      const parsed = JSON.parse(rawV2);
      if (parsed && parsed.room) return parsed;
    } catch {}
  }
  const legacyRaw = SafeStorage.getItem("roomState");
  if (!legacyRaw) return null;
  try {
    const legacy = JSON.parse(legacyRaw);
    if (!legacy) return null;
    return {
      room: {
        round: legacy.round ?? 0,
        players: legacy.players ?? [],
        matchLog: legacy.matchLog ?? [],
        seen: legacy.seen ?? [],
        newcomerPriority: legacy.newcomerPriority ?? true,
      },
      undoStack: [],
      redoStack: [],
    };
  } catch {
    return null;
  }
}

// -----------------------
// UI 요소 캐싱
// -----------------------
const roundInfo = document.getElementById("round-info");
const playerTableBody = document.getElementById("player-table-body");
const logTableBody = document.getElementById("log-table-body");
const nicknameInput = document.getElementById("nickname-input");
const addBtn = document.getElementById("add-btn");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const resetBtn = document.getElementById("reset-btn");
const newcomerToggle = document.getElementById("newcomer-toggle");
const manageMsg = document.getElementById("manage-msg");
const matchMsg = document.getElementById("match-msg");
const matchMsgSuccess = document.getElementById("match-msg-success");
const chooserStatus = document.getElementById("chooser-status");

// localStorage가 막혀 있으면(예: file:// 실행, 시크릿/보안 설정) 저장/취소기록이 유지되지 않습니다.
if (chooserStatus && !SafeStorage.available) {
  chooserStatus.textContent = "저장소(localStorage)를 사용할 수 없어, 새로고침 시 데이터가 유지되지 않을 수 있습니다.";
}


// Help modal
const helpBtn = document.getElementById("help-btn");
const helpModal = document.getElementById("help-modal");
const helpCloseBtn = document.getElementById("help-close-btn");

// -----------------------
// 초기 로드
// -----------------------
const loaded = loadState();
if (loaded) {
  applySnapshot(loaded.room);
  undoStack = Array.isArray(loaded.undoStack) ? loaded.undoStack : [];
  redoStack = Array.isArray(loaded.redoStack) ? loaded.redoStack : [];
} else {
  if (newcomerToggle) newcomerToggle.checked = room.newcomerPriority;
}

// -----------------------
// 유틸
// -----------------------
function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}
function hideError(el) {
  if (!el) return;
  el.style.display = "none";
}
function showSuccess(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

function pushUndo() {
  undoStack.push(coreSnapshot());
  redoStack = [];
}

function updateUndoRedoButtons() {
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// -----------------------
// 보류(홀드) + 대기/평균
// -----------------------
function isOnHold(p) {
  return !!p.onHold;
}

function activePlayers() {
  return room.players.filter((p) => !isOnHold(p));
}

function computeIdle(p) {
  if (isOnHold(p)) return 0;
  return room.round - (p.lastPlay ?? 0);
}

function idleDisplay(p) {
  return isOnHold(p) ? "—" : String(computeIdle(p));
}

function avgWaitDisplay(p) {
  if (isOnHold(p)) return "—";
  const idle = computeIdle(p);
  const m = p.matchCount ?? 0;
  const sum = p.waitSum ?? 0;
  return ((sum + idle) / (m + 1)).toFixed(2);
}

// -----------------------
// 우선순위(하드캡 + 신입 가중치) + 보류는 항상 맨 아래
// -----------------------
const NEWCOMER_BONUS = 80;

function priorityScore(p) {
  const idle = computeIdle(p);
  const isNew = (p.matchCount ?? 0) === 0;
  return idle * 100 + (room.newcomerPriority && isNew ? NEWCOMER_BONUS : 0);
}

function priorityKey(p) {
  if (isOnHold(p)) return [2, 0, 0, p.joinOrder ?? 0];

  const idle = computeIdle(p);
  const score = priorityScore(p);
  const m = p.matchCount ?? 0;
  const sum = p.waitSum ?? 0;
  const avg = (sum + idle) / (m + 1);

  return [
    idle >= 4 ? 0 : 1,
    -score,
    -avg,
    p.chooserCount ?? 0,
    p.joinOrder ?? 0,
  ];
}

// -----------------------
// UI 갱신
// -----------------------

function refreshUI() {
  if (roundInfo) roundInfo.textContent = `라운드: ${room.round}`;

  if (playerTableBody) playerTableBody.innerHTML = "";
  if (logTableBody) logTableBody.innerHTML = "";

  hideError(manageMsg);
  hideError(matchMsg);
  if (matchMsgSuccess) matchMsgSuccess.style.display = "none";

  const sorted = [...room.players].sort((a, b) => {
    const A = priorityKey(a);
    const B = priorityKey(b);
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      if (A[i] < B[i]) return -1;
      if (A[i] > B[i]) return 1;
    }
    return A.length - B.length;
  });

  let activeRank = 0;

  for (const p of sorted) {
    const tr = document.createElement("tr");
    const hold = isOnHold(p);

    const rejoinTag = p.rejoined ? `<span class="tag danger">재입장</span>` : "";
    const holdTag = hold ? `<span class="tag danger">보류</span>` : "";

    const rankText = hold ? "보류" : `${++activeRank}순위`;
    const holdBtnText = hold ? "복귀" : "보류";
    const holdBtnClass = hold ? "small-hold on" : "small-hold";

    tr.innerHTML = `
      <td><span class="tag">${rankText}</span></td>
      <td>
        ${p.nickname} ${rejoinTag} ${holdTag}
        <button class="${holdBtnClass}" data-name="${p.nickname}">${holdBtnText}</button>
        <button class="small-delete" data-name="${p.nickname}">×</button>
      </td>
      <td>${p.chooserCount ?? 0}</td>
      <td>${idleDisplay(p)}</td>
      <td>${avgWaitDisplay(p)}</td>
    `;

    tr.dataset.nickname = p.nickname;
    if (hold) tr.dataset.onhold = "1";
    playerTableBody.appendChild(tr);
  }

  for (const item of room.matchLog) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.round}</td>
      <td>${item.chooser}</td>
      <td>${item.opponent}</td>
    `;
    logTableBody.appendChild(tr);
  }

  applySelectionHighlight();
  updateUndoRedoButtons();
  saveState();
}

function applySelectionHighlight() {
  if (!playerTableBody) return;
  const rows = [...playerTableBody.querySelectorAll("tr")];
  rows.forEach((row) => row.classList.remove("highlight"));
  for (const name of selected) {
    const row = rows.find((r) => r.dataset.nickname === name);
    if (row) row.classList.add("highlight");
  }
}

// -----------------------
// 플레이어 추가/삭제/보류
// -----------------------
function addPlayer(nick) {
  if (!nick) {
    showError(manageMsg, "닉네임을 입력하세요.");
    return;
  }

  // ✅ 활성 플레이어(보류 제외) 기준으로 8명 제한
  if (activePlayers().length >= 8) {
    showError(manageMsg, "활성 플레이어는 최대 8명까지 가능합니다. (보류 제외)");
    return;
  }

  if (room.players.some((p) => p.nickname === nick)) {
    showError(manageMsg, "이미 존재하는 닉네임입니다.");
    return;
  }

  pushUndo();

  const isRejoin = room.seen.includes(nick);

  room.players.push({
    nickname: nick,
    chooserCount: 0,
    joinOrder: room.seen.length,
    lastPlay: room.round,
    waitSum: 0,
    matchCount: 0,
    rejoined: isRejoin,
    onHold: false,
  });

  if (!isRejoin) room.seen.push(nick);

  if (nicknameInput) nicknameInput.value = "";
  try { refreshUI(); } catch (e) { console.error(e); }
}

function removePlayer(nick) {
  if (!room.players.some((p) => p.nickname === nick)) return;
  pushUndo();
  room.players = room.players.filter((p) => p.nickname !== nick);
  selected = selected.filter((x) => x !== nick);
  try { refreshUI(); } catch (e) { console.error(e); }
}

function toggleHold(nick) {
  const p = room.players.find((x) => x.nickname === nick);
  if (!p) return;

  pushUndo();
  p.onHold = !p.onHold;

  selected = selected.filter((x) => x !== nick);

  // 복귀하면 "지금부터 대기 시작"
  if (!p.onHold) p.lastPlay = room.round;

  if (chooserStatus) {
    chooserStatus.textContent = p.onHold
      ? `${nick} 님을 보류로 전환했습니다.`
      : `${nick} 님이 복귀했습니다.`;
  }

  try { refreshUI(); } catch (e) { console.error(e); }
}

// -----------------------
// 매칭 로직 (5판 대기 방지 가드 포함, 보류 제외)
// -----------------------
function wouldCauseHardCapViolation(chooserNick, oppNick) {
  const inMatch = new Set([chooserNick, oppNick]);
  return activePlayers().filter(
    (p) => computeIdle(p) >= 4 && !inMatch.has(p.nickname)
  );
}

function tryMatch() {
  if (selected.length < 2) return;

  const chooser = room.players.find((p) => p.nickname === selected[0]);
  const opponent = room.players.find((p) => p.nickname === selected[1]);

  if (!chooser || !opponent || chooser.nickname === opponent.nickname) {
    selected = [];
    try { refreshUI(); } catch (e) { console.error(e); }
    return;
  }

  if (isOnHold(chooser) || isOnHold(opponent)) {
    selected = [];
    showError(matchMsg, "보류 중인 플레이어는 매칭에 포함될 수 없습니다.");
    try { refreshUI(); } catch (e) { console.error(e); }
    return;
  }

  const capGroup = activePlayers().filter((p) => computeIdle(p) >= 4);
  if (capGroup.length >= 3) {
    const names = capGroup.map((p) => p.nickname).join(", ");
    showError(
      matchMsg,
      `현재 대기 4 이상 플레이어가 3명 이상이라 한 라운드에 모두 처리할 수 없습니다. (대상: ${names})`
    );
    selected = [];
    if (chooserStatus) chooserStatus.textContent = "대기 4 이상이 3명 이상이면 5판 대기 완전 방지는 불가능합니다.";
    try { refreshUI(); } catch (e) { console.error(e); }
    return;
  }

  const risky = wouldCauseHardCapViolation(chooser.nickname, opponent.nickname);
  if (risky.length > 0) {
    const names = risky.map((p) => p.nickname).join(", ");
    showError(
      matchMsg,
      `이 매칭을 확정하면 다음 라운드에 5판 대기가 발생합니다. 반드시 포함해야 하는 플레이어: ${names}`
    );
    selected = [];
    if (chooserStatus) chooserStatus.textContent = "5판 대기 방지를 위해 매칭 선택을 다시 해주세요.";
    try { refreshUI(); } catch (e) { console.error(e); }
    return;
  }

  pushUndo();

  const waitChooser = computeIdle(chooser);
  const waitOpp = computeIdle(opponent);

  chooser.waitSum = (chooser.waitSum ?? 0) + waitChooser;
  chooser.matchCount = (chooser.matchCount ?? 0) + 1;
  chooser.chooserCount = (chooser.chooserCount ?? 0) + 1;
  chooser.lastPlay = room.round + 1;

  opponent.waitSum = (opponent.waitSum ?? 0) + waitOpp;
  opponent.matchCount = (opponent.matchCount ?? 0) + 1;
  opponent.lastPlay = room.round + 1;

  room.round++;

  room.matchLog.push({
    round: room.round,
    chooser: chooser.nickname,
    opponent: opponent.nickname,
  });

  selected = [];
  if (chooserStatus) chooserStatus.textContent = "매칭 완료! 다시 두 명을 선택하세요.";
  showSuccess(matchMsgSuccess, "매칭이 기록되었습니다.");
  try { refreshUI(); } catch (e) { console.error(e); }
}

// -----------------------
// 취소 / 취소 취소
// -----------------------
function undoAction() {
  if (undoStack.length === 0) return;
  redoStack.push(coreSnapshot());
  const prev = undoStack.pop();
  applySnapshot(prev);
  if (chooserStatus) chooserStatus.textContent = "실행 취소되었습니다.";
  refreshUI();
}

function redoAction() {
  if (redoStack.length === 0) return;
  undoStack.push(coreSnapshot());
  const next = redoStack.pop();
  applySnapshot(next);
  if (chooserStatus) chooserStatus.textContent = "다시 실행되었습니다.";
  refreshUI();
}

// -----------------------
// 초기화
// -----------------------
function resetRoom() {
  if (!confirm("전체 초기화하시겠습니까?")) return;
  pushUndo();
  room = { round: 0, players: [], matchLog: [], seen: [], newcomerPriority: true };
  if (newcomerToggle) newcomerToggle.checked = true;
  selected = [];
  if (chooserStatus) chooserStatus.textContent = "초기화되었습니다.";
  try { refreshUI(); } catch (e) { console.error(e); }
}

// -----------------------
// 도움말 모달
// -----------------------
function openHelp() {
  if (!helpModal) return;
  helpModal.classList.add("open");
  helpModal.setAttribute("aria-hidden", "false");
}
function closeHelp() {
  if (!helpModal) return;
  helpModal.classList.remove("open");
  helpModal.setAttribute("aria-hidden", "true");
}

// -----------------------
// 이벤트 바인딩
// -----------------------
if (addBtn) addBtn.onclick = () => addPlayer((nicknameInput?.value ?? "").trim());
if (nicknameInput) {
  nicknameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPlayer((nicknameInput.value ?? "").trim());
  });
}

if (undoBtn) undoBtn.onclick = undoAction;
if (redoBtn) redoBtn.onclick = redoAction;
if (resetBtn) resetBtn.onclick = resetRoom;

if (newcomerToggle) {
  newcomerToggle.onchange = () => {
    pushUndo();
    room.newcomerPriority = newcomerToggle.checked;
    if (chooserStatus) chooserStatus.textContent = "설정이 변경되었습니다.";
    try { refreshUI(); } catch (e) { console.error(e); }
  };
}

if (playerTableBody) {
  playerTableBody.onclick = (e) => {
    const delBtn = e.target.closest(".small-delete");
    if (delBtn) {
      removePlayer(delBtn.dataset.name);
      return;
    }

    const holdBtn = e.target.closest(".small-hold");
    if (holdBtn) {
      toggleHold(holdBtn.dataset.name);
      return;
    }

    const tr = e.target.closest("tr");
    if (!tr) return;

    if (tr.dataset.onhold === "1") {
      if (chooserStatus) chooserStatus.textContent = "보류 중인 플레이어는 선택할 수 없습니다.";
      return;
    }

    const nickname = tr.dataset.nickname;
    if (!nickname) return;

    if (selected.includes(nickname)) {
      selected = selected.filter((x) => x !== nickname);
      applySelectionHighlight();
      return;
    }

    selected.push(nickname);
    applySelectionHighlight();

    if (selected.length === 2) tryMatch();
  };
}

if (helpBtn) helpBtn.onclick = openHelp;
if (helpCloseBtn) helpCloseBtn.onclick = closeHelp;

if (helpModal) {
  helpModal.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.dataset && target.dataset.close === "1") closeHelp();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeHelp();
});

// -----------------------
// 초기 표시
// -----------------------
try { refreshUI(); } catch (e) { console.error(e); }