// Your account, worked out by the app: every holding at today's price (converted to the plan currency) plus your cash
// (negative cash = a margin loan). Used for the position size, the number of positions and the margin room.
import { daily } from './service.js';
import { factor } from './fx.js';
import * as store from './store.js';
import { App } from '../app.js';
import { isDemo } from './service.js';

const memo = { at: 0, ccy: null, v: null, key: '' };

/** {stocks, cash, equity, cashKnown, rows: [{sym, value}], missing: [sym], at} in `ccy`. Cached for a minute. */
export async function accountValue(ccy = 'EUR', { force = false } = {}) {
  const sfx = isDemo() ? '.demo' : '.real';
  const H = (App.holdings || (await store.get('holdings' + sfx, []))).filter(h => h.sym && h.shares > 0);
  const c = await store.get('cash' + sfx, null);
  const key = JSON.stringify([H.map(h => [h.sym, h.shares]), c && [c.amount, c.cur]]);
  if (!force && memo.v && memo.ccy === ccy && memo.key === key && Date.now() - memo.at < 60e3) return memo.v;
  let stocks = 0; const rows = [], missing = [];
  for (const h of H) {
    try {
      const d = await daily(h.sym), close = d.bars[d.bars.length - 1].close;
      const cur = d.currency || '', mult = 1; // the FX factor already turns pence (GBp) into pounds
      const f = cur && cur !== ccy ? await factor(cur, ccy).catch(() => null) : null;
      const v = close * mult * h.shares * (f ? f.v : 1); stocks += v; rows.push({ sym: h.sym, value: v });
    } catch (e) { missing.push(h.sym); }
  }
  let cash = 0, cashKnown = false;
  if (c && isFinite(c.amount)) { const f = c.cur && c.cur !== ccy ? await factor(c.cur, ccy).catch(() => null) : null; cash = c.amount * (f ? f.v : 1); cashKnown = true; }
  const v = { stocks, cash, equity: stocks + cash, cashKnown, rows, missing, at: Date.now(), ccy };
  Object.assign(memo, { at: Date.now(), ccy, v, key });
  return v;
}
