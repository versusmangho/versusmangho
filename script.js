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

let STANDARD_READY_HASH = null;

/**
 * [UTILS] 이미지 처리 및 수학 연산
 */
const Utils = {
    getCtx: (w, h) => {
        const cvs = document.getElementById('processCanvas');
        cvs.width = w || 1; cvs.height = h || 1;
        return cvs.getContext('2d', { willReadFrequently: true });
    },
    getThumbCtx: () => {
        return document.getElementById('thumbCanvas').getContext('2d', { willReadFrequently: true });
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

    if (!imgOld.src || !imgNew.src) return; 

    msgEl.innerText = "분석 중...";
    
    // 결과창 초기화
    ['res-leave', 'res-stay', 'res-enter'].forEach(id => document.getElementById(id).innerHTML = '');

    try {
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
                // - 아이콘 거리 60 이하 (기본 형태 유사)
                // - 텍스트 거리 20 이하 (글자 확실히 유사)
                if (iconDist <= ANALYZER_CONFIG.THRESHOLD_ICON && textDist <= ANALYZER_CONFIG.THRESHOLD_TEXT) {
                    
                    // 3. 점수 산정 (타이브레이크)
                    // 우선순위: 텍스트 거리(textDist) > 아이콘 거리(iconDist)
                    // textDist를 정수부로, iconDist를 소수부로 두어 텍스트 우선 비교
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
            }
        });

        // 새로 들어온 유저 처리
        newSlots.forEach((newS, idx) => {
            if (!newS.isEmpty && !usedNew[idx]) {
                addResult('enter', `Slot ${newS.index+1}`, newS.cardImage, 'IN');
            }
        });

        msgEl.innerText = "분석 완료";
        saveState(); 

    } catch (e) {
        console.error(e);
        msgEl.innerText = "오류: " + e.message;
    }
}

function addResult(type, text, img, tag) {
    const colId = type === 'leave' ? 'res-leave' : (type === 'enter' ? 'res-enter' : 'res-stay');
    const container = document.getElementById(colId);
    
    const div = document.createElement('div');
    div.className = 'log-item';
    let tagHtml = tag ? `<span class="move-tag">${tag}</span>` : '';
    div.innerHTML = `<img src="${img}" class="log-thumb"><div class="log-info"><span>${text}</span>${tagHtml}</div>`;
    container.appendChild(div);
}

/**
 * [SYSTEM] UI 이벤트 및 스토리지 관리
 */
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
    lTable: document.getElementById("log-table-body"),
    manageMsg: document.getElementById("manage-msg"),
    addBtn: document.getElementById("add-btn"),
    undoBtn: document.getElementById("undo-btn"),
    redoBtn: document.getElementById("redo-btn"),
    resetBtn: document.getElementById("reset-btn")
};

