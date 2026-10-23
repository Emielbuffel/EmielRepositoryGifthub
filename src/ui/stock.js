// The Chart tab: one stock with its chart (EPS line, index comparisons, every detected pattern), the base card,
// signal, earnings, CAN SLIM, news, flags, key numbers, base history and the user's drawings.
import PAT from '../core/pat.js';
import { baseCard, signal, pc, fD, fDs, f2, lineVal, cupPivot } from '../core/analysis.js';
import { daily, benchmarkFor, indexSeries, compareOptions, defaultBenchmark, earnings, isIndexSym, provider, isDemo, isDemoSym, DataError } from '../data/service.js';
import { splitSym } from '../data/providers.js';
import { stockNews, lastSeen, markSeen, newsSettings } from '../data/news.js';
import { enrich, epsPoints, nextReport, canslimCA, adGrade } from '../core/earnings.js';
import { analyseIndex, STATUS, EXPOSURE } from '../core/market.js';
import * as store from '../data/store.js';
import { App, on, openStock, saveWatch, rememberName, rememberQuote, go } from '../app.js';
import { StockChart, patternsToShow, outcome, PAT_LABEL, patColor, CMP_COLORS } from './chart.js';
import { tok } from './dom.js';
import { $, $$, html, raw, render, esc, money, ICON, toast, ago } from './dom.js';

const V = { chart: null, S: null, data: null, bench: null, R: null, seq: 0, tool: null, pending: null, poly: null, drawingsAll: {}, earn: null, earnErr: null, news: null, newsSeen: 0, newsTag: 'all', cmp: [], mkt: null };
const LINE_DEFS = [['l1', '10-day', '--ma1', '2-week'], ['l2', '21-day EMA', '--ma2', '4-week EMA'], ['l3', '50-day', '--ma3', '10-week'], ['l4', '200-day', '--ma4', '40-week'], ['rs', 'RS line', '--rs'], ['bb', 'Bollinger bands', '--muted']];
let prefs = { tf: 'D', style: 'candles', lines: { l1: false, l2: true, l3: true, l4: true, rs: true, bb: false }, patMode: 'all', panes: { rsi: false, macd: false }, eps: 'ttm', cmp: {}, rsBench: {} };
// comparison choices and the RS benchmark are remembered per market (US, .DE, .T …)
const group = sym => isDemoSym(sym) ? 'demo' : splitSym(sym).sfx || 'US';

