/* 층수 측정기 — 기본 상수와 모드 전환, 곡 태그 표시.
   floor.html의 인라인 스크립트를 쪼갠 첫 조각이다. 아래 순서로 읽혀야 한다:
     lib/imghash.js → lib/screen-capture.js → floor/core.js → memo → song-db → shots
     → match-screen → auto-capture → app

   해시와 화면 공유는 버망호 도우미와 같은 코드를 쓴다(lib/). 여기서는 쓰던 이름 그대로 별칭만 만든다. */
const { cropToCanvas, getColorGridFromCanvas,
        aHashFromCanvas, dHashFromCanvas, pHashFromCanvas,
        popcnt32, hamDist, colorDist } = VMH.ImgHash;
const { frameToImage } = VMH.ScreenCapture;
// 창 테두리를 잘라낸 사실은 화면에 알려준다 (showTemporaryMessage는 song-db.js에 있다)
const fitGameArea = (img) => VMH.ScreenCapture.fitGameArea(img, showTemporaryMessage);

const resultList = document.getElementById('resultList');
const BASE_W = 2560, BASE_H = 1440;
const RATIO_X_START = 307 / BASE_W, RATIO_THUMB_W = 240 / BASE_W, RATIO_GAP = 186.75 / BASE_W, RATIO_Y_START = 545 / BASE_H, RATIO_THUMB_H = 240 / BASE_H, RATIO_BAR_H = 43 / BASE_H;
const RATIO_GENERAL_X = 885 / BASE_W, RATIO_GENERAL_Y = 711 / BASE_H, RATIO_GENERAL_W = 80 / BASE_W, RATIO_GENERAL_H = 80 / BASE_H;

let currentMode = 'versus';
// 비동기 분석이 끝나기 전에 모드/공유가 바뀌면 이전 작업은 화면에 적용하지 않는다.
let floorWorkVersion = 0;
const floorWorkContext = () => ({ mode: currentMode, version: floorWorkVersion });
const floorWorkCurrent = ctx => ctx.mode === currentMode && ctx.version === floorWorkVersion;

// 로페봇(xn--2o2bk9ff9x = 로페봇) — v-archive에 없는 곡의 보충 출처
const LOPE_SONGS_URL = 'https://xn--2o2bk9ff9x.com/data/songs.json';
const LOPE_IMG_BASE = 'https://img.xn--2o2bk9ff9x.com/';
const VA_IMG_BASE = 'https://v-archive.net/s3/images/jackets/';

// 버튼/난이도 색 — 드롭다운, 일망호 표, 메모 편집창, 팝업이 같이 쓴다
const BTN_COLORS = { '4B': 'bg-emerald-600', '5B': 'bg-sky-600', '6B': 'bg-amber-600', '8B': 'bg-indigo-600' };
const DIFF_COLORS = { 'SC': 'bg-purple-600', 'MX': 'bg-rose-600', 'HD': 'bg-orange-600', 'NM': 'bg-yellow-500' };
const BTN_HEX = { '4B': '#059669', '5B': '#0284c7', '6B': '#d97706', '8B': '#4f46e5' };
const DIFF_HEX = { NM: '#eab308', HD: '#ea580c', MX: '#e11d48', SC: '#9333ea' };

/* 버튼·난이도 셀렉트 쌍 공용 렌더러 (버망호 5열 카드 · 일반 리스트 공용) */
function renderPatternSelectsHtml(btn, diff, extraCls = '') {
    const bL = ['4B', '5B', '6B', '8B'], dL = ['NM', 'HD', 'MX', 'SC'];
    const base = `rounded-md font-black text-white bg-slate-800 border-none outline-none shadow-sm ${extraCls}`.trim();
    const opts = (list, cur) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    return `<select class="btn-select ${base}" onchange="event.stopPropagation(); handleCorrection(this)">${opts(bL, btn)}</select>`
         + `<select class="diff-select ${base}" onchange="event.stopPropagation(); handleCorrection(this)">${opts(dL, diff)}</select>`;
}

