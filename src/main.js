// App entry: navigation (tab bar on iPhone, sidebar on iPad/Mac), first-launch welcome and boot.
import { App, VIEWS, on, go, openStock, loadState } from './app.js';
import { loadSettings, isDemo, provider } from './data/service.js';
import { Capacitor } from '@capacitor/core';
import * as store from './data/store.js';
import { $, $$, html, raw, render, ICON, sheet } from './ui/dom.js';
import { pc } from './core/analysis.js';
import { initStock } from './ui/stock.js';
import { initMarket } from './ui/market.js';
import { initScreener } from './ui/screener.js';
import { initPortfolio } from './ui/portfolio.js';
import { initLearn } from './ui/learn.js';
import { initSettings, applyTheme, VERSION } from './ui/settings.js';
import { openSearch } from './ui/search.js';
import { alertsCenter } from './ui/alertsui.js';
import { manageLists } from './ui/lists.js';
import { onAlerts, triggeredCount, checkAll, describe } from './data/alerts.js';
import { useList } from './app.js';
import { toast } from './ui/dom.js';

const INIT = { chart: initStock, market: initMarket, screener: initScreener, portfolio: initPortfolio, learn: initLearn, settings: initSettings };
const TITLES = { chart: 'Chart', market: 'Market', screener: 'Screener', portfolio: 'Portfolio', learn: 'Learn', settings: 'Settings' };
const started = new Set();

async function show(view) {
  for (const id of Object.keys(INIT)) $('#view-' + id).hidden = id !== view;
  if (!started.has(view)) { started.add(view); await INIT[view]($('#view-' + view)); }
  $('#pageTitle').textContent = TITLES[view];
  $$('[data-view]').forEach(b => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  $('#settingsBtn').setAttribute('aria-current', view === 'settings' ? 'page' : 'false');
  try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// */ }
  window.scrollTo({ top: 0 });
}

function nav() {
  const items = VIEWS.map(v => html`<button data-view="${v.id}" aria-label="${v.label}">${raw(ICON[v.icon])}<span>${v.label}</span></button>`);
  render($('#tabBar'), html`${items}`);
  render($('#sideNav'), html`${items}<button data-view="settings">${raw(ICON.settings)}<span>Settings</span></button>`);
  $$('[data-view]').forEach(b => { b.onclick = () => go(b.dataset.view); });
  $('#searchBtn').innerHTML = ICON.search; $('#searchBtn').onclick = openSearch;
  $('#alertBtn').innerHTML = ICON.bell + '<span class="badge" id="alertBadge" hidden></span>'; $('#alertBtn').onclick = async () => { await alertsCenter(); badge(); };
  $('#sideEdit').onclick = manageLists;
  $('#sideList').onchange = () => useList($('#sideList').value);
  $('#settingsBtn').innerHTML = ICON.settings; $('#settingsBtn').onclick = () => go('settings');
  render($('#sideFoot'), html`Version ${VERSION} · Not investment advice`);
}

async function badge() {
  const n = await triggeredCount(), b = $('#alertBadge');
  b.hidden = !n; b.textContent = n;
}

function sideWatch() {
  render($('#sideList'), html`${App.lists.map(l => html`<option value="${l.id}" ${l.id === App.listId ? raw('selected') : ''}>${l.name}</option>`)}`);
  const el = $('#sideWatch');
  render(el, html`${App.watch.length ? App.watch.map(s => { const q = App.last[s]; return html`<button data-s="${s}" class="${s === App.sym && App.view === 'chart' ? 'on' : ''}"><span class="s">${s.replace('.DEMO', '')}</span><span class="n">${App.names[s] || ''}</span><span class="c num ${q ? (q.ch >= 0 ? 'up' : 'down') : ''}">${q ? pc(q.ch, 1) : ''}</span></button>`; }) : html`<p class="muted tiny" style="padding:0 10px">Star a stock on the Chart tab to add it here.</p>`}`);
  $$('button', el).forEach(b => { b.onclick = () => openStock(b.dataset.s); });
}

function banner() {
  const el = $('#banner');
  if (!isDemo()) {
    // web preview: say where live updates and news come from
    if (provider().id === 'free' && !Capacitor.isNativePlatform()) {
      el.hidden = false;
      render(el, html`<span><b>Preview.</b> Real built-in data for about 380 stocks and the main indexes. Live price updates, other tickers and news load in the iPhone, iPad and Mac app.</span>`);
    } else el.hidden = true;
    return;
  }
  el.hidden = false;
  render(el, html`<span><b>Demo mode.</b> Fictional companies, built to show every pattern. Add a data provider for real stocks.</span><button class="btn sm" id="bnSet">Set up data</button>`);
  $('#bnSet').onclick = () => go('settings');
}

function welcome() {
  const sh = sheet('Welcome to Base Pattern Desk', html`
    <div class="card prose">
      <p>Find classic base patterns (cups, handles, double bottoms, flat bases and more) automatically, with their buy points, volume checks and sell rules.</p>
      <ul>
        <li><b>Chart:</b> every detected pattern drawn in its own colour, with the full breakout history.</li>
        <li><b>Market:</b> distribution days, follow-through days and the market status.</li>
        <li><b>Screener:</b> scan about 380 stocks or your own lists for breakouts, buy points and volume surges, with a setup score and sector ranking.</li>
        <li><b>Portfolio:</b> import your broker statement for sell signals, risk and a stress test.</li>
        <li><b>Alerts and lists:</b> set breakout, stop and price alerts, and keep several watchlists in your own order.</li>
      </ul>
      <p class="small"><b>Not investment advice.</b> This is an educational tool that applies published rules of thumb to end-of-day prices. Signals can be wrong.</p>
    </div>
    <div class="toolbar"><button class="btn primary" id="wDemo">Get started</button><button class="btn" id="wReal">Data settings</button></div>`,
  { onClose: () => store.set('onboarded', VERSION) });
  $('#wDemo').onclick = () => sh.close();
  $('#wReal').onclick = () => { sh.close(); go('settings'); };
}

async function boot() {
  applyTheme(await store.get('theme', 'system'));
  await loadSettings();
  await loadState();
  nav();
  on(type => {
    if (type === 'view') show(App.view);
    if (type === 'watch' || type === 'quote' || type === 'stock' || type === 'view') sideWatch();
    if (type === 'provider') banner();
  });
  banner(); sideWatch();
  const start = (location.hash || '').slice(1);
  App.view = INIT[start] ? start : 'chart';
  await show(App.view);
  if (App.view !== 'market') { started.add('market'); initMarket($('#view-market')); } // loads the market status for the checklist
  window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && $('#sheet').hidden) { e.preventDefault(); openSearch(); }
  });
  if (!(await store.get('onboarded', null))) welcome();
  // check alerts once at start (prices for alert stocks load in the background)
  onAlerts(badge); badge();
  setTimeout(async () => {
    const hits = await checkAll();
    if (hits.length) toast(hits.length === 1 ? describe(hits[0]) : `${hits.length} alerts triggered. Tap the bell to see them.`, 6000);
    badge();
  }, 4000);
}

boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<p style="padding:20px">Something went wrong while starting: ${String(e.message || e)}</p>`); });
