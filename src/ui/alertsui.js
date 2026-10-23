// Alert sheets: set an alert for a stock, and the list of all alerts with "Check now".
import { addAlert, removeAlert, rearm, allAlerts, checkAll, describe, markSeen, ALERT_TYPES } from '../data/alerts.js';
import { openStock } from '../app.js';
import { $, $$, html, raw, render, sheet, toast, money, ICON } from './dom.js';
import { Capacitor } from '@capacitor/core';

/** ctx: {sym, name, close, cur, pivot, baseName, stop} */
export function alertSheet(ctx) {
  const fp = x => money(x, ctx.cur);
  const quick = [];
  if (ctx.pivot) quick.push(['breakout', ctx.pivot, `Breakout above the ${ctx.baseName ? ctx.baseName.toLowerCase() : 'base'} buy point ${fp(ctx.pivot)}`]);
  if (ctx.stop) quick.push(['stop', ctx.stop, `Stop: close below ${fp(ctx.stop)} (8% under ${ctx.stopFrom || 'the buy point'})`]);
  quick.push(['above', +(ctx.close * 1.05).toFixed(2), `Closes 5% higher, above ${fp(ctx.close * 1.05)}`]);
  quick.push(['below', +(ctx.close * 0.95).toFixed(2), `Closes 5% lower, below ${fp(ctx.close * 0.95)}`]);
  const sh = sheet(`Alert for ${ctx.sym}`, html`
    <div class="results">${quick.map(([t, lv, l], i) => html`<button data-q="${i}"><span class="s">${l}</span><span class="x">${raw(ICON.bell)}</span></button>`)}</div>
    <form class="card" id="alForm" style="gap:10px">
      <div class="section-title">Your own level</div>
      <div class="toolbar"><select class="input" id="alType" style="width:auto">${Object.entries(ALERT_TYPES).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select>
      <input class="input" id="alLevel" type="number" inputmode="decimal" step="any" value="${ctx.close.toFixed(2)}" style="width:140px" aria-label="Price level"><button class="btn primary" type="submit">Set alert</button></div>
    </form>
    <p class="muted tiny" style="margin:0">Alerts compare each daily close with your level. They're checked whenever prices load: when you open the stock, run a scan, open your portfolio or tap Check now.${Capacitor.isNativePlatform() ? ' A triggered alert also sends a notification.' : ''}</p>`);
  const set = async (type, level) => { await addAlert({ sym: ctx.sym, name: ctx.name, type, level, cur: ctx.cur }); sh.close(); toast(`Alert set: ${ctx.sym} ${ALERT_TYPES[type].label.toLowerCase()} ${fp(level)}.`); };
  $$('[data-q]', sh).forEach(b => { b.onclick = () => { const [t, lv] = quick[+b.dataset.q]; set(t, lv); }; });
  $('#alForm', sh).onsubmit = e => { e.preventDefault(); const lv = +$('#alLevel', sh).value; if (lv > 0) set($('#alType', sh).value, lv); };
}

export async function alertsCenter() {
  const sh = sheet('Alerts', html`<div class="toolbar"><button class="btn primary" id="acCheck">${raw(ICON.refresh)}Check now</button><span class="muted small" id="acMsg"></span></div><div id="acBody"></div>`);
  const draw = async () => {
    const all = await allAlerts(), act = all.filter(a => !a.triggered), hit = all.filter(a => a.triggered);
    const row = a => html`<div class="row" style="padding:10px 14px;border-top:.5px solid var(--sep)"><button class="link" data-open="${a.sym}" style="text-align:left"><b>${a.sym}</b> <span class="muted small">${a.name || ''}</span><br><span class="small">${a.type === 'plan' ? html`<b class="${a.level === 'stop' ? 't-bad' : a.level === 'warn' ? 't-warn' : 't-ok'}">${a.title.replace(a.sym + ': ', '')}</b> ${a.body}` : a.triggered ? describe(a) : ALERT_TYPES[a.type].label + ' ' + money(a.level, a.cur)}</span>${a.triggered ? html`<br><span class="muted tiny">${new Date(a.triggered).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}</button>
      <span class="row" style="gap:4px">${a.triggered && a.type !== 'plan' ? html`<button class="btn sm" data-re="${a.id}">Re-arm</button>` : ''}<button class="btn sm danger" data-del="${a.id}" aria-label="Delete alert">${raw(ICON.trash)}</button></span></div>`;
    render($('#acBody', sh), html`
      ${hit.length ? html`<div class="section-title" style="margin:6px 0">Triggered</div><div class="results">${hit.map(row)}</div>` : ''}
      <div class="section-title" style="margin:6px 0">Waiting (${act.length})</div>
      ${act.length ? html`<div class="results">${act.map(row)}</div>` : html`<p class="muted small">No alerts yet. Open a stock and tap the bell to set one (a breakout above its buy point or a stop), or start a buying plan with the Plan button: it alerts you when to buy, add and sell.</p>`}`);
    $$('[data-del]', sh).forEach(b => { b.onclick = async () => { await removeAlert(b.dataset.del); draw(); }; });
    $$('[data-re]', sh).forEach(b => { b.onclick = async () => { await rearm(b.dataset.re); draw(); }; });
    $$('[data-open]', sh).forEach(b => { b.onclick = () => { sh.close(); openStock(b.dataset.open); }; });
  };
  $('#acCheck', sh).onclick = async () => {
    const m = $('#acMsg', sh);
    const hits = await checkAll((i, n) => { m.textContent = `Checking ${i} of ${n}…`; });
    m.textContent = hits.length ? `${hits.length} alert${hits.length > 1 ? 's' : ''} triggered.` : 'Checked: nothing triggered.';
    draw();
  };
  await draw(); markSeen();
}
