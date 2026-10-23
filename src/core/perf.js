// Portfolio evolution and performance, including cash, margin, deposits and withdrawals.
//
// The history is rebuilt backwards from today: start with today's holdings and cash, and step back one trading day
// at a time, undoing that day's trades (from the journal) and cash flows (deposits/withdrawals). The value on each
// day uses that day's closing prices. Before the first recorded event the holdings are assumed unchanged.
//
// Two ways to measure the result:
//  - absolute: equity at the end − equity at the start − net deposits (money made, in the base currency)
//  - time-weighted return (TWR): each day's return excludes that day's deposits/withdrawals, and the daily returns
//    are chained. Deposits and withdrawals don't count as gains or losses. Example: 1,000 → 2,000 is +100%; then
//    withdrawing 1,000 leaves 1,000, still +100% TWR, with 1,000 made in absolute terms and 1,000 taken out.

const DAY = 86400;
const dayOf = t => Math.floor(t / DAY) * DAY;

/** Last value at or before t in ascending [{time, close}] (binary search), or null. */
export function closeAt(bars, t) {
  if (!bars || !bars.length || t < bars[0].time) return null;
  let lo = 0, hi = bars.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bars[m].time <= t) lo = m; else hi = m; }
  return bars[hi].time <= t ? bars[hi].close : bars[lo].close;
}

/**
 * holdings: [{sym, shares}] today. cash: today's cash in the base currency (negative = margin loan).
 * prices: {sym: ascending daily bars in the listing currency}. fx: (cur, t) => base units per 1 unit of cur.
 * cur: {sym: listing currency}. trades: journal entries [{t, sym, side: 'buy'|'sell', shares, price, cur}].
 * flows: [{t, amount}] in the base currency (+ deposit, − withdrawal). from: first day to include (epoch s).
 * Returns {days: [{t, stocks, cash, equity, flow, ret, twr, made}], ...summary}.
 */
