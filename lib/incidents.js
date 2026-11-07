/* 의심 장면 모으기 — 사람 판정이 틀렸을 수 있는 순간의 로비 화면을 남겨 두고, 한 번에 내려받는다.
   지금까지 고친 오판(manaori, Litra, 오빠차…)은 모두 사람이 겪고 스샷을 따로 모아서야 찾았다.
   그 스샷이 곧 plate-fixtures.js · plate-test.js · replay-test.js의 재료다 — 그래서 여기서 저절로 모은다.

   무엇이 '의심'인가 (auto-room.js가 알린다)
     split  — 처음 보는 명패로 새 id를 만들었는데, 장부에 아바타가 같은(그림도 안 어긋나는) 사람이 이미 있다
              (같은 사람이 둘로 갈렸을 수 있다 — 나갔다가 READY인 채로 돌아온 나는핵을써개못핵이 이랬다)
     bounce — 방금(BOUNCE_MS 안에) 퇴장으로 찍힌 사람이 다시 입장했다 (잘못 읽어 퇴장→입장이 찍혔을 수 있다)

   남기는 것: 그 순간의 화면 + 그 전 몇 프레임의 로비 명단 칸. 전 프레임은 명단 칸만 들고 있다가(가볍다) 일이 생기면
   지금 화면에 그 칸을 덧그려 **온전한 로비 스샷**으로 만든다 — images/에 그대로 넣으면 plate-fixtures.js가 읽는다.
   메모리에만 두고(새로고침하면 없어진다) MAX_INCIDENTS건까지. 내려받기는 압축 없는 zip 한 파일(라이브러리 없이 만든다). */
