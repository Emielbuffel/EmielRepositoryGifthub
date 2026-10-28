// The Chart tab: one stock with its chart (EPS line, index comparisons, every detected pattern), the base card,
// signal, earnings, growth checklist, news, flags, key numbers, base history and the user's drawings.
import { fundCard } from './fundui.js';
import { phaseTag, phaseStrip } from './phase.js';
import { renderPanel } from './panel.js';
import { drawIntraday } from './intraday.js';
import { companyCard, fundsItem } from './companyui.js';
import { companyInfo } from '../data/company.js';
import PAT from '../core/pat.js';
import { baseCard, signal, pc, fD, fDs, f2, lineVal, cupPivot, screenRow, baseState, patternPhase } from '../core/analysis.js';
import { setupScore } from '../core/score.js';
import { listMenu } from './lists.js';
import { alertSheet } from './alertsui.js';
import { planSheet } from './plansui.js';
import { planFor, tradesFor, strategy } from '../data/plans.js';
import { pyramid } from '../core/strategy.js';
import { sellPoints, SELL_LABEL } from '../core/sells.js';
import { checkBars, activeFor, onAlerts, describe as describeAlert } from '../data/alerts.js';
import { daily, benchmarkFor, indexSeries, compareOptions, defaultBenchmark, earnings, isIndexSym, provider, isDemo, isDemoSym, DataError, settings, saveSettings } from '../data/service.js';
import { isApp } from '../data/net.js';
import { splitSym, snapshotMeta, yahooIntraday } from '../data/providers.js';
import { stockNews, lastSeen, markSeen, newsSettings } from '../data/news.js';
import { enrich, epsPoints, nextReport, canslimCA, adGrade } from '../core/earnings.js';
import { analyseIndex, STATUS, EXPOSURE } from '../core/market.js';
import * as store from '../data/store.js';
import { App, on, openStock, saveWatch, rememberName, rememberQuote, go, useList } from '../app.js';
import { StockChart, patternsToShow, outcome, PAT_LABEL, patColor, CMP_COLORS } from './chart.js';
import { tok } from './dom.js';
import { $, $$, html, raw, render, esc, money, ICON, toast, ago } from './dom.js';

const V = { chart: null, S: null, data: null, bench: null, R: null, seq: 0, tool: null, pending: null, poly: null, drawingsAll: {}, earn: null, earnErr: null, news: null, newsSeen: 0, newsTag: 'all', cmp: [], mkt: null };
const LINE_DEFS = [['l1', '10-day', '--ma1', '2-week'], ['l2', '21-day EMA', '--ma2', '4-week EMA'], ['l3', '50-day', '--ma3', '10-week'], ['l4', '200-day', '--ma4', '40-week'], ['rs', 'RS line', '--rs'], ['bb', 'Bollinger bands', '--muted']];
let prefs = { tf: 'D', style: 'candles', lines: { l1: false, l2: false, l3: true, l4: true, rs: true, bb: false }, patMode: 'all', sells: true, log: true, panes: { rsi: false, macd: false }, eps: 'ttm', cmp: {}, rsBench: {} };
// comparison choices and the RS benchmark are remembered per market (US, .DE, .T …)
const group = sym => isDemoSym(sym) ? 'demo' : splitSym(sym).sfx || 'US';

export async function initStock(el) {
  prefs = Object.assign(prefs, await store.get('chartPrefs', {}));
  if (window.innerWidth >= 900 && !(await store.get('chartPrefs', null))) prefs.panes = { rsi: true, macd: true };
  V.drawingsAll = await store.get('drawings', {});
  render(el, html`
    <div class="stock-head">
      <div class="stock-id">
        <div class="sym"><b id="sSym">—</b><span id="sName"></span><span id="sTags" class="row" style="gap:6px"></span></div>
        <div class="px"><span class="p" id="sPx">—</span><span class="ch" id="sCh"></span></div>
        <div class="status"><span class="dot" id="sDot"></span><span id="sStatus">Loading…</span></div>
      </div>
      <div class="toolbar">
        <button class="btn" id="sWatch"></button>
        <button class="btn" id="sAlert" aria-label="Set an alert"></button>
        <button class="btn" id="sPlan" aria-label="Buying plan"></button>
        <button class="btn" id="sRefresh" aria-label="Refresh prices">${raw(ICON.refresh)}<span>Refresh</span></button>
      </div>
    </div>
    <div class="row" style="gap:8px;justify-content:flex-start"><select class="input list-pick" id="sList" aria-label="Watchlist"></select><div class="chips" id="sChips" aria-label="Watchlist" style="flex:1;min-width:0"></div></div>
    <div class="chart-row">
    <section class="card chart-card">
      <div class="chart-tools">
        <div class="seg" role="group" aria-label="Time frame"><button data-it="1d" title="Today, 5-minute bars (Yahoo Finance)">1D</button><button data-it="5d" title="Last 5 days, 15-minute bars (Yahoo Finance)">5D</button><button data-tf="D">Daily</button><button data-tf="W">Weekly</button></div>
        <div class="menu"><button class="btn sm" id="mLines">${raw(ICON.layers)}Lines</button><div class="menu-pop" id="pLines" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mCmp">Compare</button><div class="menu-pop" id="pCmp" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mEps">EPS</button><div class="menu-pop" id="pEps" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mPat">Patterns</button><div class="menu-pop" id="pPat" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mDraw">${raw(ICON.pen)}Draw</button><div class="menu-pop" id="pDraw" hidden></div></div>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Time range" id="sSpan">${[[3, '3M'], [6, '6M'], [12, '1Y'], [24, '2Y'], [60, '5Y'], [0, 'All']].map(([m, l]) => html`<button data-span="${m}">${l}</button>`)}</div>
      </div>
      <div class="chart-wrap" id="sChartWrap"><div class="chart-legend" id="sLegend"></div><div id="sChart" style="position:absolute;inset:0"></div><div id="sIntra" style="position:absolute;inset:0" hidden></div></div>
      <div class="chart-hint" id="sHint" hidden></div>
      <div class="small t-warn" id="sNote" hidden></div>
      <div class="pat-strip" id="sPats" aria-label="Patterns on this chart"></div>
    </section>
      <aside class="card data-panel" id="sPanel" hidden></aside>
    </div>
    <section class="card" id="cMkt" hidden></section>
    <div class="grid2">
      <section class="card" id="cBase"></section>
      <section class="card" id="cSig"></section>
    </div>
    <div class="grid2">
      <section class="card" id="cEarn"></section>
      <section class="card" id="cCanslim"></section>
    </div>
    <section class="card" id="cCo" hidden></section>
    <section class="card" id="cFund"></section>
    <div class="grid2">
      <section class="card" id="cNews"></section>
      <section class="card" id="cFlags"></section>
    </div>
    <section class="card" id="cHist"></section>
    <div class="grid2">
      <section class="card" id="cNums"></section>
      <section class="card" id="cDraw"></section>
    </div>
    <p class="disclaimer">Educational analysis using widely published rules of thumb. Not investment advice. End-of-day data; check prices with your broker before acting.</p>
  `);
  V.chart = new StockChart($('#sChart'), $('#sLegend'));
  V.chart.panes = { ...prefs.panes }; V.chart.style = prefs.style; V.chart.build();
  V.chart.clickCb = onChartClick;
  wireTools();
  onAlerts(() => { if (V.data) head(); });
  on((type) => {
    if (type === 'stock') load(App.sym);
    if (type === 'watch' || type === 'quote') { chips(); if (type === 'watch' && V.data) head(); }
    if (type === 'market' && V.R) cards();
    if (type === 'provider') load(App.sym);
  });
  load(App.sym);
}

