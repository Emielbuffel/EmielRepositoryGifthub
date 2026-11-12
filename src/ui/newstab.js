// The News tab: the latest headlines for the stocks you hold (first) and your watchlists, in one list, newest first.
// Same free sources as the news card on the stock page (Yahoo Finance, Nasdaq, Google News, SEC filings, your provider);
// only headline, source, time and a link to the original article are shown.
import { stockNews, newsSettings } from '../data/news.js';
import { isApp } from '../data/net.js';
import { isDemo } from '../data/service.js';
import * as store from '../data/store.js';
import { App, openStock, on } from '../app.js';
import { $, $$, html, raw, render, ICON, ago } from './dom.js';

const N = { items: [], at: null, busy: false, scope: 'mine', tag: 'all', seen: 0, done: 0, total: 0, blocked: false };
const TAG = { earnings: ['Earnings', 't-ok'], analyst: ['Analyst', 't-blue'], deal: ['Deal', 't-warn'], filing: ['Filing', 't-mute'], product: ['Product', 't-blue'], other: ['News', 't-mute'] };
const agoT = ms => { if (!ms) return ''; const h = (Date.now() - ms) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'; };

const held = () => (App.holdings || []).map(h => h.sym);
const watched = () => [...new Set((App.lists || []).flatMap(l => l.syms || []))];

export function initNews() {
  const el = $('#view-news');
  render(el, html`<div class="card">
    <div class="card-head"><h2>News</h2><div class="toolbar"><span class="muted tiny" id="nwAt"></span><button class="btn sm" id="nwRef">${raw(ICON.refresh)}<span>Check now</span></button></div></div>
    <div class="chips" id="nwScope"></div>
    <div class="chips" id="nwTags"></div>
    <div id="nwProg" class="muted small" hidden></div>
    <div id="nwList"></div>
    <p class="muted tiny" style="margin:0" id="nwFoot"></p>
  </div>`);
  $('#nwRef').onclick = () => load(true);
  on(t => { if (t === 'holdings' && App.view === 'news') load(false); if (t === 'view' && App.view === 'news') load(false); });
  store.get('newsTabSeen', 0).then(v => { N.seen = v; });
  load(false);
}

async function load(force) {
  if (N.busy) return;
  if (!force && N.at && Date.now() - N.at < 15 * 60e3) { paint(); return; }
  const H = held(), W = watched().filter(s => !H.includes(s)), syms = [...H, ...W].slice(0, 60);
  N.busy = true; N.done = 0; N.total = syms.length; paint();
  const all = [], q = syms.slice(); let blocked = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (q.length) {
      const sym = q.shift();
      try {
        const r = await stockNews(sym, App.names[sym] || '');
        if (r.browserBlocked) blocked++;
        r.items.forEach(x => all.push({ ...x, sym, mine: H.includes(sym) }));
      } catch (e) { /* this stock's sources failed */ }
      N.done++; if (N.done % 3 === 0) paint();
    }
  }));
  // one line per story: the same headline for two stocks is shown once (with both tickers)
  const by = new Map();
  for (const x of all.sort((a, b) => (b.date || 0) - (a.date || 0))) {
    const k = x.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const o = by.get(k); if (o) { if (!o.syms.includes(x.sym)) o.syms.push(x.sym); o.mine = o.mine || x.mine; } else by.set(k, { ...x, syms: [x.sym] });
  }
  N.items = [...by.values()]; N.at = Date.now(); N.busy = false; N.blocked = syms.length > 0 && blocked === syms.length;
  paint();
  await store.set('newsTabSeen', Date.now());
}

function paint() {
  const H = held(), W = watched();
  const scopes = [['mine', `My portfolio (${H.length})`], ['watch', `Watchlists (${W.filter(s => !H.includes(s)).length})`], ['all', 'Everything']];
  render($('#nwScope'), html`${scopes.map(([k, l]) => html`<button class="chip${N.scope === k ? ' on' : ''}" data-sc="${k}">${l}</button>`)}`);
  $$('[data-sc]').forEach(b => { b.onclick = () => { N.scope = b.dataset.sc; paint(); }; });
  let list = N.items.filter(x => N.scope === 'all' || (N.scope === 'mine' ? x.mine : !x.mine));
  const tags = ['all', ...new Set(list.map(x => x.tag))];
  render($('#nwTags'), list.length > 3 ? html`${tags.map(t => html`<button class="chip${N.tag === t ? ' on' : ''}" data-tg="${t}">${t === 'all' ? 'All kinds' : (TAG[t] || TAG.other)[0]}</button>`)}` : '');
  $$('[data-tg]').forEach(b => { b.onclick = () => { N.tag = b.dataset.tg; paint(); }; });
  if (N.tag !== 'all') list = list.filter(x => x.tag === N.tag);
  const prog = $('#nwProg'); prog.hidden = !N.busy; prog.textContent = N.busy ? `Checking ${N.done} of ${N.total} stocks…` : '';
  $('#nwAt').textContent = N.at ? 'Checked ' + ago(N.at) : '';
  const empty = !H.length && !W.length ? 'Add holdings (Portfolio tab) or stocks to a watchlist to see their news here.'
    : N.blocked ? (isApp() ? 'The news sources did not answer. Try again later.' : 'News feeds load in the Mac app, the iPhone app and on your own website with its data relay (Settings → Phone & updates). This page in a browser cannot reach them: browsers block those feeds.')
    : N.busy ? 'Checking the news sources…' : N.scope === 'mine' && !H.length ? 'No holdings yet: add them in the Portfolio tab.' : 'No recent headlines from the enabled sources.';
  render($('#nwList'), list.length ? html`<div class="news-list">${list.slice(0, 150).map(x => {
    const isNew = N.seen && x.date && x.date > N.seen, t = TAG[x.tag] || TAG.other;
    const body = html`<span class="nt">${isNew ? html`<span class="new">NEW</span> ` : ''}${x.title}</span><span class="nm">${x.syms.map(s => html`<button class="chip sm nw-sym${x.mine ? ' on' : ''}" data-open="${s}">${s}</button>`)}<span class="tag ${t[1]}">${t[0]}</span>${x.source || x.domain}${x.date ? ' · ' + agoT(x.date) : ''}${x.paywalled ? ' · paywall' : ''}</span>`;
    return x.link ? html`<a class="news-item" href="${x.link}" target="_blank" rel="noopener">${body}</a>` : html`<div class="news-item">${body}</div>`;
  })}</div>` : html`<p class="muted small" style="margin:0">${empty}</p>`);
  $$('[data-open]').forEach(b => { b.onclick = e => { e.preventDefault(); e.stopPropagation(); openStock(b.dataset.open); }; });
  $('#nwFoot').textContent = isDemo() ? 'Demo mode: example headlines.' : `Headlines only, with a link to the original article. ${Object.entries(newsSettings().sources).filter(([, v]) => v).length} free sources (Settings → News)${newsSettings().hidePaywalled ? ', paywalled sites hidden' : ''}. Your portfolio first; the stock page shows each stock's news too.`;
}
