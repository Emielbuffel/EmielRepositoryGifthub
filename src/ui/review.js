// The "Trade review" tab: every closed trade from your DEGIRO statements (or the buying-plan journal), the numbers
// O'Neil asks you to study after each year, and which kind of entry worked best for you.
import PAT from '../core/pat.js';
import { roundTrips, tradeStats, byLabel, lessons } from '../core/review.js';
import { strategy } from '../data/plans.js';
import { loadTrades, barsFor } from './trades.js';
import * as store from '../data/store.js';
import { on, App, openStock, go } from '../app.js';
import { $, $$, html, raw, render, money, ICON } from './dom.js';
import { fDs, pc } from '../core/analysis.js';

const R = { year: 'all', seq: 0 };
const ENTRY = { bz: 'Breakout, bought in the buy zone', chase: 'Chased: more than 5% past the buy point', early: 'Early entry, before the breakout', none: 'No base breakout' };

export async function initReview(el) {
  render(el, html`<section class="card" id="rvSum"><p class="muted small" style="margin:0">Loading your trades…</p></section>
    <section class="card" id="rvEntry" hidden></section><section class="card" id="rvList" hidden></section>
    <p class="disclaimer">A look back at your own trades with the book's yardsticks. Educational, not investment advice.</p>`);
  on(type => { if (['cash', 'journal', 'view'].includes(type) && App.view === 'review') load(); });
  load();
}

/** What kind of entry the first buy was, from the base patterns on the chart up to that day (cached). */
async function entryOf(trip, cache) {
  const ck = trip.key + '|' + trip.open; if (cache[ck]) return cache[ck];
  const b = await barsFor(trip.key, trip.name); if (!b) return null;
  let i = b.bars.findIndex(x => x.time >= trip.open - 43200); if (i < 0) return null; if (i < 60) return (cache[ck] = { k: 'none' });
  const bars = b.bars.slice(0, i + 1), Rx = PAT.scan(bars), c = bars[i].close, n = bars.length - 1;
  let out = { k: 'none', sym: b.sym };
  const lb = Rx.last && !Rx.last.failed && n - Rx.last.bo <= 10 ? Rx.last : null;
  if (lb) out = { k: c / lb.pivot - 1 <= 0.05 ? 'bz' : 'chase', base: lb.name, sym: b.sym };
  else { const p = Rx.cur.find(x => x.pivot && c < x.pivot && c >= x.pivot * 0.95); if (p) out = { k: 'early', base: p.name, sym: b.sym }; }
  cache[ck] = out; return out;
}

