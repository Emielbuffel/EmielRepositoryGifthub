// Loads prices through the chosen provider with an on-device cache and incremental updates.
import { PROVIDERS, MARKET, INDEXES, SECTORS, indexesFor, DataError, splitSym, currencyOf } from './providers.js';
import * as store from './store.js';
import { Capacitor } from '@capacitor/core';
import { snapshotMeta } from './providers.js';

let SNAP_IDX = null;
export const snapshotReady = snapshotMeta().then(m => { SNAP_IDX = new Set(Object.keys(m.indexes)); return m; }).catch(() => null);
const liveFeeds = () => Capacitor.isNativePlatform();

export const settings = { provider: 'free', keys: {} };

export async function loadSettings() {
  const s = await store.get('settings', null);
  if (s) Object.assign(settings, s);
  if (!PROVIDERS[settings.provider]) settings.provider = 'free';
  return settings;
}
export async function saveSettings() { await store.set('settings', settings); }

export const provider = () => PROVIDERS[settings.provider];
export const isDemo = () => settings.provider === 'demo';
const key = () => (settings.keys[settings.provider] || '').trim();

const FRESH_MS = 3 * 3600e3;
const YEARS = 4.3;

/** Daily bars for a symbol: {sym, name, currency, exchange, bars, fetchedAt, cached, stale?}. */
export const isDemoSym = sym => /\.DEMO$|^DEMO-/.test(sym);

export async function daily(sym, { force = false } = {}) {
  const P = isDemoSym(sym) ? PROVIDERS.demo : provider();
  if (P.needsKey && !key()) throw new DataError(`Add your ${P.name} API key in Settings, or switch to demo data.`, 'auth');
  const ck = P.id + ':' + sym;
  const cached = await store.cacheGet(ck);
  if (cached && !force && Date.now() - cached.fetchedAt < FRESH_MS) return { ...cached, cached: true };
  try {
    let bars, meta = {};
    const fromFull = Date.now() / 1000 - YEARS * 365.25 * 86400;
    if (cached && cached.bars.length > 200 && P.id !== 'demo') {
      const r = await P.daily(sym, key(), cached.bars[cached.bars.length - 1].time - 14 * 86400);
      const m = new Map(cached.bars.map(b => [b.time, b])); r.bars.forEach(b => m.set(b.time, b));
      bars = [...m.values()].sort((a, b) => a.time - b.time).filter(b => b.time >= fromFull); meta = r;
    } else {
      const r = await P.daily(sym, key(), P.id === 'fmp' ? fromFull : null);
      bars = r.bars.filter(b => b.time >= fromFull); meta = r;
    }
    if (bars.length < 60) throw new DataError(`Only ${bars.length} days of history for ${sym}: the detector needs at least 60.`, 'notfound');
    const doc = { sym, name: meta.name || (cached && cached.name) || '', currency: meta.currency || currencyOf(sym), exchange: meta.exchange || '', bars, fetchedAt: Date.now(), live: meta.live, builtIn: P.id === 'free' && meta.live === false };
    if (P.id !== 'demo' && meta.live !== false) await store.cacheSet(ck, doc); // built-in data is already on the device
    return doc;
  } catch (e) {
    if (cached) return { ...cached, cached: true, stale: true, error: e }; // show what we have
    throw e;
  }
}

/* ---------- indexes for the RS line, comparisons and the Market tab ---------- */
const DEMO_IDX = { GSPC: 'DEMO-500', IXIC: 'DEMO-COMP' };

/** Comparison choices for a ticker: [{id, name, group}]. id is an index key (e.g. 'GSPC'), 'S:XLK' for a sector ETF, or a ticker. */
export function compareOptions(sym) {
  if (isDemo() || isDemoSym(sym)) return [{ id: 'GSPC', name: 'Demo 500 (fictional)', group: 'Indexes' }, { id: 'IXIC', name: 'Demo Composite (fictional)', group: 'Indexes' }];
  let keys = indexesFor(sym);
  const builtInOnly = settings.provider === 'free' && !liveFeeds() && SNAP_IDX;
  if (builtInOnly) { keys = keys.filter(k => SNAP_IDX.has(k)); if (!keys.length) keys = ['GSPC']; }
  const out = keys.map(k => ({ id: k, name: INDEXES[k].name, group: 'Indexes' }));
  if (!builtInOnly && !splitSym(sym).sfx) Object.entries(SECTORS).forEach(([t, n]) => out.push({ id: 'S:' + t, name: n + ' (' + t + ')', group: 'US sectors' }));
  return out;
}
export const defaultBenchmark = sym => compareOptions(sym)[0].id;

/**
 * Daily bars for an index key, sector ('S:XLK') or plain ticker. Tries the real index on the user's plan,
 * then a US-listed ETF that tracks it. Returns {id, name, bars, sym, proxy, note}.
 */
