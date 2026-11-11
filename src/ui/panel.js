// The data panel beside the chart (below it on narrow screens): the app's scores, the pattern phase, key data and
// the last quarters of EPS and sales, in the compact style of professional charting tools.
import { html, raw, render, $ } from './dom.js';
import { enrich, nextReport, adGrade } from '../core/earnings.js';
import { epsScore, composite } from '../core/ratings.js';
import { fD, pc, fmtVol } from '../core/analysis.js';
import { phaseStrip } from './phase.js';
import { amt } from './fundui.js';
import { volStats, weekOf } from '../core/volume.js';

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
    ${volBlock(V)}
    ${q.length ? html`<table class="tbl mini-q"><thead><tr><th>Quarter</th><th class="n">EPS</th><th class="n">% chg</th><th class="n">Sales % chg</th></tr></thead><tbody>
      ${q.map(r => html`<tr><td>${r.period ? r.period.replace(/^Qtr to /, '') : fD(r.time)}</td><td class="n">${r.eps.toFixed(2)}</td><td class="n ${r.yoy >= 0.25 ? 'up' : r.yoy < 0 ? 'down' : ''}">${r.yoy == null ? '—' : pc(r.yoy, 0)}</td><td class="n ${r.revYoy >= 0.25 ? 'up' : r.revYoy < 0 ? 'down' : ''}">${r.revYoy == null ? '—' : pc(r.revYoy, 0)}</td></tr>`)}
    </tbody></table>` : html`<p class="muted tiny" style="margin:0">No quarterly EPS for this stock here${V.earnErr ? ': ' + V.earnErr : ''}.</p>`}
    <p class="muted tiny" style="margin:0">Scores are the app's own measures, not IBD ratings.</p>`);
}

/** Volume: today, the week so far, last week, the averages, buying vs selling, and the volume a breakout needs. */
function volBlock(V) {
  const b = V.data.bars, vs = V.vs || volStats(b, { quote: V.data.quote }); if (!vs) return '';
  const kv = (k, v, cl = '', title = '') => html`<div title="${title}"><span>${k}</span><b class="num ${cl}">${v}</b></div>`;
  const tone = p => p == null ? '' : p >= 0.4 ? 'up' : p < -0.3 ? 't-mute' : '';
  const ud = vs.udRatio;
  return html`<div class="vol-box">
    <h4>Volume</h4>
    ${weeksSvg(b, vs)}
    <div class="kv dense">
      ${kv(vs.open ? 'Today so far' : 'Today', `${fmtVol(vs.vol)} · ${pc(vs.pct, 0)}`, vs.pct >= 0.4 ? (vs.up ? 'up' : 'down') : tone(vs.pct), 'Against the average of the previous 50 days')}
      ${vs.open && vs.pace ? kv('Full day (estimate)', `≈ ${fmtVol(vs.pace)} · ${pc(vs.pacePct, 0)}`, tone(vs.pacePct), 'Rough estimate from the time of day: volume is heavier at the open and the close') : ''}
      ${vs.week ? kv(`This week (${vs.week.days} day${vs.week.days > 1 ? 's' : ''})`, `${fmtVol(vs.week.vol)}${vs.week.days >= 5 && vs.week.vsAvgWeek != null ? ' · ' + pc(vs.week.vsAvgWeek, 0) : ' · ' + pc(vs.week.perDayPct, 0) + '/day'}`, (p => p >= 0.4 ? (vs.week.up ? 'up' : 'down') : tone(p))(vs.week.days >= 5 ? vs.week.vsAvgWeek : vs.week.perDayPct), 'Since Monday. Per day = the average day this week against the 50-day average') : ''}
      ${vs.lastWeek != null ? kv('Last week', `${fmtVol(vs.lastWeek)}${vs.lastWeekPct != null ? ' · ' + pc(vs.lastWeekPct, 0) : ''}`, tone(vs.lastWeekPct), 'Against the average of the 10 full weeks before this one') : ''}
      ${kv('Average day (50d)', fmtVol(vs.avg50))}
      ${vs.avgWeek ? kv('Average week (10w)', fmtVol(vs.avgWeek)) : ''}
      ${ud != null ? kv('Up/down volume (50d)', `${ud.toFixed(2)} · ${ud >= 1.2 ? 'buying' : ud <= 0.8 ? 'selling' : 'even'}`, ud >= 1.2 ? 'up' : ud <= 0.8 ? 'down' : '', 'Volume on up days divided by volume on down days over 50 days. Above 1: institutions are buying more than selling') : ''}
      ${kv('Breakout volume needed', '≥ ' + fmtVol(vs.breakoutNeed), '', 'At least 40% above the 50-day average on the breakout day (your playbook)')}
    </div>
  </div>`;
}

/** Weekly volume for the last 10 full weeks and this week (outlined), with the 10-week average as a dashed line. */
function weeksSvg(b, vs) {
  const n = b.length - 1, wk = new Map();
  for (let i = Math.max(1, n - 75); i <= n; i++) { const w = weekOf(b[i].time); if (!wk.has(w)) wk.set(w, { v: 0, open: b[i - 1].close, close: 0 }); const x = wk.get(w); x.v += b[i].volume || 0; x.close = b[i].close; }
  const ws = [...wk.entries()].sort((a, c) => a[0] - c[0]).map(e => e[1]).slice(-11); if (ws.length < 4) return '';
  const W = 260, H = 64, bw = W / ws.length, mx = Math.max(...ws.map(x => x.v), vs.avgWeek || 0) || 1, y = v => H - 4 - (v / mx) * (H - 12);
  const css = getComputedStyle(document.documentElement), c = k => css.getPropertyValue(k).trim();
  let svg = ws.map((x, i) => { const last = i === ws.length - 1, col = x.close >= x.open ? c('--up') : c('--down');
    return `<rect x="${(i * bw + 2).toFixed(1)}" y="${y(x.v).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(H - 4 - y(x.v)).toFixed(1)}" rx="2" fill="${col}" fill-opacity="${last ? 0.95 : 0.45}"${last ? ` stroke="${c('--ink')}" stroke-width="1"` : ''}><title>${last ? 'This week so far' : 'Week'}: ${fmtVol(x.v)}</title></rect>`; }).join('');
  if (vs.avgWeek) svg += `<line x1="0" x2="${W}" y1="${y(vs.avgWeek).toFixed(1)}" y2="${y(vs.avgWeek).toFixed(1)}" stroke="${c('--vavg')}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  return html`<svg class="vol-weeks" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Weekly volume, last 10 weeks and this week">${raw(svg)}</svg><p class="muted tiny" style="margin:-2px 0 0">Weekly volume · last bar = this week so far · dashed = 10-week average</p>`;
}
