// Shared app state and navigation.
import * as store from './data/store.js';
import { settings, isDemo } from './data/service.js';

export const VIEWS = [
  { id: 'chart', label: 'Chart', icon: 'chart' },
  { id: 'market', label: 'Market', icon: 'market' },
  { id: 'screener', label: 'Screener', icon: 'screener' },
  { id: 'fund', label: 'Fundamentals', icon: 'fund' },
  { id: 'portfolio', label: 'Portfolio', icon: 'portfolio' },
  { id: 'news', label: 'News', icon: 'news' },
  { id: 'prune', label: 'Sell ideas', icon: 'prune' },
  { id: 'taxes', label: 'Dividends & taxes', icon: 'taxes' },
  { id: 'review', label: 'Trade review', icon: 'review' },
  { id: 'balance', label: 'Balance', icon: 'balance' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'learn', label: 'Learn', icon: 'learn' },
];

const DEMO_WATCH = ['ACME.DEMO', 'IRIS.DEMO', 'LUMA.DEMO', 'CRUX.DEMO', 'FLUX.DEMO', 'DUNE.DEMO'];
const REAL_WATCH = ['NVDA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'TSM', 'ASML.AS', 'RHM.DE', 'SAP.DE', '7203.T', '005930.KS'];

export const App = {
  view: 'chart',
  sym: null,
  names: {},
  watch: [],        // symbols of the active list
  lists: [],        // [{id, name, syms}]
  listId: null,
  mkt: null,        // combined market status {us, usLabel}
  mktRes: null,     // per-index analyses
  last: {},         // last close/change per symbol (for the watchlist)
  listeners: new Set(),
};

export const watchKey = () => isDemo() ? 'watch.demo' : 'watch.real';
const listsKey = () => isDemo() ? 'lists.demo' : 'lists.real';

export async function loadState() {
  App.names = await store.get('names', {});
  // several named watchlists; the old single watchlist becomes the first one
  App.lists = await store.get(listsKey(), null);
  if (!App.lists || !App.lists.length) {
    const old = await store.get(watchKey(), isDemo() ? DEMO_WATCH : REAL_WATCH);
    App.lists = [{ id: 'w1', name: 'Watchlist', syms: old }];
    if (!isDemo()) App.lists.push({ id: 'w2', name: 'Europe & Asia', syms: ['ASML.AS', 'RHM.DE', 'SAP.DE', 'SAAB-B.ST', '7203.T', '005930.KS', '0700.HK'] });
    await store.set(listsKey(), App.lists);
  }
  App.listId = await store.get(listsKey() + '.active', App.lists[0].id);
  if (!App.lists.some(l => l.id === App.listId)) App.listId = App.lists[0].id;
  App.watch = App.lists.find(l => l.id === App.listId).syms;
  App.sym = await store.get(isDemo() ? 'lastSym.demo' : 'lastSym.real', App.watch[0] || (isDemo() ? 'ACME.DEMO' : 'NVDA'));
  App.last = await store.get('lastQuotes', {});
}

/** Replaces the symbols of the active list (or of list `id`). */
export async function saveWatch(syms, id = App.listId) {
  const l = App.lists.find(x => x.id === id); if (!l) return;
  l.syms = syms; if (id === App.listId) App.watch = syms;
  await store.set(listsKey(), App.lists); emit('watch');
}
export async function saveLists(lists, activeId = App.listId) {
  App.lists = lists.length ? lists : [{ id: 'w1', name: 'Watchlist', syms: [] }];
  App.listId = App.lists.some(l => l.id === activeId) ? activeId : App.lists[0].id;
  App.watch = App.lists.find(l => l.id === App.listId).syms;
  await store.set(listsKey(), App.lists); await store.set(listsKey() + '.active', App.listId); emit('watch');
}
export const useList = id => saveLists(App.lists, id);
export async function rememberName(sym, name) {
  if (!name || App.names[sym] === name) return;
  App.names[sym] = name; await store.set('names', App.names);
}
/** Last close and change (plus the pattern phase and strength when known) for the watchlist. */
export async function rememberQuote(sym, close, chg, extra = {}) {
  App.last[sym] = { ...(App.last[sym] || {}), c: close, ch: chg, ...extra }; await store.set('lastQuotes', App.last); emit('quote');
}
/** Many at once (after a scan): [{s, c, ch, ph, pt, rs}]. */
export async function rememberQuotes(list) {
  for (const { s, ...x } of list) { Object.keys(x).forEach(k => { if (x[k] === undefined || (k === 'rs' && x[k] == null && App.last[s] && App.last[s].rs != null)) delete x[k]; }); App.last[s] = { ...(App.last[s] || {}), ...x }; }
  await store.set('lastQuotes', App.last); emit('quote');
}

/* simple event bus: 'view', 'stock', 'watch', 'provider', 'market', 'quote' */
export const on = (fn) => { App.listeners.add(fn); return () => App.listeners.delete(fn); };
export const emit = (type, data) => App.listeners.forEach(fn => { try { fn(type, data); } catch (e) { console.error(e); } });

export function go(view) { App.view = view; emit('view', view); }
export async function openStock(sym, name) {
  sym = String(sym || '').toUpperCase().trim().replace(/[^A-Z0-9.\-^=/]/g, '');
  if (!sym) return;
  if (name) await rememberName(sym, name);
  App.sym = sym; await store.set(isDemo() ? 'lastSym.demo' : 'lastSym.real', sym);
  if (App.view !== 'chart') go('chart');
  emit('stock', sym);
}

export { settings };
