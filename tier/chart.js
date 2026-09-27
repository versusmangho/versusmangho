/* 티어별 난이도 탭 — 표 그리기와 공지 문구 복사.
   표는 아래 TIER_DIFFICULTY 하나에서 그려진다 (복사·표시는 lib/util.js의 copyToClipboard·showInlineMsg). */

/**
 * =========================================================================
 * [버망호 공유용 복사 기능]
 * 티어 난이도 문구 복사: "(티어명)(티어 등급): 패드 n1~n2레벨, 스시 n3~n4레벨"
 * - 패드: NM/HD/MX, 스시: SC
 * =========================================================================
 */

const TIER_DIFFICULTY = [
  { tier: "GRAND MASTER", div: "",   pad: null,      sc: [10, 15] },
  { tier: "MASTER",       div: "",   pad: null,      sc: [8, 15] },

  { tier: "DIAMOND",      div: "I",  pad: null,      sc: [8, 15] },
  { tier: "DIAMOND",      div: "II", pad: [15, 15],  sc: [8, 15] },
  { tier: "DIAMOND",      div: "III",pad: [15, 15],  sc: [8, 15] },
  { tier: "DIAMOND",      div: "IV", pad: [15, 15],  sc: [6, 11] },

  { tier: "PLATINUM",     div: "I",  pad: [14, 15],  sc: [6, 9] },
  { tier: "PLATINUM",     div: "II", pad: [13, 15],  sc: [4, 9] },
  { tier: "PLATINUM",     div: "III",pad: [13, 15],  sc: [4, 7] },
  { tier: "PLATINUM",     div: "IV", pad: [12, 15],  sc: [2, 7] },

  { tier: "GOLD",         div: "I",  pad: [12, 14],  sc: [2, 7] },
  { tier: "GOLD",         div: "II", pad: [11, 13],  sc: [1, 5] },
  { tier: "GOLD",         div: "III",pad: [11, 13],  sc: [1, 5] },
  { tier: "GOLD",         div: "IV", pad: [10, 12],  sc: [1, 3] },

  { tier: "SILVER",       div: "I",  pad: [9, 12],   sc: [1, 3] },
  { tier: "SILVER",       div: "II", pad: [8, 11],   sc: [1, 1] },
  { tier: "SILVER",       div: "III",pad: [7, 11],   sc: [1, 1] },
  { tier: "SILVER",       div: "IV", pad: [7, 11],   sc: [1, 1] },

  { tier: "BRONZE",       div: "I",  pad: [7, 11],   sc: [1, 1] },
  { tier: "BRONZE",       div: "II", pad: [7, 10],   sc: null },
  { tier: "BRONZE",       div: "III",pad: [7, 10],   sc: null },
  { tier: "BRONZE",       div: "IV", pad: [6, 10],   sc: null },

  { tier: "IRON",         div: "I",  pad: [5, 9],    sc: null },
  { tier: "IRON",         div: "II", pad: [4, 8],    sc: null },
  { tier: "IRON",         div: "III",pad: [3, 7],    sc: null },
  { tier: "IRON",         div: "IV", pad: [1, 6],    sc: null },
];


function formatTierCopyText(x) {
  const head = x.div ? `${x.tier}(${x.div})` : x.tier;

  // Defensive formatting: allow null / undefined / malformed ranges
  const fmtRange = (label, range) => {
    if (!Array.isArray(range) || range.length < 2) return `${label} -`;
    const a = range[0], b = range[1];
    if (a == null || b == null) return `${label} -`;
    return (a === b) ? `${label} ${a}레벨` : `${label} ${a}~${b}레벨`;
  };

  const padText = fmtRange("패드", x.pad);
  const sushiText = fmtRange("스시", x.sc);

  return `${head}: ${padText}, ${sushiText}`;
}

/* ── 티어별 난이도 표 ─────────────────
   위의 TIER_DIFFICULTY 한 벌에서 막대까지 함께 그린다.

   패드(NM·HD·MX)와 스시(SC)는 난이도 체계가 달라서 같은 자로 재야 비교가 된다.
   버망호에서 쓰는 환산 기준은 패드 12 = 스시 2, 13 = 4, 14 = 6, 15 = 8 —
   즉 패드 한 칸이 스시 두 칸이고, 스시는 패드 11 자리에서 시작한다.
   그래서 가로축은 '패드 한 칸'을 단위로 삼고 두 막대를 같은 축 위에 겹쳐 놓는다.
   (스시 9~15는 패드에 대응이 없어서 축 오른쪽 끝으로 삐져나간다 — 빗금 친 구간)

   · 칸을 누르면 방 공지에 붙여넣을 문구가 복사된다
   · 하위 등급(I~IV)은 기본으로 펼쳐져 있고, 티어 이름을 누르면 접을 수 있다 */
