/* 라운드·결과 화면을 읽어 밴된 곡과 플레이된 곡(라운드 번호)을 표시한다. */

/* ── 게임 화면 자동 인식 ─────────────────
   화면 공유(getDisplayMedia)로 게임 화면을 받아 0.5초마다 검사한다.
   버망호: 5개 슬롯의 자켓이 확실히 일치하는 슬롯이 충분하고 같은 곡 구성이 연속으로 보이면
   밴픽 화면으로 보고, 곡 구성이 직전과 달라졌을 때만 새로 분석한다.
   (같은 곡 구성이면 다시 분석하지 않으므로 찍어둔 밴픽 표시가 유지된다)
   일망호: 방 화면의 선곡 자켓 한 칸을 보고, 같은 곡이 GENERAL_HOLD_MS 이상 유지되면 층수 표를 띄운다. */
const AUTO_INTERVAL_MS = 500;
const GENERAL_HOLD_MS = 2000;   // 방장이 곡을 넘겨보는 중에는 계속 바뀌므로, 이만큼 머문 곡만 띄운다
// 실제 스샷 기준: 밴픽창 슬롯은 1위 41~69점 / 2위와 차이 156~199, 라운드·결과 화면은 1위 229점 이상 / 차이 37 이하
const AUTO_MAX_SCORE = 140;     // 1위 후보 점수가 이보다 낮아야 '자켓 일치'
const AUTO_MIN_GAP = 60;        // 1위와 2위 후보의 점수 차 — 작으면 아무 곡과도 뚜렷이 안 맞는 것
const AUTO_MIN_CONFIDENT = 4;   // 5개 중 이만큼 일치하면 밴픽 화면 (DB에 없는 신곡 1개는 허용)
const AUTO_STABLE_TICKS = 2;    // 같은 곡 구성이 연속으로 이만큼 보여야 인식 (화면 전환 중 오인식 방지)
// 무엇을 보고 있는지에 대한 기억만 남는다 — 스트림·창 테두리 보정은 lib/screen-capture.js가 들고 있다
const autoCap = { lastKey: null, pendingKey: null, pendingCount: 0, markPendingKey: null, statusHold: 0,
    genCandId: null, genSince: 0, genShownId: null }; // 일망호: 지금 머물고 있는 곡 / 머물기 시작한 시각 / 마지막으로 띄운 곡
const autoAreaNote = () => VMH.CaptureHub.areaNote();

function versusSlotRect(i, W, H) {
    return { x: (RATIO_X_START + (RATIO_THUMB_W + RATIO_GAP) * i) * W, y: RATIO_Y_START * H, w: RATIO_THUMB_W * W, h: RATIO_THUMB_H * H };
}

/* ── 라운드/결과 화면 → 밴·플레이 자동 표시 ─────────────────
   라운드 화면과 결과 화면의 자켓 칸을 읽어 밴된 곡과 플레이된 곡(라운드 번호)을 표시한다.
   각 칸은 먼저 지금 카드들(밴픽창에서 잘라둔 자켓)과 비교하고, 없으면 hashes.json의 sig(전체 곡)와 비교한다.
   그래서 밴픽창을 놓치고 라운드 화면부터 봐도, 확인된 곡만으로 카드를 만들어 보여준다.
   비교는 자켓 중 BPM 글자(위)와 버튼/난이도 바(아래)가 덮지 않는 부분만 쓴다.
   좌표는 2560x1440 기준. 라운드 k 화면: 지난 라운드는 작은 칸, 현재 라운드는 큰 칸(둘 다 중심이 같다),
   이후 라운드는 '?' 칸. 결과 화면은 3칸이 조금 아래로 내려와 있고 밴 칸이 없다. */
