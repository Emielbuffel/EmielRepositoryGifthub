import test from 'node:test';
import assert from 'node:assert/strict';
import { fv, requiredMonthly, requiredReturn, monteCarlo, loanBalance, monthsLeft, drift, PRESETS, illiquidity, marginStress } from '../src/core/plan.js';

test('projection maths', () => {
  assert.ok(Math.abs(fv(100000, 0.07, 0, 120) - 100000 * Math.pow(1.07, 10)) < 1e-6);
  assert.ok(Math.abs(fv(0, 0, 500, 120) - 60000) < 1e-9);
  const c = requiredMonthly(100000, 0.06, 500000, 20); assert.ok(Math.abs(fv(100000, 0.06, c, 240) - 500000) < 1e-4);
  const r = requiredReturn(100000, 1000, 1e6, 20); assert.ok(Math.abs(fv(100000, r, 1000, 240) - 1e6) < 50);
  const mc = monteCarlo(100000, 0.07, 0.15, 0, 10, { targets: [{ years: 10, value: 100000 * Math.pow(1.07, 10) }] });
  assert.ok(mc.odds[0] > 0.35 && mc.odds[0] < 0.6); assert.ok(mc.bands[10].p10 < mc.bands[10].p50 && mc.bands[10].p50 < mc.bands[10].p90);
});

test('loans and the family-wealth checks', () => {
  const M = 200000 * (0.03 / 12) / (1 - Math.pow(1 + 0.03 / 12, -240));
  assert.ok(Math.abs(loanBalance(200000, 0.03, M, 240)) < 1e-6);
  assert.equal(monthsLeft(200000, 0.03, M), 240);
  const d = drift({ eq: 0.8, fi: 0.02, re: 0.18 }, PRESETS.preserve.t); assert.ok(d.find(x => x.k === 'eq').breach && d.find(x => x.k === 'fi').breach);
  assert.equal(illiquidity({ netWorth: 300000, safe: 10000, illiquid: 50000, monthlyOut: 5000 }).verdict, 'liquidity');
  assert.equal(marginStress(100000, 320000)[4].status, 'likely margin call');
});

test('payoff extras, mortgage boost and net worth history', async () => {
  const { payoffExtras, monteCarlo, netWorthHistory } = await import('../src/core/plan.js');
  const M = 200000 * (0.03 / 12) / (1 - Math.pow(1 + 0.03 / 12, -240));
  const ex = payoffExtras([{ balance: 200000, rate: 0.03, payment: M }]); assert.equal(ex[0].from, 20);
  const a = monteCarlo(100000, 0.06, 0.15, 500, 30), b = monteCarlo(100000, 0.06, 0.15, 500, 30, { extras: ex });
  assert.ok(b.bands[30].p50 > a.bands[30].p50 && Math.abs(b.bands[20].p50 - a.bands[20].p50) < 1e-6);
  const h = netWorthHistory([{ t: 0, total: 100000 }], { property: 300000, loans: [{ balance: 100000, rate: 0, payment: 1000 }], now: 12 * 30.44 * 86400 });
  assert.ok(Math.abs(h[0].reEq - 188000) < 1e-6);
});
