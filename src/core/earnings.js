// Earnings maths: trailing EPS, year-over-year growth, the smooth EPS line for the chart,
// the earnings items of the growth checklist, and an accumulation grade.
// Input rows: ascending [{time (report date, epoch s), eps, est?, rev?, revEst?, period?}]; future rows have eps == null.

/** Reported quarters only (eps known), ascending. */
export const reported = rows => (rows || []).filter(r => r.eps != null && isFinite(r.eps)).sort((a, b) => a.time - b.time);
/** The next scheduled report (first future row without eps), if the provider gives one. */
export function nextReport(rows, now = Date.now() / 1000) {
  const f = (rows || []).filter(r => r.eps == null && r.time > now - 86400).sort((a, b) => a.time - b.time);
  return f[0] || null;
}

const growth = (a, b) => a == null || b == null || !isFinite(a) || !isFinite(b) || b <= 0 ? null : (a - b) / b;

/** Adds ttm (sum of the last 4 quarters), yoy (vs the same quarter a year earlier), surprise and sales growth. */
export function enrich(rows) {
  const q = reported(rows);
  return q.map((r, i) => ({
    ...r,
    ttm: i >= 3 ? q[i].eps + q[i - 1].eps + q[i - 2].eps + q[i - 3].eps : null,
    yoy: i >= 4 ? growth(r.eps, q[i - 4].eps) : null,
    revYoy: i >= 4 && r.rev && q[i - 4].rev ? growth(r.rev, q[i - 4].rev) : null,
    surprise: r.est != null && r.est !== 0 ? (r.eps - r.est) / Math.abs(r.est) : null,
  }));
}

/**
 * Points of the EPS line at each report date. mode 'ttm' (4-quarter EPS) or 'q'.
 */
export function epsPoints(rows, mode = 'ttm') {
  return enrich(rows).map(r => ({ time: r.time, value: mode === 'ttm' ? r.ttm : r.eps, yoy: r.yoy, eps: r.eps, period: r.period }))
    .filter(p => p.value != null);
}

/**
 * Smooth curve through the points, evaluated at every bar time between the first and last point
 * (monotone cubic interpolation: no overshoot between quarters), then held flat to the last bar.
 */
export function smoothLine(points, times) {
  const P = points.filter(p => p.value != null);
  if (P.length < 2 || !times.length) return [];
  const xs = P.map(p => p.time), ys = P.map(p => p.value), n = P.length;
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { // Fritsch–Carlson limiter
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const out = []; let k = 0;
  for (const t of times) {
    if (t < xs[0]) continue;
    if (t >= xs[n - 1]) { out.push({ time: t, value: ys[n - 1] }); continue; }
    while (k < n - 2 && t > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], u = (t - xs[k]) / h, u2 = u * u, u3 = u2 * u;
    const v = (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * m[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * m[k + 1];
    out.push({ time: t, value: v });
  }
  return out;
}

/** Checklist items: latest-quarter EPS growth and 3-year growth of 4-quarter EPS, as [state, text]. */
export function canslimCA(rows) {
  const q = enrich(rows), n = q.length - 1;
  let C = ['na', 'Needs quarterly earnings.'], A = ['na', 'Needs about four years of quarterly earnings.'];
  if (n >= 4) {
    const r = q[n], prev = q[n - 1];
    const accel = r.yoy != null && prev.yoy != null && r.yoy > prev.yoy;
    C = [r.yoy == null ? 'na' : r.yoy >= 0.25 ? 'pass' : r.yoy >= 0 ? 'mid' : 'fail',
      `Latest quarter EPS ${pct(r.yoy)} vs a year ago${r.revYoy != null ? `, sales ${pct(r.revYoy)}` : ''}${r.yoy != null && prev.yoy != null ? (accel ? ', accelerating' : ', slowing') : ''}. The classic threshold is +25% or more.`];
  }
  if (n >= 15) {
    const a = q[n].ttm, b = q[n - 12].ttm;
    const cagr = a > 0 && b > 0 ? Math.pow(a / b, 1 / 3) - 1 : null;
    A = [cagr == null ? 'na' : cagr >= 0.25 ? 'pass' : cagr >= 0.1 ? 'mid' : 'fail', `4-quarter EPS grew ${cagr == null ? 'n/a' : pct(cagr) + ' a year'} over 3 years. The classic threshold is 25%+ a year.`];
  } else if (n >= 7) {
    const a = q[n].ttm, b = q[n - 4].ttm, g = growth(a, b);
    A = [g == null ? 'na' : g >= 0.25 ? 'pass' : g >= 0.1 ? 'mid' : 'fail', `4-quarter EPS ${pct(g)} vs a year ago (only ${n + 1} quarters loaded; ideally 3 years).`];
  }
  return { C, A };
}
const pct = x => x == null || !isFinite(x) ? 'n/a' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';

/**
 * Approximate accumulation/distribution grade (A–E) over the last 13 weeks: up-day volume weighted by the
 * size of the move vs down-day volume. The app's own measure.
 */
export function adGrade(bars) {
  const n = bars.length - 1; if (n < 66) return null;
  let up = 0, dn = 0;
  for (let i = n - 64; i <= n; i++) {
    const ch = bars[i].close / bars[i - 1].close - 1, rng = (bars[i].high - bars[i].low) || 1e-9;
    const clv = ((bars[i].close - bars[i].low) - (bars[i].high - bars[i].close)) / rng; // where it closed in the day's range
    const w = bars[i].volume * (Math.abs(ch) + 0.002) * (1 + 0.5 * Math.abs(clv));
    if (ch > 0) up += w; else if (ch < 0) dn += w;
  }
  const r = dn ? up / dn : 9;
  const g = r >= 1.6 ? 'A' : r >= 1.2 ? 'B' : r >= 0.85 ? 'C' : r >= 0.6 ? 'D' : 'E';
  return { grade: g, ratio: r };
}