/* ---------- loading ---------- */
async function load(sym, force = false) {
  const seq = ++V.seq;
  setTool(null);
  status('Loading ' + sym + '…', '');
  $('#sSym').textContent = sym; $('#sName').textContent = App.names[sym] || '';
  chips();
  try {
    const g = group(sym);
    const [d, bench] = await Promise.all([daily(sym, { force, long: true }), benchmarkFor(sym, prefs.rsBench[g], { long: true }).catch(() => null)]);
    if (seq !== V.seq) return;
    // an index has no RS line against itself
    $('#sChartWrap').hidden = false; if (IV.range) intra(null);
    V.data = d; V.bench = bench && bench.sym !== sym ? bench : null; V.sym = sym; V.rs = null; V.score = null; V.earn = null; V.earnErr = null; V.news = null; V.cmp = [];
    if (d.name) await rememberName(sym, d.name);
    V.R = PAT.scan(d.bars);
    V.phase = isIndexSym(sym) ? null : patternPhase(V.R, d.bars);
    V.sells = sellPoints(d.bars, V.R);
    V.mkt = isIndexSym(sym) ? analyseIndex(d.bars) : null;
    const n = d.bars.length - 1;
    await rememberQuote(sym, d.bars[n].close, d.bars[n].close / d.bars[n - 1].close - 1, V.phase ? { ph: V.phase.label, pt: V.phase.tone } : {});
    head(); draw(false); cards();
    if (App.pendingZoom && App.pendingZoom.sym === sym) { // "Review chart" from the journal
      const z = App.pendingZoom; App.pendingZoom = null; const idx = t => { let i = d.bars.findIndex(b => b.time >= t); return i < 0 ? n : i; };
      setTimeout(() => V.chart.zoomDaily(idx(z.from) - 40, z.to ? idx(z.to) + 20 : n), 50);
    }
    const src = isDemoSym(sym) ? 'Demo data · fictional ' + (isIndexSym(sym) ? 'index' : 'company') : provider().short;
    const dt = fD(d.bars[n].time);
    if (d.stale) status(`Showing saved prices through ${dt}: ${d.error ? d.error.message : 'refresh failed'}`, 'warn');
    else if ((Date.now() / 1000 - d.bars[n].time) / 86400 > 5 && !isDemoSym(sym)) status(`Prices end on ${dt}: ${Math.floor((Date.now() / 1000 - d.bars[n].time) / 86400)} days old. ${d.builtIn ? 'Built-in data; live prices load in the desktop app.' : 'Tap Refresh.'}`, 'warn');
    else if (d.builtIn) status(`Built-in data through ${dt}. Live prices and the full history load in the desktop app.`, 'ok');
    else status(`${provider().id === 'free' ? 'Live · free public feeds' : src} · daily data through ${dt}${d.cached && !isDemoSym(sym) ? ' · updated ' + ago(d.fetchedAt) : ''}`, isDemoSym(sym) ? 'demo' : 'ok');
    checkBars(sym, d.bars, d.name).then(h => { if (h.length) { toast(describeAlert(h[0], d.name), 6000); head(); } loadPlan(sym, seq); });
    loadCompare(sym, seq);
    if (!V.mkt) loadEarnings(sym, seq); else earnCard();
    $('#cFund').hidden = !!V.mkt || isDemoSym(sym); if (!$('#cFund').hidden) fundCard(sym);
    V.co = null; $('#cCo').hidden = true; renderPanel(V);
    if (!V.mkt && !isDemoSym(sym)) companyInfo(sym).then(co => { if (seq !== V.seq) return; V.co = co; companyCard(co, d.bars[n].close); renderCanslim(); renderPanel(V); });
    loadNews(sym, seq);
  } catch (e) {
    if (seq !== V.seq) return;
    status(e.message || String(e), 'warn');
    if (!V.data || V.data.sym !== sym) emptyState(sym, e);
  }
}

async function loadCompare(sym, seq) {
  const ids = (prefs.cmp[group(sym)] || []).filter(id => id !== '__none');
  const res = await Promise.all(ids.map(id => indexSeries(id, isDemo() || isDemoSym(sym), { long: true }).then(x => ({ ...x, short: shortName(x.name) })).catch(() => null)));
  if (seq !== V.seq) return;
  V.cmp = res.filter(x => x && x.sym !== sym).map(x => ({ ...x, bars: x.bars.map(b => ({ time: b.time, close: b.close })) }));
  if (ids.length && V.cmp.length < ids.length) toast('Some comparison data is not available on your plan.');
  if (V.cmp.length || ids.length === 0) draw(true);
}
const shortName = n => n.replace(/\s*\(.*\)\s*/, '').replace(' (fictional index)', '');

/* buying plan levels and journal trades on the chart */
async function loadPlan(sym, seq) {
  const [plan, trades, S] = await Promise.all([planFor(sym), tradesFor(sym), strategy()]);
  if (seq !== V.seq) return;
  V.plan = plan; V.trades = trades;
  if (plan && plan.pivot) { const py = pyramid(S, plan.pivot); V.planLv = { pivot: plan.pivot, add2: py.steps[1] && py.steps[1].from, add3: py.steps[2] && py.steps[2].from, stop: plan.lastStep && plan.lastStep.stop ? plan.lastStep.stop : py.stop, done: plan.buys.length }; } else V.planLv = null;
  const st = plan && plan.lastStep;
  render($('#sPlan'), html`${raw(ICON.layers)}<span>${plan ? (st ? st.title : 'Plan') : 'Plan'}</span>`);
  $('#sPlan').classList.toggle('primary', !!(st && ['buy', 'add'].includes(st.level)));
  draw(true);
}

async function loadEarnings(sym, seq) {
  try { const rows = await earnings(sym); if (seq !== V.seq) return; V.earn = rows; }
  catch (e) { if (seq !== V.seq) return; V.earnErr = e.message; }
  draw(true); cards();
}

async function loadNews(sym, seq) {
  V.newsSeen = await lastSeen(sym);
  newsCard(true);
  const r = await stockNews(sym, V.data && V.data.name, cached => { if (seq === V.seq) { V.news = cached; newsCard(true); } });
  if (seq !== V.seq) return;
  V.news = r; newsCard(false);
  markSeen(sym);
}

function emptyState(sym, e) {
  const msg = e instanceof DataError && e.kind === 'auth'
    ? html`<p>${e.message}</p><button class="btn primary" id="eSet">Open Settings</button>`
    : html`<p>${e.message || 'Could not load ' + sym + '.'}</p>${isDemo() ? html`<button class="btn primary" id="eDemo">Open a demo stock</button>` : ''}`;
  ['#cBase', '#cSig', '#cCanslim', '#cFlags', '#cHist', '#cNums', '#cDraw', '#cEarn', '#cNews', '#cFund', '#cCo'].forEach(id => { const x = $(id); if (x) x.innerHTML = ''; });
  $('#cMkt').hidden = true;
  // no stale chart of the previous stock
  V.data = null; $('#sChartWrap').hidden = true; $('#sNote').hidden = true; $('#sSym').textContent = sym; $('#sName').textContent = '';
  render($('#cBase'), html`<div class="empty">${raw(ICON.info)}${msg}<div id="eSug"></div></div>`);
  if (!isDemo() && !(e instanceof DataError && e.kind === 'auth')) suggest(sym);
  $('#eSet') && ($('#eSet').onclick = () => go('settings'));
  $('#eDemo') && ($('#eDemo').onclick = () => openStock('ACME.DEMO'));
  $('#sPats').innerHTML = '';
}

