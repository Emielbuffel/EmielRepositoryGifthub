import test from 'node:test';
import assert from 'node:assert/strict';
import { tradePlan, DEFAULT_PLAN } from '../src/core/strategy.js';
import { degiroOrders } from '../src/core/degiro.js';

test('DEGIRO orders follow the trade plan', () => {
  const T = tradePlan({ capital: 100000 }, 100), O = degiroOrders(T, 100, DEFAULT_PLAN);
  const b1 = O.find(o => o.step === 'Buy 1'), prot = O.find(o => o.step === 'Protect'), tp = O.filter(o => o.step.startsWith('Take profit'));
  assert.equal(b1.type, 'Stop Limit'); assert.equal(b1.stop, 100); assert.equal(b1.limit, 102); assert.equal(b1.shares, T.buys[0].shares);
  assert.ok(b1.limit <= T.zoneTop);
  assert.equal(prot.type, 'Stop Loss'); assert.equal(prot.stop, T.stop);
  assert.deepEqual(tp.map(o => [o.type, o.limit, o.shares]), T.sells.map(s => ['Limit', s.price, s.shares]));
  assert.equal(O.find(o => o.step === 'Buy 3').limit, T.zoneTop);
  assert.ok(O.every(o => ['Buy', 'Sell'].includes(o.side)));
});

test('DEGIRO orders: a Limit order inside the buy zone, nothing when extended', () => {
  const T = tradePlan({ capital: 100000 }, 100);
  const z = degiroOrders(T, 100, DEFAULT_PLAN, 102).find(o => o.step === 'Buy 1');
  assert.equal(z.type, 'Limit'); assert.equal(z.limit, 102.51); assert.equal(z.valid, 'Day');
  const x = degiroOrders(T, 100, DEFAULT_PLAN, 108);
  assert.equal(x[0].step, 'No buy'); assert.ok(!x.some(o => o.step === 'Buy 1'));
});
