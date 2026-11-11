// Writes public/data/us.json: every company listed on Nasdaq or NYSE ([ticker, name, exchange]) from the SEC's free list,
// so the page on claude.ai (which cannot reach the SEC) can find any US stock by name or ticker.
// Run with network access: NODE_USE_ENV_PROXY=1 node scripts/build-us-list.mjs
import fs from 'node:fs';
const UA = 'BasePatternDesk research-script admin@example.org'; // generic contact, as EDGAR asks (no personal data)
const d = await (await fetch('https://www.sec.gov/files/company_tickers_exchange.json', { headers: { 'User-Agent': UA } })).json();
const F = d.fields, I = k => F.indexOf(k), seen = new Set();
const rows = d.data.map(r => [String(r[I('ticker')]).toUpperCase(), r[I('name')], r[I('exchange')] || ''])
  .filter(([s, , x]) => /^(Nasdaq|NYSE)$/i.test(x) && /^[A-Z]{1,5}(-[A-C])?$/.test(s) && !seen.has(s) && seen.add(s));
fs.writeFileSync(new URL('../public/data/us.json', import.meta.url), JSON.stringify(rows));
console.log(rows.length + ' US-listed companies');
