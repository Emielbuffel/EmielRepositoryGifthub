// The Balance tab: a household balance sheet (portfolio from the app, cash, real estate, other assets, loans and
// margin), a monthly cash-flow analysis (what comes in, what goes out), and ideas on where to save or where to put
// spare cash. Everything is editable and stays on this device.
import { finance, saveFinance, newId, portfolioNow, balanceSheet, cashFlow, COST_CATS } from '../data/finance.js';
import { monthsLeft, illiquidity, marginStress } from '../core/plan.js';
import * as store from '../data/store.js';
import { App, on, go } from '../app.js';
import { $, $$, html, raw, render, big, tok, ago, toast } from './dom.js';
import { donut, flowDiagram, chart, legend } from './viz.js';

const B = { f: null, pf: null };
const eur = x => big(x, 'EUR');
const n0 = x => (x == null || !isFinite(x) ? '—' : Math.round(x).toLocaleString('en-US'));
const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%');

export async function initBalance(el) {
  render(el, html`
    <section class="card" id="bTop"></section>
    <div class="grid2"><section class="card" id="bAssets"></section><section class="card" id="bDebts"></section></div>
    <section class="card" id="bFlow"></section>
    <section class="card" id="bIdeas"></section>
    <p class="disclaimer">Planning aid, not financial, tax or legal advice. Values are what you enter (the portfolio comes from the Portfolio tab). Stored only on this device; included in Settings → Back up my data.</p>`);
  on(type => { if (type === 'view' && App.view === 'balance') load(); if (type === 'cash' || type === 'holdings') load(); });
  await load();
}

async function load() {
  B.f = await finance(); B.pf = await portfolioNow();
  draw();
}
const save = async () => { await saveFinance(B.f); B.f.fromEarlier = false; draw(); };

