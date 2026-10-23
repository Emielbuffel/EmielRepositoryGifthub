// Loads prices through the chosen provider with an on-device cache and incremental updates.
import { PROVIDERS, MARKET, DataError, splitSym, currencyOf, DEMO_BENCH } from './providers.js';
import * as store from './store.js';

export const settings = { provider: 'demo', keys: {} };

export async function loadSettings() {
  const s = await store.get('settings', null);
  if (s) Object.assign(settings, s);
  if (!PROVIDERS[settings.provider]) settings.provider = 'demo';
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
    const doc = { sym, name: meta.name || (cached && cached.name) || '', currency: meta.currency || currencyOf(sym), exchange: meta.exchange || '', bars, fetchedAt: Date.now() };
    if (P.id !== 'demo') await store.cacheSet(ck, doc);
    return doc;
  } catch (e) {
    if (cached) return { ...cached, cached: true, stale: true, error: e }; // show what we have
    throw e;
  }
}

/* ---------- benchmark for the RS line ---------- */
const HOME_INDEX = { KS: 'KS11', KQ: 'KQ11', T: 'N225', HK: 'HSI', AS: 'AEX', PA: 'FCHI', DE: 'GDAXI', MC: 'IBEX', L: 'FTSE', SW: 'SSMI', ST: 'OMXS30', BR: 'BFX', MI: 'STOXX50E', HE: 'STOXX50E', LS: 'STOXX50E', VI: 'STOXX50E' };
const INDEX_NAMES = { KS11: 'KOSPI', KQ11: 'KOSDAQ', N225: 'Nikkei 225', HSI: 'Hang Seng', AEX: 'AEX', FCHI: 'CAC 40', GDAXI: 'DAX', IBEX: 'IBEX 35', FTSE: 'FTSE 100', SSMI: 'SMI', OMXS30: 'OMX Stockholm 30', BFX: 'BEL 20', STOXX50E: 'Euro Stoxx 50' };

export async function benchmarkFor(sym) {
  const P = provider();
  if (P.id === 'demo' || isDemoSym(sym)) { const d = await daily(DEMO_BENCH); return { name: d.name, bars: d.bars }; }
  const { sfx } = splitSym(sym);
  const home = HOME_INDEX[sfx];
  if (home && P.indexSym) {
    try { const d = await daily(P.indexSym(home)); return { name: INDEX_NAMES[home], bars: d.bars }; } catch (e) { /* fall back to the S&P 500 */ }
  }
  const d = await daily('SPY');
  return { name: home ? 'S&P 500 ETF (SPY, in USD: no home index on this plan)' : 'S&P 500 (SPY)', bars: d.bars };
}

/* ---------- market indexes ---------- */
export async function marketSeries() {
  const P = provider(), out = [];
  if (P.id === 'demo') {
    for (const [k, s] of [['IXIC', 'DEMO-COMP'], ['GSPC', 'DEMO-500']]) { const d = await daily(s); out.push({ k, name: d.name, region: 'US', bars: d.bars, proxy: false }); }
    return out;
  }
  for (const m of MARKET) {
    let d = null, proxy = false, err = null;
    if (P.indexSym) { try { d = await daily(P.indexSym(m.k)); } catch (e) { err = e; } }
    if (!d) { try { d = await daily(m.etf); proxy = true; } catch (e) { err = e; } }
    out.push(d ? { k: m.k, name: proxy ? m.etfName : m.name, region: m.region, bars: d.bars, proxy } : { k: m.k, name: m.name, region: m.region, error: err });
  }
  return out;
}

/* ---------- fundamentals (FMP only) ---------- */
export async function fundamentals(sym) {
  const P = provider();
  if (!P.fundamentals) return null;
  const ck = 'fund:' + P.id + ':' + sym, c = await store.cacheGet(ck);
  if (c && Date.now() - c.fetchedAt < 24 * 3600e3) return c;
  const f = await P.fundamentals(sym, key());
  const doc = { ...f, fetchedAt: Date.now() }; await store.cacheSet(ck, doc); return doc;
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
