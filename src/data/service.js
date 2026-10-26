// Loads prices through the chosen provider with an on-device cache and incremental updates.
import { PROVIDERS, MARKET, INDEXES, SECTORS, indexesFor, DataError, splitSym, currencyOf } from './providers.js';
import * as store from './store.js';
import { isApp, isDesktop } from './net.js';
import { snapshotMeta, yahooEps, yahooSplits, yahooCalendar } from './providers.js';
import { secEarnings } from './sec.js';

let SNAP_IDX = null;
export const snapshotReady = snapshotMeta().then(m => { SNAP_IDX = new Set(Object.keys(m.indexes)); return m; }).catch(() => null);
const liveFeeds = () => isApp();

export const settings = { provider: 'free', keys: {}, v: 2, secEmail: '', epsBasis: 'long' };
/** User-Agent for SEC EDGAR, which asks automated tools to give a contact e-mail. */
export const secAgent = () => 'BasePatternDesk/1.0 personal research' + (settings.secEmail ? ' ' + settings.secEmail : '');

export async function loadSettings() {
  const s = await store.get('settings', null);
  if (s) Object.assign(settings, s);
  // version 1 started in demo mode; from version 2 real built-in data is the default
  if (s && !s.v) { if (settings.provider === 'demo') settings.provider = 'free'; settings.v = 2; await store.set('settings', settings); }
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

/** long: the whole available history (used by the chart; the desktop app fetches it from the free feed). */
export async function daily(sym, { force = false, long = false, years = YEARS } = {}) {
  const P = isDemoSym(sym) ? PROVIDERS.demo : provider();
  if (P.needsKey && !key()) throw new DataError(`Add your ${P.name} API key in Settings, or switch to demo data.`, 'auth');
  long = long && P.id === 'free' && liveFeeds();
  const ck = P.id + (long ? ':L:' : ':') + sym;
  const cached = await store.cacheGet(ck);
  if (cached && !force && Date.now() - cached.fetchedAt < FRESH_MS) return { ...cached, cached: true };
  try {
    let bars, meta = {};
    const fromFull = long ? 0 : Date.now() / 1000 - years * 365.25 * 86400;
    if (cached && cached.bars.length > 200 && P.id !== 'demo') {
      const r = await P.daily(sym, key(), cached.bars[cached.bars.length - 1].time - 14 * 86400);
      const m = new Map(cached.bars.map(b => [b.time, b])); r.bars.forEach(b => m.set(b.time, b));
      bars = [...m.values()].sort((a, b) => a.time - b.time).filter(b => b.time >= fromFull); meta = r;
    } else {
      const r = await P.daily(sym, key(), P.id === 'fmp' ? fromFull : null, { long });
      bars = r.bars.filter(b => b.time >= fromFull); meta = r;
    }
    if (bars.length < 60) throw new DataError(`Only ${bars.length} days of history for ${sym}: the detector needs at least 60.`, 'notfound');
    const doc = { sym, name: meta.name || (cached && cached.name) || '', currency: meta.currency || currencyOf(sym), exchange: meta.exchange || '', bars, splits: meta.splits || (cached && cached.splits) || [], fetchedAt: Date.now(), live: meta.live, builtIn: P.id === 'free' && meta.live === false };
    if (P.id !== 'demo' && meta.live !== false) await store.cacheSet(ck, doc); // built-in data is already on the device
    return doc;
  } catch (e) {
    // the free data lacks this ticker (or the free feed failed): an FMP key, if added, is the backup (US listings)
    const fk = (settings.keys.fmp || '').trim();
    if (P.id === 'free' && fk && !splitSym(sym).sfx && !sym.startsWith('^')) {
      try {
        const r = await PROVIDERS.fmp.daily(sym, fk, Date.now() / 1000 - YEARS * 365.25 * 86400);
        if (r.bars.length >= 60) { const doc = { sym, name: (cached && cached.name) || '', currency: 'USD', exchange: '', bars: r.bars, splits: [], fetchedAt: Date.now(), live: true, via: 'FMP' }; await store.cacheSet(ck, doc); return doc; }
      } catch (e2) { /* fall through */ }
    }
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
/** long: load the whole history (the chart in the desktop app), so comparisons and the RS line cover a long chart. */
export async function indexSeries(id, demo = isDemo(), { long = false } = {}) {
  const o = { long };
  if (demo) { const s = DEMO_IDX[id] || 'DEMO-500'; const d = await daily(s); return { id, name: d.name, bars: d.bars, sym: s, proxy: false }; }
  if (id.startsWith('S:')) { const t = id.slice(2), d = await daily(t, o); return { id, name: SECTORS[t] + ' ETF (' + t + ')', bars: d.bars, sym: t, proxy: false }; }
  const ix = INDEXES[id];
  if (!ix) { const d = await daily(id, o); return { id, name: d.name || id, bars: d.bars, sym: id, proxy: false }; }
  const P = provider(); let err = null;
  const real = P.indexSym && P.indexSym(id);
  if (real) { try { const d = await daily(real, o); return { id, name: ix.name, bars: d.bars, sym: real, proxy: false }; } catch (e) { err = e; } }
  if (ix.etf) {
    const d = await daily(ix.etf, o);
    const usd = !['GSPC', 'IXIC', 'NDX', 'DJI', 'RUT', 'SOX', 'WORLD'].includes(id);
    return { id, name: `${ix.name} (${ix.etf} ETF${usd ? ', in USD' : ''})`, bars: d.bars, sym: ix.etf, proxy: true };
  }
  throw err || new DataError('No data for the ' + ix.name + ' on this plan.', 'plan');
}

/** Benchmark for the RS line: the chosen index, falling back to the S&P 500. */
export async function benchmarkFor(sym, id, opts = {}) {
  const demo = isDemo() || isDemoSym(sym);
  try { return await indexSeries(id || defaultBenchmark(sym), demo, opts); }
  catch (e) { return indexSeries('GSPC', demo, opts); }
}

/* ---------- market indexes ---------- */
export async function marketSeries() {
  const out = [];
  const list = isDemo() ? [{ k: 'IXIC', region: 'US' }, { k: 'GSPC', region: 'US' }] : MARKET;
  // all indexes at once (nine of them load much faster in parallel)
  out.push(...await Promise.all(list.map(m => indexSeries(m.k).then(d => ({ k: m.k, region: m.region, label: m.label, ...d }), e => ({ k: m.k, name: INDEXES[m.k].name, region: m.region, label: m.label, error: e })))));
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
  if (P.id === 'free') return freeEarnings(sym, P);
  const ck = 'earn:' + P.id + ':' + sym, c = await store.cacheGet(ck);
  if (c && Date.now() - c.fetchedAt < 12 * 3600e3) return c.rows;
  try {
    const rows = (await P.earnings(sym, key())).filter(r => isFinite(r.time)).sort((a, b) => a.time - b.time);
    await store.cacheSet(ck, { rows, fetchedAt: Date.now() }); return rows;
  } catch (e) { if (c) return c.rows; throw e; }
}

/** Stock splits for a ticker: from the chart's full history when loaded, else the free feed (cached 30 days). */
async function splitsFor(sym) {
  const d = await store.cacheGet('free:L:' + sym); if (d && d.splits) return d.splits;
  const ck = 'splits:' + sym, c = await store.cacheGet(ck);
  if (c && Date.now() - c.at < 30 * 864e5) return c.splits;
  const splits = await yahooSplits(sym); await store.cacheSet(ck, { splits, at: Date.now() }); return splits;
}

/**
 * Earnings with the free data: the built-in (adjusted) history, or — in the desktop app — the longest history
 * available: SEC EDGAR filings for US companies (GAAP diluted EPS back to ~2009), the free fundamentals feed elsewhere.
 * settings.epsBasis: 'long' (default) or 'adjusted' (built-in analyst basis only).
 */
async function freeEarnings(sym, P) {
  const ck = 'earn:free:' + settings.epsBasis + ':' + sym, c = await store.cacheGet(ck);
  if (c && Date.now() - c.fetchedAt < 12 * 3600e3) return c.rows;
  let built = [], err = null;
  try { built = (await P.earnings(sym)).map(r => ({ ...r, src: 'adjusted' })); } catch (e) { err = e; }
  let long = null;
  if (liveFeeds() && settings.epsBasis !== 'adjusted' && !sym.startsWith('^')) {
    // US: SEC filings; others, and US-listed companies without US-GAAP quarterly EPS (e.g. 20-F filers): the free feed
    if (!splitSym(sym).sfx) { try { long = await secEarnings(sym, secAgent(), await splitsFor(sym).catch(() => [])); } catch (e) { err = err || e; } }
    if (!long || long.length < 4) { try { const y = await yahooEps(sym); if (y && y.length > (long || []).length) long = y; } catch (e) { err = err || e; } }
  }
  const reported = built.filter(r => r.eps != null);
  let rows = reported.length ? built : [];
  if (long && long.length > reported.length) {
    const lastT = long[long.length - 1].time;
    rows = [...long, ...built.filter(r => r.eps == null && r.time > lastT)]; // keep the next report date
  }
  // desktop: the next report date and recent estimates for any stock (Yahoo calendar)
  if (isDesktop() && !sym.startsWith('^')) {
    try {
      const cal = await yahooCalendar(sym), now = Date.now() / 1000;
      if (cal.next && cal.next.time > now - 86400 && !rows.some(r => r.eps == null && r.time > now - 86400)) rows.push({ time: cal.next.time, eps: null, est: cal.next.est, period: 'Next report', tentative: cal.next.tentative, src: 'calendar' });
      for (const h of cal.hist) { // estimates for the last quarters, matched by quarter end
        const r = rows.find(x => x.eps != null && x.est == null && x.end && Math.abs(Date.parse(x.end) / 1000 - h.end) < 20 * 86400);
        if (r && h.est != null && r.src !== 'sec') r.est = h.est; // GAAP figures are not compared with (adjusted) estimates
      }
    } catch (e) { /* no calendar */ }
  }
  rows = rows.filter(r => isFinite(r.time)).sort((a, b) => a.time - b.time);
  if (!rows.length) { if (c) return c.rows; throw err || new DataError('No earnings data for ' + sym + '.', 'notfound'); }
  await store.cacheSet(ck, { rows, fetchedAt: Date.now() });
  return rows;
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
