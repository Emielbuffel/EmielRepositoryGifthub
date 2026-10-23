// Shared app state and navigation.
import * as store from './data/store.js';
import { settings, isDemo } from './data/service.js';

export const VIEWS = [
  { id: 'chart', label: 'Chart', icon: 'chart' },
  { id: 'market', label: 'Market', icon: 'market' },
  { id: 'screener', label: 'Screener', icon: 'screener' },
  { id: 'portfolio', label: 'Portfolio', icon: 'portfolio' },
  { id: 'learn', label: 'Learn', icon: 'learn' },
];

const DEMO_WATCH = ['ACME.DEMO', 'IRIS.DEMO', 'LUMA.DEMO', 'CRUX.DEMO', 'FLUX.DEMO', 'DUNE.DEMO'];
const REAL_WATCH = ['NVDA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'TSM', 'ASML.AS', 'RHM.DE', 'SAP.DE', '7203.T', '005930.KS'];

export const App = {
  view: 'chart',
  sym: null,
  names: {},
  watch: [],        // watchlist for the current provider
  mkt: null,        // combined market status {us, usLabel}
  mktRes: null,     // per-index analyses
  last: {},         // last close/change per symbol (for the watchlist)
  listeners: new Set(),
};

export const watchKey = () => isDemo() ? 'watch.demo' : 'watch.real';

export async function loadState() {
  App.names = await store.get('names', {});
  App.watch = await store.get(watchKey(), isDemo() ? DEMO_WATCH : REAL_WATCH);
  App.sym = await store.get(isDemo() ? 'lastSym.demo' : 'lastSym.real', App.watch[0] || (isDemo() ? 'ACME.DEMO' : 'NVDA'));
  App.last = await store.get('lastQuotes', {});
}

export async function saveWatch(list) {
  App.watch = list; await store.set(watchKey(), list); emit('watch');
}
export async function rememberName(sym, name) {
  if (!name || App.names[sym] === name) return;
  App.names[sym] = name; await store.set('names', App.names);
}
export async function rememberQuote(sym, close, chg) {
  App.last[sym] = { c: close, ch: chg }; await store.set('lastQuotes', App.last); emit('quote');
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
