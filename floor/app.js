/* 화면 그리기 — 층수 표, 곡 검색, 복사, 보정, 이벤트 연결. */

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
    const newCanvas = document.createElement('canvas'); newCanvas.width = canvas.width; newCanvas.height = canvas.height;
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
        const v = isBlack ? 255 : 0;
        data[i] = data[i+1] = data[i+2] = v;
        data[i+3] = 255;
    }
    const newCanvas = document.createElement('canvas'); newCanvas.width = canvas.width; newCanvas.height = canvas.height;
    newCanvas.getContext('2d').putImageData(imageData, 0, 0);
    return newCanvas;
}

async function processImage(img, hash) {
    window.lastProcessedImg = img; statusLogs = []; resultList.innerHTML = '';
    const W = img.width, H = img.height, rows = [];
    if (currentMode === 'versus') {
        for (let i = 0; i < 5; i++) {
            const row = createLoadingRow(i + 1); resultList.appendChild(row); rows.push(row);
            const { x, y, w: tw, h: th } = versusSlotRect(i, W, H), by = (RATIO_Y_START + RATIO_THUMB_H) * H, bh = RATIO_BAR_H * H;
            const thumb = cropToCanvas(img, x, y, tw, th), ah = aHashFromCanvas(thumb), dh = dHashFromCanvas(thumb), color = getColorGridFromCanvas(thumb);
            row.matches = getSortedMatches(ah, dh, color); row.matchIndex = 0;
            row.jacketSig = jacketSig(img, x, y, tw, th); // 라운드/결과 화면에서 이 곡을 찾을 때 쓰는 기준
            Object.assign(row, barFeatures(img, x, by, tw, bh));
            displayMatch(row, 0);
        }
    } else {
        const row = createLoadingRow(1); resultList.appendChild(row); rows.push(row);
        const { matches } = readGeneralJacket(img, W, H), best = matches[0], data = await ensureSongData(best.id);
        row.matches = matches; row.matchIndex = 0; updateGeneralRow(row, data, best.id);
    }
    addShot(img.src, rows, hash);
}

function circledLevel(level) {
    const l = parseInt(level);
    if (!l || l < 1 || l > 20) return '';
    return String.fromCodePoint(0x2460 + (l - 1));
}

/* 패턴 자체가 없으면 NO DATA, 패턴은 있는데 층수가 없으면 NO FLOOR */
function patternFloorName(p) {
    if (!p) return 'NO DATA';
    const fV = p.floor ?? '-';
    return p.floorName ?? (fV !== '-' ? String(fV) : 'NO FLOOR');
}

function getDifficultyBgColor(level, diff, floor) {
    if (!floor || floor === '-' || isNaN(parseFloat(floor))) return 'rgba(71, 85, 105, 0.85)';
    const f = Math.floor(parseFloat(floor) / 10), l = parseInt(level);
    const adj = (diff === 'SC') ? l : (l - 11) * 2;
    if (adj === f) return 'rgba(234, 179, 8, 0.85)'; 
    if (adj > f) return 'rgba(56, 189, 248, 0.85)'; 
    return 'rgba(239, 68, 68, 0.85)';
}