export async function initStock(el) {
  prefs = Object.assign(prefs, await store.get('chartPrefs', {}));
  if (window.innerWidth >= 900 && !(await store.get('chartPrefs', null))) prefs.panes = { rsi: true, macd: true };
  V.drawingsAll = await store.get('drawings', {});
  render(el, html`
    <div class="stock-head">
      <div class="stock-id">
        <div class="sym"><b id="sSym">—</b><span id="sName"></span></div>
        <div class="px"><span class="p" id="sPx">—</span><span class="ch" id="sCh"></span></div>
        <div class="status"><span class="dot" id="sDot"></span><span id="sStatus">Loading…</span></div>
      </div>
      <div class="toolbar">
        <button class="btn" id="sWatch"></button>
        <button class="btn" id="sRefresh" aria-label="Refresh prices">${raw(ICON.refresh)}<span>Refresh</span></button>
      </div>
    </div>
    <div class="chips" id="sChips" aria-label="Watchlist"></div>
    <section class="card chart-card">
      <div class="chart-tools">
        <div class="seg" role="group" aria-label="Time frame"><button data-tf="D">Daily</button><button data-tf="W">Weekly</button></div>
        <div class="menu"><button class="btn sm" id="mLines">${raw(ICON.layers)}Lines</button><div class="menu-pop" id="pLines" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mCmp">Compare</button><div class="menu-pop" id="pCmp" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mEps">EPS</button><div class="menu-pop" id="pEps" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mPat">Patterns</button><div class="menu-pop" id="pPat" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mDraw">${raw(ICON.pen)}Draw</button><div class="menu-pop" id="pDraw" hidden></div></div>
        <span class="spacer"></span>
        <button class="btn sm" id="sFit" title="Show the whole history">${raw(ICON.expand)}All</button>
      </div>
      <div class="chart-wrap" id="sChartWrap"><div class="chart-legend" id="sLegend"></div><div id="sChart" style="position:absolute;inset:0"></div></div>
      <div class="chart-hint" id="sHint" hidden></div>
      <div class="pat-strip" id="sPats" aria-label="Patterns on this chart"></div>
    </section>
    <section class="card" id="cMkt" hidden></section>
    <div class="grid2">
      <section class="card" id="cBase"></section>
      <section class="card" id="cSig"></section>
    </div>
    <div class="grid2">
      <section class="card" id="cEarn"></section>
      <section class="card" id="cCanslim"></section>
    </div>
    <div class="grid2">
      <section class="card" id="cNews"></section>
      <section class="card" id="cFlags"></section>
    </div>
    <section class="card" id="cHist"></section>
    <div class="grid2">
      <section class="card" id="cNums"></section>
      <section class="card" id="cDraw"></section>
    </div>
    <p class="disclaimer">Educational analysis using William O'Neil's published rules of thumb. Not investment advice. End-of-day data; check prices with your broker before acting.</p>
  `);
  V.chart = new StockChart($('#sChart'), $('#sLegend'));
  V.chart.panes = { ...prefs.panes }; V.chart.style = prefs.style; V.chart.build();
  V.chart.clickCb = onChartClick;
  wireTools();
  on((type) => {
    if (type === 'stock') load(App.sym);
    if (type === 'watch' || type === 'quote') chips();
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
    const [d, bench] = await Promise.all([daily(sym, { force }), benchmarkFor(sym, prefs.rsBench[g]).catch(() => null)]);
    if (seq !== V.seq) return;
    // an index has no RS line against itself
    V.data = d; V.bench = bench && bench.sym !== sym ? bench : null; V.sym = sym; V.earn = null; V.earnErr = null; V.news = null; V.cmp = [];
    if (d.name) await rememberName(sym, d.name);
    V.R = PAT.scan(d.bars);
    V.mkt = isIndexSym(sym) ? analyseIndex(d.bars) : null;
    const n = d.bars.length - 1;
    await rememberQuote(sym, d.bars[n].close, d.bars[n].close / d.bars[n - 1].close - 1);
    head(); draw(false); cards();
    const src = isDemoSym(sym) ? 'Demo data · fictional ' + (isIndexSym(sym) ? 'index' : 'company') : provider().short;
    const dt = fD(d.bars[n].time);
    if (d.stale) status(`Showing saved prices through ${dt}: ${d.error ? d.error.message : 'refresh failed'}`, 'warn');
    else status(`${src} · daily data through ${dt}${d.cached && !isDemoSym(sym) ? ' · updated ' + ago(d.fetchedAt) : ''}`, isDemoSym(sym) ? 'demo' : 'ok');
    loadCompare(sym, seq);
    if (!V.mkt) loadEarnings(sym, seq); else earnCard();
    loadNews(sym, seq);
  } catch (e) {
    if (seq !== V.seq) return;
    status(e.message || String(e), 'warn');
    if (!V.data || V.data.sym !== sym) emptyState(sym, e);
  }
}

async function loadCompare(sym, seq) {
  const ids = (prefs.cmp[group(sym)] || []).filter(id => id !== '__none');
  const res = await Promise.all(ids.map(id => indexSeries(id, isDemo() || isDemoSym(sym)).then(x => ({ ...x, short: shortName(x.name) })).catch(() => null)));
  if (seq !== V.seq) return;
  V.cmp = res.filter(x => x && x.sym !== sym).map(x => ({ ...x, bars: x.bars.map(b => ({ time: b.time, close: b.close })) }));
  if (ids.length && V.cmp.length < ids.length) toast('Some comparison data is not available on your plan.');
  if (V.cmp.length || ids.length === 0) draw(true);
}
const shortName = n => n.replace(/\s*\(.*\)\s*/, '').replace(' (fictional index)', '');

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
  ['#cBase', '#cSig', '#cCanslim', '#cFlags', '#cHist', '#cNums', '#cDraw', '#cEarn', '#cNews'].forEach(id => { $(id).innerHTML = ''; });
  $('#cMkt').hidden = true;
  render($('#cBase'), html`<div class="empty">${raw(ICON.info)}${msg}</div>`);
  $('#eSet') && ($('#eSet').onclick = () => go('settings'));
  $('#eDemo') && ($('#eDemo').onclick = () => openStock('ACME.DEMO'));
  $('#sPats').innerHTML = '';
}

