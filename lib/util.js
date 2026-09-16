/* 두 앱이 같이 쓰는 잡동사니. 가장 먼저 읽힌다. */
(function (global) {
    'use strict';

    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));

    global.VMH = global.VMH || {};
    global.VMH.escapeHtml = escapeHtml;
    // 두 앱 모두 escapeHtml(...)로 바로 부르던 이름이라 전역에도 둔다
    global.escapeHtml = escapeHtml;
})(window);
