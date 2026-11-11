// Buying plan ("pyramiding"): each position has the same target size (e.g. 20% of the portfolio) and is
// bought in shrinking steps while the stock proves itself inside the buy zone (0–5% above the buy point):
// 50% at the breakout, 35% once it is 1–2% up, the last 15% near +5%. Sell rules from How to Make Money in Stocks:
// cut the loss 7–8% below the purchase price; at +15% raise the sell line to just below the buy point; a stock that
// rose ~20% must not turn into a loss; take most profits at +20–25% (here: a third at +20%, a third at +25%, the last
// third rides the 50-day line), but a stock that gains 20% within 3 weeks of the breakout is held at least 8 weeks.
// Pure functions: amounts, the next step for a position, and portfolio-level checks.

export const DEFAULT_PLAN = {
  capital: 100000,        // portfolio value in the plan currency
  ccy: 'EUR',
  posPct: 0.20,           // target size of one position (share of the portfolio)
  tranches: [0.50, 0.35, 0.15],
  add2: [0.01, 0.02],     // second buy: 1–2% above the buy point
  add3: [0.04, 0.05],     // third buy: 4–5% above the buy point (top of the buy zone)
  zone: 0.05,             // the buy zone ends 5% above the buy point
  stop: 0.07,             // cut losses 7–8% below the purchase price (the book) or 5–8% below the buy point (7% by default)
  stopFrom: 'cost',       // 'cost': from your average purchase price (the book) · 'pivot': from the buy point
  profit: [0.20, 0.25],   // take most profits at +20–25%
  sellSteps: [[0.20, 1 / 3], [0.25, 1 / 3]], // how: a third at +20%, a third at +25% (gain on your average price);
                          // the last third rides until a close below the 50-day line or a climax top
  fastWeeks: 3,           // +20% within 3 weeks of the breakout: hold at least 8 weeks (the book's exception)
  earningsDays: 14,       // no new buys within this many days before an earnings report
  capitalMode: 'auto',    // 'auto': the portfolio value = your stocks at today's prices + cash; 'manual': the number above
  maxMargin: 0.5,         // margin loan at most 50% of your own money (150% invested), only in a confirmed uptrend
  add50: 0.02,            // follow-on buy: close within 0–2% above a rising 50-day line
};

const r2 = x => Math.round(x * 100) / 100;

/** Tranche table for a buy point: [{n, pct, amount, from, to}], plus target and stop price. Amounts in the plan currency. */
export function pyramid(plan, pivot) {
  const P = { ...DEFAULT_PLAN, ...plan }, target = P.capital * P.posPct;
  const ranges = [[0, Math.min(P.add2[0], P.zone)], P.add2, P.add3];
  const steps = P.tranches.map((pct, i) => ({
    n: i + 1, pct, amount: Math.round(target * pct),
    from: pivot ? r2(pivot * (1 + (ranges[i] || ranges[ranges.length - 1])[0])) : null,
    to: pivot ? r2(pivot * (1 + (ranges[i] || ranges[ranges.length - 1])[1])) : null,
  }));
  return { target: Math.round(target), steps, stop: pivot ? r2(pivot * (1 - P.stop)) : null, zoneTop: pivot ? r2(pivot * (1 + P.zone)) : null };
}

/**
 * The whole plan for a buy point, for display: the buy steps, the expected average price, the stop, the stop raises,
 * the profit steps and what is left to ride. fx = plan-currency units per 1 unit of the listing currency.
 */
