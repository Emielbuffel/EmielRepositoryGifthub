// Stock chart: candles/bars, moving averages, RS line, volume, RSI, MACD, every detected base pattern
// (one colour per pattern type) and the user's own drawings. Built on lightweight-charts v5.
import { createChart, CandlestickSeries, BarSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle, CrosshairMode } from 'lightweight-charts';
import { calc, weekly, rsNewHigh } from '../core/indicators.js';
import { lineVal, cupPivot, fD, f2, pc, fmtVol } from '../core/analysis.js';
import { tok } from './dom.js';

export const PAT_LABEL = { cwh: 'Cup with handle', cup: 'Cup without handle', dbl: 'Double bottom', flat: 'Flat base', asc: 'Ascending base', htf: 'High tight flag', '3wt': 'Three weeks tight', desc: 'Descending base' };
export const PAT_SHORT = { cwh: 'Cup w/ handle', cup: 'Cup', dbl: 'Double bottom', flat: 'Flat base', asc: 'Ascending', htf: 'High tight flag', '3wt': '3 wks tight', desc: 'Descending' };
export const patColor = t => tok('--p-' + t) || tok('--orange');

/** Which detected patterns to draw: the current base(s), a fresh breakout, and (mode 'all') every past one. */
export function patternsToShow(R, daily, mode) {
  if (!R || mode === 'off') return [];
  const n = daily.length - 1, out = [];
  R.cur.forEach((p, k) => out.push({ p, kind: k ? 'alt' : 'cur' }));
  const last = R.last;
  const lastActive = last && !last.failed && n - last.bo <= 40;
  if (!R.cur.length && lastActive) out.push({ p: last, kind: 'bo' });
  if (mode === 'all') R.hist.forEach(h => { if (!(h === last && !R.cur.length && lastActive)) out.push({ p: h, kind: 'hist' }); });
  return out;
}
export function outcome(p) {
  if (p.failed) return '✗ failed';
  if (p.stopped) return '✗ stopped −8%';
  if (p.best == null) return '';
  return (p.best >= 0.2 ? '✓ +' : '+') + Math.round(p.best * 100) + '%' + (p.open ? ' so far' : '');
}

