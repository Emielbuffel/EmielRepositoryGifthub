// Financial planning maths: projections with monthly contributions, Monte Carlo odds of reaching targets,
// withdrawals, loan balances, and the family-wealth framework (asset classes and preset targets, rebalancing bands,
// illiquidity budget, margin stress), as in the household endowment method used in earlier work.

/** Future value with monthly compounding: start, annual return r, monthly contribution c, months n. */
export function fv(start, r, c, n) {
  const i = Math.pow(1 + r, 1 / 12) - 1;
  if (Math.abs(i) < 1e-12) return start + c * n;
  const g = Math.pow(1 + i, n);
  return start * g + c * (g - 1) / i;
}
/** Year-by-year path: [{y, nominal, real}] for years 0..years. */
export function path(start, r, c, years, infl = 0.02) {
  return Array.from({ length: years + 1 }, (_, y) => { const v = fv(start, r, c, y * 12); return { y, nominal: v, real: v / Math.pow(1 + infl, y) }; });
}
/** Monthly contribution needed to reach target in `years`. */
export function requiredMonthly(start, r, target, years) {
  const n = years * 12, i = Math.pow(1 + r, 1 / 12) - 1, g = Math.pow(1 + i, n);
  const need = target - start * g;
  return need <= 0 ? 0 : Math.abs(i) < 1e-12 ? need / n : need * i / (g - 1);
}
/** Annual return needed to reach target (bisection between −20% and +40%), or null. */
export function requiredReturn(start, c, target, years) {
  let lo = -0.2, hi = 0.4; if (fv(start, hi, c, years * 12) < target) return null; if (fv(start, lo, c, years * 12) >= target) return lo;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (fv(start, m, c, years * 12) >= target) hi = m; else lo = m; }
  return hi;
}

/** Small, fast pseudo-random generator (repeatable results). */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
/**
 * Monte Carlo of yearly returns (normal on log returns with the given mean and volatility), monthly contributions
 * added through the year. Returns percentiles per year {p10, p50, p90} and P(value ≥ target) for each target.
 */
export function monteCarlo(start, mu, sigma, c, years, { n = 3000, targets = [], seed = 7 } = {}) {
  const R = rng(seed), norm = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const m = Math.log(1 + mu) - sigma * sigma / 2, cols = Array.from({ length: years + 1 }, () => new Float64Array(n));
  for (let k = 0; k < n; k++) {
    let v = start; cols[0][k] = v;
    for (let y = 1; y <= years; y++) { const g = Math.exp(m + sigma * norm()); v = v * g + c * 12 * (1 + (g - 1) / 2); cols[y][k] = v; }
  }
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const bands = cols.map((a, y) => { const s = Float64Array.from(a).sort(); return { y, p10: pct(s, 0.1), p50: pct(s, 0.5), p90: pct(s, 0.9) }; });
  const odds = targets.map(({ years: ty, value }) => { if (ty > years) return null; let hit = 0; for (const v of cols[ty]) if (v >= value) hit++; return hit / n; });
  return { bands, odds };
}

/** What a capital can pay out per year: the classic 4% rule and a "keeps its real value forever" amount. */
export function withdrawals(capital, r, infl) {
  return { rule4: capital * 0.04, perpetual: Math.max(0, capital * (r - infl)), rule3: capital * 0.035 };
}

/** Outstanding balance of an annuity loan after k monthly payments (original capital P, annual rate, payment M). */
export function loanBalance(P, rate, M, k) {
  const i = rate / 12; if (!i) return Math.max(0, P - M * k);
  const g = Math.pow(1 + i, k); return Math.max(0, P * g - M * (g - 1) / i);
}
/** Months until a loan is repaid at the current payment (null if the payment doesn't cover the interest). */
export function monthsLeft(balance, rate, M) {
  const i = rate / 12; if (!(M > 0)) return null; if (!i) return Math.ceil(balance / M);
  if (M <= balance * i) return null; return Math.ceil(-Math.log(1 - balance * i / M) / Math.log(1 + i));
}

