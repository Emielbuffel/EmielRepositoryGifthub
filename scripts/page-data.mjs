// Keeps the built-in data of the page on claude.ai (the iPhone Home Screen page) up to date. The page's own published
// files are the store: the evening task downloads them, runs this script, and publishes what changed.
//
//   node scripts/page-data.mjs DIR [--add SYM,SYM] [--grow 300] [--no-fetch]
//
// DIR/data/ holds the published data files (meta.json, px-*.json, rc-*.json, universe.json, us.json).
//  - px-<i>.json (64 files): the long daily history of every stock and index, up to meta.cut
//  - rc-<i>.json (8 small files): the days after meta.cut — the only price files rewritten on a normal night
//  - screen.json: the screener rows for every built-in stock, worked out here so the phone does not scan 2,000 stocks
// Each night: the last days for every stock (Yahoo's free chart feed), the stocks you asked for on the page (--add) and up to
// --grow more stocks of the app's list (S&P 500, Nasdaq-100, STOXX Europe 600, Japan, Hong Kong, Korea, China) until all are in.
// When the recent files hold more than ~45 days, everything is folded into the history files again (about once a month).
// Writes the changed files to DIR/out/data/ and DIR/out/publish.json: a list of `files` maps, each under 55 MB, to publish.
import fs from 'node:fs';
import path from 'node:path';
import PAT from '../src/core/pat.js';
import { screenRow, rankRS } from '../src/core/analysis.js';

const args = process.argv.slice(2), DIR = path.resolve(args[0] || '.');
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const ADD = (opt('--add', '') || '').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
const GROW = +opt('--grow', 300), FETCH = !args.includes('--no-fetch');
const H = 64, R = 8, KEEP_BARS = 1050, FOLD_AFTER = 45; // ~4 years kept; fold the recent files after ~2 months of trading days
const D = path.join(DIR, 'data'), OUT = path.join(DIR, 'out', 'data');
fs.mkdirSync(OUT, { recursive: true });
const readJ = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const has = f => fs.existsSync(path.join(D, f));
const hash = (sym, n) => { let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % n; };
const day = t => new Date(t * 1000).toISOString().slice(0, 10);

/* ---------- load what is published ---------- */
const meta = readJ('meta.json');
const oldH = meta.shards, oldR = meta.rshards || 0, oldCut = meta.cut || null;
const series = new Map(); // sym -> [[t,o,h,l,c,v], ...]
for (let i = 0; i < oldH; i++) { const j = readJ(`px-${i}.json`); for (const [s, b] of Object.entries(j)) series.set(s, b); }
for (let i = 0; i < oldR; i++) {
  if (!has(`rc-${i}.json`)) continue;
  for (const [s, b] of Object.entries(readJ(`rc-${i}.json`))) { const a = series.get(s) || []; const last = a.length ? a[a.length - 1][0] : 0; series.set(s, a.concat(b.filter(r => r[0] > last))); }
}
const universe = has('universe.json') ? readJ('universe.json').items : [];
const uniBy = new Map(universe.map(r => [r[0], r]));
const usNames = new Map((has('us.json') ? readJ('us.json') : []).map(r => [r[0], r]));
const stockBy = new Map(meta.stocks.map(s => [s.s, s]));
const migrate = oldH !== H || !oldR;
const touchedPx = new Set(); // history files that must be rewritten
const log = [];

