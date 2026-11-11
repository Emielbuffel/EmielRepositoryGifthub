// Market data providers. The user brings their own API key (stored on the device only).
// Tickers inside the app use Yahoo-style suffixes (AAPL, ASML.AS, 7203.T, 005930.KS); each provider maps them.
// Endpoints follow each provider's public documentation; check them if a provider changes its API.
import { secCompanies } from './sec.js';
import { mergeBars, fixSpikes, alignQuote } from '../core/bars.js';
import { httpGet, isApp } from './net.js';
import { demoBars, demoEarnings, demoNews, DEMO, DEMO_INDEXES, DEMO_BENCH } from './demo.js';

export class DataError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; } // kind: auth | plan | limit | notfound | network | error
}

/* ---------- HTTP: direct requests in the desktop and native apps (no CORS), fetch in a browser ---------- */
export async function getJSON(url) {
  let status, data;
  try {
    const r = await httpGet(url); status = r.status;
    try { data = JSON.parse(r.text); } catch (e) { data = r.text; }
  } catch (e) { throw new DataError('Could not reach the data provider. Check your internet connection.', 'network'); }
  if (status === 401 || status === 403) throw new DataError(errText(data) || 'The provider refused the request: check your API key or plan.', status === 401 ? 'auth' : 'plan');
  if (status === 429) throw new DataError('The provider\'s rate limit was reached. Wait a minute and try again.', 'limit');
  if (status === 404) throw new DataError('Not found at this provider.', 'notfound');
  if (status >= 400) throw new DataError(errText(data) || 'The provider returned an error (HTTP ' + status + ').');
  return data;
}
const errText = d => !d ? '' : typeof d === 'string' ? d.slice(0, 200) : d['Error Message'] || d.message || d.error || '';

/** Spaces out requests to respect free-plan rate limits. */
function limiter(minGapMs) {
  let next = 0;
  return async fn => {
    const now = Date.now(), wait = Math.max(0, next - now); next = Math.max(now, next) + minGapMs;
    if (wait) await new Promise(r => setTimeout(r, wait));
    return fn();
  };
}

const ymd = t => new Date(t * 1000).toISOString().slice(0, 10);
const dToT = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 1000;
const clean = rows => rows.filter(x => x && isFinite(x.close) && x.close > 0 && isFinite(x.time)).sort((a, b) => a.time - b.time)
  .filter((x, i, a) => i === 0 || a[i - 1].time !== x.time)
  .map(x => ({ ...x, open: isFinite(x.open) && x.open > 0 ? x.open : x.close, high: Math.max(x.high || 0, x.close), low: Math.min(x.low > 0 ? x.low : x.close, x.close), volume: isFinite(x.volume) ? x.volume : 0 }));

/* ---------- listing suffixes ---------- */
export const SUFFIX = {
  '': { cur: 'USD', mic: '', eod: 'US', bench: 'SPY', name: 'United States' },
  KS: { cur: 'KRW', mic: 'XKRX', eod: 'KO', name: 'Korea (KOSPI)' }, KQ: { cur: 'KRW', mic: 'XKOS', eod: 'KQ', name: 'Korea (KOSDAQ)' },
  T: { cur: 'JPY', mic: 'XJPX', eod: 'TSE', name: 'Tokyo' }, HK: { cur: 'HKD', mic: 'XHKG', eod: 'HK', name: 'Hong Kong' },
  SS: { cur: 'CNY', mic: 'XSHG', eod: 'SHG', name: 'Shanghai' }, SZ: { cur: 'CNY', mic: 'XSHE', eod: 'SHE', name: 'Shenzhen' },
  AS: { cur: 'EUR', mic: 'XAMS', eod: 'AS', name: 'Amsterdam' }, PA: { cur: 'EUR', mic: 'XPAR', eod: 'PA', name: 'Paris' },
  DE: { cur: 'EUR', mic: 'XETR', eod: 'XETRA', name: 'Xetra' }, MI: { cur: 'EUR', mic: 'XMIL', eod: 'MI', name: 'Milan' },
  MC: { cur: 'EUR', mic: 'XMAD', eod: 'MC', name: 'Madrid' }, L: { cur: 'GBp', mic: 'XLON', eod: 'LSE', name: 'London' },
  SW: { cur: 'CHF', mic: 'XSWX', eod: 'SW', name: 'Swiss' }, BR: { cur: 'EUR', mic: 'XBRU', eod: 'BR', name: 'Brussels' },
  ST: { cur: 'SEK', mic: 'XSTO', eod: 'ST', name: 'Stockholm' }, CO: { cur: 'DKK', mic: 'XCSE', eod: 'CO', name: 'Copenhagen' },
  HE: { cur: 'EUR', mic: 'XHEL', eod: 'HE', name: 'Helsinki' }, OL: { cur: 'NOK', mic: 'XOSL', eod: 'OL', name: 'Oslo' },
  LS: { cur: 'EUR', mic: 'XLIS', eod: 'LS', name: 'Lisbon' }, VI: { cur: 'EUR', mic: 'XWBO', eod: 'VI', name: 'Vienna' },
  TO: { cur: 'CAD', mic: 'XTSE', eod: 'TO', name: 'Toronto' }, AX: { cur: 'AUD', mic: 'XASX', eod: 'AU', name: 'Australia' },
};
export function splitSym(sym) {
  const m = /^(.+?)\.([A-Z]{1,3})$/.exec(sym);
  if (m && SUFFIX[m[2]]) return { base: m[1], sfx: m[2] };
  return { base: sym, sfx: '' };
}
export const currencyOf = sym => (SUFFIX[splitSym(sym).sfx] || SUFFIX['']).cur;
const sfxFromMic = mic => Object.keys(SUFFIX).find(k => SUFFIX[k].mic && SUFFIX[k].mic === mic);
const sfxFromEod = ex => ex === 'US' || ['NASDAQ', 'NYSE', 'NYSE ARCA', 'NYSE MKT', 'BATS', 'AMEX'].includes(ex) ? '' : Object.keys(SUFFIX).find(k => SUFFIX[k].eod === ex);

