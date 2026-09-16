/* 게임 화면 자동 인식 — 프레임 한 장을 받아 밴픽/라운드/결과 화면인지 가린다. */

function setAutoStatus(text, tone = 'idle') {
    const el = document.getElementById('autoCaptureStatus');
    const tones = { idle: 'text-slate-400', live: 'text-emerald-400', hit: 'text-blue-400', warn: 'text-yellow-400' };
    el.className = `text-xs font-bold tracking-wide ${tones[tone] || tones.idle}`;
    el.textContent = text;
}

function updateAutoCaptureUI() {
    const on = VMH.CaptureHub.isRunning();
    const general = currentMode === 'general';
    if (!on) setAutoStatus(general ? '게임 화면을 연결하면 방장이 고른 곡을 자동으로 인식합니다' : '게임 화면을 연결하면 밴픽 화면을 자동으로 인식합니다');
    else { autoCap.statusHold = 0; setAutoStatus(general ? '● 자동 인식 중 — 선곡 대기' : '● 자동 인식 중 — 밴픽 화면 대기', 'live'); }
}

/* 화면 공유는 페이지에 하나뿐이다 (lib/capture-hub.js). 여기서는 프레임 한 장을 받아
   무슨 화면인지 가리는 일만 하고, 연결/해제 버튼은 매칭 쪽과 같이 쓴다. */
VMH.CaptureHub.subscribe('floor', (frame, W, H) => autoCaptureFrame(frame, W, H));
VMH.CaptureHub.onChange(() => {
    if (!VMH.CaptureHub.isRunning()) Object.assign(autoCap, { lastKey: null, pendingKey: null, pendingCount: 0, markPendingKey: null, genCandId: null, genShownId: null });
    updateAutoCaptureUI();
});

/* 라운드/결과 화면이 연속 두 번 같은 내용으로 읽히면(등장 애니메이션 중 오인식 방지) 밴·플레이를 표시 */
async function autoCaptureMatchScreen(frame, W, H) {
    const info = readMatchScreen(frame, W, H, currentMatchEntry()?.rows || []);
    if (!info) { autoCap.markPendingKey = null; return false; }
    const key = info.rounds.map(h => h.id).join(',') + '|' + info.bans.map(h => h.id).join(',');
    if (key !== autoCap.markPendingKey) { autoCap.markPendingKey = key; return true; }
    const { changes, created, partial } = await applyMatchScreen(info, frame, async () => (await frameToImage(frame, W, H)).src);
    if (changes.length || created) {
        setAutoStatus(`● ${partial ? '라운드 화면에서 확인' : '자동 표시'}: ${changes.join(' · ')}`, 'hit');
        autoCap.statusHold = Date.now() + 8000; // 표시 결과를 잠시 보여준다
    }
    return true;
}

async function autoCaptureFrame(frame, W, H) {
    if (isProcessing || thumbRefs.length === 0) return;
    try {
        if (currentMode === 'general') { await generalAutoTick(frame, W, H); return; }

        const slots = [];
        for (let i = 0; i < 5; i++) {
            const r = versusSlotRect(i, W, H);
            if (sigTable.length) {
                // 자켓 시그니처로 가볍게 판정 (해시 방식의 약 1/7 비용). 곡 인식 자체는 밴픽으로 확정된 뒤 해시로 한다
                const hit = nearestSig(jacketSig(frame, r.x, r.y, r.w, r.h), sigTable);
                slots.push({ id: hit ? hit.item.id : null, ok: !!hit });
            } else {
                const thumb = cropToCanvas(frame, r.x, r.y, r.w, r.h);
                const m = getSortedMatches(aHashFromCanvas(thumb), dHashFromCanvas(thumb), getColorGridFromCanvas(thumb));
                slots.push({ id: m[0].id, ok: m[0].score <= AUTO_MAX_SCORE && (m[1].score - m[0].score) >= AUTO_MIN_GAP });
            }
        }
        const okCount = slots.filter(s => s.ok).length;
        if (okCount < AUTO_MIN_CONFIDENT) {
            autoCap.pendingKey = null; autoCap.pendingCount = 0;
            if (await autoCaptureMatchScreen(frame, W, H)) return;
            if (!autoCap.statusHold || Date.now() > autoCap.statusHold) setAutoStatus(`● 자동 인식 중 — 밴픽 화면 대기 (일치 ${okCount}/5)${autoAreaNote()}`, 'live');
            return;
        }

        const key = slots.map(s => s.id).join(',');
        if (key === autoCap.lastKey) return; // 이미 분석한 밴픽 화면
        if (key === autoCap.pendingKey) autoCap.pendingCount++; else { autoCap.pendingKey = key; autoCap.pendingCount = 1; }
        if (autoCap.pendingCount < AUTO_STABLE_TICKS) return;

        const img = await frameToImage(frame, W, H);
        if (currentMode !== 'versus' || isProcessing) { URL.revokeObjectURL(img.src); return; }
        autoCap.lastKey = key;
        analyzeScreenshot(img);
        setAutoStatus(`● 밴픽 화면 인식됨 (${new Date().toLocaleTimeString('ko-KR')})`, 'hit');
        autoCap.statusHold = Date.now() + 8000;
        autoCap.markPendingKey = null;
    } catch (e) {
        console.error('[AutoCapture]', e);
    }
}