/* ---------- Yahoo's free daily chart feed ---------- */
const YH = { GSPC: '^GSPC', IXIC: '^IXIC', DJI: '^DJI', STOXX50E: '^STOXX50E', FTSE: '^FTSE', OMXS30: '^OMX', OMXH25: '^OMXH25', N225: '^N225', KS11: '^KS11', KQ11: '^KQ11', HSI: '^HSI' };
const ysym = s => s.startsWith('^') ? YH[s.slice(1)] || s : s;
const r6 = x => x == null || !isFinite(x) ? null : +(+x).toPrecision(6);
const wait = ms => new Promise(z => setTimeout(z, ms));
let blocked = 0, calls = 0, stopped = false;
async function yahoo(sym, from) {
  if (stopped) return null;
  const now = Math.floor(Date.now() / 1000);
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym(sym))}?period1=${from}&period2=${now + 86400}&interval=1d&includePrePost=false&events=split`;
  for (let a = 0; a < 3; a++) {
    calls++;
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (r && r.status === 429) { if (++blocked >= 12) { stopped = true; log.push('Yahoo answered "Too Many Requests" 12 times: stopped fetching for tonight.'); return null; } await wait(20000); continue; }
    if (!r || !r.ok) { await wait(1500); continue; }
    blocked = 0;
    const j = await r.json().catch(() => null), x = j && j.chart && j.chart.result && j.chart.result[0];
    if (!x || !x.timestamp) return null;
    if (x.meta.dataGranularity && x.meta.dataGranularity !== '1d') return null;
    const q = x.indicators.quote[0], off = x.meta.gmtoffset || 0, reg = x.meta.currentTradingPeriod && x.meta.currentTradingPeriod.regular;
    const openNow = reg && now >= reg.start && now < reg.end + 1800, today = reg ? Math.floor((reg.start + off) / 86400) : null;
    const bars = x.timestamp.map((t, i) => [Math.floor((t + off) / 86400) * 86400, r6(q.open[i]), r6(q.high[i]), r6(q.low[i]), r6(q.close[i]), Math.round(q.volume[i] || 0)])
      .filter(b => b[4] > 0 && !(openNow && b[0] / 86400 === today)) // finished days only
      .map(b => [b[0], b[1] || b[4], Math.max(b[2] || 0, b[4]), Math.min(b[3] || b[4], b[4]), b[4], b[5]]);
    const days = new Map(bars.map(b => [b[0], b])); // one bar per day
    return { bars: [...days.values()].sort((p, q2) => p[0] - q2[0]), name: x.meta.longName || x.meta.shortName || '', cur: x.meta.currency || '', ex: x.meta.fullExchangeName || x.meta.exchangeName || '', splits: !!(x.events && x.events.splits) };
  }
  return null;
}
async function pool(list, n, fn) { const q = list.slice(); await Promise.all(Array.from({ length: n }, async () => { while (q.length && !stopped) { await fn(q.shift()); await wait(300); } })); }

/* ---------- fetch: the last days of every series, then new stocks ---------- */
const FULL_FROM = () => Math.floor(Date.now() / 1000) - Math.round(4.2 * 365.25 * 86400);
let updated = 0, refetched = 0; const failed = [];
async function full(sym) {
  const y = await yahoo(sym, FULL_FROM());
  if (!y || y.bars.length < 120) { failed.push(sym); return false; }
  series.set(sym, y.bars.slice(-KEEP_BARS)); touchedPx.add(hash(sym, H));
  if (!sym.startsWith('^')) {
    const u = uniBy.get(sym), us = usNames.get(sym), s = stockBy.get(sym) || { s: sym };
    s.n = s.n || (u && u[1]) || (us && us[1]) || y.name; s.c = y.cur || s.c || ''; s.x = y.ex || s.x || ''; if (u && u[3] && !s.g) s.g = u[3];
    if (!stockBy.has(sym)) { stockBy.set(sym, s); meta.stocks.push(s); }
  }
  return true;
}
if (FETCH) {
  const all = [...series.keys()];
  await pool(all, 2, async sym => {
    const a = series.get(sym), last = a[a.length - 1][0];
    const y = await yahoo(sym, last - 12 * 86400); if (!y || !y.bars.length) { failed.push(sym); return; }
    // the overlap must match; a split (or a corrected history) means: take the full history again
    const have = new Map(a.slice(-15).map(r => [r[0], r[4]])), ov = y.bars.filter(b => have.has(b[0]));
    const off = ov.filter(b => Math.abs(b[4] / have.get(b[0]) - 1) > 0.02).length;
    if (y.splits || (ov.length >= 2 && off > ov.length / 2)) { if (await full(sym)) refetched++; return; }
    const add = y.bars.filter(b => b[0] > last);
    if (add.length) { series.set(sym, a.concat(add)); updated++; }
    // today's corrected values for days already stored (late volume) stay as first stored: history is not rewritten nightly
  });
  // stocks asked for on the page, then the rest of the app's list (US, Europe, Japan, Hong Kong, Korea, China)
  const order = ['US', 'Europe', 'Japan', 'Hong Kong', 'Korea', 'China'];
  const grow = universe.filter(r => !series.has(r[0])).sort((p, q) => order.indexOf(p[2]) - order.indexOf(q[2])).slice(0, GROW).map(r => r[0]);
  const wanted = [...new Set([...ADD.filter(s => !series.has(s)), ...grow])];
  let added = 0; await pool(wanted, 2, async sym => { if (await full(sym)) added++; });
  log.push(`added ${added} new stocks (${ADD.length} asked for: ${ADD.join(', ') || 'none'})`);
  if (ADD.length) log.push(`requested and now built in: ${ADD.filter(s => series.has(s)).join(', ') || 'none'}; requested but failed: ${ADD.filter(s => !series.has(s)).join(', ') || 'none'}`);
}

/* ---------- write ---------- */
const lastDay = Math.max(...[...series.values()].map(b => b[b.length - 1][0]));
const cutT = oldCut ? Date.parse(oldCut + 'T00:00:00Z') / 1000 : lastDay;
const recentMax = Math.max(0, ...[...series.values()].map(b => b.filter(r => r[0] > cutT).length));
const fold = migrate || recentMax > FOLD_AFTER;
const cut = fold ? lastDay : cutT;
const px = Array.from({ length: H }, () => ({})), rc = Array.from({ length: R }, () => ({}));
for (const [s, b0] of series) {
  const b = b0.slice(-KEEP_BARS);
  px[hash(s, H)][s] = b.filter(r => r[0] <= cut);
  const r = b.filter(x => x[0] > cut); if (r.length) rc[hash(s, R)][s] = r;
}
const changed = [];
const write = (f, obj) => { fs.writeFileSync(path.join(OUT, f), JSON.stringify(obj)); changed.push('data/' + f); };
for (let i = 0; i < H; i++) if (fold || touchedPx.has(i)) write(`px-${i}.json`, px[i]);
for (let i = 0; i < R; i++) write(`rc-${i}.json`, rc[i]);

// meta: dates, RS rank 1-99 within the built-in stocks (12 months, latest quarter double-weighted)
const toBars = a => a.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
meta.stocks = meta.stocks.filter(s => series.has(s.s));
for (const s of meta.stocks) { const b = series.get(s.s); s.d = day(b[b.length - 1][0]); }
const rsRaw = s => { const c = series.get(s.s).map(r => r[4]), n = c.length - 1, q = k => n - 63 * k >= 0 ? c[n - 63 * (k - 1)] / c[n - 63 * k] - 1 : null;
  return [q(1), q(2), q(3), q(4)].every(x => x != null) ? 0.4 * q(1) + 0.2 * q(2) + 0.2 * q(3) + 0.2 * q(4) : null; };
const ranked = meta.stocks.map(s => [s, rsRaw(s)]).filter(x => x[1] != null).sort((a, b) => a[1] - b[1]);
ranked.forEach(([s], i) => { s.r = Math.max(1, Math.min(99, Math.round(1 + 98 * i / (ranked.length - 1)))); });
for (const [k, v] of Object.entries(meta.indexes)) { const b = series.get('^' + k); if (b) { v.from = b[0][0]; v.to = b[b.length - 1][0]; } }
meta.asOf = meta.stocks.map(s => s.d).sort().pop();
meta.shards = H; meta.rshards = R; meta.cut = day(cut); meta.screen = true; meta.updated = new Date().toISOString();
write('meta.json', meta);

// screener rows, each stock against its home index (as on the stock page)
const HOME = { '': 'GSPC', DE: 'STOXX50E', F: 'STOXX50E', PA: 'STOXX50E', AS: 'STOXX50E', BR: 'STOXX50E', MI: 'STOXX50E', MC: 'STOXX50E', LS: 'STOXX50E', VI: 'STOXX50E', IR: 'STOXX50E', SW: 'STOXX50E', L: 'FTSE', ST: 'OMXS30', HE: 'OMXH25', CO: 'STOXX50E', OL: 'STOXX50E', T: 'N225', HK: 'HSI', KS: 'KS11', KQ: 'KQ11', SS: 'HSI', SZ: 'HSI' };
const benchOf = s => { const k = HOME[(/\.([A-Z]+)$/.exec(s) || [])[1] || ''] || 'GSPC', b = series.get('^' + k) || series.get('^GSPC'); return b ? b.map(r => ({ time: r[0], close: r[4] })) : null; };
const NV = new Set((has('universe.json') && readJ('universe.json').nv) || []);
const rows = [];
for (const s of meta.stocks) {
  const bars = toBars(series.get(s.s).slice(-520));
  try { const r = screenRow(s.s, s.n || '', bars, PAT.scan(bars), benchOf(s.s), { noVol: NV.has(s.s) }); if (r) { r.cu = s.c; r.g = s.g || ''; rows.push(r); } } catch (e) { /* skip */ }
}
rankRS(rows);
write('screen.json', { at: Date.now(), asOf: meta.asOf, rows });

/* ---------- what to publish, in batches under 55 MB ---------- */
const batches = []; let cur = {}, size = 0;
for (const f of changed) {
  const sz = fs.statSync(path.join(DIR, 'out', f)).size;
  if (size + sz > 55e6 && Object.keys(cur).length) { batches.push(cur); cur = {}; size = 0; }
  cur[f] = { from: path.join(DIR, 'out', f) }; size += sz;
}
if (Object.keys(cur).length) batches.push(cur);
fs.writeFileSync(path.join(DIR, 'out', 'publish.json'), JSON.stringify(batches, null, 1));
console.log([
  `built-in data now through ${meta.asOf}: ${meta.stocks.length} stocks + ${Object.keys(meta.indexes).length} indexes; ${updated} updated, ${refetched} taken again (split or correction), ${failed.length} failed${failed.length ? ' (' + failed.slice(0, 10).join(', ') + (failed.length > 10 ? '…' : '') + ')' : ''}; ${calls} Yahoo calls`,
  ...log,
  `${fold ? 'history folded (all history files rewritten)' : touchedPx.size + ' history files changed'}; ${changed.length} files to publish in ${batches.length} batch(es): see out/publish.json`,
].join('\n'));