/* ---------- indexes: real index where the plan has it, otherwise a US-listed ETF that tracks it ---------- */
// fmp/eod = index symbols at FMP and EODHD; etf = fallback (prices in USD for non-US indexes).
export const INDEXES = {
  GSPC: { name: 'S&P 500', fmp: '^GSPC', eod: 'GSPC.INDX', etf: 'SPY' },
  IXIC: { name: 'Nasdaq Composite', fmp: '^IXIC', eod: 'IXIC.INDX', etf: 'ONEQ' },
  NDX: { name: 'Nasdaq-100', fmp: '^NDX', eod: 'NDX.INDX', etf: 'QQQ' },
  DJI: { name: 'Dow Jones Industrial', fmp: '^DJI', eod: 'DJI.INDX', etf: 'DIA' },
  RUT: { name: 'Russell 2000', fmp: '^RUT', eod: 'RUT.INDX', etf: 'IWM' },
  SOX: { name: 'PHLX Semiconductor', fmp: '^SOX', eod: 'SOX.INDX', etf: 'SOXX' },
  WORLD: { name: 'MSCI World', etf: 'URTH' },
  STOXX50E: { name: 'Euro Stoxx 50', fmp: '^STOXX50E', eod: 'STOXX50E.INDX', etf: 'FEZ' },
  GDAXI: { name: 'DAX', fmp: '^GDAXI', eod: 'GDAXI.INDX', etf: 'EWG' },
  FCHI: { name: 'CAC 40', fmp: '^FCHI', eod: 'FCHI.INDX', etf: 'EWQ' },
  AEX: { name: 'AEX', fmp: '^AEX', eod: 'AEX.INDX', etf: 'EWN' },
  FTSEMIB: { name: 'FTSE MIB', fmp: 'FTSEMIB.MI', eod: 'FTSEMIB.INDX', etf: 'EWI' },
  IBEX: { name: 'IBEX 35', fmp: '^IBEX', eod: 'IBEX.INDX', etf: 'EWP' },
  BFX: { name: 'BEL 20', fmp: '^BFX', eod: 'BFX.INDX', etf: 'EWK' },
  FTSE: { name: 'FTSE 100', fmp: '^FTSE', eod: 'FTSE.INDX', etf: 'EWU' },
  SSMI: { name: 'SMI', fmp: '^SSMI', eod: 'SSMI.INDX', etf: 'EWL' },
  OMXS30: { name: 'OMX Stockholm 30', fmp: '^OMX', eod: 'OMXS30.INDX', etf: 'EWD' },
  OMXC25: { name: 'OMX Copenhagen 25', eod: 'OMXC25.INDX', etf: 'EDEN' },
  OMXH25: { name: 'OMX Helsinki 25', eod: 'OMXH25.INDX', etf: 'EFNL' },
  OBX: { name: 'Oslo OBX', eod: 'OBX.INDX', etf: 'ENOR' },
  N225: { name: 'Nikkei 225', fmp: '^N225', eod: 'N225.INDX', etf: 'EWJ' },
  KS11: { name: 'KOSPI', fmp: '^KS11', eod: 'KS11.INDX', etf: 'EWY' },
  KQ11: { name: 'KOSDAQ', fmp: '^KQ11', eod: 'KQ11.INDX' },
  HSI: { name: 'Hang Seng', fmp: '^HSI', eod: 'HSI.INDX', etf: 'EWH' },
  SSEC: { name: 'Shanghai Composite', fmp: '000001.SS', eod: 'SSEC.INDX', etf: 'MCHI' },
  NSEI: { name: 'Nifty 50', fmp: '^NSEI', eod: 'NSEI.INDX', etf: 'INDA' },
  BSESN: { name: 'BSE Sensex', fmp: '^BSESN', eod: 'BSESN.INDX', etf: 'INDA' },
  GSPTSE: { name: 'S&P/TSX Composite', fmp: '^GSPTSE', eod: 'GSPTSE.INDX', etf: 'EWC' },
  AXJO: { name: 'S&P/ASX 200', fmp: '^AXJO', eod: 'AXJO.INDX', etf: 'EWA' },
};
// US sector and industry ETFs (a stand-in for industry groups)
export const SECTORS = {
  XLK: 'Technology', SMH: 'Semiconductors', IGV: 'Software', XLC: 'Communication', XLY: 'Consumer discretionary', XLP: 'Consumer staples',
  XLV: 'Health care', XBI: 'Biotech', XLF: 'Financials', XLI: 'Industrials', ITA: 'Aerospace & defence', XLE: 'Energy', XLB: 'Materials', XLU: 'Utilities', XLRE: 'Real estate',
};
// Which indexes fit a listing: the first is the default for the RS line.
const HOME = {
  '': ['GSPC', 'IXIC', 'NDX', 'DJI', 'RUT', 'SOX'],
  DE: ['GDAXI', 'STOXX50E'], PA: ['FCHI', 'STOXX50E'], AS: ['AEX', 'STOXX50E'], MI: ['FTSEMIB', 'STOXX50E'], MC: ['IBEX', 'STOXX50E'],
  BR: ['BFX', 'STOXX50E'], HE: ['OMXH25', 'STOXX50E'], LS: ['STOXX50E'], VI: ['STOXX50E'], L: ['FTSE', 'STOXX50E'], SW: ['SSMI', 'STOXX50E'],
  ST: ['OMXS30', 'STOXX50E'], CO: ['OMXC25', 'STOXX50E'], OL: ['OBX', 'STOXX50E'],
  T: ['N225'], KS: ['KS11', 'KQ11'], KQ: ['KQ11', 'KS11'], HK: ['HSI', 'SSEC'], SS: ['SSEC', 'HSI'], SZ: ['SSEC', 'HSI'], TO: ['GSPTSE'], AX: ['AXJO'],
};
/** Index keys that fit this ticker: home market first, then global comparisons. */
export function indexesFor(sym) {
  const own = HOME[splitSym(sym).sfx] || HOME[''];
  return [...new Set([...own, 'GSPC', 'WORLD'])];
}

