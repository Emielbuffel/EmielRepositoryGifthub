// The Chart tab: one stock with its chart, every detected pattern, the base card, signal, CAN SLIM,
// fundamentals, flags, key numbers, base history and the user's drawings.
import PAT from '../core/pat.js';
import { baseCard, signal, pc, fD, fDs, f2, lineVal, cupPivot } from '../core/analysis.js';
import { daily, benchmarkFor, fundamentals, provider, isDemo, isDemoSym, DataError } from '../data/service.js';
import * as store from '../data/store.js';
import { App, on, openStock, saveWatch, rememberName, rememberQuote, go } from '../app.js';
import { StockChart, patternsToShow, outcome, PAT_LABEL, patColor } from './chart.js';
import { $, $$, html, raw, render, esc, money, ICON, toast, ago } from './dom.js';

const V = { chart: null, S: null, data: null, bench: null, R: null, seq: 0, tool: null, pending: null, poly: null, drawingsAll: {}, fund: null };
const LINE_DEFS = [['l1', '10-day', '--ma1', '2-week'], ['l2', '21-day EMA', '--ma2', '4-week EMA'], ['l3', '50-day', '--ma3', '10-week'], ['l4', '200-day', '--ma4', '40-week'], ['rs', 'RS line', '--rs'], ['bb', 'Bollinger bands', '--muted']];
let prefs = { tf: 'D', style: 'candles', lines: { l1: false, l2: true, l3: true, l4: true, rs: true, bb: false }, patMode: 'all', panes: { rsi: false, macd: false } };

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
        <div class="menu"><button class="btn sm" id="mPat">Patterns</button><div class="menu-pop" id="pPat" hidden></div></div>
        <div class="menu"><button class="btn sm" id="mDraw">${raw(ICON.pen)}Draw</button><div class="menu-pop" id="pDraw" hidden></div></div>
        <span class="spacer"></span>
        <button class="btn sm" id="sFit" title="Show the whole history">${raw(ICON.expand)}All</button>
      </div>
      <div class="chart-wrap" id="sChartWrap"><div class="chart-legend" id="sLegend"></div><div id="sChart" style="position:absolute;inset:0"></div></div>
      <div class="chart-hint" id="sHint" hidden></div>
      <div class="pat-strip" id="sPats" aria-label="Patterns on this chart"></div>
    </section>
    <div class="grid2">
      <section class="card" id="cBase"></section>
      <section class="card" id="cSig"></section>
    </div>
    <div class="grid2">
      <section class="card" id="cCanslim"></section>
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
    if (type === 'provider') { V.fund = null; load(App.sym); }
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
    const [d, bench] = await Promise.all([daily(sym, { force }), benchmarkFor(sym).catch(() => null)]);
    if (seq !== V.seq) return;
    V.data = d; V.bench = bench; V.sym = sym;
    if (d.name) await rememberName(sym, d.name);
    V.R = PAT.scan(d.bars);
    const n = d.bars.length - 1;
    await rememberQuote(sym, d.bars[n].close, d.bars[n].close / d.bars[n - 1].close - 1);
    head(); draw(false); cards();
    const src = isDemoSym(sym) ? 'Demo data · fictional company' : provider().short;
    const dt = fD(d.bars[n].time);
    if (d.stale) status(`Showing saved prices through ${dt}: ${d.error ? d.error.message : 'refresh failed'}`, 'warn');
    else status(`${src} · daily data through ${dt}${d.cached && !isDemoSym(sym) ? ' · updated ' + ago(d.fetchedAt) : ''}`, isDemoSym(sym) ? 'demo' : 'ok');
    if (!isDemoSym(sym)) loadFund(sym, seq);
    else { V.fund = null; renderCanslim(); }
  } catch (e) {
    if (seq !== V.seq) return;
    status(e.message || String(e), 'warn');
    if (!V.data || V.data.sym !== sym) emptyState(sym, e);
  }
}

function emptyState(sym, e) {
  const msg = e instanceof DataError && e.kind === 'auth'
    ? html`<p>${e.message}</p><button class="btn primary" id="eSet">Open Settings</button>`
    : html`<p>${e.message || 'Could not load ' + sym + '.'}</p>${isDemo() ? html`<button class="btn primary" id="eDemo">Open a demo stock</button>` : ''}`;
  ['#cBase', '#cSig', '#cCanslim', '#cFlags', '#cHist', '#cNums', '#cDraw'].forEach(id => { $(id).innerHTML = ''; });
  render($('#cBase'), html`<div class="empty">${raw(ICON.info)}${msg}</div>`);
  $('#eSet') && ($('#eSet').onclick = () => go('settings'));
  $('#eDemo') && ($('#eDemo').onclick = () => openStock('ACME.DEMO'));
  $('#sPats').innerHTML = '';
}

