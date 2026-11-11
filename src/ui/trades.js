// Your trades in euros, from the uploaded DEGIRO statements (buy and sell lines), or — when none are uploaded — from
// the trades recorded in the app's buying plans. Shared by the capital-gains report and the trade review.
import { ledger, journal } from '../data/plans.js';
import { fxLookup } from './account.js';
import { daily } from '../data/service.js';
import { PROVIDERS } from '../data/providers.js';
import * as store from '../data/store.js';
import { App } from '../app.js';

const REF_T = Date.UTC(2025, 11, 31, 23) / 1000;

/** {trades: [{t, key, name, isin, sym, side, qty, price (base per share), cur}], src: 'statement'|'journal'|null} */
export async function loadTrades(base = 'EUR') {
  const Lg = (await ledger()).filter(l => (l.kind === 'buy' || l.kind === 'sell') && l.qty > 0 && l.price > 0);
  let rows, src;
  if (Lg.length) { rows = Lg.map(l => ({ t: l.t, key: l.isin || l.product, name: l.product || l.isin, isin: l.isin || '', sym: '', side: l.kind, qty: l.qty, p: l.price, cur: l.pcur || l.cur })); src = 'statement'; }
  else {
    const J = (await journal()).filter(x => x.shares > 0 && x.price > 0 && (x.side === 'buy' || x.side === 'sell'));
    rows = J.map(x => ({ t: x.t, key: x.sym, name: App.names[x.sym] || x.sym, isin: '', sym: x.sym, side: x.side, qty: x.shares, p: x.price, cur: x.cur || '' })); src = J.length ? 'journal' : null;
  }
  const fx = await fxLookup(rows.map(r => r.cur === 'GBX' ? 'GBp' : r.cur), base);
  const trades = rows.map(r => ({ ...r, price: r.p * fx(r.cur === 'GBX' ? 'GBp' : r.cur, r.t) }));
  return { trades, src, fx };
}

/** Ticker for an ISIN (built-in directory or the free search), remembered. */
export async function symbolFor(key, name = '') {
  const memo = await store.get('isinSym', {});
  if (memo[key]) return memo[key];
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(key)) return key; // already a ticker (trades from the buying plans)
  let sym = null;
  try { const r = await PROVIDERS.free.search(key); sym = r && r[0] && r[0].symbol; } catch (e) { /* not found */ }
  if (!sym && name) { try { const r = await PROVIDERS.free.search(name); sym = r && r[0] && r[0].symbol; } catch (e) { /* not found */ } }
  if (sym) { memo[key] = sym; await store.set('isinSym', memo); }
  return sym;
}

/** Daily bars for a trade key (ISIN or ticker), or null. */
export async function barsFor(key, name) {
  const sym = await symbolFor(key, name); if (!sym) return null;
  try { const d = await daily(sym, { long: true }); return { sym, bars: d.bars, cur: d.currency }; } catch (e) { return null; }
}

/** Value of one share on 31 December 2025 in `base` for each key (your own number wins when you entered one). */
export async function refValues(keys, names, base, fx) {
  const own = await store.get('cgt.ref', {}), out = {};
  for (const k of keys) {
    if (own[k] != null) { out[k] = { v: own[k], src: 'own' }; continue; }
    const b = await barsFor(k, names[k]);
    if (!b) { out[k] = null; continue; }
    let last = null; for (const x of b.bars) { if (x.time <= REF_T) last = x; else break; }
    if (!last || REF_T - last.time > 10 * 86400) { out[k] = null; continue; }
    out[k] = { v: last.close * fx(b.cur, REF_T), src: b.sym, close: last.close, cur: b.cur };
  }
  return out;
}
export async function setOwnRef(key, v) { const own = await store.get('cgt.ref', {}); if (v == null || !(v > 0)) delete own[key]; else own[key] = v; await store.set('cgt.ref', own); }
