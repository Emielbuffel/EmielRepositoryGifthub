// Small DOM helpers, formatters and icons shared by the views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tagged template that escapes interpolated values unless wrapped with raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) { const v = vals[i]; out += Array.isArray(v) ? v.map(x => x && x.__raw ? x.s : esc(x)).join('') : v && v.__raw ? v.s : esc(v); } });
  return { __raw: true, s: out };
}
export const raw = s => ({ __raw: true, s: String(s) });
export function render(el, tpl) { el.innerHTML = tpl && tpl.__raw ? tpl.s : esc(tpl); return el; }

export const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩', CNY: '¥', HKD: 'HK$', CHF: 'CHF ', SEK: 'SEK ', DKK: 'DKK ', NOK: 'NOK ', CAD: 'C$', AUD: 'A$' };
/** Price in the listing currency. GBp (pence) is shown as e.g. 1,234p. KRW/JPY without decimals. */
export function money(p, cur = 'USD') {
  if (p == null || !isFinite(p)) return '—';
  const dg = cur === 'KRW' || cur === 'JPY' ? 0 : 2;
  const n = p.toLocaleString('en-US', { minimumFractionDigits: dg, maximumFractionDigits: dg });
  if (cur === 'GBp' || cur === 'GBX') return n + 'p';
  return (SYM[cur] ?? (cur ? cur + ' ' : '')) + n;
}
export const big = (x, cur = 'USD') => {
  if (x == null || !isFinite(x)) return '—';
  const s = SYM[cur] ?? (cur + ' '); const a = Math.abs(x);
  return (x < 0 ? '−' : '') + s + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(1) + 'K' : a.toLocaleString('en-US', { maximumFractionDigits: 0 }));
};
export const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

let toastT = null;
export function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/** Opens a bottom sheet / dialog. Returns the sheet element; close() hides it. */
export function sheet(title, bodyTpl, { onClose } = {}) {
  const bd = $('#sheet'), sh = bd.firstElementChild;
  render(sh, html`<div class="sheet-head"><h2 id="sheetTitle">${title}</h2><button class="btn sm" data-close>Done</button></div>${bodyTpl}`);
  bd.hidden = false;
  const close = () => { bd.hidden = true; sh.innerHTML = ''; document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  bd.onclick = e => { if (e.target === bd) close(); };
  sh.querySelector('[data-close]').onclick = close;
  sh.close = close;
  return sh;
}
export const closeSheet = () => { const sh = $('#sheet').firstElementChild; if (sh.close) sh.close(); };

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  chart: P('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l3.5-4 3 2.5L19 7"/>'),
  market: P('<path d="M3 12h3l2.5-6 4 12 3-8 1.5 2H21"/>'),
  screener: P('<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>'),
  review: P('<path d="M4 19h16"/><path d="M7 15l3-4 3 2 4-6"/><circle cx="17" cy="7" r="1.2"/>'),
  taxes: P('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 15.5h5M10 8.5h2"/>'),
  prune: P('<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.4 20 17.5M8.2 16.6 20 6.5"/>'),
  portfolio: P('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M3 12.5h18"/>'),
  fund: P('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  balance: P('<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0z"/><path d="M8 21h8"/>'),
  plan: P('<path d="M3 20l6-6 4 4 8-9"/><path d="M15 9h6v6"/><circle cx="5" cy="5" r="1.5"/>'),
  coach: P('<circle cx="12" cy="11" r="7.5"/><path d="M9.5 10h.01M14.5 10h.01"/><path d="M9.5 13.5c.7.8 1.6 1.2 2.5 1.2s1.8-.4 2.5-1.2"/><path d="M12 18.5V21"/><path d="M8 21h8"/>'),
  learn: P('<path d="M3 6.5 12 3l9 3.5-9 3.5z"/><path d="M7 8.5V14c0 1.5 2.3 3 5 3s5-1.5 5-3V8.5"/><path d="M21 6.5V12"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  star: P('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  starFill: P('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>'),
  refresh: P('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
  expand: P('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'),
  pen: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  layers: P('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  play: P('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  trash: P('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>'),
  bell: P('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  list: P('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  upload: P('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  grip: P('<circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/><circle cx="15" cy="17" r="1.2" fill="currentColor"/>'),
};
