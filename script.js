/**
 * =========================================================================
 * [E7 RTA Analyzer] - Refactored & pHash Optimized (Clean Version)
 * * Logic:
 * 1. Analyze Icon (Structure + Brightness) -> General Shape
 * 2. Detect Ready State (Fixed Position) -> Determine Background Mode
 * 3. Analyze Text (DCT pHash) -> Robust against pixel shifts
 * 4. Match Logic: Filter by Thresholds (Text <= 20 & Icon <= 60) -> Pick Best Text Match
 * =========================================================================
 */

// [FIX] 전역 상태 변수 'room' 선언 및 기본값 초기화
let room = {
    round: 0,
    players: [],
    eventLog: [],
    seen: [],
    playerHistory: {},
    newcomerPriority: true
};

// 1. 기준 이미지 (ISREADY_STANDARD.png)
const READY_BASE64 = "data:image/png;base64,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";

const ANALYZER_CONFIG = {
    SLOT_COUNT: 8,
    START_X: 0.767, START_Y: 0.165,
    GAP_X: 0, GAP_Y: 0.0740,
    CROP_RATIO: 0.15, 
    // 매칭 임계값 (이 점수 이하여야 동일인으로 인정)
    THRESHOLD_ICON: 120,  // aHash + dHash
    THRESHOLD_TEXT: 24,  // pHash (DCT)
    
    // 오프셋 설정 (화면 비율 기준)
    OFFSET_ICON: { x: 0.0, y: 0.0, w: 0.032, h: 0.06 },
    OFFSET_PLATE: { x: 0.032, y: 0.0, w: 0.032, h: 0.06 }, // 닉네임 시작점
    OFFSET_ISREADY: { x: 0.083, y: 0.022, w: 0.048, h: 0.038 } // Ready 배지 위치
};

const ui = {
    input: document.getElementById("nickname-input"),
    imgOld: document.getElementById("img-old"),
    imgNew: document.getElementById("img-new"),
    phOld: document.querySelector("#zone-old .placeholder"),
    phNew: document.querySelector("#zone-new .placeholder"),
    anaToggle: document.getElementById("analysis-toggle-btn"),
    anaContent: document.getElementById("analysis-content"),
    round: document.getElementById("round-info"),
    pTable: document.getElementById("player-table-body"),
    logContainer: document.getElementById("log-container"),
    manageMsg: document.getElementById("manage-msg"),
    addBtn: document.getElementById("add-btn"),
    undoBtn: document.getElementById("undo-btn"),
    redoBtn: document.getElementById("redo-btn"),
    resetBtn: document.getElementById("reset-btn")
};

let STANDARD_READY_HASH = null;

/**
 * [UTILS] 이미지 처리 및 수학 연산
 */
const Utils = {
    getCtx: (w, h) => {
        const cvs = document.getElementById('processCanvas');
        if (!cvs) {
            // [FIX] 캔버스 없을 경우 생성 (안전장치)
            const c = document.createElement('canvas');
            c.id = 'processCanvas';
            c.style.display = 'none';
            document.body.appendChild(c);
            c.width = w || 1; c.height = h || 1;
            return c.getContext('2d', { willReadFrequently: true });
        }
        cvs.width = w || 1; cvs.height = h || 1;
        return cvs.getContext('2d', { willReadFrequently: true });
    },
    getThumbCtx: () => {
        let cvs = document.getElementById('thumbCanvas');
        if (!cvs) {
            // [FIX] 썸네일 캔버스 안전장치
            cvs = document.createElement('canvas');
            cvs.id = 'thumbCanvas';
            cvs.style.display = 'none';
            document.body.appendChild(cvs);
        }
        return cvs.getContext('2d', { willReadFrequently: true });
    },
    getLum: (r, g, b) => 0.299*r + 0.587*g + 0.114*b,

    // DCT 기반 pHash (32x32 -> 8x8 DCT)
    computePHash: (imgData) => {
        const size = 32; 
        const data = imgData.data;
        const vals = new Float64Array(size * size);
        for(let i=0; i < data.length; i+=4) {
            vals[i/4] = Utils.getLum(data[i], data[i+1], data[i+2]);
        }
        
        const dctSize = 8;
        const dct = [];
        for(let v=0; v < dctSize; v++) {
            for(let u=0; u < dctSize; u++) {
                let sum = 0;
                for(let i=0; i < size; i++) {
                    for(let j=0; j < size; j++) {
                        sum += vals[j*size + i] * Math.cos(((2*i+1)/(2*size)) * u * Math.PI) * Math.cos(((2*j+1)/(2*size)) * v * Math.PI);
                    }
                }
                if (u === 0) sum *= 1/Math.sqrt(2);
                if (v === 0) sum *= 1/Math.sqrt(2);
                dct.push(sum / 4);
            }
        }
        
        const acValues = dct.slice(1); // DC 성분 제외
        const avg = acValues.reduce((a,b) => a+b, 0) / acValues.length;
        return dct.map(val => val >= avg ? 1 : 0);
    },

    // 일반 Hash 계산 (Raw ImageData -> 16x16 -> dHash)
    computeHashFromRaw: (imgData, w, h) => {
        const tempCvs = document.createElement('canvas');
        tempCvs.width = w; tempCvs.height = h;
        const tempCtx = tempCvs.getContext('2d');
        tempCtx.putImageData(imgData, 0, 0);
        
        const tCtx = Utils.getThumbCtx();
        tCtx.clearRect(0, 0, 16, 16);
        tCtx.drawImage(tempCvs, 0, 0, 16, 16);
        
        const thumbData = tCtx.getImageData(0, 0, 16, 16);
        const hash = Utils.computeDHash(thumbData.data, 16);
        return { hash, thumbData };
    },

    // 상태에 따른 필터링 (글자 추출)
    applyStateFilter: (rgbaData, width, height, isReady, dist) => {
        const len = width * height;
        const data = rgbaData.data;
        const output = new Uint8ClampedArray(len * 4); 
        const stateText = isReady ? `READY(유사도:${dist})` : `NORMAL(유사도:${dist})`;
        
        for (let i = 0; i < len; i++) {
            const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
            const idx = i * 4;
            let isText = false;
            
            if (isReady) {
                // Ready(밝은 배경) -> 검은 글자 추출
                if (r < 60 && g < 60 && b < 60) isText = true;
            } else {
                // Normal(어두운 배경) -> 흰 글자 추출
                if (r > 210 && g > 210 && b > 210) isText = true;
            }
            
            const val = isText ? 255 : 0;
            output[idx] = val; output[idx+1] = val; output[idx+2] = val; output[idx+3] = 255;  
        }
        return { data: new ImageData(output, width, height), state: stateText };
    },

    computeAHash: (data) => {
        let sum = 0, len = data.length/4, lums = [];
        for(let i=0; i<data.length; i+=4) {
            const l = Utils.getLum(data[i], data[i+1], data[i+2]);
            lums.push(l); sum += l;
        }
        const avg = sum/len;
        return lums.map(l => l>=avg ? 1 : 0);
    },
    computeDHash: (data, width) => {
        const hash = [];
        for(let i=0; i<data.length; i+=4) {
            if ((i/4) % width === width-1) continue; 
            const curr = Utils.getLum(data[i], data[i+1], data[i+2]);
            const next = Utils.getLum(data[i+4], data[i+5], data[i+6]);
            hash.push(curr < next ? 1 : 0);
        }
        return hash;
    },
    hammingDist: (h1, h2) => {
        let d=0; for(let i=0; i<h1.length; i++) if(h1[i]!==h2[i]) d++; return d;
    }
};

/**
 * [ANALYZER] 개별 슬롯 분석 클래스
 */
class SlotAnalyzer {
    constructor(imgEl, slotIndex, ctx, type) {
        this.index = slotIndex;
        this.type = type; // OLD or NEW
        this.ctx = ctx;
        this.imgEl = imgEl;
        
        const W = ctx.canvas.width;
        const H = ctx.canvas.height;
        this.x = (ANALYZER_CONFIG.START_X * W) + (slotIndex * ANALYZER_CONFIG.GAP_X * W);
        this.y = (ANALYZER_CONFIG.START_Y * H) + (slotIndex * ANALYZER_CONFIG.GAP_Y * H);
        
        // 1. 아이콘 분석 실행
        this.analyzeIcon(W, H);

        if (this.isEmpty) return;

        // 2. 카드 시각적 이미지 추출 (결과창 표시용)
        this.extractCardImage(W, H);

        // 3. 상태(Ready) 판별 및 닉네임(Plate) 분석 실행
        this.analyzePlate(W, H);
    }

