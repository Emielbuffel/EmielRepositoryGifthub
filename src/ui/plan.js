// The Plan tab: targets for 10, 20 and 30 years (and a multi-generation goal), the odds of reaching them,
// what the capital could pay out, and the family-wealth framework from earlier work — allocation against
// endowment-style targets, rebalancing bands, the illiquidity budget and margin stress — plus a cross-asset
// comparison of what else could be added.
import { finance, saveFinance, portfolioNow, portfolioHistory, balanceSheet, cashFlow } from '../data/finance.js';
import { fv, path, requiredMonthly, requiredReturn, monteCarlo, withdrawals, CLASSES, PRESETS, drift, illiquidity, marginStress, ASSETS } from '../core/plan.js';
import { App, on, go } from '../app.js';
import { $, $$, html, raw, render, big, tok } from './dom.js';

const P = { f: null, pf: null, hist: null };
const eur = x => big(x, 'EUR');
const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%');

export async function initPlan(el) {
  render(el, html`
    <section class="card" id="plSet"></section>
    <section class="card" id="plGoals"></section>
    <div class="grid2"><section class="card" id="plAlloc"></section><section class="card" id="plLiq"></section></div>
    <section class="card" id="plCross"></section>
    <p class="disclaimer">Planning analysis, not investment, tax or legal advice. Projections use assumptions you can change; markets do not follow averages. The method follows the household endowment framework (multi-generation preservation) from your earlier family-wealth dashboard.</p>`);
  on(type => { if ((type === 'view' && App.view === 'plan') || type === 'finance') load(); });
  await load();
}

async function load() {
  [P.f, P.pf, P.hist] = await Promise.all([finance(), portfolioNow(), portfolioHistory()]);
  draw();
}
const save = async () => { await saveFinance(P.f); draw(); };

