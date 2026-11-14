import test from 'node:test';
import assert from 'node:assert/strict';
import { fibLevels, fibChoices, fibSettings, parseLevel, FIB_DEFAULT } from '../src/core/fib.js';

test('levels between a low and a high: 0% at the first point, 100% at the second', () => {
  const L = fibLevels({ p1: 100, p2: 200 }, { on: [0, 38.2, 50, 61.8, 100] });
  assert.deepEqual(L.map(x => x.v), [100, 61.8, 50, 38.2, 0]);
  assert.equal(L.find(x => x.v === 50).price, 150);
  assert.ok(Math.abs(L.find(x => x.v === 61.8).price - 161.8) < 1e-9);
});

test('reverse swaps the ends, extensions and custom levels work', () => {
  const L = fibLevels({ p1: 100, p2: 200 }, { on: [0, 161.8, 70.7], custom: [70.7], reverse: true });
  assert.equal(L.find(x => x.v === 0).price, 200);
  assert.ok(Math.abs(L.find(x => x.v === 161.8).price - 38.2) < 1e-9);
  assert.ok(L.some(x => x.v === 70.7));
});

test('settings: defaults, choices list and typed levels', () => {
  assert.deepEqual(fibSettings(null).on, FIB_DEFAULT.on);
  const c = fibChoices({ on: [50, 70.7], custom: [70.7] });
  assert.ok(c.find(x => x.v === 70.7).custom && c.find(x => x.v === 70.7).on);
  assert.equal(c.find(x => x.v === 61.8).on, false);
  assert.equal(parseLevel('70,7%'), 70.7);
  assert.equal(parseLevel('abc'), null);
  assert.deepEqual(fibLevels({ p1: 5, p2: 5 }, null), []);
});
