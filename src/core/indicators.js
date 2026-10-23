// Technical indicators. All take plain arrays and return arrays of the same length (null where undefined).

export const sma = (a, n) => {
  const o = Array(a.length).fill(null); let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; }
  return o;
};

export const ema = (a, n) => {
  const o = []; const k = 2 / (n + 1); let e = a[0];
  for (let i = 0; i < a.length; i++) { e = i ? a[i] * k + e * (1 - k) : a[0]; o.push(e); }
  return o;
};

export function rsi(c, n = 14) {
  const o = Array(c.length).fill(null); let up = 0, dn = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= n) { up += u / n; dn += w / n; } else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + w) / n; }
    if (i >= n) o[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return o;
}

export function macd(c) {
  const f = ema(c, 12), s = ema(c, 26); const m = c.map((_, i) => f[i] - s[i]); const sg = ema(m, 9);
  return { m, sg, h: m.map((v, i) => v - sg[i]) };
}

export function atr(b, n = 14) {
  const o = []; let a = null;
  for (let i = 0; i < b.length; i++) {
    const tr = i ? Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close)) : b[i].high - b[i].low;
    a = a === null ? tr : (a * (n - 1) + tr) / n; o.push(a);
  }
  return o;
}

export function stdev(a, n) {
  const o = Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, q = 0; for (let j = i - n + 1; j <= i; j++) { s += a[j]; q += a[j] * a[j]; }
    const m = s / n; o[i] = Math.sqrt(Math.max(q / n - m * m, 0));
  }
  return o;
}

/** Group daily bars into weeks (Monday-based). Each weekly bar keeps `last` = time of its final day. */
export function weekly(d) {
  const out = []; let cur = null, key = null;
  for (const b of d) {
    const dt = new Date(b.time * 1000); const k = b.time - ((dt.getUTCDay() + 6) % 7) * 86400;
    if (k !== key) { key = k; cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, last: b.time }; out.push(cur); }
    else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; cur.last = b.time; }
  }
  return out;
}

/** Value of a benchmark series (ascending [{time, close}]) at or before time t. */
export function valueAt(series, t) {
  if (!series || !series.length || t < series[0].time) return null;
  let lo = 0, hi = series.length - 1;
  if (t >= series[hi].time) return series[hi].close;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (series[m].time <= t) lo = m; else hi = m; }
  return series[lo].close;
}

/** All chart indicators for a bar series. `bench` = benchmark closes for the RS line. */
export function calc(b, weeklyMode, bench) {
  const P = weeklyMode ? [2, 4, 10, 40, 10] : [10, 21, 50, 200, 50];
  const c = b.map(x => x.close), v = b.map(x => x.volume);
  const s20 = sma(c, 20), sd = stdev(c, 20);
  const rs = b.map(x => { const s = valueAt(bench, weeklyMode ? x.last : x.time); return s ? x.close / s * 100 : null; });
  return {
    c, v, l1: sma(c, P[0]), l2: ema(c, P[1]), l3: sma(c, P[2]), l4: sma(c, P[3]), vavg: sma(v, P[4]),
    rsi: rsi(c), macd: macd(c), atr: atr(b), rs,
    s50: sma(c, 50), s200: sma(c, 200), s10: sma(c, 10), e21: ema(c, 21),
    bbu: s20.map((m, i) => m === null ? null : m + 2 * sd[i]), bbl: s20.map((m, i) => m === null ? null : m - 2 * sd[i]),
    bw: s20.map((m, i) => m === null ? null : 4 * sd[i] / m), v50: sma(v, 50),
  };
}

export function rsNewHigh(rs, look) {
  const n = rs.length - 1; if (rs[n] == null) return false; let m = -Infinity;
  for (let i = Math.max(0, n - look); i < n; i++) if (rs[i] != null) m = Math.max(m, rs[i]);
  return rs[n] >= m;
}
