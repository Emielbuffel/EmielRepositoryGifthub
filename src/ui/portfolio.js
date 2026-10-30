// The Portfolio tab: holdings you enter by hand, analysed on the device: value, P/L, classic sell rules,
// volatility, betas (incl. downside beta), risk contribution, correlations and a stress replay.
import PAT from '../core/pat.js';
import { baseState, pc, fD, fDs, patternPhase } from '../core/analysis.js';
import { phaseTag } from './phase.js';
import { sma } from '../core/indicators.js';
import { analysePortfolio } from '../core/portfolio.js';
import { daily, fxWeekly, isDemo, provider, DataError } from '../data/service.js';
import { currencyOf } from '../data/providers.js';
import * as store from '../data/store.js';
import { App, on, openStock } from '../app.js';
import { $, $$, html, raw, render, money, big, ICON, toast, sheet } from './dom.js';
import { importSheet } from './importui.js';
import { checkNewResults } from '../data/fundamentals.js';
import { drawAccount, loadAccountPrefs } from './account.js';
import { factor } from '../data/fx.js';
import { addAlert, checkBars, allAlerts } from '../data/alerts.js';
import { allPlans, journal, strategy, deletePlan, cashBalance } from '../data/plans.js';
import { sizingChecks, pyramid } from '../core/strategy.js';

const DEMO_HOLD = [{ sym: 'ACME.DEMO', shares: 40, cost: 90 }, { sym: 'IRIS.DEMO', shares: 60, cost: 70 }, { sym: 'LUMA.DEMO', shares: 100, cost: 45 }, { sym: 'FLUX.DEMO', shares: 150, cost: 30 }, { sym: 'JADE.DEMO', shares: 50, cost: 88 }];
const P = { base: 'USD', seq: 0 };
const hkey = () => isDemo() ? 'holdings.demo' : 'holdings.real';