export function tradePlan(plan, pivot, fx = 1) {
  const P = { ...DEFAULT_PLAN, ...plan }, py = pyramid(P, pivot);
  const buys = py.steps.map(s => ({ ...s, shares: sharesFor(s.amount, s.from, fx) }));
  const shares = buys.reduce((t, b) => t + b.shares, 0), cost = buys.reduce((t, b) => t + b.shares * b.from, 0);
  const avg = shares ? cost / shares : pivot * (1 + P.add2[0] * P.tranches[1] + P.add3[0] * (P.tranches[2] || 0));
  const stop = r2((P.stopFrom === 'cost' ? avg : pivot) * (1 - P.stop));
  let left = shares;
  const sells = P.sellSteps.map(([g, f], i) => { const sh = Math.round(shares * f); left -= sh; return { gain: g, frac: f, price: r2(avg * (1 + g)), shares: sh, profit: sh * avg * g * fx }; });
  return {
    target: py.target, buys, shares, avg: r2(avg), zoneTop: py.zoneTop, stop, risk: shares * Math.max(0, avg - stop) * fx,
    raise15: { price: r2(avg * 1.15), to: r2(pivot * 0.97) }, raise20: { price: r2(avg * 1.20), to: r2(avg) },
    failed: r2(pivot * 0.98), sells, runner: { shares: left, frac: Math.max(0, 1 - P.sellSteps.reduce((t, x) => t + x[1], 0)) },
    fastWeeks: P.fastWeeks,
  };
}

/** Shares for an amount at a price; fx = plan-currency units per 1 unit of the listing currency. */
export const sharesFor = (amount, price, fx = 1) => price > 0 && fx > 0 ? Math.floor(amount / (price * fx)) : 0;

/**
 * Next step for a planned position.
 * pos: {pivot, buys: [{t, price, shares}], closed?}; q: {close, s50, s50prev, nextReport (epoch s), now (epoch s), market ('up'|'press'|'corr'), fx,
 *   peak (highest close since the first buy)}
 * Returns {code, level: 'buy'|'add'|'stop'|'wait'|'hold'|'warn', title, text, amount?, shares?}.
 */
