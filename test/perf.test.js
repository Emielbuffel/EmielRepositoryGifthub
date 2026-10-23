import test from 'node:test';
import assert from 'node:assert/strict';
import { evolution, account } from '../src/core/perf.js';

const D = 86400, bars = (vals, t0 = 1e9) => vals.map((c, i) => ({ time: t0 + i * D, close: c }));
const fx = () => 1;

test('the example: double, then withdraw half → TWR stays +100%, money made 1000', () => {
  // 10 shares at 100 → 200; cash 0; on day 3 sell 5 shares at 200 and withdraw 1000
  const prices = { X: bars([100, 150, 200, 200]) };
  const e = evolution({ holdings: [{ sym: 'X', shares: 5 }], cash: 0, prices, fx, cur: { X: 'EUR' },
    trades: [{ t: 1e9 + 3 * D, sym: 'X', side: 'sell', shares: 5, price: 200, cur: 'EUR' }],
    flows: [{ t: 1e9 + 3 * D, amount: -1000 }], from: 0 });
  assert.equal(e.start, 1000); assert.equal(e.end, 1000);
  assert.ok(Math.abs(e.twr - 1) < 1e-9, 'twr ' + e.twr);
  assert.equal(e.netFlows, -1000); assert.equal(e.made, 1000);
});

test('a deposit is not a gain; a buy moves money from cash to stocks', () => {
  const prices = { X: bars([100, 100, 110]) };
  // day 1: deposit 1000, buy 10 at 100 → cash 0; day 2: price 110
  const e = evolution({ holdings: [{ sym: 'X', shares: 10 }], cash: 0, prices, fx, cur: { X: 'EUR' },
    trades: [{ t: 1e9 + D, sym: 'X', side: 'buy', shares: 10, price: 100 }], flows: [{ t: 1e9 + D, amount: 1000 }], from: 0 });
  assert.equal(e.days[0].equity, 0);
  assert.equal(e.days[1].equity, 1000); assert.equal(e.days[1].cash, 0);
  assert.equal(e.days[2].equity, 1100);
  assert.equal(e.made, 100);
});

test('margin: negative cash, leverage', () => {
  const a = account(150000, -30000);
  assert.equal(a.equity, 120000); assert.equal(a.margin, 30000); assert.equal(a.leverage, 1.25);
  const b = account(88770, 119217); assert.ok(Math.abs(b.cashPct - 119217 / 207987) < 1e-9);
});

import { ols } from '../src/core/factors.js';
test('ols recovers known loadings', () => {
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const X = Array.from({ length: 120 }, () => [rnd() * 0.04, rnd() * 0.02]);
  const y = X.map(([a, b]) => 0.001 + 1.2 * a - 0.5 * b + rnd() * 0.002);
  const f = ols(y, X);
  assert.ok(Math.abs(f.coef[0] - 1.2) < 0.05 && Math.abs(f.coef[1] + 0.5) < 0.08, JSON.stringify(f.coef));
  assert.ok(f.r2 > 0.95);
});

test('names match in any word order and without legal suffixes', async () => {
  const { resolveTickers } = await import('../src/core/importer.js');
  const r = resolveTickers([{ name: 'ELI LILLY AND COMPANY', qty: 8 }, { name: 'TD SYNNEX CORPORATION', qty: 35 }], [['LLY', 'Lilly (Eli)', ''], ['SNX', 'TD SYNNEX CORP', '']]);
  assert.deepEqual(r.map(x => x.ticker), ['LLY', 'SNX']);
});
