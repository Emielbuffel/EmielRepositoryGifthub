// Live US prices for the page on claude.ai (e.g. on the iPhone Home Screen): there the app cannot reach Yahoo, but it
// can ask the viewer's own FMP connector (Financial Modeling Prep) for daily bars and today's quote. Outside claude.ai
// (the Mac app, the iPhone app, the website) this is never used. On the FMP Basic plan only US listings answer;
// everything else keeps the built-in data.
import { DataError } from './providers.js';

let mcpP = null, broken = null;
/** The viewer's connectors on claude.ai, or null (not on claude.ai, or not allowed). */
export function mcpFeed() {
  if (!mcpP) mcpP = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? window.claude.use('mcp').catch(() => null) : Promise.resolve(null);
  return mcpP;
}
/** Why FMP is not answering (for the status line), or null. */
export const mcpProblem = () => broken;

const rows = p => Array.isArray(p) ? p : p && (Array.isArray(p.data) ? p.data : Array.isArray(p.result) ? p.result : Array.isArray(p.historical) ? p.historical : null);
const ymd = t => new Date(t * 1000).toISOString().slice(0, 10);
const NO_FMP = new Set(['needs_reauth', 'server_not_connected', 'selection_required', 'not_in_manifest', 'blocked_by_policy', 'not_granted', 'capability_disabled', 'capability_removed']);

async function call(tool, input, staleMs) {
  const m = await mcpFeed(); if (!m) return null;
  try { const r = await m.callTool('FMP', tool, input, { cache: { staleTime: staleMs, gcTime: Math.max(staleMs, 6 * 3600e3) } }); broken = null; return r.payload; }
  catch (e) {
    if (e && NO_FMP.has(e.code)) broken = e.code === 'needs_reauth' ? 'Reconnect FMP in claude.ai Settings → Connectors.' : e.code === 'server_not_connected' ? 'Add the FMP connector in claude.ai Settings → Connectors for live US prices.' : 'FMP is not allowed for this page.';
    else if (e && e.code === 'tool_error' && /plan|upgrade/i.test(e.message || '')) return null; // not on this FMP plan (e.g. a non-US listing)
    throw new DataError('FMP: ' + ((e && e.message) || 'no answer'), 'network');
  }
}

/**
 * Daily bars from `fromT` (epoch s; null = about 4 years) plus today's quote, for a US listing or index.
 * Returns {bars, quote, name, currency, exchange} or null when FMP is not available here.
 */
export async function fmpDaily(sym, fromT = null) {
  if (/\.[A-Z]+$/.test(sym)) return null; // non-US listing: not on the FMP Basic plan
  const from = fromT || Math.floor(Date.now() / 1000) - Math.round(4.3 * 365.25 * 86400);
  const hist = await call('chart', { endpoint: 'historical-price-eod-full', symbol: sym, from_date: ymd(from), to_date: ymd(Date.now() / 1000 + 86400) }, 10 * 60e3);
  const r = rows(hist); if (!r) return null;
  const bars = r.filter(x => x && x.date && x.close > 0).map(x => ({ time: Date.parse(x.date.slice(0, 10) + 'T00:00:00Z') / 1000, open: x.open || x.close, high: Math.max(x.high || 0, x.close), low: Math.min(x.low || x.close, x.close), close: x.close, volume: x.volume || 0 })).sort((a, b) => a.time - b.time);
  let quote = null, name = '', exchange = '';
  try {
    const q = rows(await call('quote', { endpoint: 'quote', symbol: sym }, 60e3)); const z = q && q[0];
    if (z && z.price > 0) { quote = { price: z.price, time: z.timestamp, off: -5 * 3600, high: z.dayHigh, low: z.dayLow, volume: z.volume, open: z.open, chgPct: z.changePercentage != null ? z.changePercentage / 100 : null }; name = z.name || ''; exchange = z.exchange || ''; }
  } catch (e) { /* history without today's quote */ }
  return { bars, quote, name, currency: 'USD', exchange };
}
