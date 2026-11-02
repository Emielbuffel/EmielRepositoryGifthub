// Small SVG charts for the Balance and Plan tabs: a progress ring, a donut, paired bars (now vs target), a cash-flow
// diagram (income → spending categories → saved), and line / stacked-area charts over years.
import { tok } from './dom.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = c => (c.startsWith('--') ? tok(c) : c);

/** Ring showing a share 0–1 with a label in the middle. */
export function ring(p, { size = 92, color, label, sub } = {}) {
  const r = size / 2 - 8, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, p || 0));
  const c = col(color || (v >= 0.75 ? '--up' : v >= 0.5 ? '--warn' : '--down'));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label || '')}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="9"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(v * C).toFixed(1)} ${C}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="${sub ? '47%' : '54%'}" text-anchor="middle" font-size="${size / 4.6}" font-weight="700" fill="var(--ink)">${esc(label ?? Math.round(v * 100) + '%')}</text>
    ${sub ? `<text x="50%" y="66%" text-anchor="middle" font-size="${size / 9}" fill="var(--muted)">${esc(sub)}</text>` : ''}</svg>`;
}

/** Donut of parts [{label, value, color}] with the total in the middle. */
export function donut(parts, { size = 150, center = '', sub = '' } = {}) {
  const tot = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1, r = size / 2 - 12, C = 2 * Math.PI * r;
  let off = 0; const seg = parts.filter(p => p.value > 0).map(p => { const len = p.value / tot * C; const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col(p.color)}" stroke-width="18" stroke-dasharray="${Math.max(0, len - 2).toFixed(1)} ${C}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(p.label)}: ${Math.round(p.value / tot * 100)}%</title></circle>`; off += len; return s; });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill)" stroke-width="18"/>${seg.join('')}
    <text x="50%" y="${sub ? '48%' : '53%'}" text-anchor="middle" font-size="${size / 8}" font-weight="700" fill="var(--ink)">${esc(center)}</text>${sub ? `<text x="50%" y="62%" text-anchor="middle" font-size="${size / 13}" fill="var(--muted)">${esc(sub)}</text>` : ''}</svg>`;
}

/** Rows [{label, now, target}] in % as two bars each: now (solid) and target (outline). */
export function pairedBars(rows, { max } = {}) {
  const M = max || Math.max(10, ...rows.flatMap(r => [r.now, r.target])) * 1.3, W = 420, rh = 30, l = 150, H = rows.length * rh + 6;
  const X = v => l + v / M * (W - l - 40);
  return `<svg viewBox="0 0 ${W} ${H}" class="fchart" role="img" aria-label="Allocation now versus target">${rows.map((r, i) => {
    const y = i * rh + 4, over = r.now > r.target, c = r.breach ? (over ? tok('--warn') : tok('--down')) : tok('--blue');
    return `<text x="0" y="${y + 15}" font-size="11.5" fill="var(--ink)">${esc(r.label)}</text>
      <rect x="${l}" y="${y + 3}" width="${Math.max(1, X(r.now) - l)}" height="11" rx="3" fill="${c}"/>
      <rect x="${l}" y="${y + 16}" width="${Math.max(1, X(r.target) - l)}" height="7" rx="2" fill="none" stroke="var(--muted)" stroke-dasharray="3 2"/>
      <text x="${X(Math.max(r.now, r.target)) + 6}" y="${y + 15}" font-size="11" fill="var(--muted)">${Math.round(r.now)}% / ${Math.round(r.target)}%</text>`;
  }).join('')}</svg>`;
}

/** Cash-flow diagram: income on the left flowing into spending categories and what is left (Sankey-style). */
export function flowDiagram(income, outs, left, fmt) {
  const items = [...outs.filter(o => o.value > 0)]; if (left > 0) items.push({ label: 'Saved / invested', value: left, color: '--up' });
  const tot = Math.max(income, items.reduce((s, o) => s + o.value, 0), 1), W = 640, H = Math.max(200, items.length * 34), pad = 6;
  const sc = (H - pad * (items.length - 1)) / tot, inH = income * sc;
  let y = 0, yIn = (H - inH) / 2;
  const paths = items.map(o => {
    const h = o.value * sc, y0 = yIn, y1 = y, c = col(o.color);
    const s = `<path d="M150,${y0} C330,${y0} 330,${y1} 470,${y1} L470,${y1 + h} C330,${y1 + h} 330,${y0 + h} 150,${y0 + h} Z" fill="${c}" opacity=".35"/>
      <rect x="470" y="${y1}" width="10" height="${Math.max(1, h)}" rx="2" fill="${c}"/>
      <text x="488" y="${y1 + h / 2 + 4}" font-size="11.5" fill="var(--ink)">${esc(o.label)} <tspan fill="var(--muted)">${esc(fmt(o.value))}</tspan></text>`;
    yIn += Math.min(h, inH); y += h + pad; return s;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="fchart" style="max-width:760px;margin:0 auto" role="img" aria-label="Where the money goes">
    <rect x="138" y="${(H - inH) / 2}" width="12" height="${Math.max(1, inH)}" rx="2" fill="${tok('--up')}"/>
    <text x="130" y="${H / 2}" text-anchor="end" font-size="12" font-weight="700" fill="var(--ink)">Income</text>
    <text x="130" y="${H / 2 + 15}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(fmt(income))}</text>${paths.join('')}</svg>`;
}

