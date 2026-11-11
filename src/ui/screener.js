// The Screener tab: scans a list of stocks on the device for base patterns, buy points, volume and RS.
import PAT from '../core/pat.js';
import { screenRow, rankRS, pc, fDs } from '../core/analysis.js';
import { daily, benchmarkFor, provider, isDemo, settings, secAgent } from '../data/service.js';
import { DEMO, snapshotMeta, universe } from '../data/providers.js';
import { isApp, pool } from '../data/net.js';
import { secCompanies, listedCommon } from '../data/sec.js';
import * as store from '../data/store.js';
import { App, on, openStock, emit, rememberQuotes } from '../app.js';
import { $, $$, html, raw, render, money, ICON, toast, ago } from './dom.js';
import { patColor } from './chart.js';
import { setupScore } from '../core/score.js';
import { enrich } from '../core/earnings.js';
import { checkBars } from '../data/alerts.js';
import { fundamentals } from '../data/fundamentals.js';
import { fundSummary } from '../core/fundamentals.js';
import { factor } from '../data/fx.js';
import { nextEarnings } from '../data/earndate.js';
import { strategy } from '../data/plans.js';

export const US_LARGE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'JPM', 'LLY', 'V', 'UNH', 'XOM', 'MA', 'COST', 'HD', 'PG', 'JNJ', 'NFLX', 'WMT', 'ABBV', 'CRM', 'ORCL', 'AMD', 'BAC', 'KO', 'MRK', 'CVX', 'PEP', 'ADBE', 'TMO', 'LIN', 'CSCO', 'ACN', 'MCD', 'ABT', 'WFC', 'DIS', 'INTU', 'TXN', 'QCOM', 'IBM', 'AMAT', 'GE', 'CAT', 'NOW', 'ISRG', 'UBER', 'PANW', 'BKNG'];
const ST = { near: ['Near buy point', 'ok'], forming: ['Base forming', 'warn'], buyzone: ['Buy zone', 'ok'], extended: ['Extended', 'warn'], below: ['Below buy point', 'warn'], stop: ['Stop hit', 'bad'], faulty: ['Faulty base', 'bad'] };
const INPAT = r => r.p && ['near', 'forming', 'buyzone'].includes(r.p.st) && !r.p.f;
const PRESETS = [
  ['pat', 'In a pattern', INPAT],
  ['bz', 'In buy zone', r => r.p && r.p.st === 'buyzone'],
  ['all', 'All', () => true],
  ['bo', 'Breakouts', r => r.p && r.p.st === 'buyzone' && r.p.bo <= 5],
  ['near', 'Near buy point', r => r.p && r.p.st === 'near'],
  ['lead', 'Leaders', r => r.rs >= 80 && r.s50 > 0],
  ['vol', 'Volume surge', r => r.vr >= 2],
  ['sell', 'Sell signals', r => r.sell.length > 0],
  ['right', 'Right side / handle', r => r.ph && (r.ph.s === 2 || r.ph.s === 3)],
  ['growth', 'Growth leaders', r => r.rs >= 80 && FUND[r.s] && FUND[r.s].eg >= 0.25 && FUND[r.s].sg >= 0.2],
];
const COLS = [
  ['s', 'Symbol'], ['nm', 'Name'], ['sc', 'Setup', 'n'], ['c', 'Close', 'n'], ['d1', 'Day', 'n'], ['m1', '1 mo', 'n'], ['m3', '3 mo', 'n'], ['y1', '1 yr', 'n'],
  ['rs', 'Strength', 'n'], ['g', 'Sector'], ['vr', 'Vol ×', 'n'], ['ph', 'Phase'], ['p', 'Pattern'], ['di', 'To buy pt', 'n'], ['ne', 'Earnings', 'n'], ['hi', 'Off high', 'n'], ['eg', 'EPS g', 'n'], ['sg', 'Sales g', 'n'], ['nm', 'Net m', 'n'], ['sig', 'Signals'], ['sp', '60 days'],
];
const FF = { eg: null, sg: null, nm: null, de: null, acc: false, up3: false, fcf: false }, FUND = {};
const S = { rows: [], at: null, running: false, cancel: false, sort: 'sc', asc: false, ccy: '', fx: {}, preset: 'pat', hideEarn: true, earnDays: 14, q: '', minRs: 0, sector: '', source: null, custom: '' };

