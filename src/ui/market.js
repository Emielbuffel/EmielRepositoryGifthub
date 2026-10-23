// The Market tab: the "M" in CAN SLIM. Index charts with distribution days (D) and follow-through days (FTD).
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers } from 'lightweight-charts';
import { analyseIndex, combine, STATUS, EXPOSURE } from '../core/market.js';
import { marketSeries, provider, isDemo } from '../data/service.js';
import { App, on, emit } from '../app.js';
import { $, html, raw, render, tok, ICON } from './dom.js';
import { pc, fD, fDs, fmtVol } from '../core/analysis.js';

const M = { rows: null, charts: [], loading: false, loadedFor: null };

export function initMarket(el) {
  render(el, html`
    <section class="card" id="mSum"><div class="empty"><span class="spinner"></span><span>Loading the market…</span></div></section>
    <section class="card"><div class="card-head"><h2>Index scorecard</h2><button class="btn sm" id="mRefresh">${raw(ICON.refresh)}Refresh</button></div><div id="mTable"></div></section>
    <div class="grid2" id="mGrid"></div>
    <details class="card"><summary class="section-title" style="cursor:pointer">How the market status is worked out</summary>
      <div class="prose small">
        <ul>
          <li><b>Distribution day (D):</b> the index falls 0.2% or more on higher volume than the day before, a sign of institutional selling. It counts for 25 sessions, or until the index rises 5% above that day's close.</li>
          <li><b>Uptrend under pressure:</b> 5 or more distribution days, or the index closes below its 50-day line.</li>
          <li><b>Market in correction:</b> a close below the 50-day line with the index 7%+ off its recent high (or 5%+ with 6+ distribution days), or a failed follow-through.</li>
          <li><b>Follow-through day (FTD):</b> in a correction, on day 4 or later of a rally attempt, the index gains 1.2% or more on higher volume. That confirms a new uptrend.</li>
          <li><b>US status</b> takes the weaker of the Nasdaq and the S&amp;P 500 readings.</li>
          <li>When your data plan has no index data, US-listed ETFs stand in (QQQ, SPY, DIA, FEZ). Their volume is a proxy for exchange volume.</li>
          <li>This approximates IBD's published method; it is not IBD's own call. The exposure ranges are IBD's published guideline, not advice.</li>
        </ul>
      </div>
    </details>`);
  $('#mRefresh').onclick = () => load(true);
  on(type => { if (type === 'theme' && M.rows && App.view === 'market') charts(); if (type === 'provider') { M.loadedFor = null; if (App.view === 'market') load(); else preload(); } if (type === 'view' && App.view === 'market') { load(); M.charts.forEach(c => c.redraw && c.redraw()); } });
  preload();
}

/** Loads the market quietly so the CAN SLIM "M" is known on the Chart tab too. */
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
    App.mkt = combine(M.rows.filter(r => r.region === 'US').map(r => r.R));
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
    <div class="card-head"><h2>Market direction · the M in CAN SLIM</h2>${isDemo() ? html`<span class="tag" style="color:var(--purple)">Demo data</span>` : ''}</div>
    <div class="mkt-status">
      ${us ? html`<div class="mkt-row"><span class="pill lg t-${STATUS[us.us][1]}">${STATUS[us.us][0]}</span><div><h3>United States</h3><div class="muted small">${M.rows.filter(r => r.region === 'US' && r.k !== 'DJI').map(line).join(' ')}</div></div></div>` : html`<p class="muted">No US index data.</p>`}
      ${eu ? html`<div class="mkt-row"><span class="pill lg t-${STATUS[eu.R.state][1]}">${STATUS[eu.R.state][0]}</span><div><h3>Europe</h3><div class="muted small">${line(eu)}</div></div></div>` : ''}
    </div>
    ${us ? html`<p class="small" style="margin:0;border-left:3px solid var(--blue);padding-left:10px">${EXPOSURE[us.us]}</p>` : ''}`);
  render($('#mTable'), html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Index</th><th class="n">Close</th><th class="n">Day</th><th class="n">vs 50-day</th><th class="n">vs 200-day</th><th class="n">Off high</th><th class="n">Dist. days</th><th>Last FTD</th><th>Status</th></tr></thead><tbody>
    ${M.rows.map(r => { const R = r.R; if (!R) return html`<tr><td>${r.name}</td><td colspan="8" class="muted">${r.error ? r.error.message : 'No data'}</td></tr>`; const n = R.n, vs = a => a[n] ? pc(R.c[n] / a[n] - 1) : '—', cl = x => x >= 0 ? 'up' : 'down';
      return html`<tr><td>${r.name}</td><td class="n">${R.c[n].toLocaleString('en-US', { maximumFractionDigits: 2 })}</td><td class="n ${cl(R.day)}">${pc(R.day, 2)}</td><td class="n ${cl(R.c[n] - (R.s50[n] || 0))}">${vs(R.s50)}</td><td class="n ${cl(R.c[n] - (R.s200[n] || 0))}">${vs(R.s200)}</td><td class="n">${pc(R.off)}</td><td class="n ${R.dd.length >= 5 ? 't-bad' : R.dd.length >= 3 ? 't-warn' : ''}">${R.hasVol ? R.dd.length : 'n/a'}</td><td>${R.lastFtd != null ? fDs(R.b[R.lastFtd].time) : '—'}</td><td><span class="pill t-${STATUS[R.state][1]}">${STATUS[R.state][0]}</span></td></tr>`; })}
  </tbody></table></div><p class="muted tiny" style="margin:0">Daily data through ${fD(Math.max(...M.rows.filter(r => r.R).map(r => r.R.b[r.R.n].time)))}.</p>`);
  charts();
}

function charts() {
  M.charts.forEach(c => c.chart.remove()); M.charts = [];
  const g = $('#mGrid');
  render(g, html`${M.rows.filter(r => r.R).map(r => html`<section class="card" style="gap:6px"><div class="card-head"><h3>${r.name}</h3><span class="pill t-${STATUS[r.R.state][1]}">${STATUS[r.R.state][0]}</span></div><div class="muted tiny">21 / 50 / 200-day lines · <b style="color:var(--down)">D</b> distribution day · <b style="color:var(--up)">FTD</b> follow-through day</div><div class="mini-chart" data-k="${r.k}"></div></section>`)}`);
  for (const r of M.rows.filter(x => x.R)) {
    const el = g.querySelector(`[data-k="${r.k}"]`), R = r.R;
    const up = tok('--up'), dn = tok('--down');
    const chart = createChart(el, { autoSize: true, layout: { background: { type: 'solid', color: tok('--bg2') }, textColor: tok('--muted'), fontFamily: tok('--mono'), fontSize: 10, attributionLogo: true, panes: { separatorColor: tok('--sep') } }, grid: { vertLines: { color: tok('--grid') }, horzLines: { color: tok('--grid') } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, handleScroll: { vertTouchDrag: false } });
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
    mk.sort((a, c) => a.time - c.time); createSeriesMarkers(cs, mk);
    const range = { from: Math.max(0, R.n - 160), to: R.n + 3 };
    chart.timeScale().setVisibleLogicalRange(range);
    M.charts.push({ chart, redraw: () => chart.timeScale().setVisibleLogicalRange(range) });
  }
}
