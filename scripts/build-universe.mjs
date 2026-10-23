// Builds public/data/universe.json: every stock the app knows (the original desk's screener universe —
// S&P 500, Nasdaq-100, STOXX Europe 600, Japan, Hong Kong and Korea large caps — plus its search directory
// and the built-in snapshot). Usage: node scripts/build-universe.mjs <old-db-export-dir>
import fs from 'node:fs';
const dir = process.argv[2];
const out = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL('meta.json', out)));
const uni = JSON.parse(fs.readFileSync(`${dir}/settings/universe.json`)).items;   // [sym, name, isin, region, _, sector, about]
const dirx = JSON.parse(fs.readFileSync(`${dir}/settings/directory.json`)).items; // [sym, name, isin, exchange, rank]
const REGION = s => { const x = s.includes('.') ? s.split('.').pop() : ''; return !x ? 'US' : ['T'].includes(x) ? 'Japan' : x === 'HK' ? 'Hong Kong' : ['KS', 'KQ'].includes(x) ? 'Korea' : ['SS', 'SZ'].includes(x) ? 'China' : 'Europe'; };
const skip = s => /^43\d\d\.HK$/.test(s); // Hong Kong depositary receipts: thin, misleading volume
const m = new Map();
const put = (s, n, isin, sector, region) => {
  if (!s || skip(s)) return;
  const o = m.get(s) || { s, n: '', i: '', g: '', r: '' };
  o.n = o.n || n || ''; o.i = o.i || isin || ''; o.g = o.g || sector || ''; o.r = o.r || (region && region !== 'Extra' ? region : '') || REGION(s);
  m.set(s, o);
};
meta.stocks.forEach(x => put(x.s, x.n, '', x.g, ''));
uni.forEach(x => put(x[0], x[1], x[2], x[5], x[3]));
dirx.forEach(x => put(x[0], x[1], x[2], '', ''));
// built-in prices that came from a secondary venue (not the home exchange): their volume is not representative
const nv = meta.stocks.filter(x => /gettex|Tradegate/i.test(x.x || '')).map(x => x.s);
const items = [...m.values()].sort((a, b) => a.s.localeCompare(b.s)).map(o => [o.s, o.n, o.r, o.g, o.i]);
fs.writeFileSync(new URL('universe.json', out), JSON.stringify({ cols: ['sym', 'name', 'region', 'sector', 'isin'], items, nv }));
const by = {}; items.forEach(x => { by[x[2]] = (by[x[2]] || 0) + 1; });
console.log(items.length, 'stocks', by, 'with sector', items.filter(x => x[3]).length);
