// Fundamentals for the stock page, from the best source available:
//  - US filers: SEC EDGAR company facts (official filings, back to ~2009), desktop app
//  - other stocks: the free Yahoo fundamentals feed (about 5 quarters and 4 years), desktop app
//  - an FMP key (Settings) as a fallback, also in the web version
//  - the built-in data (revenue and EPS only) when nothing else answers
// Cached for a day; when a newer quarter appears than the one seen before, an alert "New results" is raised.
import { parseSecFundamentals, parseYahooFundamentals, parseFmpFundamentals, SEC_TAGS, YAHOO_TYPES, yoy } from '../core/fundamentals.js';
import { secGet, secCompanies } from './sec.js';
import { getJSON, PROVIDERS, splitSym, snapshotMeta } from './providers.js';
import { settings, secAgent } from './service.js';
import { isApp } from './net.js';
import { pushEvent } from './alerts.js';
import * as store from './store.js';

const ALL_TAGS = [...new Set(Object.values(SEC_TAGS).flat())];

async function fromSec(sym) {
  const list = await secCompanies(secAgent()), c = list.find(x => x.s === sym.toUpperCase());
  if (!c) return null;
  const doc = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(c.cik).padStart(10, '0')}.json`, secAgent());
  if (!doc) return null;
  const g = (doc.facts && doc.facts['us-gaap']) || {}, keep = {};
  ALL_TAGS.forEach(t => { if (g[t]) keep[t] = g[t]; });
  const r = parseSecFundamentals({ facts: { 'us-gaap': keep } });
  return r.rows.length ? { ...r, src: 'SEC EDGAR filings' } : null;
}

async function fromYahoo(sym) {
  const now = Math.floor(Date.now() / 1000), types = p => Object.values(YAHOO_TYPES).map(v => p + v).join(',');
  const url = p => `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?symbol=${encodeURIComponent(sym)}&type=${types(p)}&period1=493590046&period2=${now}`;
  const [q, a] = await Promise.all([getJSON(url('quarterly')), getJSON(url('annual')).catch(() => null)]);
  const Q = parseYahooFundamentals(q, 'quarterly'), A = a ? parseYahooFundamentals(a, 'annual') : { rows: [] };
  return Q.rows.length || A.rows.length ? { cur: Q.cur || A.cur, rows: Q.rows, annual: A.rows, src: 'Yahoo Finance (free feed)' } : null;
}

async function fromFmp(sym, key) {
  const F = PROVIDERS.fmp, get = (path, period) => getJSON(F.url(path, key, { symbol: sym, period, limit: 40 })).catch(() => null);
  for (const period of ['quarter', 'annual']) {
    const [inc, cf, bs] = await Promise.all([get('income-statement', period), get('cash-flow-statement', period), get('balance-sheet-statement', period)]);
    if (Array.isArray(inc) && inc.length) {
      const r = parseFmpFundamentals(inc, Array.isArray(cf) ? cf : [], Array.isArray(bs) ? bs : []);
      if (r.rows.length) return period === 'quarter' ? { ...r, src: 'Financial Modeling Prep' } : { cur: r.cur, rows: [], annual: r.rows, src: 'Financial Modeling Prep (yearly figures on your plan)' };
    }
  }
  return null;
}

async function fromBuiltIn(sym) {
  const m = await snapshotMeta(), e = m.earnings[sym]; if (!e) return null;
  const rows = e.q.filter(x => x.eps != null || x.rev != null).map(x => ({ end: x.t, filed: x.t, rev: x.rev ?? null, eps: x.eps ?? null }));
  return rows.length ? { cur: null, rows, src: 'built-in data (revenue and EPS only)', limited: true } : null;
}

/** {cur, rows, annual?, src, limited?, fetchedAt}; throws when no source has data. */
export async function fundamentals(sym, { force = false } = {}) {
  const ck = 'fund:' + sym, c = await store.cacheGet(ck);
  if (c && !force && Date.now() - c.fetchedAt < 24 * 3600e3) return c;
  let r = null, err = null;
  const us = !splitSym(sym).sfx && !sym.startsWith('^');
  const key = (settings.keys.fmp || '').trim();
  const tries = [];
  if (isApp() && us) tries.push(() => fromSec(sym));
  if (isApp()) tries.push(() => fromYahoo(sym));
  if (key && us) tries.push(() => fromFmp(sym, key));
  for (const t of tries) { try { r = await t(); if (r && r.rows.length >= 4) break; } catch (e) { err = err || e; } }
  if (!r || (!r.rows.length && !(r.annual || []).length)) { try { r = await fromBuiltIn(sym); } catch (e) { /* none */ } }
  if (!r) { if (c) return { ...c, stale: true }; throw err || new Error('No fundamentals for ' + sym + (isApp() ? '.' : ' in the web version. They load in the desktop app, or with an FMP key (Settings) for US stocks.')); }
  const doc = { ...r, fetchedAt: Date.now() };
  await store.cacheSet(ck, doc);
  await noticeNew(sym, doc);
  return doc;
}

/** Raises a "New results" alert when a quarter newer than the last one seen appears. */
async function noticeNew(sym, doc) {
  const z = doc.rows[doc.rows.length - 1]; if (!z || doc.limited) return;
  const seen = await store.get('fund.seen', {}), prev = seen[sym];
  if (prev && z.end > prev) {
    const g = yoy(doc.rows, 'rev'), n = yoy(doc.rows, 'net'), pct = x => (x >= 0 ? '+' : '') + Math.round(x * 100) + '%';
    await pushEvent({ sym, kind: 'results', title: `${sym}: new quarterly results`, body: `Quarter to ${z.end}${g != null ? ` · revenue ${pct(g)} vs a year ago` : ''}${n != null ? ` · net profit ${pct(n)}` : ''}.`, level: 'info' });
  }
  if (!prev || z.end > prev) { seen[sym] = z.end; await store.set('fund.seen', seen); }
}

/** Refreshes fundamentals for a list of symbols at most once a day (holdings and watchlist). */
export async function checkNewResults(syms) {
  const last = await store.get('fund.checked', 0);
  if (Date.now() - last < 20 * 3600e3 || !isApp()) return;
  await store.set('fund.checked', Date.now());
  for (const s of syms) { try { await fundamentals(s); } catch (e) { /* skip */ } }
}
