// Brings the built-in data (public/data) up to date from the free Yahoo chart feed: the last weeks of daily bars for
// every built-in stock and index. Only finished trading days are added (a day whose market is still open is left
// out). Run with network access: NODE_USE_ENV_PROXY=1 node scripts/refresh-snapshot.mjs
import fs from 'node:fs';

const dir = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL('meta.json', dir)));
const shardOf = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % meta.shards; };
const YH = { GSPC: '^GSPC', IXIC: '^IXIC', DJI: '^DJI', STOXX50E: '^STOXX50E', FTSE: '^FTSE', OMXS30: '^OMX', OMXH25: '^OMXH25', N225: '^N225', KS11: '^KS11', KQ11: '^KQ11', HSI: '^HSI' };
const from = Math.floor(Date.parse(meta.asOf + 'T00:00:00Z') / 1000) - 14 * 86400, now = Math.floor(Date.now() / 1000);
const r5 = x => x == null || !isFinite(x) ? null : +(+x).toPrecision(6);

async function bars(ysym) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?period1=${from}&period2=${now + 86400}&interval=1d&includePrePost=false`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.status === 429) { await new Promise(z => setTimeout(z, 4000)); continue; }
      const j = await r.json(), x = j.chart.result && j.chart.result[0]; if (!x || !x.timestamp) return null;
      const q = x.indicators.quote[0], off = x.meta.gmtoffset || 0, reg = x.meta.currentTradingPeriod && x.meta.currentTradingPeriod.regular;
      const openNow = reg && now >= reg.start && now < reg.end + 1800, today = reg ? Math.floor((reg.start + off) / 86400) : null;
      return x.timestamp.map((t, i) => [Math.floor((t + off) / 86400) * 86400, r5(q.open[i]), r5(q.high[i]), r5(q.low[i]), r5(q.close[i]), Math.round(q.volume[i] || 0)])
        .filter(b => b[4] > 0 && !(openNow && b[0] / 86400 === today)) // only finished days
        .map(b => [b[0], b[1] || b[4], Math.max(b[2] || 0, b[4]), Math.min(b[3] || b[4], b[4]), b[4], b[5]]);
    } catch (e) { await new Promise(z => setTimeout(z, 2000)); }
  }
  return null;
}

const shards = Array.from({ length: meta.shards }, (_, i) => JSON.parse(fs.readFileSync(new URL(`px-${i}.json`, dir))));
const jobs = [...meta.stocks.map(s => ({ key: s.s, ysym: s.s, st: s })), ...Object.keys(meta.indexes).map(k => ({ key: '^' + k, ysym: YH[k] || '^' + k, idx: k }))];
let done = 0, upd = 0, last = meta.asOf; const failed = [];
async function one(j) {
  const nb = await bars(j.ysym); done++;
  if (!nb || !nb.length) { failed.push(j.key); return; }
  const px = shards[shardOf(j.key)], old = px[j.key] || [];
  // only glue when the feed and the built-in data agree on the overlapping days (same venue and unit)
  const m = new Map(old.map(r => [r[0], r])), ov = nb.filter(b => m.has(b[0])).map(b => b[4] / m.get(b[0])[4]).sort((a, b) => a - b);
  if (ov.length && Math.abs(ov[Math.floor(ov.length / 2)] - 1) > 0.02) { failed.push(j.key + ' (differs)'); return; }
  const volOn = !j.idx || !!(meta.indexes[j.idx] || {}).vol;
  nb.forEach(b => m.set(b[0], volOn ? b : [...b.slice(0, 5), 0]));
  px[j.key] = [...m.values()].sort((a, b) => a[0] - b[0]); upd++;
  const d = new Date(px[j.key].at(-1)[0] * 1000).toISOString().slice(0, 10);
  if (j.st) j.st.d = d; if (j.idx) meta.indexes[j.idx].to = px[j.key].at(-1)[0];
  if (d > last && j.idx === 'GSPC') last = d;
}
const queue = jobs.slice();
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await one(queue.shift()); }));
shards.forEach((px, i) => fs.writeFileSync(new URL(`px-${i}.json`, dir), JSON.stringify(px)));
meta.asOf = last;
fs.writeFileSync(new URL('meta.json', dir), JSON.stringify(meta));
console.log(`updated ${upd} of ${jobs.length}; built-in data now through ${last}; not updated: ${failed.length}${failed.length ? ' (' + failed.slice(0, 12).join(', ') + (failed.length > 12 ? '…' : '') + ')' : ''}`);
