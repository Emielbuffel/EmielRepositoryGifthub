// Company profile and key statistics: what the company does, size, valuation, share supply (float, shares,
// insiders), institutional ownership, analysts' targets and return on equity.
//  - desktop app: Yahoo Finance quote summary (free, needs the session crumb the desktop shell adds)
//  - an FMP key: FMP's company profile (in the web version too)
//  - otherwise: the name and sector of the built-in lists
import { getJSON, PROVIDERS, snapshotMeta, universe } from './providers.js';
import { settings } from './service.js';
import { isApp } from './net.js';
import * as store from './store.js';

const v = x => (x && typeof x === 'object' ? (x.raw ?? null) : x ?? null);

export function parseYahooProfile(d) {
  const r = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0]; if (!r) return null;
  const ap = r.assetProfile || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, mh = r.majorHoldersBreakdown || {}, pr = r.price || {};
  return {
    name: pr.longName || pr.shortName || null, sector: ap.sector || null, industry: ap.industry || null, country: ap.country || null,
    website: ap.website || null, employees: ap.fullTimeEmployees ?? null, about: ap.longBusinessSummary || null, cur: pr.currency || sd.currency || null,
    mcap: v(sd.marketCap) ?? v(pr.marketCap), pe: v(sd.trailingPE), fpe: v(sd.forwardPE) ?? v(ks.forwardPE), peg: v(ks.pegRatio), pb: v(ks.priceToBook),
    divYield: v(sd.dividendYield), beta: v(sd.beta) ?? v(ks.beta), avgVol: v(sd.averageVolume),
    shares: v(ks.sharesOutstanding), float: v(ks.floatShares), insiders: v(ks.heldPercentInsiders) ?? v(mh.insidersPercentHeld),
    inst: v(ks.heldPercentInstitutions) ?? v(mh.institutionsPercentHeld), instCount: v(mh.institutionsCount), short: v(ks.shortPercentOfFloat), shortRatio: v(ks.shortRatio),
    sharesChange: null,
    target: v(fd.targetMeanPrice), targetHi: v(fd.targetHighPrice), targetLo: v(fd.targetLowPrice), analysts: v(fd.numberOfAnalystOpinions), rec: fd.recommendationKey || null,
    roe: v(fd.returnOnEquity), margin: v(fd.profitMargins), revGrowth: v(fd.revenueGrowth), epsGrowth: v(fd.earningsGrowth), de: v(fd.debtToEquity),
  };
}

export function parseFmpProfile(arr) {
  const x = Array.isArray(arr) ? arr[0] : null; if (!x) return null;
  return {
    name: x.companyName || null, sector: x.sector || null, industry: x.industry || null, country: x.country || null, website: x.website || null,
    employees: x.fullTimeEmployees ? +x.fullTimeEmployees : null, about: x.description || null, cur: x.currency || null,
    mcap: x.marketCap ?? x.mktCap ?? null, beta: x.beta ?? null, avgVol: x.averageVolume ?? x.volAvg ?? null, divYield: null,
  };
}

/** Profile for a ticker: {..., src}; never throws (falls back to the built-in name and sector). */
export async function companyInfo(sym) {
  const ck = 'co:' + sym, c = await store.cacheGet(ck);
  if (c && Date.now() - c.fetchedAt < 24 * 3600e3) return c;
  let r = null;
  if (isApp()) {
    try {
      const mods = 'assetProfile,summaryDetail,defaultKeyStatistics,financialData,majorHoldersBreakdown,price';
      r = parseYahooProfile(await getJSON(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${mods}&crumb=__CRUMB__`));
      if (r) r.src = 'Yahoo Finance';
    } catch (e) { /* try the next source */ }
  }
  const key = (settings.keys.fmp || '').trim();
  if (!r && key) { try { r = parseFmpProfile(await getJSON(PROVIDERS.fmp.url('profile', key, { symbol: sym }))); if (r) r.src = 'Financial Modeling Prep'; } catch (e) { /* none */ } }
  if (!r) {
    try {
      const m = await snapshotMeta(), s = m.stocks.find(x => x.s === sym), u = (await universe()).items.find(x => x[0] === sym);
      if (s || u) r = { name: (s && s.n) || u[1], sector: (s && s.g) || (u && u[3]) || null, rs: s ? s.r : null, src: 'built-in list', limited: true };
    } catch (e) { /* none */ }
  }
  if (!r) return c || null;
  const doc = { ...r, fetchedAt: Date.now() };
  if (!r.limited) await store.cacheSet(ck, doc);
  return doc;
}
