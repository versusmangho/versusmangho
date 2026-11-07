/* 유지보수 경계 회귀 검사: node maintenance-regression-test.js
   외부 의존성·네트워크·게임 키 입력 없이 실제 함수를 가짜 환경에서 실행한다. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const base = process.argv.includes('--base');
const read = file => base ? require('node:child_process').execFileSync('git', ['show', 'HEAD:' + file],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) : fs.readFileSync(file, 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fn(file, name) {
    const source = read(file).replace(/\r\n/g, '\n');
    const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
    assert(start >= 0, name);
    const next = source.slice(start + 1).search(/\n(?:async )?function \w+\(/);
    return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}
function context(values = {}) {
    const ctx = vm.createContext({ console, ...values }); ctx.window = ctx; return ctx;
}
let count = 0, failures = 0;
async function test(name, run) {
    count++;
    try { await run(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
}
(async () => {
    await test('탭 주소와 잘못된 탭 호출은 선택자를 깨거나 본문을 숨기지 않는다', () => {
        const panels = ['match', 'floor'].map(tabPanel => ({ dataset: { tabPanel } }));
        const ctx = context({ location: { hash: '#\\' }, localStorage: { getItem: () => null },
            document: { body: { dataset: {} }, getElementById: () => null,
                querySelectorAll: selector => selector === '[data-tab-panel]' ? panels : [] } });
        vm.runInContext(read('lib/tabs.js'), ctx);
        ctx.VMH.Tabs.init(); assert.equal(ctx.VMH.Tabs.active, 'match');
        ctx.VMH.Tabs.show('missing'); assert.equal(ctx.VMH.Tabs.active, 'match');
        ctx.VMH.Tabs.follow('floor'); assert.equal(ctx.VMH.Tabs.active, 'floor');
        assert.equal(panels[0].hidden, true); assert.equal(panels[1].hidden, false);
    });
    await test('기존 846곡 해시 적재와 잘못된 해시의 원자적 거절', () => {
        const ctx = context({ atob, Uint8Array, SIG_W: 12, SIG_H: 8, sigTable: [],
            thumbRefs: [], buttonRefs: {}, diffRefs: {}, window: {} });
        vm.runInContext(fn('floor/match-screen.js', 'loadSigTable') + fn('floor/song-db.js', 'applyHashData'), ctx);
        const data = JSON.parse(read('hashes.json')); ctx.applyHashData(data);
        assert.equal(ctx.thumbRefs.length, data.thumbnails.length);
        const oldSig = ctx.sigTable, oldButton = ctx.buttonRefs['4B'], oldThumb = ctx.thumbRefs[0];
        const broken = JSON.parse(JSON.stringify(data)); broken.thumbnails[0].sig = 'AA==';
        assert.throws(() => ctx.applyHashData(broken));
        broken.thumbnails[0].ah = [0]; assert.throws(() => ctx.applyHashData(broken));
        assert.equal(ctx.sigTable, oldSig); assert.equal(ctx.buttonRefs['4B'], oldButton);
        assert.equal(ctx.thumbRefs[0], oldThumb);
    });
    await test('문자열 전적 복원·이전 로그 호환·손상된 room의 적용 방지', () => {
        let saved = { room: { round: '4', players: [{ nickname: 'A', matchCount: '2', waitSum: '3' }],
            playerHistory: { A: { matchCount: '2', waitSum: '3' } }, matchLog: [{ chooser: 'A' }] } };
        const ctx = context({ room: { round: 0, players: [], seen: [], eventLog: [], playerHistory: {} },
            STORAGE_KEY: 'test', SafeStorage: { getItem: () => JSON.stringify(saved) },
            document: { getElementById: () => null, querySelector: () => null } });
        vm.runInContext(fn('script.js', 'normalizePlayer') + fn('script.js', 'loadState'), ctx);
        ctx.loadState(); assert.equal(ctx.room.players[0].matchCount, 2);
        assert.equal(ctx.room.playerHistory.A.waitSum, 3); assert.equal(ctx.room.round, 4);
        assert.equal(ctx.room.eventLog[0].type, 'match');
        const old = ctx.room; saved = { room: { players: 'broken' } };
        assert.equal(ctx.loadState(), null); assert.equal(ctx.room, old);
    });
    await test('의심 장면을 비운 뒤 늦게 끝난 JPEG가 다시 기록되지 않는다', async () => {
        const jobs = [];
        const ctx = context({ TextEncoder, Uint8Array,
            document: { createElement: () => ({ getContext: () => ({ drawImage() {} }),
                toBlob: cb => jobs.push(cb) }) } });
        vm.runInContext(read('lib/incidents.js'), ctx);
        const pending = ctx.VMH.Incidents.record('split', 'test', {}, 2560, 1440);
        ctx.VMH.Incidents.clear();
        jobs.shift()({ arrayBuffer: async () => new ArrayBuffer(1) }); await pending;
        assert.equal(ctx.VMH.Incidents.count(), 0);
    });
    await test('팝업 중복 열기는 한 요청이고 열리는 중 닫으면 늦은 창도 닫힌다', async () => {
        const gate = deferred(); let calls = 0, closed = 0;
        const ctx = context({ isSecureContext: true, documentPictureInPicture: { requestWindow: () => { calls++; return gate.promise; } },
            document: { readyState: 'loading', addEventListener() {} } });
        vm.runInContext(read('lib/popup.js'), ctx);
        const a = ctx.VMH.Popup.open(), b = ctx.VMH.Popup.open(); assert.equal(a, b);
        ctx.VMH.Popup.close(); gate.resolve({ close: () => closed++ });
        assert.equal(await a, false); assert.equal(calls, 1); assert.equal(closed, 1);
        assert.equal(ctx.VMH.Popup.isOpen(), false);
    });
    await test('워커 생성 성공·실패 모두 스크립트 Blob URL을 해제한다', () => {
        let created = 0, revoked = 0, stopped = 0, fail = false, fallback = 0;
        const ctx = context({ Blob, URL: { createObjectURL: () => 'blob:' + ++created, revokeObjectURL: () => revoked++ },
            Worker: class { constructor() { if (fail) throw Error('blocked'); } terminate() { stopped++; } },
            setInterval: () => ++fallback, clearInterval() {} });
        vm.runInContext(read('lib/screen-capture.js'), ctx);
        ctx.VMH.ScreenCapture.createTicker(500, () => {})(); fail = true;
        ctx.VMH.ScreenCapture.createTicker(500, () => {})();
        assert.equal(created, 2); assert.equal(revoked, 2); assert.equal(stopped, 1); assert.equal(fallback, 1);
    });
    await test('스캔 읽기 대기 중 중지하면 판독 결과를 적용하지 않는다', async () => {
        const gate = deferred(), ctx = context({ state: { stopAsked: false }, readNow: () => gate.promise,
            READ_TRIES: 8, RETRY_GAP_MS: 50, sleep: async () => {} });
        // IIFE 안 함수는 들여쓰기만 제거해 실제 정의를 추출한다.
        const source = read('scan/app.js'), start = source.indexOf('    async function readFrame()');
        const end = source.indexOf('\n    // ── 스캔 루프', start);
        assert(start >= 0 && end > start); vm.runInContext(source.slice(start, end), ctx);
        const result = ctx.readFrame(); ctx.state.stopAsked = true; gate.resolve({ ok: true });
        await assert.rejects(result, /stop/); await assert.rejects(ctx.readFrame(), /stop/);
    });
    console.log((count - failures) + '/' + count + ' maintenance regression checks passed');
    if (failures) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
