// When to sell, by the rules of How to Make Money in Stocks (chapters 9 and 10), applied to each breakout as if
// bought at the buy point. Walks forward from the breakout and returns the first sell signal with its reason,
// or, for a position still open, the current sell line and profit targets.
//
// Rules, in the order they are checked each day:
//  - sell line: 8% below the buy price (the book: 7–8% maximum); raised to just below the buy point (−3%) once the
//    stock has been 15% up, and to breakeven once it has been 20% up ("never let a 20% gain turn into a loss")
//  - climax top: after a 25%+ gain, the biggest one-day rise since the breakout while 25%+ above the 50-day line,
//    or a 25%+ run in the last 10 sessions with 8+ up days
//  - 70%+ above the 200-day line (when 20%+ up and outside the 8-week hold)
//  - heavy-volume break of the 50-day line (volume 50%+ above average)
//  - profit: take most at +20–25%, unless the stock got there within 8 weeks (then hold at least 8 weeks)

const sma = (c, k, i) => { if (i < k - 1) return null; let s = 0; for (let j = i - k + 1; j <= i; j++) s += c[j]; return s / k; };
const avgVol = (b, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 50); j < i; j++) { s += b[j].volume; n++; } return n ? s / n : 0; };

export const SELL_LABEL = {
  stop: 'Stop', raised: 'Raised stop', breakeven: 'Breakeven stop', climax: 'Climax top', ext200: '70% over 200-day',
  break50: '50-day break', profit: 'Take profits',
};

/** One breakout: buy at `pivot` on bar `bo`. Returns {sell: {i, code, why, ret} | null, open: {...} | null, hold8, peak}. */
export function sellPlan(b, bo, pivot) {
  const c = b.map(x => x.close), n = b.length - 1;
  let peak = 0, hold8 = null, reached = null, maxUp = 0;
  for (let j = bo + 1; j <= n; j++) {
    const g = c[j] / pivot - 1, wk = (j - bo) / 5;
    // the sell line uses the gains made before today
    let line = pivot * 0.92, code = 'stop', why = 'closed 8% below the buy price: cut the loss (the book: 7–8% at most)';
    if (peak >= 0.15) { line = pivot * 0.97; code = 'raised'; why = 'fell back under the sell line just below the buy point, raised after a 15% gain'; }
    if (peak >= 0.20) { line = pivot; code = 'breakeven'; why = 'gave back the whole gain after being 20% up: never let a 20% gain turn into a loss'; }
    if (c[j] < line) return { sell: { i: j, code, why, ret: c[j] / pivot - 1 }, open: null, hold8, peak };
    const s50 = sma(c, 50, j), s200 = sma(c, 200, j), up = c[j] - c[j - 1];
    if (g >= 0.20 && reached == null) { reached = j; if (wk < 8) hold8 = { from: j, until: bo + 40 }; } // the 8-week rule
    // climax top
    if (g >= 0.25) {
      const biggest = up > 0 && up >= maxUp && s50 && c[j] / s50 - 1 >= 0.25;
      let ups = 0; for (let k = Math.max(bo + 1, j - 9); k <= j; k++) if (c[k] > c[k - 1]) ups++;
      const run = j - 10 > bo && c[j] / c[j - 10] - 1 >= 0.25 && ups >= 8;
      if (biggest || run) return { sell: { i: j, code: 'climax', why: biggest ? 'biggest one-day gain since the breakout while extended 25%+ above the 50-day line' : 'climax run: 25%+ in 10 sessions with 8+ up days', ret: g }, open: null, hold8, peak };
    }
    if (up > maxUp) maxUp = up;
    // selling into strength far above the 200-day line: only when in profit and outside the 8-week hold
    if (s200 && c[j] / s200 - 1 >= 0.7 && g >= 0.2 && !(hold8 && j < hold8.until)) return { sell: { i: j, code: 'ext200', why: `${Math.round((c[j] / s200 - 1) * 100)}% above the 200-day line (the book: often sold at 70–100% above)`, ret: g }, open: null, hold8, peak };
    const s50p = sma(c, 50, j - 1), av = avgVol(b, j);
    if (s50 && s50p && c[j] < s50 && c[j - 1] >= s50p && av && b[j].volume >= av * 1.5) return { sell: { i: j, code: 'break50', why: `broke the 50-day line on volume ${Math.round((b[j].volume / av - 1) * 100)}% above average`, ret: g }, open: null, hold8, peak };
    // profit-taking and the 8-week rule
    if (g >= 0.20 && !hold8) return { sell: { i: j, code: 'profit', why: `up ${Math.round(g * 100)}% after ${Math.round(wk)} weeks: take most profits at +20–25%`, ret: g }, open: null, hold8, peak };
    peak = Math.max(peak, g);
  }
  // still open: today's sell line and targets
  let line = pivot * 0.92, lineWhy = '8% below the buy price';
  if (peak >= 0.15) { line = pivot * 0.97; lineWhy = 'just below the buy point (after a 15% gain)'; }
  if (peak >= 0.20) { line = pivot; lineWhy = 'breakeven (after a 20% gain)'; }
  return { sell: null, open: { line, lineWhy, t20: pivot * 1.2, t25: pivot * 1.25, holdUntil: hold8 ? hold8.until : null }, hold8, peak };
}

/** Sell plans for every sound breakout in a detector result. */
export function sellPoints(b, R) {
  return (R.hist || []).filter(h => !h.faulty && h.pivot && h.bo != null).map(h => ({ h, ...sellPlan(b, h.bo, h.pivot) }));
}