/* ---------- intraday view (1 day / 5 days) from the free Yahoo feed, refreshed every minute ---------- */
const IV = { range: null, chart: null, timer: null };
async function intra(range) {
  IV.range = range; clearInterval(IV.timer);
  if (IV.chart) { try { IV.chart.remove(); } catch (e) { /* gone */ } IV.chart = null; }
  const box = $('#sIntra'); $('#sChart').hidden = !!range; $('#sLegend').hidden = !!range; box.hidden = !range;
  $$('[data-it]').forEach(b => b.classList.toggle('on', b.dataset.it === range));
  $$('[data-tf]').forEach(b => b.classList.toggle('on', !range && b.dataset.tf === prefs.tf));
  if (!range) return;
  if (!isApp()) { render(box, html`<div class="empty">${raw(ICON.info)}<p>Intraday charts come from Yahoo Finance's free feed in the desktop app (browsers block it).</p></div>`); return; }
  const sym = V.sym, load = async () => {
    try {
      const D = await yahooIntraday(sym, range === '1d' ? { range: '1d', interval: '5m' } : { range: '5d', interval: '15m' });
      if (IV.range !== range || V.sym !== sym) return;
      if (IV.chart) { try { IV.chart.remove(); } catch (e) { /* gone */ } }
      box.innerHTML = ''; IV.chart = drawIntraday(box, D);
      const last = D.price ?? D.bars[D.bars.length - 1].close, r = D.prevClose ? last / D.prevClose - 1 : null;
      status(`Intraday · ${range === '1d' ? '5-minute' : '15-minute'} bars · ${D.open ? 'market open' : 'market closed'} · ${r == null ? '' : (r >= 0 ? '+' : '') + (r * 100).toFixed(2) + '% vs previous close · '}Yahoo Finance (can be delayed)`, 'ok');
    } catch (e) { render(box, html`<div class="empty">${raw(ICON.info)}<p>${e.message}</p></div>`); }
  };
  render(box, html`<div class="empty"><span class="spinner"></span><span>Loading intraday prices…</span></div>`);
  await load();
  IV.timer = setInterval(() => { if (document.visibilityState === 'visible' && !box.hidden) load(); }, 60000);
}

/* a name typed instead of a ticker ("SHARKNINJA"): find the company and open it, or offer the matches */
async function suggest(sym) {
  let list = [];
  try { list = (await provider().search(sym, settings.keys[settings.provider])).filter(x => x.symbol && x.symbol.toUpperCase() !== sym); } catch (e) { return; }
  const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const top = list[0], q = fold(sym);
  if (top && q.length >= 4 && !/[.\d]/.test(sym) && fold(top.name).startsWith(q) && V.autoFrom !== top.symbol) { V.autoFrom = top.symbol; toast(`Opened ${top.symbol} (${top.name}): "${sym}" is not a ticker.`, 5000); openStock(top.symbol, top.name); return; }
  const el = $('#eSug'); if (!el || !list.length) return;
  render(el, html`<p class="small" style="margin:8px 0 4px">Did you mean:</p><div class="toolbar" style="justify-content:center">${list.slice(0, 6).map(x => html`<button class="btn sm" data-sug="${x.symbol}" data-n="${x.name || ''}"><b>${x.symbol}</b>&nbsp;${x.name || ''}</button>`)}</div>`);
  $$('[data-sug]', el).forEach(b => { b.onclick = () => openStock(b.dataset.sug, b.dataset.n); });
}

function status(t, cls) { $('#sStatus').textContent = t; $('#sDot').className = 'dot ' + (cls || ''); }
const fp = x => money(x, V.data ? V.data.currency : 'USD');

function head() {
  const d = V.data.bars, n = d.length - 1, p = d[n].close, ch = p - d[n - 1].close;
  $('#sSym').textContent = V.sym; $('#sName').textContent = V.data.name || App.names[V.sym] || '';
  $('#sPx').textContent = fp(p);
  const e = $('#sCh'); e.textContent = (ch >= 0 ? '+' : '−') + money(Math.abs(ch), V.data.currency).replace(/^[^\d]*/, '') + ' (' + pc(ch / d[n - 1].close, 2) + ')';
  e.className = 'ch ' + (ch >= 0 ? 'up' : 'down');
  tags();
  const inLists = App.lists.filter(l => l.syms.includes(V.sym));
  render($('#sWatch'), html`${raw(inLists.length ? ICON.starFill : ICON.star)}<span>${inLists.length ? (inLists.length === 1 ? inLists[0].name : inLists.length + ' lists') : 'Add to list'}</span>`);
  activeFor(V.sym).then(a => { if (V.sym) render($('#sAlert'), html`${raw(ICON.bell)}<span>${a.length ? a.length + ' alert' + (a.length > 1 ? 's' : '') : 'Alert'}</span>`); });
}

/* RS rank (1-99 within the built-in universe, from the latest scan when there is one) and sector */
async function tags() {
  const el = $('#sTags'), sym = V.sym; el.innerHTML = '';
  if (isDemoSym(sym) || isIndexSym(sym)) return;
  let rs = null, n = 0, sector = '';
  const scan = await store.get('screen.' + provider().id, null);
  const row = scan && scan.rows.find(r => r.s === sym);
  if (row && row.rs != null) { rs = row.rs; n = scan.rows.length; }
  try { const m = await snapshotMeta(); const st = m.stocks.find(x => x.s === sym); if (st) { sector = st.g || ''; if (rs == null && st.r) { rs = st.r; n = m.stocks.length; } } } catch (e) { /* no built-in data */ }
  if (sym !== V.sym) return;
  V.rs = rs;
  // setup score: base, strength, trend, demand, earnings and market in one number
  const sr = screenRow(sym, '', V.data.bars, V.R, V.bench ? V.bench.bars : null);
  let sc = null;
  if (sr) { sr.rs = rs; const q = enrich(V.earn || []).pop(); sc = setupScore(sr, q ? q.yoy : null, App.mkt); V.score = sc; }
  renderPanel(V);
  render(el, html`${phaseTag(V.phase)}${sc ? html`<span class="tag ${sc.score >= 70 ? 't-ok' : sc.score >= 45 ? 't-warn' : 't-mute'}" title="${sc.parts.map(p => `${p[0]} ${p[1]}/${p[2]} (${p[3]})`).join(' · ')}">Setup ${sc.score}</span>` : ''}${rs != null ? html`<span class="tag ${rs >= 80 ? 't-ok' : rs >= 50 ? 't-blue' : 't-mute'}" title="12-month price strength, latest quarter double-weighted, ranked 1–99 among ${n} stocks. The app's own measure.">RS ${rs}</span>` : ''}${sector ? html`<span class="tag t-mute">${sector}</span>` : ''}`);
}

function chips() {
  const el = $('#sChips'); if (!el) return;
  const ls = $('#sList'); render(ls, html`${App.lists.map(l => html`<option value="${l.id}" ${l.id === App.listId ? raw('selected') : ''}>${l.name}</option>`)}`); ls.onchange = () => useList(ls.value);
  render(el, html`${App.watch.map(s => { const q = App.last[s]; return html`<button class="chip${s === App.sym ? ' on' : ''}" data-s="${s}">${s.replace('.DEMO', '')}${q ? html`<span class="c ${q.ch >= 0 ? 'up' : 'down'}">${pc(q.ch, 1)}</span>` : ''}</button>`; })}`);
  $$('.chip', el).forEach(b => { b.onclick = () => openStock(b.dataset.s); });
}