async function load() {
  const seq = ++R.seq, S = await strategy(), base = S.ccy || 'EUR';
  const { trades, src } = await loadTrades(base);
  if (seq !== R.seq) return;
  const sum = $('#rvSum'); if (!sum) return;
  if (!trades.length) { render(sum, html`<div class="empty">${raw(ICON.info)}<p>No trades yet. Upload your DEGIRO account statements on the Dividends &amp; taxes tab (they contain every buy and sell), or record your trades in the buying plans.</p><button class="btn primary" id="rvGo">Upload statements</button></div>`); $('#rvGo').onclick = () => go('taxes'); return; }
  const all = roundTrips(trades), years = [...new Set(all.trips.map(t => new Date(t.close * 1000).getUTCFullYear()))].sort((a, b) => b - a);
  const trips = all.trips.filter(t => R.year === 'all' || new Date(t.close * 1000).getUTCFullYear() === R.year);
  const st = tradeStats(trips), m = x => (x < 0 ? '−' : '') + money(Math.abs(x), base);
  render(sum, html`
    <div class="card-head"><h2>Trade review</h2><div class="chips">${years.map(y => html`<button class="chip${R.year === y ? ' on' : ''}" data-y="${y}">${y}</button>`)}<button class="chip${R.year === 'all' ? ' on' : ''}" data-y="all">All</button></div></div>
    ${st ? html`<div class="kpis">
      <div class="kpi"><span class="k">Closed trades</span><span class="v">${st.n}</span><span class="s">${st.wins} won · ${st.losses} lost</span></div>
      <div class="kpi"><span class="k">Win rate</span><span class="v ${st.winRate >= 0.4 ? 'up' : ''}">${Math.round(st.winRate * 100)}%</span><span class="s">O'Neil: even 40–50% works if losses stay small</span></div>
      <div class="kpi"><span class="k">Average win</span><span class="v up">${st.avgWin != null ? pc(st.avgWin, 1) : '—'}</span><span class="s">held ${st.daysWin != null ? Math.round(st.daysWin) + ' days' : '—'}</span></div>
      <div class="kpi"><span class="k">Average loss</span><span class="v down">${st.avgLoss != null ? pc(st.avgLoss, 1) : '—'}</span><span class="s">held ${st.daysLoss != null ? Math.round(st.daysLoss) + ' days' : '—'}</span></div>
      <div class="kpi"><span class="k">Win / loss size</span><span class="v">${st.payoff != null ? st.payoff.toFixed(1) + ' : 1' : '—'}</span><span class="s">aim for about 3 : 1</span></div>
      <div class="kpi"><span class="k">Result</span><span class="v ${st.total >= 0 ? 'up' : 'down'}">${m(st.total)}</span><span class="s">${st.profitFactor != null ? 'profit factor ' + st.profitFactor.toFixed(2) : ''}</span></div>
    </div>
    <ul class="plan" style="margin:0">${lessons(st).map(([t, x]) => html`<li class="t-${t === 'bad' ? 'bad' : t === 'ok' ? 'ok' : 'warn'}">${x}</li>`)}</ul>` : html`<p class="small" style="margin:0">No closed trades in ${R.year}.</p>`}
    <p class="muted tiny" style="margin:0">From your ${src === 'statement' ? 'DEGIRO statements' : 'buying-plan trades'}: a trade runs from the first buy to the sale that brings the position back to zero; percentages are on the money put in. ${all.open.length} position${all.open.length === 1 ? '' : 's'} still open. Costs and taxes are not included.</p>`);
  $$('[data-y]', sum).forEach(b => { b.onclick = () => { R.year = b.dataset.y === 'all' ? 'all' : +b.dataset.y; load(); }; });
  // the entry of each trade (needs prices: the desktop app or the built-in data)
  const cache = await store.get('review.entries', {}), ent = $('#rvEntry'), list = $('#rvList');
  ent.hidden = !trips.length; list.hidden = !trips.length;
  if (!trips.length) return;
  render(ent, html`<div class="card-head"><h2>Which entries worked</h2></div><p class="small muted" style="margin:0"><span class="spinner"></span> Checking the chart at each first buy…</p>`);
  for (const t of trips) { t.entry = await entryOf(t, cache); if (seq !== R.seq) return; }
  await store.set('review.entries', cache);
  const groups = byLabel(trips, t => t.entry ? ENTRY[t.entry.k] : 'Unknown (no prices)');
  render(ent, html`<div class="card-head"><h2>Which entries worked</h2><span class="muted tiny">the chart at your first buy</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Entry</th><th class="n">Trades</th><th class="n">Won</th><th class="n">Avg win</th><th class="n">Avg loss</th><th class="n">Per trade</th></tr></thead><tbody>
      ${groups.map(g => html`<tr><td>${g.label}</td><td class="n">${g.n}</td><td class="n">${Math.round(g.winRate * 100)}%</td><td class="n up">${g.avgWin != null ? pc(g.avgWin, 1) : '—'}</td><td class="n down">${g.avgLoss != null ? pc(g.avgLoss, 1) : '—'}</td><td class="n ${g.expectancy >= 0 ? 'up' : 'down'}">${pc(g.expectancy, 1)}</td></tr>`)}
    </tbody></table></div>
    <ul class="plan" style="margin:0">${lessons(st, groups).slice(-1).filter(l => /Best entries/.test(l[1])).map(([, x]) => html`<li>${x}</li>`)}</ul>`);
  render(list, html`<div class="card-head"><h2>Closed trades</h2><span class="muted tiny">tap one for its chart</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th>Bought → sold</th><th class="n">Days</th><th class="n">Invested</th><th class="n">Result</th><th>Entry</th></tr></thead><tbody>
      ${trips.slice().sort((a, b) => b.close - a.close).map(t => html`<tr class="click" data-s="${t.entry && t.entry.sym || ''}"><td class="small"><b>${t.name}</b></td><td class="small">${fDs(t.open)} → ${fDs(t.close)}</td><td class="n">${t.days}</td><td class="n">${m(t.invested)}</td><td class="n ${t.pnl >= 0 ? 'up' : 'down'}">${m(t.pnl)} <span class="tiny">(${pc(t.ret, 1)})</span></td><td class="small">${t.entry ? ENTRY[t.entry.k].split(',')[0].split(':')[0] + (t.entry.base ? ' · ' + t.entry.base : '') : '—'}</td></tr>`)}
    </tbody></table></div>`);
  $$('#rvList tr[data-s]').forEach(tr => { if (tr.dataset.s) tr.onclick = () => openStock(tr.dataset.s); });
}