export async function initScreener(el) {
  S.custom = await store.get('screen.custom', 'AAPL MSFT NVDA');
  render(el, html`
    <section class="card">
      <div class="card-head"><h2>Scan</h2><span class="muted tiny" id="scAt"></span></div>
      <div class="toolbar">
        <label class="field" style="min-width:220px;flex:1"><span>Stocks to scan</span><select class="input" id="scSrc"></select></label>
        <button class="btn primary" id="scRun">${raw(ICON.play)}Run scan</button>
      </div>
      <textarea class="input" id="scCustom" rows="2" placeholder="Tickers separated by spaces, e.g. AAPL ASML.AS 7203.T" hidden></textarea>
      <div id="scProg" hidden><div class="progress"><i id="scBar" style="width:0"></i></div><div class="row tiny muted" style="margin-top:6px"><span id="scTxt"></span><button class="btn sm danger" id="scStop">Stop</button></div></div>
      <p class="muted tiny" style="margin:0" id="scNote"></p>
    </section>
    <div class="tiles" id="scTiles"></div>
    <section class="card">
      <div class="chips" id="scPresets"></div>
      <div class="toolbar">
        <input class="input" id="scQ" placeholder="Filter by ticker or name" style="max-width:260px">
        <select class="input" id="scSec" style="width:auto;padding:7px 10px;font-size:14px" aria-label="Sector"><option value="">All sectors</option></select>
        <select class="input" id="scCcy" style="width:auto;padding:7px 10px;font-size:14px" aria-label="Show prices in"><option value="">Local currency</option><option>EUR</option><option>USD</option></select>
        <label class="chk">Min strength <input class="input" type="number" id="scRs" min="0" max="99" step="10" value="0" style="width:80px"></label>
        <label class="chk" title="Your plan: no new buys in the days before an earnings report"><input type="checkbox" id="scEarn" checked> Hide stocks reporting within <span id="scEarnD">14</span> days</label>
        <span class="muted small" id="scCount"></span>
      </div>
      <details class="fscreen" id="scFund"><summary><b>Fundamentals</b> <span class="muted small" id="scFundSum">EPS and sales growth, acceleration, margins, cash flow, debt</span></summary>
        <div class="fs-grid">
          <label class="chk">EPS growth ≥ <input class="input" type="number" data-ff="eg" step="5" placeholder="25" style="width:72px">%</label>
          <label class="chk">Sales growth ≥ <input class="input" type="number" data-ff="sg" step="5" placeholder="20" style="width:72px">%</label>
          <label class="chk">Net margin ≥ <input class="input" type="number" data-ff="nm" step="1" placeholder="10" style="width:72px">%</label>
          <label class="chk">Debt / equity ≤ <input class="input" type="number" data-ff="de" step="0.1" placeholder="1" style="width:72px"></label>
          <label class="chk"><input type="checkbox" data-ff="acc"> EPS growth accelerating (3 quarters)</label>
          <label class="chk"><input type="checkbox" data-ff="up3"> EPS up each of the last 3 years</label>
          <label class="chk"><input type="checkbox" data-ff="fcf"> Positive free cash flow</label>
        </div>
        <div class="toolbar"><button class="btn sm primary" id="scFundLoad">Load fundamentals for the stocks shown</button><button class="btn sm" id="scFundClear">Clear filters</button><span class="small muted" id="scFundMsg"></span></div>
        <p class="muted tiny" style="margin:0">Figures come from company filings (SEC, US), the free Yahoo feed (other markets) or FMP, cached for a day. Loading them takes about a second per stock the first time, so filter on price first (preset, strength, sector). Stocks without loaded figures are hidden while a fundamental filter is on. EPS growth = latest quarter vs the same quarter a year earlier.</p>
      </details>
      <div class="tbl-wrap"><table class="tbl" id="scTable"></table></div>
      <p class="muted tiny" style="margin:0">Setup = 0–100 score combining the base (30), strength (25), trend (15), demand (10), earnings (10, when known) and the market (10); hover or long-press for the breakdown. Strength = 1–99 rank of 12-month price strength (latest quarter double-weighted) within this scan only. The app's own measure. Tap a row to open its chart. ▲ buy-side and ▼ sell-side signals follow classic chart rules; they are not advice.</p>
    </section>`);
  $('#scRun').onclick = run;
  $('#scStop').onclick = () => { S.cancel = true; };
  $('#scSrc').onchange = () => { S.source = $('#scSrc').value; $('#scCustom').hidden = S.source !== 'custom'; note(); store.set('screen.src.' + provider().id, S.source); };
  $('#scCustom').oninput = () => { S.custom = $('#scCustom').value; store.set('screen.custom', S.custom); note(); };
  $('#scQ').oninput = () => { S.q = $('#scQ').value.trim().toUpperCase(); table(); };
  $('#scRs').oninput = () => { S.minRs = +$('#scRs').value || 0; table(); };
  $('#scSec').onchange = () => { S.sector = $('#scSec').value; table(); };
  $('#scCcy').onchange = async () => { S.ccy = $('#scCcy').value; await loadFx(); table(); };
  Object.assign(FF, await store.get('screen.ff', {})); Object.assign(FUND, await store.get('screen.fund', {}));
  $$('[data-ff]').forEach(i => { const k = i.dataset.ff; if (i.type === 'checkbox') i.checked = !!FF[k]; else i.value = FF[k] ?? '';
    i.oninput = i.onchange = () => { FF[k] = i.type === 'checkbox' ? i.checked : (i.value === '' ? null : +i.value); store.set('screen.ff', FF); table(); }; });
  $('#scFundLoad').onclick = loadFund;
  $('#scFundClear').onclick = () => { Object.keys(FF).forEach(k => { FF[k] = typeof FF[k] === 'boolean' ? false : null; }); $$('[data-ff]').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; }); store.set('screen.ff', FF); table(); };
  on((type, data) => { if (type === 'row' && data && data.row) syncRow(data.row); if (type === 'sector') { S.sector = data || ''; S.preset = 'all'; presets(); table(); } if (type === 'market' && S.rows.length) { score(); table(); } if (type === 'provider') reset(); if (type === 'watch' && App.view === 'screener') sources(); if (type === 'view' && App.view === 'screener') { sources(); if (!S.rows.length && (isDemo() || (provider().id === 'free' && !isApp())) && !S.running) run(); else autoScan(); } });
  await reset();
  strategy().then(Sx => { S.earnDays = Sx.earningsDays || 14; const d = $('#scEarnD'); if (d) d.textContent = S.earnDays; });
  S.hideEarn = await store.get('screen.hideEarn', true); $('#scEarn').checked = S.hideEarn;
  $('#scEarn').onchange = () => { S.hideEarn = $('#scEarn').checked; store.set('screen.hideEarn', S.hideEarn); tiles(); table(); };
  loadEarn();
  if (App.view === 'screener' && (isDemo() || (provider().id === 'free' && !isApp())) && !S.rows.length) run();
  // automatic scans: when the tab opens with an old scan, and in the background every few minutes
  setInterval(() => autoScan(), 5 * 60e3); setTimeout(() => autoScan(), 20e3);
}

