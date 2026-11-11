// Small shared helpers. No network access anywhere in this app.

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const nowIso = () => new Date().toISOString();

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const monthKey = (dateStr) => (dateStr || '').slice(0, 7); // 'YYYY-MM'

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function lastMonths(endKey, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endKey, -i));
  return out;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

let _fmt = null;
let _fmt0 = null;
export function setLocale(locale = 'en-IE', currency = 'EUR') {
  _fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  _fmt0 = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
}
setLocale();

export const money = (n) => _fmt.format(Number(n) || 0);
export const money0 = (n) => _fmt0.format(Math.round(Number(n) || 0));
export const pct = (n, digits = 0) => (isFinite(n) ? `${(n * 100).toFixed(digits)}%` : '–');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Lowercase, strip accents and collapse whitespace – used for matching. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function sum(arr, f = (x) => x) {
  let s = 0;
  for (const x of arr) s += Number(f(x)) || 0;
  return s;
}

export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