export function evolution({ holdings, cash, prices, fx, cur, trades = [], flows = [], from }) {
  // the calendar: every day any holding (or a traded stock) has a price, from `from` to today
  const syms = new Set([...holdings.map(h => h.sym), ...trades.map(t => t.sym)]);
  const daySet = new Set();
  for (const s of syms) for (const b of prices[s] || []) if (b.time >= from) daySet.add(dayOf(b.time));
  const days = [...daySet].sort((a, b) => a - b);
  if (!days.length) return null;
  const shares = new Map(holdings.map(h => [h.sym, h.shares]));
  let c = cash;
  const ev = [...trades.map(t => ({ ...t, kind: 'trade' })), ...flows.map(f => ({ ...f, kind: 'flow' }))].filter(e => e.t >= days[0]).sort((a, b) => b.t - a.t);
  let k = 0; const out = new Array(days.length);
  const undo = e => {
    if (e.kind === 'flow') { c -= e.amount; return e.amount; }
    const amt = e.shares * e.price * fx(e.cur || cur[e.sym], dayOf(e.t));
    if (e.side === 'buy') { shares.set(e.sym, (shares.get(e.sym) || 0) - e.shares); c += amt; }
    else { shares.set(e.sym, (shares.get(e.sym) || 0) + e.shares); c -= amt; }
    return 0;
  };
  // events after the last trading day (e.g. a weekend deposit) are already in today's figures: undo them first
  const lastDay = days[days.length - 1];
  while (k < ev.length && dayOf(ev[k].t) > lastDay) undo(ev[k++]);
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i], prevDay = i ? days[i - 1] : -Infinity;
    let stocks = 0;
    for (const [s2, n] of shares) { if (!n) continue; const p = closeAt(prices[s2], d + DAY - 1); if (p != null) stocks += n * p * fx(cur[s2], d); }
    out[i] = { t: d, stocks, cash: c, equity: stocks + c, flow: 0 };
    // the close of day d includes everything since the previous trading day: undo those events
    if (i) while (k < ev.length && dayOf(ev[k].t) > prevDay) out[i].flow += undo(ev[k++]);
  }
  // time-weighted return and money made
  let twr = 1, made = 0;
  out.forEach((x, i) => {
    if (i === 0) { x.ret = 0; x.twr = 0; x.made = 0; return; }
    const prev = out[i - 1].equity;
    x.ret = prev > 0 ? (x.equity - x.flow) / prev - 1 : 0;
    twr *= 1 + x.ret; x.twr = twr - 1;
    made += x.equity - prev - x.flow; x.made = made;
  });
  const first = out[0], last = out[out.length - 1], netFlows = out.slice(1).reduce((s, x) => s + x.flow, 0);
  let peak = -Infinity, mdd = 0; out.forEach(x => { const v = 1 + x.twr; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  return { days: out, start: first.equity, end: last.equity, netFlows, made: last.equity - first.equity - netFlows, twr: last.twr, mdd };
}

/** Today's account: stocks, cash, margin and leverage. */
export function account(stocks, cash) {
  const equity = stocks + cash, margin = cash < 0 ? -cash : 0;
  return { stocks, cash, equity, margin, cashPct: equity ? Math.max(0, cash) / (stocks + Math.max(0, cash)) : 0, stockPct: equity ? stocks / (stocks + Math.max(0, cash)) : 0, leverage: equity > 0 ? stocks / equity : null };
}

/**
 * Evolution from dated holdings snapshots (monthly broker statements), moving forward in time.
 * snaps: [{t, holdings: [{sym, shares, price?, cur?}], other (base, positions without prices), cash (base)}]; the
 * last one is usually today. Between two snapshots the holdings of the earlier one are priced daily and the events
 * are applied: trades {kind: 'trade', t, sym, side, shares, amount (base)}, cash events {kind: 'cash', t, amount}
 * (dividends, costs, taxes, interest) and flows {kind: 'flow', t, amount} (deposits/withdrawals). On each snapshot
 * date the state is reset to the snapshot, so the value is exact there whatever was missed in between.
 */
export function evolutionSnaps({ snaps, prices, fx, cur, events = [], from = 0 }) {
  if (!snaps.length) return null;
  snaps = [...snaps].sort((a, b) => a.t - b.t);
  const first = dayOf(snaps[0].t), last = dayOf(snaps[snaps.length - 1].t), start = Math.max(dayOf(from), first);
  const syms = new Set([...snaps.flatMap(s => s.holdings.map(h => h.sym)), ...events.filter(e => e.kind === 'trade').map(e => e.sym)]);
  const daySet = new Set();
  for (const s of syms) for (const b of prices[s] || []) { const d = dayOf(b.time); if (d >= start && d <= last) daySet.add(d); }
  daySet.add(Math.max(start, first)); daySet.add(last);
  const days = [...daySet].filter(d => d >= start).sort((a, b) => a - b);
  // one queue: events, then the snapshot of the same day (a snapshot is the state at the end of its day)
  const Q = [...events.map(e => ({ ...e, day: dayOf(e.t), o: 0 })), ...snaps.map(s => ({ ...s, kind: 'snap', day: dayOf(s.t), o: 1 }))]
    .filter(e => e.day >= first).sort((a, b) => a.day - b.day || a.o - b.o || a.t - b.t);
  const shares = new Map(), px = new Map(); let cash = 0, other = 0, q = 0;
  const apply = e => {
    if (e.kind === 'snap') {
      shares.clear(); e.holdings.forEach(h => { shares.set(h.sym, h.shares); if (h.price) px.set(h.sym, { p: h.price, cur: h.cur }); });
      cash = e.cash; other = e.other || 0; return 0;
    }
    if (e.kind === 'trade') { const s = e.side === 'buy' ? 1 : -1; shares.set(e.sym, (shares.get(e.sym) || 0) + s * e.shares); cash -= s * e.amount; return 0; }
    cash += e.amount; return e.kind === 'flow' ? e.amount : 0;
  };
  const out = [];
  for (const d of days) {
    let flow = 0;
    while (q < Q.length && Q[q].day <= d) flow += apply(Q[q++]);
    let stocks = other;
    for (const [s, n] of shares) {
      if (!n) continue;
      const p = closeAt(prices[s], d + DAY - 1), c = cur[s] || (px.get(s) || {}).cur;
      if (p != null) stocks += n * p * fx(c, d); else if (px.has(s)) stocks += n * px.get(s).p * fx(px.get(s).cur, d);
    }
    out.push({ t: d, stocks, cash, equity: stocks + cash, flow: out.length ? flow : 0, snap: Q.slice(0, q).some(e => e.kind === 'snap' && e.day === d) });
  }
  let twr = 1, made = 0;
  out.forEach((x, i) => {
    if (i === 0) { x.ret = 0; x.twr = 0; x.made = 0; return; }
    const prev = out[i - 1].equity;
    x.ret = prev > 0 ? (x.equity - x.flow) / prev - 1 : 0;
    twr *= 1 + x.ret; x.twr = twr - 1; made += x.equity - prev - x.flow; x.made = made;
  });
  const a = out[0], z = out[out.length - 1], netFlows = out.slice(1).reduce((s, x) => s + x.flow, 0);
  let peak = -Infinity, mdd = 0; out.forEach(x => { const v = 1 + x.twr; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  return { days: out, start: a.equity, end: z.equity, netFlows, made: z.equity - a.equity - netFlows, twr: z.twr, mdd };
}