// 이미지 붙여넣기 핸들러
document.addEventListener('paste', (e) => {
    if (e.target === ui.input) return;
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
    const oldFull = ui.imgOld.style.display === 'block';
    const newFull = ui.imgNew.style.display === 'block';
    
    if (!oldFull) {
        setImage(ui.imgOld, ui.phOld, src);
    } else if (!newFull) {
        setImage(ui.imgNew, ui.phNew, src);
        ui.imgNew.onload = () => setTimeout(runAnalysis, 100); 
    } else {
        setImage(ui.imgOld, ui.phOld, ui.imgNew.src);
        setImage(ui.imgNew, ui.phNew, src);
        ui.imgNew.onload = () => setTimeout(runAnalysis, 100);
    }
}

function setImage(img, ph, src) {
    img.style.display = 'block'; 
    ph.style.display = 'none';
    img.src = src;
}

if(ui.anaToggle) {
    ui.anaToggle.onclick = () => {
        const hide = ui.anaContent.style.display === 'none';
        ui.anaContent.style.display = hide ? 'block' : 'none';
        ui.anaToggle.querySelector('.toggle-icon').innerText = hide ? '▲' : '▼';
    }
}

// 스토리지 및 상태 관리
const SafeStorage={available:false,getItem:function(k){try{return window.localStorage.getItem(k)}catch{return null}},setItem:function(k,v){try{window.localStorage.setItem(k,v);return true}catch(e){return false}}};
try{const k="__t";window.localStorage.setItem(k,"1");window.localStorage.removeItem(k);SafeStorage.available=true;}catch{}
const STORAGE_KEY = "roomStateV3";
let room = { round: 0, players: [], matchLog: [], seen: [], newcomerPriority: true };
let undoStack = [], redoStack = [], selected = [];

function pushUndo() {
    const snapshot = JSON.parse(JSON.stringify(room));
    undoStack.push(snapshot);
    redoStack = [];
    if (undoStack.length > 50) undoStack.shift();
}
function saveState() {
    const analysis = {
        resLeave: document.getElementById('res-leave').innerHTML,
        resStay: document.getElementById('res-stay').innerHTML,
        resEnter: document.getElementById('res-enter').innerHTML,
        msg: document.getElementById('analysis-msg').innerText,
        oldVisible: ui.imgOld.style.display === 'block',
        newVisible: ui.imgNew.style.display === 'block',
        imgOldSrc: ui.imgOld.getAttribute('src') || "",
        imgNewSrc: ui.imgNew.getAttribute('src') || ""
    };
    const logCollapsed = (document.getElementById("log-content")?.style.display === "none");
    const data = { room, analysis, logCollapsed };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}
function loadState() {
    const r = SafeStorage.getItem(STORAGE_KEY);
    if (!r) return null;
    try {
        const parsed = JSON.parse(r);
        if (parsed.room) room = parsed.room;
        if (parsed.analysis) {
            const a = parsed.analysis;
            document.getElementById('res-leave').innerHTML = a.resLeave || "";
            document.getElementById('res-stay').innerHTML = a.resStay || "";
            document.getElementById('res-enter').innerHTML = a.resEnter || "";
            document.getElementById('analysis-msg').innerText = a.msg || "대기 중...";
            if (a.oldVisible && a.imgOldSrc) { ui.imgOld.src = a.imgOldSrc; ui.imgOld.style.display = 'block'; ui.phOld.style.display = 'none'; }
            if (a.newVisible && a.imgNewSrc) { ui.imgNew.src = a.imgNewSrc; ui.imgNew.style.display = 'block'; ui.phNew.style.display = 'none'; }
        }

        // 매칭 로그 접힘 상태 복원
        if (typeof parsed.logCollapsed === "boolean") {
            const logContent = document.getElementById("log-content");
            const logIcon = document.getElementById("log-toggle-icon");
            if (logContent && logIcon) {
                const hide = parsed.logCollapsed;
                logContent.style.display = hide ? "none" : "block";
                logIcon.innerText = hide ? "▼" : "▲";
            }
        }
        return parsed;
    } catch (e) { return null; }
}

function refreshUI() {
    if(ui.round) ui.round.textContent = `라운드: ${room.round}`;
    if(ui.pTable) ui.pTable.innerHTML = "";
    if(ui.lTable) ui.lTable.innerHTML = "";
    ui.manageMsg.style.display = "none";
    if(document.getElementById("match-msg")) document.getElementById("match-msg").style.display = "none";

    const sorted = [...room.players].sort((a,b) => {
        if (a.onHold !== b.onHold) return a.onHold ? 1 : -1;
        const waitA = room.round - (a.lastPlay || 0);
        const waitB = room.round - (b.lastPlay || 0);
        const urgencyA = waitA >= 4; const urgencyB = waitB >= 4;
        if (urgencyA !== urgencyB) return urgencyA ? -1 : 1;
        
        const newcomerMode = document.getElementById("newcomer-toggle")?.checked;
        if (newcomerMode && !urgencyA && !urgencyB) {
            const isNewA = a.matchCount === 0; const isNewB = b.matchCount === 0;
            if (isNewA !== isNewB) return isNewA ? -1 : 1;
        }
        if (waitA !== waitB) return waitB - waitA;
        
        const avgA = (room.round - (a.joinedAt||0)) / ((a.matchCount||0) + 1);
        const avgB = (room.round - (b.joinedAt||0)) / ((b.matchCount||0) + 1);
        if (Math.abs(avgA - avgB) > 0.01) return avgB - avgA;
        if ((a.chooserCount||0) !== (b.chooserCount||0)) return (a.chooserCount||0) - (b.chooserCount||0);
        return (a.joinOrder||0) - (b.joinOrder||0);
    });

    let rank = 0;
    sorted.forEach(p => {
        const tr = document.createElement("tr");
        const hold = !!p.onHold;
        const idle = hold ? "-" : (room.round - (p.lastPlay||0));
        const avgWait = hold ? "-" : ((room.round - (p.joinedAt||0)) / ((p.matchCount||0) + 1)).toFixed(1);

        tr.innerHTML = `
            <td>${hold?"보류":++rank+"순위"}</td>
            <td>${p.nickname} ${p.rejoined?'<span class="tag danger">재입장</span>':''} ${!hold && p.matchCount===0?'<span class="tag" style="border-color:#4ade80;color:#86efac">신입</span>':''} ${hold?'<span class="tag danger">보류</span>':''}
                <button class="small-hold">${hold?"복귀":"보류"}</button><button class="small-delete">×</button>
            </td>
            <td>${p.chooserCount||0}</td>
            <td>${idle}</td>
            <td>${avgWait}</td>
        `;
        tr.dataset.nickname = p.nickname;
        if(selected.includes(p.nickname)) tr.classList.add("highlight");
        if (!hold && idle >= 4) tr.style.color = "#fca5a5"; 
        ui.pTable.appendChild(tr);
    });
    
    room.matchLog.forEach(l => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${l.round}</td><td>${l.chooser}</td><td>${l.opponent}</td>`;
        ui.lTable.appendChild(tr);
    });
    saveState();
}

function addPlayer(n) {
    n = n.trim(); if(!n) return;
    if(room.players.some(p=>p.nickname===n)) { ui.manageMsg.textContent="이미 존재함"; ui.manageMsg.style.display="block"; return; }
    if(room.players.filter(p=>!p.onHold).length >= 8) { ui.manageMsg.textContent="최대 8명"; ui.manageMsg.style.display="block"; return; }
    pushUndo();
    const isRejoin = room.seen.includes(n);
    room.players.push({ nickname: n, joinOrder: room.seen.length, lastPlay: room.round, joinedAt: room.round, matchCount: 0, chooserCount: 0, onHold: false, holdStart: null, rejoined: isRejoin });
    if(!isRejoin) room.seen.push(n);
    ui.input.value=""; refreshUI();
}

// 이벤트 핸들러 바인딩
if(ui.input) ui.input.onkeydown = (e) => { if(e.key === "Enter") addPlayer(ui.input.value); };
if(ui.addBtn) ui.addBtn.onclick = () => addPlayer(ui.input.value);
if(ui.pTable) ui.pTable.onclick = (e) => {
    const nick = e.target.closest("tr")?.dataset.nickname;
    if(!nick) return;
    if(e.target.classList.contains("small-delete")) { pushUndo(); room.players = room.players.filter(p=>p.nickname!==nick); refreshUI(); return; }
    if(e.target.classList.contains("small-hold")) { 
        pushUndo();
        const p = room.players.find(x=>x.nickname===nick); 
        if(p) { 
            if (!p.onHold) { p.onHold = true; p.holdStart = room.round; selected = selected.filter(x=>x!==nick); } 
            else { p.onHold = false; if (p.holdStart !== null) { const d = room.round - p.holdStart; if (d > 0) { p.lastPlay += d; p.joinedAt += d; } p.holdStart = null; } }
        }
        refreshUI(); return; 
    }
    if(room.players.find(p=>p.nickname===nick)?.onHold) return;
    if(selected.includes(nick)) selected = selected.filter(x=>x!==nick); else selected.push(nick);
    if(selected.length === 2) {
        const [cName, oName] = selected;
        const c = room.players.find(p=>p.nickname===cName); const o = room.players.find(p=>p.nickname===oName);
        if(c && o && c!==o) {
            pushUndo(); room.round++; c.lastPlay=room.round; o.lastPlay=room.round; c.matchCount = (c.matchCount||0)+1; o.matchCount = (o.matchCount||0)+1; c.chooserCount = (c.chooserCount||0)+1;
            room.matchLog.push({round:room.round, chooser:c.nickname, opponent:o.nickname}); selected=[]; refreshUI();
        } else { selected=[]; refreshUI(); }
    } else refreshUI();
}
if(ui.resetBtn) ui.resetBtn.onclick = () => {
    if(confirm("전체 초기화하시겠습니까?")) {
        pushUndo(); room = {round:0, players:[], matchLog:[], seen:[], newcomerPriority:true}; selected = [];
        ui.imgOld.src = ""; ui.imgOld.style.display = "none"; ui.imgNew.src = ""; ui.imgNew.style.display = "none";
        ui.phOld.style.display = "flex"; ui.phNew.style.display = "flex";
        ['res-leave', 'res-stay', 'res-enter'].forEach(id => document.getElementById(id).innerHTML = '');
        document.getElementById('analysis-msg').innerText = "대기 중...";
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

loadState(); refreshUI();

// 도움말 모달
const helpModal = document.getElementById('help-modal');
const helpBtn = document.getElementById('help-btn');
const helpCloseBtn = document.getElementById('help-close-btn');
const helpBackdrop = document.querySelector('.modal-backdrop');
if (helpBtn) helpBtn.onclick = () => helpModal.classList.add('open');
if (helpCloseBtn) helpCloseBtn.onclick = () => helpModal.classList.remove('open');
if (helpBackdrop) helpBackdrop.onclick = () => { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); };

// 버망호 안내(이미지) 모달
const infoModal = document.getElementById('info-modal');
const infoBtn = document.getElementById('info-btn');
const infoCloseBtn = document.getElementById('info-close-btn');
if (infoBtn && infoModal) infoBtn.onclick = () => { infoModal.classList.add('open'); updateTierPreviewByIndex(parseInt(document.getElementById('tier-select')?.value || '0', 10)); };
if (infoCloseBtn && infoModal) infoCloseBtn.onclick = () => infoModal.classList.remove('open');
// 같은 backdrop를 공유하므로, 클릭 시 열린 모달만 닫히게 처리
document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => {
        document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    });
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


/**
 * =========================================================================
 * [버망호 공유용 복사 기능]
 * 1) 현재 1순위 문구 복사: "현재 1순위 : n판째 대기 중, 평균 n판 기다림."
 * 2) 티어 난이도 문구 복사: "(티어명)(티어 등급): 패드 n1~n2레벨, 스시 n3~n4레벨"
 *   - 패드: NM/HD/MX, 스시: SC
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
  try { document.execCommand("copy"); } catch (e) {}
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

function getSortedPlayersForPriority() {
  const sorted = [...room.players].sort((a,b) => {
    if (a.onHold !== b.onHold) return a.onHold ? 1 : -1;

    const waitA = room.round - (a.lastPlay || 0);
    const waitB = room.round - (b.lastPlay || 0);

    const urgencyA = waitA >= 4;
    const urgencyB = waitB >= 4;
    if (urgencyA !== urgencyB) return urgencyA ? -1 : 1;

    const newcomerMode = document.getElementById("newcomer-toggle")?.checked;
    if (newcomerMode && !urgencyA && !urgencyB) {
      const isNewA = a.matchCount === 0;
      const isNewB = b.matchCount === 0;
      if (isNewA !== isNewB) return isNewA ? -1 : 1;
    }

    if (waitA !== waitB) return waitB - waitA;

    const avgA = (room.round - (a.joinedAt||0)) / ((a.matchCount||0) + 1);
    const avgB = (room.round - (b.joinedAt||0)) / ((b.matchCount||0) + 1);
    if (Math.abs(avgA - avgB) > 0.01) return avgB - avgA;

    if ((a.chooserCount||0) !== (b.chooserCount||0)) return (a.chooserCount||0) - (b.chooserCount||0);
    return (a.joinOrder||0) - (b.joinOrder||0);
  });

  return sorted.filter(p => !p.onHold);
}

function copyCurrentTopPriorityText() {
  const msg = document.getElementById("priority-copy-msg");
  const list = getSortedPlayersForPriority();
  if (list.length === 0) {
    showInlineMsg(msg, "대기 중인 플레이어가 없습니다.");
    return;
  }
  const p = list[0];
  const currentWait = room.round - (p.lastPlay || 0);
  const avgWait = ((room.round - (p.joinedAt||0)) / ((p.matchCount||0) + 1)).toFixed(1);
  const text = `현재 1순위 : ${currentWait}판째 대기 중, 평균 ${avgWait}판 기다림.`;

  copyToClipboard(text).then(() => showInlineMsg(msg, "클립보드에 복사되었습니다."));
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



function formatTierLabel(x) {
  return x.div ? `${x.tier} ${x.div}` : x.tier;
}
function formatTierCopyText(x) {
  const head = x.div ? `${x.tier}(${x.div})` : x.tier;
  const [p1,p2] = x.pad;
  const padText = (p1 === p2) ? `패드 ${p1}레벨` : `패드 ${p1}~${p2}레벨`;
  const sushiText = x.sc ? ((x.sc[0]===x.sc[1]) ? `스시 ${x.sc[0]}레벨` : `스시 ${x.sc[0]}~${x.sc[1]}레벨`) : `스시 -`;
  return `${head}: ${padText}, ${sushiText}`;
}

function updateTierPreviewByIndex(idx) {
  const preview = document.getElementById("tier-preview");
  if (!preview) return;
  if (Number.isNaN(idx) || idx < 0 || idx >= TIER_DIFFICULTY.length) {
    preview.textContent = "";
    return;
  }
  preview.textContent = formatTierCopyText(TIER_DIFFICULTY[idx]);
}

function initTierCopyUI() {
  const sel = document.getElementById("tier-select");
  const btn = document.getElementById("tier-copy-btn");
  const msg = document.getElementById("tier-copy-msg");
  if (!sel || !btn) return;

  sel.innerHTML = "";
  TIER_DIFFICULTY.forEach((x, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = formatTierLabel(x);
    sel.appendChild(opt);
  });

  
  // 선택 즉시 난이도 표시
  updateTierPreviewByIndex(parseInt(sel.value, 10));
  sel.addEventListener("change", () => {
    updateTierPreviewByIndex(parseInt(sel.value, 10));
  });
btn.addEventListener("click", () => {
    const idx = parseInt(sel.value, 10);
    const x = TIER_DIFFICULTY[idx];
    const text = formatTierCopyText(x);
    copyToClipboard(text).then(() => showInlineMsg(msg, "클립보드에 복사되었습니다."));
  });
}

(function initCopyButtons(){
  const priBtn = document.getElementById("priority-copy-btn");
  if (priBtn) priBtn.addEventListener("click", copyCurrentTopPriorityText);
  initTierCopyUI();
})();
