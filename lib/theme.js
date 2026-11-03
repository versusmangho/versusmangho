/* 스타일을 읽기 전에 저장된 테마를 적용해 첫 화면의 깜빡임을 막는다. */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'themeV1';
    let current = 'dark';
    try {
        if (global.localStorage.getItem(STORAGE_KEY) === 'light') current = 'light';
    } catch { /* 저장소를 못 쓰면 기본 테마를 쓴다. */ }

    document.documentElement.dataset.theme = current;

    function updateControls() {
        const button = document.getElementById('theme-toggle');
        if (button) {
            const action = current === 'dark' ? '라이트 모드' : '다크 모드';
            button.textContent = (current === 'dark' ? '☀ ' : '☾ ') + action;
            button.setAttribute('aria-label', action + '로 전환');
            button.title = action + '로 전환';
        }
        document.querySelectorAll('input[name="theme"]').forEach(input => {
            input.checked = input.value === current;
        });
    }

    function setTheme(theme) {
        if (theme !== 'dark' && theme !== 'light') return;
        current = theme;
        document.documentElement.dataset.theme = current;
        try { global.localStorage.setItem(STORAGE_KEY, current); }
        catch { /* 저장 실패 여부와 무관하게 현재 화면에는 적용한다. */ }
        updateControls();
        global.VMH.Popup?.update();
    }

    function bindControls() {
        const button = document.getElementById('theme-toggle');
        if (button) button.addEventListener('click', () => {
            setTheme(current === 'dark' ? 'light' : 'dark');
        });
        document.querySelectorAll('input[name="theme"]').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) setTheme(input.value);
            });
        });
        updateControls();
    }

    global.VMH = global.VMH || {};
    global.VMH.Theme = {
        get current() { return current; },
        set: setTheme
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindControls, { once: true });
    } else {
        bindControls();
    }
})(window);