function status(t, cls) { $('#sStatus').textContent = t; $('#sDot').className = 'dot ' + (cls || ''); }
const fp = x => money(x, V.data ? V.data.currency : 'USD');

function head() {
  const d = V.data.bars, n = d.length - 1, p = d[n].close, ch = p - d[n - 1].close;
  $('#sSym').textContent = V.sym; $('#sName').textContent = V.data.name || App.names[V.sym] || '';
  $('#sPx').textContent = fp(p);
  const e = $('#sCh'); e.textContent = (ch >= 0 ? '+' : '−') + money(Math.abs(ch), V.data.currency).replace(/^[^\d]*/, '') + ' (' + pc(ch / d[n - 1].close, 2) + ')';
  e.className = 'ch ' + (ch >= 0 ? 'up' : 'down');
  const w = App.watch.includes(V.sym);
  render($('#sWatch'), html`${raw(w ? ICON.starFill : ICON.star)}<span>${w ? 'In watchlist' : 'Watch'}</span>`);
}

function chips() {
  const el = $('#sChips'); if (!el) return;
  render(el, html`${App.watch.map(s => { const q = App.last[s]; return html`<button class="chip${s === App.sym ? ' on' : ''}" data-s="${s}">${s.replace('.DEMO', '')}${q ? html`<span class="c ${q.ch >= 0 ? 'up' : 'down'}">${pc(q.ch, 1)}</span>` : ''}</button>`; })}`);
  $$('.chip', el).forEach(b => { b.onclick = () => openStock(b.dataset.s); });
}

