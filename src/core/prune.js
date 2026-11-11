// "Sell ideas": which of the stocks you own to sell first when you hold too many, or need room for a new leader.
// Built on the book and your playbook: keep at most ~8 stocks; to add a new one, sell the weakest; cut every loss at
// 7–8%; sell laggards and keep the leaders ("weed the garden"); money in a stock that goes nowhere could work in a
// leader. Hard sell rules come first; the rest is ranked by a keep score (0–100, higher = keep).
// Pure functions: bars + detector result + your cost → a verdict with reasons.
import { sma } from './indicators.js';
import { adGrade } from './earnings.js';

const pct = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%';
const chg = (c, k) => c.length > k ? c[c.length - 1] / c[c.length - 1 - k] - 1 : null;

/**
 * One holding. h: {sym, cost, shares}; bars: daily bars; R: PAT.scan(bars); bench: index closes [{time, close}] (optional);
 * rs: strength rank 1–99 from the scan (optional); sells: chart sell signals (screenRow(...).sell, optional);
 * stop: your stop (fraction, default 0.07).
 * Returns {sym, score, verdict: 'sell'|'weak'|'dead'|'hold'|'leader', title, reasons: [[tone, text]], m: metrics}.
 */
export function assessHolding(h, bars, R, { bench = null, rs = null, sells = [], stop = 0.07 } = {}) {
  const c = bars.map(b => b.close), n = c.length - 1, close = c[n];
  const s50 = sma(c, 50), s200 = sma(c, 200);
  const m = {
    gain: h.cost ? close / h.cost - 1 : null, m1: chg(c, 21), m3: chg(c, 63), m6: chg(c, 126), w8: chg(c, 40),
    above50: s50[n] != null ? close > s50[n] : null, above200: s200[n] != null ? close > s200[n] : null,
    rising50: s50[n] != null && s50[n - 10] != null ? s50[n] > s50[n - 10] : null, rs,
    ad: (adGrade(bars) || {}).grade || null, off: close / Math.max(...bars.slice(-252).map(b => b.high)) - 1,
  };
  // relative to the market over 3 months (the index the RS line uses)
  if (bench && bench.length > 70) {
    const bc = bench.map(b => b.close), bm3 = chg(bc, 63);
    if (bm3 != null && m.m3 != null) m.rel3 = (1 + m.m3) / (1 + bm3) - 1;
  }
  const reasons = [];
  // 1. hard rules first: these say sell regardless of the score
  const hard = [];
  if (m.gain != null && m.gain <= -stop) hard.push(`${pct(m.gain)} on your average price: past your ${Math.round(stop * 100)}% stop. The book's first rule: cut every loss at 7–8%.`);
  if (m.above200 === false && s200[n - 20] != null && s200[n] < s200[n - 20]) hard.push('Below a falling 200-day line: a long-term downtrend.');
  for (const s of sells || []) if (/Failed breakout|stop|Heavy-volume break of the 50-day/.test(s)) hard.push(s + '.');

  // 2. keep score (higher = stronger)
  let sc = 0;
  const rsPts = rs != null ? rs / 99 * 25 : m.rel3 != null ? Math.max(0, Math.min(25, 12.5 + m.rel3 * 62.5)) : 12.5; // ±20% vs the market = full range
  sc += rsPts;
  sc += (m.above50 ? 10 : 0) + (m.above200 ? 10 : 0) + (m.rising50 ? 5 : 0);
  sc += m.m3 == null ? 10 : Math.max(0, Math.min(20, 10 + m.m3 * 50)); // −20%..+20% over 3 months
  const moving = m.w8 == null ? 5 : m.w8 >= 0.05 ? 10 : m.w8 > -0.05 ? 3 : 0;
  sc += moving;
  sc += m.gain == null ? 5 : m.gain >= 0.10 ? 10 : m.gain >= 0 ? 6 : m.gain > -0.05 ? 3 : 0;
  sc += { A: 10, B: 8, C: 5, D: 2, E: 0 }[m.ad] ?? 5;
  const score = Math.round(Math.max(0, Math.min(100, sc)));

  // 3. reasons in plain words
  if (rs != null) reasons.push([rs >= 80 ? 'ok' : rs < 50 ? 'bad' : 'warn', `Strength rank ${rs} (1–99)${rs >= 80 ? ': a leader' : rs < 50 ? ': a laggard' : ''}.`]);
  else if (m.rel3 != null) reasons.push([m.rel3 >= 0.05 ? 'ok' : m.rel3 < -0.05 ? 'bad' : 'warn', `${pct(m.rel3)} vs the market over 3 months.`]);
  reasons.push([m.above50 && m.above200 ? 'ok' : m.above200 === false ? 'bad' : 'warn', m.above50 && m.above200 ? 'Above its 50- and 200-day lines.' : m.above200 === false ? 'Below its 200-day line.' : 'Below its 50-day line.']);
  if (m.w8 != null) reasons.push([m.w8 >= 0.05 ? 'ok' : m.w8 > -0.05 ? 'warn' : 'bad', m.w8 > -0.05 && m.w8 < 0.05 ? `Hardly moved in 8 weeks (${pct(m.w8)}): money standing still.` : `${pct(m.w8)} in 8 weeks.`]);
  if (m.gain != null && !(m.gain <= -stop)) reasons.push([m.gain >= 0.1 ? 'ok' : m.gain < 0 ? 'bad' : 'warn', `${pct(m.gain)} on your average price.`]);
  if (m.ad) reasons.push([m.ad <= 'B' ? 'ok' : m.ad >= 'D' ? 'bad' : 'warn', `Accumulation/distribution ${m.ad} (${m.ad <= 'B' ? 'funds buying' : m.ad >= 'D' ? 'funds selling' : 'neutral'}).`]);

  let verdict, title;
  if (hard.length) { verdict = 'sell'; title = 'Sell: a sell rule is broken'; hard.slice().reverse().forEach(t => reasons.unshift(['bad', t])); }
  else if (score >= 75) { verdict = 'leader'; title = 'Keep: one of your leaders'; }
  else if (m.w8 != null && Math.abs(m.w8) < 0.05 && (m.m3 == null || Math.abs(m.m3) < 0.08) && score < 60) { verdict = 'dead'; title = 'Not moving: money standing still'; }
  else if (score < 45) { verdict = 'weak'; title = 'Weak: a candidate to sell'; }
  else { verdict = 'hold'; title = 'Hold: acting normally'; }
  return { sym: h.sym, score, verdict, title, reasons, m };
}

const ORDER = { sell: 0, weak: 1, dead: 2, hold: 3, leader: 4 };
/**
 * Ranks assessed holdings, weakest first, and says how many to sell to get back to `max` stocks.
 * Returns {list (weakest first), over, sellNow, suggest: [sym] (sells to get within max), room: sym (first to sell for a new buy)}.
 */
export function rankHoldings(items, { max = 8 } = {}) {
  const list = items.slice().sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.score - b.score);
  const sellNow = list.filter(x => x.verdict === 'sell').map(x => x.sym);
  const over = Math.max(0, items.length - max);
  // to get within the limit: the stocks with a broken rule first, then the weakest of the rest
  const suggest = list.slice(0, over).map(x => x.sym);
  return { list, over, sellNow, suggest, room: list.length ? list[0].sym : null };
}