function updateGeneralRow(row, data, titleId) {
    row.className = 'track-row p-6 rounded-2xl block opacity-100 shadow-xl relative glass';
    row.setAttribute('data-title-id', titleId);
    const btnList = ['4B', '5B', '6B', '8B'], diffList = ['NM', 'HD', 'MX', 'SC'];

    // v-archive에 곡 정보가 없으면 난이도별 표 대신 한 칸짜리 NO DATA
    if (!data || !data.success) {
        row.innerHTML = `
            <div class="flex items-center space-x-6">
                ${jacketHtml({ noData: true }, 'w-24 h-24 rounded-xl border-2 border-slate-800 shadow-lg', '2.5rem')}
                <div>
                    <h3 class="font-bold text-white text-2xl mb-1">NO DATA</h3>
                    ${row.matches ? `<button class="recheck-btn bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] px-2.5 py-1 rounded-md uppercase font-bold tracking-tighter" onclick="event.stopPropagation(); handleRecheck(this)">Recheck</button>` : ''}
                </div>
            </div>
            <div class="general-grid mt-6" style="grid-template-columns: 1fr">
                <div class="grid-cell flex items-center justify-center h-24 text-slate-400">
                    <span class="grid-value nodata">NO DATA</span>
                </div>
            </div>`;
        return;
    }
    
    // 색상 정의
    const bC = BTN_COLORS, dC = DIFF_COLORS;

    // 헤더 생성 (NM, HD, MX, SC) - 높이 통일을 위해 h-10(40px) 적용
    let grid = `<div class="general-grid mt-6"><div class="grid-cell grid-header flex items-center justify-center h-10"></div>${diffList.map(d => `<div class="grid-cell grid-header ${dC[d]} text-white flex items-center justify-center h-10">${d}</div>`).join('')}`;

    btnList.forEach(btn => {
        // 왼쪽 버튼 라벨 (4B, 5B...) - 데이터 셀과 높이 통일을 위해 h-24(96px) 적용
        grid += `<div class="grid-cell grid-row-label ${bC[btn]} text-white flex items-center justify-center h-24">${btn}</div>`;

        diffList.forEach(diff => {
            const p = data.patterns?.[btn]?.[diff];
            const hasPattern = !!p;
            const fVal = p?.floor ?? '-';
            const l = p?.level ?? 0;
            const fName = p?.floorName ?? (fVal !== '-' ? String(fVal) : '-');

            let displayChar = fName;
            let bgColor = '';
            let textColor = 'text-white';
            let opacity = 'opacity-100';

            if (!hasPattern) {
                displayChar = 'NO DATA';
                bgColor = 'background-color: #000000;';
                textColor = 'text-slate-700';
                opacity = 'opacity-40';
            } else if (fVal === '-' || fVal === null) {
                displayChar = 'NO FLOOR';
                bgColor = 'background-color: #334155;';
                textColor = 'text-slate-400';
            } else {
                bgColor = `background-color: ${getDifficultyBgColor(l, diff, fVal)};`;
            }

            // 해당 패턴의 태그 가져오기 (내 메모 태그 + 로페봇 태그)
            const pTagsHtml = generalCellTagsHtml(titleId, btn, diff);

            // 인게임 레벨(원문자) - 커뮤니티 층수와 병기
            const levelChar = hasPattern ? circledLevel(l) : '';

            // 데이터 셀 - 고정 높이 h-24(96px) 적용
            const copyAttr = hasPattern ? ` data-btn="${btn}" data-diff="${diff}" onclick="copyGeneralCell(this)" title="클릭: 복사 · 우클릭: 내 태그"` : '';
            const memoBtn = hasPattern ? `<button class="memo-cell-btn" title="패턴 메모 (자작 태그)" onclick="event.stopPropagation(); openMemoFromCell(this)">✎</button>` : '';
            grid += `<div class="grid-cell${hasPattern ? ' copyable' : ''} relative flex flex-col items-center justify-center ${textColor} ${opacity} h-24" style="${bgColor}"${copyAttr}>
                ${memoBtn}
                <span class="grid-value${(displayChar === 'NO DATA' || displayChar === 'NO FLOOR') ? ' nodata' : ''}">${levelChar ? `<span class="align-middle opacity-80 ${diff === 'SC' ? 'font-normal' : 'font-light'}">${levelChar}</span> ` : ''}${displayChar}</span>
                ${pTagsHtml}
            </div>`;
        });
    });
    grid += `</div>`;
    
    const tagData = songTagsDatabase[String(titleId)];
    const bpmText = tagData?.bpm?.text ? `<span class="px-2 py-0.5 rounded text-xs font-bold border border-blue-700/50 bg-blue-900/40 text-blue-300 ml-3">BPM:${tagData.bpm.text}</span>` : '';

    row.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <div class="flex items-center space-x-6">
                ${jacketHtml({ titleId: titleId, fromLope: data.fromLope }, 'w-24 h-24 rounded-xl border-2 border-slate-800 shadow-lg', '2.5rem')}
                <div>
                    <div class="flex items-center">
                        <h3 class="font-bold text-white text-2xl mb-1">${data.name}</h3>
                        ${bpmText}
                    </div>
                    <div class="flex items-center space-x-3">
                        <p class="text-slate-500 text-xs font-mono">ID: ${titleId}</p>
                        ${row.matches ? `<button class="recheck-btn bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] px-2.5 py-1 rounded-md uppercase font-bold tracking-tighter" onclick="event.stopPropagation(); handleRecheck(this)">Recheck</button>` : ''}
                    </div>
                </div>
            </div>
        </div>
        ${grid}
    `;
}

async function displayMatch(row, index) {
    if (row.patternUnknown) {
        // 라운드 화면의 밴 칸은 자켓만 보여서 난이도를 알 수 없다 — 버튼은 같은 판 라운드에서 가져온다
        const id = row.matches[index].id, d = await ensureSongData(id), ok = !!(d && d.success);
        updateRow(row, { titleId: id, name: ok ? d.name : "NO DATA", button: row.patternButton, difficulty: "SC", floorName: "NO DATA", floor: "-", level: 0, fromLope: ok && d.fromLope, noData: !ok });
        return;
    }
    const m = row.matches[index], bM = bestMatch(row.btnPh, row.btnColor, buttonRefs), dM = bestMatch(row.diffPh, null, diffRefs), btn = bM.key || "4B", diff = dM.key || "SC", tId = m.id, d = await ensureSongData(tId);
    if (d && d.success) {
        row.apiData = d; const p = d.patterns?.[btn]?.[diff], fV = p?.floor ?? "-", fN = patternFloorName(p);
        updateRow(row, { titleId: tId, name: d.name, button: btn, difficulty: diff, floorName: fN, floor: fV, level: p?.level || 0, fromLope: d.fromLope });
    } else updateRow(row, { titleId: tId, name: "NO DATA", button: btn, difficulty: diff, floorName: "NO DATA", floor: "-", level: 0, noData: true });
}

function jacketPlaceholder(boxClass, qSize) {
    return `<div class="${boxClass} bg-slate-800 flex items-center justify-center select-none">
        <span class="header-font font-black text-slate-500" style="font-size:${qSize}; line-height:1;">?</span>
    </div>`;
}

/* 자켓 로딩 실패 시: v-archive → 로페봇 → ? 순으로 한 단계씩 물러난다 */
function handleJacketError(img) {
    if (!img.dataset.triedLope) {
        img.dataset.triedLope = '1';
        img.src = LOPE_IMG_BASE + img.dataset.songId + '.webp';
        return;
    }
    img.outerHTML = jacketPlaceholder(img.dataset.boxClass, img.dataset.qSize);
}

/* 곡 정보가 없으면 자켓을 아예 불러오지 않는다 (없는 이미지 요청 + 깨진 썸네일 방지) */
function jacketHtml(info, boxClass, qSize) {
    if (info.noData) return jacketPlaceholder(boxClass, qSize);
    // 로페봇에서 보충한 곡은 v-archive에 자켓이 없으므로 처음부터 로페봇 이미지를 쓴다
    const src = info.fromLope ? `${LOPE_IMG_BASE}${info.titleId}.webp` : `${VA_IMG_BASE}${info.titleId}.jpg`;
    const tried = info.fromLope ? ' data-tried-lope="1"' : '';
    return `<img src="${src}" data-song-id="${info.titleId}" data-box-class="${boxClass}" data-q-size="${qSize}"${tried} onerror="handleJacketError(this)" class="${boxClass} object-cover cursor-pointer hover:opacity-80 transition-opacity" onclick="window.open('https://b300.vercel.app/?m=song&s=${info.titleId}', '_blank'); event.stopPropagation();">`;
}

function updateRow(row, info) {
    row.setAttribute('data-title-id', info.titleId);
    row.dataset.floorName = info.floorName;
    row.dataset.level = info.level;
    const bL = ['4B', '5B', '6B', '8B'], dL = ['NM', 'HD', 'MX', 'SC'];
    
    if (currentMode === 'versus') {
        // 밴픽 표시는 곡 인식 결과가 아니라 슬롯에 붙은 것이므로 Recheck로 다시 그려도 유지한다
        const marks = ['played', 'banned'].filter(c => row.classList.contains(c));
        row.className = 'track-row rounded-2xl opacity-100 shadow-xl relative glass flex flex-col items-center text-center p-4 space-y-3';
        row.classList.add(...marks);
        row.innerHTML = `
            <h3 class="font-bold text-white text-sm leading-tight h-10 flex items-center justify-center overflow-hidden">${info.name}</h3>
            <div class="relative group w-full aspect-square overflow-hidden rounded-xl border border-slate-800 shadow-md">
                ${jacketHtml(info, 'w-full h-full', '3.5rem')}
                <div class="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm rounded-b-xl p-1 floor-area transition-all duration-300 flex items-center justify-center" style="background-color: ${getDifficultyBgColor(info.level, info.difficulty, info.floor)}">
                    <p class="floor-value text-xl font-black text-white">${circledLevel(info.level)} ${info.floorName}</p>
                </div>
            </div>
            <div class="flex items-center space-x-1 w-full">
                <select class="btn-select flex-1 px-1 py-1 rounded-md text-xs font-black text-white bg-slate-800 border-none outline-none shadow-sm" onchange="event.stopPropagation(); handleCorrection(this)">
                    ${bL.map(b => `<option value="${b}" ${b===info.button?'selected':''}>${b}</option>`).join('')}
                </select>
                <select class="diff-select flex-1 px-1 py-1 rounded-md text-xs font-black text-white bg-slate-800 border-none outline-none shadow-sm" onchange="event.stopPropagation(); handleCorrection(this)">
                    ${dL.map(d => `<option value="${d}" ${d===info.difficulty?'selected':''}>${d}</option>`).join('')}
                </select>
            </div>
            <div class="tags-container w-full min-h-[40px] flex-1">${getSongTagsHtml(info.titleId, info.button, info.difficulty)}</div>
            <div class="flex items-center space-x-1 w-full pt-1">
                <button class="recheck-btn flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-1.5 rounded-md uppercase font-bold tracking-tighter" onclick="event.stopPropagation(); handleRecheck(this)">Recheck</button>
                <button class="copy-btn flex-1 bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 text-xs py-1.5 rounded-md uppercase font-bold tracking-tighter border border-blue-700/50" onclick="event.stopPropagation(); copyRowInfo(this)">Copy</button>
                <button class="memo-btn flex-none bg-amber-900/30 hover:bg-amber-800/50 text-amber-300 text-xs px-2.5 py-1.5 rounded-md font-bold" title="패턴 메모 (자작 태그)" onclick="event.stopPropagation(); openMemoFromRow(this)">✎</button>
            </div>
        `;
    } else {
        row.className = 'track-row p-5 rounded-2xl flex items-center justify-between opacity-100 shadow-xl relative glass';
        row.innerHTML = `<div class="flex items-center space-x-5">${jacketHtml(info, 'w-20 h-20 flex-none rounded-xl border border-slate-800 shadow-md', '1.75rem')}<div><h3 class="font-bold text-white text-xl leading-tight mb-1">${info.name}</h3><div class="tags-container">${getSongTagsHtml(info.titleId, info.button, info.difficulty)}</div><div class="flex items-center space-x-1.5 mt-2.5"><select class="btn-select px-2 py-1 rounded-md text-[11px] font-black text-white bg-slate-800 border-none outline-none shadow-sm" onchange="event.stopPropagation(); handleCorrection(this)">${bL.map(b => `<option value="${b}" ${b===info.button?'selected':''}>${b}</option>`).join('')}</select><select class="diff-select px-2 py-1 rounded-md text-[11px] font-black text-white bg-slate-800 border-none outline-none shadow-sm" onchange="event.stopPropagation(); handleCorrection(this)">${dL.map(d => `<option value="${d}" ${d===info.difficulty?'selected':''}>${d}</option>`).join('')}</select><button class="recheck-btn ml-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] px-2.5 py-1 rounded-md uppercase font-bold tracking-tighter" onclick="event.stopPropagation(); handleRecheck(this)">Recheck</button></div></div></div><div class="text-right flex flex-col items-end"><p class="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Floor Intensity</p><div class="floor-area transition-all duration-300 flex items-center" style="border-radius: 12px; padding: 6px 12px; background-color: ${getDifficultyBgColor(info.level, info.difficulty, info.floor)}"><p class="floor-value text-3xl font-black text-white">${circledLevel(info.level)} ${info.floorName}</p></div></div>`;
    }
    updateSelectColors(row.querySelector('.btn-select'), row.querySelector('.diff-select'));
    renderRoundBadge(row); // Recheck으로 카드를 다시 그려도 라운드 표시 유지
}

