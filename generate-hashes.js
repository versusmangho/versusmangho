// 이 스크립트는 DJMAX 층수 측정기를 위해 이미지 해시를 미리 계산하고, 기존 hashes.json에 병합합니다.
//
// 1. 의존성 설치 (package.json이 없으니 따로 설치):
//    npm install canvas
//
// 2. 실행 — 둘 중 하나:
//    node generate-hashes.js --gui      GUI (브라우저에서 이미지를 끌어다 놓고 병합). hash-tool.bat을 더블클릭해도 된다.
//    node generate-hashes.js            폴더를 읽어 hashes.json에 병합 (CLI)
//
// 파일 이름이 곧 대상이다:
//    831.jpg                               자켓 — v-archive 곡 id 831
//    ..._unified_4b_nm.png                 트랙 정보 바 (왼쪽 절반 = 버튼 4B, 오른쪽 절반 = 난이도 NM)
//    ..._button_4b.png / ..._diff_nm.png   버튼·난이도 한 장씩
// 확장자는 png·jpg·jpeg·jfif·gif·bmp를 직접 읽는다. webp·avif는 node-canvas가 못 읽으니 GUI로 넣는다
// (GUI는 브라우저가 풀어서 PNG로 바꿔 보낸다).
//
// CLI 옵션:
//    --jackets <폴더>     자켓 폴더 (여러 번 줄 수 있다). 기본: thumbnails·jackets·jacket 중 있는 것 전부
//    --trackinfo <폴더>   트랙 정보 폴더. 기본: trackinfo
//    --base <파일>        병합할 기존 해시. 기본: hashes.json (층수 탭이 읽는 파일)
//    --out <파일>         저장할 곳. 기본: --base와 같은 파일 (덮어쓰기 전에 <파일>.bak으로 백업)
//    --skip-existing      이미 있는 id는 건드리지 않는다 (기본은 새로 계산한 값으로 덮어쓴다)
//    --fresh              기존 해시를 버리고 폴더에 있는 것만으로 새로 만든다 (예전 동작)
//    --dry-run            저장하지 않고 무엇이 바뀌는지만 보여 준다
//    --gui [--port 8779]  GUI 서버를 띄우고 브라우저를 연다 (--no-open이면 브라우저는 안 연다)
//
// Windows에서 'npm install canvas' 실행 시 오류가 발생하면, node-canvas의 Windows 설치 가이드를 따라야 할 수 있습니다.

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

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

// 자켓 시그니처: 라운드/결과 화면에서 BPM 글자(위)와 버튼/난이도 바(아래)가 덮지 않는 영역을
// 12x8 칸으로 나눠 칸별 평균 RGB를 담은 288바이트(base64). floor.html의 jacketSig()와 같은 계산이어야 한다.
const SIG_W = 12, SIG_H = 8, SIG_X0 = 0.06, SIG_X1 = 0.94, SIG_Y0 = 0.2, SIG_Y1 = 0.78;
function jacketSigFromCanvas(canvas) {
    const w = canvas.width, h = canvas.height;
    const sx = w * SIG_X0, sy = h * SIG_Y0, sw = w * (SIG_X1 - SIG_X0), sh = h * (SIG_Y1 - SIG_Y0);
    const cw = Math.max(1, Math.round(sw)), ch = Math.max(1, Math.round(sh));
    const c = createCanvas(cw, ch);
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, cw, ch);
    const d = c.getContext('2d').getImageData(0, 0, cw, ch).data;
    const out = Buffer.alloc(SIG_W * SIG_H * 3);
    for (let cy = 0; cy < SIG_H; cy++) {
        for (let cx = 0; cx < SIG_W; cx++) {
            const xa = Math.floor(cx * cw / SIG_W), xb = Math.max(xa + 1, Math.floor((cx + 1) * cw / SIG_W));
            const ya = Math.floor(cy * ch / SIG_H), yb = Math.max(ya + 1, Math.floor((cy + 1) * ch / SIG_H));
            let r = 0, g = 0, b = 0, n = 0;
            for (let y = ya; y < yb; y++) {
                for (let x = xa; x < xb; x++) {
                    const i = (y * cw + x) * 4;
                    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
                }
            }
            const o = (cy * SIG_W + cx) * 3;
            out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
        }
    }
    return out.toString('base64');
}