const ROUND_BIG = { x: 1160, y: 227, size: 240, step: 400 };
const ROUND_SMALL = { x: 1196, y: 263, size: 168, step: 400 };
const RESULT_BOX = { x: 1200, y: 360, size: 160, step: 373 };
const BAN_BOXES = [{ x: 2087, y: 1267, size: 93 }, { x: 2220, y: 1267, size: 93 }];
// 자켓 시그니처 — generate-hashes.js의 jacketSigFromCanvas와 같은 계산이어야 한다
const SIG_W = 12, SIG_H = 8, SIG_X0 = 0.06, SIG_X1 = 0.94, SIG_Y0 = 0.2, SIG_Y1 = 0.78;
// 실제 스샷 기준: 같은 자켓 1~4, 다른 자켓·'?' 칸·밴픽창 등 엉뚱한 자리는 12 이상
const SIG_MAX_DIST = 8;     // 칸별 평균 색 차이(0~255)가 이보다 작아야 같은 자켓
const SIG_MAX_RATIO = 0.5;  // 1위가 2위보다 확실히 가까워야 인정
let sigTable = [];          // [{ id, sig }] — hashes.json thumbnails[].sig

function loadSigTable(thumbs) {
    sigTable = thumbs.filter(t => t.sig).map(t => ({ id: t.id, sig: Uint8Array.from(atob(t.sig), c => c.charCodeAt(0)) }));
}

function jacketSig(src, x, y, w, h) {
    const c = cropToCanvas(src, x + w * SIG_X0, y + h * SIG_Y0, w * (SIG_X1 - SIG_X0), h * (SIG_Y1 - SIG_Y0));
    const cw = c.width, ch = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cw, ch).data;
    const out = new Uint8Array(SIG_W * SIG_H * 3);
    for (let cy = 0; cy < SIG_H; cy++) {
        for (let cx = 0; cx < SIG_W; cx++) {
            const xa = Math.floor(cx * cw / SIG_W), xb = Math.max(xa + 1, Math.floor((cx + 1) * cw / SIG_W));
            const ya = Math.floor(cy * ch / SIG_H), yb = Math.max(ya + 1, Math.floor((cy + 1) * ch / SIG_H));
            let r = 0, g = 0, b = 0, n = 0;
            for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) { const i = (yy * cw + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
            const o = (cy * SIG_W + cx) * 3;
            out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
        }
    }
    return out;
}

function sigDist(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
}

function nearestSig(sig, list) {
    let best = null, bestD = Infinity, secondD = Infinity;
    for (const it of list) {
        const d = sigDist(sig, it.sig);
        if (d < bestD) { secondD = bestD; bestD = d; best = it; } else if (d < secondD) secondD = d;
    }
    return (best && bestD <= SIG_MAX_DIST && bestD <= secondD * SIG_MAX_RATIO) ? { item: best, d: bestD } : null;
}

function barFeatures(src, x, y, w, h) {
    const bar = cropToCanvas(src, x, y, w, h);
    const left = cropToCanvas(bar, 0, 0, bar.width * BAR_SPLIT, bar.height), right = cropToCanvas(bar, left.width, 0, bar.width * (1 - BAR_SPLIT), bar.height);
    return { btnPh: pHashFromCanvas(binarizeButton(left)), btnColor: getColorGridFromCanvas(left), diffPh: pHashFromCanvas(binarizeDifficulty(right)),
             diffBox: readDiffBox(src, x, y, w, h) };
}

/* ── 난이도 칸 읽기: 글자 폭 + 글자 색 ─────────────────────
   바 오른쪽의 어두운 네모 칸 안에 난이도가 그 색 글자로 적혀 있다 — SC(분홍) · HARD(주황) · MAXIMUM(빨강) · NORMAL.
   예전에는 칸을 이진화해 pHash 한 장과 견줬는데, 라운드·결과 화면의 겹쳐 그린 작은 바에서 SC가 NM으로 자주 읽혔다
   (실측 23칸 중 8칸이 오독이거나 동점). 글자 모양 대신 두 가지를 잰다:
     ① 글자 폭 / 칸 안쪽 폭 — 크기·위치와 무관하다. 실측 SC 0.20~0.23 · HARD 0.53~0.54 · MAXIMUM 0.87~0.96
     ② 글자 색상각(원형 평균) — 실측 SC 315~331° · MAXIMUM 335~347° · HARD 23°
   SC와 MAXIMUM은 색이 가까워 폭으로, NORMAL과 MAXIMUM은 폭이 가까워 색으로 가른다.
   (밴픽·래더·라운드·결과 스샷 41칸, 픽셀마다 ±12 잡음까지 205번 모두 정답)
   NORMAL은 스샷이 없어 게임 색(노랑)을 가정했다 — 어느 칸에도 안 맞으면 null이고, 그때는 예전 pHash로 읽는다.
   칸은 바 자리보다 위아래로 넉넉히 잘라 그 안에서 찾으므로 라운드 화면의 1~4px 어긋남도 상관없다. */
