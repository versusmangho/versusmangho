/**
 * =========================================================================
 * [수동 분석기] 로비 스크린샷 두 장을 비교해 입장/퇴장/잔류를 찾는다 (화면 연결을 못 쓸 때)
 * * Logic:
 * 1. Analyze Icon (Structure + Brightness) -> General Shape
 * 2. Detect Ready State (Fixed Position) -> Determine Background Mode
 * 3. Analyze Text (DCT pHash) -> Robust against pixel shifts
 * 4. Match Logic: Filter by Thresholds (Text <= 20 & Icon <= 60) -> Pick Best Text Match
 * =========================================================================
 */

// 1. 기준 이미지 (ISREADY_STANDARD.png)
const READY_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHoAAAA2CAIAAACHoRqkAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAuESURBVHhe7dv5U5NnAsBx/4JdyZ1whCNA7gQCCSQhCVQ57B7T8Sp369HWAm5ru6sgIqDtaBVpdThygATUIiIeRNTaabVatIoogsghle6uu10pigXCnXef98gJQW1tf+F95juZzJs8pn7m9cn7vs27CCpRYZUilUXZK7emtaZD0oOUkF4BZ7BWYa1Sbu8gUlUkljECq9qhGhncIWuHpdbCoSPWPkeqDcM6KoGOgkekOgnWsVB79SFwx8VYDQ6dEGGdBAmxToEE0GkhXKPIciEUalVC3TFwPdHWNFCPGqsXpEKKgnqVcPcVzsmh+5FwfRH2emU49yxuk8jyVRh0O+rlc3eF49xzcV+SQm2ql899N3QBc58QYgFuFLoR6YwIuiKF7qigHmAdA/WiaRyIbdAO3VdCfQqH5FAfsHboexnULsa5EW4UGq1JBDXLoA6Aa7NGuR2tX5z7AfgXI1zo3BN1gn9VcJuLgu3tYzcbRM1HwpqPSdHaTBH9l+RPbylmuoGsK/fkPWX/JVnraUlzfYhD4uZ6kWPfHhd8awxa6Nw/GblHPvSPk9LsyWhxCs84lVec2hvtrUT/A9u539ZJBq7LJzqjLD1O3E9vyfUfc95cyYxTM+YpVkWPVVAWOvd/KjhFa30I8w6WHzlKSk9f7nNgO7vzXMTUPXQRx7gHb0TmbQyQCCke847FyFjA3PCRiehhJXfvGiZG4mYQiQQqhcD0Jmgi6CX5vN4L4Aga5/6F3Lw9a5gAAlNxPwC6J524PN77UBHf3K609ODcL4ObRCT4+5DAAgLnS/bxJpHJBLAdXVj8mKTMNP8HF2XgG9KB29+RG7zf25PI8gN/iL0AX2IAk4Bzu3IH+JKLN3OMuwXGT4SGjwSb3w4KF9HAdpQbjNfivC9/HmJuV7jjDhNRNqT6GvdynNrDNm5n4tyu3EI2tatRNtKqGrmtftIS1XpStiE5INCfjGETCDFy+sFdHHBA4o47Xk2v2BU80iFz6k74yNdsnNuVW8Sh/vBFJHRPA3VHW7qizW3q/dt4UVIGhk0gSMXUne8HDLZEuuNeFk2vKWI7n+ZEQPdl0DUuzj1r7+ZQ+7+IsHTC3GjGT/jxagb2soeHREDJywwAyg7cTl+VGLfrNRMZ9B0P557NTXlw3om7Zg9/mcaZO2s+7lejGXNzX+fj3HNxn5VZ7qoduAXP4nZaTBBuzhzcLQKce/ZXJeXBmXBLh8qB+5l7t8va7Ya7dSFfonL3Vcmm9J+WWNqjALSlO3rmnqbyY95SJR17GRznCakF77Hm+apM0NDBYd90dwRcj8yadLpVhHPP4g6m/NAQarmjtHRrpu5pnrQoc94JDGaRsOMSAiFKSi8pYA+1uj0QXKKkHchnPWyWPLwqgR+RJwPXQn66gu/ds7iD/cj1H3EuV4m/+VxywRhaks+NkTOIRPtpzqsxXiaDcOSO42mO01elgENK+qvXrs0sW7s3s4qyAxrL8OPuWdxedGLqMq8Nq303JPm+sYIJlg4G3X4Sz6AR31zp23k+bKLT8STeiZtKAef6RB6bbIvPJgs4lG0Zvji3KzfYkf19iCxf+EIHUCMQwIvwq8CaRCKEiWi7/h48ekfxopeowPSNaT44tys3OmBjhwG2AGtfJunD9ayrxyS/4AIszu3KDUTAo83XZfh4k95O8r1gDBlqBav2fNx0KiEogBQupjpEkYoohe/54dwYN7BGuSkkDzmfpJJQBcEUdCM6glmUuv2Ch1cip7uA9Xzc3CDyyle9dmxi7fgACTzZFFD4vv9JLQfnduIGI5BJ1Gb51OYHvpfsSyETiWD1RgY7kNJQIvjfVTnyO5P5uKPltH25gd9fkti7KLl/MfTHG2E4tyu3MJDcXhI40CA8lB8sDKYAcXQ7y4+8Lye490vZM7nhS1T7XK4IRs70RYBwblducRC5vzJ4+pz40gH+qgRvLwZ2guPtSUp9jdkMPgjn/vXcgAllFQWRf6hkW86J7tYICzay/Jhk8AKIQiGIedSGUtFk5zPW7jm5LX0yEM5t50aHKJDUX8mBTPwfGwTHinmBLMofwbE3gQAWcRqVWFLAG7gOTt/n5Y5h1OzjuHBDfVIQzu2Gu5FnNgluVgk5QZQ/INzo2LIhsM0UjnO/XG4u4J5uEvTXiv6i8fT2Jtm4X/8z85RWNIvb+QIszv2C3ByLiT9zVvjohPjjd/zDhFQbtyyUXpzLmeyKcj6Jd+KOg//XMHu0Q+Zc+GgHfiBYyZ2Te6ZJOH1e/NQkbtrNTlAybNyeDFJWuv/gTTny80wrd5YTt0pG2/kBq7UxxCFxa6MQtIC50d8IVnLgH60B7cUENBELHJlwZs4Ip8+Kxk3CPiMvKd5rsfVkB4xVf/K51Rg2fleJLCmqwRvy7Zn+EoGdm+VL0kTS0pb7OOcFWvDcFZyiNT42axu3xSSYOSOYMgmGT/AzV3jTGHbvWLVn3QH+8G30yskc3ESiBzhqZNCdotM8QDj3fNyo+O53/EJ5VAybQAgVUrdmBDz6To7+8ng295wDrFdgLHTu/1ZyPl3HpJGItsLZlH8etHODGncGpiV40mlENH8mOSHaq+8r2VQXWLtVgy3ywr8FRIZSaVRwYO4+igdooXM/MnIPb/KLD6PaSl9C/7Ga68jdrmUXZ/nFaxi2Ul7z6WgKN3fAy/fQLUVpQdAbK7zjNXS3qWloC5gbPjIRjtTy2z4Nrn7fD24TXENOwHAdD2rkg2NBtEe13Gvl3Oo9guq9/Oq9PFB9ieDflyPG78J791iH8mq9+HgZr6aIM1dsa0Gghc493SAcPSoYqOEN1HAHDsENHuFNn+SD0xwsE2/qFG/4bMjAFcXANcXAd3BgAbHeNRI106McboscvCkbuOGYdOBGOFxLmDUJaKFzY2H3Vdpy4ob7UgzdiIS6VNb7KuEvSSSwgz/nfZUyEM79fNxnBdDFUPjuv27kZlac+7flPsODzguhmwqoE9nBce6XzW0VR7lBTXzochh0Rw5126xx7pfJjWTjBp0XQC1SCL4rB+f+HbjBkvJNCHQbvdEP5/4duL8QQFcl8A5uv3cY5/7tuJt40Nci6JYMwu6Pf0Fuc1kC0jJzOZI2wVxuDTxH01nTIxlA8aOG2OEyzdNS1ahWM10VO3VwCVzV0unqWLTxg6/8rI16UiJ/XBoxpJUPG1SjVTFm4ytj1UvMNY69Yq6JMR+KGTFqhgzyJ3rZoDb8sV72c5VivFYzcTQGPI7VqseOaiaOacbqNCOHFY8Phg5WhD6pCh8+LB+rU43XqyeOayYa1GP1quEjsiFj6GOj6OnhsJG6CHO9wlyvNB9XjtlqgDODToAUSHLzSVAk3Cms0dPWGiPsmeCGTdKhc5In16NGO5ZMdMdP9oDiJnuXTvYshR97Yyd7Yse7lozejX7aphpuV43d00z1xox1aUY61Yt02em67DRtdjqaLidNn5Putq2OpWm3JJdtTtRmJ1VsS6vMTYUDT7anVebBGXJTtNmJZf9YXbZ5dfmW17U5SbrcFH1uqmFbmg4uFSlNn5eKptuWXJ7zeln2qtItK0uzV2lzEw35KRUFqeDRkJ8MPxak6PNTtHmJJTkrSrJXlOWs0uWB9ySD7RWFcIaCZG3e6vKtK8u2LtduW6XLT9QXJCEl6+CSkJINhcl6rCS37YDTFSZpdySi6XYk6nfC6QpXlxeuLNudqNuXUvFZOqhyfxqo4jP4EX1iKE7V7ksu25tYXpSoL06u3J9i+DRZV5y8KCsjIzMDjHcz3oXLzHgXbNn4fKFzM+FZ8BN4YiaS89tmh03MQCZmZmShs56VdZZ1IvhzZr3HXY4Twaxf9onP/3EOf0GniYveWrcOtB5u7bq1a0DgOdjy9vOFzV27FkzHJq5Hcn7b7JBPhD/UdeK8vbXedaLLG9zlMvE5Pw70qyei/53IxPXr/g+AlsSLGBHrPwAAAABJRU5ErkJggg==";

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
 * [UTILS] 캔버스·필터. 해시 계산은 lib/imghash.js(VMH.ImgHash.bits*)에 있다
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
        const hash = VMH.ImgHash.bitsDHash(thumbData.data, 16);
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
        
        this.aHash = VMH.ImgHash.bitsAHash(iconThumbData);
        this.dHash = VMH.ImgHash.bitsDHash(iconThumbData, 16);
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
            dist = VMH.ImgHash.bitsDist(result.hash, STANDARD_READY_HASH);
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
            
            this.pHash = VMH.ImgHash.bitsPHash(pHashData);

        } else {
            this.pHash = []; 
        }
    }

    checkEmpty(imgData) {
        const d = imgData.data;
        if (d.length === 0) return true;
        let sum = 0, sqSum = 0;
        for(let i=0; i<d.length; i+=4) {
            const l = VMH.ImgHash.lum(d[i],d[i+1],d[i+2]);
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
                const iconDist = VMH.ImgHash.bitsDist(oldS.aHash, newS.aHash) + VMH.ImgHash.bitsDist(oldS.dHash, newS.dHash);
                const textDist = VMH.ImgHash.bitsDist(oldS.pHash, newS.pHash);

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

// 기준 해시 초기화 및 시작
(function initStandardHash() {
    const img = new Image();
    img.src = READY_BASE64;
    img.onload = () => {
        const tCtx = Utils.getThumbCtx();
        tCtx.clearRect(0, 0, 16, 16);
        tCtx.drawImage(img, 0, 0, 16, 16);
        const thumbData = tCtx.getImageData(0, 0, 16, 16).data;
        STANDARD_READY_HASH = VMH.ImgHash.bitsDHash(thumbData, 16);
        console.log("Standard Hash Loaded");
    };
})();

/* 전체 초기화 때 분석기 화면도 비운다 (controls.js의 초기화 버튼) */
function resetAnalyzer() {
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
}
