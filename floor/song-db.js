/* 곡 데이터베이스 — hashes.json 적재, 자켓/버튼/난이도 해시 매칭, 상태 표시. */

const songDatabase = {}; let statusLogs = []; window.lastProcessedImg = null; 
function renderStatus() {
    if (!resultList) return;
    const containerClass = currentMode === 'versus' ? 'grid grid-cols-1 w-full col-span-full' : 'w-full';
    resultList.innerHTML = `<div class="text-center py-20 space-y-3 ${containerClass}">${statusLogs.map(log => `<p class="text-slate-500 text-xs font-medium tracking-wide">${log}</p>`).join('')}</div>`;
}
function updateStatus(msg, isAppend = false) {
    if (isAppend && statusLogs.length > 0) statusLogs[statusLogs.length - 1] += ` ${msg}`; else statusLogs.push(msg);
    renderStatus();
}

// 본문을 읽는 시간까지 제한한다. CORS·HTTP 오류·잘못된 JSON도 중계로 재시도한다.
async function fetchFloorJson(url, proxy = true) {
    const urls = proxy ? [url, 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)] : [url];
    let error;
    for (const target of urls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(target, { mode: 'cors', signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) { error = e; }
        finally { clearTimeout(timer); }
    }
    throw error;
}

// 자동 다운로드와 파일 선택은 같은 형식을 검사하고, 전부 유효할 때만 교체한다.
function applyHashData(data) {
    const uint = n => Number.isInteger(n) && n >= 0 && n <= 0xFFFFFFFF;
    const bits = v => Array.isArray(v) && v.length === 8 && v.every(uint);
    const color = v => Array.isArray(v) && v.length === 48 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 255);
    const refs = (map, keys) => map && keys.every(key => {
        const ref = map[key];
        return ref && uint(ref.ph?.hi) && uint(ref.ph?.lo) && (!ref.color || color(ref.color));
    });
    if (!refs(data?.trackinfo?.buttons, ['4B', '5B', '6B', '8B']) ||
        !refs(data?.trackinfo?.diffs, ['NM', 'HD', 'MX', 'SC']) ||
        !Array.isArray(data?.thumbnails) || !data.thumbnails.length ||
        !data.thumbnails.every(t => t && /^\d+$/.test(String(t.id)) && bits(t.ah) && bits(t.dh) && color(t.color))) {
        throw new Error('잘못된 자켓 해시 데이터');
    }
    // base64 디코딩도 교체 전에 끝낸다. 실패하면 기존 인식 자료는 그대로 남는다.
    loadSigTable(data.thumbnails);
    for (const key of Object.keys(buttonRefs)) delete buttonRefs[key];
    for (const key of Object.keys(diffRefs)) delete diffRefs[key];
    for (const key of ['4B', '5B', '6B', '8B']) buttonRefs[key] = data.trackinfo.buttons[key];
    for (const key of ['NM', 'HD', 'MX', 'SC']) diffRefs[key] = data.trackinfo.diffs[key];
    thumbRefs.length = 0;
    for (const t of data.thumbnails) thumbRefs.push(t);
}

async function loadHashes() {
    updateStatus("곡 정보와 자켓 해시를 가져오는 중..");
    // 선택 정보인 태그 서버가 멈춰도 인식 준비를 막지 않는다.
    fetchFloorJson('https://data.xn--2o2bk9ff9x.com/tags/new_tags.json').then(d => {
        if (!Array.isArray(d.items)) throw new Error('잘못된 태그 데이터');
        d.items.forEach(i => {
            if (i.song_title !== undefined && i.song_title !== null) songTagsDatabase[String(i.song_title)] = i;
        });
    }).catch(e => console.warn('[Tags] 태그 없이 계속합니다:', e));

    const [songs, hashes] = await Promise.allSettled([
        fetchFloorJson('https://v-archive.net/db/v2/songs.json').then(songs => {
            if (!Array.isArray(songs)) throw new Error('잘못된 곡 데이터');
            songs.forEach(s => { songDatabase[s.title] = s; });
        }),
        fetchFloorJson('hashes.json', false).then(data => {
            applyHashData(data);
        })
    ]);
    if (songs.status === 'rejected') {
        updateStatus("<span class='text-yellow-500 font-bold'>곡 정보를 받지 못했습니다. 곡 확인 시 보충 출처로 다시 조회합니다.</span>");
    }
    const hashInput = document.getElementById('hashUploadContainer');
    hashInput.classList.toggle('hidden', hashes.status === 'fulfilled');
    if (hashes.status === 'rejected') {
        updateStatus("<span class='text-yellow-500 font-bold' id='hashStatusLabel'>자켓 해시를 받지 못했습니다. hashes.json 파일을 선택하거나 새로고침해 주세요.</span>");
        return false;
    }
    return true;
}

