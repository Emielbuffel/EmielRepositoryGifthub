// Gives every US stock in the built-in data (public/data/meta.json) its long quarterly EPS history from SEC EDGAR
// (official 10-Q/10-K filings, back to about 2009), so the page on claude.ai — which cannot reach EDGAR — shows the same
// long EPS line as the desktop app. Stock splits are found from jumps in the filed share counts.
// Run with network access: NODE_USE_ENV_PROXY=1 node scripts/add-sec-eps.mjs [--all]
// (--all: also stocks that already have 16+ quarters; otherwise only shorter histories are extended)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseFacts, periods } from '../src/data/sec.js';

// EDGAR asks tools to identify themselves with a contact address; this one is generic on purpose (no personal data)
const UA = 'BasePatternDesk research-script admin@example.org';
const all = process.argv.includes('--all');
const metaFile = new URL('../public/data/meta.json', import.meta.url), meta = JSON.parse(fs.readFileSync(metaFile));
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = async url => { for (let a = 0; a < 3; a++) { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }).catch(() => null); if (r && r.status === 200) return r.json(); if (r && r.status === 404) return null; await wait(2000 * (a + 1)); } return null; };

/** Splits from the diluted share count as first filed, quarter after quarter: a jump by ~2, 3, 4… (or 1/n) is a split. */
export function splitsFromShares(doc) {
  const g = (doc.facts && doc.facts['us-gaap']) || {}, t = g.WeightedAverageNumberOfDilutedSharesOutstanding || g.WeightedAverageNumberOfSharesOutstandingBasic;
  if (!t || !t.units || !t.units.shares) return [];
  const ps = periods(t.units.shares).filter(p => { const d = (Date.parse(p.end) - Date.parse(p.start)) / 864e5; return d >= 75 && d <= 105; }).sort((a, b) => a.end.localeCompare(b.end));
  const first = new Map(); for (const f of t.units.shares) { const k = f.start + '|' + f.end; if (!first.has(k) || f.filed < first.get(k).filed) first.set(k, f); }
  const out = [];
  for (let i = 1; i < ps.length; i++) {
    const a = first.get(ps[i - 1].start + '|' + ps[i - 1].end), b = first.get(ps[i].start + '|' + ps[i].end); if (!a || !b || !a.val) continue;
    const r = b.val / a.val, n = Math.round(r >= 1 ? r : 1 / r);
    if (n >= 2 && n <= 50 && Math.abs((r >= 1 ? r : 1 / r) / n - 1) < 0.04) out.push({ time: Date.parse(b.filed + 'T00:00:00Z') / 1000 - 86400, ratio: r >= 1 ? n : 1 / n });
  }
  return out;
}

const list = (await get('https://www.sec.gov/files/company_tickers_exchange.json'));
const F = list.fields, cikOf = new Map(list.data.map(r => [String(r[F.indexOf('ticker')]).toUpperCase(), r[F.indexOf('cik')]]));
const have = s => ((meta.earnings[s] && meta.earnings[s].q) || []).filter(q => q.eps != null).length;
const us = meta.stocks.filter(s => !/\.[A-Z]+$/.test(s.s) && (all || have(s.s) < 16));
const add = {}, miss = [];
for (const s of us) {
  const cik = cikOf.get(s.s.replace('.', '-')) || cikOf.get(s.s); if (!cik) { miss.push(s.s + '(no CIK)'); continue; }
  await wait(150); // EDGAR fair access: under 10 requests a second
  const doc = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`);
  if (!doc) { miss.push(s.s + '(no facts)'); continue; }
  // a Q4 worked out as "full year minus three quarters" can be wrong around a split: drop one that flips sign against
  // both neighbours and is bigger than them (a real one-off loss reported in the filings themselves is kept)
  const rows = parseFacts(doc, splitsFromShares(doc)).filter((r, i, a) => {
    if (!r.derived || i === 0 || i === a.length - 1) return true;
    const p = a[i - 1].eps, n = a[i + 1].eps;
    return !(Math.sign(r.eps) !== Math.sign(p) && Math.sign(p) === Math.sign(n) && Math.abs(r.eps) > Math.max(Math.abs(p), Math.abs(n)));
  });
  if (rows.length < 4) { miss.push(s.s + '(' + rows.length + ' quarters)'); continue; }
  // merge-eps format: [periodEnd, reportDate, fiscalYear, fiscalQuarter, eps, revenue in millions]
  add[s.s] = rows.map(r => { const m = /Q(\d) FY(\d{4})/.exec(r.period) || []; return [r.end, new Date(r.time * 1000).toISOString().slice(0, 10), +m[2], +m[1], r.eps, r.rev != null ? Math.round(r.rev / 1e4) / 100 : null]; });
}
const tmp = new URL('../.sec-eps.tmp.json', import.meta.url).pathname;
fs.writeFileSync(tmp, JSON.stringify(add));
console.log(`SEC EPS for ${Object.keys(add).length} of ${us.length} US stocks; none for ${miss.length}${miss.length ? ' (' + miss.slice(0, 15).join(', ') + ')' : ''}`);
execFileSync('node', [new URL('./merge-eps.mjs', import.meta.url).pathname, tmp, 'SEC EDGAR (US GAAP diluted EPS)'], { stdio: 'inherit' });
fs.unlinkSync(tmp);