/** Rescans the chosen list when the last scan is older than the setting (default 30 minutes; desktop app). */
export function autoScan() {
  if (S.running || !isApp() || provider().id === 'demo' || settings.autoScan === 0) return;
  const every = (settings.autoScan || 30) * 60e3;
  if (S.at && Date.now() - S.at < every) return;
  if (document.visibilityState !== 'visible' && !window.desktop) return;
  run({ auto: true });
}

/** Puts the chart's fresh analysis of a stock into its screener row, so both always show the same state. */
function syncRow(row) {
  const i = S.rows.findIndex(r => r.s === row.s); if (i < 0) return;
  const old = S.rows[i]; S.rows[i] = { ...row, rs: old.rs, rsh: row.rsh ?? old.rsh, g: old.g, cu: old.cu || row.cu, nm: row.nm || old.nm };
  score(); store.set('screen.' + provider().id, { rows: S.rows, at: S.at });
  if (App.view === 'screener') { tiles(); table(); }
}

async function reset() {
  const saved = await store.get('screen.' + provider().id, null);
  S.rows = saved ? saved.rows : []; S.at = saved ? saved.at : null; score();
  await snapshotMeta().catch(() => null); if (!BUILTIN.length) { try { BUILTIN = (await snapshotMeta()).stocks.map(x => x.s); } catch (e) { /* none */ } }
  S.source = await store.get('screen.src.' + provider().id, isDemo() ? 'demo' : provider().id === 'free' ? (isApp() ? 'world' : 'builtin') : 'watch');
  sources(); tiles(); presets(); table();
}

