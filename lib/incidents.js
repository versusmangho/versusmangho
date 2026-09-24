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

    const RING = 6;              // 로비 프레임 이만큼(3초)의 명단 칸을 들고 있는다
    const KEEP_BEFORE = [5, 3, 1];   // 그중 이 프레임들(몇 프레임 전)을 스샷으로 남긴다
    const MAX_INCIDENTS = 5;
    const JPEG_Q = 0.92;
    const PANEL = { x: 1950, y: 225, w: 450, h: 860 };   // 2560x1440 기준 — 로비 명패 8칸을 넉넉히 덮는다

    const ring = [];             // [{ canvas, W, H }]
    const incidents = [];        // [{ at, kind, note, files: [{ name, bytes }] }]
    const listeners = [];

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

    /* 의심 장면 하나 — frame은 지금 화면. thumbs: 참고로 같이 넣을 장부 명패 [{ id, dataUrl }] */
    async function record(kind, note, frame, W, H, thumbs = []) {
        const at = new Date(), base = stamp(at);
        const shots = [];
        // 전 프레임들: 지금 화면에 그때의 명단 칸을 덧그린다 (명단 칸 밖은 지금 것이지만 로비 판별·명패 읽기에는 상관없다)
        const r = rectOf(W, H);
        for (const back of KEEP_BEFORE) {
            const old = ring[ring.length - 1 - back];
            if (!old || old.W !== W || old.H !== H) continue;
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const g = c.getContext('2d');
            g.drawImage(frame, 0, 0, W, H);
            g.drawImage(old.canvas, r.x, r.y, r.w, r.h);
            shots.push({ name: `${base}_${kind}_minus${back}.jpg`, canvas: c });
        }
        const now = document.createElement('canvas'); now.width = W; now.height = H;
        now.getContext('2d').drawImage(frame, 0, 0, W, H);
        shots.push({ name: `${base}_${kind}_now.jpg`, canvas: now });

        const files = [];
        for (const s of shots) { const bytes = await toJpeg(s.canvas); if (bytes) files.push({ name: s.name, bytes }); }
        for (const t of thumbs) {
            const m = /^data:image\/\w+;base64,(.*)$/.exec(t.dataUrl || '');
            if (m) files.push({ name: `${base}_${kind}_book_${t.id}.jpg`, bytes: Uint8Array.from(atob(m[1]), ch => ch.charCodeAt(0)) });
        }
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
            'images/ 에 넣고 plate-fixtures.js → plate-labels.json → plate-test.js / replay-test.js\r\n\r\n' + notes + '\r\n') });
        for (const i of incidents) files.push(...i.files);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zip(files));
        a.download = 'vmh-incidents-' + stamp(new Date()) + '.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    function clear() { incidents.length = 0; listeners.forEach(f => f()); }

    global.VMH = global.VMH || {};
    global.VMH.Incidents = {
        remember, forget, record, download, clear,
        count: () => incidents.length,
        list: () => incidents.map(i => ({ at: i.at, kind: i.kind, note: i.note, files: i.files.length })),
        onChange: (f) => listeners.push(f),
        _zip: zip, _crc32: crc32
    };
})(window);