export async function indexSeries(id, demo = isDemo()) {
  if (demo) { const s = DEMO_IDX[id] || 'DEMO-500'; const d = await daily(s); return { id, name: d.name, bars: d.bars, sym: s, proxy: false }; }
  if (id.startsWith('S:')) { const t = id.slice(2), d = await daily(t); return { id, name: SECTORS[t] + ' ETF (' + t + ')', bars: d.bars, sym: t, proxy: false }; }
  const ix = INDEXES[id];
  if (!ix) { const d = await daily(id); return { id, name: d.name || id, bars: d.bars, sym: id, proxy: false }; }
  const P = provider(); let err = null;
  const real = P.indexSym && P.indexSym(id);
  if (real) { try { const d = await daily(real); return { id, name: ix.name, bars: d.bars, sym: real, proxy: false }; } catch (e) { err = e; } }
  if (ix.etf) {
    const d = await daily(ix.etf);
    const usd = !['GSPC', 'IXIC', 'NDX', 'DJI', 'RUT', 'SOX', 'WORLD'].includes(id);
    return { id, name: `${ix.name} (${ix.etf} ETF${usd ? ', in USD' : ''})`, bars: d.bars, sym: ix.etf, proxy: true };
  }
  throw err || new DataError('No data for the ' + ix.name + ' on this plan.', 'plan');
}

/** Benchmark for the RS line: the chosen index, falling back to the S&P 500. */
export async function benchmarkFor(sym, id) {
  const demo = isDemo() || isDemoSym(sym);
  try { return await indexSeries(id || defaultBenchmark(sym), demo); }
  catch (e) { return indexSeries('GSPC', demo); }
}

/* ---------- market indexes ---------- */
export async function marketSeries() {
  const out = [];
  const list = isDemo() ? [{ k: 'IXIC', region: 'US' }, { k: 'GSPC', region: 'US' }] : MARKET;
  for (const m of list) {
    try { const d = await indexSeries(m.k); out.push({ k: m.k, region: m.region, ...d }); }
    catch (e) { out.push({ k: m.k, name: INDEXES[m.k].name, region: m.region, error: e }); }
  }
  return out;
}

/** Symbols the Market tab and the Chart tab treat as a market index (for D-day / FTD markers). */
export function isIndexSym(sym) {
  if (/^DEMO-/.test(sym) || sym.startsWith('^') || sym.endsWith('.INDX')) return true;
  return Object.values(INDEXES).some(x => x.etf === sym || x.fmp === sym);
}

/* ---------- earnings ---------- */
export async function earnings(sym) {
  const P = isDemoSym(sym) ? PROVIDERS.demo : provider();
  if (!P.earnings) return null;
  if (P.needsKey && !key()) return null;
  if (P.id === 'demo') return P.earnings(sym);
  const ck = 'earn:' + P.id + ':' + sym, c = await store.cacheGet(ck);
  if (c && Date.now() - c.fetchedAt < 12 * 3600e3) return c.rows;
  try {
    const rows = (await P.earnings(sym, key())).filter(r => isFinite(r.time)).sort((a, b) => a.time - b.time);
    await store.cacheSet(ck, { rows, fetchedAt: Date.now() }); return rows;
  } catch (e) { if (c) return c.rows; throw e; }
}

/** FX as a Map(weekKey -> base units per 1 unit of `cur`), a fixed number, or null when cur is the base. */
export async function fxWeekly(cur, base) {
  if (!cur || cur === base || isDemo()) return null;
  let c = cur, scale = 1;
  if (cur === 'GBp' || cur === 'GBX') { c = 'GBP'; scale = 0.01; }
  if (c === base) return scale; // a fixed rate (pence to pounds)
  const P = provider();
  let r, inv = false;
  try { r = await dailyFx(P, c + '/' + base); } catch (e) { r = await dailyFx(P, base + '/' + c); inv = true; }
  return weeklyMap(r.bars.map(b => ({ time: b.time, close: (inv ? 1 / b.close : b.close) * scale })));
}
async function dailyFx(P, pair) {
  const ck = P.id + ':fx:' + pair, c = await store.cacheGet(ck);
  if (c && Date.now() - c.fetchedAt < 12 * 3600e3) return c;
  const r = await P.fx(pair, key()); if (!r.bars || r.bars.length < 20) throw new DataError('No FX data for ' + pair);
  const doc = { bars: r.bars, fetchedAt: Date.now() }; await store.cacheSet(ck, doc); return doc;
}
function weeklyMap(bars) {
  const m = new Map();
  for (const b of bars) { const d = new Date(b.time * 1000); m.set(b.time - ((d.getUTCDay() + 6) % 7) * 86400, b.close); }
  return m;
}

export { DataError };
