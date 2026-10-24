// Company card on the stock page: what the company does, size and valuation, share supply, institutional
// ownership and analysts, with O'Neil's reading where the book has one.
import { html, render, $, money } from './dom.js';
import { amt } from './fundui.js';

const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%');
const num = (x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const cnt = x => (x == null ? '—' : x >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? (x / 1e6).toFixed(0) + 'M' : x.toLocaleString('en-US'));

/** O'Neil's "I": some institutional sponsorship, not over-owned. Returns [state, why] for the checklist. */
export function fundsItem(co) {
  if (!co || co.inst == null) return ['na', co && co.limited ? 'Fund ownership loads in the desktop app.' : 'No fund-ownership data for this stock.'];
  const p = Math.round(co.inst * 100), n = co.instCount ? ` (${co.instCount.toLocaleString('en-US')} institutions)` : '';
  if (co.inst < 0.1) return ['fail', `Only ${p}% held by institutions${n}: little sponsorship. The book wants a few good funds owning it.`];
  if (co.inst > 0.9) return ['warn', `${p}% held by institutions${n}: possibly over-owned, so heavy selling is possible when funds leave.`];
  return ['pass', `${p}% held by institutions${n}: sponsored but not over-owned.`];
}

export function companyCard(co, price) {
  const el = $('#cCo'); if (!el) return;
  if (!co) { el.hidden = true; return; }
  el.hidden = false;
  const kp = (k, v, s = '', cls = '') => html`<div class="kpi"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="s">${s}</span></div>`;
  const up = co.target && price ? co.target / price - 1 : null;
  const roe = co.roe;
  render(el, html`<div class="card-head"><h2>Company</h2><span class="muted tiny">${[co.sector, co.industry, co.country].filter(Boolean).join(' · ')}</span></div>
    ${co.about ? html`<details class="small"><summary><b>${co.name || ''}</b> — ${co.about.slice(0, 160)}${co.about.length > 160 ? '…' : ''}</summary><p style="margin:6px 0 0">${co.about}</p>${co.website ? html`<p class="muted tiny" style="margin:4px 0 0">${co.website}${co.employees ? ' · ' + co.employees.toLocaleString('en-US') + ' employees' : ''}</p>` : ''}</details>` : co.name ? html`<p class="small" style="margin:0"><b>${co.name}</b></p>` : ''}
    ${co.limited ? html`<p class="muted small" style="margin:0">Profile, valuation, share supply and fund ownership load in the desktop app (or with an FMP key in Settings).</p>` : html`
    <div class="kpis">
      ${kp('Market value', amt(co.mcap, co.cur), co.mcap ? (co.mcap >= 2e11 ? 'mega cap' : co.mcap >= 1e10 ? 'large cap' : co.mcap >= 2e9 ? 'mid cap' : 'small cap') : '')}
      ${co.pe != null || co.fpe != null ? kp('P/E', num(co.pe, 1), co.fpe != null ? 'next year ' + num(co.fpe, 1) : 'trailing') : ''}
      ${roe != null ? kp('Return on equity', pct(roe), roe >= 0.17 ? 'book: 17%+ ✓' : 'book wants 17%+', roe >= 0.17 ? 'up' : 'down') : ''}
      ${co.float != null || co.shares != null ? kp('Shares (supply)', cnt(co.shares), co.float ? 'float ' + cnt(co.float) : '') : ''}
      ${co.insiders != null ? kp('Held by management', pct(co.insiders, 1), co.insiders >= 0.03 ? 'book: a plus when management owns stock' : 'small insider stake') : ''}
      ${co.inst != null ? kp('Held by institutions', pct(co.inst), co.instCount ? co.instCount.toLocaleString('en-US') + ' institutions' : '') : ''}
      ${co.short != null ? kp('Short interest', pct(co.short, 1), co.shortRatio ? num(co.shortRatio, 1) + ' days to cover' : 'of the float') : ''}
      ${co.target ? kp('Analysts’ target', money(co.target, co.cur || 'USD'), `${up != null ? (up >= 0 ? '+' : '') + Math.round(up * 100) + '% · ' : ''}${co.analysts || '?'} analysts${co.rec ? ' · ' + co.rec.replace('_', ' ') : ''}`) : ''}
      ${co.divYield ? kp('Dividend yield', pct(co.divYield, 1)) : ''}
      ${co.beta != null ? kp('Beta', num(co.beta, 2), 'vs the market') : ''}
    </div>`}
    <p class="muted tiny" style="margin:0">Source: ${co.src}. O'Neil puts more weight on earnings, sales and the chart than on P/E: leaders often look expensive. Analysts' targets are opinions, not facts.</p>`);
}
