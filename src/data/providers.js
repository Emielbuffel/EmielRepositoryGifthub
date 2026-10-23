// Market data providers. The user brings their own API key (stored on the device only).
// Tickers inside the app use Yahoo-style suffixes (AAPL, ASML.AS, 7203.T, 005930.KS); each provider maps them.
// Endpoints follow each provider's public documentation; check them if a provider changes its API.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { demoBars, DEMO, DEMO_INDEXES, DEMO_BENCH } from './demo.js';

export class DataError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; } // kind: auth | plan | limit | notfound | network | error
}

/* ---------- HTTP: native requests on iOS/macOS (no CORS), fetch in a browser ---------- */
async function getJSON(url) {
  let status, data;
  try {
    if (Capacitor.isNativePlatform()) {
      const r = await CapacitorHttp.get({ url, responseType: 'json', connectTimeout: 15000, readTimeout: 30000 });
      status = r.status; data = r.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { /* plain-text error */ } }
    } else {
      const r = await fetch(url); status = r.status; const t = await r.text();
      try { data = JSON.parse(t); } catch (e) { data = t; }
    }
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

/* ---------- market indexes (with US ETF fallbacks that every provider covers) ---------- */
export const MARKET = [
  { k: 'IXIC', name: 'Nasdaq Composite', etf: 'QQQ', etfName: 'Nasdaq-100 ETF (QQQ)', region: 'US' },
  { k: 'GSPC', name: 'S&P 500', etf: 'SPY', etfName: 'S&P 500 ETF (SPY)', region: 'US' },
  { k: 'DJI', name: 'Dow Jones Industrial', etf: 'DIA', etfName: 'Dow ETF (DIA)', region: 'US' },
  { k: 'STOXX50E', name: 'Euro Stoxx 50', etf: 'FEZ', etfName: 'Euro Stoxx 50 ETF (FEZ, USD)', region: 'EU' },
];

/* ---------- providers ---------- */
const fmpLimit = limiter(250);
const FMP = {
  id: 'fmp', name: 'Financial Modeling Prep', short: 'FMP', needsKey: true, site: 'https://site.financialmodelingprep.com/developer/docs',
  blurb: 'US stocks on the free plan (250 requests a day); worldwide listings, indexes and fundamentals on paid plans. Also gives earnings data for the CAN SLIM check.',
  url: (path, key, q) => `https://financialmodelingprep.com/stable/${path}?${new URLSearchParams({ ...q, apikey: key })}`,
  async daily(sym, key, fromT) {
    const q = { symbol: sym }; if (fromT) q.from = ymd(fromT);
    const d = await fmpLimit(() => getJSON(this.url('historical-price-eod/full', key, q)));
    const arr = Array.isArray(d) ? d : Array.isArray(d && d.historical) ? d.historical : null;
    if (!arr) throw new DataError(errText(d) || 'No price history from FMP for ' + sym + '.', 'notfound');
    return { bars: clean(arr.map(x => ({ time: dToT(x.date), open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))) };
  },
  indexSym: k => '^' + k,
  async search(q, key) {
    const [a, b] = await Promise.allSettled([getJSON(this.url('search-symbol', key, { query: q, limit: 10 })), getJSON(this.url('search-name', key, { query: q, limit: 10 }))]);
    const out = new Map();
    for (const r of [a, b]) if (r.status === 'fulfilled' && Array.isArray(r.value)) r.value.forEach(x => { if (x.symbol && !out.has(x.symbol)) out.set(x.symbol, { symbol: x.symbol, name: x.name, exchange: x.exchangeFullName || x.exchange || '', currency: x.currency || '' }); });
    if (!out.size && a.status === 'rejected') throw a.reason;
    return [...out.values()];
  },
  async fundamentals(sym, key) {
    const [q, y] = await Promise.all([
      fmpLimit(() => getJSON(this.url('income-statement', key, { symbol: sym, period: 'quarter', limit: 8 }))),
      fmpLimit(() => getJSON(this.url('income-statement', key, { symbol: sym, period: 'annual', limit: 4 }))),
    ]);
    if (!Array.isArray(q) || !q.length) throw new DataError('FMP has no earnings data for ' + sym + ' on this plan.', 'plan');
    const pick = x => ({ date: x.date, period: (x.period || '') + ' ' + (x.fiscalYear || x.calendarYear || ''), eps: +(x.epsDiluted ?? x.epsdiluted ?? x.eps), revenue: +x.revenue, netIncome: +x.netIncome, pretax: +(x.incomeBeforeTax ?? 0) });
    return { quarters: q.map(pick).reverse(), annual: Array.isArray(y) ? y.map(pick).reverse() : [], source: 'FMP income statements (reported EPS, diluted)' };
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
  indexSym: k => k + '.INDX',
  async search(q, key) {
    const d = await getJSON(`https://eodhd.com/api/search/${encodeURIComponent(q)}?${new URLSearchParams({ api_token: key, fmt: 'json', limit: 12 })}`);
    return (Array.isArray(d) ? d : []).map(x => { const s = sfxFromEod(x.Exchange); return s == null ? null : { symbol: x.Code + (s ? '.' + s : ''), name: x.Name, exchange: x.Exchange, currency: x.Currency, isin: x.ISIN }; }).filter(Boolean);
  },
  async fx(pair, key) { return this.daily(pair.replace('/', '') + '.FOREX', key); },
};

const DEMO_P = {
  id: 'demo', name: 'Demo data (fictional)', short: 'Demo', needsKey: false,
  blurb: 'Fictional companies with made-up prices, built to show every base pattern. No account or internet needed.',
  async daily(sym) { const d = demoBars(sym); if (!d) throw new DataError(sym + ' is not in the demo data. Add a data provider in Settings to load real stocks.', 'notfound'); return { bars: d.bars, name: d.name, currency: 'USD', exchange: d.exchange }; },
  indexSym: null,
  async search(q) {
    const Q = q.toUpperCase();
    return DEMO.filter(d => d.sym.includes(Q) || d.name.toUpperCase().includes(Q)).map(d => ({ symbol: d.sym, name: d.name, exchange: 'Demo data' }));
  },
  async fx() { return { bars: [] }; },
};

export const PROVIDERS = { demo: DEMO_P, fmp: FMP, twelvedata: TD, eodhd: EOD };
export { DEMO, DEMO_INDEXES, DEMO_BENCH };
