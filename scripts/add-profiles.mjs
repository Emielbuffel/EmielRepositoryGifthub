// Adds the industry and a one-line description of each built-in stock to public/data/meta.json (fields i and b),
// from Yahoo's company profiles, so the page on claude.ai (which cannot reach Yahoo) can show what each company is.
// Run with network access: NODE_USE_ENV_PROXY=1 node scripts/add-profiles.mjs [--all]  (--all: also those already done)
import fs from 'node:fs';
import { brief } from '../src/core/brief.js';

const file = new URL('../public/data/meta.json', import.meta.url), meta = JSON.parse(fs.readFileSync(file));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const all = process.argv.includes('--all');

// Yahoo's session: a cookie from fc.yahoo.com, then the crumb that goes with it
const wait = ms => new Promise(z => setTimeout(z, ms)), TO = () => AbortSignal.timeout(15000);
const c = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: TO() }).catch(() => null);
const cookie = c ? (c.headers.getSetCookie ? c.headers.getSetCookie() : [c.headers.get('set-cookie')]).filter(Boolean).map(x => x.split(';')[0]).join('; ') : '';
let crumb = '';
for (let a = 0; a < 6 && !(crumb && crumb.length < 40 && !/too many/i.test(crumb)); a++) { if (a) await wait(20000); crumb = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie }, signal: TO() }).then(r => r.text()).catch(() => ''); }
if (!crumb || crumb.length > 40 || /too many/i.test(crumb)) { console.error('No Yahoo crumb (rate limited?):', crumb.slice(0, 80)); process.exit(1); }

let ok = 0, miss = [];
const todo = meta.stocks.filter(s => all || !s.b);
async function one(s) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s.s)}?modules=assetProfile,price&crumb=${encodeURIComponent(crumb)}`, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: TO() });
      if (r.status === 429) { await wait(15000); continue; }
      const j = await r.json(), x = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
      const ap = (x && x.assetProfile) || {}, name = (x && x.price && (x.price.longName || x.price.shortName)) || s.n;
      if (ap.industry) s.i = ap.industry;
      if (!s.g && ap.sector) s.g = ap.sector;
      const b = brief(ap.longBusinessSummary, name); if (b) s.b = b;
      if (!s.n && name) s.n = name;
      if (b || ap.industry) ok++; else miss.push(s.s);
      return;
    } catch (e) { await new Promise(z => setTimeout(z, 1500)); }
  }
  miss.push(s.s);
}
// gently: two at a time with a pause, saving progress every 25 stocks
const q = todo.slice(); let n = 0;
await Promise.all(Array.from({ length: 2 }, async () => { while (q.length) { await one(q.shift()); await wait(350); if (++n % 25 === 0) { fs.writeFileSync(file, JSON.stringify(meta)); console.log(n + ' done'); } } }));
fs.writeFileSync(file, JSON.stringify(meta));
console.log(`profiles for ${ok} of ${todo.length}${miss.length ? '; none for ' + miss.length + ' (' + miss.slice(0, 10).join(', ') + ')' : ''}`);