/* ---------- market tab indexes ---------- */
export const MARKET = [
  { k: 'IXIC', region: 'US' }, { k: 'GSPC', region: 'US' }, { k: 'DJI', region: 'US' }, { k: 'STOXX50E', region: 'EU' },
  { k: 'KS11', region: 'KR', label: 'South Korea' }, { k: 'N225', region: 'JP', label: 'Japan' }, { k: 'SSEC', region: 'CN', label: 'China' },
  { k: 'HSI', region: 'HK', label: 'Hong Kong' }, { k: 'NSEI', region: 'IN', label: 'India' },
].map(m => ({ ...m, name: INDEXES[m.k].name, etf: INDEXES[m.k].etf }));

/* ---------- providers ---------- */
const fmpLimit = limiter(250);
const FMP = {
  id: 'fmp', name: 'Financial Modeling Prep', short: 'FMP', needsKey: true, site: 'https://site.financialmodelingprep.com/developer/docs',
  blurb: 'US stocks on the free plan (250 requests a day); worldwide listings, indexes and fundamentals on paid plans. Also gives earnings, sales and company news.',
  url: (path, key, q) => `https://financialmodelingprep.com/stable/${path}?${new URLSearchParams({ ...q, apikey: key })}`,
  async daily(sym, key, fromT) {
    const q = { symbol: sym }; if (fromT) q.from = ymd(fromT);
    const d = await fmpLimit(() => getJSON(this.url('historical-price-eod/full', key, q)));
    const arr = Array.isArray(d) ? d : Array.isArray(d && d.historical) ? d.historical : null;
    if (!arr) throw new DataError(errText(d) || 'No price history from FMP for ' + sym + '.', 'notfound');
    return { bars: clean(arr.map(x => ({ time: dToT(x.date), open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))) };
  },
  indexSym: k => INDEXES[k] && INDEXES[k].fmp,
  async earnings(sym, key) {
    try {
      const d = await fmpLimit(() => getJSON(this.url('earnings', key, { symbol: sym, limit: 28 })));
      if (Array.isArray(d) && d.length) return d.map(x => ({ time: dToT(x.date), eps: x.epsActual ?? null, est: x.epsEstimated ?? null, rev: x.revenueActual ?? null, revEst: x.revenueEstimated ?? null }));
    } catch (e) { if (e.kind === 'auth' || e.kind === 'limit') throw e; }
    // fallback: quarterly income statements, dated by their filing date
    const q = await fmpLimit(() => getJSON(this.url('income-statement', key, { symbol: sym, period: 'quarter', limit: 20 })));
    if (!Array.isArray(q) || !q.length) throw new DataError('FMP has no earnings data for ' + sym + ' on this plan.', 'plan');
    return q.map(x => ({ time: dToT(String(x.filingDate || x.acceptedDate || x.date).slice(0, 10)), eps: +(x.epsDiluted ?? x.eps), rev: +x.revenue || null, period: (x.period || '') + ' ' + (x.fiscalYear || '') }));
  },
  async news(sym, key) {
    const d = await fmpLimit(() => getJSON(this.url('news/stock', key, { symbols: sym, limit: 30 })));
    return (Array.isArray(d) ? d : []).map(x => ({ title: x.title, link: x.url, date: Date.parse(x.publishedDate), source: x.site || x.publisher || 'FMP' }));
  },
  async search(q, key) {
    const [a, b] = await Promise.allSettled([getJSON(this.url('search-symbol', key, { query: q, limit: 10 })), getJSON(this.url('search-name', key, { query: q, limit: 10 }))]);
    const out = new Map();
    for (const r of [a, b]) if (r.status === 'fulfilled' && Array.isArray(r.value)) r.value.forEach(x => { if (x.symbol && !out.has(x.symbol)) out.set(x.symbol, { symbol: x.symbol, name: x.name, exchange: x.exchangeFullName || x.exchange || '', currency: x.currency || '' }); });
    if (!out.size && a.status === 'rejected') throw a.reason;
    return [...out.values()];
  },
  async fx(pair, key) { return this.daily(pair.replace('/', ''), key); },
};

const tdLimit = limiter(7600); // free plan: 8 credits a minute
const TD = {
  id: 'twelvedata', name: 'Twelve Data', short: 'Twelve Data', needsKey: true, site: 'https://twelvedata.com/docs',
  blurb: 'US stocks and ETFs on the free plan (800 requests a day, 8 a minute, so the screener is slow); international exchanges on paid plans.',
  url: (path, key, q) => `https://api.twelvedata.com/${path}?${new URLSearchParams({ ...q, apikey: key })}`,
  async daily(sym, key, fromT) {
    const { base, sfx } = splitSym(sym);
    const q = { symbol: base, interval: '1day', outputsize: fromT ? 60 : 1100, order: 'ASC' };
    if (sfx && SUFFIX[sfx].mic) q.mic_code = SUFFIX[sfx].mic;
    const d = await tdLimit(() => getJSON(this.url('time_series', key, q)));
    if (!d || d.status === 'error') {
      const code = d && d.code, msg = (d && d.message) || 'Twelve Data returned an error.';
      throw new DataError(msg, code === 401 ? 'auth' : code === 403 ? 'plan' : code === 429 ? 'limit' : code === 400 || code === 404 ? 'notfound' : 'error');
    }
    const bars = clean((d.values || []).map(x => ({ time: dToT(x.datetime), open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume })));
    return { bars, currency: d.meta && d.meta.currency, exchange: d.meta && d.meta.exchange };
  },
  indexSym: null,
  async earnings(sym, key) {
    const { base, sfx } = splitSym(sym); const q = { symbol: base, outputsize: 28 };
    if (sfx && SUFFIX[sfx].mic) q.mic_code = SUFFIX[sfx].mic;
    const d = await tdLimit(() => getJSON(this.url('earnings', key, q)));
    if (!d || d.status === 'error' || !Array.isArray(d.earnings)) throw new DataError((d && d.message) || 'No earnings data from Twelve Data for ' + sym + '.', d && d.code === 403 ? 'plan' : 'notfound');
    return d.earnings.map(x => ({ time: dToT(x.date), eps: x.eps_actual == null ? null : +x.eps_actual, est: x.eps_estimate == null ? null : +x.eps_estimate }));
  },
  async search(q) {
    const d = await getJSON(`https://api.twelvedata.com/symbol_search?${new URLSearchParams({ symbol: q, outputsize: 12 })}`);
    return (d && d.data || []).filter(x => /stock|etf|common/i.test(x.instrument_type || 'stock')).map(x => {
      const s = x.country === 'United States' ? '' : sfxFromMic(x.mic_code);
      return s == null ? null : { symbol: x.symbol + (s ? '.' + s : ''), name: x.instrument_name, exchange: x.exchange, currency: x.currency };
    }).filter(Boolean);
  },
  async fx(pair, key) { return this.daily(pair, key); },
};

const eodLimit = limiter(200);
const EOD = {
  id: 'eodhd', name: 'EODHD', short: 'EODHD', needsKey: true, site: 'https://eodhd.com/financial-apis/',
  blurb: 'Worldwide end-of-day prices including European and Asian exchanges and real indexes (paid plans; the free key is very limited).',
  map(sym) { const { base, sfx } = splitSym(sym); return base + '.' + ((SUFFIX[sfx] || SUFFIX['']).eod); },
  async daily(sym, key, fromT) {
    const q = { api_token: key, fmt: 'json', period: 'd' }; q.from = fromT ? ymd(fromT) : ymd(Date.now() / 1000 - 4.3 * 365 * 86400);
    const target = sym.endsWith('.INDX') || sym.endsWith('.FOREX') ? sym : this.map(sym);
    const d = await eodLimit(() => getJSON(`https://eodhd.com/api/eod/${encodeURIComponent(target)}?${new URLSearchParams(q)}`));
    if (!Array.isArray(d)) throw new DataError(errText(d) || 'No price history from EODHD for ' + sym + '.', 'notfound');
    // split-adjust OHLC with adjusted_close so long histories don't jump at splits
    return { bars: clean(d.map(x => { const f = x.adjusted_close && x.close ? x.adjusted_close / x.close : 1; return { time: dToT(x.date), open: x.open * f, high: x.high * f, low: x.low * f, close: x.close * f, volume: f ? x.volume / f : x.volume }; })) };
  },
  indexSym: k => INDEXES[k] && INDEXES[k].eod,
  async earnings(sym, key) {
    const now = Date.now() / 1000;
    const d = await eodLimit(() => getJSON(`https://eodhd.com/api/calendar/earnings?${new URLSearchParams({ symbols: this.map(sym), from: ymd(now - 5 * 365 * 86400), to: ymd(now + 150 * 86400), api_token: key, fmt: 'json' })}`));
    const arr = d && Array.isArray(d.earnings) ? d.earnings : null;
    if (!arr) throw new DataError(errText(d) || 'No earnings data from EODHD for ' + sym + '.', 'notfound');
    return arr.map(x => ({ time: dToT(x.report_date || x.date), eps: x.actual == null ? null : +x.actual, est: x.estimate == null ? null : +x.estimate, period: x.date ? 'Q ending ' + x.date : '' }));
  },
  async news(sym, key) {
    const target = sym.includes('.INDX') ? sym : this.map(sym);
    const d = await eodLimit(() => getJSON(`https://eodhd.com/api/news?${new URLSearchParams({ s: target, limit: 30, api_token: key, fmt: 'json' })}`));
    return (Array.isArray(d) ? d : []).map(x => ({ title: x.title, link: x.link, date: Date.parse(x.date), source: (() => { try { return new URL(x.link).hostname.replace(/^www\./, ''); } catch (e) { return 'EODHD'; } })() }));
  },
  async search(q, key) {
    const d = await getJSON(`https://eodhd.com/api/search/${encodeURIComponent(q)}?${new URLSearchParams({ api_token: key, fmt: 'json', limit: 12 })}`);
    return (Array.isArray(d) ? d : []).map(x => { const s = sfxFromEod(x.Exchange); return s == null ? null : { symbol: x.Code + (s ? '.' + s : ''), name: x.Name, exchange: x.Exchange, currency: x.Currency, isin: x.ISIN }; }).filter(Boolean);
  },
  async fx(pair, key) { return this.daily(pair.replace('/', '') + '.FOREX', key); },
};

/* ---------- built-in data + free live updates (no key) ---------- */
// The app ships with daily prices for ~380 stocks and the main indexes (public/data, built by
// scripts/build-snapshot.mjs). The desktop app (and the iPhone/Mac app) tops them up, and loads any other ticker,
// from free public chart feeds (Yahoo Finance, Stooq as a fallback). Browsers block those feeds (CORS),
// so a web preview shows the built-in data only.
let metaP = null; const shardP = new Map();
const base = () => (typeof document !== 'undefined' ? new URL('./data/', document.baseURI).href : './data/');
let uniP = null;
/** Every stock the app knows worldwide: {items: [[sym, name, region, sector, isin]], nv: [syms with secondary-venue built-in prices]}. */
export function universe() {
  if (!uniP) uniP = fetch(base() + 'universe.json').then(r => { if (!r.ok) throw new Error('no universe'); return r.json(); }).catch(e => { uniP = null; return { items: [], nv: [] }; });
  return uniP;
}
export function snapshotMeta() {
  if (!metaP) metaP = fetch(base() + 'meta.json').then(r => { if (!r.ok) throw new Error('no data'); return r.json(); }).catch(e => { metaP = null; throw e; });
  return metaP;
}
const shardOf = (sym, n) => { let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % n; };
async function snapBars(sym) {
  let m; try { m = await snapshotMeta(); } catch (e) { return null; }
  const i = shardOf(sym, m.shards);
  if (!shardP.has(i)) shardP.set(i, fetch(base() + `px-${i}.json`).then(r => r.json()).catch(e => { shardP.delete(i); return {}; }));
  const rows = (await shardP.get(i))[sym];
  if (!rows) return null;
  const info = sym.startsWith('^') ? { n: (m.indexes[sym.slice(1)] || {}).name, c: '', x: 'Index' } : (m.stocks.find(x => x.s === sym) || {});
  return { bars: rows.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] })), name: info.n || '', currency: info.c || '', exchange: info.x || '', asOf: rows[rows.length - 1][0] };
}
// index ids used by the app -> Yahoo symbols
const YH_INDEX = { GSPC: '^GSPC', IXIC: '^IXIC', NDX: '^NDX', DJI: '^DJI', RUT: '^RUT', SOX: '^SOX', WORLD: 'URTH', STOXX50E: '^STOXX50E', GDAXI: '^GDAXI', FCHI: '^FCHI', AEX: '^AEX', FTSEMIB: 'FTSEMIB.MI', IBEX: '^IBEX', BFX: '^BFX', FTSE: '^FTSE', SSMI: '^SSMI', OMXS30: '^OMX', OMXC25: '^OMXC25', OMXH25: '^OMXH25', OBX: 'OBX.OL', N225: '^N225', KS11: '^KS11', KQ11: '^KQ11', HSI: '^HSI', SSEC: '000001.SS', NSEI: '^NSEI', BSESN: '^BSESN', GSPTSE: '^GSPTSE', AXJO: '^AXJO' };
const yahooSym = sym => sym.startsWith('^') ? YH_INDEX[sym.slice(1)] || sym : sym;
async function yahoo(sym, fromT, { max = false } = {}) {
  const now = Math.floor(Date.now() / 1000), from = fromT || now - Math.round(4.3 * 365.25 * 86400);
  // the whole history as explicit dates: Yahoo answers range=max with MONTHLY bars even when daily ones are asked for
  const span = `period1=${max && !fromT ? 0 : from}&period2=${now + 86400}`;
  const d = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?${span}&interval=1d&includePrePost=false&events=split`);
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r || !r.timestamp) throw new DataError((d && d.chart && d.chart.error && d.chart.error.description) || 'No data for ' + sym + '.', 'notfound');
  if (r.meta.dataGranularity && r.meta.dataGranularity !== '1d') throw new DataError(`The feed sent ${r.meta.dataGranularity} bars instead of daily bars for ${sym}.`, 'data');
  const q = r.indicators.quote[0], off = r.meta.gmtoffset || 0;
  const bars = clean(r.timestamp.map((t, i) => ({ time: Math.floor((t + off) / 86400) * 86400, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 })));
  const splits = Object.values((r.events && r.events.splits) || {}).map(x => ({ time: x.date, ratio: x.numerator / x.denominator })).filter(x => x.ratio > 0 && x.ratio !== 1).sort((a, b) => a.time - b.time);
  // regular-session quote (the headline price on Yahoo); today's open comes from the feed's own row for today
  const m = r.meta, li = r.timestamp.length - 1, sameDay = li >= 0 && Math.floor((r.timestamp[li] + off) / 86400) === Math.floor(((m.regularMarketTime || 0) + off) / 86400);
  const quote = {
    price: m.regularMarketPrice, time: m.regularMarketTime, off, high: m.regularMarketDayHigh, low: m.regularMarketDayLow, volume: m.regularMarketVolume,
    open: sameDay ? q.open[li] : null, ext: m.hasPrePostMarketData && m.fulldayPrice > 0 && Math.abs(m.fulldayPrice / m.regularMarketPrice - 1) > 0.0005 ? m.fulldayPrice : null,
    session: m.currentTradingPeriod && m.currentTradingPeriod.regular ? { start: m.currentTradingPeriod.regular.start, end: m.currentTradingPeriod.regular.end } : null,
  };
  return { bars: fixSpikes(alignQuote(bars, quote)), splits, quote, currency: r.meta.currency, name: r.meta.longName || r.meta.shortName || '', exchange: r.meta.fullExchangeName || r.meta.exchangeName || '' };
}
/**
 * Intraday bars from the free Yahoo chart feed (desktop app; browsers block it). range '1d' or '5d'; interval '1m',
 * '5m', '15m'… Times are shifted to the exchange's local clock so the chart axis shows local trading hours.
 * Returns {bars, prevClose, price, at, tz, open (market open now), session: {start, end}, currency, name}.
 */
export async function yahooIntraday(sym, { range = '1d', interval = '5m' } = {}) {
  const d = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?range=${range}&interval=${interval}&includePrePost=false`);
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r || !r.timestamp) throw new DataError((d && d.chart && d.chart.error && d.chart.error.description) || 'No intraday data for ' + sym + '.', 'notfound');
  const q = r.indicators.quote[0], m = r.meta, off = m.gmtoffset || 0, bars = [];
  r.timestamp.forEach((t, i) => { if (q.close[i] != null && q.open[i] != null) bars.push({ time: t + off, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 }); });
  const reg = m.currentTradingPeriod && m.currentTradingPeriod.regular, now = Date.now() / 1000;
  return {
    bars, prevClose: range === '1d' ? (m.chartPreviousClose ?? m.previousClose) : (m.previousClose ?? m.chartPreviousClose), price: m.regularMarketPrice ?? (bars.length ? bars[bars.length - 1].close : null),
    at: m.regularMarketTime || null, tz: m.exchangeTimezoneName || '', off, open: !!(reg && now >= reg.start && now < reg.end), session: reg ? { start: reg.start + off, end: reg.end + off } : null,
    currency: m.currency || '', name: m.longName || m.shortName || '',
  };
}
/**
 * Next earnings date and recent EPS estimates from Yahoo (desktop app only: needs a session crumb).
 * Returns {next: {time, est} | null, hist: [{end, est, actual}]}.
 */