const TIER_LEVEL_MAX = 15;      // 패드·스시 모두 15레벨까지
const TIER_SC_ORIGIN = 11;      // 스시 0레벨 자리 = 패드 11 끝 (그래서 스시 2가 패드 12와 같은 자리)

const tierPadX = (lv) => lv;                              // 패드 lv칸의 오른쪽 끝
const tierScX = (lv) => TIER_SC_ORIGIN + lv / 2;          // 스시 lv칸의 오른쪽 끝
const TIER_X_MAX = tierScX(TIER_LEVEL_MAX);               // 축 전체 길이 (= 18.5)
const tierPct = (x) => (x / TIER_X_MAX) * 100;
const tierAxisX = (kind, lv) => (kind === 'pad' ? tierPadX(lv) : tierScX(lv));

// 같은 티어끼리 묶는다 (DIAMOND I~IV → DIAMOND 한 묶음)
function tierGroups() {
  const out = [];
  TIER_DIFFICULTY.forEach((x, idx) => {
    const last = out[out.length - 1];
    if (last && last.tier === x.tier) last.items.push({ x, idx });
    else out.push({ tier: x.tier, items: [{ x, idx }] });
  });
  return out;
}

// 접힌 티어의 막대 = 하위 등급을 전부 아우르는 범위
function tierUnionRange(items, key) {
  const rs = items.map(it => it.x[key]).filter(r => Array.isArray(r) && r.length >= 2 && r[0] != null);
  if (!rs.length) return null;
  return [Math.min(...rs.map(r => r[0])), Math.max(...rs.map(r => r[1]))];
}

/* 그 난이도 체계에 자리가 없는 구간(패드는 12 위쪽 절반, 스시는 패드 11 아래쪽)을 빗금으로 덮는다 */
function tierOutOfBoundsHtml(kind) {
  return kind === 'pad'
    ? `<div class="tier-oob" style="left:${tierPct(TIER_LEVEL_MAX)}%;right:0"></div>`
    : `<div class="tier-oob" style="left:0;width:${tierPct(TIER_SC_ORIGIN)}%"></div>`;
}

function tierBarHtml(kind, label, range) {
  const head = `<span class="tier-bar-kind">${label}</span>`;
  const oob = tierOutOfBoundsHtml(kind);
  if (!Array.isArray(range) || range.length < 2 || range[0] == null) {
    return `<div class="tier-bar">${head}<div class="tier-track">${oob}<span class="tier-none">해당 없음</span></div></div>`;
  }
  const a = range[0], b = range[1];
  const left = tierPct(tierAxisX(kind, a - 1));
  const width = tierPct(tierAxisX(kind, b)) - left;
  const text = (a === b) ? `${a}` : `${a}~${b}`;
  return `<div class="tier-bar">${head}<div class="tier-track">${oob}` +
         `<div class="tier-fill ${kind}" style="left:${left}%;width:${width}%"><span>${text}</span></div>` +
         `</div></div>`;
}

function tierRowHtml(o) {
  const copyable = (o.idx != null);
  const attr = copyable ? `data-tier-idx="${o.idx}"` : 'data-tier-toggle="1" aria-expanded="true"';
  const title = copyable ? ' title="클릭하면 복사됩니다"' : ' title="클릭하면 하위 등급이 접힙니다"';
  return `<div class="tier-row ${o.cls}" ${attr} role="button" tabindex="0"${title}>` +
           `<div class="tier-name"><span class="tier-icon">${o.icon}</span><span>${escapeHtml(o.name)}</span></div>` +
           `<div class="tier-bars">${tierBarHtml('pad', '패드', o.pad)}${tierBarHtml('sc', '스시', o.sc)}</div>` +
         `</div>`;
}

// 눈금 한 줄. 패드는 한 칸, 스시는 반 칸 간격이라 각 칸 가운데에 숫자를 얹는다
function tierTicksHtml(kind) {
  let out = '';
  for (let n = 1; n <= TIER_LEVEL_MAX; n++) {
    const center = (tierAxisX(kind, n - 1) + tierAxisX(kind, n)) / 2;
    // 좁은 화면에서는 한 칸씩(아주 좁으면 네 칸마다) 걸러 숨긴다
    const parity = ((n % 2 === 1) ? ' t-odd' : ' t-even') + (n % 4 === 0 ? ' t-q4' : '');
    out += `<span class="tier-tick${parity}" style="left:${tierPct(center)}%">${n}</span>`;
  }
  return out;
}

