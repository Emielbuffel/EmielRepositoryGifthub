// A review of every position you hold, for the coach ("look at my portfolio — what would he trim?"). The same analysis as
// the Sell ideas tab (the book's sell rules first, then a keep score), plus position size, profit-taking and a check
// for a holding that is probably another company with the same ticker.
import PAT from '../core/pat.js';
import { screenRow } from '../core/analysis.js';
import { assessHolding, rankHoldings } from '../core/prune.js';
import { sma } from '../core/indicators.js';
import { DEFAULT_PLAN } from '../core/strategy.js';
import { daily, benchmarkFor, provider } from './service.js';
import { factor } from './fx.js';
import { strategy } from './plans.js';
import * as store from './store.js';
import { App } from '../app.js';

export async function reviewHoldings() {
  const H = (App.holdings || []).filter(h => h.sym && h.shares > 0);
  const S = { ...DEFAULT_PLAN, ...(await strategy()) }, z = S.sz, max = z ? z.maxPositions : 8;
  const scan = await store.get('screen.' + provider().id, null);
  const rsOf = s => { const r = scan && scan.rows.find(x => x.s === s); return r && r.rs != null ? r.rs : App.last && App.last[s] && App.last[s].rs != null ? App.last[s].rs : null; };
  const items = [], failed = [];
  await Promise.all(H.map(async h => {
    try {
      const d = await daily(h.sym), b = d.bars, R = PAT.scan(b), n = b.length - 1, c = b[n].close;
      let bench = null; try { bench = (await benchmarkFor(h.sym)).bars; } catch (e) { /* no index */ }
      const row = screenRow(h.sym, d.name || '', b, R, null);
      const a = assessHolding(h, b, R, { bench, rs: rsOf(h.sym), sells: row ? row.sell : [], stop: S.stop });
      const f = await factor(d.currency || '', S.ccy).catch(() => null);
      const s50 = sma(b.map(x => x.close), 50)[n];
      Object.assign(a, { name: d.name || App.names[h.sym] || '', cur: d.currency, close: c, shares: h.shares, cost: h.cost || null, value: c * h.shares * (f ? f.v : 1), ext50: s50 ? c / s50 - 1 : null, s50,
        odd: !!(h.cost && (c / h.cost < 0.4 || c / h.cost > 2.5)), phase: row && row.ph ? row.ph.l : null });
      items.push(a);
    } catch (e) { failed.push(h.sym); }
  }));
  const total = items.reduce((t, x) => t + (x.value || 0), 0);
  const equity = z && z.equity ? z.equity : total;
  items.forEach(a => { a.weight = equity ? a.value / equity : null; });
  return { items, failed, rank: rankHoldings(items.filter(x => !x.odd), { max }), max, S, z, total, equity };
}