export function nextStep(plan, pos, q) {
  const P = { ...DEFAULT_PLAN, ...plan }, py = pyramid(P, pos.pivot), c = q.close, pv = pos.pivot;
  const n = (pos.buys || []).length, up = pv ? c / pv - 1 : null;
  const invested = (pos.buys || []).reduce((s, b) => s + b.price * b.shares, 0), shares = (pos.buys || []).reduce((s, b) => s + b.shares, 0);
  const avg = shares ? invested / shares : null;
  const step = py.steps[n];
  const out = (code, level, title, text, extra = {}) => ({ code, level, title, text, up, avg, ...extra });
  if (pos.closed) return out('closed', 'hold', 'Closed', 'Position closed.');
  if (!pv) return out('nopivot', 'wait', 'Set a buy point', 'Enter the buy point (pivot) to get buy and stop levels.');
  // the sell line: 7–8% under the purchase price (or the buy point), raised at +15% and to breakeven after ~+20%
  const peak = Math.max(q.peak || 0, c), gainPk = avg ? peak / avg - 1 : 0;
  let stop = n && P.stopFrom === 'cost' && avg ? r2(avg * (1 - P.stop)) : py.stop, stopWhy = n && P.stopFrom === 'cost' ? `${Math.round(P.stop * 100)}% below your average price ${r2(avg)}` : `${Math.round(P.stop * 100)}% below the buy point ${pv}`;
  if (n && gainPk >= 0.15 && pv * 0.97 > stop) { stop = r2(pv * 0.97); stopWhy = 'raised to just below the buy point after a 15% gain'; }
  if (n && gainPk >= 0.20 && avg > stop) { stop = r2(avg); stopWhy = 'breakeven: a stock that rose 20% must not turn into a loss'; }
  if (c < stop) return out('stop', 'stop', n ? 'Stop hit: sell' : 'Setup failed', n ? `Close ${c} is below your sell line ${stop} (${stopWhy}). Sell without hesitating.` : `The stock fell more than ${Math.round(P.stop * 100)}% below the buy point. Drop the plan or wait for a new base.`, { stop });
  const soon = q.nextReport && q.now && q.nextReport > q.now && (q.nextReport - q.now) / 86400 <= P.earningsDays;
  const earnTxt = soon ? `Earnings in ${Math.ceil((q.nextReport - q.now) / 86400)} days: don't open or add right before the report.` : '';
  const mktTxt = q.market === 'corr' ? 'The market is in a correction: new buys are risky.' : q.market === 'press' ? 'The uptrend is under pressure: be selective.' : '';
  // taking profits (also when not all buys were made): a third at +20%, a third at +25%, the rest rides the 50-day line
  const total = (pos.buys || []).reduce((t, b) => t + b.shares, 0), sold = Math.min(total, pos.sold || 0), held = total - sold, gain = avg ? c / avg - 1 : 0;
  if (n && avg && held > 0 && (gain >= P.sellSteps[0][0] || sold > 0)) {
    const first = pos.buys[0].t, until8 = first ? first + 8 * 604800 : null;
    const fast = q.t20 && first && q.t20 - first <= P.fastWeeks * 7 * 86400;
    if (fast && q.now < until8) return out('hold8', 'hold', 'Hold: 8-week rule', `The stock gained 20% within ${P.fastWeeks} weeks of your first buy: the book's exception for the strongest stocks. Hold the whole position at least until ${new Date(until8 * 1000).toISOString().slice(0, 10)} (8 weeks), unless it breaks down badly. Sell line: ${stop}.`, { stop });
    let cum = 0;
    for (let k = 0; k < P.sellSteps.length; k++) {
      const [lvl, frac] = P.sellSteps[k]; cum += frac;
      if (gain >= lvl && sold < Math.round(total * cum) - 0.5) {
        const sh = Math.min(held, Math.round(total * cum) - sold), fr = frac === 1 / 3 ? 'a third' : Math.round(frac * 100) + '%';
        return out('take' + (k + 1), 'warn', `Take profits: sell ${fr}`, `Up ${Math.round(gain * 100)}% on your average price ${r2(avg)}. Sell ${fr} of the position: ${sh} share${sh === 1 ? '' : 's'}. ${k + 1 < P.sellSteps.length ? `Next: another part at +${Math.round(P.sellSteps[k + 1][0] * 100)}% (${r2(avg * (1 + P.sellSteps[k + 1][0]))}).` : 'Let the rest ride while it holds above the 50-day line.'} Sell line for the rest: ${stop}.`, { stop, shares: sh, sell: true });
      }
    }
    if (sold >= Math.round(total * cum) - 0.5) {
      if (q.s50 && c < q.s50) return out('runner-sell', 'stop', 'Sell the rest', `The last part closed below the 50-day line (${r2(q.s50)}): sell the remaining ${held} share${held === 1 ? '' : 's'}.`, { stop, shares: held, sell: true });
      return out('runner', 'hold', 'Let the rest ride', `${held} share${held === 1 ? '' : 's'} left. Hold while the stock stays above its 50-day line${q.s50 ? ' (' + r2(q.s50) + ')' : ''}; sell on a heavy-volume close below it, or on a climax top. Never below ${Math.max(stop, r2(avg))}.`, { stop: Math.max(stop, r2(avg)) });
    }
    const nx = P.sellSteps.find(([lvl], k) => sold < Math.round(total * P.sellSteps.slice(0, k + 1).reduce((t, x) => t + x[1], 0)) - 0.5);
    if (nx) return out('wait-take', 'hold', `Next sale at +${Math.round(nx[0] * 100)}%`, `Part of the profit is taken. Sell the next ${nx[1] === 1 / 3 ? 'third' : Math.round(nx[1] * 100) + '%'} at ${r2(avg * (1 + nx[0]))}. Sell line: ${stop}.`, { stop });
  }
  if (step && q.market === 'corr' && up != null && up >= 0) return out('mkt-corr', 'warn', 'No buys: market in correction', `The market is in a correction: no new buys and no margin (the book: 0–20% invested). Wait for a follow-through day; ${n ? 'keep the stop on what you hold' : 'keep the buy point on your watchlist'}.`);
  if (step) {
    const amt = step.amount, sh = sharesFor(amt, c, q.fx || 1);
    const inRange = n === 0 ? up >= 0 && up <= P.zone : up >= (n === 1 ? P.add2[0] : P.add3[0]) && up <= P.zone;
    if (inRange) {
      if (soon) return out('earnings', 'warn', `Buy ${n + 1} on hold`, earnTxt);
      const title = n === 0 ? 'Buy 1 now' : `Add ${n + 1} now`;
      return out(n === 0 ? 'buy1' : 'add' + (n + 1), n === 0 ? 'buy' : 'add', title, `${up >= 0 ? '+' : ''}${(up * 100).toFixed(1)}% above the buy point ${pv}. ${n === 0 ? 'First' : n === 1 ? 'Second' : 'Third'} buy: ${Math.round(step.pct * 100)}% of the position ≈ ${amt.toLocaleString('en-US')} ${P.ccy}${sh ? ` (${sh} shares)` : ''}.${mktTxt ? ' ' + mktTxt : ''}`, { amount: amt, shares: sh, step: n + 1 });
    }
    if (up < 0) return out('below', 'wait', n === 0 ? 'Wait for the breakout' : 'Below the buy point', n === 0 ? `Buy 1 when the stock trades above ${pv} (up to ${py.zoneTop}), ideally on volume at least 50% above average.` : `Back below the buy point ${pv}: no adds; the stop is ${py.stop}.`);
    if (up > P.zone) return out('extended', 'wait', 'Extended: don\'t chase', `${(up * 100).toFixed(1)}% above the buy point, past the ${Math.round(P.zone * 100)}% buy zone. ${n ? 'Hold what you have; add later at the 50-day line or from a new base.' : 'Wait for a pullback to the 50-day line or a new base.'}`);
    const nextAt = n === 1 ? py.steps[1].from : py.steps[2].from;
    return out('wait-add', 'hold', `Next add at ${nextAt}`, `Add ${n + 1} (${Math.round(step.pct * 100)}% ≈ ${step.amount.toLocaleString('en-US')} ${P.ccy}) when the stock is ${n === 1 ? Math.round(P.add2[0] * 100) + '–' + Math.round(P.add2[1] * 100) : Math.round(P.add3[0] * 100) + '–' + Math.round(P.zone * 100)}% above the buy point.`);
  }
  // fully invested: follow-on buys at a rising 50-day line, while in profit
  if (q.s50 && q.s50prev && q.s50 > q.s50prev && avg && c > avg && c >= q.s50 && c / q.s50 - 1 <= P.add50) {
    if (soon) return out('earnings', 'warn', '50-day add on hold', earnTxt);
    return out('add50', 'add', 'Add at the 50-day line', `The stock pulled back to its rising 50-day line (${r2(q.s50)}) and you are in profit: a follow-on buy is possible.${mktTxt ? ' ' + mktTxt : ''}`);
  }
  return out('full', 'hold', 'Fully invested', `All ${py.steps.length} buys done. Hold while the stock acts well. Sell line: ${stop} (${stopWhy}).`, { stop });
}

