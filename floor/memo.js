/* 패턴 메모(자작 태그) — 곡·버튼·난이도 조합마다 직접 붙이는 개인 태그. */

/* ── 패턴 메모(자작 태그) ─────────────────
   곡·버튼·난이도 조합마다 직접 붙이는 태그. LocalStorage에만 저장되고
   Copy 문구에는 넣지 않는다 (방에 공유되는 로페봇 태그와 달리 개인 메모).
   구조: { [titleId]: { '4B_SC': ['태그', ...] } } */
const MEMO_STORAGE_KEY = 'floorPatternMemosV1';
const MEMO_TAG_MAX_LEN = 20;
const MEMO_FILE_TYPE = 'floorPatternMemos';
let patternMemos = loadPatternMemos();
const memoEditor = { open: false, titleId: null, button: null, difficulty: null, name: '' };

function loadPatternMemos() {
    try {
        const d = JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY));
        return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    } catch (e) { return {}; }
}

function savePatternMemos() {
    try { localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(patternMemos)); }
    catch (e) { showTemporaryMessage('메모 저장 실패 (브라우저 저장소를 쓸 수 없음)', 4000); }
}

function getPatternMemo(titleId, button, difficulty) {
    const tags = patternMemos[String(titleId)]?.[`${button}_${difficulty}`];
    return Array.isArray(tags) ? tags : [];
}

function setPatternMemo(titleId, button, difficulty, tags) {
    const id = String(titleId), key = `${button}_${difficulty}`;
    if (tags.length) (patternMemos[id] = patternMemos[id] || {})[key] = tags;
    else if (patternMemos[id]) { delete patternMemos[id][key]; if (!Object.keys(patternMemos[id]).length) delete patternMemos[id]; }
    savePatternMemos();
    refreshMemoViews();
}

/* 대괄호는 표시할 때 붙이므로 벗기고, 공백은 하나로 줄이고, 쉼표는 구분자라 뺀다 */
function normalizeMemoTag(s) {
    return String(s).replace(/[\[\],]/g, '').replace(/\s+/g, ' ').trim().slice(0, MEMO_TAG_MAX_LEN);
}

/* 메모가 바뀌면 지금 보이는 카드뿐 아니라 스샷 히스토리에 보관된 카드도 다시 그린다 */
function refreshMemoViews() {
    shotHistory.versus.forEach(entry => entry.rows.forEach(row => {
        const tC = row.querySelector('.tags-container'), bS = row.querySelector('.btn-select'), dS = row.querySelector('.diff-select');
        if (tC && bS && dS) tC.innerHTML = getSongTagsHtml(row.getAttribute('data-title-id'), bS.value, dS.value, 'justify-center');
    }));
    shotHistory.general.forEach(entry => entry.rows.forEach(row => {
        const tId = row.getAttribute('data-title-id');
        row.querySelectorAll('.grid-cell[data-btn]').forEach(cell => {
            cell.querySelector('.cell-tags')?.remove();
            cell.insertAdjacentHTML('beforeend', generalCellTagsHtml(tId, cell.dataset.btn, cell.dataset.diff));
        });
    }));
}

function openMemoFromRow(btn) {
    const row = btn.closest('.track-row');
    openMemoEditor(row.getAttribute('data-title-id'), row.querySelector('.btn-select').value, row.querySelector('.diff-select').value, row.querySelector('h3')?.innerText);
}

function openMemoFromCell(btn) {
    const cell = btn.closest('.grid-cell');
    openMemoEditor(cell.closest('.track-row').getAttribute('data-title-id'), cell.dataset.btn, cell.dataset.diff);
}