function draw() {
  const f = B.f, pf = B.pf, bs = balanceSheet(f, pf), cf = cashFlow(f, bs);
  // ---- top
  const kp = (k, v, s, cls = '') => html`<div class="kpi"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="s">${s}</span></div>`;
  const parts = [['Stocks', bs.stocks, '--blue'], ['Cash', bs.cash, '--teal'], ['Real estate', bs.re, '--orange'], ['Pension', bs.pension, '--purple'], ['Other', bs.other, '--indigo']].filter(p => p[1] > 0);
  const dParts = [['Mortgages', bs.mort, '--red'], ['Margin', bs.margin, '--pink'], ['Other debt', bs.otherDebt, '--warn']].filter(p => p[1] > 0);
  const W = Math.max(bs.gross, bs.debt, 1);
  render($('#bTop'), html`<div class="card-head"><h2>Balance sheet</h2><span class="muted tiny">${pf ? `portfolio from the Portfolio tab, ${ago(pf.at)}` : 'open the Portfolio tab once to bring in your portfolio'}</span></div>
    ${f.fromEarlier ? html`<p class="small t-warn" style="margin:0">Pre-filled from your earlier family-wealth dashboard (July 2026): apartment €370,000, mortgages €318,821 at €1,711.86 a month, living costs €3,000 a month. Check and correct them below; your changes are saved.</p>` : ''}
    <div class="kpis">
      ${kp('Net worth', eur(bs.net), 'assets − debts', bs.net >= 0 ? 'up' : 'down')}
      ${kp('Assets', eur(bs.gross), 'gross')}
      ${kp('Debts', eur(bs.debt), bs.margin ? `incl. ${eur(bs.margin)} margin` : 'mortgages and loans')}
      ${bs.ltv != null ? kp('Loan-to-value', pct(bs.ltv), 'mortgages ÷ real estate', bs.ltv > 0.8 ? 'down' : '') : ''}
      ${kp('Left each month', (cf.left >= 0 ? '+' : '') + eur(cf.left), cf.inc ? 'income − all outgoings' : 'add your income below', cf.left >= 0 ? 'up' : 'down')}
      ${cf.rate != null ? kp('Savings rate', pct(cf.rate), 'of net income', cf.rate >= 0.2 ? 'up' : cf.rate < 0.1 ? 'down' : '') : ''}
    </div>
    <div class="bs-viz"><div>${raw(donut(parts.map(p => ({ label: p[0], value: p[1], color: p[2] })), { size: 150, center: eur(bs.gross), sub: 'assets' }))}</div>
    <div class="bs-bars">
      <div class="bs-row"><span>Assets</span><div class="bs-track">${parts.map(p => html`<i style="width:${(p[1] / W * 100).toFixed(2)}%;background:${tok(p[2])}" title="${p[0]} ${eur(p[1])}"></i>`)}</div><b>${eur(bs.gross)}</b></div>
      <div class="bs-row"><span>Debts</span><div class="bs-track">${dParts.map(p => html`<i style="width:${(p[1] / W * 100).toFixed(2)}%;background:${tok(p[2])}" title="${p[0]} ${eur(p[1])}"></i>`)}</div><b>${eur(bs.debt)}</b></div>
      <div class="legend small">${[...parts, ...dParts].map(p => html`<span><i style="background:${tok(p[2])};height:10px;width:10px;border-radius:3px"></i>${p[0]} ${eur(p[1])}</span>`)}</div>
      <div class="bs-row"><span>Net</span><div class="bs-track"><i style="width:${(Math.max(0, bs.net) / W * 100).toFixed(2)}%;background:${tok('--up')}"></i></div><b>${eur(bs.net)}</b></div>
    </div></div>`);

  // ---- assets
  const row = (a, i) => html`<tr><td><input class="input cell" data-a="${i}" data-k="name" value="${a.name}"></td>
    <td><select class="input cell" data-a="${i}" data-k="type">${[['cash', 'Cash / savings'], ['realestate', 'Real estate'], ['pension', 'Pension / insurance'], ['other', 'Other']].map(([k, l]) => html`<option value="${k}" ${a.type === k ? raw('selected') : ''}>${l}</option>`)}</select></td>
    <td class="n"><input class="input cell n" type="number" step="1000" data-a="${i}" data-k="value" value="${a.value}"></td><td><button class="btn sm danger" data-ad="${i}" aria-label="Remove">×</button></td></tr>`;
  render($('#bAssets'), html`<div class="card-head"><h2>Assets</h2><button class="btn sm" id="bAddA">+ Add</button></div>
    <div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>Name</th><th>Type</th><th class="n">Value (EUR)</th><th></th></tr></thead><tbody>
      <tr class="auto"><td><b>Stock portfolio</b><div class="muted tiny">from the app${pf && pf.base && pf.base !== 'EUR' ? ` (in ${pf.base})` : ''}</div></td><td class="small">Stocks</td><td class="n"><b>${pf ? n0(pf.stocks) : '—'}</b></td><td><button class="btn sm" id="bGoP">Open</button></td></tr>
      <tr class="auto"><td><b>Cash at the broker</b><div class="muted tiny">from the app</div></td><td class="small">Cash</td><td class="n"><b>${pf ? n0(Math.max(0, pf.cash)) : '—'}</b></td><td></td></tr>
      ${f.assets.map(row)}
    </tbody></table></div>`);

  // ---- debts
  const lrow = (l, i) => {
    const ml = monthsLeft(+l.balance, +l.rate, +l.payment), int = (+l.balance || 0) * (+l.rate || 0) / 12;
    return html`<tr><td><input class="input cell" data-l="${i}" data-k="name" value="${l.name}" style="min-width:130px"></td>
      <td class="n"><input class="input cell n" type="number" step="1000" data-l="${i}" data-k="balance" value="${l.balance}"></td>
      <td class="n"><input class="input cell n" type="number" step="0.05" data-l="${i}" data-k="rate" value="${(+l.rate * 100).toFixed(2)}" style="width:72px"></td>
      <td class="n"><input class="input cell n" type="number" step="10" data-l="${i}" data-k="payment" value="${l.payment}" style="width:96px"></td>
      <td class="n small">${ml == null ? '—' : ml >= 12 ? (ml / 12).toFixed(1) + ' yr' : ml + ' mo'}<div class="muted tiny">${eur(int)}/mo interest</div></td><td><button class="btn sm danger" data-ld="${i}" aria-label="Remove">×</button></td></tr>`;
  };
  render($('#bDebts'), html`<div class="card-head"><h2>Debts</h2><button class="btn sm" id="bAddL">+ Add</button></div>
    <div class="tbl-wrap"><table class="tbl edit"><thead><tr><th>Name</th><th class="n">Outstanding</th><th class="n">Rate %</th><th class="n">Monthly</th><th class="n">Left</th><th></th></tr></thead><tbody>
      ${f.loans.map(lrow)}
      ${bs.margin ? html`<tr class="auto"><td><b>Margin loan</b><div class="muted tiny">negative broker cash, from the app</div></td><td class="n"><b>${n0(bs.margin)}</b></td><td class="n"><input class="input cell n" type="number" step="0.25" id="bMr" value="${(f.plan.marginRate * 100).toFixed(2)}" style="width:72px"></td><td class="n">${n0(cf.marginInt)}</td><td class="small">callable</td><td></td></tr>` : ''}
    </tbody></table></div>
    ${payoff(f.loans)}
    <p class="muted tiny" style="margin:0">Months left are worked out from the balance, rate and payment (annuity loan). Put the current outstanding balance from your bank's table.</p>`);

  // ---- cash flow
  const out = [...f.costs.map(c => [c.cat || 'Other', +c.monthly || 0]), ['Loan payments', cf.loans], ['Margin interest', cf.marginInt]].filter(x => x[1] > 0);
  const byCat = new Map(); out.forEach(([k, v]) => byCat.set(k, (byCat.get(k) || 0) + v));
  const cats = [...byCat].sort((a, b) => b[1] - a[1]), CW = Math.max(cf.inc, cf.out, 1);
  const PAL = ['--red', '--orange', '--warn', '--pink', '--purple', '--indigo', '--teal', '--blue', '--green', '--muted', '--ink'];
  render($('#bFlow'), html`<div class="card-head"><h2>Cash flow · per month</h2><span class="muted tiny">what comes in and what goes out</span></div>
    ${cf.inc ? raw(flowDiagram(cf.inc, cats.map(([k, v], i) => ({ label: k, value: v, color: PAL[i % PAL.length] })), cf.left, x => eur(x))) : ''}
    <div class="bs-bars" ${cf.inc ? raw('hidden') : ''}>
      <div class="bs-row"><span>In</span><div class="bs-track"><i style="width:${(cf.inc / CW * 100).toFixed(2)}%;background:${tok('--up')}"></i></div><b>${eur(cf.inc)}</b></div>
      <div class="bs-row"><span>Out</span><div class="bs-track">${cats.map(([k, v], i) => html`<i style="width:${(v / CW * 100).toFixed(2)}%;background:${tok(PAL[i % PAL.length])}" title="${k} ${eur(v)}"></i>`)}</div><b>${eur(cf.out)}</b></div>
      <div class="legend small">${cats.map(([k, v], i) => html`<span><i style="background:${tok(PAL[i % PAL.length])};height:10px;width:10px;border-radius:3px"></i>${k} ${eur(v)}${cf.inc ? ' · ' + pct(v / cf.inc) : ''}</span>`)}</div>
    </div>
    <div class="grid2">
      <div><div class="card-head"><h3 style="margin:0">Income</h3><button class="btn sm" id="bAddI">+ Add</button></div>
        <table class="tbl edit"><tbody>${f.income.map((x, i) => html`<tr><td><input class="input cell" data-i="${i}" data-k="name" value="${x.name}"></td><td class="n"><input class="input cell n" type="number" step="50" data-i="${i}" data-k="monthly" value="${x.monthly}"></td><td><button class="btn sm danger" data-id="${i}" aria-label="Remove">×</button></td></tr>`)}</tbody></table></div>
      <div><div class="card-head"><h3 style="margin:0">Costs</h3><button class="btn sm" id="bAddC">+ Add</button></div>
        <table class="tbl edit"><tbody>${f.costs.map((x, i) => html`<tr><td><input class="input cell" data-c="${i}" data-k="name" value="${x.name}"></td><td><select class="input cell" data-c="${i}" data-k="cat">${COST_CATS.map(c => html`<option ${x.cat === c ? raw('selected') : ''}>${c}</option>`)}</select></td><td class="n"><input class="input cell n" type="number" step="10" data-c="${i}" data-k="monthly" value="${x.monthly}"></td><td><button class="btn sm danger" data-cd="${i}" aria-label="Remove">×</button></td></tr>`)}
          <tr class="auto"><td colspan="2">Loan payments <span class="muted tiny">(from Debts)</span></td><td class="n">${n0(cf.loans)}</td><td></td></tr>
          ${cf.marginInt ? html`<tr class="auto"><td colspan="2">Margin interest <span class="muted tiny">(margin × rate ÷ 12)</span></td><td class="n">${n0(cf.marginInt)}</td><td></td></tr>` : ''}</tbody></table></div>
    </div>
    <p class="muted tiny" style="margin:0">Tip: split "Living costs" into categories (housing, food, transport…) for sharper ideas below. Use net monthly amounts; yearly bills ÷ 12.</p>`);
  ideas(bs, cf);
  wire();
}

