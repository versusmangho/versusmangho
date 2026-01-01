// 이 스크립트는 DJMAX 층수 측정기를 위해 이미지 해시를 미리 계산합니다.
//
// 이 스크립트를 실행하려면 Node.js와 몇 가지 패키지가 필요합니다.
// 1. 의존성 설치:
//    npm install canvas glob
//
// 2. 이 스크립트를 프로젝트의 루트 폴더(예: 'C:\Windows\System32\projects\versusmangho\')에 위치시킵니다.
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

// --- floor.html에서 가져온 해시 로직 ---
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

function aHashFromCanvas(canvas) {
    const w = 8, h = 8;
    const c = createCanvas(w, h);
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    const gray = getGrayscaleFromCanvas(c, w, h);
    let avg = 0;
    for (let i = 0; i < gray.length; i++) avg += gray[i];
    avg /= gray.length;
    let hi = 0, lo = 0;
    for (let i = 0; i < 64; i++) {
        const bit = gray[i] >= avg ? 1 : 0;
        if (i < 32) hi = (hi << 1) | bit;
        else lo = (lo << 1) | bit;
    }
    return { hi, lo };
}

function dHashFromCanvas(canvas) {
    const w = 9, h = 8;
    const c = createCanvas(w, h);
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    const gray = getGrayscaleFromCanvas(c, w, h);
    let hi = 0, lo = 0;
    let bitIndex = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const left = gray[y * 9 + x];
            const right = gray[y * 9 + x + 1];
            const bit = left < right ? 1 : 0;
            if (bitIndex < 32) hi = (hi << 1) | bit;
            else lo = (lo << 1) | bit;
            bitIndex++;
        }
    }
    return { hi, lo };
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
// --- 로직 포팅 끝 ---

async function main() {
    const output = {
        trackinfo: {
            buttons: {},
            diffs: {},
        },
        thumbnails: [],
    };

    // trackinfo 이미지 처리
    console.log("trackinfo 이미지를 처리하는 중...");
    const trackinfoFiles = await glob('trackinfo/*.png');
    for (const file of trackinfoFiles) {
        const basename = path.basename(file, '.png');
        const parts = basename.split('_');
        const type = parts[1]; // button 또는 diff
        const key = parts[2]; // 4B, 5B, SC, MX 등

        const img = await loadImage(file);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        if (type === 'button') {
            output.trackinfo.buttons[key] = { ph: pHashFromCanvas(canvas) };
        } else if (type === 'diff') {
            const binarized = binarizeCanvas(canvas); // 70 기준으로 이진화
            output.trackinfo.diffs[key] = { ph: pHashFromCanvas(binarized) };
        }
    }
    console.log(`${trackinfoFiles.length}개의 trackinfo 이미지를 처리했습니다.`);

    // 썸네일 처리
    console.log("thumbnails 이미지를 처리하는 중...");
    const thumbnailFiles = await glob('thumbnails/*.jpg');
    for (const file of thumbnailFiles) {
        const id = parseInt(path.basename(file, '.jpg'), 10);
        if (isNaN(id)) continue;

        const img = await loadImage(file);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        output.thumbnails.push({
            id,
            ah: aHashFromCanvas(canvas),
            dh: dHashFromCanvas(canvas),
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
    console.log("\n다음 단계:");
    console.log("1. 웹 서버가 'public' 디렉토리의 파일을 제공하는지 확인하세요.");
    console.log("2. floor.html 파일을 수정하여 모든 이미지를 로드하는 대신 '/hashes.json' 파일을 가져오도록 변경해야 합니다.");
}

main().catch(err => {
    console.error("\n오류가 발생했습니다:", err);
    console.error("\n'npm install canvas glob'를 실행했는지 확인해주세요.");
    console.error("만약 Windows 환경이라면, node-canvas의 Windows 설치 가이드를 따라야 할 수 있습니다.");
});
