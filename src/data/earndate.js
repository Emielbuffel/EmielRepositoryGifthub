// The next earnings report date of a stock, cached for a day: the desktop app asks Yahoo's calendar, an FMP key
// asks FMP, otherwise the earnings data the app already has (built-in or loaded) is used. Returns epoch seconds,
// null when none is scheduled or known.
import * as store from './store.js';
import { yahooCalendar } from './providers.js';
import { isDesktop } from './net.js';
import { earnings, settings } from './service.js';
import { nextReport } from '../core/earnings.js';

let cache = null;
const DAY = 86400e3;

export async function nextEarnings(sym) {
  if (!cache) cache = await store.get('earnNext', {});
  const c = cache[sym]; if (c && Date.now() - c.at < DAY) return c.t;
  let t = null, found = false;
  if (isDesktop()) { try { const r = await yahooCalendar(sym); found = true; t = r.next ? r.next.time : null; } catch (e) { /* try the next source */ } }
  if (!found && (settings.keys.fmp || '').trim() && !/\./.test(sym)) {
    try {
      const u = `https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(sym)}&limit=4&apikey=${encodeURIComponent(settings.keys.fmp.trim())}`;
      const r = await fetch(u).then(x => x.json()), now = Date.now() / 1000;
      const up = (Array.isArray(r) ? r : []).map(x => Date.parse(x.date) / 1000).filter(x => x >= now - DAY / 1000).sort((a, b) => a - b);
      found = true; t = up[0] ?? null;
    } catch (e) { /* no FMP */ }
  }
  if (!found) { try { const e = await earnings(sym); const n = e && nextReport(e); t = n ? n.time : null; found = true; } catch (e) { /* no data */ } }
  if (t != null && t < Date.now() / 1000 - 86400) t = null; // the last report, the next one is not announced yet
  cache[sym] = { t, at: Date.now() }; store.set('earnNext', cache);
  return t;
}
