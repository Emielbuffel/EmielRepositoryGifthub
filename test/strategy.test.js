import test from 'node:test';
import assert from 'node:assert/strict';
import { pyramid, nextStep, sharesFor, sizingChecks, DEFAULT_PLAN } from '../src/core/strategy.js';
import { exposureFactors } from '../src/core/exposure.js';
import { analyseIndex } from '../src/core/market.js';

test('pyramid: 208,000 EUR, 20% per position, 50/35/15', () => {
  const p = pyramid({ capital: 208000 }, 100);
  assert.equal(p.target, 41600);
  assert.deepEqual(p.steps.map(s => s.amount), [20800, 14560, 6240]);
  assert.deepEqual(p.steps.map(s => [s.from, s.to]), [[100, 101], [101, 102], [104, 105]]);
  assert.equal(p.stop, 93); assert.equal(p.zoneTop, 105);
  assert.equal(sharesFor(20800, 100, 0.9), 231); // listing price 100 USD at 0.9 EUR per USD
});

test('nextStep walks through the pyramid', () => {
  const q = { now: 1e9, market: 'up' };
  assert.equal(nextStep({}, { pivot: 100, buys: [] }, { ...q, close: 99 }).code, 'below');
  assert.equal(nextStep({}, { pivot: 100, buys: [] }, { ...q, close: 100.5 }).code, 'buy1');
  assert.equal(nextStep({}, { pivot: 100, buys: [] }, { ...q, close: 106 }).code, 'extended');
  const one = { pivot: 100, buys: [{ price: 100.5, shares: 207 }] };
  assert.equal(nextStep({}, one, { ...q, close: 100.8 }).code, 'wait-add');
  const a2 = nextStep({}, one, { ...q, close: 101.5 });
  assert.equal(a2.code, 'add2'); assert.equal(a2.amount, 14560); assert.equal(a2.shares, 143);
  const two = { pivot: 100, buys: [...one.buys, { price: 101.5, shares: 143 }] };
  assert.equal(nextStep({}, two, { ...q, close: 103 }).code, 'wait-add');
  assert.equal(nextStep({}, two, { ...q, close: 104.5 }).code, 'add3');
  assert.equal(nextStep({}, two, { ...q, close: 92 }).code, 'stop');
  // earnings within 14 days blocks the add
  assert.equal(nextStep({}, two, { ...q, close: 104.5, nextReport: 1e9 + 5 * 86400 }).code, 'earnings');
  const full = { pivot: 100, buys: [...two.buys, { price: 104.5, shares: 59 }] };
  assert.equal(nextStep({}, full, { ...q, close: 120 }).code, 'full');
  assert.equal(nextStep({}, full, { ...q, close: 110, s50: 108.5, s50prev: 107 }).code, 'add50');
});

test('nextStep: book sell rules (stop from cost, raised stops, profits, 8-week rule)', () => {
  const t0 = 1e9, wk = 604800;
  const full = { pivot: 100, buys: [{ t: t0, price: 100, shares: 100 }, { t: t0, price: 101.5, shares: 70 }, { t: t0, price: 104.5, shares: 30 }] };
  // avg ≈ 101.3: stop 7% below it ≈ 94.2
  assert.equal(nextStep({}, full, { now: t0 + wk, close: 94 }).code, 'stop');
  assert.equal(nextStep({ stopFrom: 'pivot' }, full, { now: t0 + wk, close: 94 }).code, 'full'); // 93 = 7% under the buy point
  // after a 15% gain the sell line moves to just below the buy point (97)
  assert.equal(nextStep({}, full, { now: t0 + 10 * wk, close: 96, peak: 117 }).code, 'stop');
  // after a 20% gain it moves to breakeven
  assert.equal(nextStep({}, full, { now: t0 + 10 * wk, close: 101, peak: 122 }).code, 'stop');
  // +20% within 8 weeks: hold; after 8 weeks: take profits
  assert.equal(nextStep({}, full, { now: t0 + 4 * wk, close: 123 }).code, 'hold8');
  assert.equal(nextStep({}, full, { now: t0 + 10 * wk, close: 123 }).code, 'profit');
});

test('sizingChecks: shift from laggards into leaders', () => {
  const m = sizingChecks(DEFAULT_PLAN, [{ sym: 'WIN', value: 30000, gain: 0.3 }, { sym: 'LOSE', value: 60000, gain: -0.09 }], 200000);
  assert.ok(m.some(x => /shifting money/.test(x.text)));
  assert.ok(m.some(x => x.sym === 'LOSE' && /stop/.test(x.text)));
  assert.ok(m.some(x => x.sym === 'LOSE' && /above your 20%/.test(x.text)));
});

function bars(n, f) { const out = []; let c = 100; for (let i = 0; i < n; i++) { const r = f(i, c); c = r.c; out.push({ time: 1.6e9 + i * 86400, open: c, high: c * 1.005, low: c * 0.995, close: c, volume: r.v }); } return out; }
test('exposureFactors: steady uptrend vs distribution cluster', () => {
  const upB = bars(300, (i, c) => ({ c: c * (1 + (i % 3 === 0 ? 0.012 : 0.001)), v: 1e9 + (i % 3 === 0 ? 2e8 : 0) }));
  const E = exposureFactors([{ name: 'Up', R: analyseIndex(upB) }]);
  assert.ok(E.upYes >= 4, 'up factors ' + E.upYes); assert.equal(E.raiseCash, false);
  const dnB = upB.slice(0, 280).concat(bars(20, (i) => ({ c: upB[279].close * Math.pow(0.985, i + 1), v: 1e9 + i * 1e8 })).map((b, i) => ({ ...b, time: upB[279].time + (i + 1) * 86400 })));
  const D = exposureFactors([{ name: 'Down', R: analyseIndex(dnB) }]);
  assert.equal(D.down.find(x => x.key === 'dd').ok, true);
  assert.ok(D.raiseCash || D.score < 0);
});

test('sizingChecks: 20% limit measured against the whole account', () => {
  const rows = [{ sym: 'MA', value: 13000, gain: null }, { sym: 'BIG', value: 50000, gain: 0.1 }];
  const m = sizingChecks(DEFAULT_PLAN, rows, 208000);
  assert.ok(!m.some(x => x.sym === 'MA'));
  assert.ok(m.some(x => x.sym === 'BIG' && x.kind === 'size' && /24% of your account, above your 20% limit/.test(x.text)));
});
