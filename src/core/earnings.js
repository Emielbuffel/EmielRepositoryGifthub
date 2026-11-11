// Earnings maths: trailing EPS, year-over-year growth, the smooth EPS line for the chart,
// the earnings items of the growth checklist, and an accumulation grade.
// Input rows: ascending [{time (report date, epoch s), eps, est?, rev?, revEst?, period?}]; future rows have eps == null.

/** Reported quarters (or half years) only (eps known), ascending; yearly rows are kept apart. */
export const reported = rows => (rows || []).filter(r => r.eps != null && isFinite(r.eps) && !r.annual).sort((a, b) => a.time - b.time);
/** Yearly rows (eps known), ascending. */
export const yearly = rows => (rows || []).filter(r => r.eps != null && isFinite(r.eps) && r.annual).sort((a, b) => a.time - b.time);
/** Periods per year: 4 for quarterly reporters, 2 for half-year reporters (many European companies). */
function perYear(q) {
  if (q.some(r => r.half)) return 2;
  const g = q.slice(1).map((r, i) => r.time - q[i].time).sort((a, b) => a - b);
  return g.length >= 2 && g[Math.floor(g.length / 2)] > 140 * 86400 ? 2 : 4;
}
/** The next scheduled report (first future row without eps), if the provider gives one. */
export function nextReport(rows, now = Date.now() / 1000) {
  const f = (rows || []).filter(r => r.eps == null && r.time > now - 86400).sort((a, b) => a.time - b.time);
  return f[0] || null;
}

const growth = (a, b) => a == null || b == null || !isFinite(a) || !isFinite(b) || b <= 0 ? null : (a - b) / b;

/** Adds ttm (sum of the last 4 quarters), yoy (vs the same quarter a year earlier), surprise and sales growth. */
export function enrich(rows) {
  const q = reported(rows), k = perYear(q);
  return q.map((r, i) => ({
    ...r,
    ttm: i >= k - 1 ? q.slice(i - k + 1, i + 1).reduce((s, x) => s + x.eps, 0) : null,
    yoy: i >= k ? growth(r.eps, q[i - k].eps) : null,
    revYoy: i >= k && r.rev && q[i - k].rev ? growth(r.rev, q[i - k].rev) : null,
    surprise: r.est != null && r.est !== 0 ? (r.eps - r.est) / Math.abs(r.est) : null,
  }));
}

/**
 * Points of the EPS line at each report date. mode 'ttm' (4-quarter EPS) or 'q'.
 */
export function epsPoints(rows, mode = 'ttm') {
  const pts = enrich(rows).map(r => ({ time: r.time, value: mode === 'ttm' ? r.ttm : r.eps, yoy: r.yoy, eps: r.eps, period: r.period }))
    .filter(p => p.value != null);
  // yearly EPS fills the years before the quarterly (or half-year) figures start, or replaces them when there are too few
  const y = yearly(rows); if (!y.length || mode !== 'ttm' && pts.length >= 2) return pts;
  const first = pts.length ? pts[0].time : Infinity;
  const yp = y.filter(r => r.time < first - 60 * 86400).map((r, i, a) => ({ time: r.time, value: r.eps, eps: r.eps, yoy: i ? growth(r.eps, a[i - 1].eps) : null, period: r.period, annual: true }));
  return [...yp, ...pts].sort((a, b) => a.time - b.time);
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
    // book: at least +20% vs the same quarter a year ago (25–30% is safer); best if the last two quarters are both strong;
    // two quarters of sharp slowdown are a warning
    const r = q[n], prev = q[n - 1], p2 = q[n - 2];
    const accel = r.yoy != null && prev.yoy != null && r.yoy > prev.yoy;
    const decel2 = r.yoy != null && prev.yoy != null && p2 && p2.yoy != null && p2.yoy > 0.2 && prev.yoy < p2.yoy * 0.67 && r.yoy < p2.yoy * 0.67;
    const ok = r.yoy != null && r.yoy >= 0.2, both = ok && prev.yoy != null && prev.yoy >= 0.2;
    C = [r.yoy == null ? 'na' : decel2 ? 'mid' : ok ? 'pass' : r.yoy >= 0 ? 'mid' : 'fail',
      `Latest quarter EPS ${pct(r.yoy)} vs a year ago${prev.yoy != null ? ` (prior quarter ${pct(prev.yoy)})` : ''}${r.revYoy != null ? `, sales ${pct(r.revYoy)}` : ''}${r.yoy != null && prev.yoy != null ? (accel ? ', accelerating' : ', slowing') : ''}.${decel2 ? ' Two quarters of sharp slowdown: a warning sign.' : both ? ' Both of the last two quarters are up 20%+.' : ''} The book asks for at least +20% (25–30%+ is safer).`];
  }
  if (n >= 7) {
    // book: EPS up in each of the last five years (one dip allowed if it recovers to a new high), growing 25–50% a year
    const years = Math.min(5, Math.floor(n / 4)), yr = [];
    for (let k = years; k >= 0; k--) yr.push(q[n - 4 * k] ? q[n - 4 * k].ttm : null);
    const vals = yr.filter(v => v != null);
    if (vals.length >= 2) {
      const a = vals[vals.length - 1], b = vals[0], span = vals.length - 1;
      const cagr = a > 0 && b > 0 ? Math.pow(a / b, 1 / span) - 1 : null;
      let downs = 0; for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1]) downs++;
      const newHigh = a >= Math.max(...vals);
      const steady = downs === 0 || (downs === 1 && newHigh);
      A = [cagr == null ? 'na' : cagr >= 0.25 && steady ? 'pass' : cagr >= 0.1 ? 'mid' : 'fail',
        `4-quarter EPS grew ${cagr == null ? 'n/a' : pct(cagr) + ' a year'} over ${span} year${span > 1 ? 's' : ''}${downs ? `, with ${downs} down year${downs > 1 ? 's' : ''}${downs === 1 && newHigh ? ' (since recovered to a new high)' : ''}` : ', up every year'}. The book asks for growth in each of the last five years, 25–50% a year.${span < 5 ? ` Only ${span} year${span > 1 ? 's' : ''} of data loaded.` : ''}`];
    }
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

/**
 * Joins the built-in (adjusted) EPS history with a longer one (SEC filings or the free feed). The longer history wins
 * when it has more quarters; otherwise only quarters newer than the built-in ones, and yearly EPS for the years before
 * them, are added — never the same quarter twice from two sources.
 */
export function mergeEarnings(built, long) {
  const reported = built.filter(r => r.eps != null);
  let rows = reported.length ? built : [];
  const longQ = long ? long.filter(r => !r.annual) : [];
  if (long && longQ.length > reported.length) {
    const lastT = Math.max(...long.map(r => r.time));
    rows = [...long, ...built.filter(r => r.eps == null && r.time > lastT)]; // keep the next report date
  } else if (long && long.length) {
    // (the built-in list can come newest-first: take the real first and last report dates)
    const ts = reported.map(r => r.time), t0 = ts.length ? Math.min(...ts) : Infinity, t1 = ts.length ? Math.max(...ts) : -Infinity;
    rows = [...rows, ...longQ.filter(r => r.time > t1 + 45 * 86400), ...long.filter(r => r.annual && r.time < t0 - 60 * 86400)];
  }
  return rows;
}