/** Outstanding balance of every loan over the years until it is repaid. */
function payoff(loans) {
  const L = loans.filter(l => +l.balance > 0 && +l.payment > 0); if (!L.length) return '';
  const st = L.map(l => ({ b: +l.balance, i: (+l.rate || 0) / 12, m: +l.payment })), series = L.map((l, k) => ({ label: l.name, color: ['--red', '--orange', '--pink', '--purple'][k % 4], pts: [] }));
  let interest = 0;
  for (let y = 0; y <= 35; y++) {
    st.forEach((x, k) => series[k].pts.push([y, x.b]));
    if (st.every(x => x.b <= 0)) break;
    for (let mth = 0; mth < 12; mth++) st.forEach(x => { if (x.b > 0) { const int = x.b * x.i; interest += int; x.b = Math.max(0, x.b + int - x.m); } });
  }
  return html`<h3 style="margin:4px 0 0">Debt paid off over time</h3>${raw(chart(series, { W: 440, stacked: true, H: 190, fmt: v => eur(v), xLabel: x => (x ? '+' + x + 'y' : 'now') }))}${raw(legend(series))}
    <p class="small" style="margin:0">Interest still to pay at the current rates: <b>${eur(interest)}</b>.</p>`;
}

/** Plain-language ideas from the numbers: savings rate, safety reserve, expensive debt, margin, costs per category. */
function ideas(bs, cf) {
  const f = B.f, L = [], add = (lvl, t) => L.push([lvl, t]);
  if (!cf.inc) add('info', 'Add your net monthly income (Income above) to see your savings rate and how much you can invest each month.');
  else if (cf.rate < 0) add('bad', `You spend ${eur(-cf.left)} a month more than comes in. Find that first in the largest cost categories below.`);
  else if (cf.rate < 0.1) add('warn', `Savings rate ${pct(cf.rate)}: below 10%. Many planners aim for 15–20%+ of net income.`);
  else if (cf.rate >= 0.2) add('good', `Savings rate ${pct(cf.rate)}: strong. That is ${eur(cf.left)} a month you can direct (see the order below).`);
  else add('info', `Savings rate ${pct(cf.rate)}. Raising it to 20% would free about ${eur(cf.inc * 0.2 - cf.left)} more a month.`);
  // safety reserve
  const il = illiquidity({ netWorth: bs.net, safe: bs.cash, illiquid: Math.max(0, bs.re - bs.mort), monthlyOut: cf.out, reserveMonths: f.plan.reserveMonths });
  if (cf.out) {
    const m = bs.cash / cf.out;
    if (m < 3) add('bad', `Safe cash covers ${m.toFixed(1)} months of outgoings. Build at least 3–6 months (the family-wealth framework uses ${f.plan.reserveMonths} months, ${eur(il.need)}) before taking more risk.`);
    else if (m < f.plan.reserveMonths) add('warn', `Safe cash covers ${m.toFixed(1)} months. The framework's ${f.plan.reserveMonths}-month reserve is ${eur(il.need)}: ${eur(il.gap)} short.`);
    else add('good', `Safe cash covers ${m.toFixed(1)} months of outgoings: the reserve is in place.`);
  }
  // margin
  if (bs.margin) {
    const st = marginStress(bs.margin, bs.stocks), at30 = st.find(x => x.s === -0.3);
    add('bad', `Margin loan ${eur(bs.margin)} costs about ${eur(bs.margin * f.plan.marginRate)} a year and can be called: after a 30% fall the loan would be ${pct(at30.ltv)} of the stocks (${at30.status}). Paying it down is a guaranteed ${pct(f.plan.marginRate, 1)} return and removes the forced-seller risk.`);
  }
  // expensive loans vs cheap mortgage
  f.loans.forEach(l => {
    if (+l.rate >= 0.05) add('warn', `${l.name}: ${pct(+l.rate, 1)} interest. Extra repayments earn that rate risk-free — usually better than investing the same money.`);
    else if (l.kind === 'mortgage' && +l.rate > 0 && +l.rate < 0.03) add('info', `${l.name}: ${pct(+l.rate, 1)} is cheap money. Paying it early earns only ${pct(+l.rate, 1)}; investing the surplus has historically earned more, with more risk.`);
  });
  // cost categories vs common guidelines
  if (cf.inc) {
    const cat = k => f.costs.filter(c => c.cat === k).reduce((s, c) => s + (+c.monthly || 0), 0);
    const housing = cat('Housing (rent, upkeep)') + f.loans.filter(l => l.kind === 'mortgage').reduce((s, l) => s + (+l.payment || 0), 0);
    if (housing / cf.inc > 0.35) add('warn', `Housing (incl. mortgage) is ${pct(housing / cf.inc)} of net income; a common guideline is up to 30–35%.`);
    [['Subscriptions & phone', 0.04, 'review subscriptions you rarely use'], ['Leisure, travel & eating out', 0.15, 'a budget per month makes this easier to steer'], ['Transport', 0.15, 'compare car costs (insurance, leasing, fuel)'], ['Food & groceries', 0.15, 'planning meals and fewer delivery orders usually helps']].forEach(([k, lim, tip]) => {
      const v = cat(k); if (v / cf.inc > lim) add('info', `${k}: ${eur(v)} a month (${pct(v / cf.inc)} of income) — ${tip}.`);
    });
  }
  // where spare cash goes, in order
  const order = [];
  if (cf.out && bs.cash < 3 * cf.out) order.push('build a safety reserve of 3–6 months');
  if (bs.margin) order.push('repay the margin loan');
  if (f.loans.some(l => +l.rate >= 0.05)) order.push('repay loans above 5%');
  if (cf.out && bs.cash < f.plan.reserveMonths * cf.out) order.push(`grow the reserve to ${f.plan.reserveMonths} months (bonds/money market count)`);
  order.push('invest the rest according to your plan (the Plan tab shows which asset classes are under target)');
  render($('#bIdeas'), html`<div class="card-head"><h2>Ideas</h2><button class="btn sm" id="bGoPlan">Open the Plan tab</button></div>
    <ul class="notes">${L.map(([k, t]) => html`<li class="${k}">${t}</li>`)}</ul>
    <h3 style="margin:4px 0 0">Order for spare cash${cf.left > 0 ? ` (${eur(cf.left)} a month)` : ''}</h3>
    <ol class="plan">${order.map(x => html`<li>${x[0].toUpperCase() + x.slice(1)}</li>`)}</ol>
    <p class="muted tiny" style="margin:0">Rules of thumb from common personal-finance practice and the family-wealth framework (safety reserve, callable margin as the main liquidity risk). Your situation (taxes, job security, plans) can justify other choices.</p>`);
}

