/* 지각 해시(perceptual hash) 모음 — 층수 측정기와 버망호 도우미가 함께 쓴다.
   주의: aHash/dHash/pHash/컬러그리드(4x4)의 계산 방식은 generate-hashes.js와 반드시 같아야 한다.
   한쪽을 바꾸면 hashes.json을 다시 만들어야 비교가 맞는다. */
(function (global) {
    'use strict';

    /* 원본의 (x, y, w, h)만 잘라낸 캔버스. 이후 해시는 모두 이 캔버스를 받는다 */
    function cropToCanvas(sourceImg, x, y, w, h) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        c.getContext('2d', { willReadFrequently: true }).drawImage(sourceImg, x, y, w, h, 0, 0, c.width, c.height);
        return c;
    }

    function getGrayscaleFromCanvas(canvas, w, h) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const data = ctx.getImageData(0, 0, w, h).data, gray = new Float32Array(w * h);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = (data[i] + data[i + 1] + data[i + 2]) / 3.0;
        return gray;
    }

    /* 칸별 평균 색. segments=4가 hashes.json과 맞는 기본값이고,
       명패 식별처럼 더 잘게 봐야 하는 곳은 호출부에서 segments를 올려 쓴다 */
    function getColorGridFromCanvas(canvas, segments = 4) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

    function aHashFromCanvas(canvas) {
        const size = 16;
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        c.getContext('2d').drawImage(canvas, 0, 0, size, size);
        const gray = getGrayscaleFromCanvas(c, size, size);
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
        const c = document.createElement('canvas'); c.width = size + 1; c.height = size;
        c.getContext('2d').drawImage(canvas, 0, 0, size + 1, size);
        const gray = getGrayscaleFromCanvas(c, size + 1, size);

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
        const N = 32, c = document.createElement('canvas'); c.width = N; c.height = N;
        c.getContext('2d').drawImage(canvas, 0, 0, N, N);
        const gray = getGrayscaleFromCanvas(c, N, N), tmp = new Array(N);
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

    global.VMH = global.VMH || {};
    global.VMH.ImgHash = {
        cropToCanvas, getGrayscaleFromCanvas, getColorGridFromCanvas,
        aHashFromCanvas, dHashFromCanvas, pHashFromCanvas,
        popcnt32, hamDist, colorDist
    };
})(window);
