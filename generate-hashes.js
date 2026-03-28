// 이 스크립트는 DJMAX 층수 측정기를 위해 이미지 해시를 미리 계산합니다.
//
// 이 스크립트를 실행하려면 Node.js와 몇 가지 패키지가 필요합니다.
// 1. 의존성 설치:
//    npm install canvas glob
//
// 2. 이 스크립트를 프로젝트의 루트 폴더에 위치시킵니다.
//
// 3. 'trackinfo'와 'thumbnails' 폴더가 같은 디렉토리에 있는지 확인합니다.
//
// 4. 스크립트 실행:
//    node generate-hashes.js
//
// 위 명령어를 실행하면 'public/hashes.json' 파일이 생성됩니다.
// Windows에서 'npm install canvas' 실행 시 오류가 발생하면, node-canvas의 Windows 설치 가이드를 따라야 할 수 있습니다.

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { createCanvas, loadImage } = require('canvas');

console.log('해시 생성을 시작합니다...');

// --- DJMAX 층수 측정기 해시 로직 ---
function binarizeCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const isDark = data[i] <= 70 && data[i + 1] <= 70 && data[i + 2] <= 70;
        const value = isDark ? 0 : 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
    }
    const newCanvas = createCanvas(canvas.width, canvas.height);
    newCanvas.getContext('2d').putImageData(imageData, 0, 0);
    return newCanvas;
}

function getGrayscaleFromCanvas(canvas, w, h) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = (data[i] + data[i + 1] + data[i + 2]) / 3.0;
    }
    return gray;
}

function getColorGridFromCanvas(canvas) {
    const segments = 4;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const sw = w / segments, sh = h / segments;
    const colors = [];

    for (let sy = 0; sy < segments; sy++) {
        for (let sx = 0; sx < segments; sx++) {
            const data = ctx.getImageData(sx * sw, sy * sh, sw, sh).data;
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i]; g += data[i + 1]; b += data[i + 2];
                count++;
            }
            colors.push(Math.round(r / count), Math.round(g / count), Math.round(b / count));
        }
    }
    return colors;
}

function aHashFromCanvas(canvas) {
    const size = 16;
    const c = createCanvas(size, size);
    c.getContext('2d').drawImage(canvas, 0, 0, size, size);
    const gray = getGrayscaleFromCanvas(c, size, size);
    let avg = 0;
    for (let i = 0; i < gray.length; i++) avg += gray[i];
    avg /= gray.length;
    
    const bits = [];
    for (let i = 0; i < 8; i++) {
        let val = 0;
        for (let j = 0; j < 32; j++) {
            const bit = gray[i * 32 + j] >= avg ? 1 : 0;
            val = (val << 1) | bit;
        }
        bits.push(val >>> 0);
    }
    return bits;
}

function dHashFromCanvas(canvas) {
    const size = 16;
    const c = createCanvas(size + 1, size);
    c.getContext('2d').drawImage(canvas, 0, 0, size + 1, size);
    const gray = getGrayscaleFromCanvas(c, size + 1, size);
    
    const bits = [];
    let bitCount = 0;
    let currentVal = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const left = gray[y * (size + 1) + x];
            const right = gray[y * (size + 1) + x + 1];
            const bit = left < right ? 1 : 0;
            currentVal = (currentVal << 1) | bit;
            bitCount++;
            if (bitCount % 32 === 0) {
                bits.push(currentVal >>> 0);
                currentVal = 0;
            }
        }
    }
    return bits;
}

function dct1D(vec, N) {
    const out = new Float32Array(N);
    const factor = Math.PI / N;
    for (let u = 0; u < N; u++) {
        let sum = 0;
        for (let x = 0; x < N; x++) {
            sum += vec[x] * Math.cos((x + 0.5) * u * factor);
        }
        const c = (u === 0) ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
        out[u] = c * sum;
    }
    return out;
}

function pHashFromCanvas(canvas) {
    const N = 32;
    const c = createCanvas(N, N);
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, N, N);
    const gray = getGrayscaleFromCanvas(c, N, N);
    const tmp = new Array(N);
    for (let y = 0; y < N; y++) {
        const row = new Float32Array(N);
        for (let x = 0; x < N; x++) row[x] = gray[y * N + x];
        tmp[y] = dct1D(row, N);
    }
    const dct = new Array(N);
    for (let x = 0; x < N; x++) {
        const col = new Float32Array(N);
        for (let y = 0; y < N; y++) col[y] = tmp[y][x];
        const colD = dct1D(col, N);
        for (let y = 0; y < N; y++) {
            if (!dct[y]) dct[y] = new Float32Array(N);
            dct[y][x] = colD[y];
        }
    }
    const vals = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (x === 0 && y === 0) continue;
            vals.push(dct[y][x]);
        }
    }
    const sorted = vals.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let hi = 0, lo = 0;
    let i = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (x === 0 && y === 0) continue;
            const bit = dct[y][x] > med ? 1 : 0;
            if (i < 32) hi = (hi << 1) | bit;
            else lo = (lo << 1) | bit;
            i++;
        }
    }
     if (i < 64) {
        const pad = 64 - i;
        if (pad <= 32) lo = (lo << pad) >>> 0;
        else {
            hi = (hi << (pad - 32)) >>> 0;
            lo = 0;
        }
    }
    return { hi: hi >>> 0, lo: lo >>> 0 };
}

