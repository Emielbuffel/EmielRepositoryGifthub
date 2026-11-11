// Thin wrapper around Chart.js (bundled locally) with theme-aware colours.
import { money0, money } from './util.js';

const instances = new Map();

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function seriesColor(i) {
  return css(`--series-${i}`);
}

export function destroyCharts() {
  for (const c of instances.values()) c.destroy();
  instances.clear();
}

function baseOptions({ stacked = false, horizontal = false, legend = true, moneyAxis = true } = {}) {
  const grid = css('--grid');
  const muted = css('--text-muted');
  const valueAxis = {
    stacked,
    grid: { color: grid, drawTicks: false },
    border: { display: false },
    ticks: { color: muted, padding: 6, callback: moneyAxis ? (v) => money0(v) : undefined, maxTicksLimit: 6 },
    beginAtZero: true,
  };
  const catAxis = { stacked, grid: { display: false }, border: { color: css('--axis') }, ticks: { color: muted, autoSkip: true, maxRotation: 0 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: horizontal ? 'nearest' : 'index', intersect: false },
    scales: horizontal ? { x: valueAxis, y: { ...catAxis, ticks: { ...catAxis.ticks, autoSkip: false } } } : { x: catAxis, y: valueAxis },
    plugins: {
      legend: {
        display: legend,
        position: 'top',
        align: 'start',
        labels: { color: css('--text-secondary'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: css('--tooltip-bg'),
        titleColor: css('--text-primary'),
        bodyColor: css('--text-secondary'),
        borderColor: css('--border'),
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(ctx.parsed[horizontal ? 'x' : 'y'])}` },
      },
    },
  };
}

function make(canvas, config) {
  if (!canvas || !window.Chart) return null;
  const old = instances.get(canvas.id);
  if (old) old.destroy();
  const chart = new window.Chart(canvas, config);
  instances.set(canvas.id, chart);
  return chart;
}

const BAR = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, categoryPercentage: 0.7, barPercentage: 0.9 };

/** Grouped bars: income vs expenses per month. */
export function incomeExpenseChart(canvas, labels, income, expenses) {
  return make(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income', data: income, backgroundColor: css('--income'), ...BAR },
        { label: 'Expenses', data: expenses, backgroundColor: css('--expense'), ...BAR },
      ],
    },
    options: baseOptions(),
  });
}

/** Net saved per month, positive blue / negative red (diverging). */
export function netChart(canvas, labels, net, rates) {
  const pos = css('--pos');
  const neg = css('--neg');
  const opts = baseOptions({ legend: false });
  opts.plugins.tooltip.callbacks.label = (ctx) => ` Saved: ${money(ctx.parsed.y)}${isFinite(rates[ctx.dataIndex]) ? `  (${(rates[ctx.dataIndex] * 100).toFixed(0)}% of income)` : ''}`;
  return make(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Saved', data: net, backgroundColor: net.map((v) => (v >= 0 ? pos : neg)), ...BAR, borderSkipped: false }] },
    options: opts,
  });
}

/** Horizontal bars for spending by category (one hue – magnitude). */
export function categoryBars(canvas, labels, values) {
  const opts = baseOptions({ horizontal: true, legend: false });
  opts.plugins.tooltip.callbacks.label = (ctx) => ` ${money(ctx.parsed.x)}`;
  return make(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: css('--expense'), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 }] },
    options: opts,
  });
}

/** Stacked bars: income sources. */
export function incomeSourcesChart(canvas, labels, sets) {
  const opts = baseOptions({ stacked: true });
  return make(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: sets.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: seriesColor(i + 1), ...BAR, borderSkipped: false, borderColor: css('--surface'), borderWidth: { top: 2 } })),
    },
    options: opts,
  });
}

export function lineChart(canvas, labels, sets, { legend = true, fill = false } = {}) {
  const opts = baseOptions({ legend });
  opts.scales.y.beginAtZero = false;
  return make(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: sets.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.fill ? s.color + '22' : s.color,
        fill: s.fill ? 'origin' : fill,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 12,
        tension: 0.25,
        spanGaps: true,
        borderDash: s.dash || [],
      })),
    },
    options: opts,
  });
}
