// Safety checks for daily prices from several sources (built-in data, cached days, live feeds), so a chart never
// shows a jump that isn't real (for example +27% in a day when the stock rose 1%).

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * Merges newer bars into older ones. When the two overlap but their closes disagree by more than 2% on the same days
 * (a different trading venue, currency unit or adjustment), the merge is refused ({ok: false}) so the caller can
 * reload the whole history from one source.
 */
export function mergeBars(oldBars, newBars) {
  if (!oldBars || !oldBars.length) return { ok: true, bars: newBars || [] };
  if (!newBars || !newBars.length) return { ok: true, bars: oldBars };
  const m = new Map(oldBars.map(b => [b.time, b]));
  const ratios = newBars.filter(b => m.has(b.time) && m.get(b.time).close > 0).map(b => b.close / m.get(b.time).close);
  if (ratios.length >= 2 && Math.abs(med(ratios) - 1) > 0.02) return { ok: false, reason: 'overlap', ratio: med(ratios) };
  if (!ratios.length) {
    // no common day: the first new close should be near the last old close (within 15%), else the sources differ
    const last = oldBars[oldBars.length - 1], first = newBars.find(b => b.time > last.time);
    if (first && Math.abs(first.close / last.close - 1) > 0.15 && first.time - last.time < 10 * 86400) return { ok: false, reason: 'seam' };
  }
  newBars.forEach(b => m.set(b.time, b));
  return { ok: true, bars: [...m.values()].sort((a, b) => a.time - b.time) };
}

/** One-day spikes that fully revert the next day (a bad tick in the feed) are replaced by the average of the neighbours. */
export function fixSpikes(bars) {
  const b = bars.map(x => ({ ...x }));
  for (let i = 1; i < b.length - 1; i++) {
    const up = b[i].close / b[i - 1].close, back = b[i + 1].close / b[i - 1].close;
    if ((up > 1.2 || up < 1 / 1.2) && back > 0.95 && back < 1.05) {
      const c = (b[i - 1].close + b[i + 1].close) / 2;
      b[i] = { ...b[i], open: c, high: Math.max(c, b[i - 1].close, b[i + 1].close), low: Math.min(c, b[i - 1].close, b[i + 1].close), close: c, fixed: true };
    }
  }
  return b;
}

/** Sets the last bar's close to the feed's live quote when they are the same day but differ (stale or partial bar). */
export function alignQuote(bars, quote) {
  if (!bars.length || !quote || !(quote.price > 0) || !quote.time) return bars;
  const last = bars[bars.length - 1], day = t => Math.floor(t / 86400), qd = day(quote.time + (quote.off || 0)), c = quote.price;
  // a new session has started but the feed gave no bar for it yet: add one, so the day change is vs yesterday's close
  // (the feed often sends today's volume and range with an empty close: keep them)
  const ok = v => v > 0 && isFinite(v);
  if (qd > day(last.time) && qd - day(last.time) <= 5 && Math.abs(c / last.close - 1) < 0.25) {
    const o = ok(quote.open) ? quote.open : c;
    return [...bars, { time: qd * 86400, open: o, high: Math.max(o, c, ok(quote.high) ? quote.high : c), low: Math.min(o, c, ok(quote.low) ? quote.low : c), close: c, volume: ok(quote.volume) ? quote.volume : 0, liveBar: true }];
  }
  if (qd !== day(last.time)) return bars;
  const volume = ok(quote.volume) ? Math.max(last.volume || 0, quote.volume) : last.volume;
  if (Math.abs(c / last.close - 1) < 0.005) return volume === last.volume ? bars : [...bars.slice(0, -1), { ...last, volume }];
  return [...bars.slice(0, -1), { ...last, close: c, high: Math.max(last.high, c), low: Math.min(last.low, c), volume }];
}

/**
 * Daily bars rebuilt from intraday rows ({time (exchange clock), open, high, low, close, volume}) for the given days
 * (day numbers since 1970). Used when the feed's daily data leaves a recent day empty but its hourly data has it.
 */
export function barsFromIntraday(rows, days) {
  const by = new Map();
  for (const r of rows) {
    if (r.close == null || !isFinite(r.close)) continue;
    const d = Math.floor(r.time / 86400); if (!days.has(d)) continue;
    const b = by.get(d);
    if (!b) by.set(d, { time: d * 86400, open: r.open ?? r.close, high: r.high ?? r.close, low: r.low ?? r.close, close: r.close, volume: r.volume || 0, last: r.time });
    else { b.high = Math.max(b.high, r.high ?? r.close); b.low = Math.min(b.low, r.low ?? r.close); if (r.time >= b.last) { b.close = r.close; b.last = r.time; } b.volume += r.volume || 0; }
  }
  return [...by.values()].map(({ last, ...b }) => ({ ...b, rebuilt: true })).sort((a, b) => a.time - b.time);
}