export async function initPortfolio(el) {
  P.base = await store.get('portfolio.base', 'USD'); await loadAccountPrefs();
  render(el, html`
    <section class="card" id="pTop"></section>
    <section class="card" id="pCash"></section>
    <section class="card" id="pEvo"></section>
    <section class="card" id="pMonths"></section>
    <section class="card" id="pIncome"></section>
    <section class="card">
      <div class="card-head"><h2>Holdings</h2><div class="toolbar"><select class="input" id="pBase" style="width:auto;padding:6px 10px;font-size:14px" aria-label="Portfolio currency">${['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'].map(c => html`<option ${c === P.base ? raw('selected') : ''}>${c}</option>`)}</select><button class="btn sm" id="pImp">${raw(ICON.upload)}Import</button><button class="btn sm" id="pStops">${raw(ICON.bell)}Stop alerts</button><button class="btn sm primary" id="pAdd">${raw(ICON.plus)}Add</button></div></div>
      <div id="pHold"></div>
    </section>
    <section class="card" id="pMix"></section>
    <section class="card" id="pFactor"></section>
    <section class="card" id="pPlans"></section>
    <div class="grid2"><section class="card" id="pFlags"></section><section class="card" id="pRisk"></section></div>
    <div class="grid2"><section class="card" id="pCorr"></section><section class="card" id="pStress"></section></div>
    <section class="card" id="pJournal"></section>
    <p class="disclaimer">Educational analysis, not personal investment advice. Values use end-of-day prices and, for other currencies, end-of-day exchange rates. Holdings stay on this device.</p>`);
  $('#pAdd').onclick = () => editHolding();
  const openImport = files => importSheet(hold => { if (hold) { App.holdings = hold; saveHoldings(); } }, files);
  P.openImport = openImport;
  $('#pImp').onclick = () => openImport();
  // drop broker files (several monthly reports at once) anywhere on the Portfolio tab
  el.addEventListener('dragover', e => { if ([...(e.dataTransfer.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); el.classList.add('dropping'); } });
  el.addEventListener('dragleave', e => { if (e.target === el) el.classList.remove('dropping'); });
  el.addEventListener('drop', async e => { const fs = [...(e.dataTransfer.files || [])].filter(f => /\.(csv|txt)$/i.test(f.name)); el.classList.remove('dropping'); if (!fs.length) return; e.preventDefault(); openImport(await Promise.all(fs.map(async f => ({ name: f.name, modified: f.lastModified, text: await f.text() })))); });
  $('#pStops').onclick = async () => {
    const withCost = App.holdings.filter(h => h.cost);
    if (!withCost.length) { toast('Add your average cost to holdings first: stops are set 8% below the cost.'); return; }
    for (const h of withCost) await addAlert({ sym: h.sym, type: 'stop', level: +(h.cost * 0.92).toFixed(4), name: '' });
    toast(`Stop alerts set 8% below cost for ${withCost.length} holding${withCost.length > 1 ? 's' : ''}.`);
  };
  $('#pBase').onchange = () => { P.base = $('#pBase').value; store.set('portfolio.base', P.base); analyse(); };
  on(type => {
    if (type === 'provider' || type === 'holdings') loadHoldings().then(() => { if (App.view === 'portfolio') analyse(); });
    if (type === 'view' && App.view === 'portfolio' && !P.done) analyse();
    if (['plans', 'journal', 'trades', 'provider', 'strategy'].includes(type)) { plansCard(); journalCard(); }
    if ((type === 'cash' || type === 'journal') && P.last) drawAccount(...P.last);
  });
  plansCard(); journalCard();
  await loadHoldings();
  if (App.view === 'portfolio') analyse();
}

async function loadHoldings() { App.holdings = await store.get(hkey(), isDemo() ? DEMO_HOLD : []); P.done = false; }
async function saveHoldings() { await store.set(hkey(), App.holdings); P.done = false; analyse(); }

function editHolding(h) {
  const sh = sheet(h ? 'Edit ' + h.sym : 'Add a holding', html`
    <form class="card" id="hf" style="gap:12px">
      <label class="field"><span>Ticker</span><input class="input" name="sym" required autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="AAPL, ASML.AS, 7203.T" value="${h ? h.sym : ''}" ${h ? raw('readonly') : ''}></label>
      <div class="grid2"><label class="field"><span>Shares</span><input class="input" name="shares" type="number" inputmode="decimal" step="any" min="0" required value="${h ? h.shares : ''}"></label>
      <label class="field"><span>Average cost per share (listing currency, optional)</span><input class="input" name="cost" type="number" inputmode="decimal" step="any" min="0" value="${h && h.cost ? h.cost : ''}"></label></div>
      <div class="toolbar"><button class="btn primary" type="submit">Save</button>${h ? html`<button class="btn danger" type="button" id="hDel">Remove</button>` : ''}</div>
      <p class="muted tiny" style="margin:0">London prices are in pence (GBp). The cost is used for the 7–8% loss-cutting rule.</p>
    </form>`);
  const f = sh.querySelector('#hf');
  f.onsubmit = e => {
    e.preventDefault();
    const sym = f.sym.value.toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, ''), shares = +f.shares.value, cost = +f.cost.value || null;
    if (!sym || !(shares > 0)) return;
    const list = App.holdings.filter(x => x.sym !== sym); const i = App.holdings.findIndex(x => x.sym === sym);
    list.splice(i >= 0 ? i : list.length, 0, { sym, shares, cost });
    App.holdings = list; sh.close(); saveHoldings();
  };
  const del = sh.querySelector('#hDel');
  if (del) del.onclick = () => { App.holdings = App.holdings.filter(x => x.sym !== h.sym); sh.close(); saveHoldings(); };
  setTimeout(() => (h ? f.shares : f.sym).focus(), 50);
}