(function (global) {
    'use strict';

    const RING = 12;             // 로비 프레임 이만큼(6초)의 명단 칸을 들고 있는다 — 퇴장 딜레이(5초)보다 길어야 한다
    const KEEP_BEFORE = [5, 3, 1];   // 그중 이 프레임들(몇 프레임 전)을 스샷으로 남긴다
    // 퇴장이 찍힐 때 남기는 프레임 — 11은 딜레이가 세기 시작하기 직전(= 그 사람을 마지막으로 알아본 때),
    // 6은 딜레이 한가운데. 그 사이 화면에 명패가 보이면 잘못 읽은 것이고, 없으면 정말 나간 것이다
    const KEEP_LEAVE = [11, 6, 1];
    const LEAVE_KEEP_MS = 70000; // 퇴장 스샷은 이만큼 들고 있다가(auto-room.js의 BOUNCE_MS 60초보다 길게) 돌아오지 않으면 버린다
    const MAX_INCIDENTS = 5;
    const JPEG_Q = 0.92;
    const PANEL = { x: 1950, y: 225, w: 450, h: 860 };   // 2560x1440 기준 — 로비 명패 8칸을 넉넉히 덮는다

    const ring = [];             // [{ canvas, W, H }]
    const incidents = [];        // [{ at, kind, note, files: [{ name, bytes }] }]
    const leaves = [];           // [{ at, ids, files: Promise<[{ name, bytes }]> }] — 곧 bounce가 될지 모르는 퇴장
    const listeners = [];
    let generation = 0; // 비동기 인코딩 중 비운 기록이 다시 나타나지 않게 한다.

    const rectOf = (W, H) => ({ x: PANEL.x * W / 2560, y: PANEL.y * H / 1440, w: PANEL.w * W / 2560, h: PANEL.h * H / 1440 });

    /* 로비 프레임마다 — 명단 칸만 복사해 둔다 (프레임 캔버스는 다음 틱에 재사용되므로 복사해야 한다) */
    function remember(frame, W, H) {
        const r = rectOf(W, H);
        const old = ring.length >= RING ? ring.shift() : null;
        const c = old && old.canvas.width === Math.round(r.w) && old.canvas.height === Math.round(r.h) ? old.canvas : document.createElement('canvas');
        c.width = Math.round(r.w); c.height = Math.round(r.h);
        c.getContext('2d').drawImage(frame, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
        ring.push({ canvas: c, W, H });
    }
    /* 로비가 끊기면 들고 있던 것도 버린다 — 전 프레임이 다른 화면이면 덧그린 스샷이 엉터리가 된다 */
    function forget() { ring.length = 0; }

    function stamp(d) {
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function toJpeg(canvas) {
        return new Promise((resolve) => {
            canvas.toBlob((b) => { if (!b) return resolve(null); b.arrayBuffer().then(a => resolve(new Uint8Array(a)), () => resolve(null)); }, 'image/jpeg', JPEG_Q);
        });
    }

    /* 지금 화면 + backs 프레임 전의 명단 칸을 덧그린 스샷들 → [{ name, canvas }] (프레임 캔버스는 곧 재사용되므로 여기서 복사한다) */
    function shotsOf(prefix, backs, frame, W, H) {
        const shots = [];
        // 전 프레임들: 지금 화면에 그때의 명단 칸을 덧그린다 (명단 칸 밖은 지금 것이지만 로비 판별·명패 읽기에는 상관없다)
        const r = rectOf(W, H);
        for (const back of backs) {
            const old = ring[ring.length - 1 - back];
            if (!old || old.W !== W || old.H !== H) continue;
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const g = c.getContext('2d');
            g.drawImage(frame, 0, 0, W, H);
            g.drawImage(old.canvas, r.x, r.y, r.w, r.h);
            shots.push({ name: `${prefix}_minus${back}.jpg`, canvas: c });
        }
        const now = document.createElement('canvas'); now.width = W; now.height = H;
        now.getContext('2d').drawImage(frame, 0, 0, W, H);
        shots.push({ name: `${prefix}_now.jpg`, canvas: now });
        return shots;
    }
    async function encode(shots) {
        const files = [];
        for (const s of shots) { const bytes = await toJpeg(s.canvas); if (bytes) files.push({ name: s.name, bytes }); }
        return files;
    }

    /* 퇴장이 찍힌 로비 프레임 — 그 전 몇 초를 떠 둔다. 곧바로 돌아오면(bounce) 그 의심 장면에 붙는다.
       다시 들어온 순간만으로는 정말 나갔다 온 것인지, 앉아 있는 사람을 못 알아본 것인지 가를 수 없다 */
    function noteLeave(ids, frame, W, H) {
        const now = Date.now();
        while (leaves.length && now - leaves[0].at > LEAVE_KEEP_MS) leaves.shift();
        const files = encode(shotsOf(stamp(new Date(now)) + '_leave', KEEP_LEAVE, frame, W, H));
        leaves.push({ at: now, ids: ids.slice(), files });
    }

    /* 의심 장면 하나 — frame은 지금 화면. thumbs: 참고로 같이 넣을 장부 명패 [{ id, dataUrl }].
       leaveOf: 이 사람들의 퇴장 때 떠 둔 스샷도 같이 넣는다 (bounce) */
    async function record(kind, note, frame, W, H, thumbs = [], leaveOf = [], diagnostic = null) {
        const gen = generation;
        const at = new Date(), base = stamp(at);
        const shots = shotsOf(`${base}_${kind}`, KEEP_BEFORE, frame, W, H);
        const left = [];
        for (let i = leaves.length - 1; i >= 0; i--) {
            if (leaves[i].ids.some(id => leaveOf.includes(id)) && Date.now() - leaves[i].at <= LEAVE_KEEP_MS) { left.push(leaves[i]); break; }
        }
        // 비동기 JPEG 인코딩을 기다리기 전에 진단값을 고정한다.
        const diagnosticBytes = diagnostic ? new TextEncoder().encode(JSON.stringify(diagnostic, null, 2)) : null;
        const files = await encode(shots);
        if (diagnosticBytes) files.push({ name: `${base}_${kind}_diagnostic.json`, bytes: diagnosticBytes });
        for (const l of left) {
            // 파일 이름 앞의 시각은 퇴장이 찍힌 때 — 같은 zip 안에서 bounce 스샷과 짝을 찾기 쉽게 bounce 시각을 앞에 붙인다
            for (const f of await l.files) files.push({ name: `${base}_${kind}_${f.name}`, bytes: f.bytes });
        }
        for (const t of thumbs) {
            const m = /^data:image\/\w+;base64,(.*)$/.exec(t.dataUrl || '');
            if (m) files.push({ name: `${base}_${kind}_book_${t.id}.jpg`, bytes: Uint8Array.from(atob(m[1]), ch => ch.charCodeAt(0)) });
        }
        if (gen !== generation) return;
        incidents.push({ at, kind, note, files });
        if (incidents.length > MAX_INCIDENTS) incidents.shift();
        listeners.forEach(f => f());
    }

    /* ── 압축 없는 zip ─────────────────
       파일마다 [로컬 헤더 + 내용], 끝에 [중앙 디렉터리 + 끝 표시]. 이름은 UTF-8(플래그 0x800) */
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function zip(files) {
        const enc = new TextEncoder(), parts = [], central = [];
        let offset = 0;
        const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF], u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
        for (const f of files) {
            const name = enc.encode(f.name), crc = crc32(f.bytes), size = f.bytes.length;
            const common = [...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)];
            const local = new Uint8Array([...u32(0x04034b50), ...common]);
            parts.push(local, name, f.bytes);
            central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
            offset += local.length + name.length + size;
        }
        const cdSize = central.reduce((n, p) => n + p.length, 0);
        const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
        return new Blob([...parts, ...central, end], { type: 'application/zip' });
    }

    function download() {
        if (!incidents.length) return;
        const files = [];
        const notes = incidents.map(i => `${stamp(i.at)}  ${i.kind}  ${i.note}`).join('\r\n');
        files.push({ name: 'README.txt', bytes: new TextEncoder().encode(
            '버망호 도우미 — 사람 판정이 틀렸을 수 있는 순간\r\n' +
            '*_now.jpg 는 그 순간, *_minusN.jpg 는 N프레임(0.5초) 전의 로비 (명단 칸만 그때 것), *_book_*.jpg 는 장부의 비슷한 명패\r\n' +
            'bounce 의 *_<퇴장 시각>_leave_*.jpg 는 퇴장이 찍힌 순간과 그 전 로비 — minus11 이 그 사람을 마지막으로 알아본 때다.\r\n' +
            '  그 사이 명단에 그 사람 명패가 보이면 잘못 읽은 것, 안 보이면 정말 나갔다 온 것\r\n' +
            'images/ 에 넣고 plate-fixtures.js → plate-labels.json → plate-test.js / replay-test.js\r\n\r\n' + notes + '\r\n') });
        for (const i of incidents) files.push(...i.files);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zip(files));
        a.download = 'vmh-incidents-' + stamp(new Date()) + '.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    function clear() { generation++; incidents.length = 0; leaves.length = 0; listeners.forEach(f => f()); }

    global.VMH = global.VMH || {};
    global.VMH.Incidents = {
        remember, forget, record, noteLeave, download, clear,
        count: () => incidents.length,
        list: () => incidents.map(i => ({ at: i.at, kind: i.kind, note: i.note, files: i.files.length })),
        onChange: (f) => listeners.push(f),
        _zip: zip, _crc32: crc32
    };
})(window);