/**
 * Portfolio checks from the notes: equal-size positions, the best performers should be the biggest,
 * move money from laggards into leaders. rows: [{sym, value, gain (fraction vs cost)}]. Returns messages.
 */
export function sizingChecks(plan, rows, total) {
  const P = { ...DEFAULT_PLAN, ...plan }, out = [];
  if (!rows.length || !total) return out;
  const all = rows.map(r => ({ ...r, w: r.value / total })), w = all.filter(r => r.gain != null);
  // position size against your own limit (e.g. 20% of the account, cash included)
  all.filter(r => r.w > P.posPct + 0.005).forEach(r => out.push({ kind: 'size', level: r.w > P.posPct * 1.5 ? 'bad' : 'warn', sym: r.sym, text: `${r.sym} is ${Math.round(r.w * 100)}% of your account, above your ${Math.round(P.posPct * 100)}% limit per position.` }));
  if (w.length >= 2) {
    const byGain = [...w].sort((a, b) => b.gain - a.gain), best = byGain[0], worst = byGain[byGain.length - 1];
    if (worst.gain < 0 && worst.w > best.w) out.push({ level: 'warn', sym: worst.sym, text: `Your weakest position ${worst.sym} (${(worst.gain * 100).toFixed(0)}%) is bigger than your best ${best.sym} (+${(best.gain * 100).toFixed(0)}%). Consider shifting money from the laggard into the leader.` });
    w.filter(r => r.gain <= -P.stop).forEach(r => out.push({ level: 'bad', sym: r.sym, text: `${r.sym} is ${(r.gain * 100).toFixed(0)}% below your cost: past the ${Math.round(P.stop * 100)}% stop.` }));
  }
  return out;
}
