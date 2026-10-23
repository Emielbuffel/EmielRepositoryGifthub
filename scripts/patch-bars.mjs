// Replaces or appends daily bars (indexes '^IXIC' or stocks 'NVDA') in the built-in snapshot (public/data) from a JSON file of
// {"^IXIC": [["2026-10-22", o, h, l, c, v], ...]}. Used to swap partial intraday bars for final ones.
import fs from 'node:fs';
const [,, file] = process.argv;
const patch = JSON.parse(fs.readFileSync(file, 'utf8'));
const dir = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL('meta.json', dir)));
const shardOf = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % meta.shards; };
let last = meta.asOf;
for (const [sym, rows] of Object.entries(patch)) {
  const f = new URL(`px-${shardOf(sym)}.json`, dir), px = JSON.parse(fs.readFileSync(f));
  const m = new Map((px[sym] || []).map(r => [r[0], r]));
  const isIdx = sym.startsWith('^'), volOn = !isIdx || !!(meta.indexes[sym.slice(1)] || {}).vol;
  for (const [d, o, h, l, c, v] of rows) { const t = Date.parse(d + 'T00:00:00Z') / 1000; m.set(t, [t, o, h, l, c, volOn ? v : 0]); if (d > last) last = d; }
  px[sym] = [...m.values()].sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(f, JSON.stringify(px));
  if (isIdx && meta.indexes[sym.slice(1)]) meta.indexes[sym.slice(1)].to = px[sym].at(-1)[0];
  const st = !isIdx && meta.stocks.find(x => x.s === sym); if (st) st.d = new Date(px[sym].at(-1)[0] * 1000).toISOString().slice(0, 10);
  console.log(sym, px[sym].length, 'bars, last', new Date(px[sym].at(-1)[0] * 1000).toISOString().slice(0, 10));
}
meta.asOf = last;
fs.writeFileSync(new URL('meta.json', dir), JSON.stringify(meta));
