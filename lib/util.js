/* 두 앱이 같이 쓰는 공용 유틸리티 · UI 컴포넌트. 가장 먼저 읽힌다. */
(function (global) {
    'use strict';

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    /* 안전한 LocalStorage 래퍼 — 시크릿 모드·용량 초과에서도 예외를 삼킨다 */
    const Storage = {
        available: false,
        getItem(k) { try { return global.localStorage.getItem(k); } catch { return null; } },
        setItem(k, v) { try { global.localStorage.setItem(k, v); return true; } catch { return false; } },
        removeItem(k) { try { global.localStorage.removeItem(k); return true; } catch { return false; } },
        getJson(k, fallback = null) {
            const raw = Storage.getItem(k);
            if (raw == null) return fallback;
            try { return JSON.parse(raw); } catch { return fallback; }
        },
        setJson(k, val) {
            try { return Storage.setItem(k, JSON.stringify(val)); } catch { return false; }
        }
    };
    try {
        const k = '__vmh_storage_test';
        global.localStorage.setItem(k, '1');
        global.localStorage.removeItem(k);
        Storage.available = true;
    } catch { /* feature detect */ }

    /* 공용 UI 컴포넌트 — 접기/펼치기 · 준비 상태 체크리스트 · 도움말 섹션 이동 */
    const UI = {
        /* 접기/펼치기 헤더 연결 (클릭 + Enter/Space 키보드 + aria-expanded + ▼/▲ 통일) */
        bindCollapsible(head, body, icon, opts = {}) {
            if (!head || !body) return null;
            const openDisplay = opts.openDisplay || 'block';
            const setOpen = (open, silent = false) => {
                body.style.display = open ? openDisplay : 'none';
                if (icon) icon.textContent = open ? '▲' : '▼';
                head.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (!silent && typeof opts.onToggle === 'function') opts.onToggle(open);
            };
            const toggle = () => setOpen(body.style.display === 'none');
            head.addEventListener('click', toggle);
            head.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });
            return { toggle, setOpen };
        },

        /* 준비 상태 체크리스트(성과 스캔 · 방장 봇 공용): [{ ready, name, html }] */
        renderCheckList(el, items) {
            if (!el) return;
            el.innerHTML = items.map(item =>
                `<li><span class="${item.ready ? 'ok' : 'no'}">●</span>`
                + `<span class="scan-check-name">${escapeHtml(item.name)}</span>`
                + `<div class="scan-check-desc">${item.html}</div></li>`
            ).join('');
        },

        /* 도움말 탭의 특정 섹션으로 이동하고 한 번 반짝인다 */
        scrollToHelpSection(id) {
            const el = id && document.getElementById(id);
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.remove('help-flash');
            void el.offsetWidth;
            el.classList.add('help-flash');
        },

        jumpToHelp(id) {
            if (global.VMH?.Tabs) global.VMH.Tabs.show('help');
            requestAnimationFrame(() => UI.scrollToHelpSection(id));
        }
    };

    global.VMH = global.VMH || {};
    global.VMH.escapeHtml = escapeHtml;
    global.VMH.Storage = Storage;
    global.VMH.UI = UI;
    // 두 앱 모두 escapeHtml(...)로 바로 부르던 이름이라 전역에도 둔다
    global.escapeHtml = escapeHtml;
})(window);