export class StockChart {
  constructor(el, legendEl) {
    this.el = el; this.legendEl = legendEl; this.drawn = []; this.panes = { rsi: false, macd: false };
    this.clickCb = null; this.S = null; this.build();
    this.mq = matchMedia('(prefers-color-scheme: dark)');
    this.onTheme = () => { this.theme(); if (this.S) this.update(this.S, true); };
    this.mq.addEventListener('change', this.onTheme);
    this.mo = new MutationObserver(this.onTheme); this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  build() {
    if (this.chart) { this.chart.remove(); this.drawn = []; }
    const c = this.chart = createChart(this.el, {
      autoSize: true, localization: { locale: 'en-GB' },
      rightPriceScale: { borderVisible: false, minimumWidth: 64, scaleMargins: { top: 0.17, bottom: 0.04 } },
      timeScale: { borderVisible: false, rightOffset: 4 }, crosshair: { mode: CrosshairMode.Normal },
      layout: { attributionLogo: true, panes: { enableResize: true } },
    });
    const L = (o, pane = 0) => c.addSeries(LineSeries, Object.assign({ lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, o), pane);
    this.style = this.style || 'candles';
    this.ps = c.addSeries(this.style === 'bars' ? BarSeries : CandlestickSeries, { priceLineVisible: true, thinBars: false }, 0);
    this.markers = createSeriesMarkers(this.ps, []);
    this.ln = { l1: L({}), l2: L({}), l3: L({ lineWidth: 2 }), l4: L({ lineWidth: 2 }), bbu: L({ lineStyle: LineStyle.Dashed, lineWidth: 1 }), bbl: L({ lineStyle: LineStyle.Dashed, lineWidth: 1 }) };
    this.rsS = L({ priceScaleId: 'rs' });
    c.priceScale('rs').applyOptions({ scaleMargins: { top: 0.76, bottom: 0.02 }, visible: false });
    this.rsMarkers = createSeriesMarkers(this.rsS, []);
    const volFmt = { type: 'custom', formatter: fmtVol, minMove: 1 };
    this.volS = c.addSeries(HistogramSeries, { priceFormat: volFmt, lastValueVisible: false, priceLineVisible: false }, 1);
    this.vAvgS = L({ priceFormat: volFmt }, 1);
    let pane = 2;
    if (this.panes.rsi) {
      this.rsiPane = pane++;
      this.rsiS = c.addSeries(LineSeries, { lineWidth: 1.5, priceLineVisible: false }, this.rsiPane);
      this.r70 = this.rsiS.createPriceLine({ price: 70, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
      this.r30 = this.rsiS.createPriceLine({ price: 30, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    } else this.rsiS = null;
    if (this.panes.macd) {
      const p = pane++;
      this.mS = L({}, p); this.sS = L({}, p);
      this.hS = c.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
    } else this.mS = this.sS = this.hS = null;
    const ps = c.panes();
    ps[0].setStretchFactor(1); ps[1].setStretchFactor(0.24); ps.slice(2).forEach(p => p.setStretchFactor(0.2));
    c.subscribeCrosshairMove(p => this.legend(p && p.time != null ? p.time : null));
    c.subscribeClick(p => {
      if (!this.clickCb || !p.point || !this.bars) return;
      const price = this.ps.coordinateToPrice(p.point.y); if (price == null) return;
      const li = p.logical == null ? this.bars.length - 1 : Math.max(0, Math.min(this.bars.length - 1, Math.round(p.logical)));
      this.clickCb({ time: this.bars[li].time, price: +price.toFixed(2) });
    });
    this.theme();
  }

  setPanes(panes) {
    if (panes.rsi === this.panes.rsi && panes.macd === this.panes.macd) return;
    const r = this.chart.timeScale().getVisibleLogicalRange();
    this.panes = { ...panes }; this.build();
    if (this.S) this.update(this.S, true);
    if (r) this.setRange(r);
  }
  setStyle(style) {
    if (style === this.style) return;
    const r = this.chart.timeScale().getVisibleLogicalRange();
    this.style = style; this.build(); if (this.S) this.update(this.S, true); if (r) this.setRange(r);
  }

  theme() {
    const bg = tok('--bg2'), ink = tok('--muted'), grid = tok('--grid');
    this.chart.applyOptions({ layout: { background: { type: 'solid', color: bg }, textColor: ink, fontFamily: tok('--mono'), fontSize: 11, panes: { separatorColor: tok('--sep'), separatorHoverColor: tok('--fill2') } }, grid: { vertLines: { color: grid }, horzLines: { color: grid } } });
    this.ln.l1.applyOptions({ color: tok('--ma1') }); this.ln.l2.applyOptions({ color: tok('--ma2') }); this.ln.l3.applyOptions({ color: tok('--ma3') }); this.ln.l4.applyOptions({ color: tok('--ma4') });
    this.ln.bbu.applyOptions({ color: ink }); this.ln.bbl.applyOptions({ color: ink }); this.rsS.applyOptions({ color: tok('--rs') }); this.vAvgS.applyOptions({ color: tok('--ma3') });
    if (this.rsiS) { this.rsiS.applyOptions({ color: tok('--blue') }); [this.r70, this.r30].forEach(p => p.applyOptions({ color: ink })); }
    if (this.mS) { this.mS.applyOptions({ color: tok('--ma3') }); this.sS.applyOptions({ color: tok('--orange') }); }
  }

  setRange(r) { try { this.chart.timeScale().setVisibleLogicalRange(r); } catch (e) { /* not ready */ } requestAnimationFrame(() => { try { this.chart.timeScale().setVisibleLogicalRange(r); } catch (e) { /* ignore */ } }); }

  /** Zoom to daily index range [i, j]. */
  zoomDaily(i, j) {
    const S = this.S; if (!S) return;
    const a = this.idxAt(S.daily[Math.max(0, i)].time), b = this.idxAt(S.daily[Math.min(S.daily.length - 1, j)].time);
    this.setRange({ from: Math.max(0, a - (S.tf === 'D' ? 15 : 4)), to: b + (S.tf === 'D' ? 15 : 4) });
  }
  fit() { if (this.bars) this.setRange({ from: 0, to: this.bars.length + 6 }); }

  idxAt(t) { const b = this.bars; let lo = 0, hi = b.length - 1; if (t <= b[0].time) return 0; if (t >= b[hi].time) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; } return lo; }
  snapT(t) { return this.bars[this.idxAt(t)].time; }

  /**
   * S = { sym, daily, bench, R, tf: 'D'|'W', lines: {l1,l2,l3,l4,rs,bb}, patMode, drawings, cur, pending, poly }
   * keepRange: keep the current zoom.
   */
  update(S, keepRange) {
    this.S = S;
    const prev = this.chart.timeScale().getVisibleLogicalRange();
    const b = this.bars = S.tf === 'D' ? S.daily : weekly(S.daily);
    const K = this.K = calc(b, S.tf === 'W', S.bench);
    const last = b[b.length - 1].time; this.future = []; let t = last;
    while (this.future.length < (S.tf === 'D' ? 25 : 12)) { t += S.tf === 'D' ? 86400 : 7 * 86400; const wd = new Date(t * 1000).getUTCDay(); if (S.tf === 'W' || (wd !== 0 && wd !== 6)) this.future.push(t); }
    const withF = a => a.concat(this.future.map(time => ({ time })));
    const ser = v => b.map((x, i) => v[i] == null || !isFinite(v[i]) ? { time: x.time } : { time: x.time, value: v[i] });
    const up = tok('--up'), dn = tok('--down'), col = i => b[i].close >= b[i].open ? up : dn;
    this.ps.setData(withF(b.map((x, i) => { const c = col(i); return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close, color: c, borderColor: c, wickColor: c }; })));
    this.ps.applyOptions({ priceFormat: { type: 'price', precision: S.cur === 'KRW' || S.cur === 'JPY' ? 0 : 2, minMove: S.cur === 'KRW' || S.cur === 'JPY' ? 1 : 0.01 } });
    this.volS.setData(withF(b.map((x, i) => ({ time: x.time, value: x.volume, color: col(i) + 'B0' }))));
    this.vAvgS.setData(ser(K.vavg));
    ['l1', 'l2', 'l3', 'l4'].forEach(k => { this.ln[k].setData(ser(K[k])); this.ln[k].applyOptions({ visible: !!S.lines[k] }); });
    this.ln.bbu.setData(ser(K.bbu)); this.ln.bbl.setData(ser(K.bbl)); [this.ln.bbu, this.ln.bbl].forEach(s => s.applyOptions({ visible: !!S.lines.bb }));
    this.rsS.setData(ser(K.rs)); this.rsS.applyOptions({ visible: !!S.lines.rs });
    this.rsMarkers.setMarkers(rsNewHigh(K.rs, S.tf === 'D' ? 252 : 52) ? [{ time: last, position: 'inBar', shape: 'circle', color: tok('--rs'), text: 'RS high' }] : []);
    if (this.rsiS) this.rsiS.setData(withF(ser(K.rsi)));
    if (this.mS) {
      this.mS.setData(ser(K.macd.m)); this.sS.setData(ser(K.macd.sg));
      this.hS.setData(withF(b.map((x, i) => ({ time: x.time, value: K.macd.h[i], color: (K.macd.h[i] >= 0 ? up : dn) + '99' }))));
    }
    this.drawAll();
    if (keepRange && prev) this.setRange(prev);
    else {
      const n = b.length, show = S.tf === 'D' ? 200 : 130; let from = n - show;
      const cp = S.R && S.patMode !== 'off' && (S.R.cur.find(x => x.pivot) || S.R.cur[0]);
      if (cp) from = Math.min(from, this.idxAt(S.daily[cp.a].time) - 12);
      this.setRange({ from: Math.max(0, from), to: n + 8 });
    }
    this.legend(null);
  }

  legend(t) {
    const b = this.bars, K = this.K, S = this.S; if (!b || !K) return;
    const i = t != null ? this.idxAt(t) : b.length - 1, x = b[i], pv = i ? b[i - 1].close : x.open, ch = x.close / pv - 1, cl = ch >= 0 ? 'up' : 'down';
    const av = K.vavg[i];
    let h = `<span><b>${S.sym}</b> ${S.tf === 'D' ? 'daily' : 'weekly'} · ${fD(x.time)}</span><span>O <b>${f2(x.open)}</b></span><span>H <b>${f2(x.high)}</b></span><span>L <b>${f2(x.low)}</b></span><span>C <b class="${cl}">${f2(x.close)}</b></span><span class="${cl}">${pc(ch, 2)}</span><span>Vol <b>${fmtVol(x.volume)}</b>${av ? ' (' + pc(x.volume / av - 1, 0) + ')' : ''}</span>`;
    if (this.rsiS) h += `<span>RSI <b>${f2(K.rsi[i])}</b></span>`;
    this.legendEl.innerHTML = h;
  }

  addLine(pts, opt) {
    const d = [];
    const lastT = this.bars[this.bars.length - 1].time;
    for (const [t0, p] of pts) {
      const t = t0 > lastT ? t0 : this.snapT(t0);
      if (d.length && d[d.length - 1].time >= t) { if (d[d.length - 1].time === t) d[d.length - 1] = { time: t, value: p }; continue; }
      d.push({ time: t, value: p });
    }
    if (d.length < 2) return;
    const s = this.chart.addSeries(LineSeries, Object.assign({ lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, opt), 0);
    s.setData(d); this.drawn.push({ s });
  }
  addPL(o) { this.drawn.push({ p: this.ps.createPriceLine(Object.assign({ lineWidth: 1, axisLabelVisible: true }, o)) }); }

  uCurve([[t1, p1], [t2, p2], [t3, p3]]) {
    const B = this.bars, i1 = this.idxAt(t1), i2 = this.idxAt(t2), i3 = this.idxAt(t3), out = [[t1, p1]];
    for (let i = i1 + 1; i < i2; i++) { const x = (i2 - i) / (i2 - i1); out.push([B[i].time, p2 + (p1 - p2) * x * x]); }
    out.push([t2, p2]);
    for (let i = i2 + 1; i < i3; i++) { const x = (i - i2) / (i3 - i2); out.push([B[i].time, p2 + (p3 - p2) * x * x]); }
    out.push([t3, p3]); return out;
  }

  drawAll() {
    this.drawn.forEach(o => { try { o.s ? this.chart.removeSeries(o.s) : this.ps.removePriceLine(o.p); } catch (e) { /* gone */ } });
    this.drawn = [];
    const S = this.S, d = S.daily, markers = [], piv = tok('--pivot'), bad = tok('--bad');
    const T = i => d[Math.min(i, d.length - 1)].time;
    const futureT = this.future[Math.min(S.tf === 'D' ? 12 : 5, this.future.length - 1)];
    for (const { p, kind } of patternsToShow(S.R, d, S.patMode)) {
      const hist = kind === 'hist', color = patColor(p.type), e = p.e != null ? p.e : d.length - 1;
      const style = { color, lineWidth: hist ? 1.5 : 2.5, lineStyle: kind === 'alt' || (hist && (p.failed || p.stopped)) ? LineStyle.Dashed : LineStyle.Solid };
      if (p.box) { const [a, z, top, bot] = p.box; this.addLine([[T(a), top], [T(z), top]], style); this.addLine([[T(a), bot], [T(z), bot]], style); }
      if ((p.type === 'cwh' || p.type === 'cup') && p.m != null && p.R_i != null) {
        this.addLine(this.uCurve([[T(p.a), p.H], [T(p.m), p.L], [T(p.R_i), p.R]]), style);
        if (p.type === 'cwh') this.addLine([[T(p.R_i), p.R], [T(p.hl), p.HL], [T(e), d[Math.min(e, d.length - 1)].close]], style);
      } else if (p.pts && p.pts.length > 1) this.addLine(p.pts.map(([i, v]) => [T(i), v]), style);
      if (p.pivot) {
        const endT = kind === 'cur' || kind === 'alt' ? futureT : T(Math.min(p.bo != null ? p.bo + 3 : e, d.length - 1));
        this.addLine([[T(p.pivotIdx), p.pivot], [endT, p.pivot]], { color: piv, lineWidth: hist ? 1 : 2, lineStyle: LineStyle.Dashed });
      }
      if ((kind === 'cur' || kind === 'bo') && p.pivot) {
        this.addPL({ price: p.pivot, color: piv, lineStyle: LineStyle.Dashed, title: 'Buy point' });
        this.addPL({ price: p.pivot * 1.05, color: piv, lineStyle: LineStyle.Dotted, title: '+5%' });
        if (kind === 'bo') this.addPL({ price: p.pivot * 0.92, color: bad, lineStyle: LineStyle.Dotted, title: '−8% stop' });
      }
      const lbl = hist ? PAT_SHORT[p.type] + (p.faulty ? ' (faulty)' : '') + ' ' + outcome(p)
        : `${p.name}${p.weeks ? ' · ' + Math.round(p.weeks) + ' wk' : ''}${p.depth != null ? ' · −' + Math.round(p.depth * 100) + '%' : ''}`;
      markers.push({ time: this.snapT(T(p.a)), position: 'aboveBar', shape: 'arrowDown', color, text: lbl });
      if (p.bo != null) markers.push({ time: this.snapT(T(p.bo)), position: 'belowBar', shape: 'arrowUp', color: p.failed ? bad : p.volRatio >= 1.4 ? tok('--up') : tok('--muted'), text: p.failed ? 'failed' : 'BO' });
    }
    // the user's drawings
    const b = this.bars, last = b[b.length - 1].time, col = tok('--draw');
    for (const dr of S.drawings || []) {
      if (dr.type === 'trend') { const i1 = this.idxAt(dr.t1), i2 = this.idxAt(dr.t2); if (i1 === i2) continue; const t1 = b[i1].time; this.addLine([[t1, lineVal(dr, t1)], [last, lineVal(dr, last)]], { color: col }); }
      else if (dr.type === 'hline') this.addPL({ price: dr.p1, color: col, lineWidth: 2, title: dr.label || '' });
      else if (dr.type === 'zone') { this.addPL({ price: dr.p1, color: col, lineStyle: LineStyle.Dotted, title: '' }); this.addPL({ price: dr.p2, color: col, lineStyle: LineStyle.Dotted, title: dr.label || 'Zone' }); }
      else if (dr.type === 'cup' && dr.pts.length >= 3) {
        this.addLine(this.uCurve(dr.pts.slice(0, 3)), { color: col }); if (dr.pts.length > 3) this.addLine(dr.pts.slice(2), { color: col });
        const pv = cupPivot(dr); this.addLine([[dr.pts[dr.pts.length - 1][0], pv], [futureT, pv]], { color: col, lineWidth: 1, lineStyle: LineStyle.Dashed });
        this.addPL({ price: pv, color: col, lineStyle: LineStyle.Dashed, title: 'Your buy point' });
        markers.push({ time: this.snapT(dr.pts[0][0]), position: 'aboveBar', shape: 'arrowDown', color: col, text: dr.label || 'Your cup' });
      } else if (dr.type === 'note') markers.push({ time: this.snapT(dr.t1), position: 'aboveBar', shape: 'arrowDown', color: col, text: dr.label || 'Note' });
    }
    if (S.pending) markers.push({ time: this.snapT(S.pending.t), position: 'inBar', shape: 'circle', color: col, text: '1' });
    if (S.poly && S.poly.length) {
      if (S.poly.length >= 3) { this.addLine(this.uCurve(S.poly.slice(0, 3)), { color: col, lineStyle: LineStyle.Dashed }); if (S.poly.length > 3) this.addLine(S.poly.slice(2), { color: col, lineStyle: LineStyle.Dashed }); }
      else this.addLine(S.poly, { color: col, lineStyle: LineStyle.Dashed });
      S.poly.forEach((q, k) => markers.push({ time: this.snapT(q[0]), position: 'inBar', shape: 'circle', color: col, text: String(k + 1) }));
    }
    markers.sort((x, y) => x.time - y.time);
    this.markers.setMarkers(markers);
  }

  destroy() { this.mq.removeEventListener('change', this.onTheme); this.mo.disconnect(); this.chart.remove(); }
}
