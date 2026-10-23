// The Fundamentals card on the stock page: revenue and profit, margins, cash flow, and debt versus cash, per quarter,
// trailing twelve months or per year, as small charts with a plain-language reading under each.
import { fundamentals } from '../data/fundamentals.js';
import { ttm, margins, yoy } from '../core/fundamentals.js';
import { $, $$, html, raw, render, tok } from './dom.js';
import * as store from '../data/store.js';

const U = { mode: 'q', range: '5Y', seq: 0 };
const C = () => ({ rev: tok('--blue'), net: tok('--indigo'), gross: tok('--teal'), op: tok('--blue'), netm: tok('--indigo'), ocf: tok('--teal'), capex: tok('--orange'), fcf: tok('--green'), debt: tok('--red'), cash: tok('--green'), neg: tok('--down') });

const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CHF: 'CHF ', KRW: '₩', HKD: 'HK$', CAD: 'C$', AUD: 'A$' };
export function amt(x, cur) {
  if (x == null || !isFinite(x)) return '—';
  const a = Math.abs(x), s = cur ? SYM[cur] ?? cur + ' ' : '';
  const v = a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(2);
  return (x < 0 ? '−' : '') + s + v;
}
const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%');
const sgn = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%');
const lbl = (end, mode) => (mode === 'y' ? end.slice(0, 4) : `Q${Math.ceil(+end.slice(5, 7) / 3)} ’${end.slice(2, 4)}`);

