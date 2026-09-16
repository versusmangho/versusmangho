/* 탭 전환. 숨기기만 하고 아무것도 끄지 않는다 —
   화면 자동 인식은 탭과 무관하게 계속 돌고, 안 보이는 탭의 기록도 그대로 쌓인다. */
(function (global) {
    'use strict';

    const listeners = [];
    let active = 'match';

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
        init() {
            document.querySelectorAll('[data-tab-btn]').forEach(el => {
                el.addEventListener('click', () => Tabs.show(el.dataset.tabBtn));
            });
            // floor.html 시절 주소로 들어오면(index.html#floor) 그 탭을 연다
            const fromHash = (location.hash || '').replace('#', '');
            if (fromHash && document.querySelector(`[data-tab-panel="${fromHash}"]`)) active = fromHash;
            apply();
        }
    };

    global.VMH = global.VMH || {};
    global.VMH.Tabs = Tabs;
})(window);
