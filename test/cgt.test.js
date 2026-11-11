import test from 'node:test';
import assert from 'node:assert/strict';
import { realisedGains } from '../src/core/cgt.js';
import { roundTrips, tradeStats, byLabel, lessons } from '../src/core/review.js';

const T = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;

test('bought in 2025, sold in 2026: the 31-12-2025 value, or the higher purchase price until 2030', () => {
  const tr = [{ t: T(2025, 3, 1), key: 'A', side: 'buy', qty: 10, price: 100 }, { t: T(2026, 5, 1), key: 'A', side: 'sell', qty: 10, price: 150 }];
  const lowCost = realisedGains(tr, () => 120); // value on 31-12-2025: 120 > cost 100 → basis 120
  assert.equal(lowCost.sales[0].gain, 300); assert.match(lowCost.sales[0].parts[0].how, /31-12-2025/);
  const highCost = realisedGains(tr, () => 90); // cost 100 > 90 → the higher purchase price
  assert.equal(highCost.sales[0].gain, 500); assert.match(highCost.sales[0].parts[0].how, /higher/);
  const after = realisedGains([tr[0], { ...tr[1], t: T(2031, 2, 1) }], () => 90); // from 2031 only the 31-12-2025 value
  assert.equal(after.sales[0].gain, 600);
});

test('average purchase price for several buys; losses offset gains; exemption and 10%', () => {
  const tr = [
    { t: T(2026, 1, 10), key: 'B', side: 'buy', qty: 10, price: 100 }, { t: T(2026, 2, 10), key: 'B', side: 'buy', qty: 10, price: 200 },
    { t: T(2026, 6, 1), key: 'B', side: 'sell', qty: 20, price: 1000 }, // basis 3000 → gain 17,000
    { t: T(2026, 3, 1), key: 'C', side: 'buy', qty: 100, price: 50 }, { t: T(2026, 4, 1), key: 'C', side: 'sell', qty: 100, price: 30 }, // −2,000
  ];
  const r = realisedGains(tr), y = r.years[2026];
  assert.equal(y.gains, 17000); assert.equal(y.losses, -2000); assert.equal(y.net, 15000);
  assert.equal(y.exemption, 10000); assert.equal(y.taxable, 5000); assert.equal(y.tax, 500);
});

test('sales before 2026 are not taxed; unknown purchases use the 31-12-2025 value or stay unknown', () => {
  const r = realisedGains([{ t: T(2025, 6, 1), key: 'D', side: 'sell', qty: 5, price: 10 }, { t: T(2026, 6, 1), key: 'E', side: 'sell', qty: 5, price: 10 }], k => k === 'E' ? 8 : null);
  assert.equal(r.sales[0].taxed, false); assert.equal(r.years[2025], undefined);
  assert.equal(r.sales[1].gain, 10);
  const u = realisedGains([{ t: T(2026, 6, 1), key: 'F', side: 'sell', qty: 5, price: 10 }]);
  assert.equal(u.sales[0].gain, null); assert.equal(u.years[2026].unknown, 1);
});

test('trade review: round trips, win rate, payoff, holding time, lessons, by entry type', () => {
  const tr = [
    { t: T(2026, 1, 1), key: 'W', side: 'buy', qty: 10, price: 100 }, { t: T(2026, 1, 5), key: 'W', side: 'buy', qty: 5, price: 102 },
    { t: T(2026, 3, 1), key: 'W', side: 'sell', qty: 15, price: 125 },
    { t: T(2026, 2, 1), key: 'L', side: 'buy', qty: 10, price: 100 }, { t: T(2026, 2, 8), key: 'L', side: 'sell', qty: 10, price: 92 },
    { t: T(2026, 4, 1), key: 'O', side: 'buy', qty: 10, price: 100 },
  ];
  const { trips, open } = roundTrips(tr);
  assert.equal(trips.length, 2); assert.equal(open.length, 1);
  const s = tradeStats(trips);
  assert.equal(s.winRate, 0.5); assert.ok(Math.abs(s.avgLoss - -0.08) < 1e-9); assert.ok(s.daysLoss < s.daysWin);
  assert.ok(s.payoff > 2.5);
  const g = byLabel(trips, t => t.key === 'W' ? 'Cup with handle' : 'No base breakout');
  assert.equal(g.length, 2);
  assert.ok(lessons(s, g).some(l => /cut losers faster/.test(l[1])));
});
