// Exchange rates for showing values in one currency. Live rates from the free feed in the app;
// otherwise fixed reference rates (dated) so the preview and offline mode can still convert the main currencies.
import { isApp } from './net.js';
import { PROVIDERS } from './providers.js';
import { settings, provider } from './service.js';
import * as store from './store.js';

// Units of each currency per 1 EUR. USD and JPY from a broker statement of 26 Sep 2026; HKD follows its USD peg
// (7.75–7.85, midpoint used) and DKK its EUR peg (7.46). Other currencies need a live rate.
export const REF = { date: '26 Sep 2026', perEUR: { EUR: 1, USD: 1.1391, JPY: 179.15, HKD: 1.1391 * 7.8, DKK: 7.46 } };

const live = {}; // 'USD' -> units per EUR
async function liveRate(cur) {
  if (live[cur] && Date.now() - live[cur].at < 12 * 3600e3) return live[cur].v;
  const c = await store.get('fx.' + cur, null);
  if (c && Date.now() - c.at < 12 * 3600e3) { live[cur] = c; return c.v; }
  if (!isApp() && provider().id === 'free') return null; // browsers block the free feed
  try {
    const P = provider().fx ? provider() : PROVIDERS.free;
    const r = await P.fx('EUR/' + cur, settings.keys[P.id]);
    const v = r.bars[r.bars.length - 1].close;
    if (v > 0) { live[cur] = { v, at: Date.now() }; await store.set('fx.' + cur, live[cur]); return v; }
  } catch (e) { /* fall back to reference */ }
  return null;
}

/** Units of `cur` per 1 EUR, with its source. GBp is handled as pence. Returns null when unknown. */
export async function perEUR(cur) {
  if (!cur) return null;
  const c = cur === 'GBp' || cur === 'GBX' ? 'GBP' : cur, f = c !== cur ? 100 : 1;
  if (c === 'EUR') return { v: f, live: true };
  const l = await liveRate(c);
  if (l) return { v: l * f, live: true };
  if (REF.perEUR[c]) return { v: REF.perEUR[c] * f, live: false, date: REF.date };
  return null;
}

/** Factor to convert an amount in `from` to `to`, or null. */
export async function factor(from, to) {
  if (!from || from === to) return { v: 1, live: true };
  const [a, b] = await Promise.all([perEUR(from), perEUR(to)]);
  if (!a || !b) return null;
  return { v: b.v / a.v, live: a.live && b.live, date: a.date || b.date };
}