    analyzeIcon(W, H) {
        const { OFFSET_ICON, CROP_RATIO } = ANALYZER_CONFIG;
        const ix = this.x + OFFSET_ICON.x*W;
        const iy = this.y + OFFSET_ICON.y*H;
        const iw = OFFSET_ICON.w*W;
        const ih = OFFSET_ICON.h*H;

        if (iw <= 0 || ih <= 0) { this.isEmpty = true; return; }
        
        const rawIconData = this.ctx.getImageData(ix, iy, iw, ih);
        this.isEmpty = this.checkEmpty(rawIconData);
        if (this.isEmpty) return;

        // 중앙부 크롭하여 해시 계산 (aHash, dHash)
        const tCtx = Utils.getThumbCtx();
        const cx = ix + (iw * CROP_RATIO);
        const cy = iy + (ih * CROP_RATIO);
        const cw = iw * (1 - CROP_RATIO*2);
        const ch = ih * (1 - CROP_RATIO*2);
        
        const cropIcon = document.createElement('canvas');
        cropIcon.width = cw; cropIcon.height = ch;
        cropIcon.getContext('2d').putImageData(this.ctx.getImageData(cx, cy, cw, ch), 0, 0);
        
        tCtx.clearRect(0, 0, 16, 16); 
        tCtx.drawImage(cropIcon, 0, 0, 16, 16);
        const iconThumbData = tCtx.getImageData(0, 0, 16, 16).data;
        
        this.aHash = Utils.computeAHash(iconThumbData);
        this.dHash = Utils.computeDHash(iconThumbData, 16);
    }

    extractCardImage(W, H) {
        const { OFFSET_ICON } = ANALYZER_CONFIG;
        const ih = OFFSET_ICON.h*H;
        const visualW = 0.16 * W;       
        const visualH = ih * 1.3;       
        const visualY = this.y - (ih * 0.3); 
        
        const tempCvs = document.createElement('canvas');
        tempCvs.width = visualW; tempCvs.height = visualH;
        tempCvs.getContext('2d').drawImage(this.imgEl, this.x, visualY, visualW, visualH, 0, 0, visualW, visualH);
        this.cardImage = tempCvs.toDataURL();
    }

    analyzePlate(W, H) {
        const { OFFSET_ISREADY, OFFSET_PLATE, CROP_RATIO } = ANALYZER_CONFIG;

        // [2-1] Ready 상태 판별
        let isReady = false;
        let dist = -1;

        const rx = this.x + OFFSET_ISREADY.x * W;
        const ry = this.y + OFFSET_ISREADY.y * H;
        const rw = OFFSET_ISREADY.w * W;
        const rh = OFFSET_ISREADY.h * H;

        if (STANDARD_READY_HASH && rw > 0 && rh > 0) {
            const readyData = this.ctx.getImageData(rx, ry, rw, rh);
            const result = Utils.computeHashFromRaw(readyData, rw, rh);
            dist = Utils.hammingDist(result.hash, STANDARD_READY_HASH);
            isReady = dist <= 50; // 넉넉한 기준
        }

        // [2-2] 닉네임 추출 및 pHash 계산
        const px = this.x + OFFSET_PLATE.x * W;
        const py = this.y + OFFSET_PLATE.y * H;
        const pw = OFFSET_PLATE.w * W;
        const ph = OFFSET_PLATE.h * H;

        const px_c = px + (pw * CROP_RATIO);
        const py_c = py + (ph * CROP_RATIO);
        const pw_c = pw * (1 - CROP_RATIO * 2);
        const ph_c = (ph * (1 - CROP_RATIO * 2)) * 0.55;

        if (pw_c > 0 && ph_c > 0) {
            const rawPlateData = this.ctx.getImageData(px_c, py_c, pw_c, ph_c);
            const realW = rawPlateData.width;
            const realH = rawPlateData.height;
            
            // 이진화 필터 적용
            const result = Utils.applyStateFilter(rawPlateData, realW, realH, isReady, dist);
            const filteredImg = result.data;
            
            // pHash 생성을 위해 32x32로 리사이징
            const pHashCanvas = document.createElement('canvas');
            pHashCanvas.width = 32; pHashCanvas.height = 32;
            const pCtx = pHashCanvas.getContext('2d');
            
            const tempBinarized = document.createElement('canvas');
            tempBinarized.width = realW; tempBinarized.height = realH;
            tempBinarized.getContext('2d').putImageData(filteredImg, 0, 0);
            
            pCtx.drawImage(tempBinarized, 0, 0, 32, 32);
            const pHashData = pCtx.getImageData(0, 0, 32, 32);
            
            this.pHash = Utils.computePHash(pHashData);

        } else {
            this.pHash = []; 
        }
    }

    checkEmpty(imgData) {
        const d = imgData.data;
        if (d.length === 0) return true;
        let sum = 0, sqSum = 0;
        for(let i=0; i<d.length; i+=4) {
            const l = Utils.getLum(d[i],d[i+1],d[i+2]);
            sum += l; sqSum += l*l;
        }
        const count = d.length / 4;
        const mean = sum / count; 
        const variance = (sqSum / count) - (mean * mean); 
        return (variance < 50) || (mean < 40); 
    }
}

/**
 * [CORE] 메인 분석 실행 함수
 */
async function runAnalysis() {
    const msgEl = document.getElementById('analysis-msg');
    const imgOld = document.getElementById('img-old');
    const imgNew = document.getElementById('img-new');

    if (!imgOld?.src || !imgNew?.src) return;

    if (msgEl) msgEl.innerText = "분석 중...";

    // 결과창 초기화
    ['res-leave', 'res-stay', 'res-enter'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.innerHTML = '';
    });

    const leftSlots = [];
    const enteredSlots = [];

    try {
        // [FIX] 두 이미지의 디코딩이 끝났는지 보장 (특히 스왑 직후 imgOld 재설정 케이스)
        await Promise.all([imgOld, imgNew].map(img =>
            (img.complete && img.naturalWidth > 0)
                ? Promise.resolve()
                : img.decode().catch(() => new Promise(res => { img.onload = res; img.onerror = res; }))
        ));

        const W = Math.max(imgOld.naturalWidth, imgNew.naturalWidth);
        const H = Math.max(imgOld.naturalHeight, imgNew.naturalHeight);
        const ctx = Utils.getCtx(W, H);

        const oldSlots = [], newSlots = [];
        
        ctx.drawImage(imgOld, 0, 0, W, H);
        for(let i=0; i<ANALYZER_CONFIG.SLOT_COUNT; i++) oldSlots.push(new SlotAnalyzer(imgOld, i, ctx, "OLD"));
        
        ctx.drawImage(imgNew, 0, 0, W, H);
        for(let i=0; i<ANALYZER_CONFIG.SLOT_COUNT; i++) newSlots.push(new SlotAnalyzer(imgNew, i, ctx, "NEW"));

        const usedNew = new Array(ANALYZER_CONFIG.SLOT_COUNT).fill(false);

        // [MATCHING LOGIC START]
        oldSlots.forEach(oldS => {
            if (oldS.isEmpty) return;
            
            let bestIdx = -1;
            let minScore = Infinity; // 점수가 낮을수록 유사함

            newSlots.forEach((newS, idx) => {
                if (usedNew[idx] || newS.isEmpty) return;
                
                // 1. 유사도 거리 계산
                const iconDist = Utils.hammingDist(oldS.aHash, newS.aHash) + Utils.hammingDist(oldS.dHash, newS.dHash);
                const textDist = Utils.hammingDist(oldS.pHash, newS.pHash);

                // 2. 필터링 (엄격한 기준 적용)
                if (iconDist <= ANALYZER_CONFIG.THRESHOLD_ICON && textDist <= ANALYZER_CONFIG.THRESHOLD_TEXT) {
                    const currentScore = textDist + (iconDist * 0.001);
                    if (currentScore < minScore) {
                        minScore = currentScore;
                        bestIdx = idx;
                    }
                }
            });

            // 결과 처리
            if (bestIdx !== -1) {
                usedNew[bestIdx] = true;
                const newS = newSlots[bestIdx];
                if (oldS.index !== newS.index) {
                    addResult('stay', `Slot ${oldS.index+1} → ${newS.index+1}`, newS.cardImage, 'MOVE');
                } else {
                    addResult('stay', `Slot ${oldS.index+1}`, newS.cardImage, '');
                }
            } else {
                addResult('leave', `Slot ${oldS.index+1}`, oldS.cardImage, 'OUT');
                leftSlots.push(`Slot ${oldS.index + 1}`);
            }
        });

        // 새로 들어온 유저 처리
        newSlots.forEach((newS, idx) => {
            if (!newS.isEmpty && !usedNew[idx]) {
                addResult('enter', `Slot ${newS.index+1}`, newS.cardImage, 'IN');
                enteredSlots.push(`Slot ${newS.index + 1}`);
            }
        });

        if (msgEl) msgEl.innerText = "분석 완료";
        saveState(); 
        refreshUI();

    } catch (e) {
        console.error(e);
        if (msgEl) msgEl.innerText = "오류: " + e.message;
    }
}

