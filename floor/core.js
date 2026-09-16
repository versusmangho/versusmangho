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

// 로페봇(xn--2o2bk9ff9x = 로페봇) — v-archive에 없는 곡의 보충 출처
const LOPE_SONGS_URL = 'https://xn--2o2bk9ff9x.com/data/songs.json';
const LOPE_IMG_BASE = 'https://img.xn--2o2bk9ff9x.com/';
const VA_IMG_BASE = 'https://v-archive.net/s3/images/jackets/';

// 버튼/난이도 색 — 드롭다운, 일망호 표, 메모 편집창이 같이 쓴다
const BTN_COLORS = { '4B': 'bg-emerald-600', '5B': 'bg-sky-600', '6B': 'bg-amber-600', '8B': 'bg-indigo-600' };
const DIFF_COLORS = { 'SC': 'bg-purple-600', 'MX': 'bg-rose-600', 'HD': 'bg-orange-600', 'NM': 'bg-yellow-500' };

/* 층수 측정기 설명도 도움말 탭에 있다 (예전에는 이 탭 안의 모달이었다) */
function toggleHelp(show) {
    if (show === false) return;
    VMH.Tabs.show('help');
    requestAnimationFrame(() => {
        const el = document.getElementById('help-floor');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function setMode(mode) {
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
    updateAutoCaptureUI();
    document.getElementById('songSearchResults').classList.add('hidden');
    document.getElementById('songSearchInput').value = '';

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

function getSongTagList(titleId, currentButton = null, currentDifficulty = null) {
    const tagData = songTagsDatabase[String(titleId)];
    const displayTags = [];

    // 1. BPM 정보 추가 (BPM: 접두사 포함)
    if (tagData?.bpm?.text) {
        displayTags.push({ text: `BPM:${tagData.bpm.text}`, type: 'bpm' });
    }

    // 2. 패턴 전용 특징 태그 추가 (일반 태그는 제외)
    if (currentButton && currentDifficulty && tagData?.pattern_tags?.[currentButton]) {
        const pTags = tagData.pattern_tags[currentButton];
        pTags.forEach(pt => {
            // 난이도가 일치하거나(SC/MX/HD/NM), 태그에 난이도 정보가 없는 경우 포함
            if (pt.diff === currentDifficulty || !pt.diff) {
                displayTags.push({ text: pt.name, type: 'pattern' });
            }
        });
    }

    // 3. 내가 붙인 패턴 메모(자작 태그) — 로페봇 태그가 없는 곡에도 붙는다
    if (currentButton && currentDifficulty) {
        getPatternMemo(titleId, currentButton, currentDifficulty).forEach(t => displayTags.push({ text: t, type: 'custom' }));
    }
    return displayTags;
}

function getSongTagsHtml(titleId, currentButton = null, currentDifficulty = null, justifyClass = currentMode === 'versus' ? 'justify-center' : 'justify-start') {
    const displayTags = getSongTagList(titleId, currentButton, currentDifficulty);
    if (displayTags.length === 0) return '';

    return `<div class="flex flex-wrap gap-1 ${justifyClass} mt-1.5">${displayTags.map(tag => {
        let bgColor = 'bg-slate-800/60', textColor = 'text-slate-300', borderColor = 'border-slate-700/50';

        if (tag.type === 'bpm') {
            bgColor = 'bg-blue-900/40'; textColor = 'text-blue-300'; borderColor = 'border-blue-700/50';
        } else if (tag.type === 'pattern') {
            bgColor = 'bg-indigo-900/40'; textColor = 'text-indigo-300'; borderColor = 'border-indigo-700/50';
        } else if (tag.type === 'custom') {
            bgColor = 'bg-amber-900/40'; textColor = 'text-amber-300'; borderColor = 'border-amber-600/50';
        }

        const memoAttr = tag.type === 'custom' ? ' memo-tag" title="내 메모 태그' : ''; // memo-tag: Copy에서 빠지는 표시
        return `<span class="px-1.5 py-0.5 rounded text-xs font-bold border ${bgColor} ${textColor} ${borderColor}${memoAttr}">[${escapeHtml(tag.text)}]</span>`;
    }).join('')}</div>`;
}

/* 일망호 표 칸의 태그 줄. 칸 높이가 고정이라 넘치면 잘리므로 내 메모 태그를 먼저 둔다 */
function generalCellTagsHtml(titleId, btn, diff) {
    const memoTags = getPatternMemo(titleId, btn, diff);
    const lopeTags = songTagsDatabase[String(titleId)]?.pattern_tags?.[btn]?.filter(pt => pt.diff === diff || !pt.diff) || [];
    if (!memoTags.length && !lopeTags.length) return '';
    return `<div class="cell-tags flex flex-wrap justify-center gap-1 mt-0.5 overflow-hidden max-h-[38px]">
        ${memoTags.map(t => `<span class="memo-tag text-[11px] px-1.5 py-0.5 rounded-sm whitespace-nowrap">${escapeHtml(t)}</span>`).join('')}${lopeTags.map(mt => `<span class="text-[11px] px-1.5 py-0.5 bg-black/30 rounded-sm whitespace-nowrap">${mt.name}</span>`).join('')}
    </div>`;
}