function chartState() {
  return {
    sym: V.sym, daily: V.data.bars, bench: V.bench ? V.bench.bars : null, R: V.R, tf: prefs.tf, lines: prefs.lines, patMode: prefs.patMode,
    drawings: drawings(), cur: V.data.currency, pending: V.pending, poly: V.poly, mkt: V.mkt, compare: V.cmp,
    eps: prefs.eps !== 'off' && V.earn ? { mode: prefs.eps, points: epsPoints(V.earn, prefs.eps) } : null,
  };
}
function draw(keep) {
  if (!V.data) return;
  V.chart.update(chartState(), keep);
  $$('[data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === prefs.tf));
  patStrip();
}
const savePrefs = () => store.set('chartPrefs', prefs);

/* ---------- patterns strip: every detected pattern, tap to zoom ---------- */
function patStrip() {
  const d = V.data.bars, list = patternsToShow(V.R, d, 'all');
  const el = $('#sPats');
  if (!list.length) { render(el, html`<span class="muted small">No base patterns found in this history. ${V.R.cur.length ? '' : "That itself is information: O'Neil only buys from proper bases."}</span>`); return; }
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
    if (days >= 0 && days <= 21) S.flags.unshift(['warn', `Earnings in ${days} day${days === 1 ? '' : 's'} (${fD(nx.time)}). O'Neil avoids new buys right before a report; a gap can wipe out a breakout.`]);
  }
  const lastQ = enrich(V.earn || []).pop();
  if (lastQ && d[n].time - lastQ.time < 6 * 86400) S.flags.unshift([lastQ.yoy >= 0.25 ? 'bull' : lastQ.yoy < 0 ? 'bear' : 'info', `Results just in: EPS ${f2(lastQ.eps)}${lastQ.yoy != null ? ' (' + pc(lastQ.yoy, 0) + ' y/y)' : ''}${lastQ.surprise != null ? ', ' + pc(lastQ.surprise, 0) + ' vs estimate' : ''}.`]);
  if (S.flags.length > 1) S.flags = S.flags.filter(f => f[1] !== 'Nothing new today.');
  const ad = adGrade(d);
  let dv = 0; for (let i = Math.max(0, n - 49); i <= n; i++) dv += d[i].close * d[i].volume; dv /= Math.min(50, n + 1);
  S.nums.splice(7, 0, ['A/D grade, 13 weeks (approx.)', ad ? ad.grade + ' · ratio ' + ad.ratio.toFixed(2) : '—'], ['Avg daily value traded (50d)', bigNum(dv, V.data.currency)]);
  if (nx) S.nums.push(['Next earnings', fD(nx.time)]);
  if (V.mkt) mktCard(); else $('#cMkt').hidden = true;
  render($('#cBase'), html`
    <div class="card-head"><h2>Base pattern · O'Neil rules</h2>${B.p ? html`<span class="tag" style="color:${patColor(B.p.type)}">${PAT_LABEL[B.p.type] || ''}</span>` : ''}</div>
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
    <p class="muted tiny" style="margin:0">A checklist of O'Neil's rules, not advice.</p>`);
  const lab = { bull: ['Bullish', 't-ok'], bear: ['Bearish', 't-bad'], warn: ['Caution', 't-warn'], info: ['Watch', 't-mute'] };
  render($('#cFlags'), html`<h2>Flags right now</h2><ul class="flags">${S.flags.map(([l, t]) => html`<li><span class="tag ${lab[l][1]}">${lab[l][0]}</span><span>${t}</span></li>`)}</ul>`);
  render($('#cNums'), html`<h2>Key numbers</h2><div class="kv">${S.nums.map(([a, b]) => html`<div><span>${a}</span><span class="num">${b}</span></div>`)}</div>
    ${V.bench ? html`<p class="muted tiny" style="margin:0">RS line vs ${V.bench.name}.</p>` : ''}`);
  histCard(); renderCanslim(); earnCard(); drawList();
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

/* ---------- earnings (MarketSurge-style datagraph) ---------- */
function earnCard() {
  const el = $('#cEarn'); if (!el || !V.data) return;
  if (V.mkt) { render(el, html`<h2>Earnings</h2><p class="muted small" style="margin:0">Indexes have no earnings line here. Use Compare to set this index against others.</p>`); return; }
  if (!V.earn) {
    const P = provider(), msg = V.earnErr ? V.earnErr : isDemoSym(V.sym) || P.earnings ? 'Loading earnings…' : 'Earnings come with a data provider (FMP, Twelve Data or EODHD).';
    render(el, html`<h2>Earnings</h2><p class="muted small" style="margin:0">${msg}</p>`); return;
  }
  const q = enrich(V.earn), nx = nextReport(V.earn), last8 = q.slice(-8);
  const cls = x => x == null ? '' : x >= 0.25 ? 't-ok' : x < 0 ? 't-bad' : 't-warn';
  const ttm = q.filter(r => r.ttm != null);
  render(el, html`<div class="card-head"><h2>Earnings · quarter by quarter</h2>${nx ? html`<span class="tag t-blue">Next report ${fDs(nx.time)}${nx.est != null ? ' · est. ' + f2(nx.est) : ''}</span>` : ''}</div>
    ${last8.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Reported</th><th class="n">EPS</th><th class="n">vs yr ago</th><th class="n">vs est.</th><th class="n">Sales vs yr ago</th><th class="n">4Q EPS</th></tr></thead><tbody>
      ${[...last8].reverse().map(r => html`<tr><td>${fDs(r.time)}${r.period ? html` <span class="muted tiny">${r.period}</span>` : ''}</td><td class="n">${f2(r.eps)}</td><td class="n ${cls(r.yoy)}">${pc(r.yoy, 0)}</td><td class="n ${r.surprise == null ? '' : r.surprise >= 0 ? 't-ok' : 't-bad'}">${pc(r.surprise, 0)}</td><td class="n ${cls(r.revYoy)}">${pc(r.revYoy, 0)}</td><td class="n">${f2(r.ttm)}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted small" style="margin:0">No reported quarters.</p>`}
    ${ttm.length >= 2 ? html`<p class="small" style="margin:0">4-quarter EPS ${f2(ttm[ttm.length - 1].ttm)}, ${ttm.length >= 5 ? pc(ttm[ttm.length - 1].ttm / ttm[ttm.length - 5].ttm - 1, 0) + ' vs a year ago' : ''}. On the chart, the <b style="color:var(--eps)">EPS line</b> uses the left axis; dots mark each report (green = EPS up 25%+ y/y, orange = up less, red = down).</p>` : ''}
    <p class="muted tiny" style="margin:0">Source: ${isDemoSym(V.sym) ? 'fictional demo figures' : provider().name}. EPS as the provider reports it (usually adjusted/non-GAAP for estimates).</p>`);
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
    })}</div>` : html`<p class="muted small" style="margin:0">${loading ? 'Checking the news sources…' : r && r.browserBlocked ? 'News feeds load in the iPhone, iPad and Mac app. Web browsers block these feeds for security (CORS).' : 'No recent headlines from the enabled sources.'}</p>`}
    <p class="muted tiny" style="margin:0">${r && r.demo ? 'Example headlines for a fictional company.' : `Checked ${r ? ago(r.at) : '…'} from ${Object.entries(newsSettings().sources).filter(([, v]) => v).length} free sources${newsSettings().hidePaywalled ? ', paywalled sites hidden' : ''}${r && r.errors && r.errors.length && !r.browserBlocked ? ` · not reachable now: ${r.errors.join(', ')}` : ''}. Headlines link to the original site.`}</p>`);
  $('#nRef').onclick = () => loadNews(V.sym, V.seq);
  $$('[data-tag]', el).forEach(b => { b.onclick = () => { V.newsTag = b.dataset.tag; newsCard(false); }; });
}

function histCard() {
  const R = V.R, d = V.data.bars;
  render($('#cHist'), html`
    <div class="card-head"><h2>Base history · every breakout found</h2><span class="muted tiny">${R.hist.length} breakout${R.hist.length === 1 ? '' : 's'}</span></div>
    ${R.hist.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pattern</th><th>Base</th><th class="n">Weeks</th><th class="n">Depth</th><th class="n">Buy point</th><th>Breakout</th><th class="n">Volume</th><th class="n">Stage</th><th>What happened</th></tr></thead><tbody>
      ${[...R.hist].reverse().map((h, i) => html`<tr class="click" data-i="${R.hist.length - 1 - i}">
        <td><span class="tag" style="color:${patColor(h.type)}">${h.faulty ? 'faulty' : h.type}</span> ${h.name.replace(' (faulty)', '')}</td>
        <td>${fDs(d[h.a].time)} – ${fDs(d[h.e].time)}</td><td class="n">${Math.round(h.weeks)}</td><td class="n">−${Math.round(h.depth * 100)}%</td><td class="n">${f2(h.pivot)}</td>
        <td>${fDs(d[h.bo].time)}</td><td class="n ${h.volRatio >= 1.4 ? 't-ok' : 't-warn'}">${h.volRatio ? pc(h.volRatio - 1, 0) : '—'}</td><td class="n">${h.addOn ? 'add-on' : h.stage}</td>
        <td>${h.failed ? html`<span class="t-bad">Failed ${fDs(d[h.failed].time)}</span>` : h.stopped ? html`<span class="t-bad">Stopped −8%</span> <span class="muted">after ${pc(h.best, 0)}</span>` : h.open ? html`<span class="t-ok">${pc(h.best, 0)} so far</span>` : html`<span class="${h.best >= 0.2 ? 't-ok' : 't-warn'}">${pc(h.best, 0)} best</span>`}</td></tr>`)}
    </tbody></table></div>
    <p class="muted tiny" style="margin:0">Result = best gain within 13 weeks of the breakout, unless the 8% stop was hit first. "Failed" = closed 2%+ back under the buy point within 5 weeks. Tap a row to see it on the chart.</p>`
    : html`<p class="muted small" style="margin:0">No breakouts detected in the loaded history.</p>`}`);
  $$('#cHist tr.click').forEach(tr => {
    tr.onclick = () => {
      const h = R.hist[+tr.dataset.i];
      if (prefs.patMode !== 'all') { prefs.patMode = 'all'; savePrefs(); draw(true); }
      V.chart.zoomDaily(h.a - 10, h.bo + 25); $('#sChartWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

/* ---------- CAN SLIM ---------- */
function renderCanslim() {
  const el = $('#cCanslim'); if (!el || !V.sig) return;
  const cs = V.sig.canslim, ca = V.earn ? canslimCA(V.earn) : null;
  const na = V.mkt ? ['na', 'Not used for an index.'] : ['na', V.earnErr || (provider().earnings || isDemoSym(V.sym) ? 'Loading earnings…' : 'Needs earnings from a data provider.')];
  const L = [['C', 'Quarter EPS', ca ? ca.C : na], ['A', 'Annual EPS', ca ? ca.A : na], ['N', 'New high', cs.N], ['S', 'Demand', cs.S], ['L', 'Leader', cs.L], ['I', 'Funds', ['na', 'Not scored: needs fund-ownership data.']], ['M', 'Market', cs.M]];
  render(el, html`
    <div class="card-head"><h2>CAN SLIM checklist</h2><span class="muted tiny">Tap a letter for details</span></div>
    <div class="canslim">${L.map(([k, nm, [st, why]]) => html`<div class="cs ${st}" title="${why}" tabindex="0" data-why="${k}: ${why}"><b>${k}</b><span>${nm}</span></div>`)}</div>
    <p class="small" style="margin:0" id="csWhy">${L.filter(x => x[2][0] !== 'na').length}/7 letters scored. ${L.filter(x => x[2][0] === 'pass').map(x => x[0]).join(' ') || 'None'} pass.</p>
    <p class="muted tiny" style="margin:0">Green = meets O'Neil's threshold, orange = close, red = fails. A checklist, not a rating.</p>`);
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
      <button data-style="candles" class="${prefs.style === 'candles' ? 'on' : ''}">Candles</button><button data-style="bars" class="${prefs.style === 'bars' ? 'on' : ''}">OHLC bars</button>`);
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
      $('#rsSel', p).onchange = async () => { prefs.rsBench[g] = $('#rsSel', p).value; savePrefs(); V.bench = await benchmarkFor(V.sym, prefs.rsBench[g]).catch(() => V.bench); draw(true); cards(); toast('RS line now measured against ' + (V.bench ? V.bench.name : 'the index') + '.'); };
    }
    if (id === 'pEps') {
      render(p, html`${[['ttm', '4-quarter EPS line (like MarketSurge)'], ['q', 'Quarterly EPS'], ['off', 'Hide EPS line']].map(([k, l]) => html`<button data-eps="${k}" class="${prefs.eps === k ? 'on' : ''}">${l}</button>`)}
        <p class="muted tiny" style="margin:4px 10px 6px">Smooth line on the left axis; a dot marks each report: <b style="color:var(--up)">●</b> EPS up 25%+ y/y, <b style="color:var(--warn)">●</b> up less, <b style="color:var(--down)">●</b> down. ${V.earn ? '' : V.earnErr || 'Earnings data not loaded yet.'}</p>`);
      $$('[data-eps]', p).forEach(x => { x.onclick = () => { prefs.eps = x.dataset.eps; savePrefs(); draw(true); p.hidden = true; }; });
    }
    if (id === 'pPat') render(p, html`${[['all', 'Current + all past patterns'], ['cur', 'Current base only'], ['off', 'Hide patterns']].map(([k, l]) => html`<button data-pm="${k}" class="${prefs.patMode === k ? 'on' : ''}">${l}</button>`)}<hr>
      <div class="pat-legend" style="padding:6px 10px">${Object.entries(PAT_LABEL).map(([k, l]) => html`<span><i style="background:${patColor(k)}"></i>${l}</span>`)}</div>`);
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
  $$('[data-tf]').forEach(b => { b.onclick = () => { prefs.tf = b.dataset.tf; savePrefs(); draw(false); }; });
  $('#mLines').onclick = e => { e.stopPropagation(); openMenu('pLines'); };
  $('#mPat').onclick = e => { e.stopPropagation(); openMenu('pPat'); };
  $('#mCmp').onclick = e => { e.stopPropagation(); openMenu('pCmp'); };
  $('#mEps').onclick = e => { e.stopPropagation(); openMenu('pEps'); };
  $('#mDraw').onclick = e => { e.stopPropagation(); openMenu('pDraw'); };
  $$('.menu-pop').forEach(p => p.addEventListener('click', e => e.stopPropagation()));
  document.addEventListener('click', () => $$('.menu-pop').forEach(p => { p.hidden = true; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && V.tool) setTool(null); });
  $('#sFit').onclick = () => V.chart.fit();
  $('#sRefresh').onclick = () => { if (App.sym) load(App.sym, true); };
  $('#sWatch').onclick = () => {
    const l = App.watch.slice(), i = l.indexOf(V.sym);
    if (i >= 0) l.splice(i, 1); else l.push(V.sym);
    saveWatch(l); head(); toast(i >= 0 ? `Removed ${V.sym} from your watchlist.` : `Added ${V.sym} to your watchlist.`);
  };
}
