/* 탭 전환. 숨기기만 하고 아무것도 끄지 않는다 —
   화면 자동 인식은 탭과 무관하게 계속 돌고, 안 보이는 탭의 기록도 그대로 쌓인다.

   화면 자동 전환(옵션): 인식기가 follow('match' | 'floor')로 지금 게임 화면에 맞는 탭을 알려준다.
   화면이 바뀔 때 한 번만 넘긴다 — 로비가 떠 있는 내내 넘기면 그 사이 다른 탭을 볼 수가 없다. */
(function (global) {
    'use strict';

    const AUTO_KEY = 'autoTabSwitch';
    const listeners = [];
    let active = 'match';
    let autoOn = true;
    let lastScene = null;   // 마지막으로 알려온 화면 — 같은 화면이 계속 와도 다시 넘기지 않는다

    try { autoOn = localStorage.getItem(AUTO_KEY) !== '0'; } catch { /* 저장소를 못 쓰면 기본값(켬) */ }

    function apply() {
        document.querySelectorAll('[data-tab-panel]').forEach(el => {
            el.hidden = (el.dataset.tabPanel !== active);
        });
        document.querySelectorAll('[data-tab-btn]').forEach(el => {
            const on = el.dataset.tabBtn === active;
            el.classList.toggle('active', on);
            el.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.body.dataset.tab = active;
        listeners.forEach(cb => { try { cb(active); } catch (e) { console.error('[Tabs]', e); } });
    }

    const Tabs = {
        get active() { return active; },
        show(name) { if (name === active) return; active = name; apply(); },
        onChange(cb) { listeners.push(cb); },

        get autoSwitch() { return autoOn; },
        set autoSwitch(on) {
            autoOn = !!on;
            try { localStorage.setItem(AUTO_KEY, autoOn ? '1' : '0'); } catch { /* 이번 세션에만 적용 */ }
            const box = document.getElementById('auto-tab-toggle');
            if (box) box.checked = autoOn;
        },
        /* 게임 화면이 name 탭의 화면으로 바뀌었다 */
        follow(name) {
            if (name === lastScene) return;
            lastScene = name;
            if (autoOn) Tabs.show(name);
        },
        /* 화면 공유를 끊으면 잊는다 — 다시 연결했을 때 첫 화면에서 바로 넘기도록 */
        forgetScene() { lastScene = null; },

        init() {
            document.querySelectorAll('[data-tab-btn]').forEach(el => {
                el.addEventListener('click', () => Tabs.show(el.dataset.tabBtn));
            });
            const box = document.getElementById('auto-tab-toggle');
            if (box) {
                box.checked = autoOn;
                box.addEventListener('change', () => { Tabs.autoSwitch = box.checked; });
            }
            // floor.html 시절 주소로 들어오면(index.html#floor) 그 탭을 연다
            const fromHash = (location.hash || '').replace('#', '');
            if (fromHash && document.querySelector(`[data-tab-panel="${fromHash}"]`)) active = fromHash;
            apply();
        }
    };

    global.VMH = global.VMH || {};
    global.VMH.Tabs = Tabs;
})(window);
