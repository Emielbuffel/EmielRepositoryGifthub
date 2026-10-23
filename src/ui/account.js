// The account part of the Portfolio tab: cash and margin, deposits/withdrawals, the evolution of the whole
// account (absolute and time-weighted %), what the stocks are made of (sectors, regions, currencies) and their
// factor profile. The holdings rows come from portfolio.js (prices already loaded and converted).
import { createChart, AreaSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { evolution, account } from '../core/perf.js';
import { factorExposure, FACTOR_ETFS } from '../core/factors.js';
import { pc, fDs } from '../core/analysis.js';
import { daily, fxWeekly, isDemo } from '../data/service.js';
import { currencyOf, snapshotMeta, universe } from '../data/providers.js';
import { factor } from '../data/fx.js';
import { cashBalance, setCash, flows, addFlow, deleteFlow, journal } from '../data/plans.js';
import * as store from '../data/store.js';
import { $, $$, html, raw, render, big, money, tok, sheet, toast } from './dom.js';
import { fade } from './chart.js';

const A = { mode: 'value', range: '1Y', chart: null, ctx: null, seq: 0 };
const DAY = 86400, now = () => Math.floor(Date.now() / 1000);
const RANGES = { '3M': 91, '6M': 182, YTD: 'ytd', '1Y': 365, '2Y': 730, '4Y': 1570 };
const n0 = (x, d = 0) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sign = x => (x > 0 ? '+' : '');

/** Lookup (cur, t) → base units per 1 cur, from weekly FX maps (fallback: today's factor). */
async function fxLookup(curs, base) {
  const M = new Map();
  for (const c of new Set(curs)) {
    if (!c || c === base) continue;
    let w = null; try { w = await fxWeekly(c, base); } catch (e) { /* no history */ }
    let f = null; try { const x = await factor(c, base); f = x ? x.v : null; } catch (e) { /* none */ }
    M.set(c, { w, f });
  }
  return (cur, t) => {
    if (!cur || cur === base) return 1;
    const m = M.get(cur); if (!m) return 1;
    if (typeof m.w === 'number') return m.w;
    if (m.w instanceof Map) {
      const d = new Date(t * 1000), wk = t - (t % DAY) - ((d.getUTCDay() + 6) % 7) * DAY;
      for (let i = 0; i < 4; i++) { const v = m.w.get(wk - i * 7 * DAY); if (v) return v; }
    }
    return m.f ?? 1;
  };
}

/** Called by portfolio.js after every analysis. rows: [{sym, shares, value (base), cur, d: {bars, name}}]. */
export async function drawAccount(rows, { base, bench, perAnalysis }) {
  const seq = ++A.seq;
  const cash = await cashBalance(), F = await flows(), J = await journal();
  let cashBase = 0, cashFx = 1;
  if (cash) { try { const f = await factor(cash.cur, base); cashFx = f ? f.v : 1; } catch (e) { /* 1 */ } cashBase = cash.amount * cashFx; }
  const stocks = rows.reduce((s, r) => s + r.value, 0);
  A.ctx = { rows, base, bench, cash, cashBase, F, J, stocks, perAnalysis };
  if (seq !== A.seq) return;
  cashCard(); flowsList();
  if (!rows.length) { ['#pEvo', '#pMix', '#pFactor'].forEach(id => { const e = $(id); if (e) e.innerHTML = ''; }); return; }
  mixCard();
  evoCard();
  factorCard();
}

/* ---------- cash, margin and the split of the account ---------- */
function donut(parts, size = 148) {
  // parts: [{v, color}]; a ring with a small gap between segments
  const tot = parts.reduce((s, p) => s + Math.max(0, p.v), 0) || 1, r = size / 2 - 10, C = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.filter(p => p.v > 0).map(p => { const len = p.v / tot * C, gap = parts.filter(q => q.v > 0).length > 1 ? 2 : 0; const s = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return s; });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--fill)" stroke-width="16"/>${segs.join('')}</svg>`;
}