/** Lines or stacked areas over x (years). series: [{label, color, pts: [[x, y]]}]; stacked = cumulative areas. */
export function chart(series, { W = 720, stacked = false, H = 230, fmt = v => v, xLabel = x => x, markers = [], yMax = null, xTicks = null } = {}) {
  const l = 64, r = 14, top = 12, bot = 26;
  const xs = series[0] ? series[0].pts.map(p => p[0]) : [0, 1], x0 = Math.min(...xs), x1 = Math.max(...xs);
  const acc = series.map((s, i) => s.pts.map((p, k) => [p[0], stacked ? series.slice(0, i + 1).reduce((t, z) => t + (z.pts[k] ? z.pts[k][1] : 0), 0) : p[1]]));
  const ys = acc.flat().map(p => p[1]).concat(markers.map(m => m.y)), y1 = yMax != null ? yMax : Math.max(1, ...ys) * 1.05, y0 = Math.min(0, ...ys);
  const X = x => l + (x1 > x0 ? (x - x0) / (x1 - x0) : 0) * (W - l - r), Y = y => top + (y1 - y) / (y1 - y0) * (H - top - bot);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = y0 + (y1 - y0) * k / 4; g += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${l - 6}" y="${Y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(fmt(v))}</text>`; }
  const step = Math.max(1, Math.ceil((x1 - x0) / 8));
  for (const x of xTicks || Array.from({ length: Math.floor((x1 - x0) / step) + 1 }, (_, k) => x0 + k * step)) g += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(xLabel(x))}</text>`;
  acc.forEach((pts, i) => {
    const c = col(series[i].color), line = pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    if (stacked) { const below = i ? acc[i - 1] : pts.map(p => [p[0], 0]); g += `<polygon points="${line} ${[...below].reverse().map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="${c}" opacity=".55"><title>${esc(series[i].label)}</title></polygon>`; }
    g += `<polyline fill="none" stroke="${c}" stroke-width="2" ${series[i].dash ? 'stroke-dasharray="5 4"' : ''} points="${line}"/>`;
  });
  markers.forEach(m => { g += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="5" fill="${col(m.color || '--orange')}"><title>${esc(m.label || '')}</title></circle>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="fchart" role="img">${g}</svg>`;
}

/** Legend chips for [{label, color}]. */
export const legend = items => `<div class="legend small">${items.map(i => `<span><i style="background:${col(i.color)};height:10px;width:10px;border-radius:3px"></i>${esc(i.label)}</span>`).join('')}</div>`;
