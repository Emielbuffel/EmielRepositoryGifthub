// The Learn tab: every base pattern with a diagram, its rules and a live example, plus the O'Neil method.
import { openStock } from '../app.js';
import { snapshotMeta } from '../data/providers.js';
import { isDemo } from '../data/service.js';
import { $$, html, raw, render } from './dom.js';
import { patColor } from './chart.js';

// Stylised shapes in a 300×130 box: [x, y] points (y down). piv = buy point height; a = annotation spots.
const SHAPES = {
  cwh: { pts: [[10, 112], [40, 70], [62, 22], [90, 60], [120, 92], [150, 96], [180, 88], [215, 52], [238, 28], [252, 44], [268, 40], [278, 32]], piv: 28, lab: [[62, 14, 'left-side high'], [150, 110, 'rounded bottom'], [256, 58, 'handle']] },
  cup: { pts: [[10, 112], [40, 70], [62, 22], [90, 60], [120, 92], [150, 96], [180, 88], [215, 50], [250, 26], [272, 24]], piv: 22, lab: [[62, 14, 'left-side high'], [150, 110, 'U-shaped bottom']] },
  dbl: { pts: [[10, 112], [40, 66], [60, 24], [95, 80], [120, 100], [150, 56], [180, 88], [205, 106], [235, 64], [260, 44], [278, 50]], piv: 56, lab: [[120, 116, 'first low'], [205, 122, 'undercut'], [150, 46, 'middle peak']] },
  flat: { pts: [[10, 118], [50, 88], [90, 44], [110, 36], [130, 50], [150, 40], [170, 52], [190, 42], [215, 50], [240, 40], [265, 38]], piv: 36, lab: [[80, 100, 'prior advance'], [175, 70, '≤15% deep, 5+ weeks']] },
  asc: { pts: [[10, 118], [40, 90], [70, 66], [95, 90], [125, 48], [150, 72], [182, 32], [208, 56], [240, 18], [262, 38]], piv: 18, lab: [[95, 104, 'pullback 1'], [150, 86, 'pullback 2'], [208, 70, 'pullback 3']] },
  htf: { pts: [[10, 120], [40, 116], [70, 108], [100, 86], [130, 52], [160, 20], [180, 34], [200, 44], [222, 30], [244, 40], [266, 32]], piv: 20, lab: [[95, 60, 'pole: +100%'], [215, 62, 'flag ≤25%']] },
  '3wt': { pts: [[10, 118], [50, 96], [90, 70], [130, 48], [160, 34], [175, 38], [195, 36], [210, 39], [228, 37], [245, 38], [262, 36]], piv: 32, lab: [[205, 56, '3 weekly closes within 1.5%']] },
  desc: { pts: [[10, 22], [40, 50], [65, 36], [95, 70], [120, 56], [150, 92], [175, 78], [205, 108], [235, 96], [265, 116]], piv: null, lab: [[110, 24, 'lower highs'], [185, 124, 'lower lows']] },
};
function art(type) {
  const s = SHAPES[type], c = patColor(type);
  const path = s.pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(' ');
  return `<svg viewBox="0 0 300 130" role="img" aria-label="Diagram of a ${type} pattern">
    ${s.piv != null ? `<line x1="${s.pts[2][0]}" x2="296" y1="${s.piv}" y2="${s.piv}" stroke="var(--pivot)" stroke-width="1.6" stroke-dasharray="5 4"/><text x="296" y="${s.piv + 14}" text-anchor="end" font-size="10.5" fill="var(--pivot)" font-weight="600">buy point</text>` : `<text x="296" y="14" text-anchor="end" font-size="10.5" fill="var(--bad)" font-weight="600">no buy point</text>`}
    <path d="${path}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${s.lab.map(([x, y, t]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${t}</text>`).join('')}
  </svg>`;
}

const PATTERNS = [
  ['cwh', 'Cup with handle', 'ACME.DEMO', [['Length', '7–65 weeks (6 at the very least)'], ['Depth', '12–33% (up to ~50% in bear markets)'], ['Shape', 'Rounded U, not a V'], ['Handle', '1+ week, ≤10–12% deep, in the upper half, drifting down on light volume'], ['Buy point', 'Handle high + 10¢']], 'Wedging (rising) handles, handles in the lower half and handles shorter than a week are faulty.'],
  ['cup', 'Cup without handle', 'BOLT.DEMO', [['Length', '7+ weeks'], ['Depth', '12–33%'], ['Shape', 'Right side back within ~10% of the left-side high'], ['Buy point', 'Left-side high + 10¢']], 'Same cup, no handle. Volume should pick up as the right side climbs.'],
  ['dbl', 'Double bottom', 'CRUX.DEMO', [['Length', '7+ weeks'], ['Depth', 'Up to ~33%'], ['Shape', 'A “W”: the second low undercuts the first (a shakeout)'], ['Buy point', 'Middle peak of the W + 10¢']], 'The undercut shakes out weak holders before the advance.'],
  ['flat', 'Flat base', 'DUNE.DEMO', [['Length', '5+ weeks'], ['Depth', '≤15%'], ['Context', 'Usually forms after a breakout from a deeper base'], ['Buy point', 'Base high + 10¢']], 'A sign the stock is holding its gains while the market digests them.'],
  ['asc', 'Ascending base', 'ECHO.DEMO', [['Length', '9–16 weeks'], ['Shape', 'Three pullbacks of about 10–20%; each low and each high above the previous one'], ['Buy point', 'The highest peak + 10¢']], 'Often forms when the general market is pulling back.'],
  ['htf', 'High tight flag', 'FLUX.DEMO', [['Pole', 'The stock roughly doubles (+100–120%) in 4–8 weeks'], ['Flag', '3–5 weeks sideways, correcting no more than 25%'], ['Buy point', 'Flag high + 10¢']], 'Rare and powerful, but also volatile.'],
  ['3wt', 'Three weeks tight', 'GLOW.DEMO', [['Shape', 'Three weekly closes within about 1–1.5%'], ['Context', 'Near highs, above the 50-day line'], ['Buy point', 'Tight-area high + 10¢']], 'An add-on buy point inside an advance, not a new base.'],
  ['desc', 'Descending base', 'HAZE.DEMO', [['Shape', 'Lower highs and lower lows'], ['Context', 'Below the 50-day line'], ['Buy point', 'None']], 'O\'Neil treats this as faulty: wait until a proper base forms.'],
];

export function initLearn(el) {
  render(el, html`
    <section class="card">
      <h2>How this app reads a chart</h2>
      <div class="prose">
        <p>William O'Neil studied the biggest stock winners and found that most broke out of a few recurring <b>bases</b>: periods of sideways consolidation after an advance. The app's detector finds these bases in the daily prices, marks the <b>buy point</b> (the pivot, +10¢), and checks the rules O'Neil wrote down: length, depth, shape, volume, the prior uptrend and the base stage.</p>
        <p>On the chart, <b>every pattern has its own colour</b>. Solid lines are sound bases; dashed lines are failed breakouts or alternative readings. The strip under the chart lists every pattern found, newest first. Tap one to jump to it.</p>
        <p><b>EPS line:</b> the 4-quarter (trailing 12-month) earnings per share as a smooth line on the left axis, with a dot at each report: green when EPS rose 25%+ from a year earlier, orange when it rose less, red when it fell. Price running ahead of a flat EPS line is a warning; price and EPS rising together is what O'Neil looked for.</p>
        <p><b>Compare:</b> plot the stock against its home index (S&amp;P 500 or Nasdaq for US stocks, Nikkei 225 for Tokyo, DAX or Euro Stoxx 50 for Germany…), a world index or a US sector ETF. The lines start at the same point at the left edge of the chart, so you see who outperformed over the period on screen. The RS line can be measured against any of these indexes.</p>
      </div>
    </section>
    <div class="section-title" style="margin-top:4px">The eight bases</div>
    <div class="pat-grid">${PATTERNS.map(([t, name, demo, rules, note]) => html`
      <article class="pat-card" style="--pc:${patColor(t)}">
        <div class="art">${raw(art(t))}</div>
        <div class="body"><h3><i></i>${name}</h3>
          <dl>${rules.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
          <p class="muted small" style="margin:0">${note}</p>
          <div><button class="btn sm" data-demo="${demo}" data-type="${t}">See an example</button> <span class="muted tiny" data-ex="${t}"></span></div>
        </div>
      </article>`)}</div>
    <p class="muted tiny" style="margin:0">Examples are real stocks from the built-in data where the detector currently finds that base (or found it recently). Faulty bases (too short, V-shaped, loose handle) are still drawn, marked “(faulty)”.</p>

    <div class="grid2">
      <section class="card">
        <h2>Buy rules</h2>
        <ul class="notes">
          <li class="good">Buy only when the stock <b>closes above the buy point</b> on volume at least 40–50% above its 50-day average.</li>
          <li class="good">Buy zone: up to 5% above the buy point. Beyond that it's extended. Don't chase it.</li>
          <li class="good">Prefer early-stage bases (stage 1–2). Count stages from the last base that undercut a prior base's low.</li>
          <li class="good">The RS line making a new high before the price breaks out is a strong tell.</li>
          <li class="good">Buy only in a confirmed market uptrend (the M).</li>
        </ul>
      </section>
      <section class="card">
        <h2>Sell rules</h2>
        <ul class="notes">
          <li class="bad">Cut every loss at 7–8% below your purchase price. No exceptions.</li>
          <li class="bad">A failed breakout: the stock closes back under the buy point (about 2%+) soon after breaking out.</li>
          <li class="bad">A heavy-volume close below the 50-day line, or any close below the 200-day line.</li>
          <li class="warn">Take most profits at +20–25%, unless it gained 20% within 3 weeks of the breakout; then hold at least 8 weeks.</li>
          <li class="warn">Climax tops: the biggest gain since the breakout, an exhaustion gap, or 25%+ above the 50-day line after a fast run.</li>
        </ul>
      </section>
    </div>

    <section class="card">
      <h2>CAN SLIM</h2>
      <div class="letters">
        ${[['C', 'Current earnings', 'Latest quarterly EPS up 25%+ vs the same quarter a year ago; sales up 20–25%+, ideally accelerating.'],
    ['A', 'Annual earnings', 'EPS up 25%+ a year for three years; return on equity of 17%+.'],
    ['N', 'New', 'A new product, management or industry trend, and a new price high out of a proper base.'],
    ['S', 'Supply and demand', 'Volume swells on up days (accumulation). The app uses the 50-day up/down volume ratio.'],
    ['L', 'Leader or laggard', 'Buy leaders: relative strength 80+ and an RS line near new highs.'],
    ['I', 'Institutional sponsorship', 'A rising number of quality funds owning the stock. Not scored in the app.'],
    ['M', 'Market direction', 'Three of four stocks follow the market. Buy in confirmed uptrends; see the Market tab.']].map(([k, t, d]) => html`<div class="letter"><b>${k}</b><div><h3 style="font-size:15px">${t}</h3><p class="muted small" style="margin:2px 0 0">${d}</p></div></div>`)}
      </div>
    </section>

    <section class="card">
      <h2>Good to know</h2>
      <div class="prose small">
        <ul>
          <li><b>RS rating</b> in the screener ranks 12-month price strength (latest quarter double-weighted) 1–99 <i>within the stocks you scanned</i>. It approximates IBD's idea; it is not IBD's proprietary rating.</li>
          <li><b>RS line</b> = the stock divided by its benchmark (S&amp;P 500 for US stocks, the home index where your data plan has it).</li>
          <li><b>Distribution day</b> = an index falls 0.2%+ on higher volume. <b>Follow-through day</b> = a 1.2%+ gain on higher volume on day 4+ of a rally attempt.</li>
          <li>All analysis uses end-of-day data. These are rules of thumb from O'Neil's <i>How to Make Money in Stocks</i>, not guarantees. The app does not give personal investment advice.</li>
        </ul>
      </div>
    </section>`);
  $$('[data-demo]', el).forEach(b => { b.onclick = () => openStock(b.dataset.demo); });
  // point the examples at real stocks showing each pattern in the built-in data
  if (!isDemo()) snapshotMeta().then(m => {
    $$('[data-type]', el).forEach(b => {
      const ex = m.examples[b.dataset.type]; if (!ex) return;
      const st = m.stocks.find(x => x.s === ex.s);
      b.dataset.demo = ex.s; b.textContent = 'See ' + ex.s;
      const lab = el.querySelector(`[data-ex="${b.dataset.type}"]`); if (lab) lab.textContent = (st ? st.n : '') + (ex.when === 'now' ? ' · forming now' : ' · recent breakout');
    });
  }).catch(() => {});
}