let BUILTIN = [], ABOUT = {}, SECTOR = {}, EPSYOY = {}, UNI = [], NV = new Set(), USALL = [], NAME = {};
const REGIONS = ['US', 'Europe', 'Japan', 'Hong Kong', 'China', 'Korea'];
universe().then(u => { UNI = u.items; NV = new Set(u.nv || []); u.items.forEach(r => { if (r[3] && !SECTOR[r[0]]) SECTOR[r[0]] = r[3]; if (r[1]) NAME[r[0]] = r[1]; }); if (App.view === 'screener') sources(); });
snapshotMeta().then(m => {
  BUILTIN = m.stocks.map(x => x.s); m.stocks.forEach(x => { if (x.g) SECTOR[x.s] = x.g; if (x.i || x.b) ABOUT[x.s] = { i: x.i, b: x.b }; });
  Object.entries(m.earnings).forEach(([s, e]) => { const q = enrich(e.q.map(x => ({ time: Date.parse(x.t) / 1000, eps: x.eps, est: x.est }))).pop(); if (q && q.yoy != null) EPSYOY[s] = q.yoy; });
}).catch(() => {});
/** Setup score for every row (needs strength ranks, so run after rankRS). */
function score() { S.rows.forEach(r => { const s = setupScore(r, EPSYOY[r.s] ?? null, App.mkt); r.sc = s.score; r.scParts = s.parts; }); }
async function loadFx() {
  if (!S.ccy) return;
  const curs = [...new Set(S.rows.map(r => r.cu).filter(Boolean))];
  for (const c of curs) if (!S.fx[c + S.ccy]) S.fx[c + S.ccy] = await factor(c, S.ccy);
}
function list(src) {
  if (src === 'builtin') return BUILTIN.slice();
  if (src === 'world') return UNI.map(r => r[0]);
  if (src.startsWith('r:')) return UNI.filter(r => r[2] === src.slice(2)).map(r => r[0]);
  if (src === 'usall') return USALL.slice();
  if (src === 'demo') return DEMO.map(d => d.sym);
  if (src === 'watch') return App.watch.slice();
  if (src.startsWith('l:')) { const l = (App.lists || []).find(x => x.id === src.slice(2)); return l ? l.syms.slice() : []; }
  if (src === 'alllists') return [...new Set((App.lists || []).flatMap(l => l.syms))];
  if (src === 'portfolio') return (App.holdings || []).map(h => h.sym);
  if (src === 'us50') return US_LARGE;
  if (src === 'custom') return [...new Set(S.custom.toUpperCase().split(/[\s,;]+/).filter(Boolean))].slice(0, 300);
  return [];
}
function sources() {
  const opts = [['watch', `Watchlist shown in the sidebar (${App.watch.length})`], ...(App.lists || []).filter(l => l.id !== App.listId).map(l => ['l:' + l.id, `Watchlist: ${l.name} (${l.syms.length})`]), ...((App.lists || []).length > 1 ? [['alllists', `All your watchlists (${new Set(App.lists.flatMap(l => l.syms)).size})`]] : []), ['portfolio', `Your portfolio (${(App.holdings || []).length})`]];
  if (isDemo()) opts.unshift(['demo', `Demo stocks (${DEMO.length}, fictional)`]);
  else if (isApp() && UNI.length) {
    // desktop app: the whole universe with live prices
    const by = r => UNI.filter(x => x[2] === r).length;
    opts.unshift(['world', `All stocks worldwide (${UNI.length})`], ...REGIONS.filter(by).map(r => ['r:' + r, `${r} (${by(r)})`]),
      ['usall', USALL.length ? `All US-listed companies (${USALL.length}, SEC list)` : 'All US-listed companies (SEC list, ~5,000)']);
    if (BUILTIN.length) opts.push(['builtin', `Built-in stocks only (${BUILTIN.length}, fastest)`]);
  } else { if (BUILTIN.length && provider().id === 'free') opts.unshift(['builtin', `All built-in stocks (${BUILTIN.length}: US, Europe, Asia)`]); opts.push(['us50', 'US large caps (50)']); }
  opts.push(['custom', 'Your own list…']);
  if (!opts.some(o => o[0] === S.source)) S.source = opts[0][0];
  render($('#scSrc'), html`${opts.map(([k, l]) => html`<option value="${k}" ${k === S.source ? raw('selected') : ''}>${l}</option>`)}`);
  $('#scCustom').value = S.custom; $('#scCustom').hidden = S.source !== 'custom';
  note();
}
function note() {
  const n = list(S.source).length, P = provider();
  const per = P.id === 'twelvedata' ? 7.6 : P.id === 'demo' ? 0 : 0.3;
  $('#scNote').textContent = P.id === 'demo' ? 'Runs on the demo stocks instantly.' : P.id === 'free' && isApp() ? `${n} stocks · live prices from the free feed (at most 15 minutes old). Rescans automatically every ${settings.autoScan || 30} minutes while the app is open (Settings → Market data). First scan about ${Math.max(1, Math.round(n / 12 / 60))} min, repeats are much faster.` : P.id === 'free' ? (S.source === 'builtin' ? `${n} stocks · worked out every evening with the newest closing prices (the desktop app adds live prices).` : `${n} stocks · uses the built-in data (the desktop app adds live prices). A scan takes about ${Math.max(1, Math.round(n / 25))} s.`) :
    `${n} stocks · uses up to ${n + 1} requests on your ${P.short} plan the first time (cached prices are reused for 3 hours)${per > 1 ? ` · about ${Math.ceil(n * per / 60)} min on the free plan (8 requests a minute)` : ''}.`;
  $('#scAt').textContent = S.at ? 'Last scan ' + ago(S.at) + (S.running ? ' · scanning now…' : '') : '';
}

