/* 매칭 탭 — 가중치(우선순위 점수) 계산과 정렬. 화면은 건드리지 않는다. */

// 경험자(1판 이상 & 비보류) 중 최고 가중치. 신입을 "진짜 상위 우선"으로 올리기 위한 기준선.
let maxScoreOfWaiters = null; // null = 경험자 없음

/* ── 가중치 비중 (옵션 탭의 가중치 편집기) ─────────────────
   기본값이 원래 공식이다: 현재 대기 + 평균 대기 − 원디골 비율 × 0.5 + 0.5.
   방 상태(room)가 아니라 설정이므로 실행 취소·전체 초기화와 무관하게 따로 저장한다. */
const SCORE_WEIGHTS_KEY = 'scoreWeightsV1';
const SCORE_WEIGHT_DEFS = [
    { key: 'cur',       name: '현재 대기',       unit: '×',  min: 0, max: 3,  step: 0.1,  def: 1 },
    { key: 'avg',       name: '평균 대기',       unit: '×',  min: 0, max: 3,  step: 0.1,  def: 1 },
    { key: 'sel',       name: '원디골 비율',     unit: '×',  min: 0, max: 2,  step: 0.05, def: 0.5 },
    // 신입 우선권: 경험자 최고점보다 확실히 위로 올리는 여유분
    { key: 'newcomer',  name: '신입 가산점',     unit: '+',  min: 0, max: 5,  step: 0.5,  def: 1 },
    // 세이프가드: 현재 대기가 이 값 이상이면 "장기 대기(긴급)"로 보고 최상위 강제.
    // 정렬·행 색상·팝업·문구가 모두 이 값을 쓴다
    { key: 'safeguard', name: '세이프가드 기준', unit: '판', min: 2, max: 10, step: 1,    def: 4 }
];
const scoreWeights = {};

// 범위 안으로 자르고 눈금(step)에 맞춘다. 숫자가 아니면 기본값
function clampWeight(def, v) {
    v = Number(v);
    if (!Number.isFinite(v)) return def.def;
    v = Math.min(def.max, Math.max(def.min, v));
    return +(Math.round(v / def.step) * def.step).toFixed(2);
}
function setScoreWeights(obj) {
    SCORE_WEIGHT_DEFS.forEach(d => { scoreWeights[d.key] = clampWeight(d, obj && d.key in obj ? obj[d.key] : d.def); });
}
function saveScoreWeights() { SafeStorage.setItem(SCORE_WEIGHTS_KEY, JSON.stringify(scoreWeights)); }
(function loadScoreWeights() {
    let saved = null;
    try { saved = JSON.parse(SafeStorage.getItem(SCORE_WEIGHTS_KEY) || 'null'); } catch { /* 깨진 값은 기본값으로 */ }
    setScoreWeights(saved);
})();
const safeguardThreshold = () => scoreWeights.safeguard;

/* 가중치 기준선. 원디골 페널티(최대 −원디골 비중) 때문에 방금 친 원디골 전담이 음수로 내려가
   "가중치 -0.5"처럼 보이던 것을 그만큼 올려, 가장 낮은 가중치가 0이 되게 한다.
   모든 계산 경로에 똑같이 더하므로 순위는 달라지지 않는다. */
const scoreBase = () => scoreWeights.sel;

const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// 경험자(matchCount>0) 점수 계산식. updateAverageWaitersStat과 calculateScore가 공유.
function experiencedScore(p) {
    const real_W_curr = room.round - (p.lastPlay || 0);
    const W_avg = round2(((p.waitSum || 0) + real_W_curr) / ((p.matchCount || 0) + 1));
    const R_sel = round2((p.chooserCount || 0) / p.matchCount);
    return scoreWeights.cur * real_W_curr + scoreWeights.avg * W_avg - scoreWeights.sel * R_sel + scoreBase();
}

function updateAverageWaitersStat() {
    if (!room || !room.players) return;
    // [FIX] 보류(onHold) 플레이어는 대기 모수에서 제외 — lastPlay가 고정되어 W_curr가
    // 계속 커지므로 기준선을 왜곡함.
    const experiencedPlayers = room.players.filter(p => p.matchCount > 0 && !p.onHold);
    if (experiencedPlayers.length > 0) {
        maxScoreOfWaiters = Math.max(...experiencedPlayers.map(experiencedScore));
    } else {
        maxScoreOfWaiters = null;
    }
}