function cashCard() {
  const { base, cash, cashBase, stocks, rows } = A.ctx, el = $('#pCash'); if (!el) return;
  const a = account(stocks, cashBase);
  const cStock = tok('--blue'), cCash = tok('--teal'), cMargin = tok('--down');
  const parts = cashBase >= 0 ? [{ v: stocks, color: cStock }, { v: cashBase, color: cCash }] : [{ v: a.equity, color: cStock }, { v: a.margin, color: cMargin }];
  const leg = (color, k, v, s) => html`<div class="acc-leg"><i style="background:${color}"></i><span class="k">${k}</span><b>${v}</b><span class="muted small">${s}</span></div>`;
  render(el, html`<div class="card-head"><h2>Account · stocks and cash</h2><div class="toolbar"><button class="btn sm" id="aCash">Edit cash</button><button class="btn sm primary" id="aFlow">Deposit / withdraw</button></div></div>
    <div class="acc">
      <div class="acc-donut">${raw(donut(parts))}<div class="acc-mid"><span class="muted tiny">Account value</span><b>${big(a.equity, base)}</b><span class="muted tiny">${n0(a.equity)} ${base}</span></div></div>
      <div class="acc-legend">
        ${leg(cStock, 'Stocks', big(stocks, base), `${pc(a.stockPct, 0).replace('+', '')} · ${rows.length} positions`)}
        ${cashBase >= 0 ? leg(cCash, 'Cash', big(cashBase, base), cash ? `${pc(a.cashPct, 0).replace('+', '')}${cash.cur !== base ? ` · ${money(cash.amount, cash.cur)}` : ''} · updated ${fDs(cash.at)}` : 'not entered yet')
        : leg(cMargin, 'Margin loan', big(a.margin, base), `you borrow ${pc(a.margin / a.equity, 0).replace('+', '')} of your own money`)}
        <div class="acc-bar" title="Invested share of your own money"><i style="width:${Math.min(100, (a.leverage || 0) * 100).toFixed(1)}%;background:${(a.leverage || 0) > 1 ? cMargin : cStock}"></i>${(a.leverage || 0) > 1 ? html`<i style="width:${Math.min(100, ((a.leverage || 0) - 1) * 100).toFixed(1)}%;background:${cMargin}"></i>` : ''}</div>
        <p class="small" style="margin:0">${a.leverage == null ? '' : a.leverage > 1 ? html`<b class="t-bad">${Math.round(a.leverage * 100)}% invested</b> — you hold more stock than the account is worth, using margin. Losses grow by the same factor.` : html`<b>${Math.round(a.leverage * 100)}% invested</b>, ${Math.round((1 - a.leverage) * 100)}% in cash. Compare this with the market exposure the Market tab suggests.`}</p>
      </div>
    </div>
    ${cash ? '' : html`<p class="small t-warn" style="margin:0">Enter your cash (or import a broker statement that lists it) to see the whole account and its evolution.</p>`}
    <div id="aFlows"></div>`);
  $('#aCash').onclick = editCash; $('#aFlow').onclick = () => editFlow();
}

function editCash() {
  const { cash, base } = A.ctx;
  const sh = sheet('Cash balance', html`<form class="card" id="cf" style="gap:12px">
    <div class="grid2"><label class="field"><span>Cash (negative = margin loan)</span><input class="input" name="amount" type="number" step="any" required value="${cash ? cash.amount : ''}" placeholder="119217.44"></label>
    <label class="field"><span>Currency</span><select class="input" name="cur">${['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'].map(c => html`<option ${c === (cash ? cash.cur : base) ? raw('selected') : ''}>${c}</option>`)}</select></label></div>
    <div class="toolbar"><button class="btn primary" type="submit">Save</button></div>
    <p class="muted tiny" style="margin:0">Use the cash shown by your broker, including money-market "cash funds". This only sets today's balance: to record money you added or took out, use <b>Deposit / withdraw</b>, so it isn't counted as profit or loss.</p></form>`);
  const f = sh.querySelector('#cf');
  f.onsubmit = async e => { e.preventDefault(); await setCash(+f.amount.value, f.cur.value); sh.close(); toast('Cash saved.'); };
  setTimeout(() => f.amount.focus(), 50);
}