// --- 파일 이름 → 대상, 이미지 → 해시 ---

// node-canvas가 직접 읽는 형식 / GUI가 받아 주는 형식(나머지는 브라우저가 PNG로 바꿔 보낸다)
const NODE_EXTS = ['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.bmp'];
const IMAGE_EXTS = NODE_EXTS.concat(['.webp', '.avif']);
const BAR_SPLIT = 0.5;

function isImageFile(name) {
    return IMAGE_EXTS.includes(path.extname(name).toLowerCase());
}

/* 파일 이름이 무엇을 가리키는지. 자켓은 이름 전체가 숫자여야 한다 ('831 (1).jpg' 같은 사본은 무시) */
function classifyName(name) {
    const base = path.basename(name, path.extname(name)).toLowerCase();
    if (/^\d+$/.test(base)) return { kind: 'jacket', id: parseInt(base, 10) };
    const parts = base.split('_');
    const uIdx = parts.indexOf('unified');
    if (uIdx >= 0 && parts[uIdx + 2]) return { kind: 'unified', button: parts[uIdx + 1].toUpperCase(), diff: parts[uIdx + 2].toUpperCase() };
    const bIdx = parts.indexOf('button');
    if (bIdx >= 0 && parts[bIdx + 1]) return { kind: 'button', button: parts[bIdx + 1].toUpperCase() };
    const dIdx = parts.indexOf('diff');
    if (dIdx >= 0 && parts[dIdx + 1]) return { kind: 'diff', diff: parts[dIdx + 1].toUpperCase() };
    return null;
}

function imageToCanvas(img) {
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
}

function cropCanvas(canvas, x, w) {
    const c = createCanvas(w, canvas.height);
    c.getContext('2d').drawImage(canvas, x, 0, w, canvas.height, 0, 0, w, canvas.height);
    return c;
}

function buttonEntry(canvas) {
    return { ph: pHashFromCanvas(binarizeButton(canvas)), color: getColorGridFromCanvas(canvas) };
}

function diffEntry(canvas) {
    return { ph: pHashFromCanvas(binarizeDifficulty(canvas)) };
}

/* 이미지 하나 → 병합 단위 목록 [{ group: 'thumbnails'|'buttons'|'diffs', key, entry }].
   자켓은 1개, unified 바는 버튼+난이도 2개. 이름이 규칙에 안 맞으면 null */
async function hashImage(name, src) {
    const target = classifyName(name);
    if (!target) return null;
    const canvas = imageToCanvas(await loadImage(src));
    if (target.kind === 'jacket') {
        // 키 순서(id, ah, dh, color, sig)는 기존 hashes.json과 같게 — 다시 써도 diff가 깔끔하다
        return [{ group: 'thumbnails', key: target.id, entry: {
            id: target.id,
            ah: aHashFromCanvas(canvas),
            dh: dHashFromCanvas(canvas),
            color: getColorGridFromCanvas(canvas),
            sig: jacketSigFromCanvas(canvas)
        } }];
    }
    if (target.kind === 'unified') {
        const lw = Math.floor(canvas.width * BAR_SPLIT);
        return [
            { group: 'buttons', key: target.button, entry: buttonEntry(cropCanvas(canvas, 0, lw)) },
            { group: 'diffs', key: target.diff, entry: diffEntry(cropCanvas(canvas, lw, canvas.width - lw)) }
        ];
    }
    if (target.kind === 'button') return [{ group: 'buttons', key: target.button, entry: buttonEntry(canvas) }];
    return [{ group: 'diffs', key: target.diff, entry: diffEntry(canvas) }];
}

// --- 기존 해시와 비교·병합 ---

function emptyHashes() {
    return { trackinfo: { buttons: {}, diffs: {} }, thumbnails: [] };
}

function loadHashes(file) {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || !data.trackinfo || !Array.isArray(data.thumbnails)) throw new Error(`${path.basename(file)}은(는) hashes.json 형식이 아닙니다`);
    data.trackinfo.buttons = data.trackinfo.buttons || {};
    data.trackinfo.diffs = data.trackinfo.diffs || {};
    return data;
}

