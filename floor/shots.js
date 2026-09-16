/* 붙여넣은 스크린샷 히스토리와 분석 진입점. */

/* ── 스크린샷 히스토리 ─────────────────
   붙여넣은 스샷을 모드별로 쌓아두고 좌우 버튼으로 되돌아본다.
   결과 카드 DOM 자체를 보관하므로 밴픽(플레이/밴) 표시와
   버튼/난이도 수정값까지 그대로 남는다. (새로고침하면 초기화) */
const SHOT_HISTORY_MAX = 20;
const shotHistory = { versus: [], general: [] };
const shotIndex = { versus: -1, general: -1 };

function addShot(src, rows, hash) {
    const list = shotHistory[currentMode], entry = { src, rows, hash: hash || null };
    list.push(entry);
    while (list.length > SHOT_HISTORY_MAX) {
        const dropped = list.shift();
        if (dropped.src && dropped.src.startsWith('blob:')) URL.revokeObjectURL(dropped.src);
    }
    showShot(list.length - 1);
    return entry;
}

function showShot(i) {
    const list = shotHistory[currentMode];
    if (i < 0 || i >= list.length) return;
    shotIndex[currentMode] = i;
    const entry = list[i];
    lastImageHash = entry.hash;
    const cont = document.getElementById('screenshotContainer');
    if (entry.src) {
        document.getElementById('screenshotPreview').src = entry.src;
        cont.style.display = 'flex';
    } else cont.style.display = 'none';
    document.getElementById('dropZone').style.display = 'none';
    resultList.innerHTML = '';
    entry.rows.forEach(r => resultList.appendChild(r));
    updateShotNav();
}

function navigateShot(delta) { showShot(shotIndex[currentMode] + delta); }

function updateShotNav() {
    const list = shotHistory[currentMode], i = shotIndex[currentMode];
    document.getElementById('shotViewer').style.display = list.length > 0 ? 'flex' : 'none';
    document.getElementById('shotPrev').disabled = i <= 0;
    document.getElementById('shotNext').disabled = i >= list.length - 1;
    const entry = list[i];
    document.getElementById('shotCounter').textContent =
        list.length > 0 ? `${i + 1} / ${list.length}${entry?.partial ? ' (라운드 화면에서 확인된 곡만)' : entry && !entry.src ? ' (검색)' : ''}` : '';
}

window.addEventListener('paste', async (e) => {
    if (VMH.Tabs.active !== 'floor') return;   // 매칭 탭을 보고 있으면 그쪽이 받는다
    if (memoEditor.open) return; // 메모 입력칸에 글자를 붙여넣는 중
    const now = Date.now(); if (isProcessing) return;
    if (now - (window.lastProcessTime || 0) < COOLDOWN_MS) { showTemporaryMessage("쿨다운 중..."); return; }
    const items = e.clipboardData.items;
    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile(), img = new Image(); img.src = URL.createObjectURL(blob);
            img.onload = () => fitGameArea(img).then(g => analyzeScreenshot(g)).catch(err => console.error('[Paste]', err));
        }
    }
});

/* 붙여넣기와 게임 화면 자동 인식이 함께 쓰는 진입점.
   force: 동일 이미지 검사를 건너뛴다 — 일망호 방 화면은 자켓이 작아서 곡이 달라도 전체 해시가 같게 나올 수 있다 */
function analyzeScreenshot(img, force = false) {
    const prev = document.getElementById('screenshotPreview'), cont = document.getElementById('screenshotContainer'), drop = document.getElementById('dropZone');
    const full = document.createElement('canvas'); full.width = img.width; full.height = img.height; full.getContext('2d').drawImage(img, 0, 0);
    const hash = dHashFromCanvas(full); if (!force && lastImageHash && hamDist(lastImageHash, hash) === 0) { showTemporaryMessage("동일 이미지"); return; }
    // 라운드/결과 화면을 붙여넣은 경우: 새 밴픽으로 분석하지 않고 밴·플레이만 표시
    // (밴픽창이 없던 판이면 확인된 곡만으로 카드를 만든다)
    const info = currentMode === 'versus' ? readMatchScreen(img, img.width, img.height, currentMatchEntry()?.rows || []) : null;
    if (info) {
        let used = false;
        applyMatchScreen(info, img, async () => { used = true; return img.src; }).then(({ changes, created }) => {
            showTemporaryMessage(changes.length ? `자동 표시: ${changes.join(' · ')}` : created ? '라운드 화면에서 곡 확인' : '이미 반영된 라운드 화면', 4000);
        }).catch(e => console.error('[MatchScreen]', e)).finally(() => { if (!used) URL.revokeObjectURL(img.src); });
        return;
    }
    if (drop) drop.style.display = 'none';
    document.getElementById('shotViewer').style.display = 'flex';
    cont.style.display = 'flex'; prev.src = img.src;
    isProcessing = true; lastImageHash = hash; window.lastProcessTime = Date.now();
    // 분석이 터져도 isProcessing이 풀려야 다음 붙여넣기가 먹는다.
    // (아주 작은 그림처럼 게임 스샷이 아닌 것을 붙여넣으면 좌표 계산이 깨질 수 있다)
    processImage(img, hash)
        .catch(err => { console.error('[Analyze]', err); showTemporaryMessage('이 이미지는 분석할 수 없습니다'); })
        .finally(() => { isProcessing = false; });
}