async function analyse() {
  const seq = ++P.seq; P.strategy = await strategy();
  try { const f = await factor(P.strategy.ccy, P.base); P.capFx = f ? f.v : null; } catch (e) { P.capFx = null; }
  P.cashBase = null;
  try { const c = await cashBalance(); if (c) { const f = await factor(c.cur, P.base); P.cashBase = c.amount * (f ? f.v : 1); } } catch (e) { /* no cash entered */ }
  const top = $('#pTop');
  if (!App.holdings.length) {
    render(top, html`<div class="empty">${raw(ICON.portfolio)}<p><b>No holdings yet.</b><br>Add your positions to see their value, sell signals, risk and hidden correlations. Everything stays on this device.</p><button class="btn primary" id="pFirst">${raw(ICON.plus)}Add a holding</button></div>`);
    $('#pFirst').onclick = () => editHolding();
    ['#pHold', '#pFlags', '#pRisk', '#pCorr', '#pStress'].forEach(id => { $(id).innerHTML = ''; });
    P.last = [[], { base: P.base, bench: null, perAnalysis: [], openImport: P.openImport }]; drawAccount(...P.last);
    return;
  }
  render(top, html`<div class="empty"><span class="spinner"></span><span>Analysing ${App.holdings.length} holdings…</span></div>`);
  const rows = [], errs = []; let refRate = null;
  for (const h of App.holdings) {
    try {
      const d = await daily(h.sym);
      const cur = d.currency || currencyOf(h.sym);
      let fx = await fxWeekly(cur, P.base).catch(() => undefined);
      if (fx === undefined) { const f = await factor(cur, P.base); if (f) { fx = f.v; if (!f.live) refRate = f.date; } }
      const fxNow = fx == null ? 1 : typeof fx === 'number' ? fx : [...fx.values()].pop();
      if (fx === undefined) errs.push(`${h.sym}: no ${cur}→${P.base} rate, shown unconverted`);
      checkBars(h.sym, d.bars, d.name);
      const b = d.bars, n = b.length - 1, c = b[n].close;
      const R = PAT.scan(b), B = baseState(R, b), s50 = sma(b.map(x => x.close), 50)[n], s200 = sma(b.map(x => x.close), 200)[n];
      const sig = [];
      if (h.cost && c <= h.cost * 0.92) sig.push(['bad', `${pc(c / h.cost - 1, 0)} vs your cost: the rule is to cut losses at 7–8%`]);
      if (s200 && c < s200) sig.push(['bad', 'Below the 200-day line']);
      else if (s50 && c < s50) sig.push(['warn', 'Below the 50-day line']);
      if (B.st === 'STOP HIT') sig.push(['bad', '8% under the breakout buy point']);
      if (R.last && R.last.failed && n - R.last.failed <= 10) sig.push(['bad', 'Failed breakout']);
      if (s50 && c / s50 - 1 > 0.25) sig.push(['warn', `${pc(c / s50 - 1, 0)} above the 50-day: consider taking some profit`]);
      if (h.cost && c >= h.cost * 1.2) sig.push(['good', `Up ${pc(c / h.cost - 1, 0)}: the rule of thumb takes most profits at +20–25%`]);
      if (['NEAR BUY POINT', 'IN BUY ZONE'].includes(B.st)) sig.push(['good', (B.p ? B.p.name + ': ' : '') + B.st.toLowerCase()]);
      rows.push({ ...h, d, cur, ph: patternPhase(R, b), fx: fx || null, fxNow: fxNow || 1, c, ch: c / b[n - 1].close - 1, value: h.shares * c * (fxNow || 1), costV: h.cost ? h.shares * h.cost * (fxNow || 1) : null, B, sig, s200: s200 ? c / s200 - 1 : null });
    } catch (e) { errs.push(`${h.sym}: ${e.message}`); if (e instanceof DataError && e.kind === 'auth') break; }
    if (seq !== P.seq) return;
  }
  let bench = null;
  try { const bs = isDemo() ? 'DEMO-500' : 'SPY'; const bd = await daily(bs); bench = { name: isDemo() ? 'Demo 500' : 'S&P 500 (SPY)', bars: bd.bars, fx: await fxWeekly('USD', P.base).catch(() => null) }; } catch (e) { /* no betas */ }
  if (seq !== P.seq) return;
  const A = rows.length ? analysePortfolio(rows.map(r => ({ sym: r.sym, name: r.d.name, value: r.value, bars: r.d.bars, fx: r.fx })), bench, 104, { maxPos: null }) : null;
  P.done = true;
  if (refRate) errs.push(`Some values use reference exchange rates of ${refRate} (live rates load in the desktop app)`);
  draw(rows, A, bench, errs);
  checkNewResults([...new Set([...App.holdings.map(h => h.sym), ...((App.lists || []).flatMap(l => l.syms || []))])].filter(s => !/\.DEMO$/.test(s)));
  P.last = [rows, { base: P.base, bench, perAnalysis: A && !A.error ? A.per : [], openImport: P.openImport }];
  drawAccount(...P.last);
}

