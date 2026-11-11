// Realised gains for the Belgian capital-gains tax on financial assets (from 1 January 2026): 10% on the net gains of
// a year above an annual exemption (EUR 10,000 for 2026, indexed later). Shares bought before 2026 start from their
// value on 31 December 2025 (the closing price); for sales up to and including 2030 the real average purchase price
// may be used when it is higher. Several purchases: the average purchase price. Gains realised before 2026 are not
// taxed. Losses of a year offset gains of that year. Shares bought before 2026 are taken to be sold first.
// Pure functions. Amounts in EUR.

export const CGT = { start: Date.UTC(2026, 0, 1) / 1000, rate: 0.10, exemption: { 2026: 10000 }, transitionalUntil: 2030 };

/**
 * trades: [{t, key, name, side: 'buy'|'sell', qty, price (EUR per share)}], any order.
 * ref(key): the EUR value of one share on 31 December 2025, or null when unknown.
 * Returns {sales: [...], years: {year: {gains, losses, net, exemption, taxable, tax, count}}, open: {key: {qty, ...}}}.
 */
export function realisedGains(trades, ref = () => null, opts = {}) {
  const C = { ...CGT, ...opts }, pos = new Map(), sales = [];
  const P = k => { if (!pos.has(k)) pos.set(k, { pre: { qty: 0, cost: 0 }, post: { qty: 0, cost: 0 } }); return pos.get(k); };
  for (const x of trades.slice().sort((a, b) => a.t - b.t)) {
    if (!(x.qty > 0) || !(x.price > 0)) continue;
    const p = P(x.key), pool = x.t < C.start ? p.pre : p.post;
    if (x.side === 'buy') { pool.qty += x.qty; pool.cost += x.qty * x.price; continue; }
    // a sale: shares bought before 2026 go first, then the newer ones; each pool at its average price
    let left = x.qty, basis = 0; const parts = [];
    const year = new Date(x.t * 1000).getUTCFullYear(), taxed = x.t >= C.start, r = ref(x.key);
    if (p.pre.qty > 0 && left > 0) {
      const q = Math.min(left, p.pre.qty), avg = p.pre.cost / p.pre.qty;
      let per = avg, how = 'purchase price (bought before 2026)';
      if (taxed) {
        if (r == null) how = 'purchase price — the 31-12-2025 value is unknown';
        else if (year <= C.transitionalUntil && avg > r) { per = avg; how = 'purchase price (higher than the 31-12-2025 value)'; }
        else { per = r; how = 'value on 31-12-2025'; }
      }
      basis += q * per; parts.push({ q, per, how });
      p.pre.cost -= q * avg; p.pre.qty -= q; left -= q;
    }
    if (p.post.qty > 0 && left > 0) {
      const q = Math.min(left, p.post.qty), avg = p.post.cost / p.post.qty;
      basis += q * avg; parts.push({ q, per: avg, how: 'average purchase price' });
      p.post.cost -= q * avg; p.post.qty -= q; left -= q;
    }
    if (left > 1e-9) {
      // more sold than the statements show bought: shares bought before the statements; start from 31-12-2025
      const per = taxed && r != null ? r : null;
      if (per != null) basis += left * per;
      parts.push({ q: left, per, how: per != null ? 'value on 31-12-2025 (purchase not in your statements)' : 'unknown — purchase not in your statements' });
    }
    const unknown = parts.some(z => z.per == null), proceeds = x.qty * x.price;
    sales.push({ t: x.t, year, key: x.key, name: x.name || x.key, qty: x.qty, price: x.price, proceeds, basis: unknown ? null : basis, gain: unknown ? null : proceeds - basis, parts, taxed });
  }
  const years = {};
  for (const s of sales) {
    if (!s.taxed || s.gain == null) continue;
    const y = years[s.year] || (years[s.year] = { gains: 0, losses: 0, net: 0, count: 0, unknown: 0 });
    if (s.gain >= 0) y.gains += s.gain; else y.losses += s.gain; y.net += s.gain; y.count++;
  }
  for (const s of sales) if (s.taxed && s.gain == null) { const y = years[s.year] || (years[s.year] = { gains: 0, losses: 0, net: 0, count: 0, unknown: 0 }); y.unknown++; }
  for (const [y, v] of Object.entries(years)) {
    v.exemption = C.exemption[y] ?? C.exemption[Math.max(...Object.keys(C.exemption).map(Number))];
    v.taxable = Math.max(0, v.net - v.exemption); v.tax = v.taxable * C.rate;
  }
  const open = {}; for (const [k, p] of pos) { const q = p.pre.qty + p.post.qty; if (q > 1e-9) open[k] = { qty: q, pre: p.pre.qty }; }
  return { sales, years, open };
}
