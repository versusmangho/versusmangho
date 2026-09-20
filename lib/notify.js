/* 알림 — 게임 화면이 로비로 돌아왔을 때 한 번 알려준다 (옵션 탭에서 켠다).

   왜 화면 안 표시로는 안 되나: 대결이 도는 동안 사람들은 게임을 보고 있고(페이지는 게임에 가려
   있거나 다른 창 뒤에 있다), 다음 대진은 로비가 돌아와야 잡을 수 있다. 그래서 페이지 밖으로
   나가는 두 가지 — 소리(WebAudio)와 데스크톱 알림(Notification) — 로 알린다.

   브라우저 정책 때문에 소리도 알림도 사용자가 직접 누른 뒤에만 열린다. 그래서 옵션을 켜는 순간과
   '시험 삼아 울리기'를 누른 순간에 AudioContext를 만들고(resume) 알림 권한을 요청한다.
   탭이 가려져 있으면 setTimeout이 느려지지만, 알림은 프레임 처리(워커 타이머) 안에서 바로
   울리므로 영향을 받지 않는다.

   '로비로 돌아왔다'는 판정은 여기가 아니라 auto-room.js가 한다 (로비가 아닌 화면이 충분히
   이어진 뒤에 로비가 보일 때). 여기는 울리는 일만 한다. */
(function (global) {
    'use strict';

    const KEY = 'notifyOptionsV1';
    const HOWS = ['both', 'sound', 'desktop'];
    const TITLE = '버망호 도우미';
    const LOBBY_BODY = '로비로 돌아왔습니다 — 다음 대진을 정하세요';

    const opts = { lobby: false, how: 'both' };
    try {
        const o = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (typeof o.lobby === 'boolean') opts.lobby = o.lobby;
        if (HOWS.includes(o.how)) opts.how = o.how;
    } catch { /* 저장소를 못 쓰면 기본값(끔) */ }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch { /* 이번 세션에만 적용 */ } }

    const hasDesktop = () => typeof global.Notification === 'function';
    // 'default'(아직 안 물어봄) | 'granted' | 'denied' | 'unsupported'
    const permission = () => hasDesktop() ? global.Notification.permission : 'unsupported';

    /* ── 소리 ───────────────── */
    let audio = null;
    function ensureAudio() {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        try {
            if (!audio) audio = new AC();
            if (audio.state === 'suspended') audio.resume().catch(() => { /* 사용자가 누를 때 다시 풀린다 */ });
        } catch { return null; }
        return audio;
    }

    /* 짧은 두 음. 게임 소리에 묻히지 않게 조금 높게, 딱 소리가 나지 않게 앞뒤를 눕힌다 */
    function beep() {
        const ctx = ensureAudio();
        if (!ctx) return;
        const t0 = ctx.currentTime;
        [[880, 0], [1318.5, 0.14]].forEach(([hz, at]) => {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = hz;
            const t = t0 + at;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t); osc.stop(t + 0.24);
        });
    }

    /* ── 알림창 ───────────────── */
    function popup(body) {
        if (permission() !== 'granted') return false;
        try {
            const n = new global.Notification(TITLE, { body, tag: 'vmh-lobby', renotify: true });
            n.onclick = () => { try { global.focus(); } catch { /* 못 띄우면 그만 */ } n.close(); };
            return true;
        } catch { return false; }   // 서비스 워커로만 띄울 수 있는 브라우저(안드로이드 크롬 등)
    }

    function ring(body) {
        if (opts.how !== 'desktop') beep();
        if (opts.how !== 'sound') popup(body);
    }

    async function ask() {
        if (permission() !== 'default') return permission();
        try { return await global.Notification.requestPermission(); } catch { return permission(); }
    }

    /* ── 옵션 탭 ───────────────── */
    const $ = (id) => document.getElementById(id);

    function note() {
        const el = $('notify-note');
        if (!el) return;
        if (!opts.lobby) { el.textContent = ''; return; }
        const bits = [];
        if (opts.how !== 'sound') {
            if (permission() === 'unsupported') bits.push('이 브라우저에서는 알림창을 띄울 수 없습니다 — 소리만 울립니다.');
            else if (permission() === 'denied') bits.push('브라우저가 이 페이지의 알림을 막아 뒀습니다 — 주소창 왼쪽에서 알림을 허용하거나 \'소리만\'을 고르세요.');
            else if (permission() === 'default') bits.push('알림창을 띄우려면 브라우저가 물어보는 알림 권한을 허용해 주세요.');
        }
        const Hub = global.VMH && global.VMH.CaptureHub;
        if (Hub && !Hub.receiving('room')) bits.push('게임 화면을 연결하고 매칭 도우미가 그 화면을 받아야 울립니다.');
        el.textContent = bits.join(' ');
    }

    let inited = false;
    function init() {
        if (inited) return;
        inited = true;

        const box = $('notify-lobby-toggle');
        if (box) {
            box.checked = opts.lobby;
            box.addEventListener('change', async () => {
                opts.lobby = box.checked;
                save();
                // 켠 그 클릭이 소리와 알림 권한을 열 수 있는 유일한 순간이다
                if (opts.lobby) { ensureAudio(); if (opts.how !== 'sound') await ask(); }
                note();
            });
        }
        document.querySelectorAll('input[name="notify-how"]').forEach(r => {
            r.checked = r.value === opts.how;
            r.addEventListener('change', async () => {
                if (!r.checked) return;
                opts.how = r.value;
                save();
                if (opts.how !== 'sound') await ask();
                note();
            });
        });
        const test = $('notify-test-btn');
        if (test) {
            test.addEventListener('click', async () => {
                ensureAudio();
                if (opts.how !== 'sound') await ask();
                ring(LOBBY_BODY);
                note();
            });
        }
        const Hub = global.VMH && global.VMH.CaptureHub;
        if (Hub) Hub.onChange(note);
        note();
    }

    const Notify = {
        get lobbyOn() { return opts.lobby; },
        get how() { return opts.how; },
        get permission() { return permission(); },
        /* 로비로 돌아왔다 — 울렸으면 true (인식 기록에 남기려고 알려준다) */
        lobbyBack() {
            if (!opts.lobby) return false;
            ring(LOBBY_BODY);
            return true;
        },
        test: () => ring(LOBBY_BODY),
        init
    };

    document.addEventListener('DOMContentLoaded', init);
    if (document.readyState !== 'loading') init();

    global.VMH = global.VMH || {};
    global.VMH.Notify = Notify;
})(window);
