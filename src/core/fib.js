// Fibonacci retracement / extension levels for a drawing between two points (MarketSurge-style settings: a list of
// levels you switch on or off, your own extra levels, reverse, extend to the right). Pure functions, no DOM.

/** The standard levels (as in MarketSurge), in %. Negative = beyond the start point, above 100 = extensions. */
export const FIB_STD = [-78.6, -61.8, -50, -38.2, -23.6, 0, 23.6, 38.2, 50, 61.8, 78.6, 100, 127.2, 138.2, 161.8, 261.8, 423.6];
export const FIB_DEFAULT = { on: [0, 23.6, 38.2, 50, 61.8, 78.6, 100], custom: [], reverse: false, extend: true, prices: true };

/** Settings with defaults filled in (stored settings may be partial or from an older version). */
export function fibSettings(s) {
  const o = { ...FIB_DEFAULT, ...(s || {}) };
  o.on = (Array.isArray(o.on) ? o.on : FIB_DEFAULT.on).map(Number).filter(Number.isFinite);
  o.custom = (Array.isArray(o.custom) ? o.custom : []).map(Number).filter(x => Number.isFinite(x) && !FIB_STD.includes(x));
  return o;
}

/** Every level the settings list (standard + custom), sorted, with whether it is on. */
export function fibChoices(s) {
  const o = fibSettings(s);
  return [...new Set([...FIB_STD, ...o.custom])].sort((a, b) => a - b).map(v => ({ v, on: o.on.includes(v), custom: !FIB_STD.includes(v) }));
}

/** Parse a level the user types: "70.7", "70,7%", "-10" → number in %, or null. */
export function parseLevel(t) {
  const x = parseFloat(String(t).replace(',', '.').replace('%', '').trim());
  return Number.isFinite(x) && x >= -1000 && x <= 1000 ? Math.round(x * 10) / 10 : null;
}

/**
 * The levels of one drawing. dr = {p1 (first click), p2 (second click)}. 0% sits at the first point and 100% at the
 * second (reverse swaps them). Returns [{v, price, label}] sorted from high price to low.
 */
export function fibLevels(dr, s) {
  const o = fibSettings(s), [a, b] = o.reverse ? [dr.p2, dr.p1] : [dr.p1, dr.p2];
  if (!(a > 0) || !(b > 0) || a === b) return [];
  return o.on.slice().sort((x, y) => x - y).map(v => {
    const price = a + (b - a) * v / 100;
    return { v, price, label: (Number.isInteger(v) ? v.toFixed(1) : String(v)) + '%' };
  }).filter(x => x.price > 0).sort((x, y) => y.price - x.price);
}