function openMemoEditor(titleId, button, difficulty, fallbackName = '') {
    if (!titleId) return;
    const d = getSongDataSync(titleId);
    Object.assign(memoEditor, { open: true, titleId: String(titleId), button, difficulty, name: d.success ? d.name : fallbackName });
    renderMemoEditor();
    document.getElementById('memoModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    const input = document.getElementById('memoInput');
    input.value = ''; input.focus();
}

function closeMemoEditor() {
    memoEditor.open = false;
    document.getElementById('memoModal').classList.remove('active');
    document.body.style.overflow = '';
}

function renderMemoEditor() {
    const { titleId, button, difficulty, name } = memoEditor;
    const p = getSongDataSync(titleId).patterns?.[button]?.[difficulty];
    document.getElementById('memoSongName').textContent = name || `ID ${titleId}`;

    const chip = (cls, text, style = '') => `<span class="px-2 py-0.5 rounded-md text-xs font-black text-white ${cls}"${style ? ` style="${style}"` : ''}>${text}</span>`;
    document.getElementById('memoPatternInfo').innerHTML = chip(BTN_COLORS[button] || 'bg-slate-700', button) + chip(DIFF_COLORS[difficulty] || 'bg-slate-700', difficulty)
        + (p ? chip('', escapeHtml(`${circledLevel(p.level)} ${patternFloorName(p)}`.trim()), `background-color: ${getDifficultyBgColor(p.level, difficulty, p.floor ?? '-')}`) : '');

    // 참고용: 로페봇이 이미 붙여둔 태그
    const refTags = getSongTagList(titleId, button, difficulty).filter(t => t.type !== 'custom');
    document.getElementById('memoRefTags').innerHTML = refTags.map(t => `<span class="px-1.5 py-0.5 rounded text-[11px] font-bold border bg-slate-800/60 text-slate-400 border-slate-700/50">[${escapeHtml(t.text)}]</span>`).join('');

    const tags = getPatternMemo(titleId, button, difficulty);
    document.getElementById('memoTagList').innerHTML = tags.length
        ? tags.map((t, i) => `<span class="memo-chip">${escapeHtml(t)}<button title="삭제" onclick="removeMemoTag(${i})">×</button></span>`).join('')
        : `<span class="text-xs text-slate-500 self-center">아직 붙인 태그가 없습니다</span>`;

    // 다른 패턴에 붙였던 태그를 많이 쓴 순으로 — 같은 표현을 일관되게 쓰기 쉽게
    const counts = new Map();
    Object.values(patternMemos).forEach(song => Object.values(song).forEach(list => list.forEach(t => counts.set(t, (counts.get(t) || 0) + 1))));
    const suggest = [...counts].filter(([t]) => !tags.includes(t)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 24);
    document.getElementById('memoSuggestWrap').classList.toggle('hidden', !suggest.length);
    document.getElementById('memoSuggestList').innerHTML = suggest.map(([t]) => `<button class="memo-suggest" data-tag="${escapeHtml(t)}" onclick="addMemoTags(this.dataset.tag)">${escapeHtml(t)}</button>`).join('');
}

function addMemoTags(text) {
    const { titleId, button, difficulty } = memoEditor;
    const tags = [...getPatternMemo(titleId, button, difficulty)], before = tags.length;
    String(text).split(',').map(normalizeMemoTag).forEach(t => { if (t && !tags.includes(t)) tags.push(t); });
    if (tags.length !== before) { setPatternMemo(titleId, button, difficulty, tags); renderMemoEditor(); }
    document.getElementById('memoInput').focus();
}

function addMemoFromInput() {
    const input = document.getElementById('memoInput');
    if (!input.value.trim()) return;
    addMemoTags(input.value);
    input.value = '';
}

function removeMemoTag(i) {
    const { titleId, button, difficulty } = memoEditor;
    setPatternMemo(titleId, button, difficulty, getPatternMemo(titleId, button, difficulty).filter((_, j) => j !== i));
    renderMemoEditor();
}

function handleMemoKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 글자 확정용 — 여기서 받으면 마지막 글자가 따로 추가된다
    if (e.key === 'Enter') { e.preventDefault(); addMemoFromInput(); }
}

/* ── 메모 파일 내보내기/가져오기 ─────────────────
   LocalStorage는 브라우저·주소(file:// 와 서버)마다 따로라서, 옮기거나 백업할 때 쓴다.
   가져오기는 덮어쓰지 않고 합친다 (같은 패턴이면 태그를 합집합) */
function exportPatternMemos() {
    const count = Object.values(patternMemos).reduce((n, song) => n + Object.values(song).reduce((m, l) => m + l.length, 0), 0);
    if (!count) { showTemporaryMessage('내보낼 메모가 없습니다'); return; }
    const file = { type: MEMO_FILE_TYPE, version: 1, exportedAt: new Date().toISOString(), memos: patternMemos };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `floor-memos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showTemporaryMessage(`메모 ${count}개 내보냄`);
}

function importPatternMemos(input) {
    const f = input.files[0]; input.value = ''; // 같은 파일을 다시 골라도 onchange가 오도록
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        let data;
        try { data = JSON.parse(e.target.result); } catch (err) { alert('메모 파일을 읽을 수 없습니다 (JSON 형식 아님)'); return; }
        const memos = data?.type === MEMO_FILE_TYPE ? data.memos : data;
        if (!memos || typeof memos !== 'object' || Array.isArray(memos)) { alert('메모 파일 형식이 아닙니다'); return; }
        let added = 0;
        for (const [id, song] of Object.entries(memos)) {
            if (!song || typeof song !== 'object') continue;
            for (const [key, list] of Object.entries(song)) {
                if (!/^[4568]B_(NM|HD|MX|SC)$/.test(key) || !Array.isArray(list)) continue;
                const cur = patternMemos[id]?.[key] || [], merged = [...cur];
                list.map(normalizeMemoTag).forEach(t => { if (t && !merged.includes(t)) merged.push(t); });
                if (merged.length === cur.length) continue;
                added += merged.length - cur.length;
                (patternMemos[id] = patternMemos[id] || {})[key] = merged;
            }
        }
        savePatternMemos(); refreshMemoViews();
        if (memoEditor.open) renderMemoEditor();
        showTemporaryMessage(added ? `메모 ${added}개 가져옴` : '새로 추가된 메모가 없습니다 (이미 모두 있음)', 4000);
    };
    reader.readAsText(f);
}

/* 메모 전부 지우기 — 되돌릴 수 없으니 개수를 보여주고 먼저 내보내기를 권한다 */
function clearPatternMemos() {
    const count = Object.values(patternMemos).reduce((n, song) => n + Object.values(song).reduce((m, l) => m + l.length, 0), 0);
    if (!count) { showTemporaryMessage('지울 메모가 없습니다'); return; }
    if (!confirm(`패턴 메모 ${count}개를 모두 지웁니다.\n되돌릴 수 없으니 필요하면 먼저 '내보내기'로 백업해 두세요.\n\n계속할까요?`)) return;
    patternMemos = {};
    savePatternMemos(); refreshMemoViews();
    if (memoEditor.open) renderMemoEditor();
    showTemporaryMessage(`메모 ${count}개를 지웠습니다`);
}

// 다른 탭에서 메모를 고치면 이 탭에도 반영
window.addEventListener('storage', (e) => {
    if (e.key !== MEMO_STORAGE_KEY) return;
    patternMemos = loadPatternMemos(); refreshMemoViews();
    if (memoEditor.open) renderMemoEditor();
});
document.addEventListener('keydown', (e) => { if (memoEditor.open && e.key === 'Escape') closeMemoEditor(); });
