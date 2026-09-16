/* 화면 공유를 한 번만 받아 여러 곳이 나눠 쓴다.
   전에는 매칭 도우미와 층수 측정기가 각자 getDisplayMedia를 잡아서, 한 페이지에 둘 다 두면
   사용자가 화면 선택을 두 번 해야 하고 같은 프레임을 두 번 떠오게 된다. 그래서 세션은 하나로 두고
   프레임 한 장을 구독자들에게 돌린다.

   구독자는 자기 화면(로비/결과/밴픽 등)이 아니면 그냥 아무것도 안 하고 돌아가면 된다. */
(function (global) {
    'use strict';

    const TICK_MS = 500;
    const subscribers = [];   // { name, handler }
    const statusListeners = [];
    const changeListeners = [];
    let session = null;

    function notifyChange() { changeListeners.forEach(cb => { try { cb(); } catch (e) { console.error('[CaptureHub]', e); } }); }
    function notifyStatus(text, tone) { statusListeners.forEach(cb => { try { cb(text, tone); } catch (e) { console.error('[CaptureHub]', e); } }); }

    /* 프레임 한 장을 구독자에게 차례로 돌린다.
       한 구독자가 터져도 나머지는 계속 받아야 하므로 각각 try로 감싼다.
       (동시에 돌리지 않는 이유: 둘 다 캔버스를 잡고 쓰는데 한 틱 안에서 순서가 섞일 이유가 없다) */
    async function dispatch(frame, W, H) {
        for (const sub of subscribers) {
            try { await sub.handler(frame, W, H); }
            catch (e) { console.error('[CaptureHub:' + sub.name + ']', e); }
        }
    }

    function ensureSession() {
        if (session) return session;
        session = global.VMH.ScreenCapture.createSession({
            intervalMs: TICK_MS,
            onFrame: dispatch,
            onStatus: notifyStatus,
            onStop: () => notifyChange()
        });
        return session;
    }

    const Hub = {
        /* handler(frame, W, H) — 게임 화면만 잘라낸 프레임. 같은 이름으로 다시 구독하면 갈아끼운다 */
        subscribe(name, handler) {
            const i = subscribers.findIndex(s => s.name === name);
            if (i >= 0) subscribers[i] = { name, handler };
            else subscribers.push({ name, handler });
        },
        unsubscribe(name) {
            const i = subscribers.findIndex(s => s.name === name);
            if (i >= 0) subscribers.splice(i, 1);
        },
        onStatus(cb) { statusListeners.push(cb); },
        onChange(cb) { changeListeners.push(cb); },

        async start() {
            const ok = await ensureSession().start();
            if (ok) notifyChange();
            return ok;
        },
        stop() { if (session) session.stop(); },
        toggle() { return Hub.isRunning() ? (Hub.stop(), Promise.resolve(false)) : Hub.start(); },

        isRunning: () => !!(session && session.isRunning()),
        areaNote: () => session ? session.areaNote() : '',
        // 화면 공유 자체를 쓸 수 있는 환경인지 (file://에서는 못 쓴다)
        available: () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
    };

    global.VMH = global.VMH || {};
    global.VMH.CaptureHub = Hub;
})(window);