function addResult(type, text, img, tag) {
    const colId = type === 'leave' ? 'res-leave' : (type === 'enter' ? 'res-enter' : 'res-stay');
    const container = document.getElementById(colId);
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = 'log-item';
    let tagHtml = tag ? `<span class="move-tag">${tag}</span>` : '';
    div.innerHTML = `<img src="${img}" class="log-thumb"><div class="log-info"><span>${text}</span>${tagHtml}</div>`;
    container.appendChild(div);
}




// 이미지 붙여넣기 핸들러
document.addEventListener('paste', (e) => {
    if (e.target === ui.input) return;
    if (VMH.Tabs.active !== 'match') return;      // 층수 탭을 보고 있으면 그쪽이 받는다
    if (document.body.classList.contains('sharing')) return;  // 화면 공유 중엔 수동 분석기를 잠근다
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let file = null;
    for (let i=0; i<items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) { file = items[i].getAsFile(); break; }
    }
    if (!file) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = (ev) => pushToQueue(ev.target.result);
    reader.readAsDataURL(file);
});

function pushToQueue(src) {
    // [FIX] ui 요소 존재 확인
    if (!ui.imgOld || !ui.imgNew) return;

    const oldFull = ui.imgOld.style.display === 'block';
    const newFull = ui.imgNew.style.display === 'block';
    
    if (!oldFull) {
        setImage(ui.imgOld, ui.phOld, src);
    } else if (!newFull) {
        setImage(ui.imgNew, ui.phNew, src, runAnalysis);
    } else {
        setImage(ui.imgOld, ui.phOld, ui.imgNew.src);
        setImage(ui.imgNew, ui.phNew, src, runAnalysis);
    }
}

function setImage(img, ph, src, onReady) {
    if (img) {
        img.style.display = 'block';
        // [FIX] onload를 src 할당 "이전"에 걸어 레이스 방지.
        // 캐시/동기 디코딩으로 onload가 안 걸리는 경우는 complete 체크로 보강.
        if (onReady) {
            img.onload = () => onReady();
            img.src = src;
            if (img.complete && img.naturalWidth > 0) {
                img.onload = null;
                onReady();
            }
        } else {
            img.src = src;
        }
    }
    if (ph) ph.style.display = 'none';
}

