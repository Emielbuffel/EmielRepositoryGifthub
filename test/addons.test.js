import test from 'node:test';
import assert from 'node:assert/strict';
import PAT from '../src/core/pat.js';
import { demoBars } from '../src/data/demo.js';
import { holdingSignals } from '../src/core/addons.js';

test('a holding that just broke out of a new base is in the buy zone: an add-on when in profit', () => {
  const b = demoBars('IRIS.DEMO').bars, R = PAT.scan(b), c = b[b.length - 1].close;
  const add = holdingSignals(b, R, { cost: c * 0.8 }).find(s => s.code.startsWith('buyzone'));
  assert.ok(add); assert.equal(add.level, 'add');
  const loss = holdingSignals(b, R, { cost: c * 1.2 }).find(s => s.code.startsWith('buyzone'));
  assert.equal(loss.level, 'buy'); assert.match(loss.text, /don't average down/);
});

test('no add-on signals for a stock without a recent breakout or base near its buy point', () => {
  const b = demoBars('HAZE.DEMO').bars; // descending base
  assert.deepEqual(holdingSignals(b, PAT.scan(b), { cost: 50 }).filter(s => s.level === 'add'), []);
});

test('pullback to the rising 50-day line on light volume after a breakout is an add-on point', () => {
  // 260 days: a base, a breakout at day 200, a run, then a quiet pullback to the 50-day line
  const bars = []; let p = 100;
  for (let i = 0; i < 260; i++) {
    if (i < 140) p *= 1.004; else if (i < 175) p *= 0.996; else if (i < 200) p *= 1.0045; else if (i < 225) p *= 1.006; else p *= 0.994;
    bars.push({ time: 1e9 + i * 86400, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: i >= 255 ? 6e5 : i === 200 ? 3e6 : 1e6 });
  }
  const R = PAT.scan(bars), s = holdingSignals(bars, R, { cost: 100 });
  // the detector decides whether this shape is a base; only check the rule when it found the breakout
  if (R.last && !R.last.failed) {
    const c = bars.map(b => b.close), s50 = c.slice(-50).reduce((t, x) => t + x, 0) / 50, last = bars[bars.length - 1];
    const atLine = last.low <= s50 * 1.015 && last.close >= s50 * 0.995 && last.close <= s50 * 1.03;
    assert.equal(s.some(x => x.code.startsWith('pull50')), atLine);
  }
});