function copyRowInfo(btn) {
    const row = btn.closest('.track-row');
    const title = row.querySelector('h3').innerText;
    const button = row.querySelector('.btn-select').value;
    const diff = row.querySelector('.diff-select').value;
    const floorName = row.dataset.floorName || row.querySelector('.floor-value').innerText;
    const levelChar = circledLevel(row.dataset.level);
    const floor = levelChar ? `${levelChar} ${floorName}` : floorName;
    
    const tagsContainer = row.querySelector('.tags-container');
    const tags = tagsContainer ? Array.from(tagsContainer.querySelectorAll('span:not(.memo-tag)')).map(s => s.innerText).join(' ') : '';
    
    const text = `${title} ${button} ${diff} ${floor}${tags ? ' ' + tags : ''}`;
    copyTextWithMessage(text);
}

/* 일망호 표의 칸 클릭 → 버망호 Copy와 같은 '곡제목 버튼 난이도 층수 [BPM] [태그]' 형식 */
function copyGeneralCell(cell) {
    const row = cell.closest('.track-row');
    const titleId = row.getAttribute('data-title-id');
    const data = getSongDataSync(titleId);
    if (!data.success) return;
    const button = cell.dataset.btn, diff = cell.dataset.diff;
    const p = data.patterns?.[button]?.[diff];
    const floorName = patternFloorName(p);
    const levelChar = circledLevel(p?.level);
    const floor = levelChar ? `${levelChar} ${floorName}` : floorName;
    const tags = getSongTagList(titleId, button, diff).filter(t => t.type !== 'custom').map(t => `[${t.text}]`).join(' ');

    const text = `${data.name} ${button} ${diff} ${floor}${tags ? ' ' + tags : ''}`;
    copyTextWithMessage(text);
}

