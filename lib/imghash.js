/* 이미지 인식용 해시·지문 알고리즘 — 전부 이 파일 한 곳에만 둔다.
   화면에서 무언가를 알아보는 곳(층수 측정기, 성과 스캔, 방 인식, 수동 분석기)과
   hashes.json을 만드는 generate-hashes.js(Node)가 모두 여기 함수를 불러 쓴다.
   그래서 계산 방식이 어긋날 일이 없다. 다만 aHash/dHash/pHash/컬러그리드(4x4)/자켓 지문을 바꾸면
   hashes.json을 다시 만들어야 비교가 맞는다.

   브라우저: <script src="lib/imghash.js"> → VMH.ImgHash
   Node:     require('./lib/imghash.js')(createCanvas) — 캔버스 만드는 함수(node-canvas)를 넘긴다 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) { module.exports = factory; return; }
    root.VMH = root.VMH || {};
    root.VMH.ImgHash = factory((w, h) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    });
})(typeof window !== 'undefined' ? window : globalThis, function (makeCanvas) {
    'use strict';

    const ctx2d = (canvas) => canvas.getContext('2d', { willReadFrequently: true });

    /* 원본의 (x, y, w, h)만 잘라낸 캔버스. 이후 해시는 모두 이 캔버스를 받는다 */
    function cropToCanvas(sourceImg, x, y, w, h) {
        const c = makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        ctx2d(c).drawImage(sourceImg, x, y, w, h, 0, 0, c.width, c.height);
        return c;
    }

    function getGrayscaleFromCanvas(canvas, w, h) {
        const data = ctx2d(canvas).getImageData(0, 0, w, h).data, gray = new Float32Array(w * h);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = (data[i] + data[i + 1] + data[i + 2]) / 3.0;
        return gray;
    }

    /* 칸별 평균 색. segments=4가 hashes.json과 맞는 기본값이고,
       명패 식별처럼 더 잘게 봐야 하는 곳은 호출부에서 segments를 올려 쓴다 */
    function getColorGridFromCanvas(canvas, segments = 4) {
        const ctx = ctx2d(canvas);
        const w = canvas.width, h = canvas.height;
        const sw = w / segments, sh = h / segments;
        const colors = [];
        // 칸이 1픽셀보다 작아지면 getImageData가 폭 0으로 잘라 예외를 던진다
        // (아주 작은 그림을 붙여넣은 경우). 정상 크기에서는 sw/sh가 1 이상이라 값이 달라지지 않는다.
        const gw = Math.max(1, sw), gh = Math.max(1, sh);
        for (let sy = 0; sy < segments; sy++) {
            for (let sx = 0; sx < segments; sx++) {
                const data = ctx.getImageData(Math.min(sx * sw, w - gw), Math.min(sy * sh, h - gh), gw, gh).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; count++; }
                colors.push(Math.round(r / count), Math.round(g / count), Math.round(b / count));
            }
        }
        return colors;
    }

    // 원본을 w×h로 줄여 그린 캔버스 (해시 계산용)
    function resized(canvas, w, h) {
        const c = makeCanvas(w, h);
        c.getContext('2d').drawImage(canvas, 0, 0, w, h);
        return c;
    }

    function aHashFromCanvas(canvas) {
        const size = 16;
        const gray = getGrayscaleFromCanvas(resized(canvas, size, size), size, size);
        let avg = 0; for (let i = 0; i < gray.length; i++) avg += gray[i]; avg /= gray.length;

        const bits = [];
        for (let i = 0; i < 8; i++) {
            let val = 0;
            for (let j = 0; j < 32; j++) val = (val << 1) | (gray[i * 32 + j] >= avg ? 1 : 0);
            bits.push(val >>> 0);
        }
        return bits;
    }

    function dHashFromCanvas(canvas) {
        const size = 16;
        const gray = getGrayscaleFromCanvas(resized(canvas, size + 1, size), size + 1, size);

        const bits = [];
        let bitCount = 0, currentVal = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const left = gray[y * (size + 1) + x], right = gray[y * (size + 1) + x + 1];
                currentVal = (currentVal << 1) | (left < right ? 1 : 0);
                bitCount++;
                if (bitCount % 32 === 0) { bits.push(currentVal >>> 0); currentVal = 0; }
            }
        }
        return bits;
    }

    function popcnt32(v) {
        v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    }

    /* 배열(a/dHash)과 {hi,lo}(pHash) 두 형태를 모두 받는다 */
    function hamDist(a, b) {
        if (!a || !b) return Infinity;
        if (Array.isArray(a)) {
            let dist = 0;
            for (let i = 0; i < a.length; i++) dist += popcnt32((a[i] ^ b[i]) >>> 0);
            return dist;
        }
        return popcnt32((a.hi ^ b.hi) >>> 0) + popcnt32((a.lo ^ b.lo) >>> 0);
    }

    /* 칸별 평균 색 차이(0~255). 같은 길이의 컬러그리드끼리만 비교할 것 */
    function colorDist(c1, c2) {
        if (!c1 || !c2 || c1.length !== c2.length) return Infinity;
        let dist = 0;
        for (let i = 0; i < c1.length; i++) dist += Math.abs(c1[i] - c2[i]);
        return dist / c1.length;
    }

    // 코사인 값은 N마다 같으므로 한 번만 계산해 둔다 (결과는 매번 계산할 때와 동일)
    const DCT_COS = {};
    function dctCosTable(N) {
        if (!DCT_COS[N]) {
            const t = new Float64Array(N * N), factor = Math.PI / N;
            for (let u = 0; u < N; u++) for (let x = 0; x < N; x++) t[u * N + x] = Math.cos((x + 0.5) * u * factor);
            DCT_COS[N] = t;
        }
        return DCT_COS[N];
    }

    function dct1D(vec, N) {
        const out = new Float32Array(N), cos = dctCosTable(N);
        for (let u = 0; u < N; u++) {
            let sum = 0; for (let x = 0; x < N; x++) sum += vec[x] * cos[u * N + x];
            out[u] = ((u === 0) ? Math.sqrt(1 / N) : Math.sqrt(2 / N)) * sum;
        }
        return out;
    }

    function pHashFromCanvas(canvas) {
        const N = 32;
        const gray = getGrayscaleFromCanvas(resized(canvas, N, N), N, N), tmp = new Array(N);
        for (let y = 0; y < N; y++) {
            const row = new Float32Array(N); for (let x = 0; x < N; x++) row[x] = gray[y * N + x];
            tmp[y] = dct1D(row, N);
        }
        const dct = new Array(N);
        for (let x = 0; x < N; x++) {
            const col = new Float32Array(N); for (let y = 0; y < N; y++) col[y] = tmp[y][x];
            const colD = dct1D(col, N);
            for (let y = 0; y < N; y++) { if (!dct[y]) dct[y] = new Float32Array(N); dct[y][x] = colD[y]; }
        }
        const vals = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (!(x === 0 && y === 0)) vals.push(dct[y][x]);
        const sorted = vals.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
        let hi = 0, lo = 0, i = 0;
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (x === 0 && y === 0) continue;
                const bit = dct[y][x] > med ? 1 : 0;
                if (i < 32) hi = (hi << 1) | bit; else lo = (lo << 1) | bit;
                i++;
            }
        }
        if (i < 64) {
            const pad = 64 - i;
            if (pad <= 32) lo = (lo << pad) >>> 0; else { hi = (hi << (pad - 32)) >>> 0; lo = 0; }
        }
        return { hi: hi >>> 0, lo: lo >>> 0 };
    }

    // ── 이진화 (트랙 정보 바의 버튼·난이도 글자를 pHash 하기 전에) ─────────────────

    /* isInk(r,g,b)인 픽셀은 흰색(255), 나머지는 검정인 새 캔버스 */
    function binarize(canvas, isInk) {
        const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const v = isInk(data[i], data[i + 1], data[i + 2]) ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
            data[i + 3] = 255;
        }
        const out = makeCanvas(canvas.width, canvas.height);
        out.getContext('2d').putImageData(imageData, 0, 0);
        return out;
    }
    // 버튼(4B·5B…)은 흰 글자, 난이도(NM·HD…)는 검은 글자를 전경으로 뽑는다
    const binarizeButton = (canvas) => binarize(canvas, (r, g, b) => r >= 240 && g >= 240 && b >= 240);
    const binarizeDifficulty = (canvas) => binarize(canvas, (r, g, b) => r <= 64 && g <= 64 && b <= 64);

    // ── 자켓 지문(sig) ─────────────────
    /* 라운드/결과/컬렉션 화면에서 BPM 글자(위)와 버튼/난이도 바(아래)가 덮지 않는 영역을
       12x8 칸으로 나눠 칸별 평균 RGB를 담은 288바이트. hashes.json에는 base64로 들어간다 */
    const SIG = { W: 12, H: 8, X0: 0.06, X1: 0.94, Y0: 0.2, Y1: 0.78 };
    SIG.LEN = SIG.W * SIG.H * 3;

    /* 픽셀 버퍼 d(폭 dw)의 (rx, ry)부터 cw×ch 영역을 12x8칸 평균 색으로. out 형식은 호출부가 고른다 */
    function sigFromPixels(d, dw, rx, ry, cw, ch, out) {
        out = out || new Uint8Array(SIG.LEN);
        for (let cy = 0; cy < SIG.H; cy++) {
            const ya = Math.floor(cy * ch / SIG.H), yb = Math.max(ya + 1, Math.floor((cy + 1) * ch / SIG.H));
            for (let cx = 0; cx < SIG.W; cx++) {
                const xa = Math.floor(cx * cw / SIG.W), xb = Math.max(xa + 1, Math.floor((cx + 1) * cw / SIG.W));
                let r = 0, g = 0, b = 0, n = 0;
                for (let yy = ya; yy < yb; yy++) {
                    let i = ((ry + yy) * dw + rx + xa) * 4;
                    for (let xx = xa; xx < xb; xx++, i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
                }
                const o = (cy * SIG.W + cx) * 3;
                out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
            }
        }
        return out;
    }

    /* 원본(src)의 자켓 자리 (x, y, w, h)에서 지문을 뜬다. 자켓 그림 한 장이면 (0, 0, 폭, 높이) */
    function jacketSig(src, x, y, w, h) {
        const c = cropToCanvas(src, x + w * SIG.X0, y + h * SIG.Y0, w * (SIG.X1 - SIG.X0), h * (SIG.Y1 - SIG.Y0));
        const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
        return sigFromPixels(d, c.width, 0, 0, c.width, c.height);
    }

    /* 칸별 평균 색 차이(0~255) */
    function sigDist(a, b) {
        let d = 0;
        for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
        return d / a.length;
    }

    const hasBuffer = typeof Buffer !== 'undefined';
    const sigToBase64 = (sig) => hasBuffer ? Buffer.from(sig).toString('base64') : btoa(String.fromCharCode(...sig));
    const sigFromBase64 = (b64) => hasBuffer ? new Uint8Array(Buffer.from(b64, 'base64')) : Uint8Array.from(atob(b64), c => c.charCodeAt(0));

    // ── 수동 분석기(스크린샷 두 장 비교) 전용 비트 해시 ─────────────────
    /* 16x16 / 32x32로 줄인 RGBA 픽셀을 받아 0/1 배열을 돌려준다. hashes.json과는 무관하다.
       휘도(BT.601) 기준이라 위의 aHash/dHash(RGB 평균)와 값이 다르다 */
    const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

    function bitsAHash(data) {
        let sum = 0; const len = data.length / 4, lums = [];
        for (let i = 0; i < data.length; i += 4) {
            const l = lum(data[i], data[i + 1], data[i + 2]);
            lums.push(l); sum += l;
        }
        const avg = sum / len;
        return lums.map(l => l >= avg ? 1 : 0);
    }

    function bitsDHash(data, width) {
        const hash = [];
        for (let i = 0; i < data.length; i += 4) {
            if ((i / 4) % width === width - 1) continue;
            const curr = lum(data[i], data[i + 1], data[i + 2]);
            const next = lum(data[i + 4], data[i + 5], data[i + 6]);
            hash.push(curr < next ? 1 : 0);
        }
        return hash;
    }

    /* 32x32 ImageData → 8x8 DCT 계수 64비트 (DC 제외 평균 기준) */
    function bitsPHash(imgData) {
        const size = 32, data = imgData.data;
        const vals = new Float64Array(size * size);
        for (let i = 0; i < data.length; i += 4) vals[i / 4] = lum(data[i], data[i + 1], data[i + 2]);

        const dctSize = 8, dct = [];
        for (let v = 0; v < dctSize; v++) {
            for (let u = 0; u < dctSize; u++) {
                let sum = 0;
                for (let i = 0; i < size; i++) {
                    for (let j = 0; j < size; j++) {
                        sum += vals[j * size + i] * Math.cos(((2 * i + 1) / (2 * size)) * u * Math.PI) * Math.cos(((2 * j + 1) / (2 * size)) * v * Math.PI);
                    }
                }
                if (u === 0) sum *= 1 / Math.sqrt(2);
                if (v === 0) sum *= 1 / Math.sqrt(2);
                dct.push(sum / 4);
            }
        }
        const acValues = dct.slice(1); // DC 성분 제외
        const avg = acValues.reduce((a, b) => a + b, 0) / acValues.length;
        return dct.map(val => val >= avg ? 1 : 0);
    }

    function bitsDist(h1, h2) {
        let d = 0; for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++; return d;
    }

    return {
        cropToCanvas, getGrayscaleFromCanvas, getColorGridFromCanvas,
        aHashFromCanvas, dHashFromCanvas, pHashFromCanvas,
        popcnt32, hamDist, colorDist,
        binarize, binarizeButton, binarizeDifficulty,
        SIG, sigFromPixels, jacketSig, sigDist, sigToBase64, sigFromBase64,
        lum, bitsAHash, bitsDHash, bitsPHash, bitsDist
    };
});