function renderTierChart() {
  const host = document.getElementById('tier-chart');
  if (!host) return;

  // 눈금도 막대와 같은 격자(.tier-row > .tier-bar)를 그대로 써야 자리가 맞는다
  const axisBar = (kind, label) =>
    `<div class="tier-bar"><span class="tier-bar-kind">${label}</span><div class="tier-ticks ${kind}">${tierTicksHtml(kind)}</div></div>`;
  const scale = `<div class="tier-row tier-scale"><div class="tier-name tier-scale-label">레벨</div>` +
                `<div class="tier-bars">${axisBar('pad', '패드')}${axisBar('sc', '스시')}</div></div>`;

  const groups = tierGroups().map(g => {
    // GRAND MASTER·MASTER처럼 하위 등급이 없는 티어는 제목 줄이 곧 복사 대상
    const solo = g.items.length === 1 && !g.items[0].x.div;
    const head = solo
      ? tierRowHtml({ cls: 'tier-head', idx: g.items[0].idx, name: g.tier, pad: g.items[0].x.pad, sc: g.items[0].x.sc, icon: '📋' })
      : tierRowHtml({ cls: 'tier-head', name: g.tier, pad: tierUnionRange(g.items, 'pad'), sc: tierUnionRange(g.items, 'sc'), icon: '▼' });
    const subs = solo ? '' :
      `<div class="tier-subs">` +
        g.items.map(it => tierRowHtml({ cls: 'tier-sub', idx: it.idx, name: g.tier + ' ' + it.x.div, pad: it.x.pad, sc: it.x.sc, icon: '📋' })).join('') +
      `</div>`;
    return `<div class="tier-group" data-tier="${escapeHtml(g.tier)}">${head}${subs}</div>`;
  }).join('');

  host.innerHTML = scale + groups;
}

function setTierGroupOpen(headRow, open) {
  const subs = headRow.parentElement.querySelector('.tier-subs');
  if (!subs) return;
  subs.hidden = !open;
  headRow.setAttribute('aria-expanded', open ? 'true' : 'false');
  headRow.classList.toggle('open', open);
  headRow.title = open ? '클릭하면 하위 등급이 접힙니다' : '클릭하면 하위 등급이 펼쳐집니다';
  const icon = headRow.querySelector('.tier-icon');
  if (icon) icon.textContent = open ? '▼' : '▶';
}

function initTierUI() {
  const host = document.getElementById('tier-chart');
  const msg = document.getElementById('tier-copy-msg');
  const expandBtn = document.getElementById('tier-expand-btn');
  if (!host) return;

  renderTierChart();

  const activate = (row) => {
    if (row.dataset.tierToggle) {
      setTierGroupOpen(row, row.getAttribute('aria-expanded') !== 'true');
      syncExpandBtn();
      return;
    }
    const x = TIER_DIFFICULTY[parseInt(row.dataset.tierIdx, 10)];
    if (!x) return;
    const text = formatTierCopyText(x);
    copyToClipboard(text).then(() => {
      showInlineMsg(msg, '복사됨 — ' + text);
      row.classList.remove('copied');
      void row.offsetWidth;
      row.classList.add('copied');
    });
  };

  host.addEventListener('click', (e) => {
    const row = e.target.closest('.tier-row');
    if (row) activate(row);
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.tier-row');
    if (!row) return;
    e.preventDefault();
    activate(row);
  });

  function syncExpandBtn() {
    if (!expandBtn) return;
    const heads = [...host.querySelectorAll('.tier-row[data-tier-toggle]')];
    const allOpen = heads.length > 0 && heads.every(h => h.getAttribute('aria-expanded') === 'true');
    expandBtn.setAttribute('aria-pressed', allOpen ? 'true' : 'false');
    expandBtn.textContent = allOpen ? '－ 모두 접기' : '＋ 모두 펼치기';
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      const open = expandBtn.getAttribute('aria-pressed') !== 'true';
      host.querySelectorAll('.tier-row[data-tier-toggle]').forEach(h => setTierGroupOpen(h, open));
      syncExpandBtn();
    });
  }
  syncExpandBtn();
}

initTierUI();
