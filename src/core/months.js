// Month by month from the monthly holdings files (statement snapshots): value, stocks and cash, the change since the
// previous file, deposits/withdrawals, dividends and costs in between, the return of each period (Modified Dietz:
// deposits count for half the period), the cumulative return, and what changed in the holdings.
// Amounts are in EUR, as on the broker statements.

const keyOf = r => r.isin || r.sym || r.name;

/**
 * snaps: [{t, rows: [{sym, name, isin, shares, eur}], cash}] (any order). flows: [{t, amount (EUR)}] deposits (+) and
 * withdrawals (−). income: [{t, kind: 'dividend'|'divtax'|'fee'|'tax'|'interest', amount (EUR)}].
 */
export function monthly(snaps, flows = [], income = []) {
  const S = [...snaps].sort((a, b) => a.t - b.t);
  let cum = 1;
  return S.map((s, i) => {
    const stocks = s.rows.reduce((t, r) => t + (r.eur || 0), 0), cash = s.cash || 0, total = stocks + cash;
    const out = { t: s.t, file: s.file || '', stocks, cash, total, n: s.rows.filter(r => r.shares > 0).length, rows: s.rows };
    if (!i) return { ...out, ret: null, cum: 0 };
    const p = S[i - 1], pt = p.rows.reduce((t, r) => t + (r.eur || 0), 0) + (p.cash || 0);
    const inP = x => x.t > p.t && x.t <= s.t;
    const flow = flows.filter(inP).reduce((t, f) => t + f.amount, 0);
    const sum = k => income.filter(x => inP(x) && x.kind === k).reduce((t, x) => t + x.amount, 0);
    const div = sum('dividend') + sum('divtax'), cost = sum('fee') + sum('tax');
    const change = total - pt, result = change - flow, base = pt + flow / 2;
    const ret = base > 0 ? result / base : null;
    if (ret != null) cum *= 1 + ret;
    // holdings changes
    const prev = new Map(p.rows.map(r => [keyOf(r), r])), cur = new Map(s.rows.map(r => [keyOf(r), r]));
    const moves = [];
    for (const [k, r] of cur) { const o = prev.get(k); if (!o) moves.push({ kind: 'new', name: r.sym || r.name, shares: r.shares }); else if (r.shares > o.shares + 1e-9) moves.push({ kind: 'added', name: r.sym || r.name, shares: r.shares - o.shares }); else if (r.shares < o.shares - 1e-9) moves.push({ kind: 'reduced', name: r.sym || r.name, shares: o.shares - r.shares }); }
    for (const [k, o] of prev) if (!cur.has(k)) moves.push({ kind: 'sold', name: o.sym || o.name, shares: o.shares });
    return { ...out, prevTotal: pt, change, flow, result, ret, cum: cum - 1, div, cost, moves };
  });
}

/** Weight of each position in every month's stock part: {names: [..], cells: {name: [w per month]}}. */
export function weights(months) {
  const names = new Map();
  months.forEach(m => m.rows.forEach(r => { const k = r.sym || r.name; names.set(k, Math.max(names.get(k) || 0, r.eur || 0)); }));
  const order = [...names.keys()].sort((a, b) => {
    const last = months[months.length - 1], va = (last.rows.find(r => (r.sym || r.name) === a) || {}).eur || 0, vb = (last.rows.find(r => (r.sym || r.name) === b) || {}).eur || 0;
    return vb - va || names.get(b) - names.get(a);
  });
  const cells = Object.fromEntries(order.map(k => [k, months.map(m => { const r = m.rows.find(x => (x.sym || x.name) === k); return r && m.stocks ? (r.eur || 0) / m.stocks : 0; })]));
  return { names: order, cells };
}
