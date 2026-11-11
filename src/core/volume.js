// Volume figures for a stock, as O'Neil reads them: today against the 50-day average, the week so far against an
// average week, the up/down volume ratio (buying vs selling), and a rough estimate of the full day while trading.

const DAY = 86400;
const dayOf = t => Math.floor(t / DAY);
/** Week number with weeks starting on Monday (1 Jan 1970 was a Thursday). */
export const weekOf = t => Math.floor((dayOf(t) + 3) / 7);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

/**
 * Share of a normal day's volume traded after a fraction x (0–1) of the session. Volume is heavier at the open and
 * at the close (a U shape), so a straight line would overstate the morning; this curve is a rough market-wide average.
 */
export const sessionShare = x => x <= 0 ? 0 : x >= 1 ? 1 : 0.7 * Math.pow(x, 0.75) + 0.3 * Math.pow(x, 4);

/**
 * bars: daily bars, oldest first. quote (optional): {time, off, session: {start, end}} from the live feed.
 * now: seconds (for tests). Returns null when the feed has no volume for this symbol.
 */
export function volStats(bars, { quote = null, now = Date.now() / 1000 } = {}) {
  if (!bars || bars.length < 12) return null;
  const n = bars.length - 1, t = bars[n], prev = bars[n - 1];
  const past = bars.slice(Math.max(0, n - 50), n).map(b => b.volume).filter(v => v > 0);
  if (past.length < 10) return null;
  const avg50 = mean(past), vol = t.volume || 0;

  // trading now? then today's volume is partial: estimate the full day
  let open = false, pace = null, elapsed = null;
  const s = quote && quote.session;
  if (s && now >= s.start && now < s.end && dayOf(s.start + (quote.off || 0)) === dayOf(t.time)) {
    open = true; elapsed = (now - s.start) / (s.end - s.start);
    if (elapsed >= 0.04 && vol > 0) pace = vol / sessionShare(elapsed);
  }

  // this week so far, last week, and the average of the 10 full weeks before this one
  const wk = weekOf(t.time), weeks = new Map();
  for (let i = Math.max(0, n - 80); i <= n; i++) { const w = weekOf(bars[i].time); if (!weeks.has(w)) weeks.set(w, { vol: 0, days: 0 }); const x = weeks.get(w); x.vol += bars[i].volume || 0; x.days++; }
  const firstOfWeek = bars.findIndex(b => weekOf(b.time) === wk), weekUp = firstOfWeek > 0 ? t.close >= bars[firstOfWeek - 1].close : t.close >= prev.close;
  const cur = weeks.get(wk), before = [...weeks.entries()].filter(([w]) => w < wk).sort((a, b) => a[0] - b[0]).map(e => e[1]).slice(-10);
  const avgWeek = before.length >= 4 ? mean(before.map(x => x.vol)) : null, lastWeek = before.length ? before[before.length - 1].vol : null;

  // up/down volume ratio over 50 days: volume on up days ÷ volume on down days (above 1 = more buying)
  let up = 0, dn = 0;
  for (let i = Math.max(1, n - 49); i <= n; i++) { const d = bars[i].close - bars[i - 1].close; if (d > 0) up += bars[i].volume || 0; else if (d < 0) dn += bars[i].volume || 0; }

  // the most volume since when?
  let k = n - 1; while (k >= 0 && (bars[k].volume || 0) < vol) k--;
  const since = vol > 0 && n - k > 10 ? { days: n - k - 1, from: k >= 0 ? bars[k].time : null } : null;

  let dv = 0, dn50 = 0; for (let i = Math.max(0, n - 49); i <= n; i++) { dv += bars[i].close * (bars[i].volume || 0); dn50++; }

  return {
    vol, avg50, pct: vol / avg50 - 1, up: t.close >= prev.close,
    open, elapsed, pace, pacePct: pace ? pace / avg50 - 1 : null,
    week: cur ? { vol: cur.vol, days: cur.days, up: weekUp, perDayPct: cur.vol / cur.days / avg50 - 1, vsAvgWeek: avgWeek ? cur.vol / avgWeek - 1 : null } : null,
    avgWeek, lastWeek, lastWeekPct: avgWeek && lastWeek != null ? lastWeek / avgWeek - 1 : null,
    udRatio: dn > 0 ? up / dn : null, since, avgValue: dv / dn50,
    breakoutNeed: avg50 * 1.4,
  };
}
