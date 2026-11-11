// The "Sell ideas" tab: the stocks you own, weakest first, with what to sell when you hold more stocks than your limit
// or need room for a new leader — and stronger stocks from your last scan that could take their place.
import PAT from '../core/pat.js';
import { screenRow, pc } from '../core/analysis.js';
import { assessHolding, rankHoldings } from '../core/prune.js';
import { DEFAULT_PLAN } from '../core/strategy.js';
import { daily, benchmarkFor, provider } from '../data/service.js';
import { strategy } from '../data/plans.js';
import { factor } from '../data/fx.js';
import * as store from '../data/store.js';
import { App, on, openStock, go } from '../app.js';
import { $, $$, html, raw, render, money, ICON } from './dom.js';

const V = { seq: 0, busy: false };
const TONE = { sell: 't-bad', weak: 't-warn', dead: 't-warn', hold: 't-blue', leader: 't-ok' };
const LABEL = { sell: 'Sell', weak: 'Weak', dead: 'Not moving', hold: 'Hold', leader: 'Leader' };

export async function initPrune(el) {
  render(el, html`
    <section class="card" id="prSum"><p class="muted small" style="margin:0">Loading your stocks…</p></section>
    <section class="card" id="prList"></section>
    <section class="card" id="prRepl" hidden></section>
    <p class="disclaimer">Suggestions apply the book's sell rules and your playbook to the latest prices: hard sell rules first, then a keep score from strength, trend, recent progress, your gain and fund buying. They are an educational aid, not investment advice; you decide.</p>`);
  on(type => { if (['holdings', 'live', 'scan', 'strategy', 'provider'].includes(type) && App.view === 'prune') load(); if (type === 'view' && App.view === 'prune') load(); });
  load();
}

