// Market direction: distribution days, follow-through days and the market status, using widely published
// rules of thumb.
import { sma, ema } from './indicators.js';

export const STATUS = {
  up: ['Confirmed uptrend', 'ok'],
  press: ['Uptrend under pressure', 'warn'],
  corr: ['Market in correction', 'bad'],
};

export const EXPOSURE = {
  up: "Rule-of-thumb exposure in a confirmed uptrend: 80–100% invested — and, if you use margin, up to your margin limit on top (e.g. 150% with 50% margin) once your first buys are working. Buy proper breakouts from sound bases on strong volume.",
  press: "Rule-of-thumb exposure when an uptrend is under pressure: 40–60% invested, no margin (pay the loan back first). Be selective, take some profits and tighten stops.",
  corr: "Rule-of-thumb exposure in a correction: 0–20% invested, no margin. Protect capital and wait for a follow-through day (day 4–7 of a rally attempt, at the latest day 10: a 1%+ gain on higher volume).",
};

/** b = ascending daily bars {time,open,high,low,close,volume}. Returns null with fewer than 80 bars. */
export function analyseIndex(b) {
  const n = b.length - 1; if (n < 80) return null;
  const c = b.map(x => x.close), v = b.map(x => x.volume), e21 = ema(c, 21), s50 = sma(c, 50), s200 = sma(c, 200), v50 = sma(v, 50);
  const hasVol = v.slice(-40).filter(x => x > 0).length >= 35;
  const isDD = i => hasVol && i > 0 && v[i - 1] > 0 && c[i] / c[i - 1] - 1 <= -0.002 && v[i] > v[i - 1];
  // a distribution day counts for 25 sessions, or until the index closes 5% above it
  const ddAt = i => {
    const out = [];
    for (let j = Math.max(1, i - 24); j <= i; j++) {
      if (!isDD(j)) continue; let mx = -Infinity; for (let k = j + 1; k <= i; k++) if (c[k] > mx) mx = c[k];
      if (mx >= c[j] * 1.05) continue; out.push(j);
    }
    return out;
  };
  const i0 = Math.max(60, n - 320);
  let state = c[i0] > s50[i0] ? 'up' : 'corr', since = i0, low = state === 'corr' ? i0 : null, lastFtd = null, rallyLow = null;
  const ftds = [], states = new Array(n + 1).fill(null);
  states[i0] = state;
  for (let i = i0 + 1; i <= n; i++) {
    const dd = ddAt(i).length;
    let hi = -Infinity; for (let k = Math.max(0, i - 80); k <= i; k++) if (c[k] > hi) hi = c[k]; const dr = 1 - c[i] / hi;
    let hi60 = -Infinity; for (let k = Math.max(0, i - 60); k < i; k++) if (c[k] > hi60) hi60 = c[k];
    // follow-through day (book): day 4–7 of a rally attempt (at the latest day 10), +1% or more on higher volume
    if (state === 'corr') {
      if (b[i].low < b[low].low) low = i;
      else if (i - low >= 3 && i - low <= 9 && c[i] / c[i - 1] - 1 >= 0.01 && (!hasVol || v[i] > v[i - 1])) { state = 'up'; since = i; ftds.push(i); lastFtd = i; rallyLow = b[low].low; low = null; }
      else if (c[i] > s50[i] && c[i] > e21[i] && c[i] >= hi60 * 0.98) { state = 'up'; since = i; low = null; rallyLow = null; }
    } else {
      const failed = rallyLow != null && lastFtd != null && i - lastFtd <= 30 && c[i] < rallyLow;
      if (failed || (c[i] < s50[i] && (dr >= 0.07 || (dd >= 6 && dr >= 0.05)))) { state = 'corr'; since = i; low = i; rallyLow = null; states[i] = state; continue; }
      const fresh = lastFtd != null && i - lastFtd <= 20, ns = (dd >= 5 || (!fresh && c[i] < s50[i])) ? 'press' : 'up';
      if (ns !== state) { state = ns; since = i; }
    }
    states[i] = state;
  }
  let hi52 = -Infinity; for (let k = Math.max(0, n - 252); k <= n; k++) if (b[k].high > hi52) hi52 = b[k].high;
  return { b, n, c, v, e21, s50, s200, v50, hasVol, dd: ddAt(n), ddDetail: ddAt(n).map(j => ({ i: j, chg: c[j] / c[j - 1] - 1, volChg: v[j] / v[j - 1] - 1, expires: j + 25 - n })), states, ddAll: Array.from({ length: n - i0 + 1 }, (_, k) => i0 + k).filter(isDD), i0, ftds, lastFtd, state, since, low, rallyDay: low != null ? n - low + 1 : null, off: c[n] / hi52 - 1, day: c[n] / c[n - 1] - 1 };
}

/** US status = the weaker of the Nasdaq and S&P 500 readings. */
export function combine(results) {
  const rank = { corr: 0, press: 1, up: 2 };
  const xs = results.filter(Boolean); if (!xs.length) return null;
  const w = xs.reduce((a, b) => rank[b.state] < rank[a.state] ? b : a);
  // phase: a NEW uptrend in the first 15 sessions after a follow-through day (a bull market starting), a rally attempt
  // during a correction (no follow-through day yet), or the plain state
  const ftdAgo = w.lastFtd != null && w.state === 'up' ? w.n - w.lastFtd : null;
  const phase = w.state === 'up' ? (ftdAgo != null && ftdAgo <= 15 ? 'new' : 'bull') : w.state === 'corr' && w.rallyDay != null ? 'rally' : w.state;
  return { us: w.state, usLabel: STATUS[w.state][0], phase, ftdAgo, rallyDay: w.state === 'corr' ? w.rallyDay : null };
}