function handleHashUpload(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader(); resultList.innerHTML = `<div class="text-center py-20 text-slate-600 italic">데이터 처리 중...</div>`;
    reader.onload = function(e) {
        try {
            const d = JSON.parse(e.target.result);
            applyHashData(d);
            document.getElementById('hashUploadContainer').classList.add('hidden');
            if (statusLogs.length > 0) statusLogs[statusLogs.length - 1] = statusLogs[statusLogs.length - 1].replace(/<span.*>.*<\/span>/, "<span class='text-green-500 font-bold'>완료!</span>");
            updateStatus("<div class='mt-6 text-blue-400 font-bold text-lg'>준비 완료!</div>");
        } catch (err) { renderStatus(); alert('해시 파일을 읽을 수 없습니다: ' + err.message); }
    };
    reader.onerror = () => { renderStatus(); alert('해시 파일을 읽을 수 없습니다'); };
    reader.onloadend = () => { input.value = ''; };
    reader.readAsText(file);
}

async function init() { statusLogs = []; const s = await loadHashes(); if (s) updateStatus("<div class='mt-6 text-blue-400 font-bold text-lg'>준비 완료!</div>"); }

function getSongDataSync(tId) { const s = songDatabase[parseInt(tId)]; return s ? { success: true, id: s.title, name: s.name, patterns: s.patterns, fromLope: !!s.fromLope } : { success: false }; }

/* 로페봇 곡 정보는 v-archive에 없는 곡을 만났을 때만 한 번 받아온다.
   v-archive로 다 커버되면 요청이 아예 나가지 않는다. */
let lopeSongsPromise = null;
function ensureLopeSongs() {
    if (lopeSongsPromise) return lopeSongsPromise;
    lopeSongsPromise = (async () => {
        try {
            const songs = await fetchFloorJson(LOPE_SONGS_URL);
            if (!Array.isArray(songs)) throw new Error('잘못된 곡 데이터');
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
        } catch (e) {
            lopeSongsPromise = null; // 일시적인 네트워크 실패를 새로고침할 때까지 고정하지 않는다.
            console.error("[Lope] Error loading songs:", e);
        }
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

function getSortedMatches(hashA, hashD, colorGrid) {
    const W_COLOR = 2.0; // 색상 유사도 가중치
    return thumbRefs.map(ref => {
        const hDist = hamDist(hashA, ref.ah) * W_AHASH + hamDist(hashD, ref.dh) * W_DHASH;
        const cDist = colorDist(colorGrid, ref.color);
        return { id: ref.id, score: hDist + (cDist * W_COLOR) };
    }).sort((a, b) => a.score - b.score);
}
function bestMatch(targetPh, targetColor, refMap) {
    let best = { key: null, score: Infinity };
    // 가중치: 색상에 더 높은 비중을 둠
    const W_PHASH = 1.0;
    const W_COLOR = 2.0; 
    
    for (const key of Object.keys(refMap)) {
        const ref = refMap[key];
        if (!ref.ph) continue;
        
        const pDist = hamDist(targetPh, ref.ph);
        let cDist = 0;
        
        // 참조 데이터에 색상 정보가 있으면 가중치 적용
        if (ref.color && targetColor) {
            cDist = colorDist(targetColor, ref.color);
        }
        
        const score = pDist * W_PHASH + cDist * W_COLOR;
        if (score < best.score) {
            best = { key, score };
        }
    }
    return best;
}
function showTemporaryMessage(msg, duration = 2500) {
    const z = document.getElementById('messageZone'); if (!z) return; z.textContent = msg;
    setTimeout(() => { if (z.textContent === msg) z.textContent = ''; }, duration);
}
