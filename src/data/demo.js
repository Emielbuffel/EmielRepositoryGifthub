// Demo mode: fictional companies with synthetic prices, built so that every base pattern the
// detector knows appears at least once. Clearly labelled as demo data in the app. Deterministic.

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Trading days (Mon–Fri) ending on the most recent weekday, as UTC-midnight epoch seconds. */
export function tradingDays(count, end = new Date()) {
  let t = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) / 1000;
  const out = [];
  while (out.length < count) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(t); t -= 86400; }
  return out.reverse();
}

/**
 * Builds bars from segments. Each segment: [days, endPrice, shape, volumeFactor]
 * shape: 'lin' straight, 'ease' S-curve, 'in' slow start, 'out' fast start.
 * volumeFactor scales volume during the segment (1 = normal). A segment with days=1 is a single bar (breakouts).
 */
function build(seed, start, segs, opts = {}) {
  const r = rng(seed), noise = opts.noise ?? 0.009, baseVol = opts.vol ?? 2e6;
  const closes = [], vf = [];
  let p = start;
  for (const [days, end, shape = 'ease', v = 1] of segs) {
    const p0 = p;
    for (let i = 1; i <= days; i++) {
      const x = i / days;
      const y = shape === 'lin' ? x : shape === 'in' ? x * x : shape === 'out' ? 1 - (1 - x) * (1 - x) : (1 - Math.cos(Math.PI * x)) / 2;
      closes.push(p0 + (end - p0) * y); vf.push(v);
    }
    p = end;
  }
  const days = tradingDays(closes.length, opts.end);
  const bars = []; let prev = closes[0], drift = 0;
  for (let i = 0; i < closes.length; i++) {
    drift = drift * 0.8 + (r() - 0.5) * noise * 0.9; // a slowly wandering offset so candles don't look machine-made
    const wobble = 1 + drift + (r() - 0.5) * 2 * noise;
    const c = +(closes[i] * wobble).toFixed(2);
    const o = +(prev * (1 + (r() - 0.5) * noise * 1.4)).toFixed(2);
    const hi = +(Math.max(o, c) * (1 + r() * r() * noise * 2.6)).toFixed(2);
    const lo = +(Math.min(o, c) * (1 - r() * r() * noise * 2.6)).toFixed(2);
    const upDay = c >= prev;
    const vol = Math.round(baseVol * vf[i] * (0.75 + r() * 0.5) * (upDay ? 1.08 : 0.92));
    bars.push({ time: days[i], open: o, high: hi, low: lo, close: c, volume: vol });
    prev = c;
  }
  return bars;
}

// A shared run-up so every stock has years of history and a prior advance before its pattern.
const lead = (p0, p1, d = 260) => [[d * 0.45 | 0, p0 * 1.15, 'ease'], [d * 0.2 | 0, p0 * 1.02, 'ease', 0.9], [d * 0.35 | 0, p1, 'in', 1.1]];