function editFlow() {
  const { cash, base } = A.ctx, cur = cash ? cash.cur : base;
  const sh = sheet('Deposit or withdrawal', html`<form class="card" id="ff" style="gap:12px">
    <div class="seg" role="group"><button type="button" class="on" data-k="in">Deposit</button><button type="button" data-k="out">Withdrawal</button></div>
    <div class="grid2"><label class="field"><span>Amount (${cur})</span><input class="input" name="amount" type="number" step="any" min="0" required></label>
    <label class="field"><span>Date</span><input class="input" name="date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label></div>
    <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="80"></label>
    <label class="small"><input type="checkbox" name="adj" checked> Also change my cash balance by this amount</label>
    <div class="toolbar"><button class="btn primary" type="submit">Save</button></div>
    <p class="muted tiny" style="margin:0">Deposits and withdrawals are left out of the % return: adding 10,000 doesn't make you 10,000 richer from investing. Untick the box when the cash you entered already includes this money.</p></form>`);
  const f = sh.querySelector('#ff'); let dir = 1;
  $$('[data-k]', f).forEach(b => { b.onclick = () => { dir = b.dataset.k === 'in' ? 1 : -1; $$('[data-k]', f).forEach(x => x.classList.toggle('on', x === b)); }; });
  f.onsubmit = async e => {
    e.preventDefault(); const amt = +f.amount.value; if (!(amt > 0)) return;
    const t = Math.floor(Date.parse(f.date.value + 'T12:00:00Z') / 1000);
    await addFlow({ t, amount: dir * amt, cur, note: f.note.value.trim() }, { keepCash: !f.adj.checked || !cash });
    sh.close(); toast(dir > 0 ? 'Deposit recorded.' : 'Withdrawal recorded.');
  };
  setTimeout(() => f.amount.focus(), 50);
}

function flowsList() {
  const el = $('#aFlows'); if (!el) return;
  const { F } = A.ctx;
  if (!F.length) { render(el, html`<p class="muted tiny" style="margin:0">No deposits or withdrawals recorded. Add them so the % return isn't distorted by money you move in or out.</p>`); return; }
  const net = F.reduce((s, f) => s + f.amount, 0), cur = F[F.length - 1].cur;
  render(el, html`<details class="acc-flows"><summary class="small"><b>Deposits and withdrawals</b> · ${F.length} recorded · net ${sign(net)}${money(net, cur)}</summary>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="n">Amount</th><th>Note</th><th></th></tr></thead><tbody>
    ${[...F].reverse().map(f => html`<tr><td class="small">${fDs(f.t)}</td><td class="n ${f.amount >= 0 ? 'up' : 'down'}">${sign(f.amount)}${money(f.amount, f.cur)}</td><td class="small">${f.note || ''}</td><td><button class="btn sm danger" data-delf="${f.id}" aria-label="Delete">×</button></td></tr>`)}
    </tbody></table></div></details>`);
  $$('[data-delf]', el).forEach(b => { b.onclick = async () => { if (confirm('Delete this entry? If it changed your cash balance, that change is undone.')) await deleteFlow(b.dataset.delf); }; });
}

