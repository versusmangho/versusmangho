/* 두 앱이 같이 쓰는 잡동사니. 가장 먼저 읽힌다. */
(function (global) {
    'use strict';

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    /* 잠깐 보였다 사라지는 안내 문구 */
    function showInlineMsg(el, text) {
        if (!el) return;
        el.textContent = text;
        el.style.display = "block";
        clearTimeout(el.__hideTimer);
        el.__hideTimer = setTimeout(() => { el.style.display = "none"; }, 1500);
    }

    function fallbackCopyText(text) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.className = "offscreen";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch { /* fallback, ignore */ }
        document.body.removeChild(ta);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
        }
        // file:// 로 열었거나 일부 환경에서 권한 문제 시 대비
        fallbackCopyText(text);
        return Promise.resolve();
    }

    global.VMH = global.VMH || {};
    global.VMH.escapeHtml = escapeHtml;
    // 두 앱 모두 escapeHtml(...)로 바로 부르던 이름이라 전역에도 둔다
    global.escapeHtml = escapeHtml;
    global.VMH.copyToClipboard = copyToClipboard;
    global.VMH.showInlineMsg = showInlineMsg;
    global.copyToClipboard = copyToClipboard;
    global.showInlineMsg = showInlineMsg;
})(window);