/* 버튼·난이도·층수 배지 칩 공용 렌더러 (메모 모달 등) */
function renderPatternBadgeHtml(text, cls = '', style = '') {
    return `<span class="px-2 py-0.5 rounded-md text-xs font-black text-white ${cls}"${style ? ` style="${style}"` : ''}>${text}</span>`;
}

/* 층수 측정기 설명도 도움말 탭에 있다 (예전에는 이 탭 안의 모달이었다) */
function toggleHelp(show) {
    if (show === false) return;
    VMH.UI.jumpToHelp('help-floor');
}

function setMode(mode) {
    if (!['versus', 'general'].includes(mode) || mode === currentMode) return;
    floorWorkVersion++;
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`mode-${mode}`).classList.add('active');
    
    if (mode === 'versus') {
        resultList.classList.add('versus-grid');
        resultList.classList.remove('space-y-4');
    } else {
        resultList.classList.remove('versus-grid');
        resultList.classList.add('space-y-4');
    }

    document.getElementById('generalSearchContainer').classList.toggle('hidden', mode !== 'general');
    // 연결은 모드와 상관없이 유지하고, 모드에 따라 보는 화면만 바뀐다 (버망호: 밴픽/라운드, 일망호: 방장 선곡)
    autoCap.genCandId = null;
    autoCap.modeSwitchKey = null;
    autoCap.modeSwitchCount = 0;
    updateAutoCaptureUI();
    document.getElementById('songSearchResults').classList.add('hidden');
    const searchInput = document.getElementById('songSearchInput');
    if (searchInput) {
        searchInput.value = '';
        if (mode === 'general' && VMH.Tabs?.active === 'floor') {
            requestAnimationFrame(() => searchInput.focus());
        }
    }

    window.lastProcessedImg = null; lastImageHash = null;
    // 모드별로 히스토리를 따로 들고 있어서, 돌아오면 보던 스샷과 밴픽이 그대로 살아난다
    if (shotHistory[mode].length > 0) {
        showShot(shotIndex[mode] >= 0 ? shotIndex[mode] : shotHistory[mode].length - 1);
    } else {
        renderStatus();
        document.getElementById('screenshotContainer').style.display = 'none';
        document.getElementById('dropZone').style.display = 'block';
        updateShotNav();
    }
}

const BAR_SPLIT = 0.5, W_AHASH = 1.0, W_DHASH = 1.0;
const thumbRefs = [], buttonRefs = {}, diffRefs = {}, songTagsDatabase = {};
let isProcessing = false, lastImageHash = null;
const COOLDOWN_MS = 3000;

// V-ARCHIVE songs.json의 패턴 태그(tags·standard) 표시 이름과 정렬 순서
const VA_TAG_ORDER = [
    'random:half', 'random:random', 'random:max',
    'svam:accelFast', 'svam:accel', 'svam:variable', 'svam:decel', 'svam:decelFast',
    'assist:max', 'assist:half',
    'based:six',
    'individual:individual',
];
const VA_TAG_LABELS = {
    'random:half': '하랜 추천',
    'random:random': '랜덤 추천',
    'random:max': '맥랜 추천',
    'svam:accelFast': '급가속',
    'svam:accel': '가속',
    'svam:variable': '변속',
    'svam:decel': '감속',
    'svam:decelFast': '급감속',
    'assist:max': '보조키 자주',
    'assist:half': '보조키 약간',
    'based:six': '6B위주',
    'individual:individual': '개인차',
};

