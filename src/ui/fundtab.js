// The Fundamentals tab: choose up to four stocks and compare their growth, margins, cash flow and balance sheet
// in charts, then read each company's full fundamentals card. Data: SEC filings, the free Yahoo feed or FMP
// (see data/fundamentals.js); refreshed daily.
import { fundamentals } from '../data/fundamentals.js';
import { companyInfo } from '../data/company.js';
import { ttm, margins } from '../core/fundamentals.js';
import { provider, settings, isDemo } from '../data/service.js';
import * as store from '../data/store.js';
import { App, on } from '../app.js';
import { $, $$, html, raw, render, tok, ICON, toast } from './dom.js';
import { fundCard, amt } from './fundui.js';

const T = { syms: [], data: {}, co: {}, seq: 0 };
const COLORS = ['--blue', '--orange', '--teal', '--purple'];
const DAY = 864e5, MAX = 4;
const pct = (x, d = 0) => (x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d) + '%');
const sgn = x => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(0) + '%');

export async function initFundTab(el) {
  T.syms = await store.get('fund.tab.syms', []);
  render(el, html`
    <section class="card">
      <div class="card-head"><h2>Compare fundamentals</h2><span class="muted tiny">up to ${MAX} stocks</span></div>
      <div class="row" style="gap:8px;justify-content:flex-start;flex-wrap:wrap">
        <input class="input" id="ftIn" placeholder="Add a stock: ticker or name" style="max-width:280px" autocomplete="off" autocapitalize="characters" spellcheck="false" list="ftList">
        <datalist id="ftList"></datalist>
        <button class="btn primary" id="ftAdd">${raw(ICON.plus)}Add</button>
        <div class="chips" id="ftSel" style="flex:1;min-width:0"></div>
      </div>
      <div class="row" style="gap:6px;justify-content:flex-start;flex-wrap:wrap"><span class="muted tiny">Quick add:</span><div class="chips" id="ftQuick" style="flex:1;min-width:0"></div></div>
    </section>
    <section class="card" id="ftCmp"></section>
    <div id="ftCards" style="display:grid;gap:14px"></div>
    <p class="disclaimer">Figures from company filings (SEC EDGAR for US companies), the free Yahoo Finance feed or FMP, as available. Educational, not investment advice.</p>`);
  const add = async () => {
    const v = $('#ftIn').value.trim(); if (!v) return;
    let sym = v.toUpperCase().replace(/\s+/g, '');
    if (!/^\^?[A-Z0-9]{1,6}([.\-][A-Z0-9]{1,4})?$/.test(sym)) { // a name: find the ticker
      try { const r = await provider().search(v, settings.keys[settings.provider]); if (r.length) sym = r[0].symbol; else { toast('No stock found for "' + v + '".'); return; } } catch (e) { toast(e.message); return; }
    }
    $('#ftIn').value = ''; addSym(sym);
  };
  $('#ftAdd').onclick = add;
  $('#ftIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  on(type => { if (type === 'view' && App.view === 'fund') { quick(); if (!T.syms.length && App.sym) addSym(App.sym); } if (type === 'watch' || type === 'holdings') quick(); });
  quick();
  if (!T.syms.length && App.sym && !isDemo()) T.syms = [App.sym];
  refresh();
}

function quick() {
  const el = $('#ftQuick'); if (!el) return;
  const list = [...new Set([...(App.holdings || []).map(h => h.sym), ...App.watch])].filter(s => !/\.DEMO$/.test(s) && !T.syms.includes(s)).slice(0, 24);
  render(el, html`${list.map(s => html`<button class="chip" data-q="${s}">${s}</button>`)}`);
  render($('#ftList'), html`${list.map(s => html`<option value="${s}">${App.names[s] || ''}</option>`)}`);
  $$('[data-q]', el).forEach(b => { b.onclick = () => addSym(b.dataset.q); });
}
function addSym(sym) {
  if (T.syms.includes(sym)) return;
  if (T.syms.length >= MAX) T.syms.shift();
  T.syms.push(sym); store.set('fund.tab.syms', T.syms); quick(); refresh();
}
function chips() {
  render($('#ftSel'), html`${T.syms.map((s, i) => html`<span class="chip on" style="background:${tok(COLORS[i])}"><b>${s}</b><button class="x" data-rm="${s}" aria-label="Remove ${s}">×</button></span>`)}`);
  $$('[data-rm]').forEach(b => { b.onclick = () => { T.syms = T.syms.filter(x => x !== b.dataset.rm); store.set('fund.tab.syms', T.syms); quick(); refresh(); }; });
}

async function refresh() {
  chips();
  const seq = ++T.seq, cards = $('#ftCards');
  if (!T.syms.length) { render($('#ftCmp'), html`<div class="empty">${raw(ICON.fund)}<p>Add one or more stocks to see their revenue, profit, margins, cash flow and debt over the years.</p></div>`); cards.innerHTML = ''; return; }
  render($('#ftCmp'), html`<div class="empty"><span class="spinner"></span><span>Loading results…</span></div>`);
  // one full card per stock
  render(cards, html`${T.syms.map(s => html`<section class="card" data-fc="${s}"></section>`)}`);
  T.syms.forEach(s => { const c = cards.querySelector(`[data-fc="${s}"]`); c.dataset.title = `${s} · ${App.names[s] || 'fundamentals'}`; fundCard(s, c); });
  await Promise.all(T.syms.map(async s => {
    if (!T.data[s]) { try { T.data[s] = await fundamentals(s); } catch (e) { T.data[s] = { error: e.message }; } }
    if (!T.co[s]) { try { T.co[s] = await companyInfo(s); } catch (e) { T.co[s] = null; } }
  }));
  if (seq !== T.seq) return;
  compare();
}

/* series per stock: quarterly when there are enough quarters, else yearly */
function series(F) {
  if (!F || F.error) return null;
  const q = F.rows || [], useQ = q.length >= 6, rows = useQ ? q : (F.annual || []);
  const t = r => Date.parse(r.end);
  const yoy = k => rows.map((r, i) => { const a = rows.find(x => Math.abs((t(r) - t(x)) / DAY - 365) <= 25); return a && a[k] && r[k] != null ? [t(r), (r[k] - a[k]) / Math.abs(a[k])] : null; }).filter(Boolean);
  const T4 = useQ ? ttm(q) : rows;
  const mg = k => T4.map(r => [t(r), margins(r)[k]]).filter(p => p[1] != null && isFinite(p[1]));
  return { useQ, rev: yoy('rev'), eps: yoy('eps'), net: mg('net'), op: mg('op'), fcf: mg('fcf'), last: T4[T4.length - 1] || null, lastQ: q[q.length - 1] || rows[rows.length - 1], cur: F.cur, src: F.src };
}

/** Lines over time for several stocks (x = date), values as % (capped to keep outliers readable). */
function timeLines(list, { h = 200, cap = 2 } = {}) {
  const all = list.flatMap(s => s.pts).filter(p => isFinite(p[1]));
  if (all.length < 2) return '<p class="muted small" style="margin:0">Not enough data.</p>';
  const W = 620, l = 46, r = 10, top = 10, bot = 24;
  const clip = v => Math.max(-cap, Math.min(cap, v));
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0]));
  let mx = Math.max(0, ...all.map(p => clip(p[1]))), mn = Math.min(0, ...all.map(p => clip(p[1]))); const pad = (mx - mn) * 0.08 || 0.05; mx += pad; if (mn < 0) mn -= pad;
  const X = t => l + (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5) * (W - l - r), Y = v => top + (mx - clip(v)) / (mx - mn) * (h - top - bot);
  const span = mx - mn, tick = span > 2 ? 0.5 : span > 1 ? 0.25 : span > 0.4 ? 0.1 : 0.05;
  let g = '';
  for (let v = Math.ceil(mn / tick) * tick; v <= mx + 1e-9; v += tick) g += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${Math.abs(v) < 1e-9 ? 'var(--sep)' : 'var(--grid)'}"/><text x="${l - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(v * 100)}%</text>`;
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), stepY = Math.max(1, Math.ceil((y1 - y0 + 1) / 8));
  for (let y = y0; y <= y1 + 1; y += stepY) { const t = Date.UTC(y, 0, 1); if (t >= t0 && t <= t1) g += `<text x="${X(t)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${y}</text>`; }
  for (const s of list) {
    const pts = s.pts.filter(p => isFinite(p[1])).sort((a, b) => a[0] - b[0]); if (!pts.length) continue;
    if (pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}"/>`;
    pts.forEach((p, i) => { g += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${i === pts.length - 1 ? 3.5 : 1.8}" fill="${s.color}"><title>${s.name} · ${new Date(p[0]).toISOString().slice(0, 10)}: ${pct(p[1], 1)}</title></circle>`; });
  }
  return `<svg viewBox="0 0 ${W} ${h}" class="fchart" role="img">${g}</svg>`;
}

function compare() {
  const el = $('#ftCmp'), S = T.syms.map((s, i) => ({ s, color: tok(COLORS[i]), d: series(T.data[s]), co: T.co[s], err: T.data[s] && T.data[s].error }));
  const ok = S.filter(x => x.d);
  const leg = html`<div class="legend small">${S.map(x => html`<span><i style="background:${x.color};height:10px;width:10px;border-radius:3px"></i>${x.s}${x.err ? ' (no data)' : ''}</span>`)}</div>`;
  const panel = (title, key, note, opt) => html`<div class="fpanel"><h3>${title}</h3>${raw(timeLines(ok.map(x => ({ name: x.s, color: x.color, pts: x.d[key] })), opt))}<p class="small muted">${note}</p></div>`;
  const row = x => {
    const L = x.d && x.d.last, Q = x.d && x.d.lastQ, m = L ? margins(L) : {}, rg = x.d && x.d.rev.length ? x.d.rev[x.d.rev.length - 1][1] : null, eg = x.d && x.d.eps.length ? x.d.eps[x.d.eps.length - 1][1] : null;
    const nd = Q && Q.debt != null && Q.cash != null ? Q.debt - Q.cash : null;
    return html`<tr><td><b style="color:${x.color}">${x.s}</b><div class="muted tiny">${(x.co && x.co.name) || App.names[x.s] || ''}</div></td>
      <td class="n">${L ? amt(L.rev, x.d.cur) : '—'}</td><td class="n ${rg > 0 ? 'up' : rg < 0 ? 'down' : ''}">${sgn(rg)}</td><td class="n ${eg >= 0.25 ? 'up' : eg < 0 ? 'down' : ''}">${sgn(eg)}</td>
      <td class="n">${pct(m.gross)}</td><td class="n">${pct(m.net, 1)}</td><td class="n ${L && L.fcf < 0 ? 'down' : ''}">${L ? amt(L.fcf, x.d.cur) : '—'}</td>
      <td class="n">${nd == null ? '—' : (nd > 0 ? '' : 'cash ') + amt(Math.abs(nd), x.d.cur)}</td>
      <td class="n ${x.co && x.co.roe >= 0.17 ? 'up' : ''}">${x.co && x.co.roe != null ? pct(x.co.roe) : '—'}</td><td class="n">${x.co && x.co.pe ? x.co.pe.toFixed(1) : '—'}</td></tr>`;
  };
  render(el, html`<div class="card-head"><h2>Side by side</h2>${leg}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th class="n">Revenue (12 m)</th><th class="n">Sales growth</th><th class="n">EPS growth</th><th class="n">Gross margin</th><th class="n">Net margin</th><th class="n">Free cash flow</th><th class="n">Net debt</th><th class="n">ROE</th><th class="n">P/E</th></tr></thead>
      <tbody>${S.map(row)}</tbody></table></div>
    ${ok.length ? html`<div class="fgrid">
      ${panel('Sales growth vs a year earlier', 'rev', "O'Neil looks for sales growth of 25%+ (or accelerating).")}
      ${panel('EPS growth vs a year earlier', 'eps', 'The book wants at least +20–25% in the latest quarters, ideally accelerating.', { cap: 3 })}
      ${panel('Net margin (12 months)', 'net', 'Profit kept from each sale; leaders often have the best margins in their group.')}
      ${panel('Free cash flow margin (12 months)', 'fcf', 'Cash left after investment, as a share of sales.')}
    </div>` : html`<p class="muted small" style="margin:0">${S.map(x => x.err).filter(Boolean)[0] || 'No data.'}</p>`}
    <p class="muted tiny" style="margin:0">Growth compares each period with the same period a year earlier. Values above ${'200%'} are drawn at the edge of the chart. ${ok.some(x => !x.d.useQ) ? 'Stocks with few quarterly reports use yearly figures.' : ''}</p>`);
}
