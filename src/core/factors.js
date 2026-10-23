// Factor analysis of the stocks in the portfolio.
//  - regression: weekly portfolio returns (today's weights) explained by factor returns built from ETFs:
//    Market (SPY), Size (IWM − SPY), Value (VTV − VUG), Momentum (MTUM − SPY), Quality (QUAL − SPY),
//    Low volatility (USMV − SPY). The loadings show which styles drive the portfolio.
//  - characteristics: value-weighted averages of each holding's beta, volatility, momentum and earnings growth.

export const FACTOR_ETFS = ['SPY', 'IWM', 'VTV', 'VUG', 'MTUM', 'QUAL', 'USMV'];
export const FACTORS = [
  ['Market', s => s.SPY, 'Moves with the stock market (1 = like the S&P 500).'],
  ['Size', s => s.IWM - s.SPY, 'Positive = behaves like small caps; negative = large caps.'],
  ['Value', s => s.VTV - s.VUG, 'Positive = value stocks; negative = growth stocks.'],
  ['Momentum', s => s.MTUM - s.SPY, 'Positive = recent winners.'],
  ['Quality', s => s.QUAL - s.SPY, 'Positive = profitable, low-debt companies.'],
  ['Low volatility', s => s.USMV - s.SPY, 'Positive = defensive, steady stocks; negative = high-beta stocks.'],
];

/** Solves A x = b (small systems) with Gaussian elimination; returns null when singular. */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function inverse(A) {
  const n = A.length; return A.map((_, j) => solve(A, A.map((__, i) => (i === j ? 1 : 0)))).reduce((acc, col, j) => { col.forEach((v, i) => { acc[i][j] = v; }); return acc; }, A.map(() => new Array(n).fill(0)));
}

/** OLS of y on the columns of X (an intercept is added). Returns {coef, t, r2, alpha} or null. */
export function ols(y, X) {
  const n = y.length, k = X[0].length + 1;
  if (n < k + 8) return null;
  const Z = X.map(r => [1, ...r]);
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => Z.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => Z.reduce((s, r, t) => s + r[i] * y[t], 0));
  const b = solve(XtX, Xty); if (!b) return null;
  const fit = Z.map(r => r.reduce((s, v, i) => s + v * b[i], 0)), res = y.map((v, i) => v - fit[i]);
  const my = y.reduce((s, v) => s + v, 0) / n, sst = y.reduce((s, v) => s + (v - my) ** 2, 0), sse = res.reduce((s, v) => s + v * v, 0);
  const s2 = sse / (n - k), inv = inverse(XtX);
  const t = b.map((v, i) => { const se = Math.sqrt(Math.max(0, s2 * inv[i][i])); return se ? v / se : null; });
  return { alpha: b[0], coef: b.slice(1), t: t.slice(1), r2: sst ? 1 - sse / sst : null, n };
}

/** Weekly returns from daily bars over common week keys. */
export function weeklyReturns(barsBySym, weeks = 104) {
  const wk = b => { const m = new Map(); for (const x of b) { const d = new Date(x.time * 1000); m.set(x.time - ((d.getUTCDay() + 6) % 7) * 86400, x.close); } return m; };
  const maps = Object.fromEntries(Object.entries(barsBySym).map(([s, b]) => [s, wk(b)]));
  let keys = null; for (const m of Object.values(maps)) { const ks = [...m.keys()]; keys = keys ? keys.filter(k => m.has(k)) : ks; }
  keys = (keys || []).sort((a, b) => a - b).slice(-(weeks + 1));
  const out = {}; for (const [s, m] of Object.entries(maps)) out[s] = keys.slice(1).map((k, i) => m.get(k) / m.get(keys[i]) - 1);
  return { keys, ret: out };
}

/**
 * Regression of the portfolio on the factors.
 * weights: {sym: weight of the stock part}; bars: {sym: bars} for holdings and FACTOR_ETFS.
 */
export function factorExposure(weights, bars, weeks = 104) {
  const need = [...Object.keys(weights), ...FACTOR_ETFS];
  if (need.some(s => !bars[s] || bars[s].length < 120)) return null;
  const { ret } = weeklyReturns(Object.fromEntries(need.map(s => [s, bars[s]])), weeks);
  const n = ret.SPY.length; if (n < 30) return null;
  const y = Array.from({ length: n }, (_, i) => Object.entries(weights).reduce((s, [sym, w]) => s + w * ret[sym][i], 0));
  const X = Array.from({ length: n }, (_, i) => { const r = Object.fromEntries(FACTOR_ETFS.map(s => [s, ret[s][i]])); return FACTORS.map(([, f]) => f(r)); });
  const fit = ols(y, X); if (!fit) return null;
  return { ...fit, weeks: n, factors: FACTORS.map(([name, , about], i) => ({ name, about, beta: fit.coef[i], t: fit.t[i] })) };
}
