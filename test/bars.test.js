import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBars, fixSpikes, alignQuote } from '../src/core/bars.js';

const D = 86400, mk = (t0, closes) => closes.map((c, i) => ({ time: t0 + i * D, open: c, high: c, low: c, close: c, volume: 1 }));

test('merge refuses sources that disagree (other venue or unit)', () => {
  const a = mk(0, [100, 101, 102, 103]), b = mk(2 * D, [130, 131, 133]);
  assert.equal(mergeBars(a, b).ok, false);
  const ok = mergeBars(a, mk(2 * D, [102.2, 103.1, 104]));
  assert.equal(ok.ok, true); assert.equal(ok.bars.length, 5); assert.equal(ok.bars[4].close, 104);
  assert.equal(mergeBars(a, mk(4 * D, [131])).ok, false); // a +27% seam without overlap
});

test('spikes that revert are removed; last close follows the live quote', () => {
  const f = fixSpikes(mk(0, [100, 101, 128, 102, 103]));
  assert.ok(f[2].fixed && Math.abs(f[2].close - 101.5) < 1e-9);
  const real = fixSpikes(mk(0, [100, 101, 128, 129, 130])); assert.ok(!real[2].fixed); // a real gap that holds stays
  const q = alignQuote(mk(0, [100, 101]), { price: 102, time: D + 3600 });
  assert.equal(q[1].close, 102);
});

test('a live quote on a new day becomes its own bar (correct day change)', () => {
  const b = mk(0, [100, 101]);
  const out = alignQuote(b, { price: 103, time: 2 * D + 3600 });
  assert.equal(out.length, 3); assert.equal(out[2].close, 103); assert.ok(out[2].liveBar);
  assert.equal(alignQuote(b, { price: 300, time: 2 * D }).length, 2); // implausible jump: ignored
});

test("today's bar keeps the feed's volume and day range (Yahoo sends them with an empty close)", () => {
  const b = mk(0, [100, 101]);
  const out = alignQuote(b, { price: 99, time: 2 * D + 3600, volume: 262485, high: 101.5, low: 98.7, open: 100.5 });
  assert.equal(out[2].volume, 262485); assert.equal(out[2].high, 101.5); assert.equal(out[2].low, 98.7); assert.equal(out[2].open, 100.5);
  const same = alignQuote(b, { price: 101, time: D + 3600, volume: 5000 }); // same day, price equal: volume still updated
  assert.equal(same[1].volume, 5000); assert.equal(same[1].close, 101);
});

test('EPS from two sources: the same quarter is never listed twice (built-in list newest-first)', async () => {
  const { mergeEarnings } = await import('../src/core/earnings.js');
  const Q = 91 * D, T = 2000 * D;
  const built = [{ time: T + 3 * Q, eps: null }, { time: T + 2 * Q, eps: 2.22 }, { time: T + Q, eps: 1.87 }, { time: T, eps: 1.62 }, { time: T - Q, eps: 1.3 }, { time: T - 2 * Q, eps: 1.05 }, { time: T - 3 * Q, eps: 0.81 }]; // newest first, next report on top
  const long = [{ time: T - Q + 15 * D, eps: 1.3 }, { time: T + 15 * D, eps: 1.76 }, { time: T + Q + 15 * D, eps: 2.39 }, { time: T + 2 * Q + 15 * D, eps: 2.46 }, { time: T - 3 * Q - 200 * D, eps: 3.1, annual: true }];
  const rows = mergeEarnings(built, long);
  assert.equal(rows.filter(r => r.eps != null && !r.annual).length, 6); // only the built-in quarters
  assert.equal(rows.filter(r => r.annual).length, 1); // the year before them is added
  const newer = mergeEarnings(built, [...long, { time: T + 3 * Q + 20 * D, eps: 2.6 }]);
  assert.ok(newer.some(r => r.eps === 2.6)); // a quarter newer than the built-in data is added
});
