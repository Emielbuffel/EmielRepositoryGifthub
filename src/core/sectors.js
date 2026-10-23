// Sector leadership: ranks sectors by the strength and health of their stocks in a scan.

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** rows: screener rows with g (sector), rs, s50, hi, p. Sectors with fewer than minCount stocks are left out. */
export function rankSectors(rows, minCount = 3) {
  const by = new Map();
  rows.forEach(r => { if (!r.g) return; if (!by.has(r.g)) by.set(r.g, []); by.get(r.g).push(r); });
  const out = [];
  for (const [g, xs] of by) {
    if (xs.length < minCount) continue;
    const rs = median(xs.filter(r => r.rs != null).map(r => r.rs));
    const above50 = xs.filter(r => r.s50 != null && r.s50 > 0).length / xs.length;
    const nearHigh = xs.filter(r => r.hi != null && r.hi >= -0.15).length / xs.length;
    const setups = xs.filter(r => r.p && (r.p.st === 'near' || r.p.st === 'buyzone') && !r.p.f).length;
    const m3 = median(xs.filter(r => r.m3 != null).map(r => r.m3));
    const score = (rs || 0) * 0.5 + above50 * 30 + nearHigh * 20;
    const leaders = [...xs].filter(r => r.rs != null).sort((a, b) => b.rs - a.rs).slice(0, 3).map(r => r.s);
    out.push({ g, n: xs.length, rs, above50, nearHigh, setups, m3, score, leaders });
  }
  out.sort((a, b) => b.score - a.score);
  out.forEach((x, i) => { x.rank = i + 1; });
  return out;
}