function getVarchivePatternTags(titleId, button, difficulty) {
    if (!button || !difficulty) return [];
    const p = songDatabase[parseInt(titleId)]?.patterns?.[button]?.[difficulty];
    if (!p) return [];
    const raw = Array.isArray(p.tags) ? p.tags : [];
    const keys = [];
    raw.forEach(t => {
        if (!t || !t.tagGroup || !t.tagCode) return;
        const k = `${t.tagGroup}:${t.tagCode}`;
        if (VA_TAG_LABELS[k] && !keys.includes(k)) keys.push(k);
    });
    keys.sort((a, b) => VA_TAG_ORDER.indexOf(a) - VA_TAG_ORDER.indexOf(b));
    const out = keys.map(k => VA_TAG_LABELS[k]);
    if (p.standard) out.push('기준곡');
    return out;
}

/* 로페봇 패턴 태그 — V-ARCHIVE 태그와 이름이 겹치면 V-ARCHIVE 쪽을 우선한다 */
function getLopePatternTags(titleId, button, difficulty, vaTags = null) {
    if (!button || !difficulty) return [];
    const pTags = songTagsDatabase[String(titleId)]?.pattern_tags?.[button];
    if (!Array.isArray(pTags)) return [];
    const seen = new Set(vaTags || getVarchivePatternTags(titleId, button, difficulty));
    const out = [];
    pTags.forEach(pt => {
        if (!pt || !pt.name) return;
        if (pt.diff !== difficulty && pt.diff) return;
        if (seen.has(pt.name)) return;
        seen.add(pt.name);
        out.push(pt.name);
    });
    return out;
}

function getSongTagList(titleId, currentButton = null, currentDifficulty = null) {
    const tagData = songTagsDatabase[String(titleId)];
    const displayTags = [];

    // 1. BPM 정보 추가 (BPM: 접두사 포함)
    if (tagData?.bpm?.text) {
        displayTags.push({ text: `BPM:${tagData.bpm.text}`, type: 'bpm' });
    }

    // 2. V-ARCHIVE 패턴 태그 (하랜 추천·변속·보조키·기준곡 등)
    const vaTags = (currentButton && currentDifficulty)
        ? getVarchivePatternTags(titleId, currentButton, currentDifficulty)
        : [];
    vaTags.forEach(t => displayTags.push({ text: t, type: 'varchive' }));

    // 3. 로페봇 패턴 전용 특징 태그 추가 (V-ARCHIVE와 겹치는 이름은 제외)
    if (currentButton && currentDifficulty) {
        getLopePatternTags(titleId, currentButton, currentDifficulty, vaTags).forEach(name => {
            displayTags.push({ text: name, type: 'pattern' });
        });
    }

    // 4. 내가 붙인 패턴 메모(자작 태그) — 외부 태그가 없는 곡에도 붙는다
    if (currentButton && currentDifficulty) {
        getPatternMemo(titleId, currentButton, currentDifficulty).forEach(t => displayTags.push({ text: t, type: 'custom' }));
    }
    return displayTags;
}

/* ── 공용 태그 렌더러 ─────────────────
   버망호 카드 · 일망호 표 · 메모 편집 참고 태그 · 팝업(버망호/일망호) 모두 이 한 곳을 거친다.
   태그 순서·글꼴·높이·색상 클래스가 한 군데서만 결정되므로 화면마다 어긋나지 않는다. */
const TAG_KIND_META = {
    myrec: { cls: 'my-record-tag', popupCls: 'myrec', title: '' },
    memo:  { cls: 'tag-memo memo-tag', popupCls: 'memo', title: '내 메모 태그' },
    bpm:   { cls: 'floor-bpm-badge', popupCls: 'bpm', title: '' },
    va:    { cls: 'tag-va', popupCls: 'va', title: 'V-ARCHIVE 태그' },
    lope:  { cls: 'tag-lope', popupCls: 'lope', title: '로페봇 태그' },
    etc:   { cls: 'tag-etc', popupCls: 'etc', title: '' },
};

