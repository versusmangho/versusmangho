/* 도움말로 보내기 — 어느 탭에서든 data-goto-help / data-help-go 링크를 도움말 탭의 해당 절로 데려간다. */

/* ── 도움말로 보내기 ─────────────────
   설명은 전부 도움말 탭에 모여 있다. 다른 탭의 '도움말' 버튼(data-goto-help)과
   도움말 탭 맨 위의 목차(data-help-go)가 같은 자리로 데려간다. */
function scrollToHelpSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('help-flash');
    void el.offsetWidth;   // 같은 곳을 다시 눌러도 반짝이도록 애니메이션을 되감는다
    el.classList.add('help-flash');
}

document.addEventListener('click', (e) => {
    const inHelp = e.target.closest('[data-help-go]');
    if (inHelp) { scrollToHelpSection(inHelp.dataset.helpGo); return; }

    const toHelp = e.target.closest('[data-goto-help]');
    if (toHelp) {
        VMH.Tabs.show('help');
        // 탭이 보이게 된 다음에 움직여야 자리가 제대로 잡힌다
        requestAnimationFrame(() => scrollToHelpSection(toHelp.dataset.gotoHelp));
    }
});
