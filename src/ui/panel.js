// The data panel beside the chart (below it on narrow screens): the app's scores, the pattern phase, key data and
// the last quarters of EPS and sales, in the compact style of professional charting tools.
import { html, render, $ } from './dom.js';
import { enrich, nextReport, adGrade } from '../core/earnings.js';
import { epsScore, composite } from '../core/ratings.js';
import { fD, pc } from '../core/analysis.js';
import { phaseStrip } from './phase.js';
import { amt } from './fundui.js';

const cls = v => v == null ? 't-mute' : v >= 80 ? 't-ok' : v >= 60 ? 't-blue' : v >= 40 ? 't-warn' : 't-bad';
const tile = (k, v, title, c = cls(v)) => html`<div class="rt ${c}" title="${title}"><b>${v ?? '—'}</b><span>${k}</span></div>`;
const cnt = x => (x == null ? '—' : x >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? (x / 1e6).toFixed(0) + 'M' : Math.round(x).toLocaleString('en-US'));

/** V: {sym, data, earn, co, phase, rs, score} */
export function renderPanel(V) {
  const el = $('#sPanel'); if (!el) return;
  if (!V.data || V.mkt) { el.hidden = true; return; }
  el.hidden = false;
  const b = V.data.bars, n = b.length - 1, c = b[n].close, cur = V.data.currency;
  const hi = Math.max(...b.slice(Math.max(0, n - 251)).map(x => x.high)), lo = Math.min(...b.slice(Math.max(0, n - 251)).map(x => x.low));
  const ad = adGrade(b), eps = V.earn ? epsScore(V.earn) : null, comp = composite({ rs: V.rs, eps, offHigh: c / hi - 1, ad: ad && ad.grade });
  let dv = 0; for (let i = Math.max(0, n - 49); i <= n; i++) dv += b[i].close * b[i].volume; dv /= Math.min(50, n + 1);
  const q = enrich(V.earn || []).slice(-6).reverse(), nx = nextReport(V.earn || []), co = V.co || {};
  const kv = (k, v) => html`<div><span>${k}</span><b class="num">${v}</b></div>`;
  render(el, html`
    <div class="rt-row">
      ${tile('Comp.', comp, "The app's composite of strength, EPS, distance from the high and accumulation (not IBD's rating)")}
      ${tile('EPS', eps, "The app's EPS score: recent quarterly growth and the 3-year trend, absolute scale 1–99")}
      ${tile('RS', V.rs, '12-month price strength ranked 1–99 (the app’s own)')}
      ${tile('A/D', ad ? ad.grade : null, 'Accumulation/distribution over 13 weeks (A = heavy buying, E = heavy selling)', ad ? (ad.grade <= 'B' ? 't-ok' : ad.grade === 'C' ? 't-warn' : 't-bad') : 't-mute')}
      ${tile('Setup', V.score ? V.score.score : null, 'Setup score 0–100: base, strength, trend, demand, earnings, market')}
    </div>
    ${V.phase ? phaseStrip(V.phase) : ''}
    <div class="kv dense">
      ${kv('Market value', co.mcap ? amt(co.mcap, co.cur || cur) : '—')}
      ${kv('52-week range', `${pc(c / lo - 1, 0)} above low · ${pc(c / hi - 1, 0)} from high`)}
      ${kv('Avg value traded (50d)', amt(dv, cur))}
      ${co.float != null ? kv('Float / shares', `${cnt(co.float)} / ${cnt(co.shares)}`) : ''}
      ${co.inst != null ? kv('Held by funds', `${Math.round(co.inst * 100)}%${co.instCount ? ' · ' + co.instCount.toLocaleString('en-US') : ''}`) : ''}
      ${co.roe != null ? kv('Return on equity', Math.round(co.roe * 100) + '%') : ''}
      ${co.pe != null ? kv('P/E', co.pe.toFixed(1)) : ''}
      ${kv('Next earnings', nx ? fD(nx.time) : '—')}
      ${co.industry || co.sector ? kv('Industry', co.industry || co.sector) : ''}
    </div>
    ${q.length ? html`<table class="tbl mini-q"><thead><tr><th>Quarter</th><th class="n">EPS</th><th class="n">% chg</th><th class="n">Sales % chg</th></tr></thead><tbody>
      ${q.map(r => html`<tr><td>${r.period ? r.period.replace(/^Qtr to /, '') : fD(r.time)}</td><td class="n">${r.eps.toFixed(2)}</td><td class="n ${r.yoy >= 0.25 ? 'up' : r.yoy < 0 ? 'down' : ''}">${r.yoy == null ? '—' : pc(r.yoy, 0)}</td><td class="n ${r.revYoy >= 0.25 ? 'up' : r.revYoy < 0 ? 'down' : ''}">${r.revYoy == null ? '—' : pc(r.revYoy, 0)}</td></tr>`)}
    </tbody></table>` : html`<p class="muted tiny" style="margin:0">No quarterly EPS for this stock here${V.earnErr ? ': ' + V.earnErr : ''}.</p>`}
    <p class="muted tiny" style="margin:0">Scores are the app's own measures, not IBD ratings.</p>`);
}
