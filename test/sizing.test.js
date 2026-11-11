import test from 'node:test';
import assert from 'node:assert/strict';
import { sizing, fundTrade, allowedExposure } from '../src/core/sizing.js';

test('the position is 20% of your own money and grows with the account', () => {
  const a = sizing({ stocks: 150000, cash: 50000 }, { posPct: 0.2, maxMargin: 0.5 });
  assert.equal(a.equity, 200000); assert.equal(a.position, 40000);
  const b = sizing({ stocks: 300000, cash: 100000 }, { posPct: 0.2, maxMargin: 0.5 });
  assert.equal(b.position, 80000); // the account doubled: the position doubles
});

test('number of positions follows from the size and the market (margin only in an uptrend)', () => {
  assert.equal(sizing({ stocks: 0, cash: 100 }, { posPct: 0.2, maxMargin: 0.5 }, 'up').maxPositions, 7); // 150% / 20%
  assert.equal(sizing({ stocks: 0, cash: 100 }, { posPct: 0.2, maxMargin: 0 }, 'up').maxPositions, 5);
  assert.equal(sizing({ stocks: 0, cash: 100 }, { posPct: 0.2, maxMargin: 0.5 }, 'press').maxPositions, 3);
  assert.equal(sizing({ stocks: 0, cash: 100 }, { posPct: 0.2, maxMargin: 0.5 }, 'corr').maxPositions, 1);
  assert.equal(allowedExposure('up', 0.5), 1.5);
});

test('margin: a loan is negative cash; limits and warnings', () => {
  const s = sizing({ stocks: 250000, cash: -50000 }, { posPct: 0.2, maxMargin: 0.5 }, 'up');
  assert.equal(s.equity, 200000); assert.equal(s.loan, 50000); assert.equal(s.marginPct, 0.25);
  assert.equal(s.room, 50000); // 150% × 200,000 − 250,000
  assert.equal(s.marginRoom, 50000);
  const t = fundTrade(s, 40000); assert.equal(t.fromMargin, 40000); assert.ok(Math.abs(t.marginAfter - 0.45) < 1e-9);
  const p = sizing({ stocks: 250000, cash: -50000 }, { posPct: 0.2, maxMargin: 0.5 }, 'press');
  assert.ok(p.notes.some(n => /pay the loan back/.test(n[1]))); assert.equal(p.marginRoom, 0);
  const over = sizing({ stocks: 320000, cash: -120000 }, { posPct: 0.2, maxMargin: 0.5 }, 'up');
  assert.ok(over.notes.some(n => /above your 50% limit/.test(n[1])));
});

test('a trade is paid from cash first, then margin', () => {
  const s = sizing({ stocks: 180000, cash: 20000 }, { posPct: 0.2, maxMargin: 0.5 }, 'up');
  const t = fundTrade(s, 40000);
  assert.equal(t.fromCash, 20000); assert.equal(t.fromMargin, 20000); assert.equal(t.ok, true);
});

test('market phases: margin in a new or confirmed uptrend; rally attempt and correction: none, close margin positions', () => {
  const S = { posPct: 0.2, maxMargin: 0.5 };
  const nw = sizing({ stocks: 100000, cash: 100000 }, S, { us: 'up', phase: 'new', ftdAgo: 3 });
  assert.equal(nw.marginAllowed, true); assert.equal(nw.maxPositions, 7); assert.ok(nw.notes.some(n => /follow-through day 3 sessions ago/.test(n[1])));
  const ra = sizing({ stocks: 20000, cash: 180000 }, S, { us: 'corr', phase: 'rally', rallyDay: 2 });
  assert.equal(ra.marginAllowed, false); assert.equal(ra.maxPositions, 1); assert.ok(ra.notes.some(n => /Rally attempt \(day 2\)/.test(n[1])));
  const co = sizing({ stocks: 250000, cash: -50000 }, S, { us: 'corr', phase: 'corr' });
  assert.equal(co.marginRoom, 0); assert.ok(co.notes.some(n => /Close the positions bought on margin first/.test(n[1])));
  const co2 = sizing({ stocks: 150000, cash: 50000 }, S, { us: 'corr', phase: 'corr' });
  assert.ok(co2.notes.some(n => /0–20% invested\. Close positions/.test(n[1])));
});