/* ---------- evolution of the account ---------- */
async function evoCard() {
  const el = $('#pEvo'); if (!el) return;
  const { rows, base, cash, cashBase, F, J, bench } = A.ctx, seq = A.seq;
  render(el, html`<div class="card-head"><h2>Evolution of the account</h2><div class="toolbar">
      <div class="seg" id="eMode"><button data-m="value" class="${A.mode === 'value' ? 'on' : ''}">${base}</button><button data-m="pct" class="${A.mode === 'pct' ? 'on' : ''}">Return %</button></div>
      <div class="seg" id="eRange">${Object.keys(RANGES).map(k => html`<button data-r="${k}" class="${A.range === k ? 'on' : ''}">${k}</button>`)}</div></div></div>
    <div class="kpis" id="eKpi"><div class="empty"><span class="spinner"></span><span>Rebuilding the history…</span></div></div>
    <div class="evo-chart" id="eChart"></div><div class="small" id="eLegend"></div><div id="eNote"></div>`);
  $$('#eMode [data-m]').forEach(b => { b.onclick = () => { A.mode = b.dataset.m; store.set('evo.mode', A.mode); evoCard(); }; });
  $$('#eRange [data-r]').forEach(b => { b.onclick = () => { A.range = b.dataset.r; store.set('evo.range', A.range); evoCard(); }; });
  // prices for every stock held now or traded in the journal
  const prices = {}, cur = {};
  rows.forEach(r => { prices[r.sym] = r.d.bars; cur[r.sym] = r.cur; });
  for (const s of new Set(J.map(t => t.sym))) {
    if (prices[s]) continue;
    try { const d = await daily(s); prices[s] = d.bars; cur[s] = d.currency || currencyOf(s); } catch (e) { cur[s] = currencyOf(s); }
  }
  if (seq !== A.seq) return;
  const fx = await fxLookup([...Object.values(cur), ...F.map(f => f.cur), ...J.map(t => t.cur)], base);
  const r = RANGES[A.range], t0 = r === 'ytd' ? Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000) : now() - r * DAY;
  const trades = J.map(t => ({ t: t.t, sym: t.sym, side: t.side, shares: t.shares, price: t.price, cur: t.cur || cur[t.sym] }));
  const fl = F.map(f => ({ t: f.t, amount: f.amount * fx(f.cur, f.t) }));
  const E = evolution({ holdings: rows.map(x => ({ sym: x.sym, shares: x.shares })), cash: cashBase, prices, fx, cur, trades, flows: fl, from: t0 });
  if (seq !== A.seq) return;
  if (!E || E.days.length < 3) { render($('#eKpi'), html`<p class="muted small" style="margin:0">Not enough price history for this range yet.</p>`); return; }
  // exact history starts when the account was first entered (or at the first journal trade, if earlier); before
  // that the line assumes today's holdings and cash
  const firstRec = Math.min(...[...J.map(t => t.t), cash ? cash.since || cash.at : Infinity].filter(isFinite));
  const recFrom = isFinite(firstRec) ? Math.floor(firstRec / DAY) * DAY : Infinity;
  // benchmark in the base currency, rebased to the start
  let bRet = null;
  if (bench && bench.bars) {
    const bb = bench.bars, bfx = t => fx('USD', t), b0 = bb.findIndex(b => b.time >= E.days[0].t);
    if (b0 >= 0) { const v0 = bb[b0].close * bfx(bb[b0].time); bRet = bb.slice(b0).map(b => ({ time: b.time, value: (b.close * bfx(b.time) / v0 - 1) * 100 })); }
  }
  const kp = (k, v, s, cls = '') => html`<div class="kpi"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="s">${s || ''}</span></div>`;
  const bEnd = bRet && bRet.length ? bRet[bRet.length - 1].value / 100 : null;
  render($('#eKpi'), html`
    ${kp('Return (time-weighted)', pc(E.twr, 1), bEnd != null ? `${bench.name}: ${pc(bEnd, 1)}` : 'deposits and withdrawals left out', E.twr >= 0 ? 'up' : 'down')}
    ${kp('Money made', sign(E.made) + big(E.made, base), 'gains minus losses, in ' + base, E.made >= 0 ? 'up' : 'down')}
    ${kp('Net deposits', sign(E.netFlows) + big(E.netFlows, base), E.netFlows ? 'added (+) or taken out (−)' : 'none recorded in this range')}
    ${kp('Value', big(E.end, base), `was ${big(E.start, base)} on ${fDs(E.days[0].t)}`)}
    ${kp('Max drawdown', pc(E.mdd, 1), 'worst fall from a peak (time-weighted)', 't-bad')}`);
  drawEvo(E, recFrom, bRet);
  const sim = recFrom > E.days[0].t;
  render($('#eNote'), html`<p class="muted tiny" style="margin:0">${sim ? html`<b>Lighter line = reconstruction:</b> before ${isFinite(recFrom) ? fDs(recFrom) : 'today'} the app doesn't know your holdings, so it shows today's holdings and cash as if you had held them (deposits you recorded are still taken into account). From then on the line is exact as long as you record buys and sells (Plan button, or import statements regularly) and deposits/withdrawals. ` : ''}
    <b>How the % is calculated:</b> each day's return leaves out that day's deposits and withdrawals, and the days are chained (time-weighted return). Example: 1,000 grows to 2,000 (+100%), then you withdraw 1,000. The account is back at 1,000, but the return stays +100% and "money made" is +1,000 — 1,000 of it taken out. Margin: a negative cash balance lowers the value and raises the swings.</p>`);
}

