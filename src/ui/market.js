// The Market tab: market direction. Index charts with distribution days (D) and follow-through days (FTD).
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle } from 'lightweight-charts';
import { analyseIndex, combine, STATUS, EXPOSURE } from '../core/market.js';
import { marketSeries, provider, isDemo } from '../data/service.js';
import { App, on, emit, openStock, go } from '../app.js';
import { rankSectors } from '../core/sectors.js';
import * as store from '../data/store.js';
import { snapshotMeta } from '../data/providers.js';
import PAT from '../core/pat.js';
import { marketNews } from '../data/news.js';
import { patColor, patternsToShow, PAT_LABEL } from './chart.js';
import { $, $$, html, raw, render, tok, ICON } from './dom.js';
import { pc, fD, fDs, fmtVol } from '../core/analysis.js';
import { exposureFactors } from '../core/exposure.js';
import { earnings } from '../data/service.js';
import { nextReport } from '../core/earnings.js';
import { allPlans, journal, strategy } from '../data/plans.js';
import { saveWatch } from '../app.js';

const M = { rows: null, charts: [], loading: false, loadedFor: null };

export function initMarket(el) {
  render(el, html`
    <section class="card" id="mSum"><div class="empty"><span class="spinner"></span><span>Loading the market…</span></div></section>
    <div class="grid2"><section class="card" id="mExp"></section><section class="card" id="mDaily"></section></div>
    <section class="card"><div class="card-head"><h2>Index scorecard</h2><button class="btn sm" id="mRefresh">${raw(ICON.refresh)}Refresh</button></div><div id="mTable"></div></section>
    <div class="grid2" id="mGrid"></div>
    <section class="card" id="mSec"></section>
    <div class="grid2"><section class="card" id="mDD"></section><section class="card" id="mNews"></section></div>
    <details class="card"><summary class="section-title" style="cursor:pointer">How the market status is worked out</summary>
      <div class="prose small">
        <ul>
          <li><b>Distribution day (D):</b> the index falls 0.2% or more on higher volume than the day before, a sign of institutional selling. It counts for 25 sessions, or until the index rises 5% above that day's close.</li>
          <li><b>Uptrend under pressure:</b> 5 or more distribution days, or the index closes below its 50-day line.</li>
          <li><b>Market in correction:</b> a close below the 50-day line with the index 7%+ off its recent high (or 5%+ with 6+ distribution days), or a failed follow-through.</li>
          <li><b>Follow-through day (FTD):</b> in a correction, on day 4 or later of a rally attempt, the index gains 1.2% or more on higher volume. That confirms a new uptrend.</li>
          <li><b>US status</b> takes the weaker of the Nasdaq and the S&amp;P 500 readings.</li>
          <li>When your data plan has no index data, US-listed ETFs stand in (QQQ, SPY, DIA, FEZ). Their volume is a proxy for exchange volume.</li>
          <li>These are widely published rules of thumb, applied automatically. The exposure ranges are a rule of thumb, not advice.</li>
        </ul>
      </div>
    </details>`);
  $('#mRefresh').onclick = () => load(true);
  on(type => { if (type === 'scan') { sectors(); exposure(); routine(); } if (['plans', 'journal', 'watch', 'holdings'].includes(type) && M.rows) routine(); if (type === 'theme' && M.rows && App.view === 'market') charts(); if (type === 'provider') { M.loadedFor = null; if (App.view === 'market') load(); else preload(); } if (type === 'view' && App.view === 'market') { load(); M.charts.forEach(c => c.redraw && c.redraw()); } });
  preload();
}

/** Loads the market quietly so the market item of the checklist is known on the Chart tab too. */
export function preload() { load(false, true); }

