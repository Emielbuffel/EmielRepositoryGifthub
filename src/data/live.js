// Keeps prices fresh without a Refresh button (desktop app, and the web version with its data relay):
// every minute it updates the stocks in your watchlists and holdings — every ~90 seconds while their market is open,
// every 30 minutes otherwise — updates the sidebar quotes, checks your alerts and buying plans, and looks for
// buy-zone and add-on points on the stocks you own (notifications once per situation).
import PAT from '../core/pat.js';
import { patternPhase } from '../core/analysis.js';
import { volStats } from '../core/volume.js';
import { holdingSignals } from '../core/addons.js';
import { daily, provider, settings } from './service.js';
import { checkBars, pushEvent } from './alerts.js';
import { isApp } from './net.js';
import * as store from './store.js';
import { App, rememberQuotes, emit } from '../app.js';

const OPEN_AGE = 90e3, CLOSED_AGE = 30 * 60e3;
const L = { timer: null, running: false, seen: null, sessions: {} };

const marketOpen = sym => { const s = L.sessions[sym], now = Date.now() / 1000; return !!(s && now >= s.start - 300 && now <= s.end + 600); };

/** Symbols to keep fresh: holdings first, then every watchlist (capped). */
function targets() {
  const hold = (App.holdings || []).map(h => h.sym);
  const lists = (App.lists || []).flatMap(l => l.syms);
  return [...new Set([...hold, ...App.watch, ...lists])].filter(s => s && !/\.DEMO$|^DEMO-/.test(s)).slice(0, 120);
}

async function seen() { if (!L.seen) L.seen = await store.get('signalsSeen', {}); return L.seen; }

/** One pass over all targets; quick when nothing is due (saved prices are reused). */
export async function tick({ force = false } = {}) {
  if (L.running || provider().id === 'demo') return;
  if (provider().id === 'free' && !isApp()) return; // web preview without a relay: built-in data only
  L.running = true;
  const quotes = [], S = await seen(), today = new Date().toISOString().slice(0, 10);
  try {
    for (const sym of targets()) {
      const maxAge = force ? 0 : marketOpen(sym) ? OPEN_AGE : CLOSED_AGE;
      let d; try { d = await daily(sym, { maxAge }); } catch (e) { continue; }
      if (d.quote && d.quote.session) L.sessions[sym] = d.quote.session;
      if (d.cached && !force && App.last[sym] && App.last[sym].at && App.last[sym].at >= d.fetchedAt) continue; // nothing new
      const b = d.bars, n = b.length - 1; if (n < 60) continue;
      const R = PAT.scan(b), ph = patternPhase(R, b), v = volStats(b, { quote: d.quote });
      quotes.push({ s: sym, c: b[n].close, ch: b[n].close / b[n - 1].close - 1, ph: ph && ph.label, pt: ph && ph.tone, vp: v ? v.pct : null, at: d.fetchedAt });
      try { await checkBars(sym, b, d.name); } catch (e) { /* alert check failed */ }
      // the stocks you own: buy zone and add-on points; watchlist stocks: fresh breakouts into a buy zone
      const h = (App.holdings || []).find(x => x.sym === sym);
      let sig = holdingSignals(b, R, { cost: h ? h.cost || null : null });
      if (!h) sig = settings.notifyWatch === false ? [] : sig.filter(x => x.code.startsWith('buyzone'));
      for (const x of sig) {
        const key = sym + '|' + x.code;
        if (S[key]) continue;
        S[key] = today;
        if (x.level === 'info' && !h) continue;
        await pushEvent({ sym, name: d.name || App.names[sym] || '', kind: 'signal', title: `${sym}: ${x.title}`, body: x.text, level: x.level === 'info' ? 'hold' : 'add', close: b[n].close });
      }
    }
  } finally {
    L.running = false;
    // forget signals older than 60 days so a new situation later can notify again
    const cut = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    Object.keys(S).forEach(k => { if (S[k] < cut) delete S[k]; });
    await store.set('signalsSeen', S);
    if (quotes.length) { await rememberQuotes(quotes); emit('live', quotes.map(q => q.s)); }
  }
}

/** Starts the minute timer (call once at start). */
export function startLive() {
  if (L.timer) return;
  const run = () => { if (document.visibilityState === 'visible' || isBackgroundOk()) tick().catch(() => {}); };
  setTimeout(run, 8000);
  L.timer = setInterval(run, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
}
// the desktop app keeps checking while minimised (notifications); a browser tab only while visible
const isBackgroundOk = () => typeof window !== 'undefined' && !!window.desktop;
