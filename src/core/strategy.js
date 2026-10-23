// Buying plan ("pyramiding"): each position has the same target size (e.g. 20% of the portfolio) and is
// bought in shrinking steps while the stock proves itself inside the buy zone (0–5% above the buy point):
// 50% at the breakout, 35% once it is 1–2% up, the last 15% near +5%. A stop sits 5–8% below the buy point.
// Pure functions: amounts, the next step for a position, and portfolio-level checks.

export const DEFAULT_PLAN = {
  capital: 208000,        // portfolio value in the plan currency
  ccy: 'EUR',
  posPct: 0.20,           // target size of one position (share of the portfolio)
  tranches: [0.50, 0.35, 0.15],
  add2: [0.01, 0.02],     // second buy: 1–2% above the buy point
  add3: [0.04, 0.05],     // third buy: 4–5% above the buy point (top of the buy zone)
  zone: 0.05,             // the buy zone ends 5% above the buy point
  stop: 0.07,             // stop 5–8% below the buy point (7% by default)
  earningsDays: 14,       // no new buys within this many days before an earnings report
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

/** Shares for an amount at a price; fx = plan-currency units per 1 unit of the listing currency. */
export const sharesFor = (amount, price, fx = 1) => price > 0 && fx > 0 ? Math.floor(amount / (price * fx)) : 0;

/**
 * Next step for a planned position.
 * pos: {pivot, buys: [{price, shares}], closed?}; q: {close, s50, s50prev, nextReport (epoch s), now (epoch s), market ('up'|'press'|'corr'), fx}
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
  if (c < py.stop) return out('stop', 'stop', n ? 'Stop hit: sell' : 'Setup failed', n ? `Close ${c} is more than ${Math.round(P.stop * 100)}% below the buy point ${pv} (stop ${py.stop}). Cut the loss.` : `The stock fell more than ${Math.round(P.stop * 100)}% below the buy point. Drop the plan or wait for a new base.`);
  const soon = q.nextReport && q.now && q.nextReport > q.now && (q.nextReport - q.now) / 86400 <= P.earningsDays;
  const earnTxt = soon ? `Earnings in ${Math.ceil((q.nextReport - q.now) / 86400)} days: don't open or add right before the report.` : '';
  const mktTxt = q.market === 'corr' ? 'The market is in a correction: new buys are risky.' : q.market === 'press' ? 'The uptrend is under pressure: be selective.' : '';
  if (step) {
    const amt = step.amount, sh = sharesFor(amt, c, q.fx || 1);
    const inRange = n === 0 ? up >= 0 && up <= P.zone : up >= (n === 1 ? P.add2[0] : P.add3[0]) && up <= P.zone;
    if (inRange) {
      if (soon) return out('earnings', 'warn', `Buy ${n + 1} on hold`, earnTxt);
      const title = n === 0 ? 'Buy 1 now' : `Add ${n + 1} now`;
      return out(n === 0 ? 'buy1' : 'add' + (n + 1), n === 0 ? 'buy' : 'add', title, `${up >= 0 ? '+' : ''}${(up * 100).toFixed(1)}% above the buy point ${pv}. ${n === 0 ? 'First' : n === 1 ? 'Second' : 'Third'} buy: ${Math.round(step.pct * 100)}% of the position ≈ ${amt.toLocaleString('en-US')} ${P.ccy}${sh ? ` (${sh} shares)` : ''}.${mktTxt ? ' ' + mktTxt : ''}`, { amount: amt, shares: sh, step: n + 1 });
    }
    if (up < 0) return out('below', 'wait', n === 0 ? 'Wait for the breakout' : 'Below the buy point', n === 0 ? `Buy 1 when the stock trades above ${pv} (up to ${py.zoneTop}), ideally on volume at least 40% above average.` : `Back below the buy point ${pv}: no adds; the stop is ${py.stop}.`);
    if (up > P.zone) return out('extended', 'wait', 'Extended: don\'t chase', `${(up * 100).toFixed(1)}% above the buy point, past the ${Math.round(P.zone * 100)}% buy zone. ${n ? 'Hold what you have; add later at the 50-day line or from a new base.' : 'Wait for a pullback to the 50-day line or a new base.'}`);
    const nextAt = n === 1 ? py.steps[1].from : py.steps[2].from;
    return out('wait-add', 'hold', `Next add at ${nextAt}`, `Add ${n + 1} (${Math.round(step.pct * 100)}% ≈ ${step.amount.toLocaleString('en-US')} ${P.ccy}) when the stock is ${n === 1 ? Math.round(P.add2[0] * 100) + '–' + Math.round(P.add2[1] * 100) : Math.round(P.add3[0] * 100) + '–' + Math.round(P.zone * 100)}% above the buy point.`);
  }
  // fully invested: follow-on buys at a rising 50-day line, while in profit
  if (q.s50 && q.s50prev && q.s50 > q.s50prev && avg && c > avg && c >= q.s50 && c / q.s50 - 1 <= P.add50) {
    if (soon) return out('earnings', 'warn', '50-day add on hold', earnTxt);
    return out('add50', 'add', 'Add at the 50-day line', `The stock pulled back to its rising 50-day line (${r2(q.s50)}) and you are in profit: a follow-on buy is possible.${mktTxt ? ' ' + mktTxt : ''}`);
  }
  return out('full', 'hold', 'Fully invested', `All ${py.steps.length} buys done. Hold while the stock acts well; sell rules apply.`);
}

/**
 * Portfolio checks from the notes: equal-size positions, the best performers should be the biggest,
 * move money from laggards into leaders. rows: [{sym, value, gain (fraction vs cost)}]. Returns messages.
 */
export function sizingChecks(plan, rows, total) {
  const P = { ...DEFAULT_PLAN, ...plan }, out = [];
  if (!rows.length || !total) return out;
  const w = rows.map(r => ({ ...r, w: r.value / total })).filter(r => r.gain != null);
  w.filter(r => r.w > P.posPct * 1.25).forEach(r => out.push({ level: 'warn', sym: r.sym, text: `${r.sym} is ${Math.round(r.w * 100)}% of the portfolio, above your ${Math.round(P.posPct * 100)}% target per position.` }));
  if (w.length >= 2) {
    const byGain = [...w].sort((a, b) => b.gain - a.gain), best = byGain[0], worst = byGain[byGain.length - 1];
    if (worst.gain < 0 && worst.w > best.w) out.push({ level: 'warn', sym: worst.sym, text: `Your weakest position ${worst.sym} (${(worst.gain * 100).toFixed(0)}%) is bigger than your best ${best.sym} (+${(best.gain * 100).toFixed(0)}%). Consider shifting money from the laggard into the leader.` });
    w.filter(r => r.gain <= -P.stop).forEach(r => out.push({ level: 'bad', sym: r.sym, text: `${r.sym} is ${(r.gain * 100).toFixed(0)}% below your cost: past the ${Math.round(P.stop * 100)}% stop.` }));
  }
  return out;
}
