// Signals for a stock you own: is it in a buy zone again, or at a point where the book and IBD say you may add?
// Rules (How to Make Money in Stocks; IBD's add-on buy points):
// - average up, never down: only add while the position shows a gain;
// - a breakout from a new base (base-on-base) is a new buy point, with its own 5% buy zone;
// - a three-weeks-tight pattern after a breakout is an add-on point when the stock clears its high;
// - the first or second pullback to a rising 10-week (50-day) line on light volume, after a breakout;
// - strong leaders: a light-volume pullback to the rising 21-day line.
// Pure function: daily bars + detector result → signals.
import { sma, ema } from './indicators.js';

const r2 = x => Math.round(x * 100) / 100;

/**
 * bars: daily bars (oldest first); R: PAT.scan(bars); cost: your average price (optional).
 * Returns [{code, level: 'buy'|'add'|'info', title, text, price?}] — newest situation only, at most one per kind.
 */
export function holdingSignals(bars, R, { cost = null } = {}) {
  const n = bars.length - 1; if (n < 60 || !R) return [];
  const c = bars.map(b => b.close), v = bars.map(b => b.volume || 0), last = bars[n], close = last.close;
  const s50 = sma(c, 50), e21 = ema(c, 21), out = [];
  let vs = 0, vm = 0; for (let i = Math.max(0, n - 50); i < n; i++) { vs += v[i]; vm++; }
  const avgVol = vm ? vs / vm : 0, light = k => avgVol > 0 && v.slice(n - k + 1, n + 1).reduce((t, x) => t + x, 0) / k < avgVol; // last k days below average
  const inProfit = cost == null || close > cost;
  const gainTxt = cost ? ` You are ${close >= cost ? 'up' : 'down'} ${Math.abs((close / cost - 1) * 100).toFixed(1)}% on your average price.` : '';

  // 1. breakout from a new base: in its buy zone (0–5% above the buy point), within 5 days of the breakout
  const lb = R.last && !R.last.failed && n - R.last.bo <= 5 ? R.last : null;
  if (lb) {
    const g = close / lb.pivot - 1;
    if (g >= 0 && g <= 0.05) out.push({ code: 'buyzone:' + lb.bo, level: inProfit ? 'add' : 'buy', price: r2(lb.pivot), title: `In the buy zone: ${lb.name}`, text: `Broke out of a ${lb.name.toLowerCase()} ${n - lb.bo === 0 ? 'today' : (n - lb.bo) + ' day' + (n - lb.bo > 1 ? 's' : '') + ' ago'} above ${r2(lb.pivot)}; now ${(g * 100).toFixed(1)}% above it (buy zone up to ${r2(lb.pivot * 1.05)}).${inProfit ? ' A breakout from a new base is an add-on point.' : ' Your position is at a loss: the book says don\'t average down — act on the new buy point only with fresh confirmation.'}${gainTxt}` });
  }
  // a new base close to its buy point: a heads-up, not yet a buy
  const near = R.cur.find(p => p.pivot && p.type !== '3wt' && close / p.pivot - 1 >= -0.03 && close < p.pivot);
  if (near && !lb) out.push({ code: 'near:' + near.a, level: 'info', price: r2(near.pivot), title: `Near a buy point: ${near.name}`, text: `${((1 - close / near.pivot) * 100).toFixed(1)}% under the buy point ${r2(near.pivot)} of a ${near.name.toLowerCase()}. An add-on point once it closes above it on volume at least 40% above average.${gainTxt}` });

  // after a recent breakout (within ~16 weeks) that held: the classic add-on points
  const bo = R.last && !R.last.failed && n - R.last.bo <= 80 && close > R.last.pivot ? R.last : null;
  if (bo && inProfit) {
    // 2. three weeks tight after the breakout: add above its high
    const twt = R.cur.find(p => p.type === '3wt' && p.pivot);
    if (twt) out.push({ code: '3wt:' + twt.a, level: close > twt.pivot ? 'add' : 'info', price: r2(twt.pivot), title: close > twt.pivot ? 'Add-on: cleared three weeks tight' : 'Three weeks tight: add-on point ahead', text: close > twt.pivot ? `The stock cleared the three-weeks-tight high ${r2(twt.pivot)}: an add-on point in the book (add while it is within a few % of it).${gainTxt}` : `Three weekly closes within about 1.5%. Add when it closes above ${r2(twt.pivot)}.${gainTxt}` });
    // 3. pullback to the rising 50-day (10-week) line on light volume, first or second test since the breakout
    const rising50 = s50[n] != null && s50[n - 5] != null && s50[n] > s50[n - 5];
    if (rising50 && last.low <= s50[n] * 1.015 && close >= s50[n] * 0.995 && close <= s50[n] * 1.03 && light(3)) {
      let tests = 0, away = true;
      for (let i = bo.bo + 1; i < n; i++) { if (s50[i] == null) continue; const touch = bars[i].low <= s50[i] * 1.015; if (touch && away) tests++; away = !touch; }
      if (tests <= 1) out.push({ code: 'pull50:' + bo.bo + ':' + tests, level: 'add', price: r2(s50[n]), title: `Add-on: pullback to the 50-day line (${tests ? 'second' : 'first'} test)`, text: `A quiet pullback to the rising 50-day (10-week) line at ${r2(s50[n])} after the ${bo.name.toLowerCase()} breakout: an add-on point in the book and at IBD. Add only if it holds the line; sell the add if it closes clearly below.${gainTxt}` });
    }
    // 4. strong leaders: pullback to the rising 21-day line on light volume (the stock ran 10%+ past the buy point)
    const rising21 = e21[n] != null && e21[n - 3] != null && e21[n] > e21[n - 3];
    const ran = Math.max(...c.slice(bo.bo, n + 1)) / bo.pivot - 1 >= 0.10;
    if (rising21 && ran && last.low <= e21[n] * 1.01 && close >= e21[n] * 0.995 && close <= e21[n] * 1.02 && light(2) && !(s50[n] && close <= s50[n] * 1.03))
      out.push({ code: 'pull21:' + bo.bo + ':' + Math.floor(n / 5), level: 'add', price: r2(e21[n]), title: 'Add-on: pullback to the 21-day line', text: `The stock ran ${Math.round((Math.max(...c.slice(bo.bo, n + 1)) / bo.pivot - 1) * 100)}% past its buy point and is pulling back quietly to its rising 21-day line (${r2(e21[n])}): an add-on point IBD uses for strong leaders.${gainTxt}` });
  }
  return out;
}