const DIFF_DARK = 70;           // 칸 안쪽 = 가장 밝은 채널이 이보다 어둡다
const DIFF_INK_MIN = 90;        // 글자 = 이만큼 밝고
const DIFF_INK_SAT = 40;        //        채널 차이가 이만큼 난다 (회색 잡음 제외)
function readDiffBox(src, x, y, w, h) {
    const u = w / 240, c = cropToCanvas(src, x + w * 0.42, y - 6 * u, w * 0.58, h + 12 * u);
    const W = c.width, H = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const bright = (px, py) => { const i = (py * W + px) * 4; return Math.max(d[i], d[i + 1], d[i + 2]); };
    const longestRun = (arr, ok) => {
        let best = [0, 0], s = -1;
        for (let i = 0; i <= arr.length; i++) {
            if (i < arr.length && ok(arr[i])) { if (s < 0) s = i; }
            else if (s >= 0) { if (i - s > best[1] - best[0]) best = [s, i]; s = -1; }
        }
        return best;
    };
    // 세로: 어두운 픽셀이 있는 줄이 가장 길게 이어진 곳 (위의 자켓과는 밝은 바 바탕으로 끊긴다)
    const rowF = [];
    for (let py = 0; py < H; py++) { let n = 0; for (let px = 0; px < W; px++) if (bright(px, py) < DIFF_DARK) n++; rowF.push(n / W); }
    const [y0, y1] = longestRun(rowF, f => f >= 0.02);
    if (y1 - y0 < 6) return null;
    // 가로: 글자가 없는 위아래 가장자리 줄만 보고 칸 폭을 잰다 (글자 줄까지 보면 MAXIMUM이 칸을 둘로 쪼갠다)
    const q = Math.max(1, Math.round((y1 - y0) * 0.2)), edge = [];
    for (let py = y0; py < y0 + q; py++) edge.push(py);
    for (let py = y1 - q; py < y1; py++) edge.push(py);
    const colF = [];
    for (let px = 0; px < W; px++) { let n = 0; for (const py of edge) if (bright(px, py) < DIFF_DARK) n++; colF.push(n / edge.length); }
    const [x0, x1] = longestRun(colF, f => f >= 0.5);
    if (x1 - x0 < 8) return null;
    const m = Math.max(1, Math.round((y1 - y0) * 0.08));
    let sx = 0, sy = 0, n = 0, lx = Infinity, hx = -1;
    for (let py = y0 + m; py < y1 - m; py++) for (let px = x0 + m; px < x1 - m; px++) {
        const i = (py * W + px) * 4, r = d[i], g = d[i + 1], b = d[i + 2], M = Math.max(r, g, b), dd = M - Math.min(r, g, b);
        if (M < DIFF_INK_MIN || dd < DIFF_INK_SAT) continue;
        let hue = M === r ? ((g - b) / dd + 6) % 6 : M === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
        hue *= Math.PI / 3;
        sx += Math.cos(hue); sy += Math.sin(hue); n++;
        if (px < lx) lx = px; if (px > hx) hx = px;
    }
    if (n < 8) return null;
    const hue = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360, wr = (hx - lx + 1) / (x1 - x0);
    const red = hue >= 290 || hue < 12, warm = hue >= 25 && hue < 75;
    if (wr < 0.37) return hue >= 280 && hue < 345 ? 'SC' : null;
    if (wr < 0.68) return hue >= 5 && hue < 36 ? 'HD' : hue >= 36 && hue < 75 ? 'NM' : null;
    return red ? 'MX' : warm ? 'NM' : null;
}

/* 라운드/결과 화면의 버튼/난이도 바는 자켓 아래쪽 18%에 겹쳐 그려져 밴픽창보다 1~4px 어긋난다.
   난이도 해시는 칸 테두리 위치에 민감해서, 바의 세로 위치·높이를 조금씩 흔들어 가장 잘 맞는 자리의 값을 쓴다.
   (가로로 흔들면 오히려 NM 오인식이 늘어서 세로만 본다. 새 카드를 만들 때만 부른다) */
