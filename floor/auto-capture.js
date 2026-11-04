/* 게임 화면 자동 인식 — 프레임 한 장을 받아 밴픽/라운드/결과 화면인지 가린다. */

function setAutoStatus(text, tone = 'idle') {
    const el = document.getElementById('autoCaptureStatus');
    const tones = { idle: 'text-slate-400', live: 'text-emerald-400', hit: 'text-blue-400', warn: 'text-yellow-400' };
    el.className = `text-xs font-bold tracking-wide ${tones[tone] || tones.idle}`;
    el.textContent = text;
}

function updateAutoCaptureUI() {
    const on = VMH.CaptureHub.receiving('floor');
    const general = currentMode === 'general';
    if (!on && VMH.CaptureHub.isRunning()) setAutoStatus('화면 공유를 매칭 도우미에만 주는 중 — 옵션 탭에서 바꿀 수 있습니다');
    else if (!on) setAutoStatus(general ? '게임 화면을 연결하면 방장이 고른 곡을 자동으로 인식합니다' : '게임 화면을 연결하면 밴픽 화면을 자동으로 인식합니다');
    else { autoCap.statusHold = 0; setAutoStatus(general ? '● 자동 인식 중 — 선곡 대기' : '● 자동 인식 중 — 밴픽 화면 대기', 'live'); }
}

/* 화면 공유는 페이지에 하나뿐이다 (lib/capture-hub.js). 여기서는 프레임 한 장을 받아
   무슨 화면인지 가리는 일만 하고, 연결/해제 버튼은 매칭 쪽과 같이 쓴다. */
VMH.CaptureHub.subscribe('floor', (frame, W, H, info) => autoCaptureFrame(frame, W, H, info));
// 화면 공유 경고(게임 화면을 못 찾음 등)는 평소 매칭 쪽이 띄운다. 층수 측정기만 받을 때는 여기서
VMH.CaptureHub.onStatus((text, tone) => { if (tone === 'warn' && VMH.CaptureHub.target === 'floor') setAutoStatus(text, 'warn'); });
VMH.CaptureHub.onChange(() => {
    // 연결/수신 대상이 바뀌기 전에 떠 둔 비동기 프레임을 나중에 적용하지 않는다.
    floorWorkVersion++;
    if (!VMH.CaptureHub.receiving('floor')) Object.assign(autoCap, { lastKey: null, pendingKey: null, pendingCount: 0, markPendingKey: null, genCandId: null, genShownId: null });
    updateAutoCaptureUI();
});

/* 라운드/결과 화면이 연속 두 번 같은 내용으로 읽히면(등장 애니메이션 중 오인식 방지) 밴·플레이를 표시 */
async function autoCaptureMatchScreen(frame, W, H) {
    const work = floorWorkContext();
    const info = readMatchScreen(frame, W, H, currentMatchEntry()?.rows || []);
    if (!info) { autoCap.markPendingKey = null; return false; }
    const key = info.rounds.map(h => h.id).join(',') + '|' + info.bans.map(h => h.id).join(',');
    if (key !== autoCap.markPendingKey) { autoCap.markPendingKey = key; return true; }
    const { changes, created, partial } = await applyMatchScreen(info, frame, async () => (await frameToImage(frame, W, H)).src);
    if (!floorWorkCurrent(work)) return true;
    if (changes.length || created) {
        setAutoStatus(`● ${partial ? '라운드 화면에서 확인' : '자동 표시'}: ${changes.join(' · ')}`, 'hit');
        autoCap.statusHold = Date.now() + 8000; // 표시 결과를 잠시 보여준다
    }
    return true;
}

async function autoCaptureFrame(frame, W, H, info) {
    if (info && info.stale) {
        Object.assign(autoCap, { pendingKey: null, pendingCount: 0, markPendingKey: null, genCandId: null, genSince: 0 });
        setAutoStatus('● 화면이 멈춰 있습니다 — 새 화면을 기다리는 중', 'warn');
        return;
    }
    if (isProcessing || thumbRefs.length === 0) return;
    const work = floorWorkContext();
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
        // 밴픽 화면이 확정되면 이 탭으로 (화면 자동 전환 옵션 — 화면이 바뀔 때 한 번만 넘긴다)
        if (key === autoCap.lastKey) { VMH.Tabs.follow('floor'); return; } // 이미 분석한 밴픽 화면
        if (key === autoCap.pendingKey) autoCap.pendingCount++; else { autoCap.pendingKey = key; autoCap.pendingCount = 1; }
        if (autoCap.pendingCount < AUTO_STABLE_TICKS) return;
        VMH.Tabs.follow('floor');

        const img = await frameToImage(frame, W, H);
        if (!floorWorkCurrent(work) || currentMode !== 'versus' || isProcessing || !VMH.CaptureHub.receiving('floor')) { URL.revokeObjectURL(img.src); return; }
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
    const confident = !!sigHit || (matches.length > 1 && matches[0].score <= AUTO_MAX_SCORE && (matches[1].score - matches[0].score) >= AUTO_MIN_GAP);
    return { matches, confident };
}

