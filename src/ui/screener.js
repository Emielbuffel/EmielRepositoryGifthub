// The Screener tab: scans a list of stocks on the device for base patterns, buy points, volume and RS.
import PAT from '../core/pat.js';
import { screenRow, rankRS, pc, fDs } from '../core/analysis.js';
import { daily, benchmarkFor, provider, isDemo, settings } from '../data/service.js';
import { DEMO, snapshotMeta } from '../data/providers.js';
import * as store from '../data/store.js';
import { App, on, openStock, emit } from '../app.js';
import { $, $$, html, raw, render, money, ICON, toast, ago } from './dom.js';
import { patColor } from './chart.js';
import { setupScore } from '../core/score.js';
import { enrich } from '../core/earnings.js';
import { checkBars } from '../data/alerts.js';
import { factor } from '../data/fx.js';

export const US_LARGE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'JPM', 'LLY', 'V', 'UNH', 'XOM', 'MA', 'COST', 'HD', 'PG', 'JNJ', 'NFLX', 'WMT', 'ABBV', 'CRM', 'ORCL', 'AMD', 'BAC', 'KO', 'MRK', 'CVX', 'PEP', 'ADBE', 'TMO', 'LIN', 'CSCO', 'ACN', 'MCD', 'ABT', 'WFC', 'DIS', 'INTU', 'TXN', 'QCOM', 'IBM', 'AMAT', 'GE', 'CAT', 'NOW', 'ISRG', 'UBER', 'PANW', 'BKNG'];
const ST = { near: ['Near buy point', 'ok'], forming: ['Base forming', 'warn'], buyzone: ['Buy zone', 'ok'], extended: ['Extended', 'warn'], below: ['Below buy point', 'warn'], stop: ['Stop hit', 'bad'], faulty: ['Faulty base', 'bad'] };
const PRESETS = [
  ['all', 'All', () => true],
  ['bo', 'Breakouts', r => r.p && r.p.st === 'buyzone' && r.p.bo <= 5],
  ['near', 'Near buy point', r => r.p && r.p.st === 'near'],
  ['lead', 'Leaders', r => r.rs >= 80 && r.s50 > 0],
  ['vol', 'Volume surge', r => r.vr >= 2],
  ['sell', 'Sell signals', r => r.sell.length > 0],
];
const COLS = [
  ['s', 'Symbol'], ['nm', 'Name'], ['sc', 'Setup', 'n'], ['c', 'Close', 'n'], ['d1', 'Day', 'n'], ['m1', '1 mo', 'n'], ['m3', '3 mo', 'n'], ['y1', '1 yr', 'n'],
  ['rs', 'Strength', 'n'], ['g', 'Sector'], ['vr', 'Vol ×', 'n'], ['p', 'Pattern'], ['di', 'To buy pt', 'n'], ['hi', 'Off high', 'n'], ['sig', 'Signals'], ['sp', '60 days'],
];
const S = { rows: [], at: null, running: false, cancel: false, sort: 'sc', asc: false, ccy: '', fx: {}, preset: 'all', q: '', minRs: 0, sector: '', source: null, custom: '' };

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
        <span class="muted small" id="scCount"></span>
      </div>
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
  on((type, data) => { if (type === 'sector') { S.sector = data || ''; S.preset = 'all'; presets(); table(); } if (type === 'market' && S.rows.length) { score(); table(); } if (type === 'provider') reset(); if (type === 'view' && App.view === 'screener') { sources(); if (!S.rows.length && (isDemo() || provider().id === 'free') && !S.running) run(); } });
  await reset();
  if (App.view === 'screener' && (isDemo() || provider().id === 'free') && !S.rows.length) run();
}

async function reset() {
  const saved = await store.get('screen.' + provider().id, null);
  S.rows = saved ? saved.rows : []; S.at = saved ? saved.at : null; score();
  await snapshotMeta().catch(() => null); if (!BUILTIN.length) { try { BUILTIN = (await snapshotMeta()).stocks.map(x => x.s); } catch (e) { /* none */ } }
  S.source = await store.get('screen.src.' + provider().id, isDemo() ? 'demo' : provider().id === 'free' ? 'builtin' : 'watch');
  sources(); tiles(); presets(); table();
}

