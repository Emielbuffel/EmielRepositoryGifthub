// Trade review: your closed trades (a position opened from zero and sold back to zero), with the numbers O'Neil asks
// you to study — how often you win, how big the average win is against the average loss, whether losses were cut at
// 7–8%, how long winners and losers were held — and which entries worked (a breakout from a base or not).
// Pure functions. Amounts in EUR.

const DAY = 86400;

/** trades: [{t, key, name, side, qty, price}] → closed round trips, and the still-open positions. */
export function roundTrips(trades) {
  const open = new Map(), done = [];
  for (const x of trades.slice().sort((a, b) => a.t - b.t)) {
    if (!(x.qty > 0) || !(x.price > 0)) continue;
    let p = open.get(x.key);
    if (x.side === 'buy') {
      if (!p) { p = { key: x.key, name: x.name || x.key, first: x.t, qty: 0, cost: 0, bought: 0, sold: 0, buys: 0, sells: 0, firstPrice: x.price }; open.set(x.key, p); }
      p.qty += x.qty; p.cost += x.qty * x.price; p.bought += x.qty * x.price; p.buys++;
    } else {
      if (!p) continue; // a sale of shares bought before the statements: no full trade to review
      const q = Math.min(x.qty, p.qty), avg = p.qty ? p.cost / p.qty : 0;
      p.sold += q * x.price; p.cost -= q * avg; p.qty -= q; p.sells++; p.last = x.t;
      if (p.qty <= 1e-9) {
        const pnl = p.sold - p.bought;
        done.push({ key: p.key, name: p.name, open: p.first, close: x.t, days: Math.max(1, Math.round((x.t - p.first) / DAY)), invested: p.bought, pnl, ret: p.bought ? pnl / p.bought : 0, buys: p.buys, sells: p.sells, entry: p.firstPrice });
        open.delete(x.key);
      }
    }
  }
  return { trips: done, open: [...open.values()] };
}

/** Statistics over closed trips (optionally with an entry label per trip, e.g. the base it broke out of). */
export function tradeStats(trips) {
  const n = trips.length; if (!n) return null;
  const W = trips.filter(t => t.pnl > 0), L = trips.filter(t => t.pnl <= 0);
  const avg = (a, f) => a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : null;
  const sumW = W.reduce((s, t) => s + t.pnl, 0), sumL = L.reduce((s, t) => s + t.pnl, 0);
  const bigLoss = L.filter(t => t.ret < -0.085);
  return {
    n, wins: W.length, losses: L.length, winRate: W.length / n,
    avgWin: avg(W, t => t.ret), avgLoss: avg(L, t => t.ret), // as % of the money invested in the trade
    payoff: W.length && L.length ? avg(W, t => t.ret) / Math.abs(avg(L, t => t.ret) || 1e-9) : null,
    profitFactor: sumL < 0 ? sumW / -sumL : null, total: sumW + sumL,
    bestTrade: trips.reduce((a, b) => (b.ret > a.ret ? b : a)), worstTrade: trips.reduce((a, b) => (b.ret < a.ret ? b : a)),
    daysWin: avg(W, t => t.days), daysLoss: avg(L, t => t.days),
    bigLosses: bigLoss.length, bigLossShare: L.length ? bigLoss.length / L.length : 0, // losses deeper than the 7–8% stop
    expectancy: avg(trips, t => t.ret),
  };
}

/** Groups trips by a label (e.g. 'Cup with handle', 'No base breakout') with the same statistics. */
export function byLabel(trips, label) {
  const m = new Map();
  for (const t of trips) { const k = label(t) || 'Unknown'; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].map(([k, a]) => ({ label: k, ...tradeStats(a) })).sort((a, b) => b.n - a.n);
}

/** Plain-language lessons from the statistics, the way O'Neil reviews a year of trades. */
export function lessons(s, groups = []) {
  if (!s) return [];
  const out = [], pc = x => (x < 0 ? '−' : '') + Math.abs(Math.round(x * 100)) + '%';
  const p1 = x => (x * 100).toFixed(1).replace('-', '−') + '%';
  if (s.avgLoss != null && s.avgLoss < -0.085) out.push(['bad', `Your average loss is ${p1(s.avgLoss)}: deeper than the 7–8% stop. Cutting every loss at 7–8% is the book's first rule.`]);
  else if (s.avgLoss != null) out.push(['ok', `Your average loss is ${p1(s.avgLoss)}: losses are cut around the 7–8% rule.`]);
  if (s.bigLosses) out.push(['warn', `${s.bigLosses} of ${s.losses} losing trades lost more than 8.5%.`]);
  if (s.payoff != null) out.push([s.payoff >= 2 ? 'ok' : s.payoff >= 1 ? 'warn' : 'bad', `Average win ${pc(s.avgWin)} against average loss ${pc(s.avgLoss)}: ${s.payoff.toFixed(1)} to 1. O'Neil aims for wins much larger than losses (e.g. +20–25% against −7–8%, about 3 to 1).`]);
  if (s.daysWin != null && s.daysLoss != null) out.push([s.daysLoss <= s.daysWin ? 'ok' : 'bad', s.daysLoss <= s.daysWin ? `Losers were held ${Math.round(s.daysLoss)} days on average, winners ${Math.round(s.daysWin)}: you cut losers faster than winners — good.` : `Losers were held longer (${Math.round(s.daysLoss)} days) than winners (${Math.round(s.daysWin)}): the book says the opposite — cut losers fast, let winners run.`]);
  const good = groups.filter(g => g.n >= 3).sort((a, b) => b.expectancy - a.expectancy);
  if (good.length >= 2) out.push(['ok', `Best entries: ${good[0].label} (${good[0].n} trades, ${pc(good[0].winRate)} won, ${pc(good[0].expectancy)} per trade on average). Weakest: ${good[good.length - 1].label} (${pc(good[good.length - 1].expectancy)} per trade).`]);
  return out;
}
