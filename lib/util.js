/* 여러 탭이 같이 쓰는 잡동사니. 가장 먼저 읽힌다. */
(function (global) {
    'use strict';

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    /* 화면 아래에 잠깐 뜨는 알림. 결과 문구가 긴 카드 아래쪽에 찍혀 못 보는 일이 없게 모든 탭이 같이 쓴다.
       opts: { tone: 'ok' | 'warn' | 'error', html: true(text를 HTML로 — 호출부가 escape 책임),
               action: { label, run } (예: 실행 취소), ms: 떠 있는 시간 } */
    let toastTimer = null;
    function hideToast() {
        const el = document.getElementById('vmh-toast');
        if (el) el.classList.remove('show');
    }
    function toast(text, opts) {
        opts = opts || {};
        let el = document.getElementById('vmh-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'vmh-toast';
            el.className = 'toast';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        el.innerHTML = '';
        const msg = document.createElement('span');
        msg.className = 'toast-msg';
        if (opts.html) msg.innerHTML = text; else msg.textContent = text;
        el.appendChild(msg);
        if (opts.action) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'toast-action';
            b.textContent = opts.action.label;
            b.addEventListener('click', () => { hideToast(); opts.action.run(); });
            el.appendChild(b);
        }
        el.dataset.tone = opts.tone || 'ok';
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, opts.ms || (opts.action ? 5000 : 2500));
    }

    global.VMH = global.VMH || {};
    global.VMH.escapeHtml = escapeHtml;
    global.VMH.toast = toast;
    // 두 앱 모두 escapeHtml(...)로 바로 부르던 이름이라 전역에도 둔다
    global.escapeHtml = escapeHtml;
})(window);