function draw(rows, A, bench, errs) {
  const total = rows.reduce((s, r) => s + r.value, 0), costT = rows.reduce((s, r) => s + (r.costV || 0), 0), costed = rows.filter(r => r.costV);
  const pl = costed.length ? costed.reduce((s, r) => s + r.value - r.costV, 0) : null;
  const day = total ? rows.reduce((s, r) => s + r.value * r.ch / (1 + r.ch), 0) : 0;
  const kp = (k, v, s, cls = '') => html`<div class="kpi"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="s">${s || ''}</span></div>`;
  const bad = A && !A.error;
  render($('#pTop'), html`
    <div class="card-head"><h2>Overview</h2><span class="muted tiny">${bad ? `${A.weeks} weeks of weekly returns in ${P.base}, ${fDs(A.from)} – ${fDs(A.to)}` : ''}</span></div>
    <div class="kpis">
      ${kp('Value', big(total, P.base), rows.length + ' positions')}
      ${kp('Today', (day >= 0 ? '+' : '') + big(day, P.base), pc(total ? day / (total - day) : 0, 2), day >= 0 ? 'up' : 'down')}
      ${pl != null ? kp('Gain / loss', (pl >= 0 ? '+' : '') + big(pl, P.base), pc(costT ? pl / (costed.reduce((s, r) => s + r.costV, 0)) : null) + ' on cost', pl >= 0 ? 'up' : 'down') : ''}
      ${bad ? kp('Volatility', (A.vol * 100).toFixed(0) + '%', 'a year (annualised)') : ''}
      ${bad && A.beta != null ? kp('Beta', A.beta.toFixed(2), 'vs ' + (bench ? bench.name : '')) : ''}
      ${bad && A.downBeta != null ? kp('Downside beta', A.downBeta.toFixed(2), 'in falling weeks', A.downBeta > 1.3 ? 't-warn' : '') : ''}
      ${bad ? kp('Max drawdown', pc(A.mdd, 0), 'worst fall from a peak', 't-bad') : ''}
      ${bad ? kp('Effective positions', A.effN.toFixed(1), 'how diversified the weights are') : ''}
    </div>
    ${errs.length ? html`<p class="small t-warn" style="margin:0">${errs.join(' · ')}</p>` : ''}
    ${A && A.error ? html`<p class="small t-warn" style="margin:0">${A.error}</p>` : ''}`);
  const per = new Map((bad ? A.per : []).map(x => [x.sym, x]));
  render($('#pHold'), html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="sticky">Position</th><th class="n">Shares</th><th class="n">Price</th><th class="n">Day</th><th class="n">Value ${P.base}</th><th class="n">Weight</th><th class="n">vs cost</th><th class="n">vs 200-day</th><th class="n">Down β</th><th>Phase</th><th>Signals</th><th></th></tr></thead><tbody>
    ${rows.map(r => { const x = per.get(r.sym); return html`<tr class="click" data-s="${r.sym}"><td class="sticky"><b>${r.sym.replace('.DEMO', '')}</b><div class="muted tiny" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${r.d.name || ''}</div></td>
      <td class="n">${r.shares}</td><td class="n">${money(r.c, r.cur)}</td><td class="n ${r.ch >= 0 ? 'up' : 'down'}">${pc(r.ch, 1)}</td><td class="n">${big(r.value, P.base)}</td><td class="n">${pc(total ? r.value / total : 0, 1).replace('+', '')}</td>
      <td class="n ${r.cost ? (r.c >= r.cost ? 'up' : 'down') : ''}">${r.cost ? pc(r.c / r.cost - 1, 0) : '—'}</td><td class="n ${r.s200 >= 0 ? 'up' : 'down'}">${pc(r.s200, 0)}</td>
      <td class="n ${x && x.downBeta > 1.5 ? 't-warn' : ''}">${x && x.downBeta != null ? x.downBeta.toFixed(2) : '—'}</td>
      <td>${phaseTag(r.ph)}</td>
      <td class="small" style="white-space:normal;min-width:200px">${r.sig.length ? r.sig.map(([k, t]) => html`<div class="${k === 'bad' ? 't-bad' : k === 'warn' ? 't-warn' : 't-ok'}">${k === 'good' ? '▲' : '▼'} ${t}</div>`) : html`<span class="muted">—</span>`}</td>
      <td><button class="btn sm" data-edit="${r.sym}" aria-label="Edit ${r.sym}">Edit</button></td></tr>`; })}
  </tbody></table></div><p class="muted tiny" style="margin:0">Tap a row for its chart and base patterns. Down β = how much the position moved per 1% fall of the benchmark, measured only in weeks the benchmark fell.</p>`);
  $$('#pHold tr.click').forEach(tr => { tr.onclick = e => { if (e.target.closest('[data-edit]')) return; openStock(tr.dataset.s); }; });
  $$('#pHold [data-edit]').forEach(b => { b.onclick = () => editHolding(App.holdings.find(h => h.sym === b.dataset.edit)); });
  if (!bad) { ['#pFlags', '#pRisk', '#pCorr', '#pStress'].forEach(id => { $(id).innerHTML = ''; }); return; }
  // position sizes are measured against the plan capital (e.g. 20% of 208,000 EUR), or the holdings if larger
  const capBase = P.strategy && P.capFx ? P.strategy.capital * P.capFx : 0;
  const posPct = Math.round(((P.strategy || {}).posPct || 0.2) * 100);
  // sizes are measured against the whole account (stocks + cash, margin lowers it); without a cash balance, against
  // the plan capital or the stocks, whichever is larger
  const acct = P.cashBase != null ? total + P.cashBase : Math.max(total, capBase);
  const sizing = sizingChecks(P.strategy || {}, rows.map(r => ({ sym: r.sym, value: r.value, gain: r.cost ? r.c / r.cost - 1 : null })), acct);
  const biggest = [...rows].sort((a, b) => b.value - a.value)[0];
  const sizeOk = !sizing.some(x => x.kind === 'size') && biggest && acct > 0 ? html`<li class="good">Every position is within your ${posPct}% limit. Largest: ${biggest.sym.replace('.DEMO', '')} at ${Math.round(biggest.value / acct * 100)}% of the account${P.cashBase != null ? ' (stocks + cash)' : ''}.</li>` : '';
  render($('#pFlags'), html`<h2>Weak points</h2>${sizing.length || sizeOk ? html`<ul class="notes">${sizeOk}${sizing.map(x => html`<li class="${x.level === 'bad' ? 'bad' : 'warn'}">${x.text.replace(/\.DEMO/g, '')}</li>`)}</ul>` : ''}${A.flags.length ? html`<ul class="notes">${A.flags.map(([k, t]) => html`<li class="${k}">${t.replace(/\.DEMO/g, '')}</li>`)}</ul>` : bench ? html`<ul class="notes"><li class="good">No crash-sensitivity warnings at these weights.</li></ul>` : html`<ul class="notes"><li class="info">Crash sensitivity (downside beta) needs S&P 500 (SPY) prices: they load in the desktop app, or with an FMP key in Settings.</li></ul>`}
    ${rows.some(r => r.sig.some(s => s[0] === 'bad')) ? html`<ul class="notes">${rows.filter(r => r.sig.some(s => s[0] === 'bad')).map(r => html`<li class="bad">${r.sym.replace('.DEMO', '')}: ${r.sig.filter(s => s[0] === 'bad').map(s => s[1]).join('; ')}</li>`)}</ul>` : ''}`);
  const mx = Math.max(...A.per.map(x => Math.max(x.weight, x.rc)));
  render($('#pRisk'), html`<h2>Where the risk comes from</h2><div class="bars">${[...A.per].sort((a, b) => b.rc - a.rc).map(x => html`<div class="brow"><span class="lbl">${x.sym.replace('.DEMO', '')}</span><div style="display:grid;gap:3px"><div class="btrack"><i style="width:${(x.weight / mx * 100).toFixed(1)}%;opacity:.45"></i></div><div class="btrack"><i class="${x.rc > x.weight * 1.4 ? 'hot' : ''}" style="width:${(Math.max(0, x.rc) / mx * 100).toFixed(1)}%"></i></div></div><span class="val">${(x.rc * 100).toFixed(0)}%</span></div>`)}</div>
    <p class="muted tiny" style="margin:0">Top bar: weight. Bottom bar: share of the portfolio's volatility. Orange = a position adds much more risk than its weight.</p>`);
  const heat = c => { if (c == null) return 'transparent'; const a = Math.min(1, Math.abs(c)); return c >= 0 ? `rgba(224,53,43,${(a * 0.85).toFixed(2)})` : `rgba(47,111,235,${(a * 0.85).toFixed(2)})`; };
  const short = s => s.replace('.DEMO', '').slice(0, 6);
  render($('#pCorr'), html`<h2>Hidden correlations</h2><div class="tbl-wrap"><table class="heat"><thead><tr><th></th>${A.per.map(x => html`<th>${short(x.sym)}</th>`)}</tr></thead><tbody>
    ${A.per.map((x, i) => html`<tr><th style="text-align:right">${short(x.sym)}</th>${A.corr[i].map((c, j) => html`<td style="background:${i === j ? 'var(--fill)' : heat(c)};color:${Math.abs(c) > 0.6 && i !== j ? '#fff' : 'inherit'}">${i === j ? '' : c == null ? '' : c.toFixed(2)}</td>`)}</tr>`)}</tbody></table></div>
    <p class="muted tiny" style="margin:0">Weekly return correlations in ${P.base}. Red = move together; blue = move opposite. Average ${A.avgCorr != null ? A.avgCorr.toFixed(2) : '—'}. Markets that close at different times (Asia vs US) look less correlated than they are.</p>`);
  render($('#pStress'), html`<h2>Stress test · replaying a real sell-off</h2>${A.stress ? html`
    <p class="small" style="margin:0">The benchmark's worst fall in the window, ${fDs(A.stress.from)} – ${fDs(A.stress.to)}: <b class="t-bad">${pc(A.stress.bench, 1)}</b>. Your current weights would have returned <b class="${A.stress.port < A.stress.bench ? 't-bad' : 't-ok'}">${pc(A.stress.port, 1)}</b>.</p>
    <div class="bars">${A.per.map((x, i) => html`<div class="brow"><span class="lbl">${x.sym.replace('.DEMO', '')}</span><div class="btrack"><i style="width:${Math.min(100, Math.abs(A.stress.per[i]) * 200).toFixed(1)}%;background:${A.stress.per[i] < 0 ? 'var(--down)' : 'var(--up)'}"></i></div><span class="val ${A.stress.per[i] < 0 ? 'down' : 'up'}">${pc(A.stress.per[i], 0)}</span></div>`)}</div>`
    : html`<p class="muted small" style="margin:0">The benchmark had no fall of more than 5% in the window, so there is nothing to replay.</p>`}
    <p class="muted tiny" style="margin:0">Past sell-offs don't predict future ones; this shows how the current mix behaved when the market last fell.</p>`);
}

/* ---------- buying plans: every open pyramid with its next step ---------- */
const LV = { buy: 't-ok', add: 't-ok', stop: 't-bad', warn: 't-warn', wait: 't-mute', hold: 't-blue' };
async function plansCard() {
  const el = $('#pPlans'); if (!el) return;
  const [plans, S] = await Promise.all([allPlans(), strategy()]), open = plans.filter(p => !p.closed);
  const n0 = x => Math.round(x).toLocaleString('en-US');
  render(el, html`<div class="card-head"><h2>Buying plans</h2><span class="muted tiny">${n0(S.capital * S.posPct)} ${S.ccy} per position · ${S.tranches.map(t => Math.round(t * 100) + '%').join(' / ')} · stop −${Math.round(S.stop * 100)}%</span></div>
    ${open.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th class="n">Buy point</th><th>Bought</th><th>Next step</th><th></th></tr></thead><tbody>
      ${open.map(p => { const st = p.lastStep, py = pyramid(S, p.pivot); return html`<tr class="click" data-s="${p.sym}"><td><b>${p.sym}</b><div class="muted tiny">${p.base || ''}</div></td><td class="n">${p.pivot}</td>
        <td><div class="score-bar" style="width:90px"><i style="width:${Math.min(100, p.buys.length / py.steps.length * 100)}%;background:var(--blue)"></i></div><span class="muted tiny">${p.buys.length} of ${py.steps.length} buys</span></td>
        <td class="small" style="white-space:normal;min-width:220px">${st ? html`<b class="${LV[st.level] || ''}">${st.title}</b><br><span class="muted">${st.text}</span>` : html`<span class="muted">Open the stock (or wait for the next price check) to see the next step.</span>`}</td>
        <td><button class="btn sm danger" data-delp="${p.id}" aria-label="Delete plan">×</button></td></tr>`; })}
    </tbody></table></div>` : html`<p class="muted small" style="margin:0">No buying plans yet. Open a stock with a base and tap <b>Plan</b>: the app works out buy 1 (${Math.round(S.tranches[0] * 100)}%), add 2 at +${Math.round(S.add2[0] * 100)}–${Math.round(S.add2[1] * 100)}% and add 3 at +${Math.round(S.add3[0] * 100)}–${Math.round(S.zone * 100)}%, and alerts you when each step is due.</p>`}`);
  $$('#pPlans tr.click').forEach(tr => { tr.onclick = e => { if (e.target.closest('[data-delp]')) return; openStock(tr.dataset.s); }; });
  $$('#pPlans [data-delp]').forEach(b => { b.onclick = async () => { if (confirm('Delete this plan? Journal entries stay.')) { await deletePlan(b.dataset.delp); plansCard(); } }; });
}

/* ---------- trade journal and review of past trades ---------- */
function roundTrips(trades) {
  // group by stock in time order; a round trip ends when the shares go back to zero
  const by = new Map(); [...trades].sort((a, b) => a.t - b.t).forEach(t => { if (!by.has(t.sym)) by.set(t.sym, []); by.get(t.sym).push(t); });
  const out = [];
  for (const [sym, ts] of by) {
    let cur = null;
    for (const t of ts) {
      if (!cur) cur = { sym, buys: [], sells: [], held: 0, cur: t.cur };
      (t.side === 'buy' ? cur.buys : cur.sells).push(t); cur.held += t.side === 'buy' ? t.shares : -t.shares;
      if (cur.held <= 0 && cur.sells.length) { out.push(cur); cur = null; }
    }
    if (cur) out.push({ ...cur, open: true });
  }
  return out.map(r => {
    const bs = r.buys.reduce((s, t) => s + t.shares, 0), bv = r.buys.reduce((s, t) => s + t.shares * t.price, 0);
    const ss = r.sells.reduce((s, t) => s + t.shares, 0), sv = r.sells.reduce((s, t) => s + t.shares * t.price, 0);
    const avgB = bs ? bv / bs : null, avgS = ss ? sv / ss : null;
    return { ...r, avgB, avgS, ret: avgB && avgS ? avgS / avgB - 1 : null, from: r.buys[0] ? r.buys[0].t : r.sells[0].t, to: (r.sells[r.sells.length - 1] || r.buys[r.buys.length - 1]).t };
  }).sort((a, b) => b.to - a.to);
}
async function journalCard() {
  const el = $('#pJournal'); if (!el) return;
  const J = await journal(), trips = roundTrips(J), closed = trips.filter(t => !t.open && t.ret != null);
  const win = closed.filter(t => t.ret > 0), avgW = win.length ? win.reduce((s, t) => s + t.ret, 0) / win.length : null, loss = closed.filter(t => t.ret <= 0), avgL = loss.length ? loss.reduce((s, t) => s + t.ret, 0) / loss.length : null;
  render(el, html`<div class="card-head"><h2>Trade journal</h2><div class="toolbar">${J.length ? html`<button class="btn sm" id="jCsv">${raw(ICON.upload)}Export CSV</button>` : ''}</div></div>
    ${closed.length ? html`<div class="kpis"><div class="kpi"><span class="k">Closed trades</span><span class="v">${closed.length}</span><span class="s">${win.length} won · ${loss.length} lost</span></div>
      <div class="kpi"><span class="k">Average gain</span><span class="v up">${avgW != null ? pc(avgW, 1) : '—'}</span><span class="s">winners</span></div>
      <div class="kpi"><span class="k">Average loss</span><span class="v down">${avgL != null ? pc(avgL, 1) : '—'}</span><span class="s">losers (keep it under 7–8%)</span></div></div>` : ''}
    ${trips.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th>Period</th><th class="n">Avg buy</th><th class="n">Avg sell</th><th class="n">Result</th><th>Trades</th><th></th></tr></thead><tbody>
      ${trips.map((t, i) => html`<tr><td><b>${t.sym}</b></td><td class="small">${fDs(t.from)}${t.open ? ' → open' : ' → ' + fDs(t.to)}</td><td class="n">${money(t.avgB, t.cur)}</td><td class="n">${t.avgS ? money(t.avgS, t.cur) : '—'}</td>
        <td class="n ${t.ret == null ? '' : t.ret >= 0 ? 'up' : 'down'}">${t.ret == null ? 'open' : pc(t.ret, 1)}</td>
        <td class="small" style="white-space:normal;min-width:200px">${[...t.buys, ...t.sells].sort((a, b) => a.t - b.t).map(x => html`<div>${x.side === 'buy' ? 'B' : 'S'} ${x.shares} @ ${money(x.price, x.cur)} · ${fDs(x.t)}${x.reason ? html` <span class="muted">· ${x.reason}</span>` : ''}</div>`)}</td>
        <td><button class="btn sm" data-review="${i}">Review chart</button></td></tr>`)}
    </tbody></table></div>` : html`<p class="muted small" style="margin:0">Every buy and sell you record (from a stock's <b>Plan</b> button) is kept here with your reasons. Review past trades on the chart to learn from them.</p>`}`);
  $$('#pJournal [data-review]').forEach(b => { b.onclick = () => { const t = trips[+b.dataset.review]; App.pendingZoom = { sym: t.sym, from: t.from, to: t.open ? null : t.to }; openStock(t.sym); }; });
  $('#jCsv') && ($('#jCsv').onclick = () => {
    const rows = [['date', 'symbol', 'side', 'shares', 'price', 'currency', 'step', 'reason', 'note'], ...J.slice().sort((a, b) => a.t - b.t).map(t => [new Date(t.t * 1000).toISOString().slice(0, 10), t.sym, t.side, t.shares, t.price, t.cur || '', t.step || '', t.reason || '', t.note || ''])];
    const csv = rows.map(r => r.map(v => /[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'base-pattern-desk-journal.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