if(ui.anaToggle) {
    ui.anaToggle.onclick = () => {
        const hide = ui.anaContent.style.display === 'none';
        ui.anaContent.style.display = hide ? 'block' : 'none';
        ui.anaToggle.querySelector('.toggle-icon').innerText = hide ? '▲' : '▼';
        saveState(); // <--- saveState() 호출 추가
    }
}

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
function avgWaitValue(p) {
    if (!p || p.onHold) return null;

    const currentWait = room.round - (p.lastPlay || 0);
    const pastWaitSum = p.waitSum || 0;
    const pastMatchCount = p.matchCount || 0;

    // 신규 유저: 현재까지 기다린 판수가 평균값
    if (pastMatchCount === 0) {
        return currentWait > 0 ? currentWait : null;
    }

    // 기존 유저: (과거 대기 합 + 현재 대기) / (과거 매치 수 + 1)
    const totalWait = pastWaitSum + currentWait;
    const totalPeriods = pastMatchCount + 1;

    return totalWait / totalPeriods;
}
function avgWaitText(p) {
    const v = avgWaitValue(p);
    return (v === null) ? "-" : v.toFixed(1);
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

// 경험자(1판 이상 & 비보류) 중 최고 가중치. 신입을 "진짜 상위 우선"으로 올리기 위한 기준선.
let maxScoreOfWaiters = null; // null = 경험자 없음

/* ── 가중치 비중 (옵션 탭의 가중치 편집기) ─────────────────
   기본값이 원래 공식이다: 현재 대기 + 평균 대기 − 원디골 비율 × 0.5 + 0.5.
   방 상태(room)가 아니라 설정이므로 실행 취소·전체 초기화와 무관하게 따로 저장한다. */
const SCORE_WEIGHTS_KEY = 'scoreWeightsV1';
const SCORE_WEIGHT_DEFS = [
    { key: 'cur',       name: '현재 대기',       unit: '×',  min: 0, max: 3,  step: 0.1,  def: 1 },
    { key: 'avg',       name: '평균 대기',       unit: '×',  min: 0, max: 3,  step: 0.1,  def: 1 },
    { key: 'sel',       name: '원디골 비율',     unit: '×',  min: 0, max: 2,  step: 0.05, def: 0.5 },
    // 신입 우선권: 경험자 최고점보다 확실히 위로 올리는 여유분
    { key: 'newcomer',  name: '신입 가산점',     unit: '+',  min: 0, max: 5,  step: 0.5,  def: 1 },
    // 세이프가드: 현재 대기가 이 값 이상이면 "장기 대기(긴급)"로 보고 최상위 강제.
    // 정렬·행 색상·팝업·문구가 모두 이 값을 쓴다
    { key: 'safeguard', name: '세이프가드 기준', unit: '판', min: 2, max: 10, step: 1,    def: 4 }
];
const scoreWeights = {};

// 범위 안으로 자르고 눈금(step)에 맞춘다. 숫자가 아니면 기본값
function clampWeight(def, v) {
    v = Number(v);
    if (!Number.isFinite(v)) return def.def;
    v = Math.min(def.max, Math.max(def.min, v));
    return +(Math.round(v / def.step) * def.step).toFixed(2);
}
function setScoreWeights(obj) {
    SCORE_WEIGHT_DEFS.forEach(d => { scoreWeights[d.key] = clampWeight(d, obj && d.key in obj ? obj[d.key] : d.def); });
}
function saveScoreWeights() { SafeStorage.setItem(SCORE_WEIGHTS_KEY, JSON.stringify(scoreWeights)); }
(function loadScoreWeights() {
    let saved = null;
    try { saved = JSON.parse(SafeStorage.getItem(SCORE_WEIGHTS_KEY) || 'null'); } catch { /* 깨진 값은 기본값으로 */ }
    setScoreWeights(saved);
})();
const safeguardThreshold = () => scoreWeights.safeguard;

/* 가중치 기준선. 원디골 페널티(최대 −원디골 비중) 때문에 방금 친 원디골 전담이 음수로 내려가
   "가중치 -0.5"처럼 보이던 것을 그만큼 올려, 가장 낮은 가중치가 0이 되게 한다.
   모든 계산 경로에 똑같이 더하므로 순위는 달라지지 않는다. */
const scoreBase = () => scoreWeights.sel;

const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// 경험자(matchCount>0) 점수 계산식. updateAverageWaitersStat과 calculateScore가 공유.
function experiencedScore(p) {
    const real_W_curr = room.round - (p.lastPlay || 0);
    const W_avg = round2(((p.waitSum || 0) + real_W_curr) / ((p.matchCount || 0) + 1));
    const R_sel = round2((p.chooserCount || 0) / p.matchCount);
    return scoreWeights.cur * real_W_curr + scoreWeights.avg * W_avg - scoreWeights.sel * R_sel + scoreBase();
}

/* 명패 이미지는 room.plateBook 한 곳에만 둔다 (플레이어·로그에 복사하면 저장 용량이 몇 배가 된다).
   방을 나간 뒤에도 장부에는 남으므로 퇴장 로그도 명패로 그려진다. */
function thumbFor(nickname) {
    return (room.plateBook && room.plateBook[nickname] && room.plateBook[nickname].thumb) || null;
}

/* 플레이어를 화면에 나타내는 조각. 화면 자동 인식으로 들어온 사람은 닉네임을 모르므로
   게임 안의 명패 이미지를 그대로 보여준다(닉네임 입력이 필요 없는 이유). */
function plateHtml(nickname, extraClass) {
    const t = thumbFor(nickname);
    if (!t) return escapeHtml(nickname);
    return `<img class="plate-thumb ${extraClass || ''}" src="${t}" alt="${escapeHtml(nickname)}" title="${escapeHtml(nickname)}">`;
}
const playerLabelHtml = (p) => plateHtml(p ? p.nickname : '');
const logLabelHtml = (nickname) => plateHtml(nickname, 'plate-thumb-sm');

// escapeHtml(innerHTML 삽입 시 사용자 입력 escape)은 lib/util.js에 있다 — 층수 측정기와 같은 것을 쓴다

function updateAverageWaitersStat() {
    if (!room || !room.players) return;
    // [FIX] 보류(onHold) 플레이어는 대기 모수에서 제외 — lastPlay가 고정되어 W_curr가
    // 계속 커지므로 기준선을 왜곡함(개별 표시용 avgWaitValue와도 일관).
    const experiencedPlayers = room.players.filter(p => p.matchCount > 0 && !p.onHold);
    if (experiencedPlayers.length > 0) {
        maxScoreOfWaiters = Math.max(...experiencedPlayers.map(experiencedScore));
    } else {
        maxScoreOfWaiters = null;
    }
}

function calculateScore(p) {
    const newbieBoostOn = document.getElementById("newcomer-toggle")?.checked ?? true;
    // 보류 중에는 보류 시작 라운드(holdStart)를 기준으로 대기를 고정 표시한다.
    // 복귀 시 lastPlay가 보류 기간만큼 보정되므로 복귀 후 값(holdStart - lastPlay)과 일치.
    const effRound = (p.onHold && p.holdStart != null) ? p.holdStart : room.round;
    const real_W_curr = effRound - (p.lastPlay || 0);
    let W_avg = 0;
    let R_sel = (p.matchCount > 0) ? round2(p.chooserCount / p.matchCount) : 0;
    let score;

    if (p.matchCount > 0) {
        // 옵션 B: "현재 대기"를 평균에 포함하는 실시간 평균 대기 계산
        const pastWaitSum = p.waitSum || 0;
        const pastMatchCount = p.matchCount || 0;

        const totalWait = pastWaitSum + real_W_curr;
        const totalPeriods = pastMatchCount + 1;

        W_avg = round2(totalWait / totalPeriods);

        // experiencedScore와 같은 식 (비중은 가중치 편집기에서)
        score = scoreWeights.cur * real_W_curr + scoreWeights.avg * W_avg - scoreWeights.sel * R_sel + scoreBase();
    } else { // 신입 (New player)
        // 신입은 현재 대기를 평균 대기로 표시.
        W_avg = real_W_curr;

        if (newbieBoostOn && maxScoreOfWaiters !== null) {
            // [진짜 상위 우선] 경험자 최고 가중치보다 확실히 위로 올림.
            // 본인 현재 대기(real_W_curr)를 더해, 합류가 빠른 신입이 더 위에 오도록.
            // (원디골 페널티는 칠 이력이 없는 신입에겐 적용하지 않음.)
            score = round2(maxScoreOfWaiters + scoreWeights.newcomer + real_W_curr);
        } else {
            // 경험자가 없거나(모두 신입) 부스트 off → 본인 현재 대기로 신입끼리 비교.
            // (maxScoreOfWaiters를 쓰는 위쪽 가지는 이미 기준선이 들어간 값이라 여기서만 더한다)
            score = scoreWeights.cur * real_W_curr + scoreBase();
        }
    }
    return { score, W_avg, R_sel, T_in: p.joinOrder || 0, W_curr: real_W_curr };
}

function getSortValue(p, key) {
    const stats = calculateScore(p);
    switch(key) {
        case 'nickname': return p.nickname;
        case 'chooserCount': return p.chooserCount || 0;
        case 'w_curr': return stats.W_curr;
        case 'w_avg': return stats.W_avg;
        case 'priority': return stats.score;
        default: return 0;
    }
}

function getSortedPlayers(sortConfig) {
    const safeguardOn = document.getElementById("safeguard-toggle")?.checked ?? false;
    
    return [...room.players].sort((a, b) => {
        if (a.onHold !== b.onHold) return a.onHold ? 1 : -1;

        if (safeguardOn) {
            const waitA = getSortValue(a, 'w_curr');
            const waitB = getSortValue(b, 'w_curr');
            const isUrgentA = waitA >= safeguardThreshold();
            const isUrgentB = waitB >= safeguardThreshold();
            if (isUrgentA !== isUrgentB) return isUrgentA ? -1 : 1;
            if (isUrgentA && isUrgentB) {
                if (waitA !== waitB) return waitB - waitA;
                const rSelA = (a.matchCount > 0) ? round2(a.chooserCount / a.matchCount) : 0;
                const rSelB = (b.matchCount > 0) ? round2(b.chooserCount / b.matchCount) : 0;
                if (rSelA !== rSelB) return rSelA - rSelB;
                return (a.joinOrder || 0) - (b.joinOrder || 0); // 결정적 정렬
            }
        }

        const valA = getSortValue(a, sortConfig.key);
        const valB = getSortValue(b, sortConfig.key);

        let comparison = 0;
        if (typeof valA === 'string') {
            comparison = valA.localeCompare(valB); // Asc
        } else {
            comparison = valA - valB; // Asc
        }
        if (sortConfig.order === 'desc') {
            comparison *= -1;
        }
        
        if (comparison === 0) {
             const scoreA = calculateScore(a).score;
             const scoreB = calculateScore(b).score;
             if (scoreB !== scoreA) return scoreB - scoreA;
             return (a.joinOrder || 0) - (b.joinOrder || 0);
        }
        return comparison;
    });
}


function refreshUI() {
    // [FIX] room 객체 안전 확인
    if (!room) return;
    
    updateAverageWaitersStat();

    if (room.eventLog && room.eventLog.length > 100) {
        room.eventLog.splice(0, room.eventLog.length - 100);
    }
    if (Array.isArray(room.players)) room.players.forEach(normalizePlayer);
    if(ui.round) ui.round.textContent = `라운드: ${room.round}`;
    if(ui.pTable) ui.pTable.innerHTML = "";

    if(ui.manageMsg) ui.manageMsg.style.display = "none";
    if(document.getElementById("match-msg")) document.getElementById("match-msg").style.display = "none";

    const sorted = getSortedPlayers(currentSort);

    // Update header visuals
    document.querySelector("#player-table-body")?.parentElement.querySelectorAll('thead th').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sortKey === currentSort.key) {
            th.classList.add(currentSort.order === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });

    sorted.forEach(p => {
        const tr = document.createElement("tr");
        const hold = !!p.onHold;
        const stats = calculateScore(p);
        
        // 누적 보류 라운드(현재 보류 중이면 진행 중인 분량까지 합산)
        const ongoingHold = (hold && p.holdStart !== null) ? Math.max(0, room.round - p.holdStart) : 0;
        const heldTotal = (p.heldRounds || 0) + ongoingHold;

        tr.innerHTML = `
            <td>${stats.score.toFixed(2)}</td>
            <td>${playerLabelHtml(p)} ${p.rejoined?'<span class="tag danger">재입장</span>':''} ${!hold && p.matchCount===0?'<span class="tag" style="border-color:#4ade80;color:#86efac">신입</span>':''} ${hold?'<span class="tag danger">보류</span>':''}
                <button class="small-hold">${hold?"복귀":"보류"}</button><button class="small-delete">×</button>
            </td>
            <td class="extra-col">${p.chooserCount||0}</td>
            <td>${stats.W_curr}</td>
            <td>${stats.W_avg.toFixed(2)}</td>
            <td class="extra-col">${p.matchCount||0}</td>
            <td class="extra-col">${p.waitSum||0}</td>
            <td class="extra-col">${heldTotal}</td>
            <td class="extra-col">R${p.joinedAt||0}</td>
        `;
        tr.dataset.nickname = p.nickname;
        if(selected.includes(p.nickname)) tr.classList.add("highlight");
        if (!hold && stats.W_curr >= safeguardThreshold()) tr.style.color = "#fca5a5";
        ui.pTable.appendChild(tr);
    });
    
    renderLog();
    saveState();
    VMH.Popup.update();
}