function currentEntry(data, part) {
    if (part.group === 'thumbnails') return data.thumbnails.find(t => t.id === part.key) || null;
    return data.trackinfo[part.group][part.key] || null;
}

function sigBytes(b64) {
    return Buffer.from(b64, 'base64');
}

function sigDist(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
}

// floor/match-screen.js의 SIG_MAX_DIST — 이보다 가까운 두 자켓은 라운드·결과 화면에서 서로 헷갈린다
const SIG_CONFUSE_DIST = 8;

/* 병합 단위 하나가 기존 해시 기준으로 어떤 상태인지.
   status: 'new' | 'same' | 'changed'. 자켓은 기존 값과의 거리(prevDist)와,
   다른 id 중 가장 닮은 자켓(nearest)도 준다 — 가까우면 인식할 때 둘이 헷갈린다 */
function describePart(data, part) {
    const cur = currentEntry(data, part);
    const out = { status: !cur ? 'new' : (JSON.stringify(cur) === JSON.stringify(part.entry) ? 'same' : 'changed') };
    if (part.group !== 'thumbnails' || !part.entry.sig) return out;
    const sig = sigBytes(part.entry.sig);
    if (cur && cur.sig && out.status === 'changed') out.prevDist = +sigDist(sig, sigBytes(cur.sig)).toFixed(2);
    let best = null;
    for (const t of data.thumbnails) {
        if (t.id === part.key || !t.sig) continue;
        const d = sigDist(sig, sigBytes(t.sig));
        if (!best || d < best.d) best = { id: t.id, d };
    }
    if (best) out.nearest = { id: best.id, d: +best.d.toFixed(2), confusable: best.d <= SIG_CONFUSE_DIST };
    return out;
}

/* parts를 data에 넣는다 (data를 직접 고친다). overwrite가 false면 이미 있는 키는 그대로 둔다.
   같은 키가 parts에 여러 번 있으면 뒤의 것이 이긴다 */
function mergeParts(data, parts, { overwrite = true } = {}) {
    const last = new Map();
    for (const p of parts) last.set(`${p.group}:${p.key}`, p);
    const report = { added: [], updated: [], same: [], skipped: [] };
    const label = p => p.group === 'thumbnails' ? `#${p.key}` : `${p.group === 'buttons' ? '버튼' : '난이도'} ${p.key}`;
    for (const p of last.values()) {
        const cur = currentEntry(data, p);
        if (cur && JSON.stringify(cur) === JSON.stringify(p.entry)) { report.same.push(label(p)); continue; }
        if (cur && !overwrite) { report.skipped.push(label(p)); continue; }
        if (p.group === 'thumbnails') {
            const i = data.thumbnails.findIndex(t => t.id === p.key);
            if (i >= 0) data.thumbnails[i] = p.entry; else data.thumbnails.push(p.entry);
        } else {
            data.trackinfo[p.group][p.key] = p.entry;
        }
        report[cur ? 'updated' : 'added'].push(label(p));
    }
    // 정렬하지 않는다 — 기존 순서(예전 glob 순서)를 지켜야 git diff가 새로 붙은 항목만 보인다
    return report;
}

/* 저장. 기존 파일이 있으면 먼저 <파일>.bak으로 복사해 둔다. 형식(2칸 들여쓰기, 끝 줄바꿈 없음)은 기존 파일 그대로 */
function saveHashes(file, data) {
    const dir = path.dirname(file);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let backup = null;
    if (fs.existsSync(file)) { backup = file + '.bak'; fs.copyFileSync(file, backup); }
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return backup;
}

function summarize(data) {
    const ids = data.thumbnails.map(t => t.id);
    return {
        count: ids.length,
        minId: ids.length ? Math.min(...ids) : null,
        maxId: ids.length ? Math.max(...ids) : null,
        buttons: Object.keys(data.trackinfo.buttons).sort(),
        diffs: Object.keys(data.trackinfo.diffs).sort()
    };
}

function printReport(report) {
    const line = (title, list) => {
        if (!list.length) return;
        const shown = list.length > 20 ? list.slice(0, 20).join(', ') + ` … 외 ${list.length - 20}개` : list.join(', ');
        console.log(`  ${title} ${list.length}: ${shown}`);
    };
    line('추가', report.added);
    line('갱신', report.updated);
    line('그대로', report.same);
    line('건너뜀(이미 있음)', report.skipped);
    if (!report.added.length && !report.updated.length && !report.same.length && !report.skipped.length) console.log('  (넣을 것이 없습니다)');
}

