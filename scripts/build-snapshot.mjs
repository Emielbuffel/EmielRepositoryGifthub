// Builds the app's built-in market data (public/data/) from an export of the original Base Pattern Desk
// database (prices/, mkt/, fund/, settings/ folders of JSON documents).
//   node scripts/build-snapshot.mjs <export-dir>
// Output: data/meta.json (stocks, indexes, directory, pattern examples) and data/px-<n>.json shards.
import fs from 'fs';
import path from 'path';
import PAT from '../src/core/pat.js';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node scripts/build-snapshot.mjs <export-dir>'); process.exit(1); }
const OUT = path.resolve('public/data');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^px-\d+\.json$|^meta\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));

const read = f => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d.data && !d.bars ? d.data : d; };
const r5 = x => x == null || !isFinite(x) ? null : +(+x).toPrecision(6);
const SHARDS = 16;
export const shardOf = sym => { let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % SHARDS; };

// index closes carried inside each prices doc (RS benchmarks), keyed by the app's index ids
const BENCH_KEY = { '.INX': 'GSPC', '.STOXX50E': 'STOXX50E', '.N225': 'N225', '.FTSE': 'FTSE', '.HSI': 'HSI', '.OMXS30': 'OMXS30', '.OMXH25': 'OMXH25', KOSPI: 'KS11', KOSDAQ: 'KQ11' };
const indexes = {};   // id -> {name, bars:[[t,o,h,l,c,v]]}
const shards = Array.from({ length: SHARDS }, () => ({}));
const stocks = [];

for (const f of fs.readdirSync(path.join(SRC, 'prices'))) {
  const d = read(path.join(SRC, 'prices', f));
  const bars = (d.bars || []).filter(r => r && r.length >= 5 && isFinite(r[4]) && r[4] > 0).map(r => [r[0], r5(r[1]), r5(r[2]), r5(r[3]), r5(r[4]), Math.round(r[5] || 0)]);
  if (bars.length < 120) continue;
  shards[shardOf(d.sym)][d.sym] = bars;
  stocks.push({ s: d.sym, n: d.name || '', c: d.currency || '', x: d.exchange || '', d: d.lastDate || '' });
  const b = d.bench, k = b && BENCH_KEY[b.sym];
  if (k && b.bars && (!indexes[k] || b.bars.length > indexes[k].bars.length)) indexes[k] = { name: b.name, bars: b.bars.map(([t, c]) => [t, r5(c), r5(c), r5(c), r5(c), 0]) };
}
// full OHLCV for the market-tab indexes, merged onto the longer close-only history
for (const f of fs.existsSync(path.join(SRC, 'mkt')) ? fs.readdirSync(path.join(SRC, 'mkt')) : []) {
  const d = read(path.join(SRC, 'mkt', f)); const k = d.k || path.basename(f, '.json');
  const m = new Map((indexes[k] ? indexes[k].bars : []).map(r => [r[0], r]));
  d.bars.forEach(r => m.set(r[0], [r[0], r5(r[1]), r5(r[2]), r5(r[3]), r5(r[4]), Math.round(r[5] || 0)]));
  indexes[k] = { name: (indexes[k] && indexes[k].name) || k, bars: [...m.values()].sort((a, b) => a[0] - b[0]) };
}
const NAMES = { GSPC: 'S&P 500', IXIC: 'Nasdaq Composite', DJI: 'Dow Jones Industrial', STOXX50E: 'Euro Stoxx 50', N225: 'Nikkei 225', FTSE: 'FTSE 100', HSI: 'Hang Seng', OMXS30: 'OMX Stockholm 30', OMXH25: 'OMX Helsinki 25', KS11: 'KOSPI', KQ11: 'KOSDAQ' };
Object.entries(indexes).forEach(([k, v]) => { v.name = NAMES[k] || v.name; shards[shardOf('^' + k)]['^' + k] = v.bars; });

// quarterly earnings (adjusted EPS as reported, with estimates) for the stocks the original desk researched
const earnings = {};
for (const f of fs.existsSync(path.join(SRC, 'fund')) ? fs.readdirSync(path.join(SRC, 'fund')) : []) {
  const d = read(path.join(SRC, 'fund', f)); const sym = d.sym || path.basename(f, '.json');
  const q = (d.quarters || []).filter(x => x.reportDate && x.eps != null).map(x => ({ t: x.reportDate, eps: x.eps, est: x.epsEst ?? null, rev: x.revenue ?? null, revEst: x.revenueEst ?? null, p: x.label || '' }));
  if (d.nextEarnings) q.push({ t: d.nextEarnings, eps: null, est: d.nextQtr ? d.nextQtr.epsEst ?? null : null, p: d.nextQtr ? d.nextQtr.label || '' : '', tentative: !d.nextEarningsConfirmed });
  if (q.length) earnings[sym] = { q, src: d.sources || d.source || '', industry: d.industry || '' };
}

// company directory (names, ISINs) and sectors for search and the screener
let directory = [], sectors = {};
try { directory = read(path.join(SRC, 'settings', 'directory.json')).items.map(r => [r[0], r[1], r[2] || '', r[3] || '']); } catch (e) { /* optional */ }
try { read(path.join(SRC, 'settings', 'universe.json')).items.forEach(r => { if (r[5]) sectors[r[0]] = r[5]; }); } catch (e) { /* optional */ }
stocks.forEach(s => { if (sectors[s.s]) s.g = sectors[s.s]; });

// a real stock for every pattern type (current base preferred, sound before faulty), for the Learn tab
const toBars = a => a.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
const examples = {};
for (const s of stocks) {
  const R = PAT.scan(toBars(shards[shardOf(s.s)][s.s]));
  const n = shards[shardOf(s.s)][s.s].length - 1;
  for (const p of R.cur) { const k = p.type, score = (p.faulty ? 0 : 100) + 50 - Math.min(50, Math.abs((p.dist || 0) * 100)); if (!examples[k] || examples[k].score < score) examples[k] = { s: s.s, score, when: 'now' }; }
  for (const h of R.hist) { const k = h.type, score = (h.faulty ? 0 : 60) + (n - h.bo < 120 ? 20 : 0); if (!examples[k] || (examples[k].when !== 'now' && examples[k].score < score)) examples[k] = { s: s.s, score, when: 'past' }; }
}
Object.values(examples).forEach(e => delete e.score);

const asOf = stocks.map(s => s.d).sort().pop();
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ asOf, shards: SHARDS, stocks, indexes: Object.fromEntries(Object.entries(indexes).map(([k, v]) => [k, { name: v.name, from: v.bars[0][0], to: v.bars[v.bars.length - 1][0], vol: v.bars.slice(-40).some(r => r[5] > 0) }])), earnings, directory, examples }));
shards.forEach((s, i) => fs.writeFileSync(path.join(OUT, `px-${i}.json`), JSON.stringify(s)));
const size = fs.readdirSync(OUT).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${stocks.length} stocks, ${Object.keys(indexes).length} indexes, ${Object.keys(earnings).length} with earnings, data through ${asOf}, ${(size / 1e6).toFixed(1)} MB`);
console.log('pattern examples:', JSON.stringify(examples));