async function loadFund(sym, seq) {
  if (!provider().fundamentals) { V.fund = { none: true }; renderCanslim(); return; }
  V.fund = { loading: true }; renderCanslim();
  try { const f = await fundamentals(sym); if (seq === V.seq) { V.fund = f; renderCanslim(); } }
  catch (e) { if (seq === V.seq) { V.fund = { error: e.message }; renderCanslim(); } }
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
  return { sym: V.sym, daily: V.data.bars, bench: V.bench ? V.bench.bars : null, R: V.R, tf: prefs.tf, lines: prefs.lines, patMode: prefs.patMode, drawings: drawings(), cur: V.data.currency, pending: V.pending, poly: V.poly };
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
  histCard(); renderCanslim(); drawList();
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
function growth(a, b) { return a == null || b == null || !isFinite(a) || !isFinite(b) || b <= 0 ? null : (a - b) / b; }
function renderCanslim() {
  const el = $('#cCanslim'); if (!el || !V.sig) return;
  const f = V.fund, cs = V.sig.canslim;
  let C = ['na', 'Needs earnings data.'], A = ['na', 'Needs earnings data.'], rows = [];
  if (f && f.quarters && f.quarters.length >= 5) {
    const q = f.quarters, n = q.length - 1;
    const eg = growth(q[n].eps, q[n - 4].eps), sg = growth(q[n].revenue, q[n - 4].revenue);
    C = [eg == null ? 'na' : eg >= 0.25 ? 'pass' : eg >= 0 ? 'mid' : 'fail', `Latest quarter EPS ${eg == null ? 'n/a' : pc(eg, 0)} vs a year ago; sales ${sg == null ? 'n/a' : pc(sg, 0)}. O'Neil wants +25% or more.`];
    rows = q.map((x, j) => [x.period || x.date, x.eps, growth(x.eps, q[j - 4]?.eps), x.revenue, growth(x.revenue, q[j - 4]?.revenue)]).slice(-4);
  }
  if (f && f.annual && f.annual.length >= 4) {
    const y = f.annual, n = y.length - 1, a = y[n].eps, b = y[n - 3].eps;
    const cagr = a > 0 && b > 0 ? Math.pow(a / b, 1 / 3) - 1 : null;
    A = [cagr == null ? 'na' : cagr >= 0.25 ? 'pass' : cagr >= 0.1 ? 'mid' : 'fail', `3-year EPS growth ${cagr == null ? 'n/a' : pc(cagr, 0) + ' a year'}. O'Neil wants 25%+ a year.`];
  }
  const L = [['C', 'Quarter EPS', C], ['A', 'Annual EPS', A], ['N', 'New high', cs.N], ['S', 'Demand', cs.S], ['L', 'Leader', cs.L], ['I', 'Funds', ['na', 'Not scored: needs fund-ownership data.']], ['M', 'Market', cs.M]];
  const fundNote = !f ? '' : f.none ? 'Earnings data (C and A) comes with the FMP provider.' : f.loading ? 'Loading earnings…' : f.error ? f.error : f.source || '';
  render(el, html`
    <div class="card-head"><h2>CAN SLIM checklist</h2><span class="muted tiny">Tap a letter for details</span></div>
    <div class="canslim">${L.map(([k, nm, [st, why]]) => html`<div class="cs ${st}" title="${why}" tabindex="0" data-why="${k}: ${why}"><b>${k}</b><span>${nm}</span></div>`)}</div>
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quarter</th><th class="n">EPS</th><th class="n">vs yr ago</th><th class="n">Sales</th><th class="n">vs yr ago</th></tr></thead><tbody>
      ${rows.map(r => html`<tr><td>${r[0]}</td><td class="n">${f2(r[1])}</td><td class="n ${r[2] >= 0.25 ? 't-ok' : r[2] < 0 ? 't-bad' : ''}">${pc(r[2], 0)}</td><td class="n">${r[3] ? (r[3] / 1e9).toFixed(2) + 'B' : '—'}</td><td class="n ${r[4] >= 0.2 ? 't-ok' : r[4] < 0 ? 't-bad' : ''}">${pc(r[4], 0)}</td></tr>`)}</tbody></table></div>` : ''}
    <p class="muted tiny" style="margin:0" id="csWhy">${fundNote}</p>`);
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