export const DEMO = [
  { sym: 'ACME.DEMO', name: 'Acme Robotics (demo)', expect: 'cwh', story: 'Cup with handle, a few % under its buy point.',
    bars: () => build(11, 40, [...lead(40, 70), [150, 104, 'lin'], [30, 78, 'ease', 1.1], [18, 77, 'lin', 0.7], [32, 101, 'ease', 1.0], [9, 94, 'ease', 0.55], [4, 99, 'lin', 0.6]]) },
  { sym: 'BOLT.DEMO', name: 'Boltline Energy (demo)', expect: 'cup', story: 'Cup without handle: the right side is back near the old high.',
    bars: () => build(24, 25, [...lead(25, 42), [140, 60, 'lin'], [35, 44, 'ease', 1.1], [20, 43, 'lin', 0.75], [42, 57, 'in', 1.05]], { noise: 0.006 }) },
  { sym: 'CRUX.DEMO', name: 'Crux Biologics (demo)', expect: 'dbl', story: 'Double bottom: the second low undercuts the first.',
    bars: () => build(33, 30, [...lead(30, 50), [140, 80, 'lin'], [25, 63, 'ease', 1.2], [20, 72, 'ease', 0.8], [22, 61, 'ease', 1.1], [28, 70, 'ease', 0.9]]) },
  { sym: 'DUNE.DEMO', name: 'Dune Logistics (demo)', expect: 'flat', story: 'Flat base: seven tight weeks after a strong run.',
    bars: () => build(44, 20, [...lead(20, 30), [150, 52, 'lin', 1.1], [8, 47.5, 'ease', 0.9], [10, 51, 'ease', 0.8], [9, 47.8, 'ease', 0.7], [10, 50.6, 'ease', 0.7]], { noise: 0.004 }) },
  { sym: 'ECHO.DEMO', name: 'Echo Semiconductors (demo)', expect: 'asc', story: 'Ascending base: three pullbacks, each low and high higher.',
    bars: () => build(55, 50, [...lead(50, 70), [130, 100, 'lin', 1.05], [10, 87, 'ease', 1.1], [12, 106, 'ease', 1.0], [10, 92, 'ease', 1.1], [12, 112, 'ease', 1.0], [10, 98, 'ease', 1.0]], { noise: 0.004 }) },
  { sym: 'FLUX.DEMO', name: 'Flux Medical (demo)', expect: 'htf', story: 'High tight flag: more than doubled, then a tight flag.',
    bars: () => build(66, 12, [...lead(12, 16), [120, 20, 'lin'], [10, 19, 'ease', 0.9], [32, 44, 'in', 2.2], [8, 38.5, 'ease', 1.0], [10, 41, 'ease', 0.7]], { noise: 0.005 }) },
  { sym: 'GLOW.DEMO', name: 'Glow Consumer (demo)', expect: '3wt', story: 'Three weeks tight: weekly closes within 1.5% near highs.',
    bars: () => build(77, 60, [...lead(60, 80), [140, 118, 'lin', 1.05], [15, 121, 'ease', 0.75], [15, 121.4, 'lin', 0.6]], { noise: 0.0025 }) },
  { sym: 'HAZE.DEMO', name: 'Haze Media (demo)', expect: 'desc', story: 'Descending base: lower highs and lower lows below the 50-day line. No buy point.',
    bars: () => build(88, 70, [...lead(70, 95), [100, 120, 'lin'], [20, 100, 'ease', 1.3], [15, 112, 'ease', 0.8], [20, 92, 'ease', 1.3], [15, 102, 'ease', 0.8], [20, 84, 'ease', 1.3], [10, 89, 'ease', 0.8]]) },
  { sym: 'IRIS.DEMO', name: 'Iris Software (demo)', expect: 'breakout', story: 'Fresh breakout from a cup with handle on heavy volume: in the buy zone.',
    bars: () => build(99, 30, [...lead(30, 52), [140, 80, 'lin'], [30, 61, 'ease', 1.1], [15, 60, 'lin', 0.7], [32, 78, 'ease', 1.0], [9, 73, 'ease', 0.55], [3, 77.5, 'lin', 0.6], [1, 80.2, 'lin', 3.2], [1, 80.6, 'lin', 1.9]]) },
  { sym: 'JADE.DEMO', name: 'Jade Payments (demo)', expect: 'failed', story: 'A breakout that failed: closed back under its buy point.',
    bars: () => build(110, 35, [...lead(35, 55), [140, 90, 'lin'], [28, 70, 'ease', 1.1], [15, 69, 'lin', 0.7], [30, 88, 'ease', 1.0], [9, 82, 'ease', 0.6], [3, 87, 'lin', 0.6], [2, 92, 'lin', 1.6], [6, 85.5, 'ease', 1.6]]) },
  { sym: 'KITE.DEMO', name: 'Kite Aerospace (demo)', expect: 'faulty', story: 'A cup only 4–5 weeks long: shown, but marked faulty.',
    bars: () => build(121, 40, [...lead(40, 60), [140, 92, 'lin'], [11, 76, 'ease', 1.1], [12, 90, 'ease', 1.0], [3, 87, 'ease', 0.8]]) },
  { sym: 'LUMA.DEMO', name: 'Luma Cloud (demo)', expect: 'leader', story: 'A leader with several past breakouts: see the base history and stage count.',
    bars: () => build(132, 15, [[60, 16, 'lin'], [40, 24, 'in'], [30, 21, 'ease', 0.9], [30, 25.6, 'ease', 0.9], [3, 27, 'lin', 2.4], [60, 36, 'lin'], [25, 32.5, 'ease', 0.85], [20, 35.6, 'ease', 0.8], [3, 38, 'lin', 2.2], [70, 52, 'lin'], [30, 41, 'ease', 1.1], [15, 40.5, 'lin', 0.7], [30, 50.5, 'ease', 1.0], [8, 47.5, 'ease', 0.6], [3, 50.6, 'lin', 0.6], [3, 55, 'lin', 2.5], [40, 64, 'lin'], [26, 58.5, 'ease', 0.8], [12, 62.8, 'ease', 0.75]]) },
];

const INDEX = [
  { sym: 'DEMO-COMP', name: 'Demo Composite (fictional index)', seed: 501, start: 9000 },
  { sym: 'DEMO-500', name: 'Demo 500 (fictional index)', seed: 502, start: 3600 },
];

