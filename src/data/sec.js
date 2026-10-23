// Free fundamentals for US-listed companies from SEC EDGAR (official filings, no key):
//  - the list of every listed company (ticker, name, exchange, CIK)
//  - quarterly EPS and revenue back to about 2009 (XBRL "company facts")
// EDGAR asks automated tools to send a User-Agent with a contact e-mail and to stay under 10 requests a second.
import { httpGet } from './net.js';
import * as store from './store.js';

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const tOf = d => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

let gap = Promise.resolve();
export async function secGet(url, agent) {
  // space requests ~150 ms apart (EDGAR's fair-access limit is 10 a second)
  const turn = gap.then(() => new Promise(r => setTimeout(r, 150))); gap = turn; await turn;
  const r = await httpGet(url, { headers: { 'User-Agent': agent, Accept: 'application/json' }, timeout: 60000 });
  if (r.status === 403) throw new Error('SEC EDGAR refused the request. Add your e-mail in Settings → Data (EDGAR asks tools to identify themselves).');
  if (r.status === 404) return null;
  if (r.status >= 400) throw new Error('SEC EDGAR error HTTP ' + r.status);
  return JSON.parse(r.text);
}

/** Every company with a ticker on a US exchange: [{s, n, x, cik}] (cached 7 days). */
export async function secCompanies(agent) {
  const c = await store.cacheGet('sec:companies');
  if (c && Date.now() - c.at < 7 * 864e5) return c.list;
  const d = await secGet('https://www.sec.gov/files/company_tickers_exchange.json', agent);
  const f = d.fields, I = k => f.indexOf(k);
  const list = d.data.map(r => ({ cik: r[I('cik')], n: r[I('name')], s: String(r[I('ticker')]).toUpperCase(), x: r[I('exchange')] || '' }));
  await store.cacheSet('sec:companies', { list, at: Date.now() });
  return list;
}

/** Listed operating companies on Nasdaq/NYSE, one ticker per company (no preferreds, warrants or units). */
export function listedCommon(list) {
  const seen = new Set();
  return list.filter(x => /^(Nasdaq|NYSE)$/i.test(x.x) && /^[A-Z]{1,5}(-[A-C])?$/.test(x.s) && !seen.has(x.cik) && seen.add(x.cik));
}

const EPS_TAGS = ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'];
const REV_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet'];
const FORMS = /^(10-Q|10-K|10-KT|10-QT)(\/A)?$/;

/**
 * Collapses XBRL facts to one value per period: {start, end, val, filed (first report), last (latest filing), fy, fp}.
 * The latest filing wins (restated figures, e.g. after a stock split); the first filing gives the report date and label.
 */
export function periods(facts) {
  const m = new Map();
  for (const f of facts) {
    if (!f.start || !f.end || f.val == null || !FORMS.test(f.form || '')) continue;
    const k = f.start + '|' + f.end; let p = m.get(k);
    if (!p) { p = { start: f.start, end: f.end, val: f.val, filed: f.filed, last: f.filed, fy: f.fy, fp: f.fp }; m.set(k, p); continue; }
    if (f.filed < p.filed) { p.filed = f.filed; p.fy = f.fy; p.fp = f.fp; }
    if (f.filed >= p.last) { p.last = f.filed; p.val = f.val; }
  }
  return [...m.values()];
}