function overlayBarFeatures(src, r) {
    const u = r.w / 240, base = barFeatures(src, r.x, r.y + r.h - 43 * u, r.w, 43 * u);
    let bestPh = base.diffPh, bestScore = Infinity;
    for (let dy = -4; dy <= 4; dy++) for (const hh of [39, 41, 43, 45]) {
        const bar = cropToCanvas(src, r.x, r.y + r.h - 43 * u + dy * u, r.w, hh * u);
        const right = cropToCanvas(bar, bar.width * BAR_SPLIT, 0, bar.width * (1 - BAR_SPLIT), bar.height);
        const ph = pHashFromCanvas(binarizeDifficulty(right)), s = bestMatch(ph, null, diffRefs).score;
        if (s < bestScore) { bestScore = s; bestPh = ph; }
    }
    return { ...base, diffPh: bestPh };
}

/* 가장 최근 판(스샷 히스토리 마지막 항목)의 카드가 비교 기준 */
function currentMatchEntry() {
    const list = shotHistory.versus, entry = list[list.length - 1];
    return (entry && entry.rows.some(r => r.jacketSig)) ? entry : null;
}

function identifyJacket(src, r, rows) {
    const sig = jacketSig(src, r.x, r.y, r.w, r.h);
    const cards = rows.filter(row => row.jacketSig).map(row => ({ sig: row.jacketSig, row }));
    const hit = cards.length ? nearestSig(sig, cards) : null;
    if (hit) return { row: hit.item.row, id: hit.item.row.getAttribute('data-title-id'), d: hit.d, sig, rect: r };
    const db = nearestSig(sig, sigTable);
    if (!db) return null;
    // 카드 자켓 비교는 빗나갔어도 같은 곡이 이미 카드에 있으면 그 카드로 본다
    const same = rows.find(row => row.getAttribute('data-title-id') === String(db.item.id)) || null;
    return { row: same, id: String(db.item.id), d: db.d, sig, rect: r };
}

/* 라운드/결과 화면이면 { rounds: [칸...], bans: [칸...] }, 아니면 null. 칸 = { row, id, d, sig, rect } */
function readMatchScreen(src, W, H, rows) {
    const sx = W / BASE_W, sy = H / BASE_H;
    const rect = (b, k = 0) => ({ x: b.x * sx, y: (b.y + (b.step || 0) * k) * sy, w: b.size * sx, h: b.size * sy });
    const readRounds = (boxes) => {
        const found = [];
        for (let k = 0; k < 3; k++) {
            const hits = boxes.map(b => identifyJacket(src, rect(b, k), rows)).filter(Boolean).sort((a, b) => a.d - b.d);
            if (!hits.length) break; // 라운드는 1부터 이어져야 한다 ('?' 칸에서 멈춤)
            found.push(hits[0]);
        }
        return found;
    };
    const roundScreen = readRounds([ROUND_SMALL, ROUND_BIG]);
    const resultScreen = readRounds([RESULT_BOX]);
    if (!roundScreen.length && !resultScreen.length) return null;
    if (resultScreen.length > roundScreen.length) return { rounds: resultScreen, bans: [] };
    const bans = BAN_BOXES.map(b => identifyJacket(src, rect(b), rows)).filter(Boolean);
    return { rounds: roundScreen, bans };
}

/* 이미 자동으로 반영한 사실은 다시 덮어쓰지 않는다 — 사용자가 손으로 고친 표시를 존중 */
function applyMatchMarks(info) {
    const changes = [];
    const name = h => getSongDataSync(h.id).name || h.row.querySelector('h3')?.innerText || '';
    const once = (row, key) => { row.autoMarks = row.autoMarks || new Set(); if (row.autoMarks.has(key)) return false; row.autoMarks.add(key); return true; };
    info.bans.forEach(h => {
        const r = h.row; if (!r || !once(r, 'ban')) return;
        r.classList.add('banned'); r.classList.remove('played'); delete r.dataset.round; renderRoundBadge(r);
        changes.push(`밴 ${name(h)}`);
    });
    info.rounds.forEach((h, i) => {
        const r = h.row; if (!r || !once(r, `round${i + 1}`)) return;
        r.classList.add('played'); r.classList.remove('banned'); r.dataset.round = i + 1; renderRoundBadge(r);
        changes.push(`R${i + 1} ${name(h)}`);
    });
    return changes;
}