/* 팝업(lib/popup.js)의 '매칭 순서' 칸(왼쪽).
   표를 어느 열로 정렬해 뒀든 여기는 늘 우선순위 순이다(세이프가드 포함). 보류 중인 사람은 뺀다. */
const POPUP_TOP = 2;     // 위에서 이만큼은 강조 — 다음 판 후보
VMH.Popup.addSection('queue', () => {
    if (!room || !room.players || !room.players.length) return '';
    updateAverageWaitersStat();
    const list = getSortedPlayers({ key: 'priority', order: 'desc' }).filter(p => !p.onHold);
    if (!list.length) return '';
    return `<div class="sec queue"><h2>매칭 순서 · <span class="num">R${room.round}</span></h2>${list.map((p, i) => {
        const st = calculateScore(p);
        const cls = ['q', i < POPUP_TOP ? 'top' : '', st.W_curr >= safeguardThreshold() ? 'urgent' : ''].join(' ');
        return `<div class="${cls}"><span class="rank num">${i + 1}</span><span class="who">${playerLabelHtml(p)}${p.matchCount === 0 ? '<span class="tag">신입</span>' : ''}</span>`
             + `<span><span class="score num">${st.score.toFixed(2)}</span><span class="wait">대기 ${st.W_curr}</span></span></div>`;
    }).join('')}</div>`;
});

// 직전 렌더한 로그 시그니처. eventLog가 바뀌지 않으면 다시 그리지 않아
// 단순 닉네임 클릭 시 로그가 깜빡(재렌더)되는 것을 막는다.
let lastLogSignature = null;
// 로그 필터: 'all' | 'match' | 'inout'(입퇴장) | 'hold'(보류/복귀)
let logFilter = 'all';
const LOG_FILTER_GROUPS = {
    all:   ['match', 'join', 'leave', 'hold', 'return'],
    match: ['match'],
    inout: ['join', 'leave'],
    hold:  ['hold', 'return'],
};

function renderLog(force) {
    const logContainer = document.getElementById("log-container");
    if(!logContainer) return;

    const allowed = LOG_FILTER_GROUPS[logFilter] || LOG_FILTER_GROUPS.all;
    // 알려진 이벤트를 시간순으로 모은 뒤 필터 적용.
    const events = (room.eventLog || []).filter(ev => allowed.includes(ev.type));

    // 내용/필터가 직전과 동일하면 재렌더 생략 (깜빡임 방지)
    const signature = JSON.stringify([logFilter, events.map(ev =>
        ev.type === 'match'
            ? [ev.type, ev.round, ev.chooser, ev.opponent]
            : [ev.type, ev.round, ev.nickname]
    )]);
    if (!force && signature === lastLogSignature) return;
    lastLogSignature = signature;

    logContainer.innerHTML = "";

    if (events.length === 0) {
        const empty = document.createElement("div");
        empty.className = "log-empty";
        empty.textContent = "표시할 로그가 없습니다.";
        logContainer.appendChild(empty);
        return;
    }

    // 최신 이벤트가 좌상단부터 오도록 역순으로 렌더
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const block = document.createElement("div");
        block.className = "log-block log-" + ev.type;

        // 1. 라운드 번호
        const roundSpan = document.createElement("span");
        roundSpan.className = "round";
        roundSpan.textContent = `R${ev.round}`;
        block.appendChild(roundSpan);

        // 2. 이벤트 정보
        const infoDiv = document.createElement("div");
        infoDiv.className = "match-info";
        if (ev.type === 'match') {
            infoDiv.innerHTML = `<span class="chooser">${logLabelHtml(ev.chooser)}</span> vs ${logLabelHtml(ev.opponent)}`;
        } else if (ev.type === 'join') {
            infoDiv.innerHTML = `<span class="ev-enter">▶ 입장</span> ${logLabelHtml(ev.nickname)}`;
        } else if (ev.type === 'leave') {
            infoDiv.innerHTML = `<span class="ev-leave">◀ 퇴장</span> ${logLabelHtml(ev.nickname)}`;
        } else if (ev.type === 'hold') {
            infoDiv.innerHTML = `<span class="ev-hold">⏸ 보류</span> ${logLabelHtml(ev.nickname)}`;
        } else { // return
            infoDiv.innerHTML = `<span class="ev-return">▷ 복귀</span> ${logLabelHtml(ev.nickname)}`;
        }
        block.appendChild(infoDiv);

        logContainer.appendChild(block);
    }
}

// opts: 자동 인식으로 들어온 경우 { auto:true } — 명패는 room.plateBook에 있으므로 여기 담지 않는다.
//       opts.silent면 pushUndo/refreshUI를 호출부가 직접 묶어서 처리한다(여러 명 한꺼번에 반영).
function addPlayer(n, opts) {
    n = String(n).trim(); if(!n) return false;
    opts = opts || {};
    if(room.players.some(p=>p.nickname===n)) { if(!opts.silent && ui.manageMsg) {ui.manageMsg.textContent="이미 존재함"; ui.manageMsg.style.display="block";} return false; }
    // opts.force: 실제로 끝난 판의 참가자 — 8명 제한 때문에 매치 기록을 통째로 잃는 것보다는
    // 잠깐 초과를 허용하는 편이 낫다(다음 로비 인식에서 명단이 바로잡힌다)
    if(!opts.force && room.players.filter(p=>!p.onHold).length >= 8) { if(!opts.silent && ui.manageMsg) {ui.manageMsg.textContent="최대 8명"; ui.manageMsg.style.display="block";} return false; }
    if(!opts.silent) pushUndo();

    const isRejoin = room.seen.includes(n);
    // 기록이 있으면 가져오고, 없으면 기본값으로 설정
    const history = (isRejoin && room.playerHistory[n]) 
        ? room.playerHistory[n] 
        : { matchCount: 0, chooserCount: 0, waitSum: 0 };

    room.players.push({ 
        nickname: n, 
        joinOrder: room.seen.indexOf(n) === -1 ? room.seen.length : room.seen.indexOf(n), 
        lastPlay: room.round, 
        joinedAt: room.round, 
        matchCount: history.matchCount, 
        chooserCount: history.chooserCount, 
        waitSum: history.waitSum,
        heldRounds: 0,
        onHold: false,
        holdStart: null,
        rejoined: isRejoin,
        auto: !!opts.auto
    });

    if(!isRejoin) {
        room.seen.push(n);
    }
    // 플레이어 히스토리가 없는 경우 초기화
    if (!room.playerHistory[n]) {
        room.playerHistory[n] = { matchCount: 0, chooserCount: 0, waitSum: 0 };
    }

    room.eventLog.push({ type: 'join', round: room.round, nickname: n });

    if(!opts.silent) {
        if(ui.input) ui.input.value="";
        refreshUI();
    }
    return true;
}

/* 매치 한 판 기록. 수동 클릭과 화면 자동 인식이 같은 경로를 쓴다.
   chooser가 원디골(먼저 클릭한 쪽 / 자동일 때는 우선순위가 높은 쪽). pushUndo는 호출부 책임. */
function recordMatch(chooserNick, opponentNick) {
    const c = room.players.find(p => p.nickname === chooserNick);
    const o = room.players.find(p => p.nickname === opponentNick);
    if (!c || !o || c === o) return false;

    const nextRound = room.round + 1;

    // 이번 매치에서 실제로 기다린 판수(직전 플레이 이후 공백 라운드)를 누적
    const cWait = Math.max(0, nextRound - (c.lastPlay || 0) - 1);
    const oWait = Math.max(0, nextRound - (o.lastPlay || 0) - 1);
    c.waitSum = (c.waitSum || 0) + cWait;
    o.waitSum = (o.waitSum || 0) + oWait;

    room.round = nextRound;
    c.lastPlay = room.round;
    o.lastPlay = room.round;
    c.matchCount = (c.matchCount || 0) + 1;
    o.matchCount = (o.matchCount || 0) + 1;
    c.chooserCount = (c.chooserCount || 0) + 1;

    // 한 판 플레이하면 재입장 딱지 제거
    c.rejoined = false;
    o.rejoined = false;

    // 영구 기록 업데이트
    room.playerHistory[c.nickname] = { matchCount: c.matchCount, chooserCount: c.chooserCount, waitSum: c.waitSum };
    room.playerHistory[o.nickname] = { matchCount: o.matchCount, chooserCount: o.chooserCount, waitSum: o.waitSum };

    room.eventLog.push({ type: 'match', round: room.round, chooser: c.nickname, opponent: o.nickname });
    return true;
}

