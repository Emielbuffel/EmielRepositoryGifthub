// EPS line, earnings maths, index catalog, news parsing and market status history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich, epsPoints, smoothLine, canslimCA, nextReport, adGrade } from '../src/core/earnings.js';
import { indexesFor, INDEXES, PROVIDERS } from '../src/data/providers.js';
import { parseFeed, classify, isPaywalled, decode } from '../src/data/news.js';
import { analyseIndex } from '../src/core/market.js';
import { demoBars, demoEarnings, demoNews, DEMO } from '../src/data/demo.js';

const Q = (y, m, eps, est) => ({ time: Date.UTC(y, m, 1) / 1000, eps, est });
const rows = [Q(2023, 1, 1.0), Q(2023, 4, 1.1), Q(2023, 7, 1.2), Q(2023, 10, 1.3), Q(2024, 1, 1.5, 1.4), Q(2024, 4, 1.7), Q(2024, 7, 2.0), Q(2024, 10, 2.4, 2.2), { time: Date.UTC(2099, 1, 1) / 1000, eps: null, est: 2.6 }];

test('trailing EPS, year-over-year growth and surprise', () => {
  const q = enrich(rows);
  assert.equal(q.length, 8);
  assert.equal(q[3].ttm.toFixed(2), '4.60');
  assert.equal(q[7].yoy.toFixed(2), '0.85');            // 2.4 vs 1.3
  assert.equal(q[7].surprise.toFixed(3), '0.091');
  assert.equal(nextReport(rows).est, 2.6);
});

test('EPS line points and a smooth curve that passes through every report without overshoot', () => {
  const pts = epsPoints(rows, 'ttm');
  assert.equal(pts.length, 5);
  const times = []; for (let t = pts[0].time - 30 * 86400; t <= pts[4].time + 60 * 86400; t += 86400) times.push(t);
  const line = smoothLine(pts, times);
  for (const p of pts) { const v = line.find(x => x.time === p.time); assert.ok(Math.abs(v.value - p.value) < 1e-9); }
  for (let i = 1; i < line.length; i++) assert.ok(line[i].value >= line[i - 1].value - 1e-9, 'monotone data stays monotone');
  assert.equal(line[line.length - 1].value, pts[4].value);   // held flat after the last report
  assert.ok(line[0].time >= pts[0].time);                    // starts at the first report
});

test('CAN SLIM C and A from quarterly earnings', () => {
  const { C, A } = canslimCA(rows);
  assert.equal(C[0], 'pass'); assert.match(C[1], /accelerating/);
  assert.ok(['pass', 'mid'].includes(A[0]));
});

test('A/D grade on demo stocks', () => {
  const g = adGrade(demoBars('IRIS.DEMO').bars);
  assert.ok(g && 'ABCDE'.includes(g.grade));
});

test('every listing gets its home index first, plus global comparisons', () => {
  assert.deepEqual(indexesFor('NVDA').slice(0, 3), ['GSPC', 'IXIC', 'NDX']);
  assert.equal(indexesFor('7203.T')[0], 'N225');
  assert.deepEqual(indexesFor('SAP.DE').slice(0, 2), ['GDAXI', 'STOXX50E']);
  assert.equal(indexesFor('005930.KS')[0], 'KS11');
  assert.ok(indexesFor('ASML.AS').includes('WORLD'));
  for (const k of new Set(['', 'DE', 'T', 'L', 'HK'].flatMap(s => indexesFor(s ? 'X.' + s : 'X')))) assert.ok(INDEXES[k], k);
  assert.equal(PROVIDERS.eodhd.indexSym('N225'), 'N225.INDX');
  assert.equal(PROVIDERS.fmp.indexSym('GDAXI'), '^GDAXI');
});

test('demo earnings and news exist for every demo stock', () => {
  for (const d of DEMO) { const e = demoEarnings(d.sym); assert.ok(e.filter(x => x.eps != null).length >= 6, d.sym); assert.ok(demoNews(d.sym).length >= 4); }
});

test('RSS 2.0 (Google News style) parsing', () => {
  const xml = `<rss><channel><item><title>NVIDIA beats estimates as data-center sales soar - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Wed, 21 Oct 2026 21:05:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
    <item><title><![CDATA[Analyst upgrades Nvidia &amp; raises price target]]></title><link>https://finance.yahoo.com/news/x.html</link><pubDate>Tue, 20 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const it = parseFeed(xml);
  assert.equal(it.length, 2);
  assert.equal(it[0].source, 'Reuters'); assert.equal(it[0].srcDomain, 'reuters.com');
  assert.equal(it[1].title, 'Analyst upgrades Nvidia & raises price target');
  assert.equal(it[0].date, Date.UTC(2026, 9, 21, 21, 5));
  assert.equal(classify(it[0].title), 'earnings'); assert.equal(classify(it[1].title), 'analyst');
});

test('Atom (SEC EDGAR style) parsing', () => {
  const xml = `<feed><entry><title>8-K  - Current report</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1045810/x-index.htm"/><updated>2026-10-20T16:05:22-04:00</updated><category label="form type" scheme="https://www.sec.gov/" term="8-K"/></entry></feed>`;
  const [e] = parseFeed(xml);
  assert.equal(e.cat, '8-K'); assert.match(e.link, /sec\.gov/); assert.ok(e.date > 0);
  assert.equal(classify('Filed 8-K Current report'), 'filing');
});

test('paywall filter and entity decoding', () => {
  assert.ok(isPaywalled('wsj.com')); assert.ok(isPaywalled('markets.ft.com')); assert.ok(!isPaywalled('reuters.com')); assert.ok(!isPaywalled('cnbc.com'));
  assert.equal(decode('Q3 &#8211; S&amp;P &lt;500&gt; &#x2019;'), 'Q3 – S&P <500> ’');
});

test('market status is recorded day by day for the ribbon', () => {
  const R = analyseIndex(demoBars('DEMO-500').bars);
  const st = R.states.filter(Boolean);
  assert.ok(st.length > 200); assert.ok(st.includes('corr') && st.includes('up'));
  assert.equal(R.states[R.n], R.state);
  assert.ok(R.ddAll.length >= R.dd.length);
});