/* OPEN MATCH 대기방의 좌상단 ONLINE / OPEN MATCH 글자 구조.
   images/lobby_001~005.png의 같은 자리(2560x1440에서 x195 y28 w300 h78)를
   공용 dHash로 줄여 가로 차분을 뜨고, 다섯 장에서 모두 같은 124비트만 남겼다.
   배경의 노랑/회색과 움직임은 비교하지 않는다. 24비트 여유는 축소/압축용이며,
   자켓이 우연히 닮았다는 이유만으로 플레이 화면(BGA)을 선곡 화면으로 받지 않는다.
   실제 플레이 chat/20260922001531_1.jpg와 free_result의 결과 화면에는 이 헤더가 없다.
   프리매치 대기방 양성 스샷은 아직 없어 해당 화면의 헤더 배치 확인은 후속 실측 대상이다. */
const GENERAL_ROOM_HEADER = {
    mask: [571538944, 4263575040, 4261478144, 4261453824, 4286118774, 3202547438, 4276282582, 4229431296],
    bits: [571520000, 2483083264, 3623920896, 2751504384, 3613436720, 706767404, 1249944784, 3020947456]
};
function isGeneralRoomScreen(frame, W, H) {
    if (!frame || !W || !H) return false;
    // 버서스 로비를 일망호 모드로 보고 있을 때도 안전한 대기방이다.
    // 글자 위를 펫 커서가 가린 실제 캡처는 독립적인 PLAYER 꼬리표로 확인한다.
    if (VMH.Room && VMH.Room.isLobbyScreen(frame, W, H)) return true;
    const region = cropToCanvas(frame, 195 * W / BASE_W, 28 * H / BASE_H, 300 * W / BASE_W, 78 * H / BASE_H);
    const hash = dHashFromCanvas(region);
    let distance = 0;
    for (let i = 0; i < hash.length; i++) distance += popcnt32((hash[i] ^ GENERAL_ROOM_HEADER.bits[i]) & GENERAL_ROOM_HEADER.mask[i]);
    return distance <= 24;
}

/* 일망호 자동 인식: 대기방에서 같은 곡이 GENERAL_HOLD_MS 이상 떠 있으면 그 곡의 층수 표를 띄운다.
   이미 띄운 곡은 다시 띄우지 않으므로, 그 사이 검색으로 다른 곡을 보고 있어도 방장이 곡을 바꿀 때까지 그대로 둔다 */
async function generalAutoTick(frame, W, H) {
    const work = floorWorkContext();
    // 부재 판정부터 한다. 인게임/결과/로딩에서는 자켓 후보를 만들지도 않고,
    // 대기방에서 세던 2초도 끊는다. 이미 띄운 표는 그대로 보존한다.
    if (!isGeneralRoomScreen(frame, W, H)) {
        autoCap.genCandId = null; autoCap.genSince = 0; autoCap.statusHold = 0;
        setAutoStatus(`● 자동 인식 중 — 대기방 선곡 화면 대기${autoAreaNote()}`, 'live');
        return;
    }
    const now = Date.now(), g = readGeneralJacket(frame, W, H);
    const idle = () => { if (!autoCap.statusHold || now > autoCap.statusHold) setAutoStatus(`● 자동 인식 중 — 선곡 대기${autoAreaNote()}`, 'live'); };
    // 일망호 자켓은 QHD에서도 80px이다. 240px 밴픽 자켓에서 잰 점수/차이로
    // 거르면 스크린샷으로 읽히는 곡도 계속 '선곡 대기'가 된다. 대기방임을 위에서
    // 확인했으므로 스크린샷과 같은 후보를 쓰고, 아래의 2초 유지로 선곡을 확정한다.
    const best = g.matches[0];
    if (!best || !Number.isFinite(best.score)) { autoCap.genCandId = null; autoCap.genSince = 0; idle(); return; }
    const id = String(best.id);
    if (id !== autoCap.genCandId) { autoCap.genCandId = id; autoCap.genSince = now; }
    if (id === autoCap.genShownId) { idle(); return; }

    const name = getSongDataSync(id).name || `ID ${id}`, held = now - autoCap.genSince;
    // 새 곡이 머물기 시작하면 이전 '곡 인식됨' 표시는 내린다 (안 그러면 곡이 사라져도 '확인 중'이 남는다)
    if (held < GENERAL_HOLD_MS) { autoCap.statusHold = 0; setAutoStatus(`● 선곡 확인 중 — ${name} (${(held / 1000).toFixed(1)}초)`, 'live'); return; }

    const img = await frameToImage(frame, W, H);
    if (!floorWorkCurrent(work) || currentMode !== 'general' || isProcessing || !VMH.CaptureHub.receiving('floor')) { URL.revokeObjectURL(img.src); return; }
    autoCap.genShownId = id;
    analyzeScreenshot(img, true);
    setAutoStatus(`● 곡 인식됨: ${name} (${new Date().toLocaleTimeString('ko-KR')})`, 'hit');
    autoCap.statusHold = Date.now() + 8000;
}