// 이벤트 핸들러 바인딩
if(ui.input) ui.input.onkeydown = (e) => { if(e.key === "Enter") addPlayer(ui.input.value); };
if(ui.addBtn) ui.addBtn.onclick = () => addPlayer(ui.input.value);
if(ui.pTable) ui.pTable.onclick = (e) => {
    const nick = e.target.closest("tr")?.dataset.nickname;
    if(!nick) return;
    if(e.target.classList.contains("small-delete")) {
        pushUndo();
        room.players = room.players.filter(p=>p.nickname!==nick);
        selected = selected.filter(x=>x!==nick); // [FIX] 선택 상태 desync 방지
        room.eventLog.push({ type: 'leave', round: room.round, nickname: nick });
        refreshUI();
        return;
    }
    if(e.target.classList.contains("small-hold")) { 
        pushUndo();
        const p = room.players.find(x=>x.nickname===nick);
        if(p) {
            if (!p.onHold) { p.onHold = true; p.holdStart = room.round; selected = selected.filter(x=>x!==nick); room.eventLog.push({ type: 'hold', round: room.round, nickname: nick }); }
            else { p.onHold = false; if (p.holdStart !== null) { const d = room.round - p.holdStart; if (d > 0) { p.lastPlay += d; p.heldRounds = (p.heldRounds || 0) + d; } p.holdStart = null; } room.eventLog.push({ type: 'return', round: room.round, nickname: nick }); }
        }
        refreshUI(); return;
    }
    if(room.players.find(p=>p.nickname===nick)?.onHold) return;
    if(selected.includes(nick)) selected = selected.filter(x=>x!==nick); else selected.push(nick);
    if(selected.length === 2) {
        const [cName, oName] = selected;
        pushUndo();
        if(!recordMatch(cName, oName)) undoStack.pop(); // 매칭이 성립 안 하면 스냅샷도 되돌린다
        selected=[];
        refreshUI();
    } else refreshUI();
}
if(ui.resetBtn) ui.resetBtn.onclick = () => {
    if(confirm("전체 초기화하시겠습니까?")) {
        pushUndo(); room = {round:0, players:[], eventLog:[], seen:[], playerHistory: {}, newcomerPriority:true}; selected = [];
        if(ui.imgOld) { ui.imgOld.src = ""; ui.imgOld.style.display = "none"; }
        if(ui.imgNew) { ui.imgNew.src = ""; ui.imgNew.style.display = "none"; }
        if(ui.phOld) ui.phOld.style.display = "flex"; 
        if(ui.phNew) ui.phNew.style.display = "flex";
        
        ['res-leave', 'res-stay', 'res-enter'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerHTML = '';
        });
        const am = document.getElementById('analysis-msg');
        if(am) am.innerText = "대기 중...";
        refreshUI();
    }
};
if(ui.undoBtn) ui.undoBtn.onclick = () => {
    if (undoStack.length === 0) { alert("되돌릴 기록이 없습니다."); return; }
    redoStack.push(JSON.parse(JSON.stringify(room))); room = undoStack.pop(); selected = []; refreshUI();
};
if(ui.redoBtn) ui.redoBtn.onclick = () => {
    if (redoStack.length === 0) { alert("다시 실행할 기록이 없습니다."); return; }
    undoStack.push(JSON.parse(JSON.stringify(room))); room = redoStack.pop(); selected = []; refreshUI();
};

// 기준 해시 초기화 및 시작
(function initStandardHash() {
    const img = new Image();
    img.src = READY_BASE64;
    img.onload = () => {
        const tCtx = Utils.getThumbCtx();
        tCtx.clearRect(0, 0, 16, 16);
        tCtx.drawImage(img, 0, 0, 16, 16);
        const thumbData = tCtx.getImageData(0, 0, 16, 16).data;
        STANDARD_READY_HASH = Utils.computeDHash(thumbData, 16);
        console.log("Standard Hash Loaded");
    };
})();

loadState();
refreshUI();

// 도움말·옵션 문구에 세이프가드 임계값 주입(단일 출처 — 가중치 편집기에서 바꾸면 다시 부른다)
function syncSafeguardText() {
    document.querySelectorAll('.safeguard-threshold').forEach(el => { el.textContent = safeguardThreshold(); });
}
syncSafeguardText();

/* ── 가중치 편집기 (옵션 탭) ─────────────────
   항목마다 슬라이더 + 숫자 칸. 바꾸는 즉시 저장하고 표·팝업을 다시 그린다 */
(function initWeightEditor() {
    const host = document.getElementById('weight-editor');
    const formula = document.getElementById('weight-formula');
    const resetBtn = document.getElementById('weight-reset-btn');
    const msg = document.getElementById('weight-msg');
    if (!host) return;

    const fmt = (v) => String(+v.toFixed(2));
    host.innerHTML = SCORE_WEIGHT_DEFS.map(d => {
        const pre = d.unit === '판' ? '' : `<span class="weight-unit">${d.unit}</span>`;
        const post = d.unit === '판' ? '<span class="weight-unit">판</span>' : '';
        return `<div class="weight-row" data-key="${d.key}">
          <label class="weight-name" for="w-num-${d.key}">${d.name}</label>
          <input type="range" class="weight-range" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.name}">
          <span class="weight-num-wrap">${pre}<input type="number" id="w-num-${d.key}" class="weight-num" min="${d.min}" max="${d.max}" step="${d.step}">${post}</span>
          <span class="weight-def">기본 ${fmt(d.def)}</span>
        </div>`;
    }).join('');

    function render() {
        const w = scoreWeights;
        SCORE_WEIGHT_DEFS.forEach(d => {
            const row = host.querySelector(`[data-key="${d.key}"]`);
            row.querySelector('.weight-range').value = w[d.key];
            const num = row.querySelector('.weight-num');
            if (document.activeElement !== num) num.value = fmt(w[d.key]);
            row.classList.toggle('changed', w[d.key] !== d.def);
        });
        if (formula) {
            formula.innerHTML =
                `가중치 = <b>${fmt(w.cur)}</b> × 현재 대기 + <b>${fmt(w.avg)}</b> × 평균 대기 − <b>${fmt(w.sel)}</b> × 원디골 비율 + ${fmt(scoreBase())}`;
        }
        if (resetBtn) resetBtn.disabled = SCORE_WEIGHT_DEFS.every(d => w[d.key] === d.def);
    }

    function changed() {
        saveScoreWeights();
        syncSafeguardText();
        render();
        refreshUI();
    }

    function apply(key, raw) {
        const d = SCORE_WEIGHT_DEFS.find(x => x.key === key);
        const v = clampWeight(d, raw);
        if (v === scoreWeights[key]) { render(); return; }
        scoreWeights[key] = v;
        changed();
    }

    host.addEventListener('input', (e) => {
        const row = e.target.closest('.weight-row');
        if (!row) return;
        // 숫자 칸은 입력하는 도중(빈 칸 등)엔 값을 되돌려 쓰지 않는다 — 다 치고 나가면 change에서 정리
        if (e.target.classList.contains('weight-range')) apply(row.dataset.key, e.target.value);
        else if (e.target.value !== '') apply(row.dataset.key, e.target.value);
    });
    host.addEventListener('change', (e) => {
        const row = e.target.closest('.weight-row');
        if (!row || !e.target.classList.contains('weight-num')) return;
        apply(row.dataset.key, e.target.value);
        e.target.value = fmt(scoreWeights[row.dataset.key]);
    });

    if (resetBtn) resetBtn.onclick = () => {
        setScoreWeights(null);
        changed();
        showInlineMsg(msg, '기본값(원래 공식)으로 돌렸습니다');
    };
    render();
})();

/* ── 도움말로 보내기 ─────────────────
   설명은 전부 도움말 탭에 모여 있다. 다른 탭의 '도움말' 버튼(data-goto-help)과
   도움말 탭 맨 위의 목차(data-help-go)가 같은 자리로 데려간다. */
function scrollToHelpSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('help-flash');
    void el.offsetWidth;   // 같은 곳을 다시 눌러도 반짝이도록 애니메이션을 되감는다
    el.classList.add('help-flash');
}

document.addEventListener('click', (e) => {
    const inHelp = e.target.closest('[data-help-go]');
    if (inHelp) { scrollToHelpSection(inHelp.dataset.helpGo); return; }

    const toHelp = e.target.closest('[data-goto-help]');
    if (toHelp) {
        VMH.Tabs.show('help');
        // 탭이 보이게 된 다음에 움직여야 자리가 제대로 잡힌다
        requestAnimationFrame(() => scrollToHelpSection(toHelp.dataset.gotoHelp));
    }
});

// 매칭 로그 접기/펼치기
(function initLogToggle(){
    const btn = document.getElementById('log-toggle-btn');
    const content = document.getElementById('log-content');
    const icon = document.getElementById('log-toggle-icon');
    if(!btn || !content || !icon) return;

    const toggle = () => {
        const hide = content.style.display !== 'none' ? true : false;
        content.style.display = hide ? 'none' : 'block';
        icon.innerText = hide ? '▼' : '▲';
        saveState();
    };

    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
})();

// 플레이어 현황 "더 많은 정보 보기" 토글
(function initMoreColumns(){
    const btn = document.getElementById('more-cols-btn');
    const card = document.getElementById('players-card');
    if(!btn || !card) return;

    const apply = (on) => {
        card.classList.toggle('show-extra', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '－ 간략히 보기' : '＋ 더 많은 정보 보기';
        try { SafeStorage.setItem('showExtraColumns', on ? '1' : '0'); } catch {}
    };

    let saved = '0';
    try { saved = SafeStorage.getItem('showExtraColumns') || '0'; } catch {}
    apply(saved === '1');

    btn.addEventListener('click', () => {
        apply(!card.classList.contains('show-extra'));
    });
})();

// 로그 필터 (전체 / 매치 / 입퇴장 / 보류·복귀)
(function initLogFilters(){
    const filters = document.getElementById('log-filters');
    if(!filters) return;
    filters.addEventListener('click', (e) => {
        const btn = e.target.closest('.log-filter-btn');
        if(!btn) return;
        logFilter = btn.dataset.filter || 'all';
        filters.querySelectorAll('.log-filter-btn').forEach(b => {
            b.classList.toggle('active', b === btn);
        });
        renderLog(true); // 필터 변경은 강제 재렌더
    });
})();


/**
 * =========================================================================
 * [버망호 공유용 복사 기능]
 * 티어 난이도 문구 복사: "(티어명)(티어 등급): 패드 n1~n2레벨, 스시 n3~n4레벨"
 * - 패드: NM/HD/MX, 스시: SC
 * =========================================================================
 */

function showInlineMsg(el, text) {
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el.__hideTimer);
  el.__hideTimer = setTimeout(() => { el.style.display = "none"; }, 1500);
}

function fallbackCopyText(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch { /* fallback, ignore */ }
  document.body.removeChild(ta);
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // file:// 로 열었거나 일부 환경에서 권한 문제 시 대비
  fallbackCopyText(text);
  return Promise.resolve();
}

const TIER_DIFFICULTY = [
  { tier: "GRAND MASTER", div: "",   pad: null,      sc: [10, 15] },
  { tier: "MASTER",       div: "",   pad: null,      sc: [8, 15] },

  { tier: "DIAMOND",      div: "I",  pad: null,      sc: [8, 15] },
  { tier: "DIAMOND",      div: "II", pad: [15, 15],  sc: [8, 15] },
  { tier: "DIAMOND",      div: "III",pad: [15, 15],  sc: [8, 15] },
  { tier: "DIAMOND",      div: "IV", pad: [15, 15],  sc: [6, 11] },

  { tier: "PLATINUM",     div: "I",  pad: [14, 15],  sc: [6, 9] },
  { tier: "PLATINUM",     div: "II", pad: [13, 15],  sc: [4, 9] },
  { tier: "PLATINUM",     div: "III",pad: [13, 15],  sc: [4, 7] },
  { tier: "PLATINUM",     div: "IV", pad: [12, 15],  sc: [2, 7] },

  { tier: "GOLD",         div: "I",  pad: [12, 14],  sc: [2, 7] },
  { tier: "GOLD",         div: "II", pad: [11, 13],  sc: [1, 5] },
  { tier: "GOLD",         div: "III",pad: [11, 13],  sc: [1, 5] },
  { tier: "GOLD",         div: "IV", pad: [10, 12],  sc: [1, 3] },

  { tier: "SILVER",       div: "I",  pad: [9, 12],   sc: [1, 3] },
  { tier: "SILVER",       div: "II", pad: [8, 11],   sc: [1, 1] },
  { tier: "SILVER",       div: "III",pad: [7, 11],   sc: [1, 1] },
  { tier: "SILVER",       div: "IV", pad: [7, 11],   sc: [1, 1] },

  { tier: "BRONZE",       div: "I",  pad: [7, 11],   sc: [1, 1] },
  { tier: "BRONZE",       div: "II", pad: [7, 10],   sc: null },
  { tier: "BRONZE",       div: "III",pad: [7, 10],   sc: null },
  { tier: "BRONZE",       div: "IV", pad: [6, 10],   sc: null },

  { tier: "IRON",         div: "I",  pad: [5, 9],    sc: null },
  { tier: "IRON",         div: "II", pad: [4, 8],    sc: null },
  { tier: "IRON",         div: "III",pad: [3, 7],    sc: null },
  { tier: "IRON",         div: "IV", pad: [1, 6],    sc: null },
];


function formatTierCopyText(x) {
  const head = x.div ? `${x.tier}(${x.div})` : x.tier;

  // Defensive formatting: allow null / undefined / malformed ranges
  const fmtRange = (label, range) => {
    if (!Array.isArray(range) || range.length < 2) return `${label} -`;
    const a = range[0], b = range[1];
    if (a == null || b == null) return `${label} -`;
    return (a === b) ? `${label} ${a}레벨` : `${label} ${a}~${b}레벨`;
  };

  const padText = fmtRange("패드", x.pad);
  const sushiText = fmtRange("스시", x.sc);

  return `${head}: ${padText}, ${sushiText}`;
}

/* ── 티어별 난이도 표 ─────────────────
   위의 TIER_DIFFICULTY 한 벌에서 막대까지 함께 그린다.

   패드(NM·HD·MX)와 스시(SC)는 난이도 체계가 달라서 같은 자로 재야 비교가 된다.
   버망호에서 쓰는 환산 기준은 패드 12 = 스시 2, 13 = 4, 14 = 6, 15 = 8 —
   즉 패드 한 칸이 스시 두 칸이고, 스시는 패드 11 자리에서 시작한다.
   그래서 가로축은 '패드 한 칸'을 단위로 삼고 두 막대를 같은 축 위에 겹쳐 놓는다.
   (스시 9~15는 패드에 대응이 없어서 축 오른쪽 끝으로 삐져나간다 — 빗금 친 구간)

   · 칸을 누르면 방 공지에 붙여넣을 문구가 복사된다
   · 하위 등급(I~IV)은 기본으로 펼쳐져 있고, 티어 이름을 누르면 접을 수 있다 */
const TIER_LEVEL_MAX = 15;      // 패드·스시 모두 15레벨까지
const TIER_SC_ORIGIN = 11;      // 스시 0레벨 자리 = 패드 11 끝 (그래서 스시 2가 패드 12와 같은 자리)

const tierPadX = (lv) => lv;                              // 패드 lv칸의 오른쪽 끝
const tierScX = (lv) => TIER_SC_ORIGIN + lv / 2;          // 스시 lv칸의 오른쪽 끝
const TIER_X_MAX = tierScX(TIER_LEVEL_MAX);               // 축 전체 길이 (= 18.5)
const tierPct = (x) => (x / TIER_X_MAX) * 100;
const tierAxisX = (kind, lv) => (kind === 'pad' ? tierPadX(lv) : tierScX(lv));

// 같은 티어끼리 묶는다 (DIAMOND I~IV → DIAMOND 한 묶음)
function tierGroups() {
  const out = [];
  TIER_DIFFICULTY.forEach((x, idx) => {
    const last = out[out.length - 1];
    if (last && last.tier === x.tier) last.items.push({ x, idx });
    else out.push({ tier: x.tier, items: [{ x, idx }] });
  });
  return out;
}