async function load() {
  const seq = ++V.seq, H = (App.holdings || []).filter(h => h.sym && h.shares > 0);
  const S = { ...DEFAULT_PLAN, ...(await strategy()) }, z = S.sz, max = z ? z.maxPositions : 8;
  if (!H.length) {
    render($('#prSum'), html`<div class="empty">${raw(ICON.portfolio)}<p>No holdings yet. Import your broker statement or add positions on the Portfolio tab, and this page ranks them weakest first.</p><button class="btn primary" id="prGo">Open Portfolio</button></div>`);
    $('#prGo').onclick = () => go('portfolio'); $('#prList').innerHTML = ''; $('#prRepl').hidden = true; return;
  }
  const items = [], vals = {}, scan = await store.get('screen.' + provider().id, null);
  const rsOf = s => { const r = scan && scan.rows.find(x => x.s === s); return r && r.rs != null ? r.rs : App.last[s] && App.last[s].rs != null ? App.last[s].rs : null; };
  for (const h of H) {
    try {
      const d = await daily(h.sym), b = d.bars, R = PAT.scan(b);
      let bench = null; try { bench = (await benchmarkFor(h.sym)).bars; } catch (e) { /* no index */ }
      const row = screenRow(h.sym, d.name || '', b, R, null);
      const a = assessHolding(h, b, R, { bench, rs: rsOf(h.sym), sells: row ? row.sell : [], stop: S.stop });
      a.name = d.name || App.names[h.sym] || ''; a.cur = d.currency; a.close = b[b.length - 1].close; a.shares = h.shares;
      const f = await factor(d.currency || '', S.ccy).catch(() => null); a.value = a.close * h.shares * (f ? f.v : 1); vals[h.sym] = a.value;
      items.push(a);
    } catch (e) { items.push({ sym: h.sym, score: 0, verdict: 'hold', title: 'No prices', reasons: [['warn', 'Prices could not be loaded: ' + e.message]], m: {}, name: App.names[h.sym] || '' }); }
    if (seq !== V.seq) return;
  }
  const r = rankHoldings(items, { max }), total = items.reduce((t, x) => t + (x.value || 0), 0);
  const n0 = x => Math.round(x).toLocaleString('en-US') + ' ' + S.ccy, freed = syms => syms.reduce((t, s) => t + (vals[s] || 0), 0);
  const nm = s => { const x = items.find(i => i.sym === s); return html`<b>${s}</b>${x && x.name ? html` <span class="muted">(${x.name})</span>` : ''}`; };
  render($('#prSum'), html`
    <div class="card-head"><h2>Sell ideas</h2><span class="muted tiny">${items.length} stock${items.length === 1 ? '' : 's'} · limit now ${max} · ${n0(total)} in stocks</span></div>
    ${z ? html`<p class="small" style="margin:0">Limit ${max} = ${Math.round(z.allowed * 100)}% invested ÷ ${Math.round(S.posPct * 100)}% per position, because the market is ${z.market === 'corr' ? 'in a correction (0–20% invested, no margin)' : z.market === 'press' ? 'under pressure (40–60% invested, no margin)' : `in a confirmed uptrend (100%${z.maxMargin ? ' + up to ' + Math.round(z.maxMargin * 100) + '% margin' : ''})`}. Own money ${n0(z.equity)}${z.loan ? `, margin loan ${n0(z.loan)} (${Math.round(z.marginPct * 100)}%)` : ''}; ${z.exposure != null ? Math.round(z.exposure * 100) + '% invested' : ''}.</p>` : ''}
    <div class="pr-kpis">
      <div class="pr-k ${r.over ? 't-bad' : 't-ok'}"><b>${items.length} / ${max}</b><span>${r.over ? r.over + ' more than your limit' : 'within your limit'}</span></div>
      <div class="pr-k ${r.sellNow.length ? 't-bad' : 't-ok'}"><b>${r.sellNow.length}</b><span>sell rule broken</span></div>
      <div class="pr-k ${r.list.filter(x => x.verdict === 'weak' || x.verdict === 'dead').length ? 't-warn' : 't-ok'}"><b>${r.list.filter(x => x.verdict === 'weak' || x.verdict === 'dead').length}</b><span>weak or not moving</span></div>
      <div class="pr-k t-ok"><b>${r.list.filter(x => x.verdict === 'leader').length}</b><span>leaders to keep</span></div>
    </div>
    <ul class="plan pr-todo">
      ${r.sellNow.length ? html`<li class="t-bad"><b>Sell now (a rule is broken):</b> ${r.sellNow.map((s, i) => html`${i ? ', ' : ''}${nm(s)}`)}.</li>` : ''}
      ${r.over && r.sellNow.length >= r.over ? html`<li><b>You hold ${r.over} more than your limit of ${max}.</b> Selling the stocks above (a rule is broken) already brings you within it, and frees about ${n0(freed(r.sellNow))}.</li>` : ''}
      ${r.over && r.sellNow.length < r.over ? html`<li><b>You hold ${r.over} more than your limit of ${max}.</b> Sell the ${r.over === 1 ? 'weakest' : r.over + ' weakest'}${r.sellNow.length ? ' (the ones with a broken rule first)' : ''}: ${r.suggest.map((s, i) => html`${i ? ', ' : ''}${nm(s)}`)} — frees about ${n0(freed(r.suggest))} for your leaders or a new breakout.</li>` : ''}
      ${z && z.loan > 0 && z.market !== 'up' ? html`<li class="t-bad"><b>Pay back the margin loan (${n0(z.loan)}):</b> the market is no longer in a confirmed uptrend. Selling ${repay(r.list, z.loan, vals).map((s, i) => html`${i ? ', ' : ''}${nm(s)}`)} (weakest first) covers it.</li>` : ''}
      ${z && z.marginPct > z.maxMargin + 1e-9 ? html`<li class="t-bad"><b>Margin above your ${Math.round(z.maxMargin * 100)}% limit:</b> bring the loan down by about ${n0(z.loan - z.maxMargin * z.equity)} — selling the weakest first.</li>` : ''}
      ${!r.over && r.room ? html`<li><b>Need room for a new buy?</b> Sell ${nm(r.room)} first (the weakest now, keep score ${r.list[0].score}).</li>` : ''}
      <li class="muted small">The book: keep your money in your best stocks and sell the laggards; to add a new stock, sell the weakest; use margin only in a bull market, and cut losses even faster with it. Each sale costs the stock-exchange tax (TOB), and gains are taxed 10% in Belgium since 2026.</li>
    </ul>`);
  render($('#prList'), html`
    <div class="card-head"><h2>Your stocks, weakest first</h2><span class="muted tiny">Keep score 0–100 · tap a stock for its chart</span></div>
    <div class="tbl-wrap"><table class="tbl pr">
      <thead><tr><th>#</th><th>Stock</th><th>Verdict</th><th class="n">Keep score</th><th class="n">Your gain</th><th class="n">3 mo</th><th class="n">8 wk</th><th class="n">RS</th><th class="n">Value</th></tr></thead>
      <tbody>${r.list.map((x, i) => html`
        <tr class="click pr-main" data-s="${x.sym}"><td class="n">${i + 1}</td><td><b>${x.sym}</b><div class="muted tiny">${x.name || ''}</div></td>
          <td><span class="tag ${TONE[x.verdict]}">${LABEL[x.verdict]}</span></td>
          <td class="n"><span class="pr-bar"><i style="width:${x.score}%" class="${x.score >= 75 ? 'ok' : x.score < 45 ? 'bad' : 'warn'}"></i></span> ${x.score}</td>
          <td class="n ${x.m.gain >= 0 ? 'up' : x.m.gain < 0 ? 'down' : ''}">${x.m.gain != null ? pc(x.m.gain, 1) : '—'}</td>
          <td class="n ${x.m.m3 >= 0 ? 'up' : 'down'}">${x.m.m3 != null ? pc(x.m.m3, 0) : '—'}</td>
          <td class="n ${x.m.w8 >= 0 ? 'up' : 'down'}">${x.m.w8 != null ? pc(x.m.w8, 0) : '—'}</td>
          <td class="n">${x.m.rs ?? '—'}</td><td class="n">${x.value ? n0(x.value) : '—'}</td></tr>
        <tr class="pr-why"><td></td><td colspan="8"><b>${x.title}.</b> ${x.reasons.map(([t, s]) => html`<span class="t-${t === 'ok' ? 'ok' : t === 'bad' ? 'bad' : 'warn'}">●</span> ${s} `)}</td></tr>`)}</tbody>
    </table></div>
    <p class="muted tiny" style="margin:0">Keep score: strength vs the market or the scan's RS rank (25), trend — above the 50- and 200-day lines, rising 50-day (25), 3-month change (20), progress over 8 weeks (10), your gain (10), accumulation/distribution (10). Hard rules override the score: a loss past your ${Math.round(S.stop * 100)}% stop, a falling 200-day line, a failed breakout or a heavy-volume break of the 50-day line. Not moving = less than ±5% in 8 weeks.</p>`);
  $$('#prList tr[data-s]').forEach(tr => { tr.onclick = () => openStock(tr.dataset.s); });
  // stronger candidates from the last scan, not owned yet
  const own = new Set(items.map(x => x.sym)), cand = scan ? scan.rows.filter(x => !own.has(x.s) && x.p && ['buyzone', 'near'].includes(x.p.st) && !x.p.f && (x.rs || 0) >= 70).sort((a, b) => (b.sc || 0) - (a.sc || 0) || (b.rs || 0) - (a.rs || 0)).slice(0, 6) : [];
  $('#prRepl').hidden = !cand.length;
  if (cand.length) {
    render($('#prRepl'), html`<div class="card-head"><h2>Stronger stocks that could take their place</h2><span class="muted tiny">From your last scan · in a buy zone or near a buy point, RS 70+</span></div>
      <ul class="alist">${cand.map(x => html`<li data-s="${x.s}"><span class="t">${x.s}</span><span class="n">${x.nm || ''}</span><span class="small num">${x.p.st === 'buyzone' ? 'buy zone ' + pc(x.p.di, 1) : pc(x.p.di, 1) + ' to buy point'} · RS ${x.rs}</span></li>`)}</ul>`);
    $$('#prRepl li[data-s]').forEach(li => { li.onclick = () => openStock(li.dataset.s); });
  }
}

/** The weakest stocks whose sale covers `amount` (e.g. a margin loan). */
function repay(list, amount, vals) {
  const out = []; let t = 0;
  for (const x of list) { if (t >= amount) break; if (vals[x.sym]) { out.push(x.sym); t += vals[x.sym]; } }
  return out;
}