function getMyRecordTagItem(titleId, btn, diff) {
    if (typeof getMyRecord !== 'function') return null;
    const rec = getMyRecord(titleId, btn, diff);
    if (!rec) return null;
    const isPP = rec.score >= 100;
    const text = isPP ? 'PP' : `${rec.score.toFixed(2)}%${rec.maxCombo ? ' ★' : ''}`;
    const mod = isPP ? 'is-pp' : (rec.maxCombo ? 'is-mc' : '');
    const title = `내 V-ARCHIVE 최고 기록: ${rec.score.toFixed(2)}%${rec.maxCombo ? ' (MAX COMBO)' : ''}`;
    return { kind: 'myrec', text, mod, title };
}

function collectPatternTags(titleId, btn = null, diff = null, opts = {}) {
    const { includeMyRecord = true, includeMemo = true, includeBpm = false, includeLope = true } = opts;
    const items = [];
    if (includeMyRecord) {
        const recItem = getMyRecordTagItem(titleId, btn, diff);
        if (recItem) items.push(recItem);
    }
    if (includeBpm) {
        const list = getSongTagList(titleId, btn, diff);
        for (const t of list) {
            if (t.type === 'custom' && !includeMemo) continue;
            if (t.type === 'pattern' && !includeLope) continue;
            const kind = t.type === 'bpm' ? 'bpm'
                : t.type === 'varchive' ? 'va'
                : t.type === 'pattern' ? 'lope'
                : t.type === 'custom' ? 'memo' : 'etc';
            items.push({ kind, text: t.text, mod: '', title: TAG_KIND_META[kind].title });
        }
        return items;
    }
    if (includeMemo) {
        getPatternMemo(titleId, btn, diff).forEach(t => items.push({ kind: 'memo', text: t, mod: '', title: TAG_KIND_META.memo.title }));
    }
    const vaTags = getVarchivePatternTags(titleId, btn, diff);
    vaTags.forEach(t => items.push({ kind: 'va', text: t, mod: '', title: TAG_KIND_META.va.title }));
    if (includeLope) {
        getLopePatternTags(titleId, btn, diff, vaTags).forEach(name => items.push({ kind: 'lope', text: name, mod: '', title: TAG_KIND_META.lope.title }));
    }
    return items;
}

function renderTagChip(item, preset = 'card', brackets = false) {
    const meta = TAG_KIND_META[item.kind] || TAG_KIND_META.etc;
    const label = (brackets && item.kind !== 'myrec') ? `[${escapeHtml(item.text)}]` : escapeHtml(item.text);
    const titleAttr = item.title ? ` title="${escapeHtml(item.title)}"` : '';
    if (preset === 'popup') {
        return `<span class="t ${meta.popupCls}${item.mod ? ' ' + item.mod : ''}">${label}</span>`;
    }
    return `<span class="vmh-tag vmh-tag--${preset} ${meta.cls}${item.mod ? ' ' + item.mod : ''}"${titleAttr}>${label}</span>`;
}

function renderPatternTags(titleId, btn = null, diff = null, opts = {}) {
    const { preset = 'card', brackets = false, wrapClass = '' } = opts;
    const items = collectPatternTags(titleId, btn, diff, opts);
    if (!items.length) return '';
    const inner = items.map(item => renderTagChip(item, preset, brackets)).join('');
    return wrapClass ? `<div class="${wrapClass}">${inner}</div>` : inner;
}

function getSongTagsHtml(titleId, currentButton = null, currentDifficulty = null, justifyClass = currentMode === 'versus' ? 'justify-center' : 'justify-start') {
    return renderPatternTags(titleId, currentButton, currentDifficulty, {
        preset: 'card',
        includeBpm: true,
        brackets: true,
        wrapClass: `flex flex-wrap items-center gap-1 ${justifyClass} mt-1.5`
    });
}

/* 일망호 표 칸의 태그 줄 — 내 기록 → 내 메모 → V-ARCHIVE → 로페봇 순으로 잘리지 않고 모두 표시한다 */
function generalCellTagsHtml(titleId, btn, diff) {
    return renderPatternTags(titleId, btn, diff, {
        preset: 'cell',
        wrapClass: 'cell-tags flex flex-wrap items-center justify-center gap-1 mt-1 w-full'
    });
}