// --- CLI ---

function parseArgs(argv) {
    const args = { jackets: [], trackinfo: null, base: 'hashes.json', out: null, overwrite: true, fresh: false, dryRun: false, gui: false, open: true, port: 8779, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i], next = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} 뒤에 값이 필요합니다`);
            return argv[++i];
        };
        if (a === '--jackets' || a === '--thumbnails') args.jackets.push(next());
        else if (a === '--trackinfo') args.trackinfo = next();
        else if (a === '--base') args.base = next();
        else if (a === '--out') args.out = next();
        else if (a === '--skip-existing') args.overwrite = false;
        else if (a === '--fresh') args.fresh = true;
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--gui') args.gui = true;
        else if (a === '--no-open') args.open = false;
        else if (a === '--port') args.port = parseInt(next(), 10);
        else if (a === '-h' || a === '--help') args.help = true;
        else throw new Error(`모르는 옵션: ${a} (--help 참고)`);
    }
    if (!args.jackets.length) args.jackets = ['thumbnails', 'jackets', 'jacket'].filter(d => fs.existsSync(d));
    if (!args.trackinfo) args.trackinfo = 'trackinfo';
    if (!args.out) args.out = args.base;
    return args;
}

function listImages(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(isImageFile)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(f => path.join(dir, f));
}

async function runCli(args) {
    const data = args.fresh ? emptyHashes() : (loadHashes(args.base) || emptyHashes());
    const before = summarize(data);
    console.log(args.fresh ? '기존 해시 없이 새로 만듭니다.' : `기존 해시: ${args.base} — 자켓 ${before.count}곡` +
        (before.count ? ` (id ${before.minId}~${before.maxId})` : '') + `, 버튼 ${before.buttons.length}, 난이도 ${before.diffs.length}`);

    const dirs = args.jackets.concat(args.trackinfo).filter(d => fs.existsSync(d));
    const files = [];
    for (const dir of dirs) files.push(...listImages(dir));
    console.log(`읽을 폴더: ${dirs.join(', ') || '(없음)'} — 이미지 ${files.length}장`);

    const parts = [], ignored = [], failed = [];
    for (const file of files) {
        const name = path.basename(file);
        if (!classifyName(name)) { ignored.push(name); continue; }
        if (!NODE_EXTS.includes(path.extname(name).toLowerCase())) { failed.push(`${name} (이 형식은 GUI로 넣어 주세요)`); continue; }
        try {
            parts.push(...await hashImage(name, file));
        } catch (err) {
            failed.push(`${name} (${err.message})`);
        }
    }
    if (ignored.length) console.log(`이름 규칙에 안 맞아 건너뜀 ${ignored.length}: ${ignored.slice(0, 10).join(', ')}${ignored.length > 10 ? ' …' : ''}`);
    if (failed.length) console.log(`읽지 못함 ${failed.length}:\n  ${failed.join('\n  ')}`);

    // 헷갈림 경고는 GUI와 같게 '기존 해시' 기준으로 병합 전에 본다
    const warnings = [];
    for (const p of parts.filter(p => p.group === 'thumbnails')) {
        const { nearest } = describePart(data, p);
        if (nearest && nearest.confusable) warnings.push(`#${p.key}이(가) 기존 #${nearest.id}와(과) 거의 같습니다 (거리 ${nearest.d}) — 화면 인식에서 헷갈릴 수 있습니다`);
    }

    const report = mergeParts(data, parts, { overwrite: args.overwrite });
    console.log('\n병합 결과');
    printReport(report);
    for (const w of warnings) console.log(`  주의: ${w}`);

    const changed = report.added.length + report.updated.length;
    if (args.dryRun) { console.log('\n--dry-run: 저장하지 않았습니다.'); return; }
    if (!changed && !args.fresh && fs.existsSync(args.out)) { console.log('\n바뀐 것이 없어 저장하지 않았습니다.'); return; }
    const backup = saveHashes(args.out, data);
    const after = summarize(data);
    console.log(`\n${args.out}에 저장했습니다 — 자켓 ${after.count}곡` + (after.count ? ` (id ${after.minId}~${after.maxId})` : '') +
        (backup ? `. 이전 파일은 ${backup}` : ''));
}

