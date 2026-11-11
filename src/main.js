// App entry: navigation (tab bar on iPhone, sidebar on iPad/Mac), first-launch welcome and boot.
import { App, VIEWS, on, go, openStock, loadState } from './app.js';
import { loadSettings, isDemo, provider } from './data/service.js';
import { isApp, isDesktop, detectRelay } from './data/net.js';
import * as store from './data/store.js';
import { $, $$, html, raw, render, ICON, sheet } from './ui/dom.js';
import { pc } from './core/analysis.js';
import { initStock } from './ui/stock.js';
import { initMarket } from './ui/market.js';
import { initScreener } from './ui/screener.js';
import { initPortfolio } from './ui/portfolio.js';
import { initPrune } from './ui/prune.js';
import { initTaxes } from './ui/taxes.js';
import { initReview } from './ui/review.js';
import { initFundTab } from './ui/fundtab.js';
import { initBalance } from './ui/balance.js';
import { initPlan } from './ui/plan.js';
import { initLearn } from './ui/learn.js';
import { initSettings, applyTheme, VERSION } from './ui/settings.js';
import { openSearch } from './ui/search.js';
import { alertsCenter } from './ui/alertsui.js';
import { manageLists } from './ui/lists.js';
import { onAlerts, triggeredCount, checkAll, describe } from './data/alerts.js';
import { useList, saveLists } from './app.js';
import { startLive } from './data/live.js';
import './data/plans.js'; // registers buying-plan checks with the alerts
import { toast } from './ui/dom.js';

const INIT = { chart: initStock, market: initMarket, screener: initScreener, fund: initFundTab, portfolio: initPortfolio, prune: initPrune, taxes: initTaxes, review: initReview, balance: initBalance, plan: initPlan, learn: initLearn, settings: initSettings };
const TITLES = { chart: 'Chart', market: 'Market', screener: 'Screener', fund: 'Fundamentals', portfolio: 'Portfolio', prune: 'Sell ideas', taxes: 'Dividends & taxes', review: 'Trade review', balance: 'Balance sheet & cash flow', plan: 'Financial plan', learn: 'Learn', settings: 'Settings' };
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
  $('#coachBtn').innerHTML = ICON.coach; $('#coachBtn').onclick = () => import('./ui/coachui.js').then(m => m.openCoach());
  $('#settingsBtn').innerHTML = ICON.settings; $('#settingsBtn').onclick = () => go('settings');
  render($('#sideFoot'), html`Version ${VERSION} · Not investment advice`);
}

async function badge() {
  const n = await triggeredCount(), b = $('#alertBadge');
  b.hidden = !n; b.textContent = n;
}

const SIDE = { tab: 'list' };
function sideWatch() {
  // one tab per watchlist, a tab for the stocks you own, and a button for a new list
  const hold = [...new Set((App.holdings || []).map(h => h.sym))], onHold = SIDE.tab === 'hold' && hold.length;
  render($('#sideTabs'), html`${App.lists.map(l => html`<button class="side-tab${!onHold && l.id === App.listId ? ' on' : ''}" role="tab" data-list="${l.id}" title="${l.syms.length} stocks">${l.name}</button>`)}${hold.length ? html`<button class="side-tab${onHold ? ' on' : ''}" role="tab" data-list="__hold" title="The stocks in your portfolio">My stocks</button>` : ''}<button class="side-tab add" data-list="__new" aria-label="New watchlist">+ New</button>`);
  $$('[data-list]', $('#sideTabs')).forEach(b => { b.onclick = async () => {
    const id = b.dataset.list;
    if (id === '__hold') { SIDE.tab = 'hold'; sideWatch(); return; }
    SIDE.tab = 'list';
    if (id === '__new') { const nid = 'w' + Date.now().toString(36); await saveLists([...App.lists, { id: nid, name: 'List ' + (App.lists.length + 1), syms: [] }]); await useList(nid); manageLists(); toast('New list created: give it a name, then add stocks with the ☆ button on a chart.'); return; }
    if (id !== App.listId) useList(id); else sideWatch();
  }; });
  const syms = onHold ? hold : App.watch;
  const el = $('#sideWatch');
  render(el, html`${syms.length ? syms.map(s => { const q = App.last[s]; return html`<button data-s="${s}" class="${s === App.sym && App.view === 'chart' ? 'on' : ''}"><span class="s">${s.replace('.DEMO', '')}</span><span class="n">${App.names[s] || ''}</span><span class="c num ${q ? (q.ch >= 0 ? 'up' : 'down') : ''}">${q ? pc(q.ch, 1) : ''}</span>${q && q.ph ? html`<span class="ph t-${q.pt || 'mute'}">● ${q.ph}${q.rs ? ' · RS ' + q.rs : ''}${q.vp != null ? ' · vol ' + pc(q.vp, 0) : ''}</span>` : q && q.vp != null ? html`<span class="ph t-mute">vol ${pc(q.vp, 0)} vs avg</span>` : ''}</button>`; }) : html`<p class="muted tiny" style="padding:0 10px">${onHold ? 'No holdings yet.' : 'Empty list. Open a stock and tap ☆ “Add to list” to put it here.'}</p>`}`);
  $$('button', el).forEach(b => { b.onclick = () => openStock(b.dataset.s); });
}