function copyTextWithMessage(text) {
    navigator.clipboard.writeText(text).then(() => {
        showTemporaryMessage("정보 복사됨!");
    }).catch(err => {
        showTemporaryMessage("복사 실패");
    });
}

function handleCorrection(el) {
    const row = el.closest('.track-row'), bS = row.querySelector('.btn-select'), dS = row.querySelector('.diff-select'), btn = bS.value, diff = dS.value;
    updateSelectColors(bS, dS); const tId = row.getAttribute('data-title-id'), d = getSongDataSync(tId);
    const tC = row.querySelector('.tags-container'); if (tC) tC.innerHTML = getSongTagsHtml(tId, btn, diff);
    const p = d.patterns?.[btn]?.[diff], fE = row.querySelector('.floor-value'), fA = row.querySelector('.floor-area');
    if (fE) {
        const fV = p?.floor ?? "-", fN = patternFloorName(p), l = p?.level || 0;
        row.dataset.floorName = fN;
        row.dataset.level = l;
        fE.textContent = `${circledLevel(l)} ${fN}`;
        if (fA) {
            fA.style.backgroundColor = getDifficultyBgColor(l, diff, fV);
        }
    }
}

function updateSelectColors(bE, dE) {
    const bC = BTN_COLORS, dC = DIFF_COLORS;
    const all = ['bg-slate-800', 'bg-slate-700', 'bg-slate-600', ...Object.values(bC), ...Object.values(dC)];
    all.forEach(c => { bE.classList.remove(c); dE.classList.remove(c); });
    if (bC[bE.value]) bE.classList.add(bC[bE.value]); if (dC[dE.value]) dE.classList.add(dC[dE.value]);
}

