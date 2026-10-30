import test from 'node:test';
import assert from 'node:assert/strict';
import { monthly, weights } from '../src/core/months.js';

test('month by month: change, deposits, Modified Dietz return, holdings moves', () => {
  const D = 86400;
  const snaps = [
    { t: 0, cash: 1000, rows: [{ sym: 'A', shares: 10, eur: 1000 }] },
    { t: 30 * D, cash: 2000, rows: [{ sym: 'A', shares: 10, eur: 1100 }, { sym: 'B', shares: 5, eur: 500 }] },
    { t: 61 * D, cash: 2600, rows: [{ sym: 'B', shares: 5, eur: 550 }] },
  ];
  const M = monthly(snaps, [{ t: 10 * D, amount: 1500 }], [{ t: 40 * D, kind: 'dividend', amount: 20 }]);
  assert.equal(M[1].change, 1600); assert.equal(M[1].flow, 1500); assert.equal(M[1].result, 100);
  assert.ok(Math.abs(M[1].ret - 100 / 2750) < 1e-12);
  assert.deepEqual(M[1].moves.map(m => m.kind), ['new']);
  assert.deepEqual(M[2].moves.map(m => m.kind + ':' + m.name), ['sold:A']);
  assert.equal(M[2].div, 20);
  const W = weights(M); assert.equal(W.names[0], 'B'); assert.equal(W.cells.A[2], 0);
});