const FRESH = 15 * 60e3;
async function run({ auto = false } = {}) {
  if (S.running) return;
  if (S.source === 'usall' && !USALL.length) {
    try { toast('Loading the SEC list of US-listed companies…'); const l = listedCommon(await secCompanies(secAgent())); l.forEach(x => { if (!NAME[x.s]) NAME[x.s] = x.n; }); USALL = l.map(x => x.s); sources(); }
    catch (e) { toast(e.message, 6000); return; }
  }
  if (!isApp() && S.source === 'builtin' && provider().id === 'free') {
    let m = null; try { m = await snapshotMeta(); } catch (e) { /* none */ }
    if (m && m.screen) {
      try {
        const d = await (await fetch(new URL('./data/screen.json', document.baseURI).href)).json();
        S.rows = d.rows; S.at = d.at; score(); await loadFx();
        rememberQuotes(S.rows.map(r => ({ s: r.s, c: r.c, ch: r.d1, ph: r.ph && r.ph.l, pt: r.ph && r.ph.t, rs: r.rs, vp: r.vr != null ? r.vr - 1 : null })));
        setTimeout(() => emit('scan'), 0);
        await store.set('screen.' + provider().id, { rows: S.rows, at: S.at });
        tiles(); table(); note(); loadEarn(); return;
      } catch (e) { /* scan here instead */ }
    }
  }
  const syms = list(S.source);
  if (!syms.length) { if (!auto) toast('Nothing to scan: add stocks to this list first.'); return; }
  S.running = true; S.cancel = false;
  $('#scProg').hidden = false; $('#scRun').disabled = true;
  const rows = [], errors = [];
  let bench = null;
  try { bench = await benchmarkFor(syms[0]); } catch (e) { /* RS line flags skipped */ }
  const benchC = bench && bench.bars.map(b => ({ time: b.time, close: b.close }));
  const live = isApp() && provider().id === 'free';
  const one = async (sym, retry = true) => {
    if (S.cancel) return;
    try {
      const d = await daily(sym, live ? { years: 2, maxAge: FRESH } : {});
      const r = screenRow(sym, d.name || App.names[sym] || NAME[sym] || '', d.bars, PAT.scan(d.bars), benchC, { noVol: NV.has(sym) && !d.live });
      if (r) { r.cu = d.currency; r.g = SECTOR[sym] || ''; rows.push(r); }
      else errors.push(sym + ' (too little history)');
      checkBars(sym, d.bars, d.name);
    } catch (e) {
      if (e.kind === 'limit' && retry && live) { await new Promise(r => setTimeout(r, 15000)); return one(sym, false); } // free feed throttled: pause, retry once
      errors.push(sym + ': ' + e.message);
      if (e.kind === 'auth' || (e.kind === 'limit' && !live)) { S.cancel = true; toast(e.message, 6000); }
    }
  };
  const prog = i => { $('#scTxt').textContent = `${i} of ${syms.length}`; $('#scBar').style.width = (i / syms.length * 100) + '%'; };
  if (live) await pool(syms, 6, sym => one(sym), prog);
  else for (let i = 0; i < syms.length && !S.cancel; i++) { await one(syms[i]); prog(i + 1); if (i % 4 === 3) await new Promise(r => setTimeout(r, 0)); }
  rankRS(rows);
  S.rows = rows; S.at = Date.now(); S.running = false; score(); await loadFx();
  rememberQuotes(rows.map(r => ({ s: r.s, c: r.c, ch: r.d1, ph: r.ph && r.ph.l, pt: r.ph && r.ph.t, rs: r.rs, vp: r.vr != null ? r.vr - 1 : null })));
  setTimeout(() => emit('scan'), 0);
  await store.set('screen.' + provider().id, { rows, at: S.at });
  $('#scProg').hidden = true; $('#scRun').disabled = false;
  if (errors.length && !auto) toast(`${rows.length} scanned; ${errors.length} skipped (${errors.slice(0, 2).join('; ')}${errors.length > 2 ? '…' : ''})`, 6000);
  tiles(); table(); note();
  loadEarn();
}