function draw() {
  const f = P.f, pl = f.plan, bs = balanceSheet(f, P.pf), cf = cashFlow(f, bs);
  const investable = bs.stocks + bs.cash - bs.margin + (pl.other.fi || 0) + (pl.other.ra || 0) + (pl.other.pe || 0) + (pl.other.hf || 0);
  const histR = P.hist && P.hist.ann != null ? P.hist.ann : null;
  // ---- settings
  render($('#plSet'), html`<div class="card-head"><h2>Your plan</h2><span class="muted tiny">starting point: investable ${eur(investable)} · net worth ${eur(bs.net)}</span></div>
    <div class="plan-grid">
      <label class="field"><span>Added each month (EUR)</span><input class="input" type="number" step="100" data-p="monthly" value="${pl.monthly}"></label>
      <label class="field"><span>Expected yearly return (%)</span><input class="input" type="number" step="0.25" data-p="ret" data-pct="1" value="${(pl.ret * 100).toFixed(2)}"></label>
      <label class="field"><span>Volatility (%)</span><input class="input" type="number" step="1" data-p="vol" data-pct="1" value="${(pl.vol * 100).toFixed(0)}"></label>
      <label class="field"><span>Inflation (%)</span><input class="input" type="number" step="0.25" data-p="infl" data-pct="1" value="${(pl.infl * 100).toFixed(2)}"></label>
    </div>
    <div class="chips">${[['Your history', histR], ['Preservation mix ~6%', 0.06], ['Global equities ~7%', 0.07], ['Balanced 60/40 ~5%', 0.05]].filter(x => x[1] != null).map(([l, r]) => html`<button class="chip" data-ret="${r}">${l}${l === 'Your history' ? ' ' + pct(r, 1) : ''}</button>`)}</div>
    <p class="muted tiny" style="margin:0">The framework uses a de-levered, diversified return (~6% nominal) for long horizons rather than the return of a leveraged or concentrated book. ${histR != null ? `Your monthly statements show ${pct(histR, 1)} a year over ${P.hist.yrs.toFixed(1)} years.` : 'Import monthly statements on the Portfolio tab to see your own historical return.'} Investable = stocks + broker cash − margin + other investments you enter under Allocation.</p>`);

  // ---- goals and odds
  const T = pl.targets, maxY = Math.max(30, ...T.map(t => t.years));
  const mc = monteCarlo(investable, pl.ret, pl.vol, pl.monthly, maxY, { targets: T.map(t => ({ years: t.years, value: t.value })) });
  const W = 720, H = 260, l = 64, r = 16, top = 12, bot = 26, ymax = Math.max(...mc.bands.map(b => b.p90), ...T.map(t => t.value)) * 1.05;
  const X = y => l + y / maxY * (W - l - r), Y = v => top + (1 - v / ymax) * (H - top - bot);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = ymax * k / 4; g += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${l - 6}" y="${Y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${eur(v)}</text>`; }
  for (let y = 0; y <= maxY; y += 5) g += `<text x="${X(y)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${y ? '+' + y + 'y' : 'now'}</text>`;
  const band = mc.bands.map(b => `${X(b.y)},${Y(b.p90)}`).join(' ') + ' ' + [...mc.bands].reverse().map(b => `${X(b.y)},${Y(b.p10)}`).join(' ');
  g += `<polygon points="${band}" fill="${tok('--blue')}" opacity=".15"/>`;
  g += `<polyline fill="none" stroke="${tok('--blue')}" stroke-width="2.4" points="${mc.bands.map(b => `${X(b.y)},${Y(b.p50)}`).join(' ')}"/>`;
  const real = path(investable, pl.ret, pl.monthly, maxY, pl.infl);
  g += `<polyline fill="none" stroke="${tok('--muted')}" stroke-dasharray="4 3" stroke-width="1.5" points="${real.map(p => `${X(p.y)},${Y(p.real)}`).join(' ')}"/>`;
  T.forEach((t, i) => { g += `<circle cx="${X(t.years)}" cy="${Y(t.value)}" r="6" fill="${tok('--orange')}"><title>Target in ${t.years} years: ${eur(t.value)}</title></circle><text x="${X(t.years)}" y="${Y(t.value) - 10}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${tok('--orange')}">${eur(t.value)}</text>`; });
  const res = T.map((t, i) => {
    const med = mc.bands[t.years].p50, need = requiredMonthly(investable, pl.ret, t.value, t.years), rr = requiredReturn(investable, pl.monthly, t.value, t.years), p = mc.odds[i];
    return { ...t, med, need, rr, p, real: fv(investable, pl.ret, pl.monthly, t.years * 12) / Math.pow(1 + pl.infl, t.years), wd: withdrawals(med, pl.ret, pl.infl) };
  });
  const tone = p => p >= 0.75 ? 'up' : p >= 0.5 ? 't-warn' : 'down';
  render($('#plGoals'), html`<div class="card-head"><h2>Targets</h2><span class="muted tiny">investable wealth (stocks, cash and other investments, minus margin)</span></div>
    <div class="goal-grid">${res.map((t, i) => html`<div class="goal">
      <div class="row" style="justify-content:space-between"><b>In <input class="input cell n" type="number" min="1" max="60" data-ty="${i}" value="${t.years}" style="width:56px"> years</b><span class="pill ${t.p >= 0.75 ? 't-ok' : t.p >= 0.5 ? 't-warn' : 't-bad'}">${pct(t.p)} chance</span></div>
      <label class="field"><span>Target (EUR)</span><input class="input" type="number" step="50000" data-tv="${i}" value="${t.value}"></label>
      <div class="kv dense">
        <div><span>Expected (median)</span><b class="${tone(t.p)}">${eur(t.med)}</b></div>
        <div><span>In today's money</span><b>${eur(t.real)}</b></div>
        <div><span>Monthly needed at ${pct(pl.ret, 1)}</span><b>${t.need <= pl.monthly ? 'on track' : eur(t.need)}</b></div>
        <div><span>Return needed at ${eur(pl.monthly)}/mo</span><b>${t.rr == null ? '> 40%' : pct(t.rr, 1)}</b></div>
        <div><span>Could pay out (4% rule)</span><b>${eur(t.wd.rule4 / 12)}/mo</b></div>
        <div><span>Forever, keeping real value</span><b>${eur(t.wd.perpetual / 12)}/mo</b></div>
      </div></div>`)}</div>
    <svg viewBox="0 0 ${W} ${H}" class="fchart" role="img" aria-label="Projection with targets">${raw(g)}</svg>
    <div class="legend small"><span><i style="background:${tok('--blue')}"></i>Median outcome</span><span><i style="background:${tok('--blue')};opacity:.3;height:10px"></i>80% of outcomes (3,000 simulations)</span><span><i style="background:${tok('--muted')}"></i>Expected, in today's money</span><span><i style="background:${tok('--orange')};height:10px;width:10px;border-radius:50%"></i>Your targets</span></div>
    ${multiGen(investable, pl)}
    <p class="muted tiny" style="margin:0">Chance = share of 3,000 simulated paths (yearly returns around ${pct(pl.ret, 1)} with ${pct(pl.vol)} volatility) that end at or above the target. "4% rule" = a withdrawal that historically lasted about 30 years (Bengen, Trinity study); "forever" = return minus inflation, so the capital keeps its real value for the next generation.</p>`);

  // ---- allocation (family-wealth framework)
  const gross = bs.stocks + Math.max(0, bs.cash) + bs.re + (pl.other.fi || 0) + (pl.other.pe || 0) + (pl.other.ra || 0) + (pl.other.hf || 0);
  const w = gross ? { eq: bs.stocks / gross, fi: (Math.max(0, bs.cash) + (pl.other.fi || 0)) / gross, pe: (pl.other.pe || 0) / gross, ra: (pl.other.ra || 0) / gross, hf: (pl.other.hf || 0) / gross, re: bs.re / gross } : {};
  const pre = PRESETS[pl.preset] || PRESETS.preserve, D = drift(w, pre.t);
  const netEq = bs.stocks - bs.margin, netRe = bs.re - bs.mort, netTot = Math.max(1, bs.net);
  render($('#plAlloc'), html`<div class="card-head"><h2>Allocation</h2><select class="input" id="plPreset" style="width:auto;padding:6px 10px;font-size:14px">${Object.entries(PRESETS).map(([k, p]) => html`<option value="${k}" ${pl.preset === k ? raw('selected') : ''}>${p.name}</option>`)}</select></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Asset class</th><th class="n">Now</th><th class="n">Target</th><th class="n">Drift</th><th>Action</th></tr></thead><tbody>
      ${D.map(x => html`<tr><td>${x.name}</td><td class="n">${x.w.toFixed(0)}%</td><td class="n">${x.t}%</td><td class="n ${x.breach ? (x.d > 0 ? 't-warn' : 't-bad') : ''}">${x.d >= 0 ? '+' : ''}${x.d.toFixed(0)}</td>
        <td class="small" style="white-space:normal;min-width:150px">${!x.breach ? 'within band' : x.k === 're' && x.d > 0 ? 'locked overweight: don\'t add, pay down the mortgage' : x.d > 0 ? 'overweight: new money elsewhere first' : x.k === 'fi' ? 'underweight: build the safe tier first' : 'underweight: candidate for new money'}</td></tr>`)}
    </tbody></table></div>
    <p class="small" style="margin:0"><b>Net of debt:</b> stocks ${pct(netEq / netTot)} · real-estate equity ${pct(netRe / netTot)} · cash ${pct(Math.max(0, bs.cash) / netTot)} of net worth. ${bs.margin || bs.mort ? 'Leverage changes the picture: gross weights look property-heavy, net weights show what you really own.' : ''}</p>
    <div class="plan-grid">${[['fi', 'Bonds held elsewhere'], ['ra', 'Gold / commodities / infra'], ['pe', 'Private equity'], ['hf', 'Alternatives']].map(([k, lbl]) => html`<label class="field"><span>${lbl} (EUR)</span><input class="input" type="number" step="1000" data-oth="${k}" value="${pl.other[k] || 0}"></label>`)}</div>
    <p class="muted tiny" style="margin:0">Bands: a breach when the drift is more than 5 points or 25% of the target. Illiquid overweights (real estate) are never sold to a band — new money goes to underweights instead.</p>`);

  // ---- liquidity: illiquidity budget and margin stress
  const safe = Math.max(0, bs.cash) + (pl.other.fi || 0) + (pl.other.ra || 0);
  const il = illiquidity({ netWorth: bs.net, safe, illiquid: Math.max(0, netRe) + (pl.other.pe || 0), monthlyOut: cf.out || 1, reserveMonths: pl.reserveMonths, cap: pl.illiquidCap });
  const ms = bs.margin ? marginStress(bs.margin, bs.stocks) : null;
  render($('#plLiq'), html`<div class="card-head"><h2>Liquidity</h2><span class="muted tiny">illiquidity budget${ms ? ' and margin stress' : ''}</span></div>
    <div class="kv dense">
      <div><span>Monthly outgoings</span><b>${eur(cf.out)}</b></div>
      <div><span>Safe reserve needed (${pl.reserveMonths} months)</span><b>${eur(il.need)}</b></div>
      <div><span>Safe liquid now (cash, bonds, gold)</span><b class="${il.gap > 0 ? 'down' : 'up'}">${eur(il.safe)}</b></div>
      <div><span>Room for illiquid assets (${pct(pl.illiquidCap)} of net worth)</span><b>${eur(il.capacity)}</b></div>
      <div><span>Illiquid now (real-estate equity, private)</span><b>${eur(il.illiquid)}</b></div>
    </div>
    <p class="small" style="margin:0"><b>${il.verdict === 'liquidity' ? `The constraint is liquidity: build ${eur(il.gap)} of safe reserve${bs.margin ? ' and retire the margin loan' : ''} before adding illiquid assets.` : il.verdict === 'illiquidity' ? `Illiquid assets exceed the budget by ${eur(-il.headroom)}: don't add more; let liquid assets grow into it.` : `Reserve in place; ${eur(il.headroom)} of room left for illiquid assets.`}</b></p>
    ${ms ? html`<table class="tbl"><thead><tr><th>Stocks fall</th><th class="n">Margin ÷ stocks</th><th>Status</th></tr></thead><tbody>${ms.map(x => html`<tr><td>${x.s ? Math.round(x.s * 100) + '%' : 'today'}</td><td class="n">${pct(x.ltv)}</td><td class="${x.status === 'comfortable' ? 't-ok' : x.status === 'watch' ? 't-warn' : 't-bad'}">${x.status}</td></tr>`)}</tbody></table>
      <p class="muted tiny" style="margin:0">Brokers lend less on concentrated or volatile stocks, so a call can come earlier than this plain ratio suggests.</p>` : ''}
    <div class="plan-grid"><label class="field"><span>Reserve (months)</span><input class="input" type="number" min="3" max="36" data-p="reserveMonths" value="${pl.reserveMonths}"></label><label class="field"><span>Illiquid cap (% of net worth)</span><input class="input" type="number" step="5" data-p="illiquidCap" data-pct="1" value="${Math.round(pl.illiquidCap * 100)}"></label></div>`);

  // ---- cross-asset comparison and what could be added
  const infl = pl.infl, mixR = m => CLASSES.reduce((s, c) => s + (m[c.k] || 0) / 100 * ({ eq: 5.0, fi: 1.7, pe: 6, ra: 1.0, hf: 3.0, re: 1.4 + 3 }[c.k]) / 100, 0) + infl;
  const nowMix = Object.fromEntries(D.map(x => [x.k, x.w])), tgtMix = pre.t;
  const sugg = [];
  if ((w.fi || 0) < 0.1) sugg.push(['Bonds / money-market funds', 'the safe tier the framework wants (target ' + pre.t.fi + '%): steadies the portfolio and funds rebalancing in a crash']);
  if (!(pl.other.ra > 0)) sugg.push(['Gold or a broad commodities ETF (5–8%)', 'a diversifier with low correlation to stocks that helped in inflation and crisis periods']);
  if ((w.eq || 0) > 0.6 && P.pf && P.pf.positions < 15) sugg.push(['A world equity ETF as the core', `your stocks are ${P.pf.positions} individual names: an index core lowers single-stock risk while you keep conviction picks around it`]);
  if (bs.re === 0) sugg.push(['Listed real estate (REITs)', 'real-estate exposure without a mortgage, tradable daily']);
  if (bs.margin) sugg.push(['First: less margin', 'retiring the margin loan turns at-risk equity into real liquidity — before adding anything new']);
  render($('#plCross'), html`<div class="card-head"><h2>Cross-asset comparison</h2><span class="muted tiny">what each asset class does</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Asset</th><th class="n">Real return / yr</th><th class="n">Volatility</th><th class="n">Corr. with stocks</th><th>Liquidity</th><th>Inflation</th><th>Role</th></tr></thead><tbody>
      ${ASSETS.map(a => html`<tr><td><b>${a.name}</b></td><td class="n">${a.real.toFixed(1)}%</td><td class="n">${a.vol}%</td><td class="n">${a.corr.toFixed(1)}</td><td class="small">${a.liquid}</td><td class="small">${a.infl}</td><td class="small" style="white-space:normal;min-width:160px">${a.role}</td></tr>`)}
    </tbody></table></div>
    <p class="small" style="margin:0">Expected nominal return of your <b>current mix ≈ ${pct(mixR(nowMix), 1)}</b> vs the <b>${pre.name.toLowerCase()} mix ≈ ${pct(mixR(tgtMix), 1)}</b> (long-run real returns + ${pct(infl, 1)} inflation; real estate incl. ~3% rent). Your plan assumes ${pct(pl.ret, 1)}.</p>
    ${sugg.length ? html`<h3 style="margin:4px 0 0">Assets to consider</h3><ul class="notes">${sugg.map(([a, why]) => html`<li class="info"><span><b>${a}</b> — ${why}.</span></li>`)}</ul>` : ''}
    <p class="muted tiny" style="margin:0">Rounded long-run historical figures, after inflation, mainly from the Dimson–Marsh–Staunton Global Investment Returns Yearbook (world equities, bonds, bills since 1900); gold, housing, REITs and private equity are approximate. Volatility and correlations are typical, not fixed. Treat them as orders of magnitude, not forecasts.</p>`);
  wire();
}

/** Real value after one and two generations (25 and 50 years), with and without withdrawals afterwards. */
function multiGen(start, pl) {
  const at = y => fv(start, pl.ret, pl.monthly, y * 12) / Math.pow(1 + pl.infl, y);
  const r25 = at(25), r50 = at(50), grows = r50 > start;
  const goal = pl.goal50 || 20000000;
  return html`<div class="kv dense mg">
    <div><span>Real value after 25 years (one generation)</span><b>${eur(r25)}</b></div>
    <div><span>Real value after 50 years (two generations)</span><b class="${grows ? 'up' : 'down'}">${eur(r50)} · ${grows ? 'preserved and grown' : 'not preserved'}</b></div>
    <div><span>50-year goal <input class="input cell n" type="number" step="1000000" id="plGoal50" value="${goal}" style="width:120px"></span><b>${pct(fv(start, pl.ret, pl.monthly, 600) / goal)} covered (nominal)</b></div>
  </div>`;
}

function wire() {
  const pl = P.f.plan, el = $('#view-plan');
  $$('[data-p]', el).forEach(i => { i.onchange = () => { pl[i.dataset.p] = i.dataset.pct ? (+i.value || 0) / 100 : +i.value || 0; save(); }; });
  $$('[data-ret]', el).forEach(b => { b.onclick = () => { pl.ret = +b.dataset.ret; save(); }; });
  $$('[data-ty]', el).forEach(i => { i.onchange = () => { pl.targets[+i.dataset.ty].years = Math.max(1, Math.min(60, Math.round(+i.value || 10))); save(); }; });
  $$('[data-tv]', el).forEach(i => { i.onchange = () => { pl.targets[+i.dataset.tv].value = Math.max(0, +i.value || 0); save(); }; });
  $$('[data-oth]', el).forEach(i => { i.onchange = () => { pl.other[i.dataset.oth] = Math.max(0, +i.value || 0); save(); }; });
  const pr = $('#plPreset', el); if (pr) pr.onchange = () => { pl.preset = pr.value; save(); };
  const g5 = $('#plGoal50', el); if (g5) g5.onchange = () => { pl.goal50 = Math.max(0, +g5.value || 0); save(); };
}