// 접힌 티어의 막대 = 하위 등급을 전부 아우르는 범위
function tierUnionRange(items, key) {
  const rs = items.map(it => it.x[key]).filter(r => Array.isArray(r) && r.length >= 2 && r[0] != null);
  if (!rs.length) return null;
  return [Math.min(...rs.map(r => r[0])), Math.max(...rs.map(r => r[1]))];
}

/* 그 난이도 체계에 자리가 없는 구간(패드는 12 위쪽 절반, 스시는 패드 11 아래쪽)을 빗금으로 덮는다 */
function tierOutOfBoundsHtml(kind) {
  return kind === 'pad'
    ? `<div class="tier-oob" style="left:${tierPct(TIER_LEVEL_MAX)}%;right:0"></div>`
    : `<div class="tier-oob" style="left:0;width:${tierPct(TIER_SC_ORIGIN)}%"></div>`;
}

function tierBarHtml(kind, label, range) {
  const head = `<span class="tier-bar-kind">${label}</span>`;
  const oob = tierOutOfBoundsHtml(kind);
  if (!Array.isArray(range) || range.length < 2 || range[0] == null) {
    return `<div class="tier-bar">${head}<div class="tier-track">${oob}<span class="tier-none">해당 없음</span></div></div>`;
  }
  const a = range[0], b = range[1];
  const left = tierPct(tierAxisX(kind, a - 1));
  const width = tierPct(tierAxisX(kind, b)) - left;
  const text = (a === b) ? `${a}` : `${a}~${b}`;
  return `<div class="tier-bar">${head}<div class="tier-track">${oob}` +
         `<div class="tier-fill ${kind}" style="left:${left}%;width:${width}%"><span>${text}</span></div>` +
         `</div></div>`;
}

function tierRowHtml(o) {
  const copyable = (o.idx != null);
  const attr = copyable ? `data-tier-idx="${o.idx}"` : 'data-tier-toggle="1" aria-expanded="true"';
  const title = copyable ? ' title="클릭하면 복사됩니다"' : ' title="클릭하면 하위 등급이 접힙니다"';
  return `<div class="tier-row ${o.cls}" ${attr} role="button" tabindex="0"${title}>` +
           `<div class="tier-name"><span class="tier-icon">${o.icon}</span><span>${escapeHtml(o.name)}</span></div>` +
           `<div class="tier-bars">${tierBarHtml('pad', '패드', o.pad)}${tierBarHtml('sc', '스시', o.sc)}</div>` +
         `</div>`;
}

// 눈금 한 줄. 패드는 한 칸, 스시는 반 칸 간격이라 각 칸 가운데에 숫자를 얹는다
function tierTicksHtml(kind) {
  let out = '';
  for (let n = 1; n <= TIER_LEVEL_MAX; n++) {
    const center = (tierAxisX(kind, n - 1) + tierAxisX(kind, n)) / 2;
    // 좁은 화면에서는 한 칸씩(아주 좁으면 네 칸마다) 걸러 숨긴다
    const parity = ((n % 2 === 1) ? ' t-odd' : ' t-even') + (n % 4 === 0 ? ' t-q4' : '');
    out += `<span class="tier-tick${parity}" style="left:${tierPct(center)}%">${n}</span>`;
  }
  return out;
}

function renderTierChart() {
  const host = document.getElementById('tier-chart');
  if (!host) return;

  // 눈금도 막대와 같은 격자(.tier-row > .tier-bar)를 그대로 써야 자리가 맞는다
  const axisBar = (kind, label) =>
    `<div class="tier-bar"><span class="tier-bar-kind">${label}</span><div class="tier-ticks ${kind}">${tierTicksHtml(kind)}</div></div>`;
  const scale = `<div class="tier-row tier-scale"><div class="tier-name tier-scale-label">레벨</div>` +
                `<div class="tier-bars">${axisBar('pad', '패드')}${axisBar('sc', '스시')}</div></div>`;

  const groups = tierGroups().map(g => {
    // GRAND MASTER·MASTER처럼 하위 등급이 없는 티어는 제목 줄이 곧 복사 대상
    const solo = g.items.length === 1 && !g.items[0].x.div;
    const head = solo
      ? tierRowHtml({ cls: 'tier-head', idx: g.items[0].idx, name: g.tier, pad: g.items[0].x.pad, sc: g.items[0].x.sc, icon: '📋' })
      : tierRowHtml({ cls: 'tier-head', name: g.tier, pad: tierUnionRange(g.items, 'pad'), sc: tierUnionRange(g.items, 'sc'), icon: '▼' });
    const subs = solo ? '' :
      `<div class="tier-subs">` +
        g.items.map(it => tierRowHtml({ cls: 'tier-sub', idx: it.idx, name: g.tier + ' ' + it.x.div, pad: it.x.pad, sc: it.x.sc, icon: '📋' })).join('') +
      `</div>`;
    return `<div class="tier-group" data-tier="${escapeHtml(g.tier)}">${head}${subs}</div>`;
  }).join('');

  host.innerHTML = scale + groups;
}

function setTierGroupOpen(headRow, open) {
  const subs = headRow.parentElement.querySelector('.tier-subs');
  if (!subs) return;
  subs.hidden = !open;
  headRow.setAttribute('aria-expanded', open ? 'true' : 'false');
  headRow.classList.toggle('open', open);
  headRow.title = open ? '클릭하면 하위 등급이 접힙니다' : '클릭하면 하위 등급이 펼쳐집니다';
  const icon = headRow.querySelector('.tier-icon');
  if (icon) icon.textContent = open ? '▼' : '▶';
}

function initTierUI() {
  const host = document.getElementById('tier-chart');
  const msg = document.getElementById('tier-copy-msg');
  const expandBtn = document.getElementById('tier-expand-btn');
  if (!host) return;

  renderTierChart();

  const activate = (row) => {
    if (row.dataset.tierToggle) {
      setTierGroupOpen(row, row.getAttribute('aria-expanded') !== 'true');
      syncExpandBtn();
      return;
    }
    const x = TIER_DIFFICULTY[parseInt(row.dataset.tierIdx, 10)];
    if (!x) return;
    const text = formatTierCopyText(x);
    copyToClipboard(text).then(() => {
      showInlineMsg(msg, '복사됨 — ' + text);
      row.classList.remove('copied');
      void row.offsetWidth;
      row.classList.add('copied');
    });
  };

  host.addEventListener('click', (e) => {
    const row = e.target.closest('.tier-row');
    if (row) activate(row);
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.tier-row');
    if (!row) return;
    e.preventDefault();
    activate(row);
  });

  function syncExpandBtn() {
    if (!expandBtn) return;
    const heads = [...host.querySelectorAll('.tier-row[data-tier-toggle]')];
    const allOpen = heads.length > 0 && heads.every(h => h.getAttribute('aria-expanded') === 'true');
    expandBtn.setAttribute('aria-pressed', allOpen ? 'true' : 'false');
    expandBtn.textContent = allOpen ? '－ 모두 접기' : '＋ 모두 펼치기';
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      const open = expandBtn.getAttribute('aria-pressed') !== 'true';
      host.querySelectorAll('.tier-row[data-tier-toggle]').forEach(h => setTierGroupOpen(h, open));
      syncExpandBtn();
    });
  }
  syncExpandBtn();
}

(function initCopyButtons(){
  initTierUI();
})();

document.addEventListener('DOMContentLoaded', function() {
    VMH.Tabs.init();

    // 테이블 헤더 클릭 정렬 이벤트 핸들러
    const pTableHead = document.querySelector("#player-table-body")?.parentElement.querySelector('thead');
    if (pTableHead) {
        pTableHead.addEventListener('click', (e) => {
            const th = e.target.closest('th');
            if (!th || !th.dataset.sortKey) return;

            const key = th.dataset.sortKey;
            if (currentSort.key === key) {
                currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.key = key;
                currentSort.order = key === 'nickname' ? 'asc' : 'desc';
            }
            refreshUI();
        });
    }

    // 토글 스위치 변경 시 UI 즉시 새로고침
    document.getElementById('newcomer-toggle')?.addEventListener('change', () => refreshUI());
    document.getElementById('safeguard-toggle')?.addEventListener('change', () => refreshUI());
});