function banner() {
  const el = $('#banner');
  if (!isDemo()) {
    // web preview: say where live updates and news come from
    if (provider().id === 'free' && !isApp()) {
      el.hidden = false;
      render(el, html`<span><b>Preview.</b> Real built-in data for about 380 stocks and the main indexes. Live prices, about 2,000 more stocks, long EPS history and news load in the desktop app, or here once your free website with its data relay is set up (Settings → Phone &amp; updates).</span>`);
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
        <li><b>Screener:</b> scan about 2,000 stocks worldwide, every US-listed company, or your own lists for breakouts, buy points and volume surges, with a setup score and sector ranking.</li>
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

/* automatic updates: the installable web/phone app (service worker) and the desktop app (downloads new builds) */
function updates() {
  if (isDesktop() && window.desktop.onUpdateReady) {
    window.desktop.onUpdateReady(build => {
      const t = $('#toast'); t.hidden = false; t.innerHTML = '';
      t.append('A new version is ready (build ' + build + '). ');
      const b = document.createElement('button'); b.className = 'btn sm primary'; b.textContent = 'Restart now'; b.onclick = () => window.desktop.restart(); t.append(b);
    });
    return;
  }
  // the iPhone/iPad app built with Xcode (Capacitor): say when a newer build is on your website
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    import('./data/service.js').then(async ({ settings }) => {
      if (!settings.site) return;
      try { const v = await fetch(settings.site.replace(/\/+$/, '') + '/version.json', { cache: 'no-store' }).then(r => r.json()); if (v.build > __BUILD__) toast('A newer version is available on your website. Rebuild the app from Xcode (npm run ios), or use the Home Screen version from your website, which updates itself.', 9000); } catch (e) { /* offline */ }
    });
    return;
  }
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || /claude(usercontent)?\.(ai|com)$/.test(location.hostname) || (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
  const hadController = !!navigator.serviceWorker.controller; // the first install needs no reload
  navigator.serviceWorker.register('./sw.js').then(reg => {
    setInterval(() => reg.update().catch(() => {}), 30 * 60e3);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return; reloaded = true;
    // reload into the new version, unless a dialog is open (then wait until it closes)
    const go = () => { if ($('#sheet').hidden) location.reload(); else setTimeout(go, 3000); };
    go();
  });
}

async function boot() {
  applyTheme(await store.get('theme', 'system'));
  await loadSettings();
  await detectRelay(); // web version on its own site: live data through the site's relay
  updates();
  await loadState();
  if (!App.holdings) App.holdings = await store.get(isDemo() ? 'holdings.demo' : 'holdings.real', []); // for 'My stocks' and the holdings checks
  nav();
  on(type => {
    if (type === 'view') show(App.view);
    if (type === 'watch' || type === 'quote' || type === 'stock' || type === 'view' || type === 'holdings') sideWatch();
    if (type === 'provider') banner();
  });
  banner(); sideWatch();
  const start = (location.hash || '').slice(1);
  App.view = INIT[start] ? start : 'chart';
  await show(App.view);
  if (App.view !== 'market') { started.add('market'); initMarket($('#view-market')); } // loads the market status for the checklist
  // live feeds: the screener scans by itself, and prices, alerts and holdings signals stay fresh in the background
  if (isApp() && !isDemo()) { if (App.view !== 'screener') { started.add('screener'); initScreener($('#view-screener')); } startLive(); }
  window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && $('#sheet').hidden) { e.preventDefault(); openSearch(); }
  });
  if (!(await store.get('onboarded', null))) welcome();
  // check alerts once at start (prices for alert stocks load in the background)
  onAlerts(badge); badge();
  const check = async () => {
    const hits = await checkAll();
    if (hits.length) toast(hits.length === 1 ? describe(hits[0]) : `${hits.length} alerts triggered. Tap the bell to see them.`, 6000);
    badge();
  };
  setTimeout(check, 4000);
  if (isDesktop()) setInterval(check, 30 * 60e3); // the desktop app stays open: re-check alerts every 30 minutes
}

boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<p style="padding:20px">Something went wrong while starting: ${String(e.message || e)}</p>`); });