function binarizeButton(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const isWhite = r >= 240 && g >= 240 && b >= 240;
        const v = isWhite ? 255 : 0;
        data[i] = data[i+1] = data[i+2] = v;
        data[i+3] = 255;
    }
    const newCanvas = createCanvas(canvas.width, canvas.height);
    newCanvas.getContext('2d').putImageData(imageData, 0, 0);
    return newCanvas;
}

function binarizeDifficulty(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const isBlack = r <= 64 && g <= 64 && b <= 64;
        const v = isBlack ? 255 : 0; // 검은색을 전경(흰색)으로 추출
        data[i] = data[i+1] = data[i+2] = v;
        data[i+3] = 255;
    }
    const newCanvas = createCanvas(canvas.width, canvas.height);
    newCanvas.getContext('2d').putImageData(imageData, 0, 0);
    return newCanvas;
}

async function main() {
    const output = {
        trackinfo: {
            buttons: {},
            diffs: {},
        },
        thumbnails: [],
    };

    const BAR_SPLIT = 0.5;

    // trackinfo 이미지 처리
    console.log("trackinfo 이미지를 처리하는 중...");
    const trackinfoFiles = await glob('trackinfo/*.png');
    for (const file of trackinfoFiles) {
        const basename = path.basename(file, '.png').toLowerCase();
        const img = await loadImage(file);
        const canvas = createCanvas(img.width, img.height);
        canvas.getContext('2d').drawImage(img, 0, 0);

        if (basename.includes('unified')) {
            const parts = basename.split('_');
            const uIdx = parts.indexOf('unified');
            const button = parts[uIdx + 1].toUpperCase();
            const diff = parts[uIdx + 2].toUpperCase();

            const lw = Math.floor(canvas.width * BAR_SPLIT);
            const rw = canvas.width - lw;
            const leftCanvas = createCanvas(lw, canvas.height);
            leftCanvas.getContext('2d').drawImage(canvas, 0, 0, lw, canvas.height, 0, 0, lw, canvas.height);
            const rightCanvas = createCanvas(rw, canvas.height);
            rightCanvas.getContext('2d').drawImage(canvas, lw, 0, rw, canvas.height, 0, 0, rw, canvas.height);

            output.trackinfo.buttons[button] = { 
                ph: pHashFromCanvas(binarizeButton(leftCanvas)),
                color: getColorGridFromCanvas(leftCanvas)
            };
            output.trackinfo.diffs[diff] = { 
                ph: pHashFromCanvas(binarizeDifficulty(rightCanvas))
            };
        } 
        else if (basename.includes('button_')) {
            const parts = basename.split('_');
            const bIdx = parts.indexOf('button');
            const button = parts[bIdx + 1].toUpperCase();
            const imgCanvas = createCanvas(img.width, img.height);
            imgCanvas.getContext('2d').drawImage(img, 0, 0);
            output.trackinfo.buttons[button] = { 
                ph: pHashFromCanvas(binarizeButton(imgCanvas)),
                color: getColorGridFromCanvas(imgCanvas)
            };
        } 
        else if (basename.includes('diff_')) {
            const parts = basename.split('_');
            const dIdx = parts.indexOf('diff');
            const diff = parts[dIdx + 1].toUpperCase();
            const imgCanvas = createCanvas(img.width, img.height);
            imgCanvas.getContext('2d').drawImage(img, 0, 0);
            output.trackinfo.diffs[diff] = { 
                ph: pHashFromCanvas(binarizeDifficulty(imgCanvas))
            };
        }
    }
    console.log(`${Object.keys(output.trackinfo.buttons).length}개의 버튼, ${Object.keys(output.trackinfo.diffs).length}개의 난이도 해시를 준비했습니다.`);

    // 썸네일 처리 (png 파일만 처리)
    console.log("thumbnails 이미지를 처리하는 중...");
    const thumbnailFiles = await glob('thumbnails/*.png');
    for (const file of thumbnailFiles) {
        const id = parseInt(path.basename(file, '.png'), 10);
        if (isNaN(id)) continue;

        const img = await loadImage(file);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        output.thumbnails.push({
            id,
            ah: aHashFromCanvas(canvas),
            dh: dHashFromCanvas(canvas),
            color: getColorGridFromCanvas(canvas)
        });
    }
    console.log(`${thumbnailFiles.length}개의 thumbnails 이미지를 처리했습니다.`);

    // 파일로 저장
    const outputDir = 'public';
    if (!fs.existsSync(outputDir)){
        fs.mkdirSync(outputDir);
    }
    const outputPath = path.join(outputDir, 'hashes.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`\n성공적으로 해시를 생성하여 ${outputPath}에 저장했습니다.`);
}

main().catch(err => {
    console.error("\n오류가 발생했습니다:", err);
});