let BUILTIN = [], SECTOR = {}, EPSYOY = {};
snapshotMeta().then(m => {
  BUILTIN = m.stocks.map(x => x.s); m.stocks.forEach(x => { if (x.g) SECTOR[x.s] = x.g; });
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
  if (src === 'demo') return DEMO.map(d => d.sym);
  if (src === 'watch') return App.watch.slice();
  if (src === 'portfolio') return (App.holdings || []).map(h => h.sym);
  if (src === 'us50') return US_LARGE;
  if (src === 'custom') return [...new Set(S.custom.toUpperCase().split(/[\s,;]+/).filter(Boolean))].slice(0, 300);
  return [];
}
function sources() {
  const opts = [['watch', `Your watchlist (${App.watch.length})`], ['portfolio', `Your portfolio (${(App.holdings || []).length})`]];
  if (isDemo()) opts.unshift(['demo', `Demo stocks (${DEMO.length}, fictional)`]); else { if (BUILTIN.length && provider().id === 'free') opts.unshift(['builtin', `All built-in stocks (${BUILTIN.length}: US, Europe, Asia)`]); opts.push(['us50', 'US large caps (50)']); }
  opts.push(['custom', 'Your own list…']);
  if (!opts.some(o => o[0] === S.source)) S.source = opts[0][0];
  render($('#scSrc'), html`${opts.map(([k, l]) => html`<option value="${k}" ${k === S.source ? raw('selected') : ''}>${l}</option>`)}`);
  $('#scCustom').value = S.custom; $('#scCustom').hidden = S.source !== 'custom';
  note();
}
function note() {
  const n = list(S.source).length, P = provider();
  const per = P.id === 'twelvedata' ? 7.6 : P.id === 'demo' ? 0 : 0.3;
  $('#scNote').textContent = P.id === 'demo' ? 'Runs on the demo stocks instantly.' : P.id === 'free' ? `${n} stocks · uses the built-in data (and fresh prices from the free feeds in the app). A full scan takes about ${Math.max(1, Math.round(n / 25))} s.` :
    `${n} stocks · uses up to ${n + 1} requests on your ${P.short} plan the first time (cached prices are reused for 3 hours)${per > 1 ? ` · about ${Math.ceil(n * per / 60)} min on the free plan (8 requests a minute)` : ''}.`;
  $('#scAt').textContent = S.at ? 'Last scan ' + ago(S.at) : '';
}

async function run() {
  if (S.running) return;
  const syms = list(S.source);
  if (!syms.length) { toast('Nothing to scan: add stocks to this list first.'); return; }
  S.running = true; S.cancel = false;
  $('#scProg').hidden = false; $('#scRun').disabled = true;
  const rows = [], errors = [];
  let bench = null;
  try { bench = await benchmarkFor(syms[0]); } catch (e) { /* RS line flags skipped */ }
  for (let i = 0; i < syms.length && !S.cancel; i++) {
    const sym = syms[i];
    $('#scTxt').textContent = `${i + 1} of ${syms.length} · ${sym}`; $('#scBar').style.width = ((i + 1) / syms.length * 100) + '%';
    try {
      const d = await daily(sym);
      const r = screenRow(sym, d.name || App.names[sym] || '', d.bars, PAT.scan(d.bars), bench && bench.bars.map(b => ({ time: b.time, close: b.close })));
      if (r) { r.cu = d.currency; r.g = SECTOR[sym] || ''; rows.push(r); }
      else errors.push(sym + ' (too little history)');
      checkBars(sym, d.bars, d.name);
    } catch (e) {
      errors.push(sym + ': ' + e.message);
      if (e.kind === 'auth' || e.kind === 'limit') { S.cancel = true; toast(e.message, 6000); }
    }
    if (i % 4 === 3) await new Promise(r => setTimeout(r, 0)); // keep the UI responsive
  }
  rankRS(rows);
  S.rows = rows; S.at = Date.now(); S.running = false; score(); await loadFx();
  setTimeout(() => emit('scan'), 0);
  await store.set('screen.' + provider().id, { rows, at: S.at });
  $('#scProg').hidden = true; $('#scRun').disabled = false;
  if (errors.length) toast(`${rows.length} scanned; ${errors.length} skipped (${errors.slice(0, 2).join('; ')}${errors.length > 2 ? '…' : ''})`, 6000);
  tiles(); table(); note();
}

function tiles() {
  const R = S.rows, el = $('#scTiles');
  if (!R.length) { render(el, html`<div class="tile"><div class="empty">${raw(ICON.screener)}<p>No scan yet. Pick a list and press Run scan.</p></div></div>`); return; }
  const T = [
    ['Breakouts', 't-ok', R.filter(r => r.p && r.p.st === 'buyzone' && r.p.bo <= 5).sort((a, b) => a.p.bo - b.p.bo), r => r.p.bo === 0 ? 'today' : r.p.bo + 'd ago'],
    ['Near a buy point', 't-blue', R.filter(r => r.p && r.p.st === 'near').sort((a, b) => b.p.di - a.p.di), r => pc(r.p.di)],
    ['Volume surges (2×+)', 't-warn', R.filter(r => r.vr >= 2).sort((a, b) => b.vr - a.vr), r => '×' + r.vr.toFixed(1) + ' ' + (r.d1 >= 0 ? '▲' : '▼')],
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

const val = (r, k) => k === 'p' ? (r.p ? Object.keys(ST).indexOf(r.p.st) : 99) : k === 'di' ? (r.p && r.p.di != null ? r.p.di : null) : k === 'sig' ? r.buy.length - r.sell.length : r[k];
function spark(a, up) {
  if (!a || a.length < 2) return '';
  const w = 70, h = 20, pts = a.map((v, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 1 - v / 99 * (h - 2)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="var(${up ? '--up' : '--down'})" stroke-width="1.5" points="${pts}"/></svg>`;
}
function table() {
  const f = PRESETS.find(p => p[0] === S.preset)[2];
  const secs = [...new Set(S.rows.map(r => r.g || SECTOR[r.s]).filter(Boolean))].sort();
  const sel = $('#scSec'); if (sel && sel.options.length !== secs.length + 1) render(sel, html`<option value="">All sectors</option>${secs.map(x => html`<option ${x === S.sector ? raw('selected') : ''}>${x}</option>`)}`);
  S.rows.forEach(r => { if (!r.g && SECTOR[r.s]) r.g = SECTOR[r.s]; });
  let R = S.rows.filter(f).filter(r => (r.rs || 0) >= S.minRs).filter(r => !S.sector || r.g === S.sector).filter(r => !S.q || r.s.includes(S.q) || (r.nm || '').toUpperCase().includes(S.q));
  const k = S.sort, dir = S.asc ? 1 : -1;
  R = R.sort((a, b) => { const x = val(a, k), y = val(b, k); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
  $('#scCount').textContent = `${R.length} of ${S.rows.length}`;
  const cell = (r, c) => {
    switch (c) {
      case 's': return html`<td class="sticky"><b>${r.s.replace('.DEMO', '')}</b></td>`;
      case 'nm': return html`<td class="name">${r.nm}</td>`;
      case 'g': return html`<td class="name small">${r.g || ''}</td>`;
      case 'c': { const f = S.ccy && S.fx[r.cu + S.ccy]; return html`<td class="n" title="${f && !f.live ? 'Reference rate of ' + f.date : ''}">${f ? (f.live ? '' : '≈') + money(r.c * f.v, S.ccy) : money(r.c, r.cu)}</td>`; }
      case 'sc': return html`<td class="n" title="${(r.scParts || []).map(p => `${p[0]} ${p[1]}/${p[2]} (${p[3]})`).join(' · ')}"><span class="score ${r.sc >= 70 ? 't-ok' : r.sc >= 45 ? 't-warn' : 't-mute'}">${r.sc ?? '—'}</span></td>`;
      case 'rs': return html`<td class="n ${r.rs >= 80 ? 't-ok' : r.rs < 40 ? 't-mute' : ''}">${r.rs ?? '—'}${r.rsh ? raw(' <span title="RS line at a new high" class="t-ok">★</span>') : ''}</td>`;
      case 'vr': return html`<td class="n ${r.vr >= 2 ? 't-warn' : ''}">${r.vr != null ? r.vr.toFixed(1) : '—'}</td>`;
      case 'p': return r.p ? html`<td><span class="st t-${ST[r.p.st][1]}">${ST[r.p.st][0]}</span> <span class="small" style="color:${patColor(r.p.t)}">${r.p.n}</span></td>` : html`<td class="muted">—</td>`;
      case 'di': return html`<td class="n">${r.p && r.p.di != null ? pc(r.p.di) : '—'}</td>`;
      case 'sig': return html`<td title="${[...r.buy.map(x => '▲ ' + x), ...r.sell.map(x => '▼ ' + x)].join('\n')}">${r.buy.length ? html`<span class="t-ok">▲${r.buy.length}</span> ` : ''}${r.sell.length ? html`<span class="t-bad">▼${r.sell.length}</span>` : ''}${!r.buy.length && !r.sell.length ? html`<span class="muted">—</span>` : ''}</td>`;
      case 'sp': return html`<td>${raw(spark(r.sp, r.m3 >= 0))}</td>`;
      default: { const v = r[c]; return html`<td class="n ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${pc(v)}</td>`; }
    }
  };
  render($('#scTable'), html`<thead><tr>${COLS.map(([c, l, n]) => html`<th class="sort ${n || ''} ${c === 's' ? 'sticky' : ''} ${S.sort === c ? 'sorted' + (S.asc ? ' asc' : '') : ''}" data-c="${c}">${l}</th>`)}</tr></thead>
    <tbody>${R.slice(0, 400).map(r => html`<tr class="click" data-s="${r.s}">${COLS.map(([c]) => cell(r, c))}</tr>`)}</tbody>`);
  $$('#scTable th').forEach(th => { th.onclick = () => { const c = th.dataset.c; if (c === 'sp') return; if (S.sort === c) S.asc = !S.asc; else { S.sort = c; S.asc = c === 's' || c === 'nm'; } table(); }; });
  $$('#scTable tr.click').forEach(tr => { tr.onclick = () => openStock(tr.dataset.s); });
}

export { S as screenerState };