function drawEvo(E, recFrom, bRet) {
  const el = $('#eChart'); if (!el) return;
  if (A.chart) { try { A.chart.remove(); } catch (e) { /* gone */ } A.chart = null; }
  const blue = tok('--blue'), muted = tok('--muted');
  const pct = A.mode === 'pct';
  const chart = A.chart = createChart(el, { autoSize: true, layout: { background: { type: 'solid', color: tok('--bg2') }, textColor: muted, fontFamily: tok('--mono'), fontSize: 10, attributionLogo: true }, grid: { vertLines: { visible: false }, horzLines: { color: tok('--grid') } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, handleScroll: false, handleScale: false, crosshair: { horzLine: { labelVisible: true } }, localization: { priceFormatter: v => pct ? v.toFixed(1) + '%' : big(v, A.ctx.base) } });
  const val = d => pct ? d.twr * 100 : d.equity;
  const simD = E.days.filter(d => d.t <= recFrom), recD = E.days.filter(d => d.t >= recFrom);
  const area = (data, line, top, last) => { const s = chart.addSeries(AreaSeries, { lineColor: line, topColor: top, bottomColor: fade(blue, 0), lineWidth: 2, priceLineVisible: false, lastValueVisible: last }); s.setData(data); return s; };
  const line = (data, c, w = 1.5, last = false) => { const s = chart.addSeries(LineSeries, { color: c, lineWidth: w, priceLineVisible: false, lastValueVisible: last, crosshairMarkerVisible: false }); s.setData(data); return s; };
  let main = null;
  if (simD.length > 1) main = area(simD.map(d => ({ time: d.t, value: val(d) })), fade(blue, 0.4), fade(blue, 0.06), recD.length < 2);
  if (recD.length > 1) main = area(recD.map(d => ({ time: d.t, value: val(d) })), blue, fade(blue, 0.22), true);
  const legend = [[blue, pct ? 'Your return (time-weighted)' : 'Account value (stocks + cash)']];
  if (!pct) {
    line(E.days.map(d => ({ time: d.t, value: d.stocks })), tok('--indigo'), 1.5); legend.push([tok('--indigo'), 'Stocks']);
    line(E.days.map(d => ({ time: d.t, value: d.cash })), tok('--teal'), 1.5); legend.push([tok('--teal'), 'Cash (below 0 = margin)']);
  } else if (bRet) { line(bRet, tok('--orange'), 1.5, true); legend.push([tok('--orange'), A.ctx.bench.name]); }
  // deposits / withdrawals as markers
  const mk = E.days.filter(d => d.flow).map(d => ({ time: d.t, position: d.flow > 0 ? 'belowBar' : 'aboveBar', shape: d.flow > 0 ? 'arrowUp' : 'arrowDown', color: d.flow > 0 ? tok('--up') : tok('--down'), text: (d.flow > 0 ? '+' : '−') + big(Math.abs(d.flow), A.ctx.base).replace('−', '') }));
  if (mk.length && main) createSeriesMarkers(main, mk);
  if (mk.length) legend.push([tok('--up'), 'Deposit ▲ / withdrawal ▼']);
  chart.timeScale().fitContent();
  render($('#eLegend'), html`<div class="legend">${legend.map(([c, t]) => html`<span><i style="background:${c}"></i>${t}</span>`)}</div>`);
}

/* ---------- composition of the stock part ---------- */
let classP = null;
async function classes() {
  if (!classP) classP = (async () => {
    const m = new Map();
    try { const u = await universe(); u.items.forEach(([s, , region, sector]) => m.set(s, { sector, region })); } catch (e) { /* none */ }
    try { const meta = await snapshotMeta(); meta.stocks.forEach(x => { const o = m.get(x.s) || {}; m.set(x.s, { sector: o.sector || x.g, region: o.region || x.x, rs: x.r }); }); } catch (e) { /* none */ }
    return m;
  })();
  return classP;
}
const REGION = { US: 'United States', DE: 'Germany', FR: 'France', NL: 'Netherlands', GB: 'United Kingdom', UK: 'United Kingdom', CH: 'Switzerland', JP: 'Japan', HK: 'Hong Kong', KR: 'South Korea', SE: 'Sweden', DK: 'Denmark', FI: 'Finland', NO: 'Norway', IT: 'Italy', ES: 'Spain', BE: 'Belgium', IE: 'Ireland', AT: 'Austria', PT: 'Portugal' };
const SFX_REGION = { DE: 'Germany', F: 'Germany', PA: 'France', AS: 'Netherlands', L: 'United Kingdom', SW: 'Switzerland', T: 'Japan', HK: 'Hong Kong', KS: 'South Korea', KQ: 'South Korea', ST: 'Sweden', CO: 'Denmark', HE: 'Finland', OL: 'Norway', MI: 'Italy', MC: 'Spain', BR: 'Belgium', IR: 'Ireland', VI: 'Austria', LS: 'Portugal' };
const PALETTE = ['--blue', '--teal', '--indigo', '--orange', '--purple', '--green', '--pink', '--yellow', '--red'];

async function mixCard() {
  const el = $('#pMix'); if (!el) return;
  const { rows, stocks, cashBase, base } = A.ctx, C = await classes();
  const group = key => {
    const m = new Map(); rows.forEach(r => { const k = key(r) || 'Not classified'; m.set(k, (m.get(k) || 0) + r.value); });
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const region = r => { const c = C.get(r.sym); if (c && c.region) return REGION[c.region] || c.region; const sfx = r.sym.includes('.') ? r.sym.split('.').pop() : ''; return sfx ? SFX_REGION[sfx] : 'United States'; };
  const G = [['Sectors', group(r => (C.get(r.sym) || {}).sector)], ['Regions', group(region)], ['Currencies', group(r => r.cur === 'GBp' ? 'GBP' : r.cur)]];
  const stack = list => html`<div class="mix-stack">${list.map(([k, v], i) => html`<i title="${k} ${pc(v / stocks, 0).replace('+', '')}" style="width:${(v / stocks * 100).toFixed(2)}%;background:${tok(PALETTE[i % PALETTE.length])}"></i>`)}</div>`;
  const top = G[0][1][0];
  render(el, html`<div class="card-head"><h2>What your stocks are made of</h2><span class="muted tiny">share of the ${big(stocks, base)} in stocks${cashBase > 0 ? ` · cash is ${pc(cashBase / (stocks + cashBase), 0).replace('+', '')} of the account` : ''}</span></div>
    <div class="mix">${G.map(([title, list]) => html`<div class="mix-col"><h3>${title}</h3>${stack(list)}
      <ul class="mix-list">${list.map(([k, v], i) => html`<li><i style="background:${tok(PALETTE[i % PALETTE.length])}"></i><span>${k}</span><b>${pc(v / stocks, 0).replace('+', '')}</b><span class="muted tiny">${big(v, base)}</span></li>`)}</ul></div>`)}</div>
    ${top && top[1] / stocks > 0.4 ? html`<p class="small t-warn" style="margin:0">${top[0]} is ${pc(top[1] / stocks, 0).replace('+', '')} of your stocks. O'Neil's advice is to own the leaders of the leading groups, but most of a portfolio in one sector moves as one bet.</p>` : ''}
    <p class="muted tiny" style="margin:0">Sectors follow the GICS-style labels of the built-in stock list; stocks outside it show as "Not classified".</p>`);
}

/* ---------- factor profile ---------- */
async function factorCard() {
  const el = $('#pFactor'); if (!el) return;
  const { rows, stocks, bench, perAnalysis } = A.ctx, seq = A.seq, C = await classes();
  const w = Object.fromEntries(rows.map(r => [r.sym, r.value / stocks]));
  const wavg = f => { let s = 0, ws = 0; rows.forEach(r => { const v = f(r); if (v != null && isFinite(v)) { s += w[r.sym] * v; ws += w[r.sym]; } }); return ws > 0.5 ? s / ws : null; };
  const mom = b => { const n = b.length - 1; return n > 252 ? b[n - 21].close / b[n - 252].close - 1 : null; };
  const offHigh = b => { const n = b.length - 1, hi = Math.max(...b.slice(-252).map(x => x.high)); return b[n].close / hi - 1; };
  const per = new Map((perAnalysis || []).map(x => [x.sym, x]));
  const ch = {
    beta: wavg(r => (per.get(r.sym) || {}).beta), vol: wavg(r => (per.get(r.sym) || {}).vol),
    mom: wavg(r => mom(r.d.bars)), off: wavg(r => offHigh(r.d.bars)), rs: wavg(r => (C.get(r.sym) || {}).rs),
  };
  const bm = bench && bench.bars ? { mom: mom(bench.bars), off: offHigh(bench.bars) } : {};
  const tile = (k, v, s, read) => html`<div class="kpi"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span><span class="s"><b>${read}</b></span></div>`;
  const chars = html`<div class="kpis">
    ${ch.beta != null ? tile('Market beta', ch.beta.toFixed(2), 'weighted average, weekly vs S&P 500', ch.beta > 1.15 ? 'Swings more than the market' : ch.beta < 0.85 ? 'Swings less than the market' : 'Moves about like the market') : ''}
    ${ch.vol != null ? tile('Volatility', (ch.vol * 100).toFixed(0) + '%', 'average of the stocks, a year', ch.vol > 0.4 ? 'High: expect big swings' : ch.vol > 0.25 ? 'Normal for growth stocks' : 'Calm stocks') : ''}
    ${ch.mom != null ? tile('Momentum (12–1 months)', pc(ch.mom, 0), bm.mom != null ? 'S&P 500: ' + pc(bm.mom, 0) : 'return over 11 months', bm.mom != null ? (ch.mom > bm.mom + 0.1 ? 'Recent winners: a momentum tilt' : ch.mom < bm.mom - 0.1 ? 'Laggards: no momentum tilt' : 'In line with the market') : '') : ''}
    ${ch.off != null ? tile('Distance from 52-week high', pc(ch.off, 0), bm.off != null ? 'S&P 500: ' + pc(bm.off, 0) : 'weighted', ch.off > -0.1 ? 'Near highs, where leaders trade' : ch.off < -0.25 ? 'Well off the highs: weak by O\'Neil\'s rules' : 'Correcting') : ''}
    ${ch.rs != null ? tile('RS rating (approx.)', Math.round(ch.rs), 'weighted, 1–99 in the built-in list', ch.rs >= 80 ? 'Strong: leaders' : ch.rs >= 60 ? 'Average' : 'Weak: laggards') : ''}
  </div>`;
  render(el, html`<div class="card-head"><h2>Factor analysis</h2><span class="muted tiny">the styles your stocks lean towards</span></div>${chars}<div id="fReg"><div class="empty"><span class="spinner"></span><span>Loading factor ETFs…</span></div></div>`);
  // regression on ETF factors (needs the live data of the desktop app: the ETFs aren't in the built-in data)
  const bars = Object.fromEntries(rows.map(r => [r.sym, r.d.bars]));
  let missing = isDemo();
  if (!missing) for (const s of FACTOR_ETFS) { try { bars[s] = (await daily(s)).bars; } catch (e) { missing = true; break; } if (seq !== A.seq) return; }
  const R = missing ? null : factorExposure(w, bars, 104);
  if (seq !== A.seq) return;
  if (!R) { render($('#fReg'), html`<p class="muted small" style="margin:0">The factor regression needs daily prices of ${FACTOR_ETFS.join(', ')} (S&P 500, small caps, value, growth, momentum, quality and low-volatility ETFs). ${missing ? 'They load in the desktop app, not in the web preview.' : 'At least 30 weeks of shared history are needed.'}</p>`); return; }
  const mx = Math.max(1.2, ...R.factors.map(f => Math.abs(f.beta)));
  render($('#fReg'), html`<h3 style="margin:4px 0 0">Factor regression · last ${R.weeks} weeks</h3>
    <div class="fbars">${R.factors.map(f => { const clear = f.t != null && Math.abs(f.t) >= 2; const wd = Math.min(50, Math.abs(f.beta) / mx * 50); return html`<div class="frow" title="${f.about}"><span class="lbl">${f.name}</span><div class="ftrack"><span class="zero"></span><i style="${f.beta >= 0 ? `left:50%` : `right:50%`};width:${wd.toFixed(1)}%;background:${clear ? (f.beta >= 0 ? 'var(--blue)' : 'var(--orange)') : 'var(--muted)'};opacity:${clear ? 1 : 0.45}"></i></div><span class="val">${f.beta >= 0 ? '+' : ''}${f.beta.toFixed(2)}</span><span class="muted tiny">${clear ? 'clear' : 'weak'}</span></div>`; })}</div>
    <ul class="notes">${R.factors.filter(f => f.t != null && Math.abs(f.t) >= 2 && f.name !== 'Market').map(f => html`<li class="info"><b>${f.name} ${f.beta > 0 ? 'tilt' : 'tilt away'}:</b> ${f.about}</li>`)}
      <li class="info">The factors explain ${Math.round((R.r2 || 0) * 100)}% of the weekly ups and downs; the rest is stock-specific. Yearly alpha (return not explained by the factors): ${pc(R.alpha * 52, 1)} — a backward-looking estimate, not a forecast.</li></ul>
    <p class="muted tiny" style="margin:0">How: weekly returns of today's stock weights, explained by ETF return gaps (Size = IWM − SPY, Value = VTV − VUG, Momentum = MTUM − SPY, Quality = QUAL − SPY, Low volatility = USMV − SPY). Grey bars are not statistically clear (|t| below 2). Returns in each stock's own currency.</p>`);
}

export async function loadAccountPrefs() { A.mode = await store.get('evo.mode', 'value'); A.range = await store.get('evo.range', '1Y'); }