function tiles() {
  const R = S.rows, el = $('#scTiles');
  if (!R.length) { render(el, html`<div class="tile"><div class="empty">${raw(ICON.screener)}<p>No scan yet. Pick a list and press Run scan.</p></div></div>`); return; }
  const R2 = S.hideEarn ? R.filter(r => !earnSoon(r)) : R;
  const T = [
    ['In buy zone (broke out)', 't-ok', R2.filter(r => r.p && r.p.st === 'buyzone').sort((a, b) => a.p.bo - b.p.bo), r => (r.p.bo === 0 ? 'today' : r.p.bo + 'd ago') + ' · ' + pc(r.p.di)],
    ['Base ready, near buy point', 't-blue', R2.filter(r => r.p && r.p.st === 'near' && !r.p.f).sort((a, b) => b.p.di - a.p.di), r => pc(r.p.di) + ' to go'],
    ['Volume surges in a base', 't-warn', R2.filter(r => r.vr >= 2 && INPAT(r)).sort((a, b) => b.vr - a.vr), r => '×' + r.vr.toFixed(1) + ' ' + (r.d1 >= 0 ? '▲' : '▼')],
    ['Sell signals', 't-bad', R.filter(r => r.sell.length).sort((a, b) => b.sell.length - a.sell.length), r => r.sell[0]],
  ];
  render(el, html`${T.map(([t, c, rows, v]) => html`<div class="tile"><h3><span class="${c}">●</span>${t}<span class="count">${rows.length}</span></h3>
    ${rows.length ? html`<ul class="alist">${rows.slice(0, 6).map(r => html`<li data-s="${r.s}"><span class="t">${r.s.replace('.DEMO', '')}</span><span class="n">${r.nm}</span><span class="small num">${v(r)}</span></li>`)}</ul>` : html`<p class="muted small" style="margin:0">None today.</p>`}</div>`)}`);
  $$('li[data-s]', el).forEach(li => { li.onclick = () => openStock(li.dataset.s); });
}

function presets() {
  render($('#scPresets'), html`${PRESETS.map(([k, l]) => html`<button class="chip${S.preset === k ? ' on' : ''}" data-p="${k}">${l}</button>`)}`);
  $$('[data-p]').forEach(b => { b.onclick = () => { S.preset = b.dataset.p; presets(); table(); }; });
}