export async function yahooCalendar(sym) {
  const d = await getJSON(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=calendarEvents,earningsHistory&crumb=__CRUMB__`);
  const r = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
  if (!r) throw new DataError('No calendar for ' + sym + '.', 'notfound');
  const e = r.calendarEvents && r.calendarEvents.earnings, dates = (e && e.earningsDate) || [];
  const next = dates.length && dates[0].raw ? { time: dates[0].raw, est: e.earningsAverage ? e.earningsAverage.raw : null, tentative: dates.length > 1 } : null;
  const hist = ((r.earningsHistory && r.earningsHistory.history) || []).filter(h => h.quarter && h.quarter.raw).map(h => ({ end: h.quarter.raw, est: h.epsEstimate ? h.epsEstimate.raw : null, actual: h.epsActual ? h.epsActual.raw : null }));
  return { next, hist };
}
/**
 * EPS history from the free Yahoo fundamentals feed, for any stock (European and Asian too):
 * quarterly (or half-yearly) and yearly figures. EPS = diluted EPS, else basic EPS, else net income ÷ average shares.
 * Falls back to the quote-summary earnings modules (last 4 quarters) when the time series has nothing.
 * Rows: [{time (report date, estimated when unknown), end, eps, rev, period, src, tentative, annual?}] oldest first.
 */
export async function yahooEps(sym) {
  const now = Math.floor(Date.now() / 1000), y = encodeURIComponent(yahooSym(sym));
  const F = ['DilutedEPS', 'BasicEPS', 'NetIncomeCommonStockholders', 'NetIncome', 'DilutedAverageShares', 'BasicAverageShares', 'TotalRevenue'];
  const types = ['quarterly', 'annual'].flatMap(p => F.map(f => p + f)).join(',');
  let res = [];
  try {
    const d = await getJSON(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${y}?symbol=${y}&type=${types}&period1=493590046&period2=${now}&crumb=__CRUMB__`);
    res = (d && d.timeseries && d.timeseries.result) || [];
  } catch (e) { /* try the quote summary below */ }
  const series = k => { const r = res.find(x => x.meta && x.meta.type && x.meta.type[0] === k); return ((r && r[k]) || []).filter(x => x && x.reportedValue && x.reportedValue.raw != null); };
  const build = prefix => {
    const m = new Map(), put = (f, x) => { if (!m.has(x.asOfDate)) m.set(x.asOfDate, { end: x.asOfDate }); m.get(x.asOfDate)[f] = x.reportedValue.raw; };
    F.forEach(f => series(prefix + f).forEach(x => put(f, x)));
    return [...m.values()].map(r => {
      const sh = r.DilutedAverageShares || r.BasicAverageShares, ni = r.NetIncomeCommonStockholders ?? r.NetIncome;
      const eps = r.DilutedEPS ?? r.BasicEPS ?? (ni != null && sh ? ni / sh : null);
      return { end: r.end, eps, rev: r.TotalRevenue ?? null };
    }).filter(r => r.eps != null && isFinite(r.eps)).sort((a, b) => a.end.localeCompare(b.end));
  };
  const q = build('quarterly'), a = build('annual');
  // half-year reporters show up as quarterly rows about six months apart
  const gaps = q.slice(1).map((r, i) => (dToT(r.end) - dToT(q[i].end)) / 86400).sort((x, z) => x - z), half = gaps.length && gaps[Math.floor(gaps.length / 2)] > 140;
  const rows = [
    ...q.map(r => ({ time: dToT(r.end) + (half ? 55 : 42) * 86400, end: r.end, eps: r.eps, rev: r.rev, period: (half ? 'Half year to ' : 'Qtr to ') + r.end, src: 'yahoo', tentative: true, half })),
    ...a.map(r => ({ time: dToT(r.end) + 70 * 86400, end: r.end, eps: r.eps, rev: r.rev, period: 'Year to ' + r.end, src: 'yahoo', tentative: true, annual: true })),
  ];
  if (q.length >= 2) return rows.sort((x, z) => x.time - z.time);
  // fallback: the quote summary's last four quarters (actual EPS and the quarter's end date)
  try {
    const d = await getJSON(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${y}?modules=earningsHistory,earnings&crumb=__CRUMB__`);
    const r = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
    const hist = ((r && r.earningsHistory && r.earningsHistory.history) || []).filter(h => h.quarter && h.quarter.raw && h.epsActual && h.epsActual.raw != null);
    hist.forEach(h => { const end = new Date(h.quarter.raw * 1000).toISOString().slice(0, 10); if (!rows.some(x => !x.annual && Math.abs(dToT(x.end) - h.quarter.raw) < 20 * 86400)) rows.push({ time: h.quarter.raw + 42 * 86400, end, eps: h.epsActual.raw, est: h.epsEstimate ? h.epsEstimate.raw : null, rev: null, period: 'Qtr to ' + end, src: 'yahoo', tentative: true }); });
  } catch (e) { /* nothing more */ }
  return rows.sort((x, z) => x.time - z.time);
}
/** Stock splits of a ticker from the free chart feed ({time, ratio}, ratio 10 = 10-for-1). */
export async function yahooSplits(sym) {
  const d = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=max&interval=1mo&events=split`);
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  return Object.values((r && r.events && r.events.splits) || {}).map(x => ({ time: x.date, ratio: x.numerator / x.denominator })).filter(x => x.ratio > 0 && x.ratio !== 1).sort((a, b) => a.time - b.time);
}
const STOOQ = { '': 'us', L: 'uk', DE: 'de', T: 'jp', HK: 'hk' };
async function stooq(sym) {
  const { base: b, sfx } = splitSym(sym); if (sym.startsWith('^') || !(sfx in STOOQ)) throw new DataError('Not on Stooq.', 'notfound');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent((b + '.' + STOOQ[sfx]).toLowerCase())}&i=d`;
  let txt;
  txt = (await httpGet(url)).text;
  const rows = String(txt).trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(c => c.length >= 5);
  if (rows.length < 60) throw new DataError('No data for ' + sym + ' on Stooq.', 'notfound');
  return { bars: clean(rows.map(c => ({ time: dToT(c[0]), open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +(c[5] || 0) }))) };
}
let liveDownUntil = 0; // after a failure (e.g. a browser blocking the feeds) don't retry for a while
async function live(sym, fromT, opts) {
  if (Date.now() < liveDownUntil) throw new DataError('Live feeds unavailable.', 'network');
  try { return await yahoo(sym, fromT, opts); }
  catch (e) { try { return await stooq(sym); } catch (e2) { if (e.kind === 'network' || !isApp()) liveDownUntil = Date.now() + 10 * 60e3; throw e; } }
}

const FREE = {
  id: 'free', name: 'Built-in data + free live updates', short: 'Built-in', needsKey: false,
  blurb: 'Daily prices for about 380 stocks and the main indexes come with the app, so it works offline. The desktop app adds the latest days, the full price history and any other ticker, from free public chart feeds (Yahoo Finance, Stooq). No account or key needed.',
  async daily(sym, key, fromT, { long = false } = {}) {
    const snap = await snapBars(sym);
    if (fromT) { const r = await live(sym, fromT); return { ...r, live: true }; } // incremental update of a cached series
    try {
      // long = the whole history (chart view); otherwise only the days after the built-in data
      const r = long ? await live(sym, null, { max: true }) : await live(sym, snap ? snap.bars[snap.bars.length - 1].time - 10 * 86400 : null);
      if (!snap) return { ...r, live: true };
      const mg = mergeBars(snap.bars, r.bars);
      // the built-in prices come from another venue or unit than the live feed: use the live history only
      if (!mg.ok) { const full = long ? r : await live(sym, null); return { ...full, name: full.name || snap.name, live: true, note: 'live prices only (built-in data differed)' }; }
      return { ...snap, name: snap.name || r.name, currency: snap.currency || r.currency, splits: r.splits, quote: r.quote, bars: fixSpikes(mg.bars), live: true };
    } catch (e) {
      if (snap) return { ...snap, live: false };
      throw new DataError(`${sym} is not in the built-in data${isApp() ? ' and the free feeds did not answer' : '. Other tickers load in the desktop app (browsers block the free feeds)'}.`, 'notfound');
    }
  },
  indexSym: k => '^' + k,
  async earnings(sym) {
    const m = await snapshotMeta(), e = m.earnings[sym];
    if (!e) throw new DataError('No earnings for ' + sym + ' in the built-in data. A key from FMP, Twelve Data or EODHD (Settings) adds earnings for any stock.', 'notfound');
    return e.q.map(x => ({ time: dToT(x.t), eps: x.eps, est: x.est, rev: x.rev, revEst: x.revEst, period: x.p, tentative: x.tentative }));
  },
  async search(q) {
    const Q = q.toUpperCase().trim(), m = await snapshotMeta(), have = new Set(m.stocks.map(x => x.s));
    // an ISIN (e.g. BE0003739530): look it up in the built-in lists, then ask the free feed
    if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(Q)) {
      const U0 = await universe();
      const hit = [...m.directory.filter(r => (r[2] || '').toUpperCase() === Q).map(r => ({ symbol: r[0], name: r[1], exchange: r[3] || '' })),
        ...U0.items.filter(r => (r[4] || '').toUpperCase() === Q).map(r => ({ symbol: r[0], name: r[1], exchange: r[2] })) ];
      if (!isApp()) return hit;
      try {
        const d = await getJSON(`https://query2.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: Q, quotesCount: 6, newsCount: 0 })}`);
        (d.quotes || []).forEach(x => { if (x.symbol && !hit.some(h => h.symbol === x.symbol)) hit.push({ symbol: x.symbol, name: x.longname || x.shortname, exchange: x.exchDisp || x.exchange }); });
      } catch (e) { /* built-in matches only */ }
      return hit;
    }
    const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const score = (s, n) => (s === Q || s.split('.')[0] === Q ? 100 : s.startsWith(Q) ? 40 : 0) + (fold(n).startsWith(Q) ? 60 : fold(n).includes(' ' + Q) ? 35 : fold(n).includes(Q) ? 20 : 0);
    const U = await universe(), known = new Set([...have, ...m.directory.map(r => r[0])]);
    const rows = [...m.stocks.map(x => [x.s, x.n, '', x.x]), ...m.directory.filter(r => !have.has(r[0])), ...U.items.filter(r => !known.has(r[0])).map(r => [r[0], r[1], r[4], r[2]])];
    const local = rows.map(r => [score(r[0], r[1]), r]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || (have.has(b[1][0]) - have.has(a[1][0]))).slice(0, 10)
      .map(([, r]) => ({ symbol: r[0], name: r[1], exchange: have.has(r[0]) ? 'Built-in data' : (r[3] || '') + (isApp() ? '' : ' · loads in the desktop app'), isin: r[2] }));
    if (!isApp()) return local;
    // every company listed in the US, from the SEC's list (cached a week): finds names outside the built-in lists
    try {
      const seen = new Set(local.map(x => x.symbol));
      const sec = (await secCompanies('BasePatternDesk/1.0 personal research')).filter(x => /^(Nasdaq|NYSE)/i.test(x.x) && !seen.has(x.s));
      const hits = sec.map(x => [score(x.s, x.n), x]).filter(x => x[0] >= 35).sort((a, b) => b[0] - a[0]).slice(0, 8).map(([, x]) => ({ symbol: x.s, name: x.n, exchange: x.x }));
      local.push(...hits); local.sort((a, b) => score(b.symbol, b.name) - score(a.symbol, a.name));
    } catch (e) { /* SEC list unavailable */ }
    // always also ask the free feed's search, so every listed stock worldwide can be found
    try {
      const d = await getJSON(`https://query2.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q, quotesCount: 12, newsCount: 0 })}`);
      const extra = (d.quotes || []).filter(x => x.symbol && /EQUITY|ETF|INDEX/.test(x.quoteType || '') && !local.some(l => l.symbol === x.symbol)).map(x => ({ symbol: x.symbol, name: x.longname || x.shortname, exchange: x.exchDisp || x.exchange }));
      return [...local, ...extra].slice(0, 16);
    } catch (e) { return local; }
  },
  async fx(pair) { const [a, b] = pair.split('/'); return yahoo(a + b + '=X'); },
};

const DEMO_P = {
  id: 'demo', name: 'Fictional pattern examples', short: 'Demo', needsKey: false,
  blurb: 'Fictional companies with made-up prices, built to show every base pattern. No account or internet needed.',
  async earnings(sym) { const e = demoEarnings(sym); if (!e) throw new DataError('No demo earnings for ' + sym + '.', 'notfound'); return e; },
  async news(sym) { return demoNews(sym); },
  async daily(sym) { const d = demoBars(sym); if (!d) throw new DataError(sym + ' is not in the demo data. Add a data provider in Settings to load real stocks.', 'notfound'); return { bars: d.bars, name: d.name, currency: 'USD', exchange: d.exchange }; },
  indexSym: null,
  async search(q) {
    const Q = q.toUpperCase();
    return DEMO.filter(d => d.sym.includes(Q) || d.name.toUpperCase().includes(Q)).map(d => ({ symbol: d.sym, name: d.name, exchange: 'Demo data' }));
  },
  async fx() { return { bars: [] }; },
};

export const PROVIDERS = { free: FREE, fmp: FMP, twelvedata: TD, eodhd: EOD, demo: DEMO_P };
export { DEMO, DEMO_INDEXES, DEMO_BENCH };
