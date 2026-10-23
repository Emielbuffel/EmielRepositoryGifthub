// Portfolio risk maths, run on the device. Method follows the original desk's portfolio_analysis.py:
// weekly returns in the base currency over ~2 years, volatility, betas (incl. downside beta),
// risk contribution, correlation, max drawdown, effective number of positions and a stress replay.

const WEEK = 7 * 86400;

/** Friday-ish weekly closes keyed by week start: Map(weekKey -> close). */
function weeklyCloses(bars) {
  const m = new Map();
  for (const b of bars) { const d = new Date(b.time * 1000); const k = b.time - ((d.getUTCDay() + 6) % 7) * 86400; m.set(k, b.close); }
  return m;
}

/** Converts a weekly close map to the base currency with an FX map or fixed rate (base per 1 unit of local). */
function toBase(m, fx) {
  if (!fx) return m;
  if (typeof fx === 'number') return new Map([...m].map(([k, v]) => [k, v * fx]));
  const out = new Map(); let lastFx = null;
  const keys = [...new Set([...m.keys(), ...fx.keys()])].sort((a, b) => a - b);
  for (const k of keys) { if (fx.has(k)) lastFx = fx.get(k); if (m.has(k) && lastFx) out.set(k, m.get(k) * lastFx); }
  return out;
}

function returns(m, keys) {
  const r = [];
  for (let i = 1; i < keys.length; i++) { const a = m.get(keys[i - 1]), b = m.get(keys[i]); r.push(a && b ? b / a - 1 : 0); }
  return r;
}

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
function cov(x, y) { const mx = mean(x), my = mean(y); let s = 0; for (let i = 0; i < x.length; i++) s += (x[i] - mx) * (y[i] - my); return s / Math.max(1, x.length - 1); }
const sd = x => Math.sqrt(cov(x, x));

export function beta(x, y, down = false) {
  const xs = [], ys = [];
  for (let i = 0; i < y.length; i++) if (!down || y[i] < 0) { xs.push(x[i]); ys.push(y[i]); }
  if (xs.length < 8) return null;
  const v = cov(ys, ys); return v ? cov(xs, ys) / v : null;
}

/**
 * positions: [{sym, name, value (base ccy), bars, fx: Map|null}]
 * bench: {name, bars, fx: Map|null}. maxPos: flag positions above this share of the stocks (null = no size check here)
 * Returns metrics for the whole book and per position.
 */
export function analysePortfolio(positions, bench, weeks = 104, { maxPos = 0.12 } = {}) {
  const pos = positions.filter(p => p.bars && p.bars.length > 60 && p.value > 0);
  const total = pos.reduce((s, p) => s + p.value, 0);
  if (!pos.length || !total) return null;
  const wc = pos.map(p => toBase(weeklyCloses(p.bars), p.fx));
  const bc = bench && bench.bars && bench.bars.length ? toBase(weeklyCloses(bench.bars), bench.fx) : null;
  // common week keys, last `weeks`+1
  let keys = [...wc[0].keys()];
  for (const m of wc.slice(1)) keys = keys.filter(k => m.has(k));
  if (bc) keys = keys.filter(k => bc.has(k));
  keys.sort((a, b) => a - b); keys = keys.slice(-(weeks + 1));
  if (keys.length < 20) return { error: 'Not enough overlapping price history between the holdings (need 20+ common weeks).' };
  const R = wc.map(m => returns(m, keys));
  const B = bc ? returns(bc, keys) : null;
  const w = pos.map(p => p.value / total);
  const T = R[0].length;
  const port = Array.from({ length: T }, (_, t) => R.reduce((s, r, i) => s + w[i] * r[t], 0));
  const covM = R.map(a => R.map(b => cov(a, b)));
  const varP = w.reduce((s, wi, i) => s + wi * covM[i].reduce((s2, c, j) => s2 + c * w[j], 0), 0);
  const volP = Math.sqrt(varP * 52);
  const rc = w.map((wi, i) => varP ? wi * covM[i].reduce((s, c, j) => s + c * w[j], 0) / varP : 0);
  const corr = R.map(a => R.map(b => { const s = sd(a) * sd(b); return s ? cov(a, b) / s : null; }));
  // max drawdown of the portfolio's weekly path
  let eq = 1, peak = 1, mdd = 0; for (const r of port) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  // stress replay: the benchmark's worst peak-to-trough stretch in the window
  let stress = null;
  if (B) {
    let e = 1, pk = 1, pkI = 0, worst = 0, wFrom = 0, wTo = 0;
    for (let t = 0; t < T; t++) { e *= 1 + B[t]; if (e > pk) { pk = e; pkI = t + 1; } const dd = e / pk - 1; if (dd < worst) { worst = dd; wFrom = pkI; wTo = t; } }
    if (worst < -0.05) {
      const comp = arr => arr.slice(wFrom, wTo + 1).reduce((s, r) => s * (1 + r), 1) - 1;
      stress = { from: keys[wFrom], to: keys[wTo + 1], bench: worst, port: comp(port), per: R.map(comp) };
    }
  }
  const per = pos.map((p, i) => ({
    sym: p.sym, name: p.name, weight: w[i], vol: sd(R[i]) * Math.sqrt(52), rc: rc[i],
    beta: B ? beta(R[i], B) : null, downBeta: B ? beta(R[i], B, true) : null,
  }));
  const flags = [];
  if (maxPos) per.forEach(x => { if (x.weight > maxPos) flags.push(['warn', `${x.sym} is ${(x.weight * 100).toFixed(0)}% of the portfolio. Many risk guides cap a single stock at ${Math.round(maxPos * 100)}%.`]); });
  per.forEach(x => { if (x.downBeta != null && x.downBeta > 1.5) flags.push(['warn', `${x.sym} has a downside beta of ${x.downBeta.toFixed(2)}: in weeks the benchmark fell it fell about ${x.downBeta.toFixed(1)}× as much.`]); });
  const top = [...per].sort((a, b) => b.rc - a.rc)[0];
  if (top && top.rc > 0.35 && per.length > 2) flags.push(['warn', `${top.sym} alone drives ${(top.rc * 100).toFixed(0)}% of the portfolio's volatility.`]);
  const effN = 1 / w.reduce((s, x) => s + x * x, 0);
  if (effN < 5 && per.length >= 2) flags.push(['info', `Effective number of positions: ${effN.toFixed(1)}. The book behaves like ${effN.toFixed(1)} equal-sized bets.`]);
  // average pairwise correlation
  let cs = 0, cn = 0; for (let i = 0; i < corr.length; i++) for (let j = i + 1; j < corr.length; j++) if (corr[i][j] != null) { cs += corr[i][j]; cn++; }
  const avgCorr = cn ? cs / cn : null;
  if (avgCorr != null && avgCorr > 0.6) flags.push(['warn', `Holdings move together a lot (average correlation ${avgCorr.toFixed(2)}). Diversification is weaker than the number of lines suggests.`]);
  return {
    total, weeks: T, from: keys[0], to: keys[keys.length - 1], vol: volP, mdd, effN, avgCorr,
    beta: B ? beta(port, B) : null, downBeta: B ? beta(port, B, true) : null,
    per, corr, stress, flags,
  };
}

export { WEEK };
