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

async function loadHashes() {
    updateStatus("v-archive에서 정보를 가져오는 중..");
    const songApiUrl = 'https://v-archive.net/db/v2/songs.json', proxyUrl = 'https://api.allorigins.win/raw?url=';
    try {
        let res; try { res = await fetch(songApiUrl, { mode: 'cors' }); } catch (err) { res = await fetch(proxyUrl + encodeURIComponent(songApiUrl)); }
        if (res && res.ok) { 
            const songs = await res.json();
            songs.forEach(s => { songDatabase[s.title] = s; }); 
            updateStatus("<span class='text-green-500 font-bold'>완료!</span>", true); 
        } else throw new Error();
    } catch (e) { updateStatus("<span class='text-red-500 font-bold'>실패!</span>", true); }

    // 로페봇 곡 상세 태그(BPM/패턴 태그) — v-archive에 없는 정보라 항상 받는다.
    // 곡 정보 자체는 v-archive로 충분하면 받지 않고,
    // 없는 곡을 처음 만났을 때만 ensureLopeSongs()가 한 번 받아온다.
    updateStatus("로페봇에서 정보를 가져오는 중..");
    const tagApiUrl = 'https://data.xn--2o2bk9ff9x.com/tags/new_tags.json';
    try {
        let res; try { res = await fetch(tagApiUrl, { mode: 'cors' }); } catch (err) { res = await fetch(proxyUrl + encodeURIComponent(tagApiUrl)); }
        if (!res || !res.ok) throw new Error();
        const d = await res.json();
        if (d.items && Array.isArray(d.items)) {
            // 새 구조에서는 song_title이 숫자 ID임
            d.items.forEach(i => { if (i.song_title !== undefined && i.song_title !== null) songTagsDatabase[String(i.song_title)] = i; });
            console.log(`[Tags] Successfully loaded ${Object.keys(songTagsDatabase).length} tag entries by ID.`);
        }
        updateStatus("<span class='text-green-500 font-bold'>완료!</span>", true);
    } catch (e) {
        console.error("[Tags] Error loading tags:", e);
        updateStatus("<span class='text-yellow-500 font-bold'>실패!</span>", true);
    }

    updateStatus("자켓 해시를 가져오는 중..");
    try {
        const hRes = await fetch('hashes.json');
        if (hRes.ok) {
            const data = await hRes.json(); 
            Object.assign(buttonRefs, data.trackinfo.buttons); Object.assign(diffRefs, data.trackinfo.diffs);
            thumbRefs.length = 0; thumbRefs.push(...data.thumbnails); loadSigTable(data.thumbnails); document.getElementById('hashUploadContainer').classList.add('hidden');
            updateStatus("<span class='text-green-500 font-bold'>완료!</span>", true);
        } else throw new Error();
    } catch (e) {
        updateStatus("<span class='text-yellow-500 font-bold' id='hashStatusLabel'>중단!</span>", true);
        document.getElementById('hashUploadContainer').classList.remove('hidden'); return false;
    }
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