function getSongDataSync(tId) { const s = songDatabase[parseInt(tId)]; return s ? { success: true, id: s.title, name: s.name, patterns: s.patterns, fromLope: !!s.fromLope } : { success: false }; }

/* 로페봇 곡 정보는 v-archive에 없는 곡을 만났을 때만 한 번 받아온다.
   v-archive로 다 커버되면 요청이 아예 나가지 않는다. */
let lopeSongsPromise = null;
function ensureLopeSongs() {
    if (lopeSongsPromise) return lopeSongsPromise;
    lopeSongsPromise = (async () => {
        const proxyUrl = 'https://api.allorigins.win/raw?url=';
        try {
            let res; try { res = await fetch(LOPE_SONGS_URL, { mode: 'cors' }); } catch (err) { res = await fetch(proxyUrl + encodeURIComponent(LOPE_SONGS_URL)); }
            if (!res || !res.ok) throw new Error();
            const songs = await res.json();
            let added = 0;
            // v-archive와 title/name/patterns 구조가 같아 그대로 꽂아 넣을 수 있고,
            // 이미 v-archive에 있는 곡은 덮어쓰지 않는다(v-archive 우선).
            songs.forEach(s => {
                if (s && s.title !== undefined && songDatabase[s.title] === undefined) {
                    songDatabase[s.title] = Object.assign({}, s, { fromLope: true });
                    added++;
                }
            });
            console.log(`[Lope] Supplemented ${added} songs missing from v-archive.`);
        } catch (e) { console.error("[Lope] Error loading songs:", e); }
    })();
    return lopeSongsPromise;
}

