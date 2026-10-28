// The app's own 1–99 scores for the data panel. They are NOT IBD's ratings: the EPS score uses an absolute scale
// (no ranking against all stocks), the composite blends the app's measures.
import { enrich } from './earnings.js';

const clamp = x => Math.max(1, Math.min(99, Math.round(x)));
const sq = x => 50 + 49 * Math.tanh(x);

/** EPS score: recent quarterly growth (latest weighted most), 3-year trend of 12-month EPS, bonus for acceleration. */
export function epsScore(rows) {
  const q = enrich(rows || []); const n = q.length - 1;
  if (n < 4 || q[n].yoy == null) return null;
  const g1 = q[n].yoy, g2 = q[n - 1].yoy ?? g1;
  let g3y = null; if (n >= 15 && q[n].ttm > 0 && q[n - 12].ttm > 0) g3y = Math.pow(q[n].ttm / q[n - 12].ttm, 1 / 3) - 1;
  const recent = 0.6 * Math.min(g1, 3) + 0.4 * Math.min(g2, 3), mix = g3y == null ? recent : 0.65 * recent + 0.35 * Math.min(g3y, 2);
  const acc = n >= 6 && q[n - 2].yoy != null && g1 > g2 && g2 > q[n - 2].yoy ? 5 : 0;
  return clamp(sq((mix - 0.12) / 0.3) + acc);
}
const AD = { A: 92, B: 75, C: 50, D: 30, E: 12 };
/** Composite: strength (RS), EPS score, closeness to the 52-week high and accumulation. */
export function composite({ rs, eps, offHigh, ad }) {
  const parts = [[rs, 0.35], [eps, 0.35], [offHigh != null ? clamp(99 + offHigh * 200) : null, 0.15], [ad ? AD[ad] : null, 0.15]].filter(p => p[0] != null);
  const w = parts.reduce((s, p) => s + p[1], 0);
  return w >= 0.5 ? clamp(parts.reduce((s, p) => s + p[0] * p[1], 0) / w) : null;
}
