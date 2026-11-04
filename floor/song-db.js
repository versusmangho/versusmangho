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
            if (!data.trackinfo?.buttons || !data.trackinfo?.diffs || !Array.isArray(data.thumbnails) || !data.thumbnails.length) {
                throw new Error('잘못된 자켓 해시 데이터');
            }
            return data;
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
    const data = hashes.value;
    Object.assign(buttonRefs, data.trackinfo.buttons);
    Object.assign(diffRefs, data.trackinfo.diffs);
    thumbRefs.length = 0;
    thumbRefs.push(...data.thumbnails);
    loadSigTable(data.thumbnails);
    return true;
}

function handleHashUpload(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader(); resultList.innerHTML = `<div class="text-center py-20 text-slate-600 italic">데이터 처리 중...</div>`;
    reader.onload = function(e) {
        try {
            const d = JSON.parse(e.target.result);
            if (d.trackinfo) {
                Object.assign(buttonRefs, d.trackinfo.buttons); Object.assign(diffRefs, d.trackinfo.diffs);
                thumbRefs.length = 0; thumbRefs.push(...d.thumbnails); loadSigTable(d.thumbnails); document.getElementById('hashUploadContainer').classList.add('hidden');
                if (statusLogs.length > 0) statusLogs[statusLogs.length - 1] = statusLogs[statusLogs.length - 1].replace(/<span.*>.*<\/span>/, "<span class='text-green-500 font-bold'>완료!</span>");
                renderStatus(); updateStatus("<div class='mt-6 text-blue-400 font-bold text-lg'>준비 완료!</div>");
            }
        } catch (err) { alert("오류 발생"); }
    };
    reader.readAsText(file);
}

async function init() { statusLogs = []; const s = await loadHashes(); if (s) updateStatus("<div class='mt-6 text-blue-400 font-bold text-lg'>준비 완료!</div>"); }

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
