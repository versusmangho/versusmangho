/* 옵션 탭 — 가중치 편집기와 세이프가드 기준 문구. 값과 계산은 match/score.js에 있다. */

// 도움말·옵션 문구에 세이프가드 임계값 주입(단일 출처 — 가중치 편집기에서 바꾸면 다시 부른다)
function syncSafeguardText() {
    document.querySelectorAll('.safeguard-threshold').forEach(el => { el.textContent = safeguardThreshold(); });
}
syncSafeguardText();

/* ── 가중치 편집기 (옵션 탭) ─────────────────
   항목마다 슬라이더 + 숫자 칸. 바꾸는 즉시 저장하고 표·팝업을 다시 그린다 */
(function initWeightEditor() {
    const host = document.getElementById('weight-editor');
    const formula = document.getElementById('weight-formula');
    const resetBtn = document.getElementById('weight-reset-btn');
    const msg = document.getElementById('weight-msg');
    if (!host) return;

    const fmt = (v) => String(+v.toFixed(2));
    host.innerHTML = SCORE_WEIGHT_DEFS.map(d => {
        const pre = d.unit === '판' ? '' : `<span class="weight-unit">${d.unit}</span>`;
        const post = d.unit === '판' ? '<span class="weight-unit">판</span>' : '';
        return `<div class="weight-row" data-key="${d.key}">
          <label class="weight-name" for="w-num-${d.key}">${d.name}</label>
          <input type="range" class="weight-range" min="${d.min}" max="${d.max}" step="${d.step}" aria-label="${d.name}">
          <span class="weight-num-wrap">${pre}<input type="number" id="w-num-${d.key}" class="weight-num" min="${d.min}" max="${d.max}" step="${d.step}">${post}</span>
          <span class="weight-def">기본 ${fmt(d.def)}</span>
        </div>`;
    }).join('');

    function render() {
        const w = scoreWeights;
        SCORE_WEIGHT_DEFS.forEach(d => {
            const row = host.querySelector(`[data-key="${d.key}"]`);
            row.querySelector('.weight-range').value = w[d.key];
            const num = row.querySelector('.weight-num');
            if (document.activeElement !== num) num.value = fmt(w[d.key]);
            row.classList.toggle('changed', w[d.key] !== d.def);
        });
        if (formula) {
            formula.innerHTML =
                `가중치 = <b>${fmt(w.cur)}</b> × 현재 대기 + <b>${fmt(w.avg)}</b> × 평균 대기 − <b>${fmt(w.sel)}</b> × 원디골 비율 + ${fmt(scoreBase())}`;
        }
        if (resetBtn) resetBtn.disabled = SCORE_WEIGHT_DEFS.every(d => w[d.key] === d.def);
    }

    function changed() {
        saveScoreWeights();
        syncSafeguardText();
        render();
        refreshUI();
    }

    function apply(key, raw) {
        const d = SCORE_WEIGHT_DEFS.find(x => x.key === key);
        const v = clampWeight(d, raw);
        if (v === scoreWeights[key]) { render(); return; }
        scoreWeights[key] = v;
        changed();
    }

    host.addEventListener('input', (e) => {
        const row = e.target.closest('.weight-row');
        if (!row) return;
        // 숫자 칸은 입력하는 도중(빈 칸 등)엔 값을 되돌려 쓰지 않는다 — 다 치고 나가면 change에서 정리
        if (e.target.classList.contains('weight-range')) apply(row.dataset.key, e.target.value);
        else if (e.target.value !== '') apply(row.dataset.key, e.target.value);
    });
    host.addEventListener('change', (e) => {
        const row = e.target.closest('.weight-row');
        if (!row || !e.target.classList.contains('weight-num')) return;
        apply(row.dataset.key, e.target.value);
        e.target.value = fmt(scoreWeights[row.dataset.key]);
    });

    if (resetBtn) resetBtn.onclick = () => {
        setScoreWeights(null);
        changed();
        showInlineMsg(msg, '기본값(원래 공식)으로 돌렸습니다');
    };
    render();
})();