async function load(force = false, quiet = false) {
  const key = provider().id;
  if (M.loading || (!force && M.loadedFor === key && M.rows)) { if (!quiet) draw(); return; }
  M.loading = true;
  try {
    const series = await marketSeries();
    M.rows = series.map(s => ({ ...s, R: s.bars ? analyseIndex(s.bars) : null }));
    M.loadedFor = key;
    App.mktRes = M.rows;
    App.mkt = combine(M.rows.filter(r => r.k === 'IXIC' || r.k === 'GSPC').map(r => r.R)); // US status = weaker of Nasdaq and S&P 500
    emit('market');
  } catch (e) {
    M.rows = null; M.err = e;
  }
  M.loading = false;
  if (!quiet || App.view === 'market') draw();
}

function draw() {
  const el = $('#mSum'); if (!el) return;
  if (!M.rows) { render(el, html`<div class="empty">${raw(ICON.info)}<p>${M.err ? M.err.message : 'No market data yet.'}</p></div>`); return; }
  const us = App.mkt, eu = M.rows.find(r => r.region === 'EU' && r.R);
  const line = r => r.R ? `${r.name}: ${STATUS[r.R.state][0].toLowerCase()} since ${fDs(r.R.b[r.R.since].time)}, ${r.R.hasVol ? r.R.dd.length + ' distribution day' + (r.R.dd.length === 1 ? '' : 's') : 'no volume data'}${r.R.state === 'corr' && r.R.rallyDay ? ', rally attempt day ' + r.R.rallyDay : ''}.` : `${r.name}: ${r.error ? r.error.message : 'no data'}`;
  render(el, html`
    <div class="card-head"><h2>Market direction</h2>${isDemo() ? html`<span class="tag" style="color:var(--purple)">Demo data</span>` : ''}</div>
    <div class="mkt-status">
      ${us ? html`<div class="mkt-row"><span class="pill lg t-${STATUS[us.us][1]}">${STATUS[us.us][0]}</span><div><h3>United States</h3><div class="muted small">${M.rows.filter(r => r.region === 'US' && r.k !== 'DJI').map(line).join(' ')}</div></div></div>` : html`<p class="muted">No US index data.</p>`}
      ${eu ? html`<div class="mkt-row"><span class="pill lg t-${STATUS[eu.R.state][1]}">${STATUS[eu.R.state][0]}</span><div><h3>Europe</h3><div class="muted small">${line(eu)}</div></div></div>` : ''}
    </div>
    ${us ? html`<p class="small" style="margin:0;border-left:3px solid var(--blue);padding-left:10px">${EXPOSURE[us.us]}</p>` : ''}`);
  render($('#mTable'), html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Index</th><th class="n">Close</th><th class="n">Day</th><th class="n">vs 50-day</th><th class="n">vs 200-day</th><th class="n">Off high</th><th class="n">Dist. days</th><th>Last FTD</th><th>Status</th></tr></thead><tbody>
    ${M.rows.map(r => { const R = r.R; if (!R) return html`<tr><td>${r.name}</td><td colspan="8" class="muted">${r.error ? r.error.message : 'No data'}</td></tr>`; const n = R.n, vs = a => a[n] ? pc(R.c[n] / a[n] - 1) : '—', cl = x => x >= 0 ? 'up' : 'down';
      return html`<tr><td>${r.name}</td><td class="n">${R.c[n].toLocaleString('en-US', { maximumFractionDigits: 2 })}</td><td class="n ${cl(R.day)}">${pc(R.day, 2)}</td><td class="n ${cl(R.c[n] - (R.s50[n] || 0))}">${vs(R.s50)}</td><td class="n ${cl(R.c[n] - (R.s200[n] || 0))}">${vs(R.s200)}</td><td class="n">${pc(R.off)}</td><td class="n ${R.dd.length >= 5 ? 't-bad' : R.dd.length >= 3 ? 't-warn' : ''}">${R.hasVol ? R.dd.length : 'n/a'}</td><td>${R.lastFtd != null ? fDs(R.b[R.lastFtd].time) : '—'}</td><td><span class="pill t-${STATUS[R.state][1]}">${STATUS[R.state][0]}</span></td></tr>`; })}
  </tbody></table></div><p class="muted tiny" style="margin:0">Daily data through ${fD(Math.max(...M.rows.filter(r => r.R).map(r => r.R.b[r.R.n].time)))}.</p>`);
  charts(); ddTable(); news(); sectors(); exposure(); routine();
}

const today = () => new Date().toISOString().slice(0, 10);
const scanRows = async () => { const s = await store.get('screen.' + provider().id, null); return s ? s : { rows: [], at: null }; };

/* factors for increasing / reducing exposure, measured where possible */
async function exposure() {
  const el = $('#mExp'); if (!el || !M.rows) return;
  const man = await store.get('exposure.manual', {}), manual = man.date === today() ? man.v || {} : {};
  const scan = await scanRows();
  const E = exposureFactors(M.rows.filter(r => r.k === 'IXIC' || r.k === 'GSPC').map(r => ({ name: r.name.replace(' Composite', ''), R: r.R })), scan.rows, manual);
  if (!E) { render(el, html`<h2>Exposure checklist</h2><p class="muted small" style="margin:0">Needs Nasdaq and S&amp;P 500 data.</p>`); return; }
  const icon = (x, down) => x.ok == null ? html`<span class="muted">?</span>` : x.ok ? html`<b class="${down ? 't-bad' : 't-ok'}">${down ? '!' : '✓'}</b>` : html`<span class="muted">–</span>`;
  const item = (x, down) => html`<li style="display:grid;grid-template-columns:18px 1fr auto;gap:8px;align-items:start"><span>${icon(x, down)}</span><span><span class="small ${x.ok ? (down ? 't-bad' : 't-ok') : ''}">${x.label}</span><br><span class="muted tiny">${x.detail}</span></span>
    ${x.manual ? html`<span class="seg" style="padding:1px"><button type="button" data-man="${x.key}" data-v="1" class="${x.ok === true ? 'on' : ''}" style="padding:2px 8px;font-size:12px">Yes</button><button type="button" data-man="${x.key}" data-v="0" class="${x.ok === false ? 'on' : ''}" style="padding:2px 8px;font-size:12px">No</button></span>` : html`<span></span>`}</li>`;
  render(el, html`<div class="card-head"><h2>Exposure checklist</h2><span class="muted tiny">${E.upYes} for · ${E.downYes} against</span></div>
    ${E.raiseCash ? html`<div class="banner" style="background:color-mix(in srgb,var(--bad) 14%,transparent);border-color:var(--bad)"><span><b class="t-bad">Raise cash!</b> ${E.advice}</span></div>` : html`<p class="small" style="margin:0;border-left:3px solid ${E.score >= 3 ? 'var(--ok)' : E.score <= -2 ? 'var(--bad)' : 'var(--warn)'};padding-left:10px">${E.advice}</p>`}
    <div class="section-title" style="margin:2px 0 0">Factors for increasing exposure</div>
    <ul class="notes" style="list-style:none;padding:0;display:grid;gap:8px">${E.up.map(x => item(x, false))}</ul>
    <div class="section-title" style="margin:2px 0 0">Factors for reducing exposure</div>
    <ul class="notes" style="list-style:none;padding:0;display:grid;gap:8px">${E.down.map(x => item(x, true))}</ul>
    <p class="muted tiny" style="margin:0">Measured from the Nasdaq and S&amp;P 500${scan.at ? ' and your last scan (' + new Date(scan.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ')' : ''}. "Yes/No" items are your own judgement and reset each day. A follow-through day starts a new uptrend, but positions are vulnerable at first: start small and add only as breakouts work.</p>`);
  $$('[data-man]', el).forEach(b => { b.onclick = async () => { const v = { ...manual }; const val = b.dataset.v === '1'; v[b.dataset.man] = v[b.dataset.man] === val ? null : val; await store.set('exposure.manual', { date: today(), v }); exposure(); }; });
}

/* the daily routine: market, watchlist, leaders you missed, earnings ahead, journal */
async function routine() {
  const el = $('#mDaily'); if (!el) return;
  const R = await store.get('routine', {}), done = R.date === today() ? R.done || {} : {};
  const mark = async k => { done[k] = !done[k]; await store.set('routine', { date: today(), done }); routine(); };
  if (!done.market) { done.market = true; await store.set('routine', { date: today(), done }); } // opening this tab = market checked
  const scan = await scanRows(), have = new Set([...App.lists.flatMap(l => l.syms), ...(App.holdings || []).map(h => h.sym)]);
  const missed = scan.rows.filter(r => r.rs >= 90 && r.hi >= -0.1 && r.s50 > 0 && !have.has(r.s)).sort((a, b) => b.rs - a.rs).slice(0, 8);
  const S = await strategy(), plans = (await allPlans()).filter(p => !p.closed);
  const syms = [...new Set([...(App.holdings || []).map(h => h.sym), ...plans.map(p => p.sym)])].slice(0, 40);
  const now = Date.now() / 1000, soon = [];
  await Promise.all(syms.map(async s => { try { const e = await earnings(s); const x = e && nextReport(e); if (x && x.time > now && (x.time - now) / 86400 <= S.earningsDays + 7) soon.push({ s, t: x.time }); } catch (e) { /* none */ } }));
  soon.sort((a, b) => a.t - b.t);
  const J = await journal(), todayTrades = J.filter(t => new Date(t.t * 1000).toISOString().slice(0, 10) === today()).length;
  const chk = (k, label, sub) => html`<li style="display:grid;grid-template-columns:22px 1fr;gap:8px"><input type="checkbox" data-rt="${k}" ${done[k] ? raw('checked') : ''} aria-label="${label}"><span><span class="small">${label}</span>${sub ? html`<br><span class="muted tiny">${sub}</span>` : ''}</span></li>`;
  render(el, html`<div class="card-head"><h2>Daily routine</h2><span class="muted tiny">${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
    <ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">
      ${chk('market', 'Keep up with the general market', 'Status, distribution days and the exposure checklist (ticked when you open this tab).')}
      ${chk('plans', 'Check your positions and buying plans', plans.length ? plans.length + ' open plan' + (plans.length > 1 ? 's' : '') + ': alerts tell you when to add or sell.' : 'No open plans.')}
      ${chk('watch', 'Keep the watchlist current', 'Remove broken stocks, add new leaders and stocks forming bases.')}
      ${chk('journal', 'Record every buy and sell in the journal', todayTrades ? todayTrades + ' trade' + (todayTrades > 1 ? 's' : '') + ' recorded today.' : 'Use the Plan button on a stock; review past trades on the Portfolio tab.')}
    </ul>
    ${soon.length ? html`<div class="section-title" style="margin:4px 0 0">Earnings ahead: no new buys right before the report</div><ul class="notes">${soon.map(x => html`<li class="${(x.t - now) / 86400 <= S.earningsDays ? 'warn' : ''}"><button class="link" data-open="${x.s}"><b>${x.s}</b></button> reports ${fDs(x.t)} (in ${Math.ceil((x.t - now) / 86400)} days)</li>`)}</ul>` : ''}
    <div class="section-title" style="margin:4px 0 0">Leaders you missed</div>
    ${missed.length ? html`<div class="results">${missed.map(r => html`<div class="row" style="padding:7px 12px;border-top:.5px solid var(--sep)"><button class="link" data-open="${r.s}" style="text-align:left"><b>${r.s}</b> <span class="muted tiny">${r.nm || ''}</span><br><span class="tiny">Strength ${r.rs} · ${pc(r.hi, 0)} from high${r.p ? ' · ' + r.p.n : ''}</span></button><button class="btn sm" data-addw="${r.s}">+ List</button></div>`)}</div>`
      : html`<p class="muted small" style="margin:0">${scan.rows.length ? 'No strong leaders outside your lists in the last scan.' : 'Run a scan on the Screener tab to find leaders you are missing.'}</p>`}`);
  $$('[data-rt]', el).forEach(c => { c.onchange = () => mark(c.dataset.rt); });
  $$('[data-open]', el).forEach(b => { b.onclick = () => openStock(b.dataset.open); });
  $$('[data-addw]', el).forEach(b => { b.onclick = async () => { await saveWatch([...App.watch, b.dataset.addw]); routine(); }; });
}

/* which sectors lead: from the latest screener scan */
async function sectors() {
  const el = $('#mSec'); if (!el) return;
  const scan = await store.get('screen.' + provider().id, null);
  let rows = scan ? scan.rows : [];
  if (rows.length && rows.some(r => !r.g)) { try { const m = await snapshotMeta(); const g = {}; m.stocks.forEach(x => { g[x.s] = x.g; }); rows = rows.map(r => ({ ...r, g: r.g || g[r.s] })); } catch (e) { /* no sectors */ } }
  const list = rankSectors(rows);
  if (!list.length) {
    render(el, html`<h2>Leading sectors</h2><p class="muted small" style="margin:0">Run a scan on the Screener tab (all built-in stocks) to rank the sectors by the strength of their stocks.</p><div><button class="btn sm" id="secGo">Open the screener</button></div>`);
    $('#secGo').onclick = () => go('screener'); return;
  }
  const mx = Math.max(...list.map(x => x.score));
  render(el, html`<div class="card-head"><h2>Leading sectors</h2><span class="muted tiny">${rows.length} stocks · scan ${new Date(scan.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="n">#</th><th>Sector</th><th>Score</th><th class="n">Median strength</th><th class="n">Above 50-day</th><th class="n">Near high</th><th class="n">3 mo</th><th class="n">Setups</th><th>Leaders</th></tr></thead><tbody>
      ${list.map(x => html`<tr class="click" data-g="${x.g}"><td class="n">${x.rank}</td><td><b>${x.g}</b> <span class="muted tiny">${x.n}</span></td><td><span class="score-bar" style="width:90px"><i style="width:${(x.score / mx * 100).toFixed(0)}%;background:${x.rank <= 3 ? 'var(--ok)' : x.rank > list.length - 3 ? 'var(--bad)' : 'var(--blue)'}"></i></span></td>
        <td class="n">${x.rs != null ? Math.round(x.rs) : '—'}</td><td class="n">${Math.round(x.above50 * 100)}%</td><td class="n">${Math.round(x.nearHigh * 100)}%</td><td class="n ${x.m3 >= 0 ? 'up' : 'down'}">${pc(x.m3)}</td><td class="n">${x.setups}</td><td class="small">${x.leaders.join(', ')}</td></tr>`)}
    </tbody></table></div>
    <p class="muted tiny" style="margin:0">Score = half the median strength rank, plus the share of stocks above their 50-day line and within 15% of their high. Leading groups tend to hold the next leaders. Tap a sector to see its stocks in the screener.</p>`);
  $$('tr[data-g]', el).forEach(tr => { tr.onclick = () => { go('screener'); setTimeout(() => emit('sector', tr.dataset.g), 50); }; });
}

/* every active distribution day, with when it drops out of the count */
function ddTable() {
  const el = $('#mDD'), rows = M.rows.filter(r => r.R && r.R.hasVol);
  render(el, html`<h2>Distribution days in the count</h2>${rows.length ? rows.map(r => html`<h3 style="font-size:15px;margin-top:4px">${r.name} · ${r.R.dd.length}</h3>
    ${r.R.ddDetail.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="n">Index</th><th class="n">Volume vs prior day</th><th class="n">Drops out in</th></tr></thead><tbody>${[...r.R.ddDetail].reverse().map(x => html`<tr><td>${fDs(r.R.b[x.i].time)}</td><td class="n down">${pc(x.chg, 2)}</td><td class="n">${pc(x.volChg, Math.abs(x.volChg) < 0.01 ? 1 : 0)}</td><td class="n">${x.expires} sessions</td></tr>`)}</tbody></table></div>` : html`<p class="muted small" style="margin:0">None: no institutional selling signal in the last 25 sessions.</p>`}`)
    : html`<p class="muted small" style="margin:0">No index volume data on this plan.</p>`}
    <p class="muted tiny" style="margin:0">A distribution day also drops out early when the index closes 5% above it. 5+ in the count puts the uptrend under pressure.</p>`);
}

async function news() {
  const el = $('#mNews');
  render(el, html`<div class="card-head"><h2>Market headlines</h2><span class="spinner"></span></div>`);
  const r = await marketNews();
  const agoT = ms => { if (!ms) return ''; const h = (Date.now() - ms) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };
  render(el, html`<div class="card-head"><h2>Market headlines</h2><button class="btn sm" id="mnRef" aria-label="Check for new headlines">${raw(ICON.refresh)}</button></div>
    ${r.items.length ? html`<div class="news-list">${r.items.slice(0, 15).map(x => html`<a class="news-item" href="${x.link}" target="_blank" rel="noopener"><span class="nt">${x.title}</span><span class="nm">${x.source || x.domain}${x.date ? ' · ' + agoT(x.date) : ''}</span></a>`)}</div>`
      : html`<p class="muted small" style="margin:0">${r.demo ? 'Demo mode makes no network requests. Connect a data provider (Settings) and the app reads live market headlines from free sources here.' : r.browserBlocked ? 'News feeds load in the iPhone, iPad and Mac app; web browsers block them (CORS).' : 'No headlines right now.'}</p>`}
    ${r.items.length ? html`<p class="muted tiny" style="margin:0">Free sources, checked every time you open this tab; paywalled sites hidden per Settings.</p>` : ''}`);
  $('#mnRef') && ($('#mnRef').onclick = news);
}

function charts() {
  M.charts.forEach(c => c.chart.remove()); M.charts = [];
  const g = $('#mGrid');
  render(g, html`${M.rows.filter(r => r.R).map(r => html`<section class="card" style="gap:6px"><div class="card-head"><h3>${r.name}</h3><span class="pill t-${STATUS[r.R.state][1]}">${STATUS[r.R.state][0]}</span></div><div class="muted tiny">21 / 50 / 200-day lines · <b style="color:var(--down)">D</b> distribution day · <b style="color:var(--up)">FTD</b> follow-through day · bottom band = status (green / orange / red)</div><div class="mini-chart" data-k="${r.k}"></div><div class="row"><span class="muted tiny" data-pat="${r.k}"></span><button class="btn sm" data-open="${r.sym}" data-name="${r.name}">Analyse &amp; draw</button></div></section>`)}`);
  g.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => openStock(b.dataset.open, b.dataset.name); });
  for (const r of M.rows.filter(x => x.R)) {
    const el = g.querySelector(`[data-k="${r.k}"]`), R = r.R;
    const up = tok('--up'), dn = tok('--down');
    const chart = createChart(el, { autoSize: true, layout: { background: { type: 'solid', color: tok('--bg2') }, textColor: tok('--muted'), fontFamily: tok('--mono'), fontSize: 10, attributionLogo: true, panes: { separatorColor: tok('--sep') } }, grid: { vertLines: { color: tok('--grid') }, horzLines: { color: tok('--grid') } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, handleScroll: false, handleScale: false }); // overview only: no accidental zoom/scroll; 'Analyse & draw' opens the full chart
    const b = R.b, sr = v => b.map((x, i) => v[i] == null ? { time: x.time } : { time: x.time, value: v[i] });
    const cs = chart.addSeries(CandlestickSeries, { priceLineVisible: false });
    cs.setData(b.map(x => { const c = x.close >= x.open ? up : dn; return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close, color: c, borderColor: c, wickColor: c }; }));
    const L = (v, c, w = 1.5) => { const s = chart.addSeries(LineSeries, { color: c, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(sr(v)); };
    L(R.e21, tok('--ma2')); L(R.s50, tok('--ma3'), 2); L(R.s200, tok('--ma4'), 2);
    const vs = chart.addSeries(HistogramSeries, { priceFormat: { type: 'custom', formatter: fmtVol, minMove: 1 }, priceLineVisible: false, lastValueVisible: false }, 1);
    vs.setData(b.map(x => ({ time: x.time, value: x.volume, color: (x.close >= x.open ? up : dn) + '99' })));
    chart.panes()[1].setStretchFactor(0.25);
    const mk = [];
    R.dd.forEach(i => mk.push({ time: b[i].time, position: 'aboveBar', shape: 'circle', color: dn, text: 'D' }));
    R.ftds.filter(i => i > R.n - 260).forEach(i => mk.push({ time: b[i].time, position: 'belowBar', shape: 'arrowUp', color: up, text: 'FTD' }));
    // status ribbon (green uptrend, orange under pressure, red correction)
    const rib = chart.addSeries(HistogramSeries, { priceScaleId: 'rib', priceLineVisible: false, lastValueVisible: false }, 0);
    chart.priceScale('rib').applyOptions({ scaleMargins: { top: 0.965, bottom: 0 }, visible: false });
    const SC = { up: tok('--ok'), press: tok('--warn'), corr: tok('--bad') };
    rib.setData(b.map((x, i) => R.states[i] ? { time: x.time, value: 1, color: SC[R.states[i]] } : { time: x.time }));
    // base patterns on the index: the current base and recent breakouts
    const PR = PAT.scan(b.map(x => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume })));
    const pats = patternsToShow(PR, b, 'all').filter(({ p, kind }) => kind !== 'hist' || (p.bo != null && p.bo > R.n - 170));
    for (const { p, kind } of pats) {
      const pts = (p.type === 'cwh' || p.type === 'cup') && p.m != null ? [[p.a, p.H], [p.m, p.L], [p.R_i, p.R], ...(p.type === 'cwh' ? [[p.hl, p.HL]] : [])] : (p.pts || []);
      const data = pts.filter(([i]) => i != null && i <= R.n).sort((x, y) => x[0] - y[0]).map(([i, v]) => ({ time: b[i].time, value: v })).filter((x, k, a) => !k || a[k - 1].time < x.time);
      if (data.length > 1) { const ls = chart.addSeries(LineSeries, { color: patColor(p.type), lineWidth: kind === 'hist' ? 1.5 : 2.5, lineStyle: p.failed ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); ls.setData(data); }
      if (p.pivot && kind !== 'hist') cs.createPriceLine({ price: p.pivot, color: tok('--pivot'), lineStyle: LineStyle.Dashed, lineWidth: 1, title: 'Buy point' });
      mk.push({ time: b[p.a].time, position: 'aboveBar', shape: 'arrowDown', color: patColor(p.type), text: kind === 'hist' ? (p.failed ? '✗ ' : '') + (PAT_LABEL[p.type] || '') : p.name });
    }
    const pl = g.querySelector(`[data-pat="${r.k}"]`);
    if (pl) pl.textContent = PR.cur.length ? `Forming: ${PR.cur[0].name}${PR.cur[0].pivot ? ' · buy point ' + PR.cur[0].pivot.toFixed(2) + ' (' + pc(PR.cur[0].dist) + ')' : ''}` : PR.last && R.n - PR.last.bo < 60 ? `Broke out of a ${PR.last.name.toLowerCase()} ${R.n - PR.last.bo} sessions ago${PR.last.failed ? ' (failed)' : ''}` : 'No index base right now';
    mk.sort((a, c) => a.time - c.time); createSeriesMarkers(cs, mk);
    const range = { from: Math.max(0, R.n - 160), to: R.n + 3 };
    chart.timeScale().setVisibleLogicalRange(range);
    M.charts.push({ chart, redraw: () => chart.timeScale().setVisibleLogicalRange(range) });
  }
}