/** Quarterly values (3-month periods, plus Q4 = full year minus the first three quarters when needed). */
export function quarterly(facts, perShare, splits) {
  const ps = periods(facts);
  const adj = p => { // per-share figures filed before a split are divided by the split ratio
    if (!perShare) return p.val;
    let f = 1; for (const s of splits) if (s.time > tOf(p.last)) f *= s.ratio;
    return p.val / f;
  };
  const q = ps.filter(p => { const d = days(p.start, p.end); return d >= 75 && d <= 105; }).map(p => ({ ...p, v: adj(p) }));
  const yr = ps.filter(p => { const d = days(p.start, p.end); return d >= 340 && d <= 380; });
  for (const y of yr) {
    if (q.some(x => Math.abs(days(x.end, y.end)) <= 10)) continue; // Q4 reported directly
    const inYear = q.filter(x => days(y.start, x.start) >= -10 && days(x.end, y.end) >= 60);
    if (inYear.length !== 3) continue;
    const last = inYear.reduce((a, b) => (a.end > b.end ? a : b));
    q.push({ start: last.end, end: y.end, filed: y.filed, last: y.last, fy: y.fy, fp: 'Q4', v: adj(y) - inYear.reduce((s, x) => s + x.v, 0), derived: true });
  }
  return q.sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Parses an EDGAR company-facts document into quarterly rows for the app:
 * [{time (first filing date), end, eps, rev, period, src}] oldest first. splits: [{time, ratio}].
 */
export function parseFacts(doc, splits = []) {
  const g = (doc && doc.facts && doc.facts['us-gaap']) || {};
  const pick = (tags, unitRe) => {
    const all = [];
    for (const t of tags) { const u = g[t] && g[t].units; if (!u) continue; const k = Object.keys(u).find(x => unitRe.test(x)); if (k) all.push(...u[k].map(f => ({ ...f, tag: t }))); }
    return all;
  };
  // EPS: the first tag that covers a period wins (diluted before basic)
  const epsFacts = []; const have = new Set();
  for (const t of EPS_TAGS) { const fs = pick([t], /^[A-Z]{3}\/shares$/); const add = fs.filter(f => !have.has(f.start + '|' + f.end)); add.forEach(f => epsFacts.push(f)); fs.forEach(f => have.add(f.start + '|' + f.end)); }
  const eps = quarterly(epsFacts, true, splits);
  const revQ = quarterly(pick(REV_TAGS, /^[A-Z]{3}$/), false, []);
  const revAt = end => { const r = revQ.find(x => Math.abs(days(x.end, end)) <= 10); return r ? r.v : null; };
  const out = eps.map(p => ({
    time: tOf(p.filed), end: p.end, eps: Math.round(p.v * 10000) / 10000, rev: revAt(p.end),
    period: (p.fp && /^Q[1-4]$/.test(p.fp) ? p.fp : 'Q4') + ' FY' + (p.fy || p.end.slice(0, 4)), src: 'sec', derived: !!p.derived,
  }));
  // one row per report date; drop rows whose filing came long after the quarter (late restatements)
  const seen = new Set();
  return out.filter(r => days(r.end, new Date(r.time * 1000).toISOString().slice(0, 10)) <= 200 && !seen.has(r.end) && seen.add(r.end)).sort((a, b) => a.time - b.time);
}

/** Quarterly EPS rows for a US ticker from EDGAR, or null when the company is not an EDGAR filer with US GAAP data. */
export async function secEarnings(sym, agent, splits) {
  const list = await secCompanies(agent), c = list.find(x => x.s === sym.toUpperCase());
  if (!c) return null;
  const ck = 'sec:facts:' + c.cik, hit = await store.cacheGet(ck);
  let doc = hit && Date.now() - hit.at < 3 * 864e5 ? hit.doc : null;
  if (!doc) {
    doc = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(c.cik).padStart(10, '0')}.json`, agent);
    if (!doc) return null;
    // keep only what the app reads, so the cache stays small
    const g = doc.facts && doc.facts['us-gaap'] || {}, keep = {};
    [...EPS_TAGS, ...REV_TAGS].forEach(t => { if (g[t]) keep[t] = { units: Object.fromEntries(Object.entries(g[t].units).map(([u, fs]) => [u, fs.map(({ start, end, val, fy, fp, form, filed }) => ({ start, end, val, fy, fp, form, filed }))])) }; });
    doc = { facts: { 'us-gaap': keep } };
    await store.cacheSet(ck, { doc, at: Date.now() });
  }
  const rows = parseFacts(doc, splits || []);
  return rows.length ? rows : null;
}