function calculateScore(p) {
    const newbieBoostOn = document.getElementById("newcomer-toggle")?.checked ?? true;
    // 보류 중에는 보류 시작 라운드(holdStart)를 기준으로 대기를 고정 표시한다.
    // 복귀 시 lastPlay가 보류 기간만큼 보정되므로 복귀 후 값(holdStart - lastPlay)과 일치.
    const effRound = (p.onHold && p.holdStart != null) ? p.holdStart : room.round;
    const real_W_curr = effRound - (p.lastPlay || 0);
    let W_avg = 0;
    let R_sel = (p.matchCount > 0) ? round2(p.chooserCount / p.matchCount) : 0;
    let score;

    if (p.matchCount > 0) {
        // 옵션 B: "현재 대기"를 평균에 포함하는 실시간 평균 대기 계산
        const pastWaitSum = p.waitSum || 0;
        const pastMatchCount = p.matchCount || 0;

        const totalWait = pastWaitSum + real_W_curr;
        const totalPeriods = pastMatchCount + 1;

        W_avg = round2(totalWait / totalPeriods);

        // experiencedScore와 같은 식 (비중은 가중치 편집기에서)
        score = scoreWeights.cur * real_W_curr + scoreWeights.avg * W_avg - scoreWeights.sel * R_sel + scoreBase();
    } else { // 신입 (New player)
        // 신입은 현재 대기를 평균 대기로 표시.
        W_avg = real_W_curr;

        if (newbieBoostOn && maxScoreOfWaiters !== null) {
            // [진짜 상위 우선] 경험자 최고 가중치보다 확실히 위로 올림.
            // 본인 현재 대기(real_W_curr)를 더해, 합류가 빠른 신입이 더 위에 오도록.
            // (원디골 페널티는 칠 이력이 없는 신입에겐 적용하지 않음.)
            score = round2(maxScoreOfWaiters + scoreWeights.newcomer + real_W_curr);
        } else {
            // 경험자가 없거나(모두 신입) 부스트 off → 본인 현재 대기로 신입끼리 비교.
            // (maxScoreOfWaiters를 쓰는 위쪽 가지는 이미 기준선이 들어간 값이라 여기서만 더한다)
            score = scoreWeights.cur * real_W_curr + scoreBase();
        }
    }
    return { score, W_avg, R_sel, T_in: p.joinOrder || 0, W_curr: real_W_curr };
}

function getSortValue(p, key) {
    const stats = calculateScore(p);
    switch(key) {
        case 'nickname': return p.nickname;
        case 'chooserCount': return p.chooserCount || 0;
        case 'w_curr': return stats.W_curr;
        case 'w_avg': return stats.W_avg;
        case 'priority': return stats.score;
        default: return 0;
    }
}

function getSortedPlayers(sortConfig) {
    const safeguardOn = document.getElementById("safeguard-toggle")?.checked ?? false;
    
    return [...room.players].sort((a, b) => {
        if (a.onHold !== b.onHold) return a.onHold ? 1 : -1;

        if (safeguardOn) {
            const waitA = getSortValue(a, 'w_curr');
            const waitB = getSortValue(b, 'w_curr');
            const isUrgentA = waitA >= safeguardThreshold();
            const isUrgentB = waitB >= safeguardThreshold();
            if (isUrgentA !== isUrgentB) return isUrgentA ? -1 : 1;
            if (isUrgentA && isUrgentB) {
                if (waitA !== waitB) return waitB - waitA;
                const rSelA = (a.matchCount > 0) ? round2(a.chooserCount / a.matchCount) : 0;
                const rSelB = (b.matchCount > 0) ? round2(b.chooserCount / b.matchCount) : 0;
                if (rSelA !== rSelB) return rSelA - rSelB;
                return (a.joinOrder || 0) - (b.joinOrder || 0); // 결정적 정렬
            }
        }

        const valA = getSortValue(a, sortConfig.key);
        const valB = getSortValue(b, sortConfig.key);

        let comparison = 0;
        if (typeof valA === 'string') {
            comparison = valA.localeCompare(valB); // Asc
        } else {
            comparison = valA - valB; // Asc
        }
        if (sortConfig.order === 'desc') {
            comparison *= -1;
        }
        
        if (comparison === 0) {
             const scoreA = calculateScore(a).score;
             const scoreB = calculateScore(b).score;
             if (scoreB !== scoreA) return scoreB - scoreA;
             return (a.joinOrder || 0) - (b.joinOrder || 0);
        }
        return comparison;
    });
}