/* 일망호 방 화면의 선곡 자켓 → 후보 목록(Recheck 순서)과 확신 여부.
   자켓 시그니처가 확실히 맞으면 그 곡을 1위로 올린다 (BPM 글자·바를 뺀 부분만 보므로 더 정확).
   confident는 자동 인식이 '곡이 떠 있는 화면'인지 가를 때만 쓴다 — 붙여넣기는 항상 1위를 보여준다 */
function readGeneralJacket(src, W, H) {
    const x = RATIO_GENERAL_X * W, y = RATIO_GENERAL_Y * H, w = RATIO_GENERAL_W * W, h = RATIO_GENERAL_H * H;
    const thumb = cropToCanvas(src, x, y, w, h);
    const matches = getSortedMatches(aHashFromCanvas(thumb), dHashFromCanvas(thumb), getColorGridFromCanvas(thumb));
    const sigHit = sigTable.length ? nearestSig(jacketSig(src, x, y, w, h), sigTable) : null;
    if (sigHit) {
        const i = matches.findIndex(m => String(m.id) === String(sigHit.item.id));
        if (i > 0) matches.unshift(...matches.splice(i, 1));
    }
    const confident = !!sigHit || (matches[0].score <= AUTO_MAX_SCORE && (matches[1].score - matches[0].score) >= AUTO_MIN_GAP);
    return { matches, confident };
}

/* 일망호 자동 인식: 같은 곡이 GENERAL_HOLD_MS 이상 떠 있으면 그 곡의 층수 표를 띄운다.
   이미 띄운 곡은 다시 띄우지 않으므로, 그 사이 검색으로 다른 곡을 보고 있어도 방장이 곡을 바꿀 때까지 그대로 둔다 */
async function generalAutoTick(frame, W, H) {
    const now = Date.now(), g = readGeneralJacket(frame, W, H);
    const idle = () => { if (!autoCap.statusHold || now > autoCap.statusHold) setAutoStatus(`● 자동 인식 중 — 선곡 대기${autoAreaNote()}`, 'live'); };
    if (!g.confident) { autoCap.genCandId = null; idle(); return; }
    const id = String(g.matches[0].id);
    if (id !== autoCap.genCandId) { autoCap.genCandId = id; autoCap.genSince = now; }
    if (id === autoCap.genShownId) { idle(); return; }

    const name = getSongDataSync(id).name || `ID ${id}`, held = now - autoCap.genSince;
    // 새 곡이 머물기 시작하면 이전 '곡 인식됨' 표시는 내린다 (안 그러면 곡이 사라져도 '확인 중'이 남는다)
    if (held < GENERAL_HOLD_MS) { autoCap.statusHold = 0; setAutoStatus(`● 선곡 확인 중 — ${name} (${(held / 1000).toFixed(1)}초)`, 'live'); return; }

    const img = await frameToImage(frame, W, H);
    if (currentMode !== 'general' || isProcessing) { URL.revokeObjectURL(img.src); return; }
    autoCap.genShownId = id;
    analyzeScreenshot(img, true);
    setAutoStatus(`● 곡 인식됨: ${name} (${new Date().toLocaleTimeString('ko-KR')})`, 'hit');
    autoCap.statusHold = Date.now() + 8000;
}