const fundOn = () => FF.eg != null || FF.sg != null || FF.nm != null || FF.de != null || FF.acc || FF.up3 || FF.fcf;
function fundOk(r) {
  if (!fundOn()) return true;
  const f = FUND[r.s]; if (!f) return false;
  if (FF.eg != null && !(f.eg != null && f.eg * 100 >= FF.eg)) return false;
  if (FF.sg != null && !(f.sg != null && f.sg * 100 >= FF.sg)) return false;
  if (FF.nm != null && !(f.nm != null && f.nm * 100 >= FF.nm)) return false;
  if (FF.de != null && !(f.de != null && f.de <= FF.de)) return false;
  if (FF.acc && f.acc !== true) return false;
  if (FF.up3 && f.up3 !== true) return false;
  if (FF.fcf && !(f.fcf > 0)) return false;
  return true;
}
/** Loads (cached) fundamentals for the rows currently shown, a few at a time. */
async function loadFund() {
  const btn = $('#scFundLoad'), msg = $('#scFundMsg');
  const saved = Object.assign({}, FF); Object.keys(FF).forEach(k => { FF[k] = typeof FF[k] === 'boolean' ? false : null; });
  const shown = currentRows(); Object.assign(FF, saved); // the stocks shown by the price filters
  const todo = shown.map(r => r.s).filter(s => !FUND[s] || Date.now() - FUND[s].at > 24 * 3600e3).slice(0, 500);
  if (!todo.length) { msg.textContent = 'Fundamentals already loaded for these stocks.'; table(); return; }
  btn.disabled = true; let done = 0, got = 0;
  await pool(todo, 4, async sym => {
    try { const F = await fundamentals(sym); const x = fundSummary(F); if (x) { FUND[sym] = { ...x, at: Date.now() }; got++; } } catch (e) { /* no data for this stock */ }
  }, () => { done++; msg.textContent = `Loading ${done} of ${todo.length}…`; });
  await store.set('screen.fund', FUND);
  btn.disabled = false; msg.textContent = `Fundamentals for ${got} of ${todo.length} stocks${got < todo.length ? ' (the rest had no data' + (isApp() ? '' : ': most load in the desktop app') + ')' : ''}.`;
  table();
}
const val = (r, k) => k === 'eg' || k === 'sg' || k === 'nm' ? (FUND[r.s] ? FUND[r.s][k] : null) : k === 'ph' ? (r.ph ? r.ph.s || 0 : null) : k === 'p' ? (r.p ? Object.keys(ST).indexOf(r.p.st) : 99) : k === 'di' ? (r.p && r.p.di != null ? r.p.di : null) : k === 'sig' ? r.buy.length - r.sell.length : r[k];
function spark(a, up) {
  if (!a || a.length < 2) return '';
  const w = 70, h = 20, pts = a.map((v, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 1 - v / 99 * (h - 2)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="var(${up ? '--up' : '--down'})" stroke-width="1.5" points="${pts}"/></svg>`;
}
function currentRows() {
  const f = PRESETS.find(p => p[0] === S.preset)[2];
  return S.rows.filter(f).filter(fundOk).filter(r => !S.hideEarn || !earnSoon(r)).filter(r => (r.rs || 0) >= S.minRs).filter(r => !S.sector || r.g === S.sector).filter(r => !S.q || r.s.includes(S.q) || (r.nm || '').toUpperCase().includes(S.q));
}
function table() {
  const secs = [...new Set(S.rows.map(r => r.g || SECTOR[r.s]).filter(Boolean))].sort();
  const sel = $('#scSec'); if (sel && sel.options.length !== secs.length + 1) render(sel, html`<option value="">All sectors</option>${secs.map(x => html`<option ${x === S.sector ? raw('selected') : ''}>${x}</option>`)}`);
  S.rows.forEach(r => { if (!r.g && SECTOR[r.s]) r.g = SECTOR[r.s]; });
  let R = currentRows();
  const fs = $('#scFundSum'); if (fs) fs.textContent = fundOn() ? `filter on · ${Object.keys(FUND).length} stocks with figures loaded` : 'EPS and sales growth, acceleration, margins, cash flow, debt';
  const k = S.sort, dir = S.asc ? 1 : -1;
  R = R.sort((a, b) => { const x = val(a, k), y = val(b, k); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
  const hid = S.hideEarn ? S.rows.filter(r => earnSoon(r)).length : 0;
  $('#scCount').textContent = `${R.length} of ${S.rows.length}` + (hid ? ` · ${hid} hidden: earnings within ${S.earnDays} days` : '');
  const cell = (r, c) => {
    switch (c) {
      case 's': return html`<td class="sticky"><b>${r.s.replace('.DEMO', '')}</b></td>`;
      case 'nm': { const a = ABOUT[r.s]; return html`<td class="name" title="${a ? [a.i, a.b].filter(Boolean).join(' · ') : ''}">${r.nm}${a && a.i ? html`<div class="muted tiny">${a.i}</div>` : ''}</td>`; }
      case 'g': return html`<td class="name small">${r.g || ''}</td>`;
      case 'c': { const f = S.ccy && S.fx[r.cu + S.ccy]; return html`<td class="n" title="${f && !f.live ? 'Reference rate of ' + f.date : ''}">${f ? (f.live ? '' : '≈') + money(r.c * f.v, S.ccy) : money(r.c, r.cu)}</td>`; }
      case 'sc': return html`<td class="n" title="${(r.scParts || []).map(p => `${p[0]} ${p[1]}/${p[2]} (${p[3]})`).join(' · ')}"><span class="score ${r.sc >= 70 ? 't-ok' : r.sc >= 45 ? 't-warn' : 't-mute'}">${r.sc ?? '—'}</span></td>`;
      case 'rs': return html`<td class="n ${r.rs >= 80 ? 't-ok' : r.rs < 40 ? 't-mute' : ''}">${r.rs ?? '—'}${r.rsh ? raw(' <span title="RS line at a new high" class="t-ok">★</span>') : ''}</td>`;
      case 'vr': return html`<td class="n ${r.vr >= 2 ? 't-warn' : ''}">${r.vr != null ? r.vr.toFixed(1) : '—'}</td>`;
      case 'p': return r.p ? html`<td><span class="st t-${ST[r.p.st][1]}">${ST[r.p.st][0]}</span> <span class="small" style="color:${patColor(r.p.t)}">${r.p.n}</span></td>` : html`<td class="muted">—</td>`;
      case 'di': return html`<td class="n">${r.p && r.p.di != null ? pc(r.p.di) : '—'}</td>`;
      case 'sig': return html`<td title="${[...r.buy.map(x => '▲ ' + x), ...r.sell.map(x => '▼ ' + x)].join('\n')}">${r.buy.length ? html`<span class="t-ok">▲${r.buy.length}</span> ` : ''}${r.sell.length ? html`<span class="t-bad">▼${r.sell.length}</span>` : ''}${!r.buy.length && !r.sell.length ? html`<span class="muted">—</span>` : ''}</td>`;
      case 'sp': return html`<td>${raw(spark(r.sp, r.m3 >= 0))}</td>`;
      case 'ne': { if (r.ne == null) return html`<td class="n muted">—</td>`; const d = Math.round((r.ne - Date.now() / 1000) / 86400); return html`<td class="n ${earnSoon(r) ? 't-warn' : ''}" title="Next earnings report">${fDs(r.ne)}${d >= 0 && d <= 60 ? html` <span class="tiny">(${d}d)</span>` : ''}</td>`; }
      case 'eg': case 'sg': case 'nm': { const f = FUND[r.s], v = f ? f[c] : (c === 'eg' && EPSYOY[r.s] != null ? EPSYOY[r.s] : null); return html`<td class="n ${v == null ? 'muted' : c !== 'nm' ? (v >= 0.25 ? 'up' : v < 0 ? 'down' : '') : ''}" title="${f && f.acc ? 'EPS growth accelerating' : ''}">${v == null ? '—' : pc(v, 0)}${c === 'eg' && f && f.acc ? raw(' <span class="t-ok">↑</span>') : ''}</td>`; }
      case 'ph': return r.ph ? html`<td title="${r.ph.d || ''}"><span class="mini-steps">${[1, 2, 3, 4, 5, 6, 7].map(i => html`<i class="${r.ph.s === i ? 'on t-' + r.ph.t : r.ph.s && i < r.ph.s ? 'done' : ''}"></i>`)}</span> <span class="small t-${r.ph.t}">${r.ph.l}</span></td>` : html`<td class="muted">—</td>`;
      default: { const v = r[c]; return html`<td class="n ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${pc(v)}</td>`; }
    }
  };
  render($('#scTable'), html`<thead><tr>${COLS.map(([c, l, n]) => html`<th class="sort ${n || ''} ${c === 's' ? 'sticky' : ''} ${S.sort === c ? 'sorted' + (S.asc ? ' asc' : '') : ''}" data-c="${c}">${l}</th>`)}</tr></thead>
    <tbody>${R.slice(0, 400).map(r => html`<tr class="click" data-s="${r.s}">${COLS.map(([c]) => cell(r, c))}</tr>`)}</tbody>`);
  $$('#scTable th').forEach(th => { th.onclick = () => { const c = th.dataset.c; if (c === 'sp') return; if (S.sort === c) S.asc = !S.asc; else { S.sort = c; S.asc = c === 's' || c === 'nm'; } table(); }; });
  $$('#scTable tr.click').forEach(tr => { tr.onclick = () => openStock(tr.dataset.s); });
}

export { S as screenerState };

/* ---------- earnings dates: no new buys in the days before a report ---------- */
const earnSoon = r => r.ne != null && r.ne >= Date.now() / 1000 - 86400 && (r.ne - Date.now() / 1000) / 86400 <= S.earnDays;
/** Next earnings date for the stocks in a pattern (cached for a day), then redraws. */
async function loadEarn() {
  const todo = S.rows.filter(r => INPAT(r) || (r.p && r.p.st === 'buyzone')).slice(0, 150);
  let n = 0;
  await pool(todo, 4, async r => { const t = await nextEarnings(r.s).catch(() => null); if (t !== undefined) { r.ne = t; n++; } });
  if (n && App.view === 'screener') { tiles(); table(); }
}
