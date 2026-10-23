// Setup score (0–100): one number that combines the base, strength, trend, demand, earnings and the market.
// Parts that can't be judged (no earnings data, no market reading) are left out and the rest is rescaled.

/**
 * row: a screener row (screenRow) — uses p, rs, s50, s200, ud.
 * epsYoy: latest quarter EPS growth (or null). mkt: {us:'up'|'press'|'corr'} or null.
 * Returns {score, parts:[[label, points, max, note]]}.
 */
export function setupScore(row, epsYoy = null, mkt = null) {
  const parts = [];
  const p = row.p;
  // 1. the base: a fresh, volume-confirmed breakout or a sound base near its buy point scores highest
  let base = 0, bNote = 'no base';
  if (p) {
    if (p.st === 'buyzone') { base = p.bo <= 5 && p.vr >= 1.5 ? 30 : 24; bNote = p.bo <= 5 ? 'fresh breakout' : 'in buy zone'; }
    else if (p.st === 'near') { base = p.f ? 14 : 24; bNote = 'near buy point'; }
    else if (p.st === 'forming') { base = p.f ? 6 : 12; bNote = 'base forming'; }
    else if (p.st === 'extended') { base = 10; bNote = 'extended'; }
    else { base = 0; bNote = p.st === 'faulty' ? 'faulty base' : p.st === 'stop' ? 'stop hit' : 'below buy point'; }
    if (p.f && base > 0) bNote += ' (faulty)';
  }
  parts.push(['Base', base, 30, bNote]);
  // 2. strength rank
  if (row.rs != null) parts.push(['Strength', Math.round(row.rs / 99 * 25), 25, 'rank ' + row.rs]);
  // 3. trend: above the 50- and 200-day lines
  const tr = (row.s50 != null && row.s50 > 0 ? 8 : 0) + (row.s200 != null && row.s200 > 0 ? 7 : 0);
  parts.push(['Trend', tr, 15, tr === 15 ? 'above 50 & 200-day' : tr ? 'partly above' : 'below both lines']);
  // 4. demand: up/down volume
  if (row.ud != null) parts.push(['Demand', row.ud >= 1.3 ? 10 : row.ud >= 1.1 ? 7 : row.ud >= 1 ? 4 : 0, 10, 'up/down vol ' + row.ud.toFixed(2)]);
  // 5. earnings
  if (epsYoy != null && isFinite(epsYoy)) parts.push(['Earnings', epsYoy >= 0.25 ? 10 : epsYoy >= 0.2 ? 8 : epsYoy >= 0.1 ? 5 : epsYoy >= 0 ? 3 : 0, 10, 'EPS ' + (epsYoy >= 0 ? '+' : '') + Math.round(epsYoy * 100) + '% y/y']);
  // 6. market
  if (mkt) parts.push(['Market', mkt.us === 'up' ? 10 : mkt.us === 'press' ? 5 : 0, 10, mkt.us === 'up' ? 'uptrend' : mkt.us === 'press' ? 'under pressure' : 'correction']);
  const got = parts.reduce((s, x) => s + x[1], 0), max = parts.reduce((s, x) => s + x[2], 0);
  return { score: max ? Math.round(got / max * 100) : 0, parts };
}