function chartState() {
  return {
    sym: V.sym, daily: V.data.bars, bench: V.bench ? V.bench.bars : null, R: V.R, tf: prefs.tf, lines: prefs.lines, patMode: prefs.patMode, log: prefs.log !== false,
    drawings: drawings(), cur: V.data.currency, pending: V.pending, poly: V.poly, mkt: V.mkt, compare: V.cmp, trades: V.trades || [], plan: V.planLv || null, sells: prefs.sells !== false && !V.mkt ? V.sells || [] : [],
    eps: prefs.eps !== 'off' && V.earn ? { mode: prefs.eps, points: epsPoints(V.earn, prefs.eps) } : null,
  };
}
function draw(keep) {
  if (!V.data) return;
  V.chart.update(chartState(), keep);
  lineNotes();
  $$('[data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === prefs.tf));
  patStrip();
}
const savePrefs = () => store.set('chartPrefs', prefs);

/* says which lines are missing or shorter than the chart, and why */
function lineNotes() {
  const el = $('#sNote'); if (!el || !V.data || V.mkt || isDemoSym(V.sym)) { if (el) el.hidden = true; return; }
  const first = V.data.bars[0].time, out = [], web = !isApp();
  const why = web ? ' In the web version only the built-in data is available; the desktop app loads it from free feeds.' : '';
  if (prefs.eps !== 'off' && V.earnErr) out.push(`EPS line: no earnings data for ${V.sym}.${why || ' The free feeds did not answer: try Refresh later.'}`);
  else if (prefs.eps !== 'off' && V.earn && epsPoints(V.earn, prefs.eps).length < 2) out.push(`EPS line: not enough reported quarters for ${V.sym} yet${prefs.eps === 'ttm' ? ' (the 4-quarter line needs a year of reports; try "Quarterly")' : ''}.`);
  const ids = (prefs.cmp[group(V.sym)] || []).filter(id => id !== '__none');
  if (ids.length > V.cmp.length) out.push(`${ids.length - V.cmp.length} comparison line${ids.length - V.cmp.length > 1 ? 's are' : ' is'} not available.${why}`);
  for (const c of V.cmp) if (c.bars[0].time > first + 30 * 86400) out.push(`${shortName(c.name)} line starts on ${fD(c.bars[0].time)}.${why}`);
  if (prefs.lines.rs && !V.bench) out.push('RS line: no benchmark data.' + why);
  else if (prefs.lines.rs && V.bench && V.bench.bars[0].time > first + 30 * 86400) out.push(`RS line starts on ${fD(V.bench.bars[0].time)} (benchmark data).`);
  el.hidden = !out.length; el.textContent = out.join(' ');
}

/* ---------- patterns strip: every detected pattern, tap to zoom ---------- */
function patStrip() {
  const d = V.data.bars, list = patternsToShow(V.R, d, 'all');
  const el = $('#sPats');
  if (!list.length) { render(el, html`<span class="muted small">No base patterns found in this history. ${V.R.cur.length ? '' : "That itself is information: the method only buys from proper bases."}</span>`); return; }
  // newest first; the current base leads
  const sorted = [...list].sort((a, b) => (a.kind === 'cur' ? -1 : 0) - (b.kind === 'cur' ? -1 : 0) || (b.p.bo ?? b.p.e ?? 0) - (a.p.bo ?? a.p.e ?? 0));
  render(el, html`${sorted.map(({ p, kind }, i) => {
    const when = kind === 'hist' || kind === 'bo' ? 'Breakout ' + fDs(d[p.bo].time) : kind === 'alt' ? 'Also fits now' : 'Forming now';
    const res = kind === 'hist' || kind === 'bo' ? outcome(p) : p.pivot ? 'buy point ' + fp(p.pivot) : 'no buy point';
    return html`<button class="pat-chip${kind === 'cur' ? ' cur' : ''}" style="--pc:${patColor(p.type)}" data-i="${i}"><b>${p.name}</b><span>${when} · ${Math.round(p.weeks || 0)} wk</span><span class="${p.failed || p.stopped ? 't-bad' : p.best >= 0.2 ? 't-ok' : ''}">${res}</span></button>`;
  })}`);
  $$('.pat-chip', el).forEach(b => {
    b.onclick = () => {
      const { p } = sorted[+b.dataset.i];
      if (prefs.patMode !== 'all') { prefs.patMode = 'all'; savePrefs(); draw(true); }
      V.chart.zoomDaily(p.a - 10, Math.min(d.length - 1, (p.bo ?? p.e ?? d.length - 1) + 25));
      $('#sChartWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

/* ---------- cards ---------- */
function cards() {
  if (!V.data) return;
  const d = V.data.bars, bench = V.bench ? V.bench.bars : null;
  const C = baseCard(V.R, d, bench, fp);
  const S = V.sig = signal(V.R, d, bench, fp, App.mkt, drawings());
  const B = C.B, tone = t => 't-' + t;
  // earnings-date warning and extra professional numbers
  const nx = nextReport(V.earn), n = d.length - 1;
  if (nx) {
    const days = Math.round((nx.time - d[n].time) / 86400);
    if (days >= 0 && days <= 21) S.flags.unshift(['warn', `Earnings in ${days} day${days === 1 ? '' : 's'} (${fD(nx.time)}). Buying right before a report is risky; a gap can wipe out a breakout.`]);
  }
  const lastQ = enrich(V.earn || []).pop();
  if (lastQ && d[n].time - lastQ.time < 6 * 86400) S.flags.unshift([lastQ.yoy >= 0.2 ? 'bull' : lastQ.yoy < 0 ? 'bear' : 'info', `Results just in: EPS ${f2(lastQ.eps)}${lastQ.yoy != null ? ' (' + pc(lastQ.yoy, 0) + ' y/y)' : ''}${lastQ.surprise != null ? ', ' + pc(lastQ.surprise, 0) + ' vs estimate' : ''}.`]);
  if (S.flags.length > 1) S.flags = S.flags.filter(f => f[1] !== 'Nothing new today.');
  const ad = adGrade(d);
  let dv = 0; for (let i = Math.max(0, n - 49); i <= n; i++) dv += d[i].close * d[i].volume; dv /= Math.min(50, n + 1);
  S.nums.splice(7, 0, ['Accumulation grade, 13 weeks', ad ? ad.grade + ' · ratio ' + ad.ratio.toFixed(2) : '—'], ['Avg daily value traded (50d)', bigNum(dv, V.data.currency)]);
  if (nx) S.nums.push(['Next earnings', fD(nx.time)]);
  if (V.score) S.nums.unshift(['Setup score', V.score.score + ' / 100 · ' + V.score.parts.map(p => p[0] + ' ' + p[1] + '/' + p[2]).join(', ')]);
  if (V.mkt) mktCard(); else $('#cMkt').hidden = true;
  render($('#cBase'), html`
    <div class="card-head"><h2>Base pattern</h2>${B.p ? html`<span class="tag" style="color:${patColor(B.p.type)}">${PAT_LABEL[B.p.type] || ''}</span>` : ''}</div>
    ${phaseStrip(V.phase)}
    <div class="row" style="justify-content:flex-start;flex-wrap:wrap"><span class="pill lg ${tone(B.tone)}">${B.st}</span><h3>${C.title}</h3></div>
    ${C.facts.length ? html`<div class="facts">${C.facts.map(([k, v]) => html`<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`)}</div>` : ''}
    ${C.plan.length ? html`<ol class="plan">${C.plan.map(x => html`<li>${raw(x)}</li>`)}</ol>` : ''}
    ${C.notes.length ? html`<ul class="notes">${C.notes.map(([k, t]) => html`<li class="${k}">${t}</li>`)}</ul>` : ''}
    ${C.also ? html`<p class="muted small" style="margin:0">${C.also}</p>` : ''}`);
  const sigTone = S.sig === 'BUY' ? 'ok' : S.sig === 'SELL' ? 'bad' : S.sig === 'WATCH' ? 'blue' : 'warn';
  render($('#cSig'), html`
    <div class="card-head"><h2>Signal</h2><span class="muted tiny">Recalculated on every price update</span></div>
    <div class="row" style="justify-content:flex-start;align-items:flex-start"><span class="pill lg t-${sigTone}">${S.sig}</span><span class="small">${S.why}</span></div>
    <ol class="checks">${S.steps.map(([t, ok, note]) => html`<li><span class="mark ${ok ? 'y' : 'n'}">${ok ? '✓' : ''}</span><span>${t}</span><span class="muted tiny num">${note || ''}</span></li>`)}</ol>
    <p class="muted tiny" style="margin:0">A checklist of classic rules, not advice.</p>`);
  const lab = { bull: ['Bullish', 't-ok'], bear: ['Bearish', 't-bad'], warn: ['Caution', 't-warn'], info: ['Watch', 't-mute'] };
  render($('#cFlags'), html`<h2>Flags right now</h2><ul class="flags">${S.flags.map(([l, t]) => html`<li><span class="tag ${lab[l][1]}">${lab[l][0]}</span><span>${t}</span></li>`)}</ul>`);
  render($('#cNums'), html`<h2>Key numbers</h2><div class="kv">${S.nums.map(([a, b]) => html`<div><span>${a}</span><span class="num">${b}</span></div>`)}</div>
    ${V.bench ? html`<p class="muted tiny" style="margin:0">RS line vs ${V.bench.name}.</p>` : ''}`);
  histCard(); renderCanslim(); earnCard(); drawList(); tags();
}

const bigNum = (x, cur) => { const s = money(0, cur).replace(/[\d.,]+.*$/, ''); const a = Math.abs(x); return s + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : (a / 1e3).toFixed(0) + 'K') + (cur === 'GBp' ? ' (pence)' : ''); };

/* ---------- index status (when the chart shows a market index) ---------- */
function mktCard() {
  const R = V.mkt, el = $('#cMkt'); if (!R) return;
  el.hidden = false;
  const st = STATUS[R.state];
  render(el, html`<div class="card-head"><h2>Market status · this index</h2><button class="btn sm" id="mkGo">Market tab</button></div>
    <div class="row" style="justify-content:flex-start;flex-wrap:wrap"><span class="pill lg t-${st[1]}">${st[0]}</span><span class="small">Since ${fDs(R.b[R.since].time)} · ${R.hasVol ? R.dd.length + ' active distribution day' + (R.dd.length === 1 ? '' : 's') : 'no volume data'}${R.lastFtd != null ? ' · last follow-through day ' + fDs(R.b[R.lastFtd].time) : ''}${R.state === 'corr' && R.rallyDay ? ' · rally attempt day ' + R.rallyDay : ''}</span></div>
    <p class="small" style="margin:0">${EXPOSURE[R.state]}</p>
    <p class="muted tiny" style="margin:0">On the chart: <b style="color:var(--down)">D</b> = active distribution day (faint dots = expired ones), <b style="color:var(--up)">FTD</b> = follow-through day; the thin band at the bottom shows the status day by day (green uptrend, orange under pressure, red correction). Draw on the index like on any stock.</p>`);
  $('#mkGo').onclick = () => go('market');
}

/* ---------- earnings  ---------- */
function earnCard() {
  const el = $('#cEarn'); if (!el || !V.data) return;
  if (V.mkt) { render(el, html`<h2>Earnings</h2><p class="muted small" style="margin:0">Indexes have no earnings line here. Use Compare to set this index against others.</p>`); return; }
  if (!V.earn) {
    const P = provider(), msg = V.earnErr ? V.earnErr : isDemoSym(V.sym) || P.earnings ? 'Loading earnings…' : 'Earnings come with a data provider (FMP, Twelve Data or EODHD).';
    render(el, html`<h2>Earnings</h2><p class="muted small" style="margin:0">${msg}</p>`); return;
  }
  const q = enrich(V.earn), nx = nextReport(V.earn), last8 = q.slice(-8), rep = q.filter(r => r.eps != null), src = (V.earn.find(r => r.eps != null) || {}).src;
  const cls = x => x == null ? '' : x >= 0.2 ? 't-ok' : x < 0 ? 't-bad' : 't-warn';
  const ttm = q.filter(r => r.ttm != null);
  const row = r => html`<tr><td>${fDs(r.time)}${r.period ? html` <span class="muted tiny">${r.period}</span>` : ''}</td><td class="n">${f2(r.eps)}</td><td class="n ${cls(r.yoy)}">${pc(r.yoy, 0)}</td><td class="n ${r.surprise == null ? '' : r.surprise >= 0 ? 't-ok' : 't-bad'}">${pc(r.surprise, 0)}</td><td class="n ${cls(r.revYoy)}">${pc(r.revYoy, 0)}</td><td class="n">${f2(r.ttm)}</td></tr>`;
  render(el, html`<div class="card-head"><h2>Earnings · quarter by quarter</h2>${nx ? html`<span class="tag t-blue">Next report ${fDs(nx.time)}${nx.est != null ? ' · est. ' + f2(nx.est) : ''}</span>` : ''}</div>
    ${last8.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Reported</th><th class="n">EPS</th><th class="n">vs yr ago</th><th class="n">vs est.</th><th class="n">Sales vs yr ago</th><th class="n">4Q EPS</th></tr></thead><tbody>
      ${[...last8].reverse().map(row)}
    </tbody></table></div>` : html`<p class="muted small" style="margin:0">No reported quarters.</p>`}
    ${rep.length > 8 ? html`<details class="small"><summary>All ${rep.length} quarters since ${new Date(rep[0].time * 1000).getUTCFullYear()}</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Reported</th><th class="n">EPS</th><th class="n">vs yr ago</th><th class="n">vs est.</th><th class="n">Sales vs yr ago</th><th class="n">4Q EPS</th></tr></thead><tbody>${[...q].reverse().slice(8).filter(r => r.eps != null).map(row)}</tbody></table></div></details>` : ''}
    ${ttm.length >= 2 ? html`<p class="small" style="margin:0">4-quarter EPS ${f2(ttm[ttm.length - 1].ttm)}, ${ttm.length >= 5 ? pc(ttm[ttm.length - 1].ttm / ttm[ttm.length - 5].ttm - 1, 0) + ' vs a year ago' : ''}. On the chart, the <b style="color:var(--eps)">EPS line</b> uses the left axis; dots mark each report (green = EPS up 20%+ y/y, orange = up less, red = down).</p>` : ''}
    <p class="muted tiny" style="margin:0">Source: ${isDemoSym(V.sym) ? 'fictional demo figures' : src === 'sec' ? 'SEC EDGAR filings (10-Q / 10-K): GAAP diluted EPS, adjusted for stock splits; Q4 = full year minus the first three quarters; dates are filing dates (results are usually announced a few days earlier). Switch to adjusted EPS in the EPS menu where available.' : src === 'yahoo' ? 'free fundamentals feed: reported diluted EPS of the last quarters; report dates estimated (quarter end + 6 weeks).' : src === 'adjusted' ? 'built-in data: adjusted EPS (the analyst basis) with the real report dates.' : provider().name + '. EPS as the provider reports it (usually adjusted/non-GAAP for estimates).'}</p>`);
}

/* ---------- news ---------- */
const TAG_LBL = { earnings: ['Earnings', 't-ok'], analyst: ['Analyst', 't-blue'], deal: ['Deal', 't-warn'], filing: ['Filing', 't-mute'], product: ['Product', 't-blue'], other: ['News', 't-mute'] };
function newsCard(loading) {
  const el = $('#cNews'); if (!el) return;
  const r = V.news, items = r ? r.items : [];
  const shown = items.filter(x => V.newsTag === 'all' || x.tag === V.newsTag).slice(0, 25);
  const tags = ['all', ...new Set(items.map(x => x.tag))];
  const agoT = ms => { if (!ms) return ''; const h = (Date.now() - ms) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };
  render(el, html`<div class="card-head"><h2>News</h2><div class="toolbar">${loading ? html`<span class="spinner" aria-label="Checking for news"></span>` : ''}<button class="btn sm" id="nRef" aria-label="Check for new headlines">${raw(ICON.refresh)}</button></div></div>
    ${items.length > 3 ? html`<div class="chips">${tags.map(t => html`<button class="chip${V.newsTag === t ? ' on' : ''}" data-tag="${t}">${t === 'all' ? 'All' : TAG_LBL[t][0]}</button>`)}</div>` : ''}
    ${shown.length ? html`<div class="news-list">${shown.map(x => {
      const isNew = V.newsSeen && x.date && x.date > V.newsSeen;
      const body = html`<span class="nt">${isNew ? html`<span class="new">NEW</span> ` : ''}${x.title}</span><span class="nm"><span class="tag ${TAG_LBL[x.tag] ? TAG_LBL[x.tag][1] : 't-mute'}">${TAG_LBL[x.tag] ? TAG_LBL[x.tag][0] : 'News'}</span>${x.source || x.domain}${x.date ? ' · ' + agoT(x.date) : ''}${x.paywalled ? ' · may need a subscription' : ''}</span>`;
      return x.link ? html`<a class="news-item" href="${x.link}" target="_blank" rel="noopener">${body}</a>` : html`<div class="news-item">${body}</div>`;
    })}</div>` : html`<p class="muted small" style="margin:0">${loading ? 'Checking the news sources…' : r && r.browserBlocked ? 'News feeds load in the desktop app. Web browsers block these feeds for security (CORS).' : 'No recent headlines from the enabled sources.'}</p>`}
    <p class="muted tiny" style="margin:0">${r && r.demo ? 'Example headlines for a fictional company.' : `Checked ${r ? ago(r.at) : '…'} from ${Object.entries(newsSettings().sources).filter(([, v]) => v).length} free sources${newsSettings().hidePaywalled ? ', paywalled sites hidden' : ''}${r && r.errors && r.errors.length && !r.browserBlocked ? ` · not reachable now: ${r.errors.join(', ')}` : ''}. Headlines link to the original site.`}</p>`);
  $('#nRef').onclick = () => loadNews(V.sym, V.seq);
  $$('[data-tag]', el).forEach(b => { b.onclick = () => { V.newsTag = b.dataset.tag; newsCard(false); }; });
}

function sellCell(h) {
  const x = (V.sells || []).find(s => s.h === h), d = V.data.bars;
  if (!x) return html`<span class="muted">—</span>`;
  if (x.sell) return html`<b class="${x.sell.ret >= 0 ? 't-ok' : 't-bad'}">${fDs(d[x.sell.i].time)} · ${SELL_LABEL[x.sell.code]} ${pc(x.sell.ret, 0)}</b><br><span class="muted">${x.sell.why}</span>`;
  return html`<b class="t-blue">Holding</b> · sell line ${fp(x.open.line)} (${x.open.lineWhy}); targets ${fp(x.open.t20)}–${fp(x.open.t25)}${x.open.holdUntil != null ? html`<br><span class="muted">8-week rule: hold until ${x.open.holdUntil < d.length ? fDs(d[x.open.holdUntil].time) : 'about ' + new Date((d[d.length - 1].time + (x.open.holdUntil - d.length + 1) * 1.4 * 86400) * 1000).toISOString().slice(0, 10)}</span>` : ''}`;
}
function histCard() {
  const R = V.R, d = V.data.bars;
  render($('#cHist'), html`
    <div class="card-head"><h2>Base history · every breakout found</h2><span class="muted tiny">${R.hist.length} breakout${R.hist.length === 1 ? '' : 's'}</span></div>
    ${R.hist.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pattern</th><th>Base</th><th class="n">Weeks</th><th class="n">Depth</th><th class="n">Buy point</th><th>Breakout</th><th class="n">Volume</th><th class="n">Stage</th><th>What happened</th><th>Sell signal (book rules)</th></tr></thead><tbody>
      ${[...R.hist].reverse().map((h, i) => html`<tr class="click" data-i="${R.hist.length - 1 - i}">
        <td><span class="tag" style="color:${patColor(h.type)}">${h.faulty ? 'faulty' : h.type}</span> ${h.name.replace(' (faulty)', '')}</td>
        <td>${fDs(d[h.a].time)} – ${fDs(d[h.e].time)}</td><td class="n">${Math.round(h.weeks)}</td><td class="n">−${Math.round(h.depth * 100)}%</td><td class="n">${f2(h.pivot)}</td>
        <td>${fDs(d[h.bo].time)}</td><td class="n ${h.volRatio >= 1.5 ? 't-ok' : 't-warn'}">${h.volRatio ? pc(h.volRatio - 1, 0) : '—'}</td><td class="n">${h.addOn ? 'add-on' : h.stage}</td>
        <td>${h.failed ? html`<span class="t-bad">Failed ${fDs(d[h.failed].time)}</span>` : h.stopped ? html`<span class="t-bad">Stopped −8%</span> <span class="muted">after ${pc(h.best, 0)}</span>` : h.open ? html`<span class="t-ok">${pc(h.best, 0)} so far</span>` : html`<span class="${h.best >= 0.2 ? 't-ok' : 't-warn'}">${pc(h.best, 0)} best</span>`}</td>
        <td class="small" style="white-space:normal;min-width:220px">${sellCell(h)}</td></tr>`)}
    </tbody></table></div>
    <p class="muted tiny" style="margin:0">Result = best gain within 13 weeks of the breakout, unless the 8% stop was hit first. Sell signal = the first sell by the book's rules if bought at the buy point (also marked on the chart). "Failed" = closed 2%+ back under the buy point within 5 weeks. Tap a row to see it on the chart.</p>`
    : html`<p class="muted small" style="margin:0">No breakouts detected in the loaded history.</p>`}`);
  $$('#cHist tr.click').forEach(tr => {
    tr.onclick = () => {
      const h = R.hist[+tr.dataset.i];
      if (prefs.patMode !== 'all') { prefs.patMode = 'all'; savePrefs(); draw(true); }
      V.chart.zoomDaily(h.a - 10, h.bo + 25); $('#sChartWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

/* ---------- growth checklist ---------- */
function renderCanslim() {
  const el = $('#cCanslim'); if (!el || !V.sig) return;
  const cs = V.sig.canslim, ca = V.earn ? canslimCA(V.earn) : null;
  const na = V.mkt ? ['na', 'Not used for an index.'] : ['na', V.earnErr || (provider().earnings || isDemoSym(V.sym) ? 'Loading earnings…' : 'Needs earnings from a data provider.')];
  const L = [['EPS', 'Quarter growth', ca ? ca.C : na], ['EPS', '5-year growth', ca ? ca.A : na], ['High', 'Near new high', cs.N], ['Vol', 'Demand', cs.S], ['RS', 'Leadership', cs.L], ['Funds', 'Ownership', V.mkt ? ['na', 'Not used for an index.'] : V.co ? fundsItem(V.co) : ['na', 'Loading fund ownership…']], ['Mkt', 'Market trend', cs.M]];
  render(el, html`
    <div class="card-head"><h2>Growth checklist</h2><span class="muted tiny">Tap an item for details</span></div>
    <div class="canslim">${L.map(([k, nm, [st, why]]) => html`<div class="cs ${st}" title="${why}" tabindex="0" data-why="${nm}: ${why}"><b>${k}</b><span>${nm}</span></div>`)}</div>
    <p class="small" style="margin:0" id="csWhy">${L.filter(x => x[2][0] === 'pass').length} of ${L.filter(x => x[2][0] !== 'na').length} scored items pass.</p>
    <p class="muted tiny" style="margin:0">Green = meets the classic threshold, orange = close, red = fails. A checklist, not a rating.</p>`);
  $$('.cs', el).forEach(x => { const show = () => { $('#csWhy').textContent = x.dataset.why; }; x.onclick = show; x.onfocus = show; });
}

/* ---------- drawings ---------- */
const drawings = () => (V.drawingsAll[V.sym] || []);
async function saveDrawings(list) { V.drawingsAll[V.sym] = list; if (!list.length) delete V.drawingsAll[V.sym]; await store.set('drawings', V.drawingsAll); draw(true); cards(); }
const addDrawing = d => saveDrawings([...drawings(), { ...d, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }]);

function drawList() {
  const el = $('#cDraw'), list = drawings(), lt = V.data.bars[V.data.bars.length - 1].time;
  render(el, html`<div class="card-head"><h2>Your drawings</h2><button class="btn sm" id="dAdd">${raw(ICON.pen)}Draw</button></div>
    ${list.length ? html`<div class="list">${list.map(d => html`<div class="row small"><span class="num">${d.type === 'trend' ? `Trend line ${fDs(d.t1)} → ${fDs(d.t2)} · today ${f2(lineVal(d, lt))}` : d.type === 'hline' ? `Level ${f2(d.p1)}` : d.type === 'zone' ? `Zone ${f2(Math.min(d.p1, d.p2))}–${f2(Math.max(d.p1, d.p2))}` : d.type === 'cup' ? `${d.label} from ${fDs(d.pts[0][0])} · buy point ${f2(cupPivot(d))}` : `Note “${d.label}” ${fDs(d.t1)}`}</span><button class="btn sm danger" data-del="${d.id}" aria-label="Delete drawing">${raw(ICON.trash)}</button></div>`)}</div>`
      : html`<p class="muted small" style="margin:0">None yet. Use Draw on the chart to add trend lines, levels, zones, your own cup or notes. The flags watch them for you.</p>`}`);
  $$('[data-del]', el).forEach(b => { b.onclick = () => saveDrawings(drawings().filter(x => x.id !== b.dataset.del)); });
  $('#dAdd').onclick = e => { e.stopPropagation(); $('#sChartWrap').scrollIntoView({ behavior: 'smooth', block: 'center' }); openMenu('pDraw'); };
}

const HINTS = { trend: 'Trend line: tap the first point, then the second. It extends to today.', hline: 'Level: tap the price to mark.', zone: 'Zone: tap the top, then the bottom.', note: 'Note: tap a bar, then type your note.', cup: 'Cup: tap the left-side high, the bottom, then the right-side high. Optional: handle low and handle end.' };
function setTool(t) {
  V.tool = V.tool === t ? null : t; V.pending = null; V.poly = V.tool === 'cup' ? [] : null;
  const h = $('#sHint'); if (!h) return;
  if (!V.tool) { h.hidden = true; if (V.data) draw(true); return; }
  h.hidden = false;
  render(h, html`<span>${HINTS[V.tool]}</span>${V.tool === 'cup' ? html`<button class="btn sm primary" id="hSave">Save cup</button>` : ''}<button class="btn sm" id="hCancel">Cancel</button>`);
  $('#hCancel').onclick = () => setTool(null);
  $('#hSave') && ($('#hSave').onclick = () => { if (V.poly.length < 3) { toast('Tap at least three points: left high, bottom, right high.'); return; } finishCup(); });
  draw(true);
}
function finishCup() { const pts = V.poly.slice(); V.poly = null; V.tool = null; $('#sHint').hidden = true; addDrawing({ type: 'cup', pts, label: pts.length >= 4 ? 'Your cup with handle' : 'Your cup' }); toast('Cup saved. Its buy point is now watched in the flags.'); }
function onChartClick({ time, price }) {
  if (!V.tool) return;
  const done = msg => { V.tool = null; V.pending = null; $('#sHint').hidden = true; toast(msg || 'Saved.'); };
  if (V.tool === 'hline') { addDrawing({ type: 'hline', p1: price }); return done('Level saved at ' + price + '.'); }
  if (V.tool === 'note') {
    const label = (prompt('Note text (max 40 characters)') || '').trim().slice(0, 40);
    if (label) { addDrawing({ type: 'note', t1: time, label }); done('Note saved.'); }
    return;
  }
  if (V.tool === 'cup') {
    if (V.poly.length && time <= V.poly[V.poly.length - 1][0]) { toast('Each point must be to the right of the previous one.'); return; }
    V.poly.push([time, price]); if (V.poly.length >= 5) return finishCup();
    draw(true); return;
  }
  if (!V.pending) { V.pending = { t: time, p: price }; draw(true); return; }
  const a = V.pending; V.pending = null;
  if (V.tool === 'trend') {
    if (a.t === time) { toast('Pick two different bars.'); return; }
    const [x, y] = a.t < time ? [a, { t: time, p: price }] : [{ t: time, p: price }, a];
    addDrawing({ type: 'trend', t1: x.t, p1: x.p, t2: y.t, p2: y.p }); done('Trend line saved.');
  } else { addDrawing({ type: 'zone', p1: a.p, p2: price }); done('Zone saved.'); }
}

/* ---------- toolbar menus ---------- */
function openMenu(id) {
  $$('.menu-pop').forEach(p => { if (p.id !== id) p.hidden = true; });
  const p = $('#' + id); p.hidden = !p.hidden;
  if (!p.hidden) {
    if (id === 'pLines') render(p, html`${LINE_DEFS.map(([k, l, c, w]) => html`<label><input type="checkbox" data-line="${k}" ${prefs.lines[k] ? raw('checked') : ''}><span class="sw" style="background:var(${c})"></span>${prefs.tf === 'W' && w ? w : l}</label>`)}<hr>
      <label><input type="checkbox" data-pane="rsi" ${prefs.panes.rsi ? raw('checked') : ''}>RSI pane</label><label><input type="checkbox" data-pane="macd" ${prefs.panes.macd ? raw('checked') : ''}>MACD pane</label><hr>
      <button data-style="candles" class="${prefs.style === 'candles' ? 'on' : ''}">Candles</button><button data-style="bars" class="${prefs.style === 'bars' ? 'on' : ''}">OHLC bars</button><hr>
      <label><input type="checkbox" id="lnLog" ${prefs.log !== false ? raw('checked') : ''}>Logarithmic price scale (the book's choice: equal steps are equal % moves)</label>`);
    if (id === 'pLines' && $('#lnLog', p)) $('#lnLog', p).onchange = e => { prefs.log = e.target.checked; savePrefs(); draw(true); };
    if (id === 'pCmp') {
      const opts = compareOptions(V.sym), g = group(V.sym), sel = prefs.cmp[g] || [], rs = prefs.rsBench[g] || defaultBenchmark(V.sym);
      const custom = sel.filter(x => !opts.some(o => o.id === x));
      const grp = [...new Set(opts.map(o => o.group))];
      render(p, html`<div class="menu-title">Plot against (up to 3)</div>
        ${grp.map(gr => html`${grp.length > 1 ? html`<div class="menu-sub">${gr}</div>` : ''}${opts.filter(o => o.group === gr).map(o => html`<label><input type="checkbox" data-cmp="${o.id}" ${sel.includes(o.id) ? raw('checked') : ''}>${sel.includes(o.id) ? html`<span class="sw" style="background:var(${CMP_COLORS[sel.indexOf(o.id) % 3]})"></span>` : ''}${o.name}</label>`)}`)}
        ${custom.map(t => html`<label><input type="checkbox" data-cmp="${t}" checked>${t}</label>`)}
        <form class="menu-form" id="cmpForm"><input class="input" id="cmpIn" placeholder="Other ticker, e.g. SMH or ^GDAXI" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="btn sm" type="submit">Add</button></form>
        <hr><div class="menu-title">RS line measured against</div>
        <select class="input" id="rsSel" style="margin:2px 8px 6px;width:calc(100% - 16px)">${opts.filter(o => o.group === 'Indexes').map(o => html`<option value="${o.id}" ${o.id === rs ? raw('selected') : ''}>${o.name}</option>`)}</select>
        <p class="muted tiny" style="margin:0 10px 6px">Lines are rebased to the stock's price at the left edge of the chart, so you compare performance over the period you see. Index data needs a plan that includes it; otherwise a tracking ETF is used.</p>`);
      const setSel = list => { prefs.cmp[g] = list.slice(0, 3); savePrefs(); loadCompare(V.sym, V.seq); openMenu('pCmp'); openMenu('pCmp'); };
      $$('[data-cmp]', p).forEach(x => { x.onchange = () => { const l = (prefs.cmp[g] || []).filter(v => v !== x.dataset.cmp); if (x.checked) { if (l.length >= 3) { toast('Up to three comparisons at a time.'); x.checked = false; return; } l.push(x.dataset.cmp); } setSel(l); }; });
      $('#cmpForm', p).onsubmit = e => { e.preventDefault(); const t = $('#cmpIn', p).value.toUpperCase().trim().replace(/[^A-Z0-9.\-^]/g, ''); if (!t) return; const l = (prefs.cmp[g] || []).filter(v => v !== t); if (l.length >= 3) { toast('Up to three comparisons at a time.'); return; } setSel([...l, t]); };
      $('#rsSel', p).onchange = async () => { prefs.rsBench[g] = $('#rsSel', p).value; savePrefs(); V.bench = await benchmarkFor(V.sym, prefs.rsBench[g], { long: true }).catch(() => V.bench); draw(true); cards(); toast('RS line now measured against ' + (V.bench ? V.bench.name : 'the index') + '.'); };
    }
    if (id === 'pEps') {
      render(p, html`${[['ttm', '4-quarter EPS (trailing 12 months)'], ['q', 'Quarterly EPS'], ['off', 'Hide EPS line']].map(([k, l]) => html`<button data-eps="${k}" class="${prefs.eps === k ? 'on' : ''}">${l}</button>`)}
        ${provider().id === 'free' && isApp() ? html`<hr>${[['long', 'Longest history (US: SEC filings since ~2009)'], ['adjusted', 'Adjusted EPS only (analyst basis, fewer stocks)']].map(([k, l]) => html`<button data-basis="${k}" class="${settings.epsBasis === k ? 'on' : ''}">${l}</button>`)}` : ''}
        <p class="muted tiny" style="margin:4px 10px 6px">Smooth line on the left axis; a dot marks each report: <b style="color:var(--up)">●</b> EPS up 20%+ y/y, <b style="color:var(--warn)">●</b> up less, <b style="color:var(--down)">●</b> down. ${V.earn ? '' : V.earnErr || 'Earnings data not loaded yet.'}</p>`);
      $$('[data-eps]', p).forEach(x => { x.onclick = () => { prefs.eps = x.dataset.eps; savePrefs(); draw(true); p.hidden = true; }; });
      $$('[data-basis]', p).forEach(x => { x.onclick = async () => { settings.epsBasis = x.dataset.basis; await saveSettings(); p.hidden = true; V.earn = null; V.earnErr = null; cards(); loadEarnings(V.sym, V.seq); }; });
    }
    if (id === 'pPat') render(p, html`${[['all', 'Current + all past patterns'], ['cur', 'Current base only'], ['off', 'Hide patterns']].map(([k, l]) => html`<button data-pm="${k}" class="${prefs.patMode === k ? 'on' : ''}">${l}</button>`)}<hr>
      <div class="pat-legend" style="padding:6px 10px">${Object.entries(PAT_LABEL).map(([k, l]) => html`<span><i style="background:${patColor(k)}"></i>${l}</span>`)}</div><hr>
      <label><input type="checkbox" id="pmSells" ${prefs.sells !== false ? raw('checked') : ''}><span>Show sell signals (book rules)</span></label>
      <p class="muted tiny" style="margin:4px 10px 6px">For each breakout, bought at the buy point: the first sell signal (stop 8% under the buy price, raised stop at +15%, breakeven after +20%, climax top, 70% over the 200-day, heavy-volume 50-day break, profit at +20–25% with the 8-week rule). Open breakouts show the current sell line and targets.</p>`);
    if (id === 'pPat' && $('#pmSells', p)) $('#pmSells', p).onchange = e => { prefs.sells = e.target.checked; savePrefs(); draw(true); };
    if (id === 'pDraw') render(p, html`${[['trend', 'Trend line'], ['hline', 'Level'], ['zone', 'Zone'], ['cup', 'Cup ◡ (your own base)'], ['note', 'Note']].map(([k, l]) => html`<button data-tool="${k}">${l}</button>`)}<hr><button data-undo>Undo last drawing</button>`);
    $$('[data-line]', p).forEach(x => { x.onchange = () => { prefs.lines[x.dataset.line] = x.checked; savePrefs(); draw(true); }; });
    $$('[data-pane]', p).forEach(x => { x.onchange = () => { prefs.panes[x.dataset.pane] = x.checked; savePrefs(); V.chart.setPanes(prefs.panes); }; });
    $$('[data-style]', p).forEach(x => { x.onclick = () => { prefs.style = x.dataset.style; savePrefs(); V.chart.setStyle(prefs.style); p.hidden = true; }; });
    $$('[data-pm]', p).forEach(x => { x.onclick = () => { prefs.patMode = x.dataset.pm; savePrefs(); draw(true); p.hidden = true; }; });
    $$('[data-tool]', p).forEach(x => { x.onclick = () => { setTool(x.dataset.tool); p.hidden = true; }; });
    $$('[data-undo]', p).forEach(x => { x.onclick = () => { const l = drawings(); if (l.length) saveDrawings(l.slice(0, -1)); p.hidden = true; }; });
  }
}

function wireTools() {
  $$('[data-tf]').forEach(b => { b.onclick = () => { intra(null); prefs.tf = b.dataset.tf; savePrefs(); draw(false); }; });
  $$('[data-it]').forEach(b => { b.onclick = () => intra(b.dataset.it); });
  $('#mLines').onclick = e => { e.stopPropagation(); openMenu('pLines'); };
  $('#mPat').onclick = e => { e.stopPropagation(); openMenu('pPat'); };
  $('#mCmp').onclick = e => { e.stopPropagation(); openMenu('pCmp'); };
  $('#mEps').onclick = e => { e.stopPropagation(); openMenu('pEps'); };
  $('#mDraw').onclick = e => { e.stopPropagation(); openMenu('pDraw'); };
  $$('.menu-pop').forEach(p => p.addEventListener('click', e => e.stopPropagation()));
  document.addEventListener('click', () => $$('.menu-pop').forEach(p => { p.hidden = true; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && V.tool) setTool(null); });
  // flip through the watchlist: ↓/J next, ↑/K previous (like paging through charts)
  document.addEventListener('keydown', e => {
    if (App.view !== 'chart' || /input|textarea|select/i.test(document.activeElement.tagName) || !$('#sheet').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
    if (!dir || !App.watch.length) return;
    e.preventDefault();
    const i = App.watch.indexOf(V.sym), next = App.watch[((i < 0 ? -1 : i) + dir + App.watch.length) % App.watch.length];
    openStock(next);
  });
  $$('#sSpan [data-span]').forEach(b => { b.onclick = () => { const m = +b.dataset.span; V.chart.span(m); $$('#sSpan [data-span]').forEach(x => x.classList.toggle('on', x === b)); }; });
  $('#sRefresh').onclick = () => { if (App.sym) load(App.sym, true); };
  $('#sWatch').onclick = () => { if (V.sym) listMenu(V.sym); };
  $('#sPlan').onclick = () => {
    if (!V.data) return;
    const B = baseState(V.R, V.data.bars), p = B.p && B.p.pivot ? B.p : null;
    planSheet({ sym: V.sym, name: V.data.name, cur: V.data.currency, bars: V.data.bars, pivot: p ? +p.pivot.toFixed(2) : null, baseName: p ? p.name : '', onChange: () => loadPlan(V.sym, V.seq) });
  };
  on(type => { if ((type === 'plans' || type === 'trades' || type === 'journal') && V.sym) loadPlan(V.sym, V.seq); });
  $('#sAlert').onclick = () => {
    if (!V.data) return;
    const d = V.data.bars, B = baseState(V.R, d), p = B.p && B.p.pivot ? B.p : null;
    const hold = (App.holdings || []).find(h => h.sym === V.sym && h.cost);
    alertSheet({ sym: V.sym, name: V.data.name, close: d[d.length - 1].close, cur: V.data.currency,
      pivot: p && !B.bo ? +p.pivot.toFixed(2) : null, baseName: p ? p.name : '',
      stop: hold ? +(hold.cost * 0.92).toFixed(2) : p ? +(p.pivot * 0.92).toFixed(2) : null, stopFrom: hold ? 'your cost' : 'the buy point' });
  };
}