function renderRoundBadge(row) {
    row.querySelector('.round-badge')?.remove();
    if (!row.dataset.round) return;
    const host = row.querySelector('.aspect-square') || row;
    const b = document.createElement('div'); b.className = 'round-badge'; b.textContent = `R${row.dataset.round}`;
    host.appendChild(b);
}

/* 라운드 화면에서 새로 확인된 곡의 카드. 밴 칸은 자켓만 보여서 난이도를 알 수 없다 */
function createIdentifiedRow(h, banButton) {
    const row = createLoadingRow(0);
    row.setAttribute('data-title-id', h.id);
    row.jacketSig = h.sig;
    // Recheck용 후보: 자켓이 비슷한 순
    row.matches = sigTable.map(t => ({ id: t.id, score: sigDist(h.sig, t.sig) })).sort((a, b) => a.score - b.score).slice(0, 10);
    if (String(row.matches[0]?.id) !== h.id) row.matches.unshift({ id: h.id, score: h.d });
    row.matchIndex = 0;
    if (h.bar) Object.assign(row, h.bar);
    else { row.patternUnknown = true; row.patternButton = banButton; }
    row.ready = displayMatch(row, 0);
    return row;
}

/* 확인된 곡이 가장 최근 판의 카드에 있으면 그 판에 표시하고, 없으면(밴픽창을 놓친 경우)
   라운드 화면에서 확인된 곡만으로 새 판을 만든다. src는 읽은 화면(버튼/난이도 바를 읽는 데 씀),
   getPreviewSrc는 새 카드가 생길 때만 부른다. */
async function applyMatchScreen(info, src, getPreviewSrc) {
    isProcessing = true;
    try {
        let entry = currentMatchEntry();
        const anchored = !!(entry && info.rounds[0].row);
        if (!anchored) { entry = null; [...info.rounds, ...info.bans].forEach(h => { h.row = null; }); }
        const missing = [...info.rounds, ...info.bans].filter(h => !h.row);
        let created = 0;
        if (missing.length && (!entry || entry.partial)) {
            // 바는 화면(src)이 살아 있을 때 먼저 읽어 둔다
            missing.filter(h => info.rounds.includes(h)).forEach(h => { h.bar = overlayBarFeatures(src, h.rect); });
            const r1 = info.rounds[0].bar || barFeatures(src, info.rounds[0].rect.x, info.rounds[0].rect.y + info.rounds[0].rect.h * 0.82, info.rounds[0].rect.w, info.rounds[0].rect.h * 0.18);
            const banButton = bestMatch(r1.btnPh, r1.btnColor, buttonRefs).key || '4B'; // 한 판의 곡은 버튼 모드가 같다
            const preview = await getPreviewSrc();
            if (!entry) { entry = addShot(preview, [], null); entry.partial = true; }
            else if (preview) { if (entry.src && entry.src.startsWith('blob:') && entry.src !== preview) URL.revokeObjectURL(entry.src); entry.src = preview; }
            const fresh = [];
            for (const h of missing) {
                h.row = entry.rows.find(r => r.getAttribute('data-title-id') === h.id) || null;
                if (h.row) continue;
                h.row = createIdentifiedRow(h, info.bans.includes(h) ? banButton : null);
                entry.rows.push(h.row); fresh.push(h.row);
            }
            created = fresh.length;
            await Promise.all(fresh.map(r => r.ready));
        }
        // 밴픽 5곡에 없는 곡(h.row 없음)은 오인식으로 보고 무시된다
        const changes = applyMatchMarks(info);
        if (entry.partial) {
            const rank = r => r.dataset.round ? +r.dataset.round : r.classList.contains('banned') ? 10 : 20;
            entry.rows.sort((a, b) => rank(a) - rank(b));
        }
        if (created || changes.length || shotIndex.versus !== shotHistory.versus.length - 1) showShot(shotHistory.versus.length - 1);
        return { changes, created, partial: !!entry.partial };
    } finally {
        isProcessing = false;
    }
}