function wire() {
  const f = B.f, el = $('#view-balance');
  const num = v => (v === '' ? 0 : +v);
  const bind = (attr, list, key = 'k') => $$(`[data-${attr}]`, el).forEach(inp => {
    if (!('k' in inp.dataset)) return;
    inp.onchange = () => { const o = list()[+inp.dataset[attr]], k = inp.dataset.k; o[k] = k === 'name' || k === 'type' || k === 'cat' ? inp.value : k === 'rate' ? num(inp.value) / 100 : num(inp.value); save(); };
  });
  bind('a', () => f.assets); bind('l', () => f.loans); bind('i', () => f.income); bind('c', () => f.costs);
  $$('[data-ad]', el).forEach(b => { b.onclick = () => { f.assets.splice(+b.dataset.ad, 1); save(); }; });
  $$('[data-ld]', el).forEach(b => { b.onclick = () => { f.loans.splice(+b.dataset.ld, 1); save(); }; });
  $$('[data-id]', el).forEach(b => { b.onclick = () => { f.income.splice(+b.dataset.id, 1); save(); }; });
  $$('[data-cd]', el).forEach(b => { b.onclick = () => { f.costs.splice(+b.dataset.cd, 1); save(); }; });
  $('#bAddA').onclick = () => { f.assets.push({ id: newId(), type: 'cash', name: 'New asset', value: 0 }); save(); };
  $('#bAddL').onclick = () => { f.loans.push({ id: newId(), name: 'New loan', balance: 0, rate: 0.04, payment: 0, kind: 'loan' }); save(); };
  $('#bAddI').onclick = () => { f.income.push({ id: newId(), name: 'Income', monthly: 0 }); save(); };
  $('#bAddC').onclick = () => { f.costs.push({ id: newId(), name: 'Cost', cat: 'Other', monthly: 0 }); save(); };
  const mr = $('#bMr'); if (mr) mr.onchange = () => { f.plan.marginRate = num(mr.value) / 100; save(); };
  $('#bGoP').onclick = () => go('portfolio');
  $('#bGoPlan').onclick = () => go('plan');
}