/* v-archive에 없으면 로페봇을 보충한 뒤 다시 조회한다 */
async function ensureSongData(tId) {
    const d = getSongDataSync(tId);
    if (d.success) return d;
    await ensureLopeSongs();
    return getSongDataSync(tId);
}

/* 속성값(data-tag="...")에도 넣으므로 따옴표까지 바꾼다 */
// escapeHtml은 lib/util.js에 있다 (매칭 쪽과 같은 것을 쓴다)

let songSearchMatches = [];
let songSearchActiveIndex = -1;

function handleSongSearchInput(value) {
    const box = document.getElementById('songSearchResults');
    const q = value.trim().toLowerCase();
    songSearchActiveIndex = -1;
    if (!q) { songSearchMatches = []; box.classList.add('hidden'); box.innerHTML = ''; return; }

    const matches = [];
    for (const idStr of Object.keys(songDatabase)) {
        const song = songDatabase[idStr];
        if (!song || !song.name) continue;
        const nameLower = song.name.toLowerCase();
        const akaList = songTagsDatabase[idStr]?.aka;
        const akas = Array.isArray(akaList) ? akaList : [];

        let rank = -1, matchedAka = null;
        if (nameLower === q) rank = 0;
        else if (nameLower.startsWith(q)) rank = 1;
        else if (nameLower.includes(q)) rank = 2;
        else {
            for (const a of akas) {
                const aLower = String(a).toLowerCase();
                if (aLower === q) { rank = 0; matchedAka = a; break; }
                if (aLower.startsWith(q)) { rank = 1; matchedAka = a; break; }
                if (aLower.includes(q)) { rank = 2; matchedAka = a; break; }
            }
        }
        if (rank !== -1) matches.push({ id: idStr, name: song.name, matchedAka, rank });
    }

    matches.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ko'));
    songSearchMatches = matches.slice(0, 30);
    renderSongSearchResults();
}

function renderSongSearchResults() {
    const box = document.getElementById('songSearchResults');
    if (songSearchMatches.length === 0) {
        box.innerHTML = `<div class="px-5 py-4 text-slate-500 text-xs">검색 결과가 없습니다.</div>`;
    } else {
        box.innerHTML = songSearchMatches.map((m, i) => `
            <div class="song-search-item px-5 py-3 cursor-pointer flex items-center justify-between border-b border-slate-800/60 last:border-b-0 ${i === songSearchActiveIndex ? 'bg-slate-800/80' : 'hover:bg-slate-800/80'}"
                onclick="selectSongFromSearch('${m.id}')">
                <span class="text-white text-sm font-medium">${escapeHtml(m.name)}</span>
                ${m.matchedAka ? `<span class="text-[10px] text-slate-500 ml-3 whitespace-nowrap">${escapeHtml(String(m.matchedAka))}</span>` : ''}
            </div>
        `).join('');
        if (songSearchActiveIndex >= 0 && box.children[songSearchActiveIndex]) {
            box.children[songSearchActiveIndex].scrollIntoView({ block: 'nearest' });
        }
    }
    box.classList.remove('hidden');
}

function handleSongSearchKeydown(e) {
    const box = document.getElementById('songSearchResults');
    if (box.classList.contains('hidden') || songSearchMatches.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        songSearchActiveIndex = (songSearchActiveIndex + 1) % songSearchMatches.length;
        renderSongSearchResults();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        songSearchActiveIndex = (songSearchActiveIndex - 1 + songSearchMatches.length) % songSearchMatches.length;
        renderSongSearchResults();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const idx = songSearchActiveIndex >= 0 ? songSearchActiveIndex : 0;
        selectSongFromSearch(songSearchMatches[idx].id);
    } else if (e.key === 'Escape') {
        box.classList.add('hidden');
    }
}

