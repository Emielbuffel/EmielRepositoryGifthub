import test from 'node:test';
import assert from 'node:assert/strict';
import { sellPlan } from '../src/core/sells.js';

// 250 flat bars at 100 (so moving averages exist), breakout on bar 250 at pivot 100, then a scripted path
const mk = path => { const b = []; for (let i = 0; i < 250; i++) b.push({ time: i * 86400, open: 100, high: 101, low: 99, close: 100, volume: 1e6 }); path.forEach((c, k) => b.push({ time: (250 + k) * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 })); return b; };
const ramp = (from, to, days) => Array.from({ length: days }, (_, k) => from + (to - from) * (k + 1) / days);

test('stop: 8% under the buy price', () => {
  const r = sellPlan(mk([101, 99, 95, 91.5]), 250, 100);
  assert.equal(r.sell.code, 'stop'); assert.equal(r.sell.i, 253);
});
test('raised stop after +15%, breakeven after +20%', () => {
  let r = sellPlan(mk([...ramp(100, 116, 30), 105, 96.5]), 250, 100);
  assert.equal(r.sell.code, 'raised');
  r = sellPlan(mk([...ramp(100, 121, 30), 110, 99.5]), 250, 100);
  assert.equal(r.sell.code, 'breakeven');
});
test('profit at +20% after 8 weeks; 8-week hold when faster', () => {
  let r = sellPlan(mk(ramp(100, 121, 50)), 250, 100);
  assert.equal(r.sell.code, 'profit');
  r = sellPlan(mk(ramp(100, 121, 20)), 250, 100);
  assert.equal(r.sell, null); assert.ok(r.hold8); assert.ok(r.open.line >= 100);
});
test('heavy-volume 50-day break', () => {
  const b = mk([...ramp(100, 112, 30), 111, 110]);
  const last = b.length; b.push({ time: last * 86400, open: 104, high: 105, low: 103, close: 104, volume: 3e6 });
  const r = sellPlan(b, 250, 100);
  assert.equal(r.sell.code, 'break50');
});
