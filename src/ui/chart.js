// Stock chart: candles/bars, moving averages, RS line, volume, RSI, MACD, every detected base pattern
// (one colour per pattern type) and the user's own drawings. Built on lightweight-charts v5.
import { SELL_LABEL } from '../core/sells.js';
import { createChart, CandlestickSeries, BarSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle, CrosshairMode, PriceScaleMode } from 'lightweight-charts';
import { calc, weekly, rsNewHigh, valueAt } from '../core/indicators.js';
import { smoothLine } from '../core/earnings.js';
import { lineVal, cupPivot, fD, f2, pc, fmtVol } from '../core/analysis.js';
import { tok } from './dom.js';

export const PAT_LABEL = { cwh: 'Cup with handle', cup: 'Cup without handle', dbl: 'Double bottom', flat: 'Flat base', asc: 'Ascending base', htf: 'High tight flag', '3wt': 'Three weeks tight', desc: 'Descending base' };
export const PAT_SHORT = { cwh: 'Cup w/ handle', cup: 'Cup', dbl: 'Double bottom', flat: 'Flat base', asc: 'Ascending', htf: 'High tight flag', '3wt': '3 wks tight', desc: 'Descending' };
export const patColor = t => tok('--p-' + t) || tok('--orange');
export const CMP_COLORS = ['--cmp1', '--cmp2', '--cmp3'];
const STATE_COLOR = { up: '--ok', press: '--warn', corr: '--bad' };
/** A theme colour with transparency (tokens are #rrggbb). */
export const fade = (c, a) => /^#[0-9a-f]{6}$/i.test(c) ? c + Math.round(a * 255).toString(16).padStart(2, '0') : c;

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
    // label inside the volume pane: the bar's volume against the average
    this.volEl = document.createElement('div'); this.volEl.className = 'vol-legend'; (el.parentElement || el).appendChild(this.volEl);
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
      leftPriceScale: { visible: false, borderVisible: false, minimumWidth: 44, scaleMargins: { top: 0.2, bottom: 0.32 } },
      timeScale: { borderVisible: false, rightOffset: 4 }, crosshair: { mode: CrosshairMode.Normal },
      layout: { attributionLogo: true, panes: { enableResize: true } },
    });
    const L = (o, pane = 0) => c.addSeries(LineSeries, Object.assign({ lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, o), pane);
    this.style = this.style || 'candles';
    this.ps = c.addSeries(this.style === 'bars' ? BarSeries : CandlestickSeries, { priceLineVisible: true, thinBars: false }, 0);
    this.markers = createSeriesMarkers(this.ps, []);
    this.ln = { l1: L({ lineWidth: 1 }), l2: L({ lineWidth: 1 }), l3: L({ lineWidth: 1.5 }), l4: L({ lineWidth: 1.5 }), bbu: L({ lineStyle: LineStyle.Dotted, lineWidth: 1 }), bbl: L({ lineStyle: LineStyle.Dotted, lineWidth: 1 }) };
    this.rsS = L({ priceScaleId: 'rs', lineWidth: 1.25 });
    c.priceScale('rs').applyOptions({ scaleMargins: { top: 0.82, bottom: 0.02 }, visible: false });
    this.rsMarkers = createSeriesMarkers(this.rsS, []);
    // EPS line on the left axis, with a dot at every report
    this.epsS = L({ priceScaleId: 'left', lineWidth: 2, lastValueVisible: true, title: 'EPS' });
    this.epsMarkers = createSeriesMarkers(this.epsS, []);
    // market-status ribbon at the bottom of the price pane (index charts only)
    this.ribbon = c.addSeries(HistogramSeries, { priceScaleId: 'ribbon', lastValueVisible: false, priceLineVisible: false, base: 0 }, 0);
    c.priceScale('ribbon').applyOptions({ scaleMargins: { top: 0.975, bottom: 0 }, visible: false });
    this.cmpS = [];
    c.timeScale().subscribeVisibleLogicalRangeChange(() => { this.applyMarkers(); if (this.cmpS.length && !this.rebasePending) { this.rebasePending = true; requestAnimationFrame(() => { this.rebasePending = false; this.rebase(); this.legend(this.lastT ?? null); }); } });
    const volFmt = { type: 'custom', formatter: fmtVol, minMove: 1 };
    this.volS = c.addSeries(HistogramSeries, { priceFormat: volFmt, lastValueVisible: true, priceLineVisible: false }, 1);
    this.vAvgS = L({ priceFormat: volFmt, lineWidth: 2, lastValueVisible: true, title: 'avg' }, 1);
    c.priceScale('right', 1).applyOptions({ scaleMargins: { top: 0.22, bottom: 0 } });
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
    ps[0].setStretchFactor(1); ps[1].setStretchFactor(0.3); ps.slice(2).forEach(p => p.setStretchFactor(0.2));
    c.subscribeCrosshairMove(p => { this.lastT = p && p.time != null ? p.time : null; this.legend(this.lastT); });
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
    // supporting lines are partly transparent so price, patterns and buy points stay in front
    this.ln.l1.applyOptions({ color: fade(tok('--ma1'), 0.6) }); this.ln.l2.applyOptions({ color: fade(tok('--ma2'), 0.65) });
    this.ln.l3.applyOptions({ color: fade(tok('--ma3'), 0.8) }); this.ln.l4.applyOptions({ color: fade(tok('--ma4'), 0.6) });
    this.ln.bbu.applyOptions({ color: fade(tok('--ma1'), 0.7) }); this.ln.bbl.applyOptions({ color: fade(tok('--ma1'), 0.7) });
    this.rsS.applyOptions({ color: fade(tok('--rs'), 0.75) }); this.vAvgS.applyOptions({ color: tok('--vavg') || tok('--orange') });
    if (this.rsiS) { this.rsiS.applyOptions({ color: tok('--blue') }); [this.r70, this.r30].forEach(p => p.applyOptions({ color: ink })); }
    if (this.mS) { this.mS.applyOptions({ color: tok('--ma3') }); this.sS.applyOptions({ color: tok('--orange') }); }
    this.epsS.applyOptions({ color: tok('--eps') });
    this.cmpS.forEach((x, i) => x.s.applyOptions({ color: fade(tok(CMP_COLORS[i % 3]), 0.85) }));
  }

  setRange(r) { try { this.chart.timeScale().setVisibleLogicalRange(r); } catch (e) { /* not ready */ } requestAnimationFrame(() => { try { this.chart.timeScale().setVisibleLogicalRange(r); } catch (e) { /* ignore */ } }); }

  /** Zoom to daily index range [i, j]. */
  zoomDaily(i, j) {
    const S = this.S; if (!S) return;
    const a = this.idxAt(S.daily[Math.max(0, i)].time), b = this.idxAt(S.daily[Math.min(S.daily.length - 1, j)].time);
    this.setRange({ from: Math.max(0, a - (S.tf === 'D' ? 15 : 4)), to: b + (S.tf === 'D' ? 15 : 4) });
  }
  fit() { if (this.bars) this.setRange({ from: 0, to: this.bars.length + 6 }); }
  /** Shows the last `months` months (0 = everything). */
  span(months) {
    const b = this.bars; if (!b || !b.length) return;
    if (!months) return this.fit();
    const from = this.idxAt(b[b.length - 1].time - months * 30.44 * 86400);
    this.setRange({ from, to: b.length - 1 + Math.max(3, Math.round((b.length - from) * 0.03)) });
  }

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
    // MarketSurge look: blue up bars and magenta down bars, as in O'Neil's charts
    const up = S.ms ? '#1565d8' : tok('--up'), dn = S.ms ? '#d6188f' : tok('--down'), col = i => b[i].close >= b[i].open ? up : dn;
    this.ps.setData(withF(b.map((x, i) => { const c = col(i); return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close, color: c, borderColor: c, wickColor: c }; })));
    this.ps.applyOptions({ priceFormat: { type: 'price', precision: S.cur === 'KRW' || S.cur === 'JPY' ? 0 : 2, minMove: S.cur === 'KRW' || S.cur === 'JPY' ? 1 : 0.01 } });
    // MarketSurge style: bars with volume at least 40% above the average stand out, quiet days are pale
    const vRef = i => K.vavg[i - 1] || K.vavg[i];
    this.volS.setData(withF(b.map((x, i) => { const r = vRef(i) ? x.volume / vRef(i) : 1; return { time: x.time, value: x.volume, color: col(i) + (r >= 1.4 ? 'FF' : r < 0.6 ? '55' : '90') }; })));
    this.vAvgS.setData(ser(K.vavg));
    ['l1', 'l2', 'l3', 'l4'].forEach(k => { this.ln[k].setData(ser(K[k])); this.ln[k].applyOptions({ visible: !!S.lines[k] }); });
    this.ln.bbu.setData(ser(K.bbu)); this.ln.bbl.setData(ser(K.bbl)); [this.ln.bbu, this.ln.bbl].forEach(s => s.applyOptions({ visible: !!S.lines.bb }));
    this.rsS.setData(ser(K.rs)); this.rsS.applyOptions({ visible: !!S.lines.rs });
    this.rsMarkers.setMarkers(rsNewHigh(K.rs, S.tf === 'D' ? 252 : 52) ? [{ time: last, position: 'inBar', shape: 'circle', color: tok('--rs'), text: 'RS high' }] : []);
    // logarithmic price scale (the book's choice): equal distances are equal percentage moves, so long histories stay readable
    this.chart.priceScale('right').applyOptions({ mode: S.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    this.drawEps(S);
    this.drawCompare(S);
    this.ribbon.setData(S.mkt && S.tf === 'D' ? b.map((x, i) => S.mkt.states[i] ? { time: x.time, value: 1, color: tok(STATE_COLOR[S.mkt.states[i]]) + 'CC' } : { time: x.time }) : []);
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
    const av = K.vavg[i - 1] || K.vavg[i];
    const narrow = this.el.clientWidth < 560;
    let h = narrow
      ? `<span>${fD(x.time)}</span><span>C <b class="${cl}">${f2(x.close)}</b> <span class="${cl}">${pc(ch, 2)}</span></span><span>Vol <b>${fmtVol(x.volume)}</b></span>`
      : `<span><b>${S.sym}</b> ${S.tf === 'D' ? 'daily' : 'weekly'} · ${fD(x.time)}</span><span>O <b>${f2(x.open)}</b></span><span>H <b>${f2(x.high)}</b></span><span>L <b>${f2(x.low)}</b></span><span>C <b class="${cl}">${f2(x.close)}</b></span><span class="${cl}">${pc(ch, 2)}</span><span>Vol <b>${fmtVol(x.volume)}</b>${av ? ' (' + pc(x.volume / av - 1, 0) + ')' : ''}</span>`;
    if (this.rsiS) h += `<span>RSI <b>${f2(K.rsi[i])}</b></span>`;
    if (S.eps && this.epsPts && this.epsPts.length) {
      const t0 = S.tf === 'D' ? x.time : (x.last || x.time); let pt = null;
      for (const p of this.epsPts) if (p.time <= t0) pt = p;
      if (pt && S.eps) h += `<span style="color:var(--eps)">EPS ${pt.annual ? '(year)' : S.eps.mode === 'ttm' ? '(12 m)' : '(period)'} <b style="color:var(--eps)">${f2(pt.value)}</b>${pt.yoy != null ? ' ' + pc(pt.yoy, 0) + ' y/y' : ''}${narrow ? '' : ' · ' + fD(pt.time)}</span>`;
    }
    if (this.cmpPerf) this.cmpPerf.forEach(c => { h += `<span style="color:${c.color}">${narrow ? c.name.slice(0, 14) : c.name} <b style="color:${c.color}">${pc(c.idx, 1)}</b> vs ${narrow ? 'stock' : S.sym} ${pc(c.stock, 1)}</span>`; });
    this.legendEl.innerHTML = h;
    this.volLegend(i, av);
  }

  /** The label at the top of the volume pane: volume, the average and how far above or below it the bar is. */
  volLegend(i, av) {
    const x = this.bars[i], el = this.volEl; if (!el) return;
    const panes = this.chart.panes(); if (panes.length < 2 || !x.volume) { el.hidden = true; return; }
    el.hidden = false; el.style.top = (panes[0].getHeight() + 4) + 'px';
    const W = this.S.tf === 'W', r = av ? x.volume / av - 1 : null, live = this.S.volLive && i === this.bars.length - 1 ? this.S.volLive : null;
    const cls = r == null ? '' : r >= 0.4 ? (x.close >= x.open ? 'up' : 'down') : r < -0.4 ? 'muted' : '';
    el.innerHTML = `<span>${W ? 'Week' : 'Volume'} <b>${fmtVol(x.volume)}</b></span>${r == null ? '' : `<span class="${cls}">${pc(r, 0)} vs avg</span>`}<span style="color:var(--vavg)">${W ? '10-week' : '50-day'} avg <b style="color:var(--vavg)">${fmtVol(av)}</b></span>`
      + (live && live.pace ? `<span>full day ≈ <b>${fmtVol(live.pace)}</b> (${pc(live.pacePct, 0)}, estimate)</span>` : '');
  }

  /** EPS line: smooth curve through each report's EPS, dots coloured by year-over-year growth. */
  drawEps(S) {
    const pts = S.eps && S.eps.points && S.eps.points.length >= 2 ? S.eps.points : null;
    this.epsPts = pts;
    // on narrow screens the EPS axis would squeeze the chart: keep the line, read the value in the legend
    const narrow = this.el.clientWidth < 560;
    this.epsS.applyOptions({ priceScaleId: narrow ? 'eps' : 'left' });
    if (narrow) this.chart.priceScale('eps').applyOptions({ visible: false, scaleMargins: { top: 0.22, bottom: 0.32 } });
    this.chart.applyOptions({ leftPriceScale: { visible: !!pts && !narrow } });
    if (!pts) { this.epsS.setData([]); this.epsMarkers.setMarkers([]); return; }
    const times = this.bars.map(x => S.tf === 'D' ? x.time : (x.last || x.time));
    const line = smoothLine(pts, times); // values at bar times
    // weekly bars are keyed by their first day: map back
    const byT = new Map(this.bars.map(x => [S.tf === 'D' ? x.time : (x.last || x.time), x.time]));
    this.epsS.setData(line.map(p => ({ time: byT.get(p.time), value: p.value })).filter(p => p.time != null));
    const first = this.bars[0].time, last = this.bars[this.bars.length - 1].time;
    this.epsDot = pts.length > 40 ? 0.2 : pts.length > 20 ? 0.35 : 0.55; // many quarters on screen: smaller dots
    this.epsMarkers.setMarkers(pts.filter(p => p.time >= first && p.time <= (S.tf === 'D' ? last : last + 7 * 86400)).map(p => ({
      time: this.snapT(p.time), position: 'inBar', shape: 'circle', size: this.epsDot,
      color: p.yoy == null ? tok('--eps') : p.yoy >= 0.2 ? tok('--up') : p.yoy >= 0 ? tok('--warn') : tok('--down'),
    })).sort((a, b) => a.time - b.time));
  }

  /** Index or sector lines, rebased to the stock's price at the first visible bar so performance compares directly. */
  drawCompare(S) {
    this.cmpS.forEach(x => { try { this.chart.removeSeries(x.s); } catch (e) { /* gone */ } });
    this.cmpS = (S.compare || []).filter(c => c.bars && c.bars.length > 20).map((c, i) => ({
      ...c, color: tok(CMP_COLORS[i % 3]),
      s: this.chart.addSeries(LineSeries, { color: fade(tok(CMP_COLORS[i % 3]), 0.85), lineWidth: 2, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, title: c.short || '' }, 0),
    }));
    this.cmpPerf = null;
    if (this.cmpS.length) requestAnimationFrame(() => { this.rebase(); this.legend(null); });
  }
  rebase() {
    if (!this.cmpS.length || !this.bars) return;
    const b = this.bars, r = this.chart.timeScale().getVisibleLogicalRange();
    const i0 = Math.max(0, Math.min(b.length - 1, Math.ceil(r ? r.from : 0))), i1 = Math.max(i0, Math.min(b.length - 1, Math.floor(r ? r.to : b.length - 1)));
    const tAt = x => this.S.tf === 'D' ? x.time : (x.last || x.time);
    this.cmpPerf = [];
    for (const c of this.cmpS) {
      // start at the first visible bar, or at the index's first day when the view starts before its data
      let j0 = i0; while (j0 < i1 && tAt(b[j0]) < c.bars[0].time) j0++;
      const v0 = valueAt(c.bars, tAt(b[j0])); if (!v0) { c.s.setData([]); continue; }
      const k = b[j0].close / v0;
      c.s.setData(b.map(x => { const v = valueAt(c.bars, tAt(x)); return v == null || x.time < c.bars[0].time ? { time: x.time } : { time: x.time, value: v * k }; }));
      const v1 = valueAt(c.bars, tAt(b[i1]));
      this.cmpPerf.push({ name: c.short || c.name, color: c.color, idx: v1 / v0 - 1, stock: b[i1].close / b[j0].close - 1 });
    }
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
    this.boLevels = false; // an open breakout already shows its sell line and targets
    this.drawn.forEach(o => { try { o.s ? this.chart.removeSeries(o.s) : this.ps.removePriceLine(o.p); } catch (e) { /* gone */ } });
    this.drawn = [];
    const S = this.S, d = S.daily, markers = [], piv = tok('--pivot'), bad = tok('--bad');
    const T = i => d[Math.min(i, d.length - 1)].time;
    const futureT = this.future[Math.min(S.tf === 'D' ? 12 : 5, this.future.length - 1)];
    for (const { p, kind } of patternsToShow(S.R, d, S.patMode)) {
      const hist = kind === 'hist', color = hist ? fade(patColor(p.type), 0.5) : patColor(p.type), e = p.e != null ? p.e : d.length - 1;
      const style = { color, lineWidth: hist ? 1.25 : 2.5, lineStyle: kind === 'alt' ? LineStyle.Dotted : hist && (p.failed || p.stopped) ? LineStyle.Dashed : LineStyle.Solid };
      if (p.box) { const [a, z, top, bot] = p.box; this.addLine([[T(a), top], [T(z), top]], style); this.addLine([[T(a), bot], [T(z), bot]], style); }
      if ((p.type === 'cwh' || p.type === 'cup') && p.m != null && p.R_i != null) {
        this.addLine(this.uCurve([[T(p.a), p.H], [T(p.m), p.L], [T(p.R_i), p.R]]), style);
        if (p.type === 'cwh') this.addLine([[T(p.R_i), p.R], [T(p.hl), p.HL], [T(e), d[Math.min(e, d.length - 1)].close]], style);
      } else if (p.pts && p.pts.length > 1) this.addLine(p.pts.map(([i, v]) => [T(i), v]), style);
      if (p.pivot) {
        const endT = kind === 'cur' || kind === 'alt' ? futureT : T(Math.min(p.bo != null ? p.bo + 3 : e, d.length - 1));
        this.addLine([[T(p.pivotIdx), p.pivot], [endT, p.pivot]], { color: hist ? fade(piv, 0.45) : piv, lineWidth: hist ? 1 : 1.5, lineStyle: hist ? LineStyle.Dotted : LineStyle.Dashed });
      }
      if ((kind === 'cur' || kind === 'bo') && p.pivot) {
        this.addPL({ price: p.pivot, color: piv, lineStyle: LineStyle.Dashed, title: 'Buy point' });
        this.addPL({ price: p.pivot * 1.05, color: piv, lineStyle: LineStyle.Dotted, title: '+5%' });
        if (kind === 'bo') {
          const so = (S.sells || []).find(x => x.h === p);
          if (so && so.open) { // the position from this breakout is still open: its current sell line and targets
            this.boLevels = true;
            this.addPL({ price: so.open.line, color: bad, lineStyle: LineStyle.Dotted, title: so.open.line >= p.pivot ? 'Sell line (breakeven)' : so.open.line > p.pivot * 0.95 ? 'Sell line (raised)' : 'Sell line −8%' });
            this.addPL({ price: so.open.t20, color: tok('--up'), lineStyle: LineStyle.Dotted, title: '+20% target' });
            this.addPL({ price: so.open.t25, color: tok('--up'), lineStyle: LineStyle.Dotted, title: '+25%' });
          } else if (!so) this.addPL({ price: p.pivot * 0.92, color: bad, lineStyle: LineStyle.Dotted, title: '−8% stop' });
        }
      }
      const lbl = hist ? PAT_SHORT[p.type] + (p.faulty ? ' (faulty)' : '') + ' ' + outcome(p)
        : `${p.name}${p.weeks ? ' · ' + Math.round(p.weeks) + ' wk' : ''}${p.depth != null ? ' · −' + Math.round(p.depth * 100) + '%' : ''}`;
      markers.push({ minor: hist, time: this.snapT(T(p.a)), position: 'aboveBar', shape: 'arrowDown', color, text: lbl, size: hist ? 0.6 : 1 });
      if (p.bo != null) markers.push({ minor: hist, time: this.snapT(T(p.bo)), position: 'belowBar', shape: 'arrowUp', color: p.failed ? bad : p.volRatio >= 1.5 ? tok('--up') : tok('--muted'), text: p.failed ? 'failed' : 'BO' });
    }
    // market index: distribution days and follow-through days
    if (S.mkt) {
      S.mkt.ddAll.forEach(i => { if (S.mkt.dd.includes(i) || S.tf === 'D') markers.push({ time: this.snapT(d[i].time), position: 'aboveBar', shape: 'circle', color: S.mkt.dd.includes(i) ? tok('--down') : tok('--down') + '80', text: S.mkt.dd.includes(i) ? 'D' : '', size: S.mkt.dd.includes(i) ? 1 : 0.6 }); });
      S.mkt.ftds.forEach(i => markers.push({ time: this.snapT(d[i].time), position: 'belowBar', shape: 'arrowUp', color: tok('--up'), text: 'FTD' }));
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
      } else if (dr.type === 'bp') {
        this.addPL({ price: dr.p1, color: col, lineWidth: 2, title: 'Your buy point' });
        this.addPL({ price: dr.p1 * 1.05, color: col, lineStyle: LineStyle.Dotted, title: '+5% zone top' });
        markers.push({ time: this.snapT(dr.t1), position: 'aboveBar', shape: 'arrowDown', color: col, text: 'Buy point ' + (Math.round(dr.p1 * 100) / 100) });
      } else if (dr.type === 'note') markers.push({ time: this.snapT(dr.t1), position: 'aboveBar', shape: 'arrowDown', color: col, text: dr.label || 'Note' });
    }
    // sell signals by the book's rules for the breakouts on the chart
    const shown = new Set(patternsToShow(S.R, d, S.patMode).map(x => x.p));
    for (const x of S.sells || []) {
      if (!x.sell || !shown.has(x.h) || x.sell.i >= d.length) continue;
      const tm = this.snapT(d[x.sell.i].time), txt = SELL_LABEL[x.sell.code] + ' ' + (x.sell.ret >= 0 ? '+' : '') + Math.round(x.sell.ret * 100) + '%';
      const same = markers.find(m => m.sell && m.time === tm); // two breakouts selling on the same day: one marker
      if (same) { if (!same.text.includes(SELL_LABEL[x.sell.code])) same.text += ' / ' + txt; else same.text += ' / ' + txt.split(' ').pop(); }
      else markers.push({ sell: true, minor: true, time: tm, position: 'aboveBar', shape: 'arrowDown', color: x.sell.ret >= 0 ? tok('--orange') : bad, text: 'Sell: ' + txt });
    }
    // automatic trade plan (Leaderboard-style): levels for the current base when no plan is open yet
    if (S.autoPlan && !S.plan) {
      const a = S.autoPlan, blue = tok('--blue');
      if (!this.boLevels) this.addPL({ price: a.stop, color: bad, lineStyle: LineStyle.Dashed, title: `Stop −${Math.round(a.stopPct * 100)}%` });
      if (a.add2) this.addPL({ price: a.add2, color: blue, lineStyle: LineStyle.Dotted, title: 'Add 2' });
      if (a.add3) this.addPL({ price: a.add3, color: blue, lineStyle: LineStyle.Dotted, title: 'Add 3' });
      if (!this.boLevels && a.t20) {
        this.addPL({ price: a.t20, color: tok('--up'), lineStyle: LineStyle.Dotted, title: 'Sell ⅓ +20%' });
        this.addPL({ price: a.t25, color: tok('--up'), lineStyle: LineStyle.Dotted, title: 'Sell ⅓ +25%' });
      }
    }
    // buying plan levels and the trades in the journal
    if (S.plan) {
      const pl = S.plan, blue = tok('--blue');
      if (pl.done < 2 && pl.add2) this.addPL({ price: pl.add2, color: blue, lineStyle: LineStyle.Dotted, title: 'Add 2' });
      if (pl.done < 3 && pl.add3) this.addPL({ price: pl.add3, color: blue, lineStyle: LineStyle.Dotted, title: 'Add 3' });
      this.addPL({ price: pl.stop, color: bad, lineStyle: LineStyle.Dashed, title: 'Plan stop' });
    }
    for (const t of S.trades || []) {
      if (t.t < b[0].time) continue;
      markers.push({ time: this.snapT(t.t), position: t.side === 'buy' ? 'belowBar' : 'aboveBar', shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown', color: t.side === 'buy' ? tok('--blue') : tok('--orange'), text: (t.side === 'buy' ? 'B' + (t.step && t.step <= 3 ? t.step : '+') : 'S') + ' ' + t.shares });
    }
    if (S.pending) markers.push({ time: this.snapT(S.pending.t), position: 'inBar', shape: 'circle', color: col, text: '1' });
    if (S.poly && S.poly.length) {
      if (S.poly.length >= 3) { this.addLine(this.uCurve(S.poly.slice(0, 3)), { color: col, lineStyle: LineStyle.Dashed }); if (S.poly.length > 3) this.addLine(S.poly.slice(2), { color: col, lineStyle: LineStyle.Dashed }); }
      else this.addLine(S.poly, { color: col, lineStyle: LineStyle.Dashed });
      S.poly.forEach((q, k) => markers.push({ time: this.snapT(q[0]), position: 'inBar', shape: 'circle', color: col, text: String(k + 1) }));
    }
    markers.sort((x, y) => x.time - y.time);
    this.allMarkers = markers; this.wideView = null; this.applyMarkers();
  }

  /** Zoomed far out (400+ bars on screen): past patterns and sell signals keep their arrows but drop their text. */
  applyMarkers() {
    if (!this.allMarkers) return;
    const r = this.chart.timeScale().getVisibleLogicalRange(), wide = !!r && r.to - r.from > 400;
    if (wide === this.wideView) return;
    this.wideView = wide;
    this.markers.setMarkers(this.allMarkers.map(({ minor, sell, ...m }) => wide && minor ? { ...m, text: '' } : m));
  }

  destroy() { this.mq.removeEventListener('change', this.onTheme); this.mo.disconnect(); this.chart.remove(); }
}