function selectSongFromSearch(id) {
    const data = getSongDataSync(id);
    if (!data.success) return;
    document.getElementById('songSearchResults').classList.add('hidden');
    document.getElementById('songSearchInput').value = data.name;

    document.getElementById('dropZone').style.display = 'none';
    document.getElementById('screenshotContainer').style.display = 'none';
    window.lastProcessedImg = null; lastImageHash = null;

    statusLogs = []; resultList.innerHTML = '';
    const row = createLoadingRow(1);
    resultList.appendChild(row);
    row.matches = null; row.matchIndex = 0;
    updateGeneralRow(row, data, id);
    addShot(null, [row], null);
}

document.addEventListener('click', (e) => {
    const box = document.getElementById('songSearchResults'), input = document.getElementById('songSearchInput');
    if (box && input && !box.contains(e.target) && e.target !== input) box.classList.add('hidden');
});

async function handleRecheck(btn) {
    const r = btn.closest('.track-row'); if (!r || !r.matches) return;
    r.matchIndex = (r.matchIndex + 1) % Math.min(r.matches.length, 10);
    if (currentMode === 'general') { const m = r.matches[r.matchIndex], d = await ensureSongData(m.id); updateGeneralRow(r, d, m.id); }
    else displayMatch(r, r.matchIndex);
}

function createLoadingRow(index) {
    const d = document.createElement('div'); 
    if (currentMode === 'versus') {
        d.className = 'track-row p-4 rounded-2xl flex flex-col items-center opacity-50 glass space-y-3';
        d.innerHTML = `
            <div class="h-6 w-3/4 bg-slate-800 loading-shimmer rounded-lg mb-2"></div>
            <div class="w-full aspect-square rounded-xl bg-slate-800 loading-shimmer"></div>
            <div class="h-8 w-full bg-slate-800 loading-shimmer rounded-md"></div>
            <div class="h-10 w-full bg-slate-800 loading-shimmer rounded-md"></div>
        `;
    } else {
        d.className = 'track-row p-5 rounded-2xl flex items-center justify-between opacity-50 glass';
        d.innerHTML = `<div class="flex items-center space-x-5 w-full"><div class="w-20 h-20 rounded-xl bg-slate-800 loading-shimmer"></div><div class="flex-grow"><div class="h-6 w-3/4 bg-slate-800 mb-3 loading-shimmer rounded-lg"></div><div class="h-4 w-1/2 bg-slate-800 loading-shimmer rounded-md"></div></div><div class="text-right"><div class="h-10 w-24 bg-slate-800 loading-shimmer rounded-xl"></div></div></div>`;
    }
    return d;
}

// 손으로 플레이를 풀거나 밴으로 바꾸면 자동으로 붙은 라운드 번호도 뗀다
function clearRoundIfNotPlayed(r) { if (!r.classList.contains('played') && r.dataset.round) { delete r.dataset.round; renderRoundBadge(r); } }
resultList.addEventListener('click', (e) => { if (currentMode !== 'versus') return; const r = e.target.closest('.track-row'); if (r && !e.target.closest('select') && !e.target.closest('button')) { r.classList.toggle('played'); r.classList.remove('banned'); clearRoundIfNotPlayed(r); } });
// 일망호 표에서는 우클릭이 밴 대신 그 패턴의 메모(자작 태그) 편집
resultList.addEventListener('contextmenu', (e) => { if (currentMode !== 'general') return; const cell = e.target.closest('.grid-cell[data-btn]'); if (cell) { e.preventDefault(); openMemoFromCell(cell); } });
resultList.addEventListener('contextmenu', (e) => { if (currentMode !== 'versus') return; const r = e.target.closest('.track-row'); if (r && !e.target.closest('select') && !e.target.closest('button')) { e.preventDefault(); r.classList.toggle('banned'); r.classList.remove('played'); clearRoundIfNotPlayed(r); } });
document.getElementById('screenshotPreview').addEventListener('click', function() { this.classList.toggle('expanded'); });
// 페이지가 매칭 화면과 합쳐져 있어 window.onload를 독점하면 안 된다
window.addEventListener('load', init);
