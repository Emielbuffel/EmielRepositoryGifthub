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
