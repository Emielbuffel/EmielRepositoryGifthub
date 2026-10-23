import test from 'node:test';
import assert from 'node:assert/strict';
import PAT from '../src/core/pat.js';
import { DEMO, demoBars, DEMO_BENCH } from '../src/data/demo.js';
import { baseState, baseCard, signal, screenRow, rankRS } from '../src/core/analysis.js';
import { analyseIndex, combine } from '../src/core/market.js';
import { analysePortfolio } from '../src/core/portfolio.js';

const fp = x => '$' + x.toFixed(2);
const bench = demoBars(DEMO_BENCH).bars.map(b => ({ time: b.time, close: b.close }));

// Every base type the detector knows must show up in demo mode, so all patterns can be seen in the app.
const EXPECT = {
  'ACME.DEMO': R => R.cur[0]?.type === 'cwh' && !R.cur[0].faulty,
  'BOLT.DEMO': R => R.cur[0]?.type === 'cup',
  'CRUX.DEMO': R => R.cur[0]?.type === 'dbl',
  'DUNE.DEMO': R => R.cur[0]?.type === 'flat',
  'ECHO.DEMO': R => R.cur[0]?.type === 'asc',
  'FLUX.DEMO': R => R.cur[0]?.type === 'htf',
  'GLOW.DEMO': R => R.cur[0]?.type === '3wt',
  'HAZE.DEMO': R => R.cur[0]?.type === 'desc',
  'IRIS.DEMO': (R, b) => R.last && !R.last.failed && b.length - 1 - R.last.bo <= 2,
  'JADE.DEMO': R => R.last && R.last.failed,
  'KITE.DEMO': R => R.cur[0]?.faulty === true,
  'LUMA.DEMO': R => R.hist.filter(h => !h.faulty).length >= 3,
};

for (const d of DEMO) {
  test(`demo ${d.sym} shows ${d.expect}`, () => {
    const b = demoBars(d.sym).bars;
    const R = PAT.scan(b);
    assert.ok(EXPECT[d.sym](R, b), JSON.stringify({ cur: R.cur.map(p => p.type), last: R.last && R.last.type }));
  });
}

test('all eight base types appear across the demo stocks', () => {
  const seen = new Set();
  for (const d of DEMO) { const R = PAT.scan(demoBars(d.sym).bars); R.cur.forEach(p => seen.add(p.type)); R.hist.forEach(h => seen.add(h.type)); }
  for (const t of ['cwh', 'cup', 'dbl', 'flat', 'asc', 'htf', '3wt', 'desc']) assert.ok(seen.has(t), 'missing ' + t);
});

test('a close above the left-side close but under its buy point keeps the base (no missed breakout)', () => {
  // flat base: high 10.00 (close 9.90), dips 10%, then closes at 9.95 (above 9.90, under the 10.10 buy point), then breaks out
  const bars = []; let t = Date.UTC(2024, 0, 1) / 1000;
  const push = c => { while ([0, 6].includes(new Date(t * 1000).getUTCDay())) t += 86400; bars.push({ time: t, open: c, high: c + 0.05, low: c - 0.05, close: c, volume: 1e6 }); t += 86400; };
  for (let i = 0; i < 120; i++) push(6 + i * 0.029);          // prior advance to ~9.45
  push(9.90); bars[bars.length - 1].high = 10.0;
  for (let i = 0; i < 15; i++) push(9.8 - i * 0.06);           // pullback ~10%
  for (let i = 0; i < 18; i++) push(8.95 + i * 0.05);          // right side back to ~9.8
  push(9.95); push(9.97);                                      // above the left close, under 10.10
  push(10.40); bars[bars.length - 1].volume = 3e6;            // breakout
  const R = PAT.scan(bars);
  assert.ok(R.hist.some(h => h.type === 'flat' && h.bo === bars.length - 1), JSON.stringify(R.hist.map(h => [h.type, h.bo])));
});

test('analysis produces a signal, checklist, flags and key numbers for every demo stock', () => {
  for (const d of DEMO) {
    const b = demoBars(d.sym).bars, R = PAT.scan(b);
    const card = baseCard(R, b, bench, fp);
    const s = signal(R, b, bench, fp, { us: 'up', usLabel: 'Confirmed uptrend' }, []);
    assert.ok(['BUY', 'WATCH', 'HOLD', 'SELL'].includes(s.sig));
    assert.equal(s.steps.length, 11);
    assert.ok(s.flags.length >= 1 && s.nums.length === 10);
    assert.equal(card.B.st, baseState(R, b).st);
  }
});

test('the fresh demo breakout reads BUY in an uptrend and WATCH in a correction', () => {
  const b = demoBars('IRIS.DEMO').bars, R = PAT.scan(b);
  assert.equal(signal(R, b, bench, fp, { us: 'up', usLabel: 'Confirmed uptrend' }).sig, 'BUY');
  assert.equal(signal(R, b, bench, fp, { us: 'corr', usLabel: 'Market in correction' }).sig, 'WATCH');
});

test('screener rows and RS ranks', () => {
  const rows = DEMO.map(d => { const b = demoBars(d.sym).bars; return screenRow(d.sym, d.name, b, PAT.scan(b), bench); }).filter(Boolean);
  rankRS(rows);
  assert.equal(rows.length, DEMO.length);
  rows.forEach(r => { assert.ok(r.rs >= 1 && r.rs <= 99); assert.equal(r.sp.length, 30); });
  assert.ok(rows.find(r => r.s === 'IRIS.DEMO').buy.length >= 1);
});

test('market status on the demo indexes', () => {
  const R = analyseIndex(demoBars('DEMO-500').bars);
  assert.ok(R && R.ftds.length >= 1);
  assert.equal(combine([R]).us, R.state);
});

test('portfolio metrics', () => {
  const pos = ['ACME.DEMO', 'IRIS.DEMO', 'LUMA.DEMO'].map((s, i) => ({ sym: s, name: s, value: 1000 * (i + 1), bars: demoBars(s).bars, fx: null }));
  const A = analysePortfolio(pos, { name: 'Demo 500', bars: demoBars('DEMO-500').bars, fx: null });
  assert.ok(A.vol > 0 && A.vol < 2);
  assert.ok(Math.abs(A.per.reduce((s, x) => s + x.weight, 0) - 1) < 1e-9);
  assert.ok(Math.abs(A.per.reduce((s, x) => s + x.rc, 0) - 1) < 1e-9);
  assert.equal(A.corr.length, 3);
});
