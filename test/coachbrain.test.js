import test from 'node:test';
import assert from 'node:assert/strict';
import { tailoredAnswer, statedFraction } from '../src/core/coachbrain.js';

const base = { sym: 'UCB.BR', cur: 'EUR', pivot: 280, zoneTop: 294, s50: 270, boAgo: 6, failed: false, held: 15, cost: 285, target: 6000, posPct: 0.2, ccy: 'EUR', fx: 1, stopPct: 0.07, earnDays: 60, earnDate: '25 Feb 2027', market: 'up', adds: [], volRatio: 1.1 };

test('stated fractions', () => {
  assert.equal(statedFraction('i have 75% of a position'), 0.75);
  assert.equal(statedFraction('I hold half a position'), 0.5);
  assert.equal(statedFraction('ik heb de helft'), 0.5);
});

test('add: yes inside the buy zone, with shares and a DEGIRO order', () => {
  const a = tailoredAnswer('i have 75% of a position, would he add here so i have a full position?', { ...base, price: 290 });
  assert.match(a, /^\*\*Yes/); assert.match(a, /To reach 100%: buy about \d+ shares/); assert.match(a, /DEGIRO: Buy · Limit/);
});

test('add: no when extended, names the next add-on points', () => {
  const a = tailoredAnswer('should I add to get a full position?', { ...base, price: 315 });
  assert.match(a, /^\*\*Not here — it is extended/); assert.match(a, /50-day line/);
});

test('add: never average down, wait for earnings, no adds in a correction', () => {
  assert.match(tailoredAnswer('add here?', { ...base, price: 282, cost: 290 }), /don't add/);
  assert.match(tailoredAnswer('add here?', { ...base, price: 290, earnDays: 5 }), /Wait until after the earnings/);
  assert.match(tailoredAnswer('add here?', { ...base, price: 290, market: 'corr' }), /correction/);
});

test('sell/hold and other questions', () => {
  assert.match(tailoredAnswer('should I sell?', { ...base, price: 300 }), /^\*\*Hold/);
  assert.match(tailoredAnswer('should I sell?', { ...base, price: 260 }), /^\*\*Sell/);
  assert.equal(tailoredAnswer('does this company have a moat?', { ...base, price: 290 }), null);
});