/** Grouped bars (values below zero go down) with optional lines on the same scale. */
function bars(rows, series, { cur, mode, lines = [], h = 190 }) {
  const n = rows.length, k = series.length, bw = Math.max(3, Math.min(14, Math.floor(560 / Math.max(1, n) / (k + 0.8)))), gw = bw * k + Math.max(3, bw * 0.8);
  const W = Math.max(320, n * gw + 56), top = 10, bot = 24;
  const vals = [...series, ...lines].flatMap(s => rows.map(r => s.get(r))).filter(v => v != null && isFinite(v));
  const mx = Math.max(0, ...vals), mn = Math.min(0, ...vals), span = mx - mn || 1, sc = (h - top - bot) / span, y0 = top + mx * sc;
  const Y = v => y0 - v * sc;
  let g = `<line x1="48" x2="${W}" y1="${y0}" y2="${y0}" stroke="var(--sep)"/>`;
  g += `<text x="44" y="${top + 8}" text-anchor="end" font-size="10" fill="var(--muted)">${amt(mx, cur)}</text>`;
  if (mn < 0) g += `<text x="44" y="${h - bot}" text-anchor="end" font-size="10" fill="var(--muted)">${amt(mn, cur)}</text>`;
  const step = Math.ceil(n / 10);
  rows.forEach((r, i) => {
    const x0 = 52 + i * gw;
    series.forEach((s, j) => {
      const v = s.get(r); if (v == null || !isFinite(v)) return;
      const y = Math.min(Y(v), y0), hh = Math.max(1, Math.abs(Y(v) - y0));
      g += `<rect x="${x0 + j * bw}" y="${y}" width="${bw - 1}" height="${hh}" rx="2" fill="${v < 0 && s.negColor ? s.negColor : s.color}"><title>${lbl(r.end, mode)} · ${s.name}: ${amt(v, cur)}</title></rect>`;
    });
    if (i % step === 0 || (i === n - 1 && i % step >= step / 2)) g += `<text x="${x0 + (bw * k) / 2}" y="${h - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${lbl(r.end, mode)}</text>`;
  });
  for (const s of lines) {
    const pts = rows.map((r, i) => [52 + i * gw + (bw * k) / 2, s.get(r)]).filter(p => p[1] != null && isFinite(p[1]));
    if (pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${pts.map(([x, v]) => x.toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`;
    pts.forEach(([x, v], i) => { if (i === pts.length - 1) g += `<circle cx="${x}" cy="${Y(v)}" r="3" fill="${s.color}"/>`; });
  }
  return `<svg viewBox="0 0 ${W} ${h}" class="fchart" style="max-width:${Math.round(W * 1.5)}px" role="img">${g}</svg>`;
}

/** Percentage lines (margins). */
function pctLines(rows, series, { mode, h = 190 }) {
  const n = rows.length, W = Math.max(320, n * 22 + 56), top = 10, bot = 24;
  const vals = series.flatMap(s => rows.map(r => s.get(r))).filter(v => v != null && isFinite(v));
  if (!vals.length) return '';
  let mx = Math.max(0, ...vals), mn = Math.min(0, ...vals); const pad = (mx - mn) * 0.08 || 0.05; mx += pad; if (mn < 0) mn -= pad;
  const sc = (h - top - bot) / (mx - mn), Y = v => top + (mx - v) * sc, X = i => 56 + i * ((W - 70) / Math.max(1, n - 1));
  const tick = (mx - mn) > 0.6 ? 0.2 : (mx - mn) > 0.3 ? 0.1 : 0.05;
  let g = '';
  for (let t = Math.ceil(mn / tick) * tick; t <= mx + 1e-9; t += tick) g += `<line x1="52" x2="${W}" y1="${Y(t)}" y2="${Y(t)}" stroke="${Math.abs(t) < 1e-9 ? 'var(--sep)' : 'var(--grid)'}"/><text x="46" y="${Y(t) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(t * 100)}%</text>`;
  const step = Math.ceil(n / 10);
  rows.forEach((r, i) => { if (i % step === 0 || (i === n - 1 && i % step >= step / 2)) g += `<text x="${X(i)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${lbl(r.end, mode)}</text>`; });
  for (const s of series) {
    const pts = rows.map((r, i) => [X(i), s.get(r), r]).filter(p => p[1] != null && isFinite(p[1]));
    if (pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([x, v]) => x.toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`;
    pts.forEach(([x, v, r], i) => { g += `<circle cx="${x}" cy="${Y(v)}" r="${i === pts.length - 1 ? 3.5 : 2}" fill="${s.color}"><title>${lbl(r.end, mode)} · ${s.name}: ${pct(v, 1)}</title></circle>`; });
  }
  return `<svg viewBox="0 0 ${W} ${h}" class="fchart" style="max-width:${Math.round(W * 1.5)}px" role="img">${g}</svg>`;
}

const legend = items => html`<div class="legend small">${items.map(([c, t]) => html`<span><i style="background:${c};height:10px;width:10px;border-radius:3px"></i>${t}</span>`)}</div>`;
const trend = (rows, f) => { const v = rows.map(f).filter(x => x != null && isFinite(x)); if (v.length < 5) return null; const a = v.slice(-5, -4)[0], z = v[v.length - 1]; return z - a; };

export async function fundCard(sym) {
  const el = $('#cFund'); if (!el) return;
  const seq = ++U.seq;
  U.mode = await store.get('fund.mode', U.mode); U.range = await store.get('fund.range', U.range);
  render(el, html`<div class="card-head"><h2>Fundamentals</h2></div><div class="empty"><span class="spinner"></span><span>Loading results…</span></div>`);
  let F;
  try { F = await fundamentals(sym); } catch (e) { if (seq === U.seq) render(el, html`<div class="card-head"><h2>Fundamentals</h2></div><p class="muted small" style="margin:0">${e.message}</p>`); return; }
  if (seq !== U.seq) return;
  draw(el, sym, F);
}

function draw(el, sym, F) {
  const hasQ = F.rows.length >= 4, hasY = (F.annual || []).length >= 2;
  let mode = U.mode; if (mode === 'y' && !hasY) mode = hasQ ? 'q' : 'y'; if (mode !== 'y' && !hasQ) mode = 'y';
  let rows = mode === 'y' ? F.annual : mode === 't' ? ttm(F.rows) : F.rows;
  if (U.range === '5Y') rows = rows.slice(mode === 'y' ? -6 : -20);
  const cur = F.cur, c = C(), z = rows[rows.length - 1] || {}, M = r => margins(r);
  const T = ttm(F.rows), tz = T[T.length - 1] || (mode === 'y' ? z : null);
  const g = yoy(F.rows, 'rev'), gn = yoy(F.rows, 'net'), ge = yoy(F.rows, 'eps');
  const netDebt = z.debt != null && z.cash != null ? z.debt - z.cash : null;
  const kp = (k, v, s, cls = '') => html`<div class="kpi"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="s">${s}</span></div>`;
  const mt = trend(rows, r => M(r).net), ft = trend(rows, r => r.fcf);
  const head = html`<div class="card-head"><h2>Fundamentals</h2><div class="toolbar">
      <div class="seg" id="fMode">${hasQ ? html`<button data-m="q" class="${mode === 'q' ? 'on' : ''}">Quarterly</button><button data-m="t" class="${mode === 't' ? 'on' : ''}">TTM</button>` : ''}${hasY ? html`<button data-m="y" class="${mode === 'y' ? 'on' : ''}">Yearly</button>` : ''}</div>
      <div class="seg" id="fRange"><button data-r="5Y" class="${U.range === '5Y' ? 'on' : ''}">5Y</button><button data-r="All" class="${U.range === 'All' ? 'on' : ''}">All</button></div></div></div>`;
  if (!rows.length) { render(el, html`${head}<p class="muted small" style="margin:0">Not enough reported periods yet.</p>`); wire(el, sym, F); return; }
  const lastQ = F.rows[F.rows.length - 1];
  render(el, html`${head}
    <div class="kpis">
      ${kp(mode === 'y' ? 'Revenue (year)' : 'Revenue (last quarter)', amt(mode === 'y' ? z.rev : lastQ.rev, cur), g != null && mode !== 'y' ? sgn(g) + ' vs a year ago' : '', g > 0 ? 'up' : g < 0 ? 'down' : '')}
      ${kp('Net profit growth', sgn(gn), 'last quarter vs a year ago', gn > 0 ? 'up' : gn < 0 ? 'down' : '')}
      ${ge != null ? kp('EPS growth', sgn(ge), 'diluted, vs a year ago', ge >= 0.25 ? 'up' : ge < 0 ? 'down' : '') : ''}
      ${tz && M(tz).net != null ? kp('Net margin', pct(M(tz).net, 1), mode === 'y' ? 'last year' : 'trailing 12 months') : lastQ && M(lastQ).net != null ? kp('Net margin', pct(M(lastQ).net, 1), 'last quarter') : ''}
      ${tz && tz.fcf != null ? kp('Free cash flow', amt(tz.fcf, cur), mode === 'y' ? 'last year' : 'trailing 12 months', tz.fcf >= 0 ? 'up' : 'down') : ''}
      ${netDebt != null ? kp(netDebt > 0 ? 'Net debt' : 'Net cash', amt(Math.abs(netDebt), cur), z.equity ? 'debt / equity ' + (z.debt / z.equity).toFixed(2) : 'debt minus cash', netDebt > 0 ? '' : 'up') : ''}
    </div>
    <div class="fgrid">
      <div class="fpanel"><h3>Revenue and net profit</h3>${raw(bars(rows, [{ name: 'Revenue', color: c.rev, get: r => r.rev }, { name: 'Net profit', color: c.net, negColor: c.neg, get: r => r.net }], { cur, mode }))}
        ${legend([[c.rev, 'Revenue'], [c.net, 'Net profit (red = loss)']])}
        <p class="small muted">${g != null ? `Revenue ${g >= 0 ? 'grew' : 'fell'} ${pct(Math.abs(g))} in the last quarter vs a year earlier` : 'Revenue trend over the periods shown'}${gn != null ? `; net profit ${sgn(gn)}.` : '.'}${g >= 0.25 ? ' O’Neil looks for accelerating sales growth of 25% or more.' : ''}</p></div>
      ${F.limited ? '' : html`<div class="fpanel"><h3>Margins${mode === 'q' ? ' (per quarter)' : ''}</h3>${raw(pctLines(rows, [{ name: 'Gross margin', color: c.gross, get: r => M(r).gross }, { name: 'Operating margin', color: c.op, get: r => M(r).op }, { name: 'Net margin', color: c.netm, get: r => M(r).net }], { mode }))}
        ${legend([[c.gross, 'Gross'], [c.op, 'Operating'], [c.netm, 'Net']])}
        <p class="small muted">${mt == null ? 'Profit as a share of revenue.' : mt > 0.01 ? `Net margin is rising (${sgn(mt, 1)} points over the last 5 periods): the company keeps more of each sale.` : mt < -0.01 ? `Net margin is falling (${sgn(mt, 1)} points over the last 5 periods): check costs and pricing.` : 'Net margin is stable over the last 5 periods.'}</p></div>
      <div class="fpanel"><h3>Cash flow</h3>${raw(bars(rows, [{ name: 'Operating cash flow', color: c.ocf, negColor: c.neg, get: r => r.ocf }, { name: 'Capital spending', color: c.capex, get: r => (r.capex != null ? -r.capex : null) }], { cur, mode, lines: [{ name: 'Free cash flow', color: c.fcf, get: r => r.fcf }] }))}
        ${legend([[c.ocf, 'Operating cash flow'], [c.capex, 'Capital spending'], [c.fcf, 'Free cash flow (line)']])}
        <p class="small muted">Free cash flow = cash from operations minus investment in equipment and buildings. ${ft == null ? '' : ft > 0 ? 'It is higher than 5 periods ago.' : 'It is lower than 5 periods ago.'}${tz && tz.net && tz.ocf ? ` Over the last 12 months cash from operations was ${(tz.ocf / tz.net).toFixed(1)}× net profit${tz.ocf / tz.net < 0.8 ? ': lower than profit, worth a closer look' : ': profits are backed by cash'}.` : ''}</p></div>
      <div class="fpanel"><h3>Debt and cash</h3>${raw(bars(rows, [{ name: 'Debt', color: c.debt, get: r => r.debt }, { name: 'Cash and short-term investments', color: c.cash, get: r => r.cash }], { cur, mode }))}
        ${legend([[c.debt, 'Debt'], [c.cash, 'Cash and short-term investments']])}
        <p class="small muted">${netDebt == null ? 'Balance sheet at the end of each period.' : netDebt <= 0 ? `More cash than debt: ${amt(-netDebt, cur)} net cash.` : `Net debt ${amt(netDebt, cur)}${tz && tz.fcf > 0 ? `, about ${(netDebt / tz.fcf).toFixed(1)} years of free cash flow` : ''}.`} O’Neil prefers companies that have been reducing debt.</p></div>`}
    </div>
    <p class="muted tiny" style="margin:0">Source: ${F.src}${cur ? ' · amounts in ' + cur : ''} · last period ${lastQ ? lastQ.end : z.end}${F.stale ? ' · saved figures (update failed)' : ''}. Refreshed daily; when a new quarter is filed you get an alert. TTM = the last four quarters added up. ${F.limited ? 'Margins, cash flow and debt load in the desktop app (SEC filings / free feed) or with an FMP key.' : ''}</p>`);
  wire(el, sym, F);
}

function wire(el, sym, F) {
  $$('#fMode [data-m]', el).forEach(b => { b.onclick = () => { U.mode = b.dataset.m; store.set('fund.mode', U.mode); draw(el, sym, F); }; });
  $$('#fRange [data-r]', el).forEach(b => { b.onclick = () => { U.range = b.dataset.r; store.set('fund.range', U.range); draw(el, sym, F); }; });
}
