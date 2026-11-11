// Buying-plan sheet (from the chart) and the trade forms.
import { pyramid, nextStep, sharesFor, tradePlan } from '../core/strategy.js';
import { strategy, planFor, createPlan, updatePlan, deletePlan, recordTrade, tradesFor, deleteTrade, checkPlan } from '../data/plans.js';
import { factor } from '../data/fx.js';
import { App, emit } from '../app.js';
import { $, $$, html, raw, render, sheet, toast, money } from './dom.js';
import { fDs } from '../core/analysis.js';

const n0 = x => Math.round(x).toLocaleString('en-US');
const dIn = t => new Date(t * 1000).toISOString().slice(0, 10);
const tOf = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 1000);
const LVL = { buy: 't-ok', add: 't-ok', stop: 't-bad', warn: 't-warn', wait: 't-mute', hold: 't-blue' };

/** ctx: {sym, name, cur, bars, pivot (detector), baseName, onChange} */
export async function planSheet(ctx) {
  const S = await strategy();
  const f = await factor(ctx.cur || '', S.ccy).catch(() => null), fx = f ? f.v : 1;
  const sh = sheet(`Buying plan · ${ctx.sym}`, html`<div id="plBody"></div>`, { onClose: () => ctx.onChange && ctx.onChange() });
  const draw = async () => {
    const plan = await planFor(ctx.sym), trades = await tradesFor(ctx.sym);
    const close = ctx.bars[ctx.bars.length - 1].close, pivot = plan ? plan.pivot : ctx.pivot;
    const py = pyramid(S, pivot);
    const st = plan ? (await checkPlan(ctx.sym, ctx.bars, ctx.name)) || nextStep(S, plan, { close, now: Date.now() / 1000, market: App.mkt && App.mkt.us, fx }) : null;
    const done = plan ? plan.buys : [];
    const fp = x => money(x, ctx.cur);
    render($('#plBody', sh), html`
      ${st ? html`<div class="card" style="gap:6px"><span class="tag ${LVL[st.level] || ''}" style="justify-self:start">${st.title}</span><p class="small" style="margin:0">${st.text}</p></div>` : ''}
      <form class="card" id="plForm" style="gap:10px">
        <div class="toolbar"><label class="field" style="flex:1"><span>Buy point (pivot)${ctx.baseName ? ' · detected: ' + ctx.baseName : ''}</span><input class="input" id="plPivot" type="number" step="any" min="0" value="${pivot ? pivot.toFixed(2) : ''}" required></label>
        <button class="btn primary" type="submit">${plan ? 'Update buy point' : 'Start plan'}</button></div>
        <p class="muted tiny" style="margin:0">Position target ${n0(py.target)} ${S.ccy} (${Math.round(S.posPct * 100)}% of ${n0(S.capital)} ${S.ccy}) · stop ${Math.round(S.stop * 100)}% below ${S.stopFrom === 'pivot' ? 'the buy point' : 'your average purchase price once bought'} (raised at +15% and +20%) · change these in Settings → Buying plan.${ctx.cur && ctx.cur !== S.ccy ? ` Share counts use ${f && f.live ? 'the live' : 'a reference'} ${ctx.cur}→${S.ccy} rate.` : ''}</p>
      </form>
      ${pivot ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Step</th><th class="n">Share</th><th class="n">Amount</th><th class="n">Buy between</th><th class="n">≈ Shares now</th><th>Status</th></tr></thead><tbody>
        ${py.steps.map((s, i) => html`<tr><td>${i === 0 ? 'Buy 1 (breakout)' : 'Add ' + (i + 1)}</td><td class="n">${Math.round(s.pct * 100)}%</td><td class="n">${n0(s.amount)} ${S.ccy}</td><td class="n">${fp(s.from)} – ${fp(s.to)}</td><td class="n">${sharesFor(s.amount, close, fx)}</td>
          <td>${done[i] ? html`<span class="t-ok">✓ ${done[i].shares} @ ${fp(done[i].price)}</span>` : plan ? html`<button class="btn sm" data-buy="${i + 1}">Record buy</button>` : ''}</td></tr>`)}
        <tr><td>Stop</td><td></td><td></td><td class="n t-bad">${fp(st && st.stop ? st.stop : py.stop)}</td><td></td><td class="muted tiny">${st && st.stop && st.stop !== py.stop ? 'current sell line' : '−' + Math.round(S.stop * 100) + '% from the buy point'}</td></tr>
        ${sellRows(S, pivot, done, plan, fx, fp)}
      </tbody></table></div>` : ''}
      ${plan ? html`<div class="toolbar">${done.length > 3 || done.length === 3 ? html`<button class="btn sm" data-buy="4">Record follow-on buy</button>` : ''}<button class="btn sm" id="plSell">Record sell</button><span class="spacer"></span><button class="btn sm danger" id="plDel">Delete plan</button></div>` : ''}
      <div class="section-title" style="margin:6px 0">Journal for ${ctx.sym}</div>
      ${trades.length ? html`<div class="results">${trades.map(t => html`<div class="row" style="padding:8px 14px;border-top:.5px solid var(--sep)"><span class="small"><b class="${t.side === 'buy' ? 't-ok' : 't-warn'}">${t.side === 'buy' ? 'Bought' + (t.step ? ' (' + (t.step > 3 ? 'follow-on' : 'step ' + t.step) + ')' : '') : 'Sold'}</b> ${t.shares} @ ${fp(t.price)} · ${fDs(t.t)}${t.reason ? ' · ' + t.reason : ''}${t.note ? html`<br><span class="muted tiny">${t.note}</span>` : ''}</span><button class="btn sm danger" data-deltr="${t.id}" aria-label="Delete trade">×</button></div>`)}</div>` : html`<p class="muted small" style="margin:0">No trades recorded for this stock yet.</p>`}
      <p class="muted tiny" style="margin:0">The plan alerts you (bell menu and a notification) when buy 1, add 2, add 3, a 50-day follow-on buy, a profit step (⅓ at +20%, ⅓ at +25% on your average price), the 50-day exit for the rest, or the stop becomes due. No buys are suggested within ${S.earningsDays} days before an earnings report.</p>`);
    $('#plForm', sh).onsubmit = async e => {
      e.preventDefault(); const v = +$('#plPivot', sh).value; if (!(v > 0)) return;
      if (plan) await updatePlan(plan.id, { pivot: v, lastCode: null }); else await createPlan({ sym: ctx.sym, name: ctx.name, pivot: v, base: ctx.baseName, cur: ctx.cur });
      toast(plan ? 'Buy point updated.' : 'Plan started: you will get alerts for each step.'); draw();
    };
    $$('[data-buy]', sh).forEach(b => { b.onclick = () => tradeForm(ctx, { side: 'buy', step: +b.dataset.buy, price: close, shares: sharesFor((py.steps[+b.dataset.buy - 1] || py.steps[2]).amount, close, fx) }, draw); });
    $$('[data-sellstep]', sh).forEach(b => { b.onclick = () => tradeForm(ctx, { side: 'sell', price: close, shares: +b.dataset.sellstep, reason: 'Profit' }, draw); });
    $('#plSell', sh) && ($('#plSell', sh).onclick = () => tradeForm(ctx, { side: 'sell', price: close, shares: done.reduce((s, x) => s + x.shares, 0) - (plan.sold || 0) }, draw));
    $('#plDel', sh) && ($('#plDel', sh).onclick = async () => { if (confirm('Delete this plan? Journal entries stay.')) { await deletePlan(plan.id); draw(); } });
    $$('[data-deltr]', sh).forEach(b => { b.onclick = async () => { if (confirm('Delete this journal entry? Holdings are not changed back.')) { await deleteTrade(b.dataset.deltr); draw(); } }; });
  };
  draw();
}

const SELL_REASONS = ['Stop (7–8% below the purchase price / 5–8% below the buy point)', 'Raised stop or breakeven hit', 'Broke the 50-day line on heavy volume', 'Profit target (+20–25%)', 'Two quarters of slowing earnings', 'Shift money into a leader', 'Market correction: raising cash', 'Climax / extended', 'Other'];

/** Small form to record a buy or sell. init: {side, step?, price, shares}. */
export function tradeForm(ctx, init, after) {
  const box = document.createElement('form'); box.className = 'card'; box.style.gap = '10px';
  render(box, html`<h3 style="margin:0">${init.side === 'buy' ? (init.step > 3 ? 'Follow-on buy' : 'Buy ' + init.step) : 'Sell'} · ${ctx.sym}</h3>
    <div class="grid2"><label class="field"><span>Shares</span><input class="input" name="shares" type="number" step="any" min="0" value="${init.shares || ''}" required></label>
    <label class="field"><span>Price (${ctx.cur || 'listing currency'})</span><input class="input" name="price" type="number" step="any" min="0" value="${init.price ? init.price.toFixed(2) : ''}" required></label></div>
    <div class="grid2"><label class="field"><span>Date</span><input class="input" name="date" type="date" value="${dIn(Date.now() / 1000)}" required></label>
    ${init.side === 'sell' ? html`<label class="field"><span>Reason</span><select class="input" name="reason">${SELL_REASONS.map(r => html`<option>${r}</option>`)}</select></label>` : html`<label class="field"><span>Why (optional)</span><input class="input" name="reason" placeholder="Breakout on volume, add at +1%…"></label>`}</div>
    <label class="field"><span>Note (what you saw, what you learned)</span><input class="input" name="note"></label>
    <div class="toolbar"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-cancel>Cancel</button></div>`);
  const host = document.querySelector('#plBody'); host.prepend(box); box.scrollIntoView({ block: 'nearest' });
  box.querySelector('[data-cancel]').onclick = () => box.remove();
  box.onsubmit = async e => {
    e.preventDefault(); const F = new FormData(box);
    await recordTrade({ sym: ctx.sym, side: init.side, step: init.step, shares: +F.get('shares'), price: +F.get('price'), t: tOf(F.get('date')), cur: ctx.cur, reason: F.get('reason') || '', note: F.get('note') || '' });
    toast(init.side === 'buy' ? 'Buy recorded in the journal and your holdings.' : 'Sell recorded.'); emit('trades'); after && after();
  };
}

/** Profit steps for the sheet: a third at +20%, a third at +25% (on the real average price once bought), the rest
 *  rides the 50-day line. */
function sellRows(S, pivot, done, plan, fx, fp) {
  const T = tradePlan(S, pivot, fx), total = done.reduce((t, b) => t + b.shares, 0);
  const avg = total ? done.reduce((t, b) => t + b.price * b.shares, 0) / total : T.avg, sold = plan ? plan.sold || 0 : 0;
  let cum = 0;
  return html`${(S.sellSteps || [[0.2, 1 / 3], [0.25, 1 / 3]]).map(([g, f], i) => {
    cum += f; const target = total ? Math.round(total * cum) : null, sh = total ? Math.round(total * f) : T.sells[i] && T.sells[i].shares;
    const did = total && sold >= target - 0.5;
    return html`<tr><td>Sell ${i + 1} (+${Math.round(g * 100)}%)</td><td class="n">${f > 0.33 && f < 0.34 ? '⅓' : Math.round(f * 100) + '%'}</td><td></td><td class="n t-ok">${fp(Math.round(avg * (1 + g) * 100) / 100)}</td><td class="n">${sh || ''}</td>
      <td>${did ? html`<span class="t-ok">✓ sold</span>` : total ? html`<button class="btn sm" data-sellstep="${sh}">Record sale</button>` : html`<span class="muted tiny">on the expected average ${fp(T.avg)}</span>`}</td></tr>`;
  })}
  <tr><td>The rest</td><td class="n">⅓</td><td></td><td class="n">50-day line</td><td class="n">${total ? Math.max(0, total - Math.round(total * cum)) : T.runner.shares}</td><td class="muted tiny">sell on a heavy-volume close below it or a climax top; 8-week hold if +20% came within 3 weeks</td></tr>`;
}