// --- GUI: 로컬 서버 + hash-tool.html ---

const ROOT = __dirname;

/* GUI가 넘긴 경로는 이 폴더 안의 .json만 허용한다 */
function safeJsonPath(p) {
    const abs = path.resolve(ROOT, p || 'hashes.json');
    const rel = path.relative(ROOT, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('프로젝트 폴더 밖의 파일은 쓸 수 없습니다');
    if (path.extname(abs).toLowerCase() !== '.json') throw new Error('.json 파일만 쓸 수 있습니다');
    return abs;
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > limit) { reject(new Error('파일이 너무 큽니다')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function openBrowser(url) {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
}

function runGui(port, { open = true } = {}) {
    const http = require('http');
    const baseOf = p => loadHashes(safeJsonPath(p)) || emptyHashes();

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        try {
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/hash-tool.html')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(path.join(ROOT, 'hash-tool.html')));
                return;
            }
            // 기존 해시 요약
            if (req.method === 'GET' && url.pathname === '/api/base') {
                const file = safeJsonPath(url.searchParams.get('path'));
                const data = loadHashes(file);
                sendJson(res, 200, { path: path.relative(ROOT, file), exists: !!data, ...summarize(data || emptyHashes()) });
                return;
            }
            // 이미지 한 장 → 해시 + 기존 대비 상태. 본문은 이미지 바이트 그대로
            if (req.method === 'POST' && url.pathname === '/api/hash') {
                const name = url.searchParams.get('name') || '';
                const buf = await readBody(req, 30 * 1024 * 1024);
                let parts;
                try {
                    parts = await hashImage(name, buf);
                } catch (err) {
                    sendJson(res, 422, { error: `이미지를 읽지 못했습니다 (${err.message})` });
                    return;
                }
                if (!parts) { sendJson(res, 200, { ignored: true }); return; }
                const data = baseOf(url.searchParams.get('base'));
                sendJson(res, 200, { parts: parts.map(p => ({ ...p, ...describePart(data, p) })) });
                return;
            }
            // 이미 계산한 parts의 상태를 (기준 파일이 바뀐 뒤) 다시 매긴다
            if (req.method === 'POST' && url.pathname === '/api/status') {
                const body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
                const data = baseOf(body.base);
                sendJson(res, 200, { parts: body.parts.map(p => ({ ...p, ...describePart(data, p) })) });
                return;
            }
            // 병합해서 저장
            if (req.method === 'POST' && url.pathname === '/api/save') {
                const body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
                const out = safeJsonPath(body.out || body.base);
                const data = baseOf(body.base);
                const report = mergeParts(data, body.parts || [], { overwrite: body.overwrite !== false });
                const changed = report.added.length + report.updated.length;
                let backup = null, saved = false;
                if (changed || !fs.existsSync(out)) { backup = saveHashes(out, data); saved = true; }
                sendJson(res, 200, { report, saved, out: path.relative(ROOT, out), backup: backup && path.relative(ROOT, backup), ...summarize(data) });
                return;
            }
            res.writeHead(404); res.end('not found');
        } catch (err) {
            sendJson(res, 400, { error: err.message });
        }
    });

    server.on('error', err => {
        console.error(err.code === 'EADDRINUSE' ? `포트 ${port}을(를) 이미 쓰고 있습니다. --port로 다른 번호를 주세요.` : err.message);
        process.exit(1);
    });
    // 이 컴퓨터에서만 열린다 — 파일을 쓰는 서버라 밖으로 열지 않는다
    server.listen(port, '127.0.0.1', () => {
        const url = `http://localhost:${port}/`;
        console.log(`해시 도구: ${url}\n이 창을 닫으면 꺼집니다.`);
        if (open) openBrowser(url);
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        const src = fs.readFileSync(__filename, 'utf8').split(/\r?\n/);
        console.log(src.slice(0, src.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
        return;
    }
    if (args.gui) { runGui(args.port, { open: args.open }); return; }
    await runCli(args);
}

main().catch(err => {
    console.error('\n오류가 발생했습니다:', err.message || err);
    process.exitCode = 1;
});