/* ---------- family-wealth framework (endowment method for a household) ---------- */
export const CLASSES = [
  { k: 'eq', name: 'Public equity', tier: 2 },
  { k: 'fi', name: 'Bonds & cash', tier: 1 },
  { k: 'pe', name: 'Private equity & VC', tier: 3 },
  { k: 'ra', name: 'Real assets (gold, commodities, infrastructure)', tier: 1 },
  { k: 'hf', name: 'Hedge funds / alternatives', tier: 2 },
  { k: 're', name: 'Real estate', tier: 3 },
];
export const PRESETS = {
  preserve: { name: 'Multi-generation preservation', t: { eq: 50, fi: 20, pe: 5, ra: 8, hf: 2, re: 15 } },
  harvard: { name: 'Harvard-tilted', t: { eq: 30, fi: 8, pe: 25, ra: 12, hf: 15, re: 10 } },
  yale: { name: 'Yale-tilted', t: { eq: 15, fi: 5, pe: 30, ra: 10, hf: 25, re: 15 } },
};
/** Drift vs target; a breach when |drift| > max(5 points, 25% of the target). */
export function drift(weights, targets, { abs = 5, rel = 0.25 } = {}) {
  return CLASSES.map(c => { const w = (weights[c.k] || 0) * 100, t = targets[c.k] || 0, d = w - t; return { ...c, w, t, d, breach: Math.abs(d) > Math.max(abs, rel * t) }; });
}
/** Illiquidity budget: safe reserve needed vs held, and room for illiquid assets (default cap 35% of net worth). */
export function illiquidity({ netWorth, safe, illiquid, monthlyOut, reserveMonths = 18, cap = 0.35 }) {
  const need = reserveMonths * monthlyOut, capacity = cap * netWorth;
  return { need, safe, gap: need - safe, capacity, illiquid, headroom: capacity - illiquid, verdict: safe < need ? 'liquidity' : illiquid > capacity ? 'illiquidity' : 'ok' };
}
/** Margin loan-to-value after equity falls of 0, 15, 30, 45 and 60%. */
export function marginStress(margin, equityGross) {
  return [0, -0.15, -0.3, -0.45, -0.6].map(s => { const ltv = equityGross > 0 ? margin / (equityGross * (1 + s)) : null; return { s, ltv, status: ltv == null ? '' : ltv < 0.5 ? 'comfortable' : ltv < 0.7 ? 'watch' : 'likely margin call' }; });
}

/** Rounded long-run historical figures per asset class (editable in the app). Real = after inflation. */
export const ASSETS = [
  { k: 'eq', name: 'World equities', real: 5.0, vol: 17, corr: 1.0, liquid: 'daily', infl: 'over long periods', role: 'growth engine' },
  { k: 'fi', name: 'Government bonds', real: 1.7, vol: 9, corr: 0.2, liquid: 'daily', infl: 'weak', role: 'ballast in recessions, income' },
  { k: 'cash', name: 'Cash / money market', real: 0.8, vol: 1, corr: 0.0, liquid: 'immediate', infl: 'partial', role: 'safety reserve, dry powder' },
  { k: 'gold', name: 'Gold', real: 1.0, vol: 16, corr: 0.1, liquid: 'daily', infl: 'good over decades', role: 'crisis hedge, diversifier' },
  { k: 're', name: 'Housing (direct)', real: 1.4, vol: 8, corr: 0.4, liquid: 'months', infl: 'good', role: 'rent income, leverage, inflation hedge' },
  { k: 'reit', name: 'Listed real estate (REITs)', real: 4.0, vol: 20, corr: 0.7, liquid: 'daily', infl: 'good', role: 'real-estate exposure without a mortgage' },
  { k: 'pe', name: 'Private equity', real: 6.0, vol: 25, corr: 0.8, liquid: 'years', infl: 'like equities', role: 'illiquidity premium (if available to you)' },
];