function indexBars(seed, s) {
  // a correction, a follow-through day, then a steady uptrend with a few distribution days
  return build(seed, s, [[200, s * 1.18, 'lin', 1], [60, s * 1.30, 'ease'], [35, s * 1.12, 'out', 1.25], [3, s * 1.14, 'lin', 0.8], [1, s * 1.165, 'lin', 1.8], [70, s * 1.32, 'lin', 1.05], [30, s * 1.40, 'lin', 1], [3, s * 1.375, 'lin', 1.5], [9, s * 1.41, 'lin', 0.95]], { noise: 0.004, vol: 3e9 });
}

const cache = new Map();
export function demoBars(sym) {
  if (cache.has(sym)) return cache.get(sym);
  let bars = null, name = null;
  const d = DEMO.find(x => x.sym === sym);
  if (d) { bars = d.bars(); name = d.name; }
  const ix = INDEX.find(x => x.sym === sym);
  if (ix) { bars = indexBars(ix.seed, ix.start); name = ix.name; }
  if (!bars) return null;
  const out = { sym, name, currency: 'USD', exchange: 'Demo data (fictional)', bars };
  cache.set(sym, out);
  return out;
}

export const DEMO_INDEXES = INDEX.map(x => ({ sym: x.sym, name: x.name }));
export const DEMO_BENCH = 'DEMO-500';

/* ---------- demo earnings: quarterly EPS that fits each story (leaders accelerate, laggards shrink) ---------- */
const EPS_PROFILE = {
  'ACME.DEMO': [0.42, 0.06, 0.004], 'BOLT.DEMO': [0.30, 0.04, 0], 'CRUX.DEMO': [0.25, 0.05, 0.003], 'DUNE.DEMO': [0.18, 0.07, 0],
  'ECHO.DEMO': [0.55, 0.05, 0.004], 'FLUX.DEMO': [0.05, 0.10, 0.012], 'GLOW.DEMO': [0.80, 0.03, 0], 'HAZE.DEMO': [0.95, -0.02, -0.004],
  'IRIS.DEMO': [0.35, 0.06, 0.006], 'JADE.DEMO': [0.60, 0.07, -0.006], 'KITE.DEMO': [0.40, 0.02, 0], 'LUMA.DEMO': [0.10, 0.08, 0.004],
};
export function demoEarnings(sym) {
  const p = EPS_PROFILE[sym], d = demoBars(sym); if (!p || !d) return null;
  const r = rng(sym.length * 97 + sym.charCodeAt(0)), b = d.bars, out = [];
  let eps = p[0], g = p[1], rev = 400e6 * (1 + p[0]);
  for (let i = 20, k = 0; i < b.length; i += 63, k++) {
    const est = eps * (1 + g) * (0.97 + r() * 0.03);
    eps = eps * (1 + g) * (0.98 + r() * 0.06); g += p[2]; rev *= 1 + g * 0.6;
    out.push({ time: b[i].time, eps: +eps.toFixed(2), est: +est.toFixed(2), rev: Math.round(rev), revEst: Math.round(rev * 0.99), period: 'Q' + ((k % 4) + 1) });
  }
  // the next report, a few weeks after the last one
  const last = out[out.length - 1].time, next = last + 91 * 86400;
  if (next > b[b.length - 1].time) out.push({ time: next, eps: null, est: +(eps * (1 + g)).toFixed(2) });
  return out;
}

/* ---------- demo news: fictional example headlines ---------- */
export function demoNews(sym) {
  const d = demoBars(sym), e = demoEarnings(sym); if (!d) return [];
  const nm = d.name.replace(' (demo)', ''), last = d.bars[d.bars.length - 1].time * 1000, day = 864e5;
  const q = (e || []).filter(x => x.eps != null), lr = q[q.length - 1];
  const yoy = q.length > 4 ? Math.round((lr.eps / q[q.length - 5].eps - 1) * 100) : null;
  const items = [
    { title: `${nm} shares move as traders eye its buy point`, date: last - 0.2 * day, tag: 'other' },
    { title: `Analyst raises ${nm} price target, citing demand`, date: last - 3 * day, tag: 'analyst' },
    lr && { title: `${nm} reports quarterly EPS of $${lr.eps.toFixed(2)}${yoy != null ? `, ${yoy >= 0 ? 'up' : 'down'} ${Math.abs(yoy)}% from a year ago` : ''}`, date: lr.time * 1000 + 0.5 * day, tag: 'earnings' },
    { title: `${nm} to present at an industry conference next month`, date: last - 12 * day, tag: 'other' },
    { title: `${nm} unveils new product line`, date: last - 26 * day, tag: 'product' },
  ].filter(Boolean);
  return items.map(x => ({ ...x, source: 'Example headline (fictional)', link: null }));
}
