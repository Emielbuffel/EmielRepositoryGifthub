// Intraday views from the free Yahoo Finance chart feed (desktop app): small "today" charts for the market
// indexes and a 1-day / 5-day intraday chart for a stock. Refreshed every minute while visible.
import { createChart, AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, LineStyle } from 'lightweight-charts';
import { yahooIntraday, MARKET } from '../data/providers.js';
import { isApp } from '../data/net.js';
import { $, $$, html, render, tok } from './dom.js';
import { fade } from './chart.js';

const pct = x => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(2) + '%');
const n2 = (x, d = 2) => (x == null ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const hhmm = t => new Date(t * 1000).toISOString().slice(11, 16); // times are already in exchange-local seconds

function base(el, { mini }) {
  return createChart(el, {
    autoSize: true, layout: { background: { type: 'solid', color: tok('--bg2') }, textColor: tok('--muted'), fontFamily: tok('--mono'), fontSize: 10, attributionLogo: !mini },
    grid: { vertLines: { visible: false }, horzLines: { color: tok('--grid') } }, rightPriceScale: { borderVisible: false, visible: !mini }, leftPriceScale: { visible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, visible: true }, handleScroll: !mini, handleScale: !mini,
    crosshair: { horzLine: { visible: !mini, labelVisible: !mini } },
  });
}

/** Draws intraday data D into el. mini: a line for the market grid; otherwise candles, volume and VWAP. */
export function drawIntraday(el, D, { mini = false, daily = false } = {}) {
  const chart = base(el, { mini });
  const last = D.bars.length ? D.bars[D.bars.length - 1].close : D.price, up = D.prevClose == null || last >= D.prevClose;
  const col = up ? tok('--up') : tok('--down');
  let main;
  if (mini) {
    main = chart.addSeries(AreaSeries, { lineColor: col, topColor: fade(col, 0.22), bottomColor: fade(col, 0), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true });
    main.setData(D.bars.map(b => ({ time: b.time, value: b.close })));
  } else {
    const upC = tok('--up'), dnC = tok('--down');
    main = chart.addSeries(CandlestickSeries, { priceLineVisible: true });
    main.setData(D.bars.map(b => { const c = b.close >= b.open ? upC : dnC; return { ...b, color: c, borderColor: c, wickColor: c }; }));
    if (D.bars.some(b => b.volume)) {
      const v = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      v.setData(D.bars.map(b => ({ time: b.time, value: b.volume, color: (b.close >= b.open ? upC : dnC) + '80' })));
      if (!daily) {
      // VWAP per session: the average price weighted by volume, a common intraday reference
      let pv = 0, vv = 0, day = null; const vw = [];
      for (const b of D.bars) { const d = Math.floor(b.time / 86400); if (d !== day) { day = d; pv = 0; vv = 0; } pv += (b.high + b.low + b.close) / 3 * b.volume; vv += b.volume; if (vv) vw.push({ time: b.time, value: pv / vv }); }
      chart.addSeries(LineSeries, { color: tok('--purple'), lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'VWAP' }).setData(vw);
      }
    }
  }
  if (D.prevClose != null) main.createPriceLine({ price: D.prevClose, color: tok('--muted'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: !mini, title: mini ? '' : 'prev. close' });
  if (daily) chart.applyOptions({ timeScale: { timeVisible: false } });
  chart.timeScale().fitContent();
  return chart;
}

/* ---------- Market tab: today's move of every index ---------- */
const MI = { charts: [], timer: null, range: '1d' };
export function marketIntraday() {
  const el = $('#mIntra'); if (!el) return;
  if (!isApp()) { render(el, html`<div class="card-head"><h2>Today · intraday</h2></div><p class="muted small" style="margin:0">Intraday prices come from Yahoo Finance's free chart feed in the desktop app (browsers block it). Free, no account needed.</p>`); return; }
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    render(el, html`<div class="card-head"><h2>Today · intraday</h2><div class="toolbar"><div class="seg" id="iRange"><button data-r="1d" class="on">1 day</button><button data-r="5d">5 days</button></div><span class="muted tiny" id="iUpd"></span></div></div>
      <div class="intra-grid" id="iGrid">${MARKET.map(m => html`<div class="intra" data-k="${m.k}"><div class="row"><b>${m.name}</b><span class="small" data-ch="${m.k}">…</span></div><div class="intra-chart" data-c="${m.k}"></div><div class="muted tiny" data-st="${m.k}"></div></div>`)}</div>
      <p class="muted tiny" style="margin:0">Yahoo Finance, free. Dashed line = previous close. Quotes can be delayed (often about 15–20 minutes outside the US). Refreshes every minute while this tab is open.</p>`);
    $$('#iRange [data-r]', el).forEach(b => { b.onclick = () => { MI.range = b.dataset.r; $$('#iRange [data-r]', el).forEach(x => x.classList.toggle('on', x === b)); refresh(); }; });
  }
  refresh();
  clearInterval(MI.timer);
  MI.timer = setInterval(() => { if (document.visibilityState === 'visible' && $('#mIntra') && $('#mIntra').offsetParent) refresh(); }, 60000);
}
async function refresh() {
  const el = $('#mIntra'); if (!el) return;
  MI.charts.forEach(c => { try { c.remove(); } catch (e) { /* gone */ } }); MI.charts = [];
  await Promise.all(MARKET.map(async m => {
    const box = el.querySelector(`[data-c="${m.k}"]`), ch = el.querySelector(`[data-ch="${m.k}"]`), st = el.querySelector(`[data-st="${m.k}"]`);
    try {
      const D = await yahooIntraday('^' + m.k, MI.range === '1d' ? { range: '1d', interval: '5m' } : { range: '5d', interval: '15m' });
      box.innerHTML = ''; MI.charts.push(drawIntraday(box, D, { mini: true }));
      const last = D.price ?? D.bars[D.bars.length - 1].close, r = D.prevClose ? last / D.prevClose - 1 : null;
      ch.className = 'small ' + (r >= 0 ? 'up' : 'down'); ch.textContent = `${n2(last)} ${pct(r)}`;
      st.textContent = `${D.open ? 'Open' : 'Closed'} · last ${D.at ? hhmm(D.at + D.off) : '—'} local time${MI.range === '5d' ? ' · % vs previous close' : ''}`;
    } catch (e) { ch.textContent = ''; st.textContent = e.message; box.innerHTML = ''; }
  }));
  const u = $('#iUpd'); if (u) u.textContent = 'updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